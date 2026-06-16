const STORAGE_KEY = "clinicTaskBoard.v1";
const ORDER_TAG = "order_prepare";

// Fixed clinic policy: tasks may store chart numbers, but never patient names or patient master data.
// The last three flags are independent view placement, kept separate from chart_number_mode.
const INITIAL_TASK_TYPE_ROWS = [
  ["インプラント体発注", "required", true, false, false],
  ["ガイド発注", "required", true, false, false],
  ["2次オペ準備物確認", "required", true, false, false],
  ["インプラント印象準備物確認", "required", true, false, false],
  ["個人トレー作製", "required", true, false, false],
  ["TEC作製", "required", true, false, false],
  ["NG作製", "required", true, false, false],
  ["プレオルソ発注", "required", true, false, false],
  ["紹介状作製", "required", false, true, false],
  ["シェード写真送信", "required", false, true, false],
  ["メンブレン発注", "optional", true, false, false],
  ["エムドゲイン発注", "optional", true, false, false],
  ["リグロス発注", "optional", true, false, false],
  ["AOSS発注", "optional", true, false, false],
  ["ボナーク発注", "optional", true, false, false],
  ["テルプラグ発注", "optional", true, false, false],
  ["振り込み・支払い", "none", false, false, true],
  ["事務仕事", "none", false, false, true],
  ["その他", "optional", false, false, true]
];

const DEFAULT_TASK_TYPE_BY_NAME = new Map(
  INITIAL_TASK_TYPE_ROWS.map(([name, chartMode, isSupply, isPatient, isAdmin]) => [
    canonicalTypeName(name),
    { name, chartMode, isSupply, isPatient, isAdmin }
  ])
);

function createInitialState() {
  const now = new Date().toISOString();
  return {
    version: 2,
    exported_at: null,
    sync: {
      mode: "local",
      last_loaded_at: null,
      last_synced_at: null
    },
    taskTypes: createDefaultTaskTypes(now),
    tasks: []
  };
}

function createDefaultTaskTypes(now = new Date().toISOString()) {
  return INITIAL_TASK_TYPE_ROWS.map(([name, chartMode, isSupply, isPatient, isAdmin], index) => ({
    id: cryptoId("type"),
    user_id: null,
    name,
    sort_order: index + 1,
    active: true,
    chart_number_mode: chartMode,
    default_due_type: isSupply ? "tomorrow" : "today",
    is_supply_related: isSupply,
    is_patient_view: isPatient,
    is_admin_related: isAdmin,
    category_tags: isSupply ? [ORDER_TAG] : [],
    created_at: now,
    updated_at: now
  }));
}

function hasStoredTaskTypes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.taskTypes) && parsed.taskTypes.length > 0;
  } catch {
    return false;
  }
}

function loadLocalState() {
  const fallback = createInitialState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    return normalizeState(JSON.parse(raw), fallback);
  } catch (error) {
    console.warn("Failed to load local state", error);
    return fallback;
  }
}

function saveLocalState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state, createInitialState())));
}

function normalizeState(data, fallback = createInitialState()) {
  const now = new Date().toISOString();
  const taskTypes = Array.isArray(data && data.taskTypes) ? data.taskTypes : fallback.taskTypes;
  const tasks = Array.isArray(data && data.tasks) ? data.tasks : [];
  const normalizedTaskTypes = taskTypes.map((type, index) => normalizeTaskType(type, index, now));
  const normalizedTasks = tasks.map((task) => normalizeTask(task, now));
  const deduped = dedupeTaskTypesAndTasks(normalizedTaskTypes, normalizedTasks);

  return {
    version: 2,
    exported_at: data && data.exported_at ? data.exported_at : null,
    sync: {
      mode: data && data.sync && data.sync.mode ? data.sync.mode : "local",
      last_loaded_at: data && data.sync ? data.sync.last_loaded_at || null : null,
      last_synced_at: data && data.sync ? data.sync.last_synced_at || null : null
    },
    taskTypes: deduped.taskTypes,
    tasks: deduped.tasks,
    duplicateTypeIds: deduped.duplicateTypeIds
  };
}

function normalizeTaskType(type, index, now) {
  const trimmedName = String(type.name || "名称未設定").trim() || "名称未設定";
  const defaultSpec = DEFAULT_TASK_TYPE_BY_NAME.get(canonicalTypeName(trimmedName));
  const isSupply = defaultSpec
    ? defaultSpec.isSupply
    : Boolean(type.is_supply_related || (Array.isArray(type.category_tags) && type.category_tags.includes(ORDER_TAG)));
  const isPatient = defaultSpec ? defaultSpec.isPatient : Boolean(type.is_patient_view);
  const isAdmin = defaultSpec ? defaultSpec.isAdmin : Boolean(type.is_admin_related);

  return {
    id: type.id || cryptoId("type"),
    user_id: type.user_id || null,
    name: trimmedName,
    sort_order: Number(type.sort_order || index + 1),
    active: type.active !== false,
    chart_number_mode: ["required", "optional", "none"].includes(type.chart_number_mode)
      ? type.chart_number_mode
      : defaultSpec ? defaultSpec.chartMode : "optional",
    default_due_type: ["today", "tomorrow", "this_week", "next_week", "none"].includes(type.default_due_type)
      ? type.default_due_type
      : isSupply ? "tomorrow" : "today",
    is_supply_related: isSupply,
    is_patient_view: isPatient,
    is_admin_related: isAdmin,
    category_tags: isSupply ? [ORDER_TAG] : [],
    created_at: type.created_at || now,
    updated_at: type.updated_at || now
  };
}

function normalizeTask(task, now) {
  const deletedAt = task.deleted_at || null;
  return {
    id: task.id || cryptoId("task"),
    user_id: task.user_id || null,
    task_type_id: task.task_type_id || "",
    title: task.title || "",
    chart_number: task.chart_number || "",
    memo: task.memo || "",
    due_date: task.due_date || null,
    priority: task.priority || "normal",
    status: task.status === "completed" ? "completed" : "active",
    archived: Boolean(task.archived),
    created_at: task.created_at || now,
    updated_at: task.updated_at || task.created_at || now,
    completed_at: task.completed_at || null,
    deleted_at: deletedAt,
    synced: Boolean(task.synced),
    pendingSync: Boolean(task.pendingSync),
    pendingDelete: Boolean(task.pendingDelete),
    sync_error: task.sync_error || ""
  };
}

// Collapse same-name task types before rendering or syncing.
// Tasks are remapped to the representative type so historical task records keep their category.
function dedupeTaskTypesAndTasks(taskTypes, tasks) {
  const grouped = new Map();
  taskTypes.forEach((type) => {
    const key = canonicalTypeName(type.name);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(type);
  });

  const taskUseCounts = new Map();
  tasks.forEach((task) => {
    if (!task.task_type_id) return;
    taskUseCounts.set(task.task_type_id, (taskUseCounts.get(task.task_type_id) || 0) + 1);
  });

  const idRemap = new Map();
  const duplicateTypeIds = [];
  const uniqueTypes = [];

  grouped.forEach((group) => {
    const sorted = group.slice().sort((a, b) => {
      const usedDiff = Number(taskUseCounts.has(b.id)) - Number(taskUseCounts.has(a.id));
      if (usedDiff) return usedDiff;
      const activeDiff = Number(b.active) - Number(a.active);
      if (activeDiff) return activeDiff;
      return a.sort_order - b.sort_order;
    });
    const primary = sorted[0];
    uniqueTypes.push(primary);
    sorted.slice(1).forEach((duplicate) => {
      idRemap.set(duplicate.id, primary.id);
      duplicateTypeIds.push(duplicate.id);
    });
  });

  const remappedTasks = tasks.map((task) => ({
    ...task,
    task_type_id: idRemap.get(task.task_type_id) || task.task_type_id
  }));

  return {
    taskTypes: uniqueTypes.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ja")),
    tasks: remappedTasks,
    duplicateTypeIds
  };
}

function canonicalTypeName(name) {
  return String(name || "").trim();
}

function mergeRemoteState(localState, remoteState) {
  const normalizedLocal = normalizeState(localState, createInitialState());
  const normalizedRemote = normalizeState(remoteState, createInitialState());
  const locallyDeletedIds = new Set(
    normalizedLocal.tasks
      .filter((task) => task.deleted_at || task.pendingDelete)
      .map((task) => task.id)
  );
  const remoteVisibleTasks = normalizedRemote.tasks.filter((task) => !locallyDeletedIds.has(task.id));
  const remoteTaskIds = new Set(normalizedRemote.tasks.map((task) => task.id));
  // Local deletion tombstones win over remote rows so a stale Supabase task cannot reappear.
  const localDeletedTasks = normalizedLocal.tasks.filter((task) => task.deleted_at || task.pendingDelete);
  // Local failed saves stay on the device until a later Supabase save succeeds.
  const localPendingTasks = normalizedLocal.tasks.filter((task) =>
    (task.pendingSync || task.sync_error) && !task.deleted_at && !task.pendingDelete && !remoteTaskIds.has(task.id)
  );

  return normalizeState({
    ...normalizedRemote,
    tasks: [...localDeletedTasks, ...localPendingTasks, ...remoteVisibleTasks]
  }, createInitialState());
}

function restoreInitialTaskTypes(state, options = {}) {
  const now = new Date().toISOString();
  const normalized = normalizeState(state, createInitialState());
  const existingByName = new Map(normalized.taskTypes.map((type) => [canonicalTypeName(type.name), type]));
  const maxSort = Math.max(0, ...normalized.taskTypes.map((type) => Number(type.sort_order) || 0));
  let added = 0;
  let reactivated = 0;

  createDefaultTaskTypes(now).forEach((defaultType, index) => {
    const existing = existingByName.get(canonicalTypeName(defaultType.name));
    if (existing) {
      if (options.reactivate !== false && existing.active === false) {
        existing.active = true;
        existing.updated_at = now;
        reactivated += 1;
      }
      existing.chart_number_mode = defaultType.chart_number_mode;
      existing.default_due_type = existing.default_due_type || defaultType.default_due_type;
      existing.is_supply_related = defaultType.is_supply_related;
      existing.is_patient_view = defaultType.is_patient_view;
      existing.is_admin_related = defaultType.is_admin_related;
      existing.category_tags = existing.is_supply_related ? [ORDER_TAG] : [];
      return;
    }

    normalized.taskTypes.push({
      ...defaultType,
      sort_order: maxSort + index + 1
    });
    added += 1;
  });

  return {
    state: normalizeState(normalized, createInitialState()),
    added,
    reactivated
  };
}

function cryptoId(prefix) {
  if (window.crypto && window.crypto.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

window.ClinicTaskStorage = {
  STORAGE_KEY,
  ORDER_TAG,
  createInitialState,
  createDefaultTaskTypes,
  hasStoredTaskTypes,
  loadLocalState,
  saveLocalState,
  normalizeState,
  mergeRemoteState,
  restoreInitialTaskTypes,
  cryptoId
};
