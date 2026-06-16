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
        const error = await buildSupabaseError(response, path);
        throw error;
      }
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
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
      const taskTypes = buildTaskTypePayloads(state, userId);
      const tasks = buildTaskPayloads(state, userId);

      if (taskTypes.length) {
        await upsertTaskTypes(taskTypes);
      }
      if (tasks.length) {
        await upsertTasks(tasks);
      }

      return {
        userId,
        taskTypesCount: taskTypes.length,
        tasksCount: tasks.length,
        taskPayloadSample: tasks[0] || null
      };
    }

    function buildTaskTypePayloads(state, userId) {
      return state.taskTypes.map((type) => ({
        id: type.id,
        user_id: userId,
        name: type.name,
        sort_order: type.sort_order,
        active: type.active,
        chart_number_mode: type.chart_number_mode,
        default_due_type: type.default_due_type,
        is_supply_related: Boolean(type.is_supply_related),
        is_patient_view: Boolean(type.is_patient_view),
        created_at: type.created_at,
        updated_at: type.updated_at
      }));
    }

    function buildTaskPayloads(state, userId) {
      return state.tasks.map((task) => ({
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
    }

    async function upsertTaskTypes(taskTypes) {
      return request("/rest/v1/task_types?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(taskTypes)
      });
    }

    async function upsertTasks(tasks) {
      return request("/rest/v1/tasks?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(tasks)
      });
    }

    async function deleteTask(taskId) {
      requireLogin();
      return request(`/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
    }

    async function deleteTaskTypes(typeIds) {
      requireLogin();
      if (!typeIds.length) return null;
      const encodedIds = typeIds.map((id) => `"${String(id).replaceAll('"', '\\"')}"`).join(",");
      return request(`/rest/v1/task_types?id=in.(${encodedIds})`, {
        method: "DELETE",
        headers: { Prefer: "return=minimal" }
      });
    }

    async function runConnectionTest() {
      requireLogin();
      const userId = session.user.id;
      const now = new Date().toISOString();
      const testTask = {
        id: `task_connection_test_${Date.now()}`,
        user_id: userId,
        task_type_id: null,
        title: "Supabase接続テスト",
        chart_number: null,
        memo: "自動削除されるテストデータ",
        due_date: null,
        priority: "normal",
        status: "active",
        archived: false,
        created_at: now,
        updated_at: now,
        completed_at: null
      };

      await request("/rest/v1/task_types?select=id&limit=1");
      await request("/rest/v1/tasks?select=id&limit=1");
      await upsertTasks([testTask]);
      await deleteTask(testTask.id);

      return {
        userId,
        email: session.user.email,
        taskTypesSelect: true,
        tasksSelect: true,
        tasksInsert: true,
        tasksDelete: true
      };
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
      upsertAll,
      deleteTaskTypes,
      runConnectionTest
    };
  }

  async function buildSupabaseError(response, path) {
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const message = parsed && parsed.message ? parsed.message : text || `Supabase request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.path = path;
    error.details = parsed && parsed.details ? parsed.details : "";
    error.hint = parsed && parsed.hint ? parsed.hint : "";
    error.code = parsed && parsed.code ? parsed.code : "";
    error.body = parsed || text;
    return error;
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
