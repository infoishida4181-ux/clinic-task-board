(function () {
  function createSyncManager({ storage, supabase }) {
    const client = supabase.hasSupabaseConfig() ? supabase.createClient(window.SUPABASE_CONFIG) : null;
    let status = client && client.getSession() ? "supabase" : client ? "not_logged_in" : "local";
    let lastError = "";
    let lastErrorDetail = null;
    let lastSaveResult = null;

    function getStatus() {
      return {
        status,
        configured: Boolean(client),
        loggedIn: Boolean(client && client.getSession()),
        email: client && client.getSession() && client.getSession().user ? client.getSession().user.email : "",
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
    }

    async function signOut() {
      ensureConfigured();
      await client.signOut();
      status = "not_logged_in";
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
          await client.upsertAll(seededState);
          status = "supabase";
          lastError = "";
          lastErrorDetail = null;
          storage.saveLocalState(seededState);
          return seededState;
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
        status = "supabase";
        lastError = "";
        lastErrorDetail = null;
        storage.saveLocalState(normalized);
        return normalized;
      } catch (error) {
        status = "failed";
        lastError = formatSupabaseError(error);
        lastErrorDetail = errorToDetail(error);
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
        const result = await client.upsertAll(state);
        status = "supabase";
        lastError = "";
        lastErrorDetail = null;
        lastSaveResult = result;
        const syncedState = storage.normalizeState(state);
        syncedState.tasks = syncedState.tasks.map((task) => ({
          ...task,
          user_id: result.userId,
          synced: true,
          pendingSync: false,
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
        status = "failed";
        lastError = formatSupabaseError(error);
        lastErrorDetail = errorToDetail(error);
        const failedState = storage.normalizeState(state);
        failedState.tasks = failedState.tasks.map((task) => task.pendingSync || !task.synced ? {
          ...task,
          synced: false,
          pendingSync: true,
          sync_error: lastError
        } : task);
        storage.saveLocalState(failedState);
        console.error("Supabase save failed", lastErrorDetail || error);
        return { ok: false, state: failedState, error: lastErrorDetail };
      }
    }

    async function migrateLocalToSupabase(state) {
      ensureLoggedIn();
      const restored = storage.restoreInitialTaskTypes(state);
      const migrationState = storage.normalizeState(restored.state);
      await client.upsertAll(migrationState);
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
        status = "failed";
        lastError = formatSupabaseError(error);
        lastErrorDetail = errorToDetail(error);
        console.error("Supabase connection test failed", lastErrorDetail || error);
        return { ok: false, error: lastErrorDetail };
      }
    }

    function ensureConfigured() {
      if (!client) throw new Error("Supabase設定がありません。assets/js/config.js を作成してください。");
    }

    function ensureLoggedIn() {
      ensureConfigured();
      if (!client.getSession()) throw new Error("Supabaseにログインしてください。");
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
      path: error.path || "",
      body: error.body || null
    };
  }

  window.ClinicTaskSync = {
    createSyncManager
  };
})();
