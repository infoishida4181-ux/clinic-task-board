(function () {
  function createSyncManager({ storage, supabase }) {
    const client = supabase.hasSupabaseConfig() ? supabase.createClient(window.SUPABASE_CONFIG) : null;
    let status = initialStatus();
    let lastError = "";
    let lastErrorDetail = null;
    let lastSaveResult = null;

    function getStatus() {
      const authState = client ? client.getAuthState() : { hasSession: false, expired: false, email: "" };
      if (client && authState.expired && status === "supabase") status = "expired";
      return {
        status,
        configured: Boolean(client),
        hasSession: Boolean(client && authState.hasSession),
        loggedIn: Boolean(client && authState.hasSession && !authState.expired),
        expired: Boolean(client && authState.expired),
        email: authState.email || "",
        lastError,
        lastErrorDetail,
        lastSaveResult
      };
    }

    async function signIn(email, password) {
      ensureConfigured();
      await client.signIn(email, password);
      status = "supabase";
      lastError = "";
      lastErrorDetail = null;
    }

    async function signOut() {
      ensureConfigured();
      await client.signOut();
      status = "not_logged_in";
      lastError = "";
      lastErrorDetail = null;
    }

    async function loadFromSupabase(localState) {
      ensureLoggedIn();
      try {
        const remote = await client.loadAll();
        if (remote.taskTypes.length === 0) {
          const seedSource = storage.hasStoredTaskTypes() && localState.taskTypes.length
            ? localState
            : storage.createInitialState();
          const restored = storage.restoreInitialTaskTypes({
            ...seedSource,
            tasks: remote.tasks.length ? remote.tasks : seedSource.tasks
          });
          const seededState = storage.normalizeState({
            ...restored.state,
            sync: {
              mode: "supabase",
              last_loaded_at: new Date().toISOString(),
              last_synced_at: new Date().toISOString()
            }
          });
          const mergedSeededState = storage.mergeRemoteState(localState, seededState);
          await persistStateAndDeleteDuplicates(mergedSeededState);
          status = "supabase";
          lastError = "";
          lastErrorDetail = null;
          storage.saveLocalState(mergedSeededState);
          return mergedSeededState;
        }

        const normalizedRemote = storage.normalizeState({
          version: 2,
          taskTypes: remote.taskTypes.map((type) => ({
            ...type,
            category_tags: type.is_supply_related ? [storage.ORDER_TAG] : []
          })),
          tasks: remote.tasks.map((task) => ({
            ...task,
            synced: true,
            pendingSync: false,
            sync_error: ""
          })),
          sync: {
            mode: "supabase",
            last_loaded_at: new Date().toISOString(),
            last_synced_at: localState.sync ? localState.sync.last_synced_at : null
          }
        });
        const normalized = storage.mergeRemoteState(localState, normalizedRemote);
        await persistStateAndDeleteDuplicates(normalized);
        status = "supabase";
        lastError = "";
        lastErrorDetail = null;
        storage.saveLocalState(normalized);
        return normalized;
      } catch (error) {
        status = error.loginExpired ? "expired" : "failed";
        lastError = formatSupabaseError(error);
        lastErrorDetail = errorToDetail(error);
        // Never replace local data with empty remote state when the session expired.
        console.error("Supabase load failed", lastErrorDetail || error);
        return localState;
      }
    }

    async function save(state) {
      storage.saveLocalState(state);
      if (!client || !client.getSession()) {
        status = client ? "not_logged_in" : "local";
        return { ok: false, state, reason: status };
      }
      try {
        const normalizedForSave = storage.normalizeState(state);
        const result = await persistStateAndDeleteDuplicates(normalizedForSave);
        status = "supabase";
        lastError = "";
        lastErrorDetail = null;
        lastSaveResult = result;
        const syncedState = storage.normalizeState(normalizedForSave);
        syncedState.tasks = syncedState.tasks.map((task) => ({
          ...task,
          user_id: result.userId,
          synced: true,
          pendingSync: false,
          pendingDelete: false,
          sync_error: ""
        }));
        syncedState.sync = {
          ...(state.sync || {}),
          mode: "supabase",
          last_synced_at: new Date().toISOString()
        };
        storage.saveLocalState(syncedState);
        return { ok: true, state: syncedState, result };
      } catch (error) {
        status = error.loginExpired ? "expired" : "failed";
        lastError = formatSupabaseError(error);
        lastErrorDetail = errorToDetail(error);
        const failedState = storage.normalizeState(state);
        // Supabase failures, including login expiry, must not delete chairside input; keep local work pending.
        failedState.tasks = failedState.tasks.map((task) => {
          if (task.deleted_at || task.pendingDelete) {
            // Keep the delete intent locally; the task stays hidden and delete will retry later.
            return {
              ...task,
              synced: false,
              pendingSync: false,
              pendingDelete: true,
              sync_error: lastError
            };
          }
          return task.pendingSync || !task.synced ? {
            ...task,
            synced: false,
            pendingSync: true,
            sync_error: lastError
          } : task;
        });
        storage.saveLocalState(failedState);
        console.error("Supabase save failed", lastErrorDetail || error);
        return { ok: false, state: failedState, error: lastErrorDetail, reason: status };
      }
    }

    async function migrateLocalToSupabase(state) {
      ensureLoggedIn();
      const restored = storage.restoreInitialTaskTypes(state);
      const migrationState = storage.normalizeState(restored.state);
      await persistStateAndDeleteDuplicates(migrationState);
      migrationState.sync = {
        ...(state.sync || {}),
        mode: "supabase",
        last_synced_at: new Date().toISOString()
      };
      storage.saveLocalState(migrationState);
      status = "supabase";
      lastError = "";
      lastErrorDetail = null;
      return loadFromSupabase(migrationState);
    }

    async function runConnectionTest() {
      ensureLoggedIn();
      try {
        const result = await client.runConnectionTest();
        status = "supabase";
        lastError = "";
        lastErrorDetail = null;
        return { ok: true, result };
      } catch (error) {
        status = error.loginExpired ? "expired" : "failed";
        lastError = formatSupabaseError(error);
        lastErrorDetail = errorToDetail(error);
        console.error("Supabase connection test failed", lastErrorDetail || error);
        return { ok: false, error: lastErrorDetail };
      }
    }

    async function persistStateAndDeleteDuplicates(state) {
      // Save visible/remapped tasks, apply pending task deletes, then delete duplicate types.
      const pendingDeleteIds = state.tasks
        .filter((task) => task.deleted_at || task.pendingDelete)
        .map((task) => task.id);
      const result = await client.upsertAll(state);
      if (pendingDeleteIds.length) {
        try {
          await client.deleteTasks(pendingDeleteIds);
        } catch (error) {
          error.taskIds = pendingDeleteIds;
          throw error;
        }
      }
      if (Array.isArray(state.duplicateTypeIds) && state.duplicateTypeIds.length) {
        await client.deleteTaskTypes(state.duplicateTypeIds);
      }
      return result;
    }

    function ensureConfigured() {
      if (!client) throw new Error("Supabase設定がありません。assets/js/config.js を作成してください。");
    }

    function ensureLoggedIn() {
      ensureConfigured();
      if (!client.getSession()) throw new Error("Supabaseにログインしてください。");
    }

    function initialStatus() {
      if (!client) return "local";
      const authState = client.getAuthState();
      if (!authState.hasSession) return "not_logged_in";
      return authState.expired ? "expired" : "supabase";
    }

    return {
      getStatus,
      signIn,
      signOut,
      loadFromSupabase,
      save,
      migrateLocalToSupabase,
      runConnectionTest
    };
  }

  function formatSupabaseError(error) {
    if (!error) return "Supabase保存失敗";
    if (error.loginExpired) return "ログイン期限が切れました。再ログインしてください。";
    const parts = [];
    if (error.status) parts.push(`HTTP ${error.status}`);
    if (error.message) parts.push(error.message);
    if (error.details) parts.push(`details: ${error.details}`);
    if (error.hint) parts.push(`hint: ${error.hint}`);
    return parts.join(" / ") || String(error);
  }

  function errorToDetail(error) {
    if (!error) return null;
    return {
      status: error.status || null,
      message: error.message || String(error),
      details: error.details || "",
      hint: error.hint || "",
      code: error.code || "",
      loginExpired: Boolean(error.loginExpired),
      path: error.path || "",
      taskIds: Array.isArray(error.taskIds) ? error.taskIds : [],
      body: error.body || null
    };
  }

  window.ClinicTaskSync = {
    createSyncManager
  };
})();
