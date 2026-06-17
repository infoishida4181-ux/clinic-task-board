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
    let authExpired = Boolean(session && isSessionPastRefreshWindow(session));
    let refreshCount = 0;
    let refreshInFlight = null;

    function authHeaders(options = {}) {
      const token = options.useAnonAuth ? anonKey : session ? session.access_token : anonKey;
      return {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      };
    }

    async function request(path, options = {}) {
      if (!options.skipAuthRefresh) {
        await ensureFreshSession();
      }
      const {
        authRetry,
        skipAuthRefresh,
        useAnonAuth,
        ...fetchOptions
      } = options;
      const response = await fetch(`${baseUrl}${path}`, {
        ...fetchOptions,
        headers: {
          ...authHeaders({ useAnonAuth }),
          ...(options.headers || {})
        }
      });
      if (!response.ok) {
        const error = await buildSupabaseError(response, path);
        if (!skipAuthRefresh && !authRetry && isExpiredJwtError(error)) {
          // Refreshing once is enough to replace an expired JWT; replaying more than once can duplicate writes.
          await refreshSession();
          return request(path, {
            ...options,
            authRetry: true
          });
        }
        throw error;
      }
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }

    async function signIn(email, password) {
      const data = await request("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        skipAuthRefresh: true,
        useAnonAuth: true
      });
      saveSession(data);
      authExpired = false;
      return data;
    }

    async function signOut() {
      if (session) {
        await request("/auth/v1/logout", { method: "POST", skipAuthRefresh: true }).catch(() => null);
      }
      session = null;
      authExpired = false;
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
        is_admin_related: Boolean(type.is_admin_related),
        created_at: type.created_at,
        updated_at: type.updated_at
      }));
    }

    function buildTaskPayloads(state, userId) {
      return state.tasks.filter((task) => !task.deleted_at && !task.pendingDelete).map((task) => ({
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

    async function deleteTasks(taskIds) {
      requireLogin();
      if (!taskIds.length) return null;
      const encodedIds = taskIds.map((id) => `"${String(id).replaceAll('"', '\\"')}"`).join(",");
      return request(`/rest/v1/tasks?id=in.(${encodedIds})`, {
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
      const refreshCountBefore = refreshCount;
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
      await deleteTasks([testTask.id]);

      return {
        userId,
        email: session.user.email,
        sessionRefresh: refreshCount > refreshCountBefore,
        taskTypesSelect: true,
        tasksSelect: true,
        tasksInsert: true,
        tasksDelete: true
      };
    }

    function getSession() {
      return session;
    }

    function isAuthExpired() {
      return authExpired || Boolean(session && isSessionPastRefreshWindow(session));
    }

    function getAuthState() {
      return {
        hasSession: Boolean(session && session.access_token && session.user),
        expired: isAuthExpired(),
        email: session && session.user ? session.user.email || "" : "",
        expiresAt: session && session.expires_at ? session.expires_at : null
      };
    }

    function requireLogin() {
      if (!session || !session.access_token || !session.user) {
        throw new Error("Supabaseにログインしていません。");
      }
      if (authExpired && !session.refresh_token) {
        throw createLoginExpiredError();
      }
    }

    async function ensureFreshSession() {
      if (!session || !session.access_token) return;
      if (!isSessionPastRefreshWindow(session)) return;
      // Refresh before REST calls when expires_at is known, avoiding predictable JWT expired failures.
      await refreshSession();
    }

    async function refreshSession() {
      if (!session || !session.refresh_token) {
        authExpired = true;
        throw createLoginExpiredError();
      }
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = doRefreshSession();
      try {
        return await refreshInFlight;
      } finally {
        refreshInFlight = null;
      }
    }

    async function doRefreshSession() {
      // Refresh uses the public anon key plus refresh_token; never embed service_role or database secrets.
      const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      if (!response.ok) {
        authExpired = true;
        const error = await buildSupabaseError(response, "/auth/v1/token?grant_type=refresh_token");
        error.loginExpired = true;
        throw error;
      }
      const data = await response.json();
      saveSession(data);
      authExpired = false;
      refreshCount += 1;
      return session;
    }

    function saveSession(data) {
      session = normalizeSession(data, session);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }

    return {
      getSession,
      getAuthState,
      isAuthExpired,
      signIn,
      signOut,
      loadAll,
      upsertAll,
      deleteTasks,
      deleteTaskTypes,
      runConnectionTest
    };
  }

  function normalizeSession(data, previousSession = null) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresIn = Number(data.expires_in || 0);
    return {
      ...data,
      refresh_token: data.refresh_token || (previousSession ? previousSession.refresh_token : ""),
      user: data.user || (previousSession ? previousSession.user : null),
      expires_at: Number(data.expires_at || 0) || (expiresIn ? nowSeconds + expiresIn : null)
    };
  }

  function isSessionPastRefreshWindow(currentSession) {
    if (!currentSession || !currentSession.expires_at) return false;
    const refreshLeewaySeconds = 60;
    return Number(currentSession.expires_at) <= Math.floor(Date.now() / 1000) + refreshLeewaySeconds;
  }

  function isExpiredJwtError(error) {
    if (!error || error.status !== 401) return false;
    const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
    return text.includes("jwt expired") || text.includes("invalid jwt") || text.includes("expired");
  }

  function createLoginExpiredError() {
    const error = new Error("ログイン期限が切れました。再ログインしてください。");
    error.status = 401;
    error.code = "session_expired";
    error.loginExpired = true;
    return error;
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
    error.loginExpired = isExpiredJwtError(error);
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
