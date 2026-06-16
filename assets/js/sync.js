(function () {
  function createSyncManager({ storage, supabase }) {
    const client = supabase.hasSupabaseConfig() ? supabase.createClient(window.SUPABASE_CONFIG) : null;
    let status = client && client.getSession() ? "supabase" : client ? "not_logged_in" : "local";
    let lastError = "";

    function getStatus() {
      return {
        status,
        configured: Boolean(client),
        loggedIn: Boolean(client && client.getSession()),
        email: client && client.getSession() && client.getSession().user ? client.getSession().user.email : "",
        lastError
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
        const normalized = storage.normalizeState({
          version: 2,
          taskTypes: remote.taskTypes.map((type) => ({
            ...type,
            category_tags: type.is_supply_related ? [storage.ORDER_TAG] : []
          })),
          tasks: remote.tasks,
          sync: {
            mode: "supabase",
            last_loaded_at: new Date().toISOString(),
            last_synced_at: localState.sync ? localState.sync.last_synced_at : null
          }
        });
        status = "supabase";
        lastError = "";
        storage.saveLocalState(normalized);
        return normalized;
      } catch (error) {
        status = "offline";
        lastError = error.message;
        return localState;
      }
    }

    async function save(state) {
      storage.saveLocalState(state);
      if (!client || !client.getSession()) {
        status = client ? "not_logged_in" : "local";
        return;
      }
      try {
        await client.upsertAll(state);
        status = "supabase";
        lastError = "";
        state.sync = {
          ...(state.sync || {}),
          mode: "supabase",
          last_synced_at: new Date().toISOString()
        };
        storage.saveLocalState(state);
      } catch (error) {
        status = "offline";
        lastError = error.message;
      }
    }

    async function migrateLocalToSupabase(state) {
      ensureLoggedIn();
      await client.upsertAll(state);
      state.sync = {
        ...(state.sync || {}),
        mode: "supabase",
        last_synced_at: new Date().toISOString()
      };
      storage.saveLocalState(state);
      status = "supabase";
      lastError = "";
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
      migrateLocalToSupabase
    };
  }

  window.ClinicTaskSync = {
    createSyncManager
  };
})();
