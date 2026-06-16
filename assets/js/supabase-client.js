(function () {
  const SESSION_KEY = "clinicTaskBoard.supabaseSession.v1";

  function hasSupabaseConfig() {
    const config = window.SUPABASE_CONFIG;
    return Boolean(
      config &&
      typeof config.url === "string" &&
      typeof config.anonKey === "string" &&
      config.url.startsWith("http") &&
      config.anonKey &&
      !config.url.includes("YOUR_SUPABASE_URL") &&
      !config.anonKey.includes("YOUR_SUPABASE_ANON_KEY")
    );
  }

  function createClient(config) {
    const baseUrl = config.url.replace(/\/$/, "");
    const anonKey = config.anonKey;
    let session = readSession();

    function authHeaders() {
      return {
        apikey: anonKey,
        Authorization: `Bearer ${session ? session.access_token : anonKey}`,
        "Content-Type": "application/json"
      };
    }

    async function request(path, options = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          ...authHeaders(),
          ...(options.headers || {})
        }
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Supabase request failed: ${response.status}`);
      }
      if (response.status === 204) return null;
      return response.json();
    }

    async function signIn(email, password) {
      const data = await request("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      session = data;
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      return data;
    }

    async function signOut() {
      if (session) {
        await request("/auth/v1/logout", { method: "POST" }).catch(() => null);
      }
      session = null;
      localStorage.removeItem(SESSION_KEY);
    }

    async function loadAll() {
      requireLogin();
      const [taskTypes, tasks] = await Promise.all([
        request("/rest/v1/task_types?select=*&order=sort_order.asc"),
        request("/rest/v1/tasks?select=*&order=created_at.desc")
      ]);
      return { taskTypes, tasks };
    }

    async function upsertAll(state) {
      requireLogin();
      const userId = session.user.id;
      const taskTypes = state.taskTypes.map((type) => ({
        id: type.id,
        user_id: userId,
        name: type.name,
        sort_order: type.sort_order,
        active: type.active,
        chart_number_mode: type.chart_number_mode,
        default_due_type: type.default_due_type,
        is_supply_related: Boolean(type.is_supply_related),
        created_at: type.created_at,
        updated_at: type.updated_at
      }));
      const tasks = state.tasks.map((task) => ({
        id: task.id,
        user_id: userId,
        task_type_id: task.task_type_id || null,
        title: task.title,
        chart_number: task.chart_number || null,
        memo: task.memo || null,
        due_date: task.due_date || null,
        priority: task.priority || "normal",
        status: task.status,
        archived: task.archived,
        created_at: task.created_at,
        updated_at: task.updated_at,
        completed_at: task.completed_at
      }));

      if (taskTypes.length) {
        await request("/rest/v1/task_types?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(taskTypes)
        });
      }
      if (tasks.length) {
        await request("/rest/v1/tasks?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(tasks)
        });
      }
    }

    function getSession() {
      return session;
    }

    function requireLogin() {
      if (!session || !session.access_token || !session.user) {
        throw new Error("Supabaseにログインしていません。");
      }
    }

    return {
      getSession,
      signIn,
      signOut,
      loadAll,
      upsertAll
    };
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  window.ClinicTaskSupabase = {
    SESSION_KEY,
    hasSupabaseConfig,
    createClient
  };
})();
