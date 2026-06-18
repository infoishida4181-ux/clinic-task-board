const storage = window.ClinicTaskStorage;
const APP_VERSION = "2026-06-17-single-user-sync";
const syncManager = window.ClinicTaskSync.createSyncManager({
  storage,
  supabase: window.ClinicTaskSupabase
});
const NEW_TASK_DEFAULT_DUE_TYPE = "custom";
const TYPE_DEFAULT_DUE_TYPES = new Set(["today", "tomorrow", "this_week", "next_week"]);

let state = storage.loadLocalState();
storage.saveLocalState(state);
let activeView = "today";
let selectedTypeId = "";
let selectedDueType = NEW_TASK_DEFAULT_DUE_TYPE;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  counts: {
    today: $("#countToday"),
    all: $("#countAll"),
    overdue: $("#countOverdue"),
    order: $("#countOrder"),
    patient: $("#countPatient"),
    admin: $("#countAdmin"),
    later: $("#countLater")
  },
  lists: {
    today: $("#todayList"),
    all: $("#allList"),
    soon: $("#soonList"),
    patient: $("#patientList"),
    order: $("#orderList"),
    admin: $("#adminList"),
    later: $("#laterList"),
    completed: $("#completedList")
  },
  taskModal: $("#taskModal"),
  typeModal: $("#typeModal"),
  taskForm: $("#taskForm"),
  typeForm: $("#typeForm"),
  typePicker: $("#typePicker"),
  typeList: $("#typeList"),
  saveModeBadge: $("#saveModeBadge"),
  syncNotice: $("#syncNotice"),
  loginStatusText: $("#loginStatusText"),
  syncErrorDetail: $("#syncErrorDetail")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  renderAppVersion();
  await tryInitialCloudLoad();
  render();
  disableServiceWorkerAndCaches();
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
  $("#loginButton").addEventListener("click", loginToSupabase);
  $("#logoutButton").addEventListener("click", logoutFromSupabase);
  $("#migrateButton").addEventListener("click", migrateLocalToSupabase);
  $("#reloadSupabaseButton").addEventListener("click", reloadFromSupabase);
  $("#connectionTestButton").addEventListener("click", runSupabaseConnectionTest);
  $("#restoreInitialTypesButton").addEventListener("click", restoreInitialTaskTypes);

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

function renderAppVersion() {
  const versionText = $("#appVersionText");
  if (versionText) {
    versionText.textContent = `Version: ${APP_VERSION}`;
  }
}

async function tryInitialCloudLoad() {
  const status = syncManager.getStatus();
  if (!status.configured || !status.hasSession) return;
  // Single-user clinic mode: an existing Auth session is treated as the device sync credential.
  // loadFromSupabase refreshes JWTs, merges remote data, sends pending edits, and retries pending deletes.
  state = await syncManager.loadFromSupabase(state);
}

async function saveState() {
  state = storage.normalizeState(state);
  const result = await syncManager.save(state);
  if (result && result.state) {
    state = result.state;
  }
  renderSyncStatus();
  return result;
}

function render() {
  renderCounts();
  renderTaskLists();
  renderTypePicker();
  renderTypeList();
  updateDueButtons();
  renderSyncStatus();
}

function renderSyncStatus() {
  const status = syncManager.getStatus();
  const labelMap = {
    local: "保存：この端末のみ",
    not_logged_in: "保存：この端末のみ",
    expired: "保存：ログイン期限切れ・端末内一時保存",
    supabase: "保存：Supabase同期中",
    offline: "保存：オフライン一時保存",
    failed: "保存：Supabase保存失敗・端末内一時保存"
  };
  const label = labelMap[status.status] || "保存：この端末のみ";
  const pendingCount = countPendingTasks();
  const pendingDeleteCount = countPendingDeletes();
  els.saveModeBadge.textContent = label;
  els.loginStatusText.textContent = loginStatusLabel(status);
  els.syncNotice.classList.toggle("is-supabase", status.status === "supabase");
  els.syncNotice.classList.toggle("is-offline", status.status === "offline");
  els.syncNotice.classList.toggle("is-failed", status.status === "failed");
  els.syncNotice.classList.toggle("is-expired", status.status === "expired");
  els.syncNotice.innerHTML = `
    <strong>${escapeHtml(label)}</strong>
    <span>${escapeHtml(syncStatusMessage(status, pendingCount, pendingDeleteCount))}</span>
  `;
  const pendingText = $("#pendingSyncText");
  if (pendingText) {
    pendingText.textContent = `未同期タスク：${pendingCount}件 / 削除待ちタスク：${pendingDeleteCount}件`;
  }
  renderSyncErrorDetail(status);
}

function syncStatusMessage(status, pendingCount, pendingDeleteCount) {
  const pendingText = pendingCount ? ` 未同期タスク：${pendingCount}件。` : "";
  const deleteText = pendingDeleteCount ? ` 削除待ちタスク：${pendingDeleteCount}件。` : "";
  if (status.status === "supabase") return `初回ログイン後の自動同期モードです。変更は端末内に保存してからSupabaseへ同期します。${pendingText}${deleteText}`;
  if (status.status === "expired") return `ログイン期限が切れました。詳細設定から再ログインしてください。タスクはこの端末内に一時保存されています。${pendingText}${deleteText}`;
  if (status.status === "failed") return `Supabase保存に失敗しました。タスクはこの端末内に一時保存されています。詳細は詳細設定で確認できます。${pendingText}${deleteText}`;
  if (status.status === "offline") return "Supabase接続に失敗しました。この端末内の保存で継続します。";
  if (status.status === "not_logged_in") return "詳細設定から初回ログインしてください。ログイン後はこの端末で自動同期します。";
  return "Supabase設定がないため、これまで通りlocalStorageだけで動作します。";
}

function loginStatusLabel(status) {
  if (!status.configured) return "Supabase未設定";
  if (status.expired || status.status === "expired") return `ログイン期限切れ：再ログインしてください${status.email ? `（${status.email}）` : ""}`;
  if (status.loggedIn) return `ログイン中：${status.email}`;
  return "未ログイン";
}

function renderSyncErrorDetail(status) {
  if (!els.syncErrorDetail) return;
  if (!status.lastError && !status.lastErrorDetail) {
    els.syncErrorDetail.textContent = "";
    return;
  }
  const detail = status.lastErrorDetail;
  const lines = ["同期エラー詳細"];
  if (status.lastError) lines.push(status.lastError);
  if (detail && detail.status) lines.push(`HTTP status：${detail.status}`);
  if (detail && detail.message) lines.push(`message：${detail.message}`);
  if (detail && detail.details) lines.push(`details：${detail.details}`);
  if (detail && detail.hint) lines.push(`hint：${detail.hint}`);
  if (detail && detail.path) lines.push(`path：${detail.path}`);
  els.syncErrorDetail.textContent = lines.join("\n");
}

function countPendingTasks() {
  return state.tasks.filter((task) => !isDeletedTask(task) && (task.pendingSync || task.sync_error)).length;
}

function countPendingDeletes() {
  return state.tasks.filter((task) => task.pendingDelete).length;
}

function setView(view) {
  activeView = view;
  $$(".tab-button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  $$(".view-panel").forEach((panel) => panel.classList.toggle("is-active", panel.id === `view-${view}`));
}

function activeTasks() {
  // Every active list starts here so completed, archived, and deleted tombstone tasks stay out of tabs and counts.
  return state.tasks.filter((task) => task.status === "active" && !task.archived && !isDeletedTask(task));
}

function completedTasks() {
  return state.tasks.filter((task) => task.status === "completed" && !task.archived && !isDeletedTask(task));
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
  els.counts.all.textContent = tasks.length;
  els.counts.overdue.textContent = tasks.filter(isOverdue).length;
  els.counts.order.textContent = tasks.filter(isOrderTask).length;
  els.counts.patient.textContent = tasks.filter(isPatientViewTask).length;
  els.counts.admin.textContent = tasks.filter(isAdminTask).length;
  els.counts.later.textContent = tasks.filter(isLaterTask).length;
}

function renderTaskLists() {
  const tasks = activeTasks();
  renderTaskList(els.lists.today, tasks.filter(isTodayWork));
  // 全未完了 is a unique task list from the task source itself, not a sum of category tabs.
  renderTaskList(els.lists.all, tasks, false, compareAllIncompleteTasks);
  renderTaskList(els.lists.soon, tasks.filter(isDueSoon));
  renderTaskList(els.lists.patient, tasks.filter(isPatientViewTask));
  renderTaskList(els.lists.order, tasks.filter(isOrderTask));
  renderTaskList(els.lists.admin, tasks.filter(isAdminTask));
  renderTaskList(els.lists.later, tasks.filter(isLaterTask));
  renderTaskList(els.lists.completed, completedTasks(), true);
}

function renderTaskList(container, tasks, completed = false, comparator = compareTasks) {
  const sorted = tasks.slice().sort(comparator);
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
  if (!types.length) {
    els.typePicker.innerHTML = `
      <div class="empty-state type-picker-warning">
        タスク種別が登録されていません。設定画面から初期タスク種別を復元してください。
      </div>
    `;
    return;
  }
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
  const usedTypeIds = new Set(state.tasks.filter((task) => !isDeletedTask(task)).map((task) => task.task_type_id).filter(Boolean));
  els.typeList.innerHTML = sortedTypes(true).map((type, index, list) => {
    const isUsed = usedTypeIds.has(type.id);
    const chartLabel = { required: "カルテ必須", optional: "カルテ任意", none: "カルテ不要" }[type.chart_number_mode];
    const orderLabel = isSupplyType(type) ? "発注・準備" : "通常";
    const patientLabel = isPatientViewType(type) ? "患者関連" : "";
    const adminLabel = isAdminType(type) ? "事務系" : "";
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
          ${patientLabel ? `<span class="due-chip">${patientLabel}</span>` : ""}
          ${adminLabel ? `<span class="due-chip">${adminLabel}</span>` : ""}
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
  chooseDueType(initialDueTypeForTaskType(type));
  updateChartModeHint();
  renderTypePicker();
  guideAfterTypeSelection(type);
}

function guideAfterTypeSelection(type) {
  const chartInput = $("#chartNumber");
  const duePicker = $(".due-picker");
  if (type.chart_number_mode === "required") {
    chartInput.focus();
    chartInput.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  if (type.chart_number_mode === "none") {
    duePicker.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function chooseDueType(dueType) {
  selectedDueType = dueType;
  $("#customDateWrap").hidden = dueType !== "custom";
  setDueDateWarning("");
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
    $("#chartModeHint").textContent = "この種別ではカルテ番号を保存しません。期限を選んで保存できます。";
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

  if (task) {
    $("#taskTitle").focus();
    return;
  }
  // New tasks default to date picking, but chairside entry starts at task-type buttons.
  // Avoid focusing date/text inputs so mobile date pickers or keyboards do not open unexpectedly.
  setTimeout(() => {
    els.typePicker.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 0);
}

function closeTaskModal() {
  els.taskModal.hidden = true;
}

function resetTaskForm() {
  els.taskForm.reset();
  $("#taskModalTitle").textContent = "タスク登録";
  $("#taskId").value = "";
  selectedTypeId = "";
  // Most clinic tasks need a due date; require an explicit date or an explicit "期限なし" choice.
  selectedDueType = NEW_TASK_DEFAULT_DUE_TYPE;
  $("#customDateWrap").hidden = false;
  setDueDateWarning("");
  updateChartModeHint();
  updateDueButtons();
  renderTypePicker();
}

async function saveTaskFromForm(event) {
  event.preventDefault();
  const type = getTaskType(selectedTypeId);
  const chartNumber = type && type.chart_number_mode === "none" ? "" : normalizeChartNumber($("#chartNumber").value);
  if (type && type.chart_number_mode === "required" && !chartNumber) {
    alert("このタスク種別ではカルテ番号が必須です。");
    return;
  }

  const rawTitle = $("#taskTitle").value.trim();
  const dueResult = resolveDueDateForSave();
  if (!dueResult.ok) {
    // A blank custom date creates accidental no-due tasks, so stop before localStorage/Supabase writes.
    setDueDateWarning(dueResult.message);
    return;
  }
  const dueDate = dueResult.dueDate;
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
    archived: false,
    updated_at: now,
    synced: false,
    pendingSync: shouldQueueSupabaseChange(),
    sync_error: ""
  };

  if (id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) return;
    Object.assign(task, payload);
  } else {
    state.tasks.unshift({
      id: storage.cryptoId("task"),
      user_id: null,
      ...payload,
      created_at: now,
      completed_at: null
    });
  }
  const saveResult = await saveState();
  closeTaskModal();
  render();
  setView(activeView);
  notifySaveFailure(saveResult);
}

async function handleTaskAction(action, taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const now = new Date().toISOString();

  if (action === "complete") {
    task.status = "completed";
    task.completed_at = now;
    task.updated_at = now;
    markTaskPending(task);
  }
  if (action === "reactivate") {
    task.status = "active";
    task.completed_at = null;
    task.updated_at = now;
    markTaskPending(task);
  }
  if (action === "edit") {
    openTaskModal(task);
    return;
  }
  if (action === "tomorrow") {
    task.due_date = resolveDueDate("tomorrow");
    task.updated_at = now;
    markTaskPending(task);
  }
  if (action === "next_week") {
    task.due_date = resolveDueDate("next_week");
    task.updated_at = now;
    markTaskPending(task);
  }
  if (action === "no_due") {
    task.due_date = null;
    task.updated_at = now;
    markTaskPending(task);
  }
  if (action === "delete") {
    if (!confirm("このタスクを削除しますか。完了履歴として残したい場合は削除ではなく完了にしてください。")) return;
    markTaskDeleted(task, now);
  }

  const saveResult = await saveState();
  render();
  setView(activeView);
  notifySaveFailure(saveResult);
}

function markTaskPending(task) {
  if (!shouldQueueSupabaseChange()) return;
  task.synced = false;
  task.pendingSync = true;
  task.pendingDelete = false;
  task.sync_error = "";
}

function markTaskDeleted(task, now = new Date().toISOString()) {
  task.deleted_at = now;
  task.pendingDelete = shouldQueueSupabaseChange();
  task.pendingSync = false;
  task.synced = false;
  task.updated_at = now;
  task.sync_error = "";
}

function shouldQueueSupabaseChange() {
  const status = syncManager.getStatus();
  return Boolean(status.hasSession);
}

function initialDueTypeForTaskType(type) {
  if (type && TYPE_DEFAULT_DUE_TYPES.has(type.default_due_type)) {
    return type.default_due_type;
  }
  return NEW_TASK_DEFAULT_DUE_TYPE;
}

function resolveDueDateForSave() {
  if (selectedDueType === "custom") {
    const dueDate = $("#customDueDate").value || "";
    if (!dueDate) {
      return {
        ok: false,
        message: "期限日を選択してください。期限なしで登録する場合は『期限なし』を選択してください。"
      };
    }
    return { ok: true, dueDate };
  }
  return { ok: true, dueDate: resolveDueDate(selectedDueType) };
}

function setDueDateWarning(message) {
  const hint = $("#dueDateHint");
  if (hint) hint.textContent = message;
}

function openTypeModal(type = null) {
  els.typeForm.reset();
  $("#typeId").value = "";
  $("#typeActive").checked = true;
  $("#typeDefaultDue").value = "today";
  $("#typeOrderTag").checked = false;
  $("#typePatientView").checked = false;
  $("#typeAdminRelated").checked = false;
  $("#typeModalTitle").textContent = "タスク種別追加";

  if (type) {
    $("#typeModalTitle").textContent = "タスク種別編集";
    $("#typeId").value = type.id;
    $("#typeName").value = type.name;
    $("#typeChartMode").value = type.chart_number_mode;
    $("#typeDefaultDue").value = type.default_due_type;
    $("#typeOrderTag").checked = isSupplyType(type);
    $("#typePatientView").checked = isPatientViewType(type);
    $("#typeAdminRelated").checked = isAdminType(type);
    $("#typeActive").checked = type.active;
  }
  els.typeModal.hidden = false;
  $("#typeName").focus();
}

function closeTypeModal() {
  els.typeModal.hidden = true;
}

async function saveTypeFromForm(event) {
  event.preventDefault();
  const id = $("#typeId").value;
  const now = new Date().toISOString();
  const isSupply = $("#typeOrderTag").checked;
  const isPatient = $("#typePatientView").checked;
  const isAdmin = $("#typeAdminRelated").checked;
  const payload = {
    name: $("#typeName").value.trim(),
    chart_number_mode: $("#typeChartMode").value,
    default_due_type: $("#typeDefaultDue").value,
    active: $("#typeActive").checked,
    is_supply_related: isSupply,
    is_patient_view: isPatient,
    is_admin_related: isAdmin,
    category_tags: isSupply ? [storage.ORDER_TAG] : [],
    updated_at: now
  };
  if (!payload.name) return;

  if (id) {
    const type = getTaskType(id);
    if (!type) return;
    Object.assign(type, payload);
  } else {
    state.taskTypes.push({
      id: storage.cryptoId("type"),
      user_id: null,
      ...payload,
      sort_order: nextSortOrder(),
      created_at: now
    });
  }

  renumberTypes();
  await saveState();
  closeTypeModal();
  render();
  setView("types");
}

async function handleTypeAction(action, typeId) {
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
  await saveState();
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
  reader.onload = async () => {
    try {
      const imported = JSON.parse(String(reader.result));
      state = storage.normalizeState(imported, storage.createInitialState());
      await saveState();
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

async function resetToInitialData() {
  if (!confirm("タスクとタスク種別を初期状態に戻します。現在のデータは上書きされます。実行前にJSONを書き出してください。")) return;
  state = storage.createInitialState();
  await saveState();
  render();
  setView("today");
}

async function loginToSupabase() {
  try {
    await syncManager.signIn($("#loginEmail").value.trim(), $("#loginPassword").value);
    $("#loginPassword").value = "";
    state = await syncManager.loadFromSupabase(state);
    render();
    alert("Supabaseにログインしました。");
  } catch (error) {
    alert(error.message);
    renderSyncStatus();
  }
}

async function logoutFromSupabase() {
  try {
    await syncManager.signOut();
    renderSyncStatus();
  } catch (error) {
    alert(error.message);
  }
}

async function migrateLocalToSupabase() {
  if (!confirm("localStorageデータをSupabaseへ移行します。このデータにはカルテ番号が含まれます。AuthとRLSが有効な空または移行先として問題ない環境ですか。")) {
    return;
  }
  try {
    state = await syncManager.migrateLocalToSupabase(state);
    render();
    alert("Supabaseへ移行し、再読み込みしました。");
  } catch (error) {
    alert(error.message);
    renderSyncStatus();
  }
}

async function restoreInitialTaskTypes() {
  if (!confirm("初期タスク種別を復元します。同名の種別は重複作成せず、不足分だけ追加します。非表示の初期種別は表示に戻しますか。")) {
    return;
  }
  const result = storage.restoreInitialTaskTypes(state, { reactivate: true });
  state = result.state;
  await saveState();
  render();
  setView("types");
  alert(`初期タスク種別を確認しました。追加：${result.added}件、表示に戻した種別：${result.reactivated}件`);
}

async function reloadFromSupabase() {
  if (!confirm("Supabaseの内容で画面を再読み込みします。現在のlocalStorageデータはキャッシュとして上書きされます。")) {
    return;
  }
  state = await syncManager.loadFromSupabase(state);
  render();
}

async function runSupabaseConnectionTest() {
  const resultBox = $("#connectionTestResult");
  resultBox.textContent = "Supabase接続テスト中...";
  const result = await syncManager.runConnectionTest();
  renderSyncStatus();
  if (result.ok) {
    resultBox.textContent = [
      "接続テストOK",
      `セッション更新：${result.result.sessionRefresh ? "OK" : "不要"}`,
      `ログインユーザーID：${result.result.userId}`,
      `メール：${result.result.email || ""}`,
      "task_types select OK",
      "tasks select OK",
      "tasks test insert OK",
      "tasks test delete OK"
    ].join("\n");
    return;
  }
  resultBox.textContent = [
    result.error && result.error.loginExpired ? "ログイン期限切れ。再ログインしてください。" : "接続テスト失敗",
    `HTTP status：${result.error && result.error.status ? result.error.status : ""}`,
    `message：${result.error && result.error.message ? result.error.message : ""}`,
    `details：${result.error && result.error.details ? result.error.details : ""}`,
    `hint：${result.error && result.error.hint ? result.error.hint : ""}`,
    `path：${result.error && result.error.path ? result.error.path : ""}`
  ].join("\n");
}

function notifySaveFailure(saveResult) {
  if (!saveResult || saveResult.ok !== false) return;
  const status = syncManager.getStatus();
  if (!status.configured || (!status.hasSession && !status.expired)) return;
  if (saveResult.reason === "local" || saveResult.reason === "not_logged_in") return;
  if (saveResult.reason === "expired" || status.expired) {
    alert(`ログイン期限が切れました。再ログインしてください。\n未同期タスクと削除待ちタスクはこの端末に保持しています。`);
    return;
  }
  const hasPendingDelete = state.tasks.some((task) => task.pendingDelete);
  if (hasPendingDelete) {
    alert(`Supabase削除に失敗しました。端末内では削除済みとして保持し、次回同期時に再試行します。\n${syncManager.getStatus().lastError || ""}`);
    return;
  }
  alert(`Supabase保存失敗。タスクはこの端末に未同期として残しました。\n${syncManager.getStatus().lastError || ""}`);
}

function isDeletedTask(task) {
  return Boolean(task && (task.deleted_at || task.pendingDelete));
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

function isSupplyType(type) {
  return Boolean(type && (type.is_supply_related || (Array.isArray(type.category_tags) && type.category_tags.includes(storage.ORDER_TAG))));
}

function isOrderTask(task) {
  return isSupplyType(getTaskType(task.task_type_id));
}

function isPatientViewType(type) {
  return Boolean(type && type.is_patient_view);
}

function isAdminType(type) {
  return Boolean(type && type.is_admin_related);
}

function isAdminTask(task) {
  // Administrative grouping is an explicit type flag, independent from chart number and due date.
  return isAdminType(getTaskType(task.task_type_id));
}

function isPatientViewTask(task) {
  const type = getTaskType(task.task_type_id);
  // Patient view is an explicit master flag; a required chart number alone does not make it patient-view.
  return isPatientViewType(type) && !isSupplyType(type);
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

function compareAllIncompleteTasks(a, b) {
  const rankDiff = incompleteRank(a) - incompleteRank(b);
  if (rankDiff) return rankDiff;
  const dueA = a.due_date || "9999-12-31";
  const dueB = b.due_date || "9999-12-31";
  if (dueA !== dueB) return dueA.localeCompare(dueB);
  const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority);
  if (priorityDiff) return priorityDiff;
  return String(a.created_at || "").localeCompare(String(b.created_at || ""));
}

function incompleteRank(task) {
  if (isOverdue(task)) return 0;
  if (isToday(task.due_date)) return 1;
  if (task.due_date === toDateInputValue(addDays(startOfDay(new Date()), 1))) return 2;
  if (task.due_date && parseLocalDate(task.due_date) <= endOfThisWeek()) return 3;
  if (task.due_date) return 4;
  return isLaterTask(task) ? 6 : 5;
}

function priorityRank(priority) {
  return { high: 0, normal: 1, low: 2 }[priority] ?? 1;
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

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function endOfThisWeek() {
  const date = startOfDay(new Date());
  const day = date.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7;
  date.setDate(date.getDate() + daysUntilSaturday);
  return date;
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

async function disableServiceWorkerAndCaches() {
  // During Supabase sync debugging, avoid stale GitHub Pages/PWA assets.
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("Service Worker/cache cleanup failed", error);
  }
}
