const STORAGE_KEY = "clinicTaskBoard.v1";
const ORDER_TAG = "order_prepare";

// Fixed clinic policy: tasks may store chart numbers, but never patient names or patient master data.
const INITIAL_TASK_TYPE_ROWS = [
  ["インプラント体発注", "required", true],
  ["ガイド発注", "required", true],
  ["2次オペ準備物確認", "required", true],
  ["インプラント印象準備物確認", "required", true],
  ["個人トレー作製", "required", false],
  ["TEC作製", "required", false],
  ["NG作製", "required", false],
  ["プレオルソ発注", "required", true],
  ["紹介状作製", "required", false],
  ["シェード写真送信", "required", false],
  ["メンブレン発注", "optional", true],
  ["エムドゲイン発注", "optional", true],
  ["リグロス発注", "optional", true],
  ["AOSS発注", "optional", true],
  ["ボナーク発注", "optional", true],
  ["テルプラグ発注", "optional", true],
  ["振り込み・支払い", "none", false],
  ["事務仕事", "none", false],
  ["その他", "optional", false]
];

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
  return INITIAL_TASK_TYPE_ROWS.map(([name, chartMode, isSupply], index) => ({
    id: cryptoId("type"),
    user_id: null,
    name,
    sort_order: index + 1,
    active: true,
    chart_number_mode: chartMode,
    default_due_type: isSupply ? "tomorrow" : "today",
    is_supply_related: isSupply,
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

  return {
    version: 2,
    exported_at: data && data.exported_at ? data.exported_at : null,
    sync: {
      mode: data && data.sync && data.sync.mode ? data.sync.mode : "local",
      last_loaded_at: data && data.sync ? data.sync.last_loaded_at || null : null,
      last_synced_at: data && data.sync ? data.sync.last_synced_at || null : null
    },
    taskTypes: taskTypes.map((type, index) => {
      const isSupply = Boolean(type.is_supply_related || (Array.isArray(type.category_tags) && type.category_tags.includes(ORDER_TAG)));
      return {
        id: type.id || cryptoId("type"),
        user_id: type.user_id || null,
        name: type.name || "名称未設定",
        sort_order: Number(type.sort_order || index + 1),
        active: type.active !== false,
        chart_number_mode: ["required", "optional", "none"].includes(type.chart_number_mode)
          ? type.chart_number_mode
          : "optional",
        default_due_type: ["today", "tomorrow", "this_week", "next_week", "none"].includes(type.default_due_type)
          ? type.default_due_type
          : "today",
        is_supply_related: isSupply,
        category_tags: isSupply ? [ORDER_TAG] : [],
        created_at: type.created_at || now,
        updated_at: type.updated_at || now
      };
    }),
    tasks: tasks.map((task) => ({
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
      completed_at: task.completed_at || null
    }))
  };
}

function restoreInitialTaskTypes(state, options = {}) {
  const now = new Date().toISOString();
  const normalized = normalizeState(state, createInitialState());
  const existingByName = new Map(normalized.taskTypes.map((type) => [type.name, type]));
  const maxSort = Math.max(0, ...normalized.taskTypes.map((type) => Number(type.sort_order) || 0));
  let added = 0;
  let reactivated = 0;

  createDefaultTaskTypes(now).forEach((defaultType, index) => {
    const existing = existingByName.get(defaultType.name);
    if (existing) {
      if (options.reactivate !== false && existing.active === false) {
        existing.active = true;
        existing.updated_at = now;
        reactivated += 1;
      }
      if (!existing.chart_number_mode) existing.chart_number_mode = defaultType.chart_number_mode;
      if (!existing.default_due_type) existing.default_due_type = defaultType.default_due_type;
      if (existing.is_supply_related === undefined) existing.is_supply_related = defaultType.is_supply_related;
      if (!Array.isArray(existing.category_tags)) {
        existing.category_tags = existing.is_supply_related ? [ORDER_TAG] : [];
      }
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
  restoreInitialTaskTypes,
  cryptoId
};
