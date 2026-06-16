const STORAGE_KEY = "clinicTaskBoard.v1";
const ORDER_TAG = "order_prepare";

// Fixed clinic policy: tasks may store chart numbers, but never patient names or patient master data.
const initialTaskTypeNames = [
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

let state = loadState();
let activeView = "today";
let selectedTypeId = "";
let selectedDueType = "today";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  counts: {
    today: $("#countToday"),
    overdue: $("#countOverdue"),
    order: $("#countOrder"),
    patient: $("#countPatient"),
    later: $("#countLater")
  },
  lists: {
    today: $("#todayList"),
    soon: $("#soonList"),
    patient: $("#patientList"),
    order: $("#orderList"),
    later: $("#laterList"),
    completed: $("#completedList")
  },
  taskModal: $("#taskModal"),
  typeModal: $("#typeModal"),
  taskForm: $("#taskForm"),
  typeForm: $("#typeForm"),
  typePicker: $("#typePicker"),
  typeList: $("#typeList")
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindEvents();
  render();
  registerServiceWorker();
}

function bindEvents() {
  $$(".tab-button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  $$("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewTarget));
  });

  $("#openTaskModal").addEventListener("click", () => openTaskModal());
  $("#closeTaskModal").addEventListener("click", closeTaskModal);
  $("#clearTaskForm").addEventListener("click", () => resetTaskForm());
  $("#addTypeButton").addEventListener("click", () => openTypeModal());
  $("#closeTypeModal").addEventListener("click", closeTypeModal);
  $("#exportButton").addEventListener("click", exportJson);
  $("#backupButton").addEventListener("click", exportJson);
  $("#importInput").addEventListener("change", importJson);
  $("#resetDemoButton").addEventListener("click", resetToInitialData);

  $$(".due-picker button").forEach((button) => {
    button.addEventListener("click", () => chooseDueType(button.dataset.due));
  });

  els.taskForm.addEventListener("submit", saveTaskFromForm);
  els.typeForm.addEventListener("submit", saveTypeFromForm);

  els.taskModal.addEventListener("click", (event) => {
    if (event.target === els.taskModal) closeTaskModal();
  });
  els.typeModal.addEventListener("click", (event) => {
    if (event.target === els.typeModal) closeTypeModal();
  });
}

function createInitialState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    exported_at: null,
    taskTypes: initialTaskTypeNames.map(([name, chartMode, isOrder], index) => ({
      id: cryptoId("type"),
      name,
      sort_order: index + 1,
      active: true,
      chart_number_mode: chartMode,
      default_due_type: isOrder ? "tomorrow" : "today",
      category_tags: isOrder ? [ORDER_TAG] : [],
      created_at: now,
      updated_at: now
    })),
    tasks: []
  };
}

// Storage is intentionally isolated behind loadState()/persist() so a future Supabase adapter can replace it.
function loadState() {
  const fallback = createInitialState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return normalizeState(parsed, fallback);
  } catch (error) {
    console.warn("Failed to load state", error);
    return fallback;
  }
}

function normalizeState(data, fallback) {
  const now = new Date().toISOString();
  const taskTypes = Array.isArray(data.taskTypes) ? data.taskTypes : fallback.taskTypes;
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];

  return {
    version: 1,
    exported_at: data.exported_at || null,
    taskTypes: taskTypes.map((type, index) => ({
      id: type.id || cryptoId("type"),
      name: type.name || "名称未設定",
      sort_order: Number(type.sort_order || index + 1),
      active: type.active !== false,
      chart_number_mode: ["required", "optional", "none"].includes(type.chart_number_mode)
        ? type.chart_number_mode
        : "optional",
      default_due_type: ["today", "tomorrow", "this_week", "next_week", "none"].includes(type.default_due_type)
        ? type.default_due_type
        : "today",
      category_tags: Array.isArray(type.category_tags) ? type.category_tags : [],
      created_at: type.created_at || now,
      updated_at: type.updated_at || now
    })),
    tasks: tasks.map((task) => ({
      id: task.id || cryptoId("task"),
      task_type_id: task.task_type_id || "",
      title: task.title || "",
      chart_number: task.chart_number || "",
      memo: task.memo || "",
      due_date: task.due_date || null,
      priority: task.priority || "normal",
      status: task.status === "completed" ? "completed" : "active",
      created_at: task.created_at || now,
      completed_at: task.completed_at || null,
      archived: Boolean(task.archived)
    }))
  };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  renderCounts();
  renderTaskLists();
  renderTypePicker();
  renderTypeList();
  updateDueButtons();
}

function setView(view) {
  activeView = view;
  $$(".tab-button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  $$(".view-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === `view-${view}`));
}

function activeTasks() {
  return state.tasks.filter((task) => task.status === "active" && !task.archived);
}

function completedTasks() {
  return state.tasks.filter((task) => task.status === "completed" && !task.archived);
}

function getTaskType(id) {
  return state.taskTypes.find((type) => type.id === id) || null;
}

function sortedTypes(includeInactive = false) {
  return state.taskTypes
    .filter((type) => includeInactive || type.active)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ja"));
}

function renderCounts() {
  const tasks = activeTasks();
  els.counts.today.textContent = tasks.filter(isTodayWork).length;
  els.counts.overdue.textContent = tasks.filter(isOverdue).length;
  els.counts.order.textContent = tasks.filter(isOrderTask).length;
  els.counts.patient.textContent = tasks.filter((task) => task.chart_number).length;
  els.counts.later.textContent = tasks.filter(isLaterTask).length;
}

function renderTaskLists() {
  const tasks = activeTasks();
  renderTaskList(els.lists.today, tasks.filter(isTodayWork));
  renderTaskList(els.lists.soon, tasks.filter(isDueSoon));
  renderTaskList(els.lists.patient, tasks.filter((task) => task.chart_number));
  renderTaskList(els.lists.order, tasks.filter(isOrderTask));
  renderTaskList(els.lists.later, tasks.filter(isLaterTask));
  renderTaskList(els.lists.completed, completedTasks(), true);
}

function renderTaskList(container, tasks, completed = false) {
  const sorted = tasks.slice().sort(compareTasks);
  if (!sorted.length) {
    container.innerHTML = `<div class="empty-state">表示するタスクはありません。</div>`;
    return;
  }
  container.innerHTML = sorted.map((task) => taskCardHtml(task, completed)).join("");
  container.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleTaskAction(button.dataset.action, button.dataset.taskId));
  });
}

function taskCardHtml(task, completed = false) {
  const type = getTaskType(task.task_type_id);
  const dueClass = isOverdue(task) ? "overdue" : isToday(task.due_date) ? "today" : "";
  const cardClasses = [
    "task-card",
    isOverdue(task) ? "is-overdue" : "",
    isToday(task.due_date) ? "is-today" : "",
    isOrderTask(task) ? "is-order" : "",
    completed ? "is-completed" : ""
  ].filter(Boolean).join(" ");
  const chart = task.chart_number ? `<span class="chart-chip">#${escapeHtml(task.chart_number)}</span>` : "";
  const memo = task.memo ? `<p class="task-memo">${escapeHtml(task.memo)}</p>` : "";
  const actions = completed
    ? `<button type="button" data-action="reactivate" data-task-id="${task.id}">未完了へ戻す</button>`
    : `
      <button type="button" data-action="complete" data-task-id="${task.id}">完了</button>
      <button type="button" data-action="edit" data-task-id="${task.id}">編集</button>
      <button type="button" data-action="tomorrow" data-task-id="${task.id}">明日に延期</button>
      <button type="button" data-action="next_week" data-task-id="${task.id}">来週に延期</button>
      <button type="button" data-action="no_due" data-task-id="${task.id}">期限なし</button>
      <button type="button" data-action="delete" data-task-id="${task.id}">削除</button>
    `;

  return `
    <article class="${cardClasses}">
      <div class="task-title">${chart}<span>${escapeHtml(displayTitle(task))}</span></div>
      <div class="task-meta">
        <span class="due-chip ${dueClass}">期限：${escapeHtml(formatDue(task.due_date))}</span>
        <span class="type-chip">分類：${escapeHtml(type ? type.name : "未選択")}</span>
        <span class="status-chip">${task.status === "completed" ? "完了" : "未完了"}</span>
      </div>
      ${memo}
      <div class="task-actions">${actions}</div>
    </article>
  `;
}

function displayTitle(task) {
  if (task.chart_number && task.title.startsWith(`#${task.chart_number}`)) {
    return task.title.replace(`#${task.chart_number}`, "").trim();
  }
  return task.title || "名称未設定";
}

function renderTypePicker() {
  const types = sortedTypes(false);
  els.typePicker.innerHTML = types
    .map((type) => `
      <button type="button" data-type-id="${type.id}" class="${type.id === selectedTypeId ? "is-selected" : ""}">
        ${escapeHtml(type.name)}
      </button>
    `)
    .join("");
  els.typePicker.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => chooseTaskType(button.dataset.typeId));
  });
}

function renderTypeList() {
  const usedTypeIds = new Set(state.tasks.map((task) => task.task_type_id).filter(Boolean));
  els.typeList.innerHTML = sortedTypes(true).map((type, index, list) => {
    const isUsed = usedTypeIds.has(type.id);
    const chartLabel = { required: "カルテ必須", optional: "カルテ任意", none: "カルテ不要" }[type.chart_number_mode];
    const orderLabel = type.category_tags.includes(ORDER_TAG) ? "発注・準備" : "通常";
    return `
      <article class="type-card ${type.active ? "" : "is-inactive"}">
        <div class="type-card-head">
          <div class="type-card-title">${escapeHtml(type.name)}</div>
          <span class="status-chip">${type.active ? "表示中" : "非表示"}</span>
        </div>
        <div class="type-card-meta">
          <span class="type-chip">${chartLabel}</span>
          <span class="due-chip">既定：${escapeHtml(dueTypeLabel(type.default_due_type))}</span>
          <span class="due-chip">${orderLabel}</span>
          ${isUsed ? `<span class="due-chip">履歴あり</span>` : ""}
        </div>
        <div class="type-actions">
          <button type="button" data-type-action="edit" data-type-id="${type.id}">編集</button>
          <button type="button" data-type-action="up" data-type-id="${type.id}" ${index === 0 ? "disabled" : ""}>上へ</button>
          <button type="button" data-type-action="down" data-type-id="${type.id}" ${index === list.length - 1 ? "disabled" : ""}>下へ</button>
          <button type="button" data-type-action="toggle" data-type-id="${type.id}">${type.active ? "非表示" : "表示"}</button>
          <button type="button" data-type-action="delete" data-type-id="${type.id}">削除</button>
        </div>
      </article>
    `;
  }).join("");

  els.typeList.querySelectorAll("[data-type-action]").forEach((button) => {
    button.addEventListener("click", () => handleTypeAction(button.dataset.typeAction, button.dataset.typeId));
  });
}

function chooseTaskType(typeId) {
  selectedTypeId = typeId;
  const type = getTaskType(typeId);
  if (!type) return;
  $("#taskTitle").value = type.name;
  chooseDueType(type.default_due_type || "today");
  updateChartModeHint();
  renderTypePicker();
}

function chooseDueType(dueType) {
  selectedDueType = dueType;
  $("#customDateWrap").hidden = dueType !== "custom";
  updateDueButtons();
}

function updateDueButtons() {
  $$(".due-picker button").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.due === selectedDueType);
  });
}

function updateChartModeHint() {
  const type = getTaskType(selectedTypeId);
  const chartInput = $("#chartNumber");
  if (!type) {
    $("#chartModeHint").textContent = "タスク種別を選ぶとカルテ番号の必要有無が反映されます。";
    chartInput.required = false;
    chartInput.disabled = false;
    return;
  }
  if (type.chart_number_mode === "required") {
    $("#chartModeHint").textContent = "この種別はカルテ番号が必須です。患者名は入力しないでください。";
    chartInput.required = true;
    chartInput.disabled = false;
  } else if (type.chart_number_mode === "none") {
    $("#chartModeHint").textContent = "この種別ではカルテ番号を保存しません。";
    chartInput.required = false;
    chartInput.value = "";
    chartInput.disabled = true;
  } else {
    $("#chartModeHint").textContent = "カルテ番号は任意です。患者名や詳細な医療情報は入力しないでください。";
    chartInput.required = false;
    chartInput.disabled = false;
  }
}

function openTaskModal(task = null) {
  resetTaskForm();
  if (task) {
    const type = getTaskType(task.task_type_id);
    $("#taskModalTitle").textContent = "タスク編集";
    $("#taskId").value = task.id;
    selectedTypeId = task.task_type_id || "";
    $("#taskTitle").value = displayTitle(task);
    $("#chartNumber").value = task.chart_number || "";
    $("#taskMemo").value = task.memo || "";
    if (task.due_date) {
      selectedDueType = "custom";
      $("#customDueDate").value = task.due_date;
      $("#customDateWrap").hidden = false;
    } else {
      selectedDueType = "none";
      $("#customDateWrap").hidden = true;
    }
    if (type) updateChartModeHint();
  }
  renderTypePicker();
  updateDueButtons();
  els.taskModal.hidden = false;
  $("#taskTitle").focus();
}

function closeTaskModal() {
  els.taskModal.hidden = true;
}

function resetTaskForm() {
  els.taskForm.reset();
  $("#taskModalTitle").textContent = "タスク登録";
  $("#taskId").value = "";
  selectedTypeId = "";
  selectedDueType = "today";
  $("#customDateWrap").hidden = true;
  updateChartModeHint();
  updateDueButtons();
  renderTypePicker();
}

function saveTaskFromForm(event) {
  event.preventDefault();
  const type = getTaskType(selectedTypeId);
  const chartNumber = type && type.chart_number_mode === "none" ? "" : normalizeChartNumber($("#chartNumber").value);
  if (type && type.chart_number_mode === "required" && !chartNumber) {
    alert("このタスク種別ではカルテ番号が必須です。");
    return;
  }

  const rawTitle = $("#taskTitle").value.trim();
  const dueDate = selectedDueType === "custom" ? $("#customDueDate").value || null : resolveDueDate(selectedDueType);
  const now = new Date().toISOString();
  const id = $("#taskId").value;
  const payload = {
    task_type_id: selectedTypeId,
    title: buildStoredTitle(rawTitle, chartNumber),
    chart_number: chartNumber,
    memo: $("#taskMemo").value.trim(),
    due_date: dueDate,
    priority: "normal",
    status: "active",
    archived: false
  };

  if (id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    Object.assign(task, payload);
  } else {
    state.tasks.unshift({
      id: cryptoId("task"),
      ...payload,
      created_at: now,
      completed_at: null
    });
  }
  persist();
  closeTaskModal();
  render();
  setView(activeView);
}

function handleTaskAction(action, taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const now = new Date().toISOString();

  if (action === "complete") {
    task.status = "completed";
    task.completed_at = now;
  }
  if (action === "reactivate") {
    task.status = "active";
    task.completed_at = null;
  }
  if (action === "edit") {
    openTaskModal(task);
    return;
  }
  if (action === "tomorrow") task.due_date = resolveDueDate("tomorrow");
  if (action === "next_week") task.due_date = resolveDueDate("next_week");
  if (action === "no_due") task.due_date = null;
  if (action === "delete") {
    if (!confirm("このタスクを削除しますか。完了履歴として残したい場合は削除ではなく完了にしてください。")) return;
    state.tasks = state.tasks.filter((item) => item.id !== taskId);
  }

  persist();
  render();
  setView(activeView);
}

function openTypeModal(type = null) {
  els.typeForm.reset();
  $("#typeId").value = "";
  $("#typeActive").checked = true;
  $("#typeDefaultDue").value = "today";
  $("#typeOrderTag").checked = false;
  $("#typeModalTitle").textContent = "タスク種別追加";

  if (type) {
    $("#typeModalTitle").textContent = "タスク種別編集";
    $("#typeId").value = type.id;
    $("#typeName").value = type.name;
    $("#typeChartMode").value = type.chart_number_mode;
    $("#typeDefaultDue").value = type.default_due_type;
    $("#typeOrderTag").checked = type.category_tags.includes(ORDER_TAG);
    $("#typeActive").checked = type.active;
  }
  els.typeModal.hidden = false;
  $("#typeName").focus();
}

function closeTypeModal() {
  els.typeModal.hidden = true;
}

function saveTypeFromForm(event) {
  event.preventDefault();
  const id = $("#typeId").value;
  const now = new Date().toISOString();
  const tags = $("#typeOrderTag").checked ? [ORDER_TAG] : [];
  const payload = {
    name: $("#typeName").value.trim(),
    chart_number_mode: $("#typeChartMode").value,
    default_due_type: $("#typeDefaultDue").value,
    active: $("#typeActive").checked,
    category_tags: tags,
    updated_at: now
  };
  if (!payload.name) return;

  if (id) {
    const type = getTaskType(id);
    if (!type) return;
    Object.assign(type, payload);
  } else {
    state.taskTypes.push({
      id: cryptoId("type"),
      ...payload,
      sort_order: nextSortOrder(),
      created_at: now
    });
  }

  renumberTypes();
  persist();
  closeTypeModal();
  render();
  setView("types");
}

function handleTypeAction(action, typeId) {
  const type = getTaskType(typeId);
  if (!type) return;
  const used = state.tasks.some((task) => task.task_type_id === typeId);

  if (action === "edit") {
    openTypeModal(type);
    return;
  }
  if (action === "toggle") {
    type.active = !type.active;
    type.updated_at = new Date().toISOString();
  }
  if (action === "delete") {
    // Used task types are hidden instead of removed, preserving historical task references.
    if (used) {
      if (!confirm("この種別は過去のタスクで使われています。履歴を壊さないため非表示にしますか。")) return;
      type.active = false;
      type.updated_at = new Date().toISOString();
    } else {
      if (!confirm("未使用のタスク種別を完全削除しますか。")) return;
      state.taskTypes = state.taskTypes.filter((item) => item.id !== typeId);
    }
  }
  if (action === "up" || action === "down") {
    moveType(typeId, action === "up" ? -1 : 1);
  }

  renumberTypes();
  persist();
  render();
  setView("types");
}

function moveType(typeId, delta) {
  const list = sortedTypes(true);
  const index = list.findIndex((type) => type.id === typeId);
  const targetIndex = index + delta;
  if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;
  const current = list[index];
  const target = list[targetIndex];
  [current.sort_order, target.sort_order] = [target.sort_order, current.sort_order];
  current.updated_at = new Date().toISOString();
  target.updated_at = new Date().toISOString();
}

function renumberTypes() {
  sortedTypes(true).forEach((type, index) => {
    type.sort_order = index + 1;
  });
}

function nextSortOrder() {
  return Math.max(0, ...state.taskTypes.map((type) => Number(type.sort_order) || 0)) + 1;
}

function exportJson() {
  if (!confirm("このデータにはカルテ番号が含まれます。外部共有や送信に注意してください。JSONを書き出しますか。")) {
    return;
  }
  const today = compactDate(new Date());
  const payload = {
    ...state,
    exported_at: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${today}_院内タスクボード_backup.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm("既存データを上書きします。先に現在のJSONを書き出してありますか。")) {
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result));
      state = normalizeState(imported, createInitialState());
      persist();
      render();
      setView("today");
      alert("JSONを読み込みました。");
    } catch (error) {
      alert("JSONを読み込めませんでした。ファイル内容を確認してください。");
      console.error(error);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function resetToInitialData() {
  if (!confirm("タスクとタスク種別を初期状態に戻します。現在のデータは上書きされます。実行前にJSONを書き出してください。")) return;
  state = createInitialState();
  persist();
  render();
  setView("today");
}

function isTodayWork(task) {
  return isOverdue(task) || isToday(task.due_date);
}

function isDueSoon(task) {
  if (!task.due_date) return false;
  const today = startOfDay(new Date());
  const due = parseLocalDate(task.due_date);
  const diff = Math.round((due - today) / 86400000);
  return diff <= 7;
}

function isOverdue(task) {
  if (!task.due_date || task.status === "completed") return false;
  return parseLocalDate(task.due_date) < startOfDay(new Date());
}

function isToday(dateString) {
  return dateString === toDateInputValue(new Date());
}

function isOrderTask(task) {
  const type = getTaskType(task.task_type_id);
  return Boolean(type && type.category_tags.includes(ORDER_TAG));
}

function isLaterTask(task) {
  const type = getTaskType(task.task_type_id);
  return !task.due_date || !task.task_type_id || (type && type.name === "その他");
}

function compareTasks(a, b) {
  if (!a.due_date && b.due_date) return 1;
  if (a.due_date && !b.due_date) return -1;
  if (a.due_date !== b.due_date) return String(a.due_date || "").localeCompare(String(b.due_date || ""));
  return String(b.created_at).localeCompare(String(a.created_at));
}

function resolveDueDate(dueType) {
  const date = startOfDay(new Date());
  if (dueType === "today") return toDateInputValue(date);
  if (dueType === "tomorrow") {
    date.setDate(date.getDate() + 1);
    return toDateInputValue(date);
  }
  if (dueType === "this_week") {
    const day = date.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7;
    date.setDate(date.getDate() + daysUntilSaturday);
    return toDateInputValue(date);
  }
  if (dueType === "next_week") {
    const day = date.getDay();
    const daysUntilNextFriday = ((5 - day + 7) % 7) + 7;
    date.setDate(date.getDate() + daysUntilNextFriday);
    return toDateInputValue(date);
  }
  return null;
}

function dueTypeLabel(dueType) {
  return {
    today: "今日",
    tomorrow: "明日",
    this_week: "今週中",
    next_week: "来週",
    none: "期限なし"
  }[dueType] || "今日";
}

function formatDue(dateString) {
  if (!dateString) return "期限なし";
  if (isToday(dateString)) return "今日";
  const tomorrow = startOfDay(new Date());
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateString === toDateInputValue(tomorrow)) return "明日";
  return dateString.replaceAll("-", "/");
}

function buildStoredTitle(title, chartNumber) {
  const cleanTitle = title.trim() || "名称未設定";
  return chartNumber ? `#${chartNumber} ${cleanTitle}` : cleanTitle;
}

function normalizeChartNumber(value) {
  return value.trim().replace(/[^\dA-Za-z-]/g, "");
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compactDate(date) {
  return toDateInputValue(date).replaceAll("-", "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cryptoId(prefix) {
  if (window.crypto && window.crypto.randomUUID) {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service Worker registration failed", error);
    });
  });
}
