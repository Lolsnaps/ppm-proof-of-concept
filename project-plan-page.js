"use strict";

const params = new URLSearchParams(location.search);
const projectCode = params.get("code") || "";
let project = null;
let tasks = [];
let dirty = false;
let dirtyIds = new Set();
let editingDependencyTaskId = "";
let pendingDeleteId = "";
let dependencyDraft = [];
let projectArchived = false;
let originalTasks = new Map();
let pendingFocusTaskId = params.get("view") === "baseline" ? "" : params.get("item") || "";
let baselineDeepLinkHandled = false;
const configuredValues = (category) =>
  window.PPMAdmin ? PPMAdmin.getReferenceValues(category).map((row) => row.value) : [];
const phases = [
  ...new Set([
    ...(window.PPMAdmin ? PPMAdmin.projectStages({}).map((stage) => stage.name) : []),
    "Requirements",
    "Design",
    "Ready and Implement"
  ])
];
const types = ["Phase", "Deliverable", "Milestone", "Task", "Subtask"];
const statuses = [...new Set([...configuredValues("taskStatuses"), "On Hold", "Not Applicable"])];
const priorities = [
  ...new Set(
    configuredValues("priorities").length
      ? configuredValues("priorities")
      : ["Low", "Medium", "High", "Critical"]
  )
];
const escapeHtml = PPMCore.escapeHtml;

/*
  Bar positions, timeline width, row indents and the dependency overlay's box are all
  computed from dates and hierarchy, so they cannot be classes. style-src 'self'
  blocks style attributes, so they are emitted as data and applied through CSSOM.

  The dependency overlay is why this mattered most: .timeline-dependencies is
  position:absolute;inset:0 in the stylesheet and took its box from the inline
  left/top/width/height. With those dropped, and .timeline's position:relative dropped
  with them, the SVG sized itself against a distant ancestor and its viewBox stretched
  every dependency link across the whole page as stray red and purple lines.
*/
const styleAttr = PPMCore.styleAttribute;
function readProjects() {
  const rows = PPMPlanning.read("projects", []);
  return Array.isArray(rows) ? rows : [];
}
function readPlans() {
  const value = PPMPlanning.read("plans", {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
async function savePlans() {
  if (projectArchived) {
    return { ok: false, reason: "denied", message: "Archived projects are read-only." };
  }
  const store = readPlans();
  store[projectCode] = tasks;
  return PPMPlanning.write("plans", store);
}
function showMessage(text, type = "success") {
  const box = document.getElementById("pageMessage");
  box.textContent = text;
  box.className = `message ${type}`;
  scrollTo({ top: 0, behavior: "smooth" });
}
function clearMessage() {
  const box = document.getElementById("pageMessage");
  box.textContent = "";
  box.className = "message";
}
function optionMarkup(values, selected, blank) {
  return (
    (blank !== undefined ? `<option value="">${escapeHtml(blank)}</option>` : "") +
    values
      .map(
        (v) =>
          `<option value="${escapeHtml(v)}"${v === selected ? " selected" : ""}>${escapeHtml(v)}</option>`
      )
      .join("")
  );
}
function resourceOptions(selectedIds, multiple = false) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [selectedIds];
  return `${multiple ? "" : '<option value="">Select an owner</option>'}${PPMResources.getResources()
    .filter((r) => r.active !== false || ids.includes(r.resourceId))
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)))
    .map(
      (r) =>
        `<option value="${escapeHtml(r.resourceId)}"${ids.includes(r.resourceId) ? " selected" : ""}>${escapeHtml(PPMResources.optionLabel(r))}</option>`
    )
    .join("")}`;
}
function dateEnd(start, duration) {
  if (!start && duration !== 0) return "";
  if (Number(duration) === 0) return start || "";
  let date = PPMPlanning.parseDate(start),
    remaining = Math.max(0, Math.ceil(Number(duration || 0)) - 1);
  if (!date) return "";
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (![0, 6].includes(date.getDay())) remaining--;
  }
  return PPMPlanning.isoDate(date);
}
function currentBaseline() {
  return PPMPlanning.latestApprovedBaseline(projectCode);
}
function approvedTaskBaseline(taskId) {
  const row = PPMPlanning.baselineTaskRecord(projectCode, taskId);
  return row || null;
}
function hierarchyIndent(task) {
  const depth = PPMPlanning.hierarchyDepth(tasks, task.taskId);
  return Number.isFinite(depth) ? Math.min(depth, 8) : 0;
}
function descendants(taskId) {
  const found = new Set();
  const visit = (id) =>
    tasks
      .filter((t) => t.parentTaskId === id)
      .forEach((child) => {
        found.add(child.taskId);
        visit(child.taskId);
      });
  visit(taskId);
  return found;
}
function parentOptions(task) {
  const blocked = descendants(task.taskId);
  return (
    '<option value="">No parent</option>' +
    tasks
      .filter((row) => row.taskId !== task.taskId && !blocked.has(row.taskId) && row.taskType !== "Milestone")
      .map(
        (row) =>
          `<option value="${escapeHtml(row.taskId)}"${row.taskId === task.parentTaskId ? " selected" : ""}>${escapeHtml(row.taskName || row.taskId)}</option>`
      )
      .join("")
  );
}
function selectedValues(select) {
  return [...select.selectedOptions].map((o) => o.value).filter(Boolean);
}
function markDirty(taskId) {
  dirty = true;
  dirtyIds.add(taskId);
  const button = document.getElementById("savePlanButton");
  button.disabled = projectArchived ? true : false;
  button.textContent = "Save changes";
  document.getElementById("unsavedIndicator").textContent = "Unsaved changes";
  document.getElementById("unsavedIndicator").classList.add("dirty");
}
function setClean() {
  dirty = false;
  dirtyIds = new Set();
  document.getElementById("savePlanButton").disabled = true;
  document.getElementById("savePlanButton").textContent = projectArchived ? "Read-only" : "Saved";
  document.getElementById("unsavedIndicator").textContent = projectArchived
    ? "Archived - read-only"
    : "All changes saved";
  document.getElementById("unsavedIndicator").classList.remove("dirty");
}
function filteredTasks() {
  const search = document.getElementById("taskSearch").value.trim().toLowerCase(),
    phase = document.getElementById("phaseFilter").value,
    type = document.getElementById("typeFilter").value,
    status = document.getElementById("statusFilter").value,
    owner = document.getElementById("ownerFilter").value,
    view = document.getElementById("planView").value;
  return tasks.filter((task) => {
    const text = [task.taskName, task.deliverable, task.taskOwner, task.notes, task.phase]
      .join(" ")
      .toLowerCase();
    return (
      (!search || text.includes(search)) &&
      (!phase || task.phase === phase) &&
      (!type || task.taskType === type) &&
      (!status || task.status === status) &&
      (!owner || task.taskOwnerResourceId === owner) &&
      (view !== "milestones" || task.taskType === "Milestone") &&
      (view !== "critical" || task.criticalPath)
    );
  });
}
function slippage(task) {
  return PPMPlanning.slippageResult(projectCode, task);
}
function renderTable() {
  PPMPlanning.calculateParentProgress(tasks);
  const critical = PPMPlanning.calculateCriticalPath(tasks);
  const conflictMap = new Map(PPMPlanning.dependencyConflicts(tasks).map((c) => [c.taskId, c]));
  const rows = filteredTasks();
  const body = document.getElementById("taskTableBody");
  const baseline = currentBaseline();
  body.innerHTML = rows
    .map((task) => {
      const slip = slippage(task),
        approved = approvedTaskBaseline(task.taskId),
        indent = hierarchyIndent(task),
        isMilestone = task.taskType === "Milestone";
      return `<tr data-task-id="${escapeHtml(task.taskId)}" class="${dirtyIds.has(task.taskId) ? "dirty-row " : ""}${isMilestone ? "milestone-row " : ""}${task.criticalPath ? "critical-row " : ""}${slip.slipped ? "slipped-row " : ""}${conflictMap.has(task.taskId) ? "dependency-conflict" : ""}"><td class="sticky-task"><div class="cell-stack"><select class="inline-field" data-field="taskType">${optionMarkup(types, task.taskType)}</select><div class="task-name-wrap"${styleAttr(`padding-left:${indent * 18}px`)}><span class="hierarchy-marker">${isMilestone ? "◆" : indent ? "↳" : "●"}</span><input class="inline-field inline-task" data-field="taskName" value="${escapeHtml(task.taskName)}" placeholder="Enter plan item"></div><label class="inline-note"><input class="inline-field inline-checkbox" data-field="mandatory" type="checkbox"${task.mandatory !== false ? " checked" : ""}> Mandatory child item</label></div></td>
<td><select class="inline-field inline-parent" data-field="parentTaskId">${parentOptions(task)}</select></td>
<td><div class="cell-stack"><select class="inline-field" data-field="phase">${optionMarkup(phases, task.phase || "Discovery")}</select><input class="inline-field" data-field="deliverable" value="${escapeHtml(task.deliverable || "")}" placeholder="Deliverable"></div></td>
<td><select class="inline-field inline-person" data-field="taskOwnerResourceId">${resourceOptions(task.taskOwnerResourceId)}</select></td>
<td><select class="inline-field inline-contributors" data-field="supportingContributorIds" multiple>${resourceOptions(task.supportingContributorIds, true)}</select></td>
<td><select class="inline-field" data-field="priority">${optionMarkup(priorities, task.priority || "Medium")}</select></td>
<td><div class="cell-stack"><span class="field-caption">Working days</span><input class="inline-field inline-number" data-field="durationDays" type="number" min="0" step=".5" value="${escapeHtml(isMilestone ? 0 : (task.durationDays ?? 1))}"${isMilestone ? " disabled" : ""}><span class="field-caption">Allocation %</span><input class="inline-field inline-number" data-field="allocationPercentage" type="number" min="0" max="200" value="${escapeHtml(task.allocationPercentage ?? 100)}"></div></td>
<td><div class="cell-stack"><div class="cell-pair"><input class="inline-field inline-date" data-field="baselineStartDate" type="date" value="${escapeHtml(task.baselineStartDate || "")}"${baseline ? " disabled" : ""}><input class="inline-field inline-date" data-field="baselineEndDate" type="date" value="${escapeHtml(task.baselineEndDate || "")}"${baseline ? " disabled" : ""}></div>${approved ? `<span class="badge plum">Approved v${baseline.version}: ${escapeHtml(approved.baselineStartDate)} to ${escapeHtml(approved.baselineEndDate)}</span>` : '<span class="field-caption">Awaiting approval</span>'}</div></td>
<td><div class="cell-pair"><input class="inline-field inline-date" data-field="forecastStartDate" type="date" value="${escapeHtml(task.forecastStartDate || "")}"><input class="inline-field inline-date" data-field="forecastEndDate" type="date" value="${escapeHtml(task.forecastEndDate || "")}" readonly></div>${slip.slipped ? `<span class="slippage-alert">${slip.critical ? "CRITICAL PATH - " : ""}${slip.daysLate} day(s) beyond approved baseline</span>` : ""}</td>
<td><div class="cell-pair"><input class="inline-field inline-date" data-field="actualStartDate" type="date" value="${escapeHtml(task.actualStartDate || "")}"><input class="inline-field inline-date" data-field="actualEndDate" type="date" value="${escapeHtml(task.actualEndDate || "")}"></div></td>
<td><div class="cell-stack"><span class="field-caption">Estimated hours</span><input class="inline-field inline-number" data-field="estimatedEffortHours" type="number" min="0" step=".5" value="${escapeHtml(task.estimatedEffortHours ?? "")}"><span class="field-caption">Remaining hours</span><input class="inline-field inline-number" data-field="remainingEffortHours" type="number" min="0" step=".5" value="${escapeHtml(task.remainingEffortHours ?? "")}"></div></td>
<td><div class="cell-stack"><select class="inline-field" data-field="status">${optionMarkup(statuses, task.status || "Not Started")}</select><input class="inline-field inline-number" data-field="percentageComplete" type="number" min="0" max="100" value="${escapeHtml(task.percentageComplete ?? 0)}"></div></td>
<td><button type="button" class="button light small dependency-button ${conflictMap.has(task.taskId) ? "has-conflict" : ""}" data-action="dependencies">${(task.dependencies || []).length} link(s)${conflictMap.has(task.taskId) ? " - conflict" : ""}</button></td>
<td>${task.criticalPath ? '<span class="critical-flag">◆ Critical</span>' : '<span class="badge">Not critical</span>'}</td>
<td><div class="cell-stack"><textarea class="inline-field inline-impact" data-field="slippageImpact" placeholder="Slippage impact">${escapeHtml(task.slippageImpact || "")}</textarea><textarea class="inline-field inline-reason" data-field="reasonForSlippage" placeholder="Reason for slippage">${escapeHtml(task.reasonForSlippage || "")}</textarea><textarea class="inline-field inline-rtg" data-field="returnToGreen" placeholder="Return-to-green action">${escapeHtml(task.returnToGreen || "")}</textarea><label class="inline-note"><input class="inline-field inline-checkbox" data-field="recoveryNotPossible" type="checkbox"${task.recoveryNotPossible ? " checked" : ""}> Recovery not possible</label></div></td>
<td><textarea class="inline-field inline-notes" data-field="notes" placeholder="Notes">${escapeHtml(task.notes || "")}</textarea></td>
<td><div class="row-actions">${PPMChangeLog.historyButton("Project plan item", task.taskId, task.taskName || task.taskId)}<button type="button" class="button danger small" data-action="delete" data-permission="plan.edit">Delete</button></div></td></tr>`;
    })
    .join("");
  /* Applied before the browser paints, so no row is ever shown without its indent. */
  PPMCore.applyComputedStyles(body);
  if (!projectArchived)
    body.insertAdjacentHTML(
      "beforeend",
      '<tr class="add-row"><td colspan="17"><button type="button" class="add-row-button" data-action="add" data-permission="plan.edit">+ Add plan row</button></td></tr>'
    );
  document.getElementById("emptyMessage").style.display = rows.length ? "none" : "block";
  attachGridEvents();
  renderSummary();
  renderTimeline();
  applyArchiveMode();
}
function renderPlanTableClear() {
  PPMPlanning.calculateParentProgress(tasks);
  PPMPlanning.calculateCriticalPath(tasks);
  const conflictMap = new Map(
    PPMPlanning.dependencyConflicts(tasks).map((conflict) => [conflict.taskId, conflict])
  );
  const rows = filteredTasks();
  const body = document.getElementById("taskTableBody");
  const baseline = currentBaseline();
  body.innerHTML = rows
    .map((task) => {
      const slip = slippage(task);
      const approved = approvedTaskBaseline(task.taskId);
      const indent = hierarchyIndent(task);
      const isMilestone = task.taskType === "Milestone";
      const rowClass = `${dirtyIds.has(task.taskId) ? "dirty-row " : ""}${isMilestone ? "milestone-row " : ""}${task.criticalPath ? "critical-row " : ""}${slip.slipped ? "slipped-row " : ""}${conflictMap.has(task.taskId) ? "dependency-conflict" : ""}`;
      return `<tr data-task-id="${escapeHtml(task.taskId)}" class="${rowClass}">
          <td class="sticky-task">
            <div class="cell-stack">
              <div class="field-group"><label class="field-label">Item type</label><select class="inline-field" data-field="taskType">${optionMarkup(types, task.taskType)}</select></div>
              <div class="field-group"><label class="field-label">Task name</label><div class="task-name-wrap"${styleAttr(`padding-left:${indent * 18}px`)}><span class="hierarchy-marker">${isMilestone ? "◆" : indent ? "↳" : "●"}</span><textarea class="inline-field inline-task" data-field="taskName" placeholder="Enter task name">${escapeHtml(task.taskName)}</textarea></div></div>
              <label class="mandatory-label"><input class="inline-field inline-checkbox" data-field="mandatory" type="checkbox"${task.mandatory !== false ? " checked" : ""}> Mandatory child item</label>
            </div>
          </td>
          <td><label class="field-label">Parent item</label><select class="inline-field inline-parent" data-field="parentTaskId">${parentOptions(task)}</select></td>
          <td><div class="cell-stack"><div class="field-group"><label class="field-label">Phase</label><select class="inline-field" data-field="phase">${optionMarkup(phases, task.phase || "Discovery")}</select></div><div class="field-group"><label class="field-label">Deliverable</label><textarea class="inline-field inline-deliverable" data-field="deliverable" placeholder="Enter deliverable">${escapeHtml(task.deliverable || "")}</textarea></div></div></td>
          <td><label class="field-label">Task owner</label><select class="inline-field inline-person" data-field="taskOwnerResourceId">${resourceOptions(task.taskOwnerResourceId)}</select></td>
          <td><label class="field-label">Supporting contributors</label><select class="inline-field inline-contributors" data-field="supportingContributorIds" multiple>${resourceOptions(task.supportingContributorIds, true)}</select></td>
          <td><label class="field-label">Priority</label><select class="inline-field" data-field="priority">${optionMarkup(priorities, task.priority || "Medium")}</select></td>
          <td><div class="cell-stack"><div class="field-group"><label class="field-label">Working days</label><input class="inline-field inline-number" data-field="durationDays" type="number" min="0" step=".5" value="${escapeHtml(isMilestone ? 0 : (task.durationDays ?? 1))}"${isMilestone ? " disabled" : ""}></div><div class="field-group"><label class="field-label">Owner allocation %</label><input class="inline-field inline-number" data-field="allocationPercentage" type="number" min="0" max="200" value="${escapeHtml(task.allocationPercentage ?? 100)}"></div></div></td>
          <td><div class="cell-stack"><div class="cell-pair"><div class="date-field"><label>Baseline start</label><input class="inline-field inline-date" data-field="baselineStartDate" type="date" value="${escapeHtml(task.baselineStartDate || "")}"${baseline ? " disabled" : ""}></div><div class="date-field"><label>Baseline finish</label><input class="inline-field inline-date" data-field="baselineEndDate" type="date" value="${escapeHtml(task.baselineEndDate || "")}"${baseline ? " disabled" : ""}></div></div>${approved ? `<span class="badge plum">Approved v${baseline.version}: ${escapeHtml(approved.baselineStartDate)} to ${escapeHtml(approved.baselineEndDate)}</span>` : '<span class="field-caption">Awaiting approval</span>'}</div></td>
          <td><div class="cell-pair"><div class="date-field"><label>Forecast start</label><input class="inline-field inline-date" data-field="forecastStartDate" type="date" value="${escapeHtml(task.forecastStartDate || "")}"></div><div class="date-field"><label>Forecast finish</label><input class="inline-field inline-date" data-field="forecastEndDate" type="date" value="${escapeHtml(task.forecastEndDate || "")}" readonly></div></div>${slip.slipped ? `<span class="slippage-alert">${slip.critical ? "CRITICAL PATH - " : ""}${slip.daysLate} day(s) beyond approved baseline</span>` : ""}</td>
          <td><div class="cell-pair"><div class="date-field"><label>Actual start</label><input class="inline-field inline-date" data-field="actualStartDate" type="date" value="${escapeHtml(task.actualStartDate || "")}"></div><div class="date-field"><label>Actual finish</label><input class="inline-field inline-date" data-field="actualEndDate" type="date" value="${escapeHtml(task.actualEndDate || "")}"></div></div></td>
          <td><div class="cell-stack"><div class="field-group"><label class="field-label">Estimated hours</label><input class="inline-field inline-number" data-field="estimatedEffortHours" type="number" min="0" step=".5" value="${escapeHtml(task.estimatedEffortHours ?? "")}"></div><div class="field-group"><label class="field-label">Remaining hours</label><input class="inline-field inline-number" data-field="remainingEffortHours" type="number" min="0" step=".5" value="${escapeHtml(task.remainingEffortHours ?? "")}"></div></div></td>
          <td><div class="cell-stack"><div class="field-group"><label class="field-label">Task status</label><select class="inline-field" data-field="status">${optionMarkup(statuses, task.status || "Not Started")}</select></div><div class="field-group"><label class="field-label">Percentage complete</label><input class="inline-field inline-number" data-field="percentageComplete" type="number" min="0" max="100" value="${escapeHtml(task.percentageComplete ?? 0)}"></div></div></td>
          <td><label class="field-label">Dependency links</label><button type="button" class="button light small dependency-button ${conflictMap.has(task.taskId) ? "has-conflict" : ""}" data-action="dependencies">${(task.dependencies || []).length} link(s)${conflictMap.has(task.taskId) ? " - conflict" : ""}</button></td>
          <td><label class="field-label">Critical-path result</label>${task.criticalPath ? '<span class="critical-flag">◆ Critical</span>' : '<span class="badge">Not critical</span>'}</td>
          <td><div class="cell-stack"><textarea class="inline-field inline-impact" data-field="slippageImpact" placeholder="Slippage impact">${escapeHtml(task.slippageImpact || "")}</textarea><textarea class="inline-field inline-reason" data-field="reasonForSlippage" placeholder="Reason for slippage">${escapeHtml(task.reasonForSlippage || "")}</textarea><textarea class="inline-field inline-rtg" data-field="returnToGreen" placeholder="Return-to-green action">${escapeHtml(task.returnToGreen || "")}</textarea><label class="inline-note"><input class="inline-field inline-checkbox" data-field="recoveryNotPossible" type="checkbox"${task.recoveryNotPossible ? " checked" : ""}> Recovery not possible</label></div></td>
          <td><label class="field-label">Delivery notes</label><textarea class="inline-field inline-notes" data-field="notes" placeholder="Notes">${escapeHtml(task.notes || "")}</textarea></td>
          <td><label class="field-label">Row action</label><div class="row-actions">${PPMChangeLog.historyButton("Project plan item", task.taskId, task.taskName || task.taskId)}<button type="button" class="button danger small" data-action="delete" data-permission="plan.edit">Delete</button></div></td>
        </tr>`;
    })
    .join("");
  /* Applied before the browser paints, so no row is ever shown without its indent. */
  PPMCore.applyComputedStyles(body);
  if (!projectArchived)
    body.insertAdjacentHTML(
      "beforeend",
      '<tr class="add-row"><td colspan="17"><button type="button" class="add-row-button" data-action="add" data-permission="plan.edit">+ Add plan row</button></td></tr>'
    );
  document.getElementById("emptyMessage").style.display = rows.length ? "none" : "block";
  attachGridEvents();
  renderSummary();
  renderTimeline();
  applyArchiveMode();
}
renderTable = renderPlanTableClear;

const PLAN_COLUMN_WIDTHS_KEY = "ppmProjectPlanColumnWidths";
function planColumnMinimum(index) {
  if (index === 0) return 260;
  if (index === 14) return 360;
  if ([5, 16].includes(index)) return 90;
  return 120;
}
function savedPlanColumnWidths() {
  try {
    const widths = JSON.parse(localStorage.getItem(PLAN_COLUMN_WIDTHS_KEY) || "[]");
    return Array.isArray(widths) ? widths : [];
  } catch (error) {
    return [];
  }
}
function currentPlanColumnWidths() {
  return [...document.querySelectorAll(".plan-table colgroup col")].map((column) =>
    Math.round(parseFloat(column.style.width) || column.getBoundingClientRect().width || 120)
  );
}
function applyPlanColumnWidths(widths, persist) {
  const table = document.querySelector(".plan-table"),
    columns = [...table.querySelectorAll("colgroup col")];
  const applied = columns.map((column, index) =>
    Math.max(planColumnMinimum(index), Number(widths[index]) || Number(column.dataset.defaultWidth) || 120)
  );
  columns.forEach((column, index) => (column.style.width = `${applied[index]}px`));
  const total = applied.reduce((sum, width) => sum + width, 0);
  table.style.width = `${total}px`;
  table.style.minWidth = `${total}px`;
  if (persist) localStorage.setItem(PLAN_COLUMN_WIDTHS_KEY, JSON.stringify(applied));
}
function resizePlanColumn(index, width, persist) {
  const widths = currentPlanColumnWidths();
  widths[index] = Math.max(planColumnMinimum(index), Math.round(width));
  applyPlanColumnWidths(widths, persist);
}
function setupResizableColumns() {
  const table = document.querySelector(".plan-table"),
    columns = [...table.querySelectorAll("colgroup col")],
    headers = [...table.querySelectorAll("thead th")];
  columns.forEach((column) => {
    if (!column.dataset.defaultWidth)
      column.dataset.defaultWidth = String(Math.round(parseFloat(column.style.width) || 120));
  });
  const saved = savedPlanColumnWidths();
  if (saved.length === columns.length) applyPlanColumnWidths(saved, false);
  else
    applyPlanColumnWidths(
      columns.map((column) => Number(column.dataset.defaultWidth)),
      false
    );
  headers.forEach((header, index) => {
    if (header.querySelector(".column-resize-handle")) return;
    const title = header.querySelector(".column-title")?.textContent || `Column ${index + 1}`;
    const handle = document.createElement("span");
    handle.className = "column-resize-handle";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", `Resize ${title} column`);
    handle.title = `Drag to resize ${title}. Double-click to reset this column.`;
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX,
        startWidth = headers[index].getBoundingClientRect().width;
      handle.classList.add("resizing");
      document.body.classList.add("resizing-plan-column");
      handle.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => resizePlanColumn(index, startWidth + moveEvent.clientX - startX, false);
      const finish = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", finish);
        handle.classList.remove("resizing");
        document.body.classList.remove("resizing-plan-column");
        applyPlanColumnWidths(currentPlanColumnWidths(), true);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", finish, { once: true });
    });
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resizePlanColumn(index, Number(columns[index].dataset.defaultWidth), true);
    });
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      resizePlanColumn(
        index,
        headers[index].getBoundingClientRect().width + (event.key === "ArrowRight" ? 20 : -20),
        true
      );
    });
    header.appendChild(handle);
  });
  const heading = table.closest(".panel").querySelector(".panel-heading"),
    status = document.getElementById("unsavedIndicator");
  const guidance = heading.querySelector("p");
  if (guidance)
    guidance.textContent =
      "Edit cells directly. Drag a column-heading edge to resize it; double-click an edge to reset that column.";
  if (!document.getElementById("resetColumnWidths")) {
    const tools = document.createElement("div");
    tools.className = "plan-grid-tools";
    const reset = document.createElement("button");
    reset.id = "resetColumnWidths";
    reset.type = "button";
    reset.className = "button light small";
    // Resets a personal display preference, not project data.
    reset.dataset.permission = "none";
    reset.textContent = "Reset column widths";
    reset.addEventListener("click", () => {
      localStorage.removeItem(PLAN_COLUMN_WIDTHS_KEY);
      applyPlanColumnWidths(
        columns.map((column) => Number(column.dataset.defaultWidth)),
        false
      );
      showMessage("Project Plan column widths were reset.", "success");
    });
    heading.appendChild(tools);
    tools.appendChild(reset);
    tools.appendChild(status);
  }
}
setupResizableColumns();

function focusNotificationTask() {
  if (!pendingFocusTaskId) return;
  const row = document.querySelector(`tr[data-task-id="${CSS.escape(pendingFocusTaskId)}"]`);
  if (!row) return;
  pendingFocusTaskId = "";
  row.classList.add("ppm-notification-target");
  requestAnimationFrame(() => row.scrollIntoView({ block: "center", inline: "center" }));
}
function attachGridEvents() {
  document
    .querySelectorAll("tr[data-task-id] .inline-field")
    .forEach((field) =>
      field.addEventListener(
        field.tagName === "SELECT" || field.type === "date" || field.type === "checkbox" ? "change" : "input",
        handleChange
      )
    );
  document
    .querySelectorAll('[data-action="dependencies"]')
    .forEach((b) => b.addEventListener("click", () => openDependencies(b.closest("tr").dataset.taskId)));
  document
    .querySelectorAll('[data-action="delete"]')
    .forEach((b) => b.addEventListener("click", () => askDelete(b.closest("tr").dataset.taskId)));
  document.querySelectorAll('[data-action="add"]').forEach((b) => b.addEventListener("click", appendTask));
  focusNotificationTask();
}
function handleChange(event) {
  if (projectArchived) return;
  const row = event.currentTarget.closest("tr"),
    task = tasks.find((t) => t.taskId === row.dataset.taskId),
    field = event.currentTarget,
    property = field.dataset.field;
  if (!task) return;
  if (property === "taskOwnerResourceId") {
    const resource = PPMResources.findResource(field.value, "");
    task.taskOwnerResourceId = resource?.resourceId || "";
    task.taskOwner = resource?.fullName || "";
    task.taskOwnerEmail = resource?.email || "";
  } else if (property === "supportingContributorIds") task[property] = selectedValues(field);
  else if (["mandatory", "recoveryNotPossible"].includes(property)) task[property] = field.checked;
  else if (
    [
      "durationDays",
      "allocationPercentage",
      "estimatedEffortHours",
      "remainingEffortHours",
      "percentageComplete"
    ].includes(property)
  )
    task[property] = field.value === "" ? "" : Number(field.value);
  else task[property] = field.value;
  if (property === "taskType" && task.taskType === "Milestone") {
    task.durationDays = 0;
    task.baselineEndDate = task.baselineStartDate;
    task.forecastEndDate = task.forecastStartDate;
  }
  if (["durationDays", "forecastStartDate"].includes(property))
    task.forecastEndDate = dateEnd(task.forecastStartDate, task.durationDays);
  if (property === "baselineStartDate" && task.taskType === "Milestone")
    task.baselineEndDate = task.baselineStartDate;
  if (property === "status" && task.status === "Complete") {
    task.percentageComplete = 100;
    task.remainingEffortHours = 0;
  }
  markDirty(task.taskId);
  if (["taskType", "parentTaskId", "durationDays", "forecastStartDate", "status"].includes(property))
    renderTable();
  else {
    row.classList.add("dirty-row");
    renderSummary();
    renderTimeline();
  }
  clearMessage();
}
function appendTask() {
  if (projectArchived) return;
  const now = new Date().toISOString(),
    task = PPMPlanning.normaliseTask(
      {
        taskId: PPMPlanning.uid("TASK"),
        taskType: "Task",
        phase: "Discovery",
        taskName: "",
        durationDays: 1,
        allocationPercentage: 100,
        status: "Not Started",
        percentageComplete: 0,
        priority: "Medium",
        createdAt: now,
        updatedAt: now
      },
      tasks.length
    );
  tasks.push(task);
  markDirty(task.taskId);
  renderTable();
  requestAnimationFrame(() =>
    document.querySelector(`tr[data-task-id="${CSS.escape(task.taskId)}"] [data-field="taskName"]`)?.focus()
  );
}
function validatePlan() {
  PPMPlanning.calculateParentProgress(tasks);
  PPMPlanning.calculateCriticalPath(tasks);
  const config = PPMPlanning.getResourceConfig();
  const errors = [
    ...PPMPlanning.hierarchyErrors(tasks, config.maximumHierarchyDepth),
    ...PPMPlanning.incompleteChildErrors(tasks)
  ];
  const cycle = PPMPlanning.dependencyCycle(tasks);
  if (cycle.length) errors.push("Circular dependency detected. Remove the link before saving.");
  tasks.forEach((task, index) => {
    const name = String(task.taskName || "").trim();
    task.taskName = name;
    if (!name) errors.push(`Plan row ${index + 1} needs a name.`);
    if (task.taskType === "Milestone") {
      task.durationDays = 0;
      task.baselineEndDate = task.baselineStartDate;
      task.forecastEndDate = task.forecastStartDate;
    }
    if (task.baselineStartDate && task.baselineEndDate && task.baselineEndDate < task.baselineStartDate)
      errors.push(`${name || `Row ${index + 1}`} has a baseline finish before its start.`);
    if (task.forecastStartDate && task.forecastEndDate && task.forecastEndDate < task.forecastStartDate)
      errors.push(`${name || `Row ${index + 1}`} has a forecast finish before its start.`);
    if (task.actualStartDate && task.actualEndDate && task.actualEndDate < task.actualStartDate)
      errors.push(`${name || `Row ${index + 1}`} has an actual finish before its start.`);
    if (task.status === "Complete" && !task.actualEndDate)
      errors.push(`${name} is complete and needs an actual end date.`);
    const slip = slippage(task);
    if (slip.slipped) {
      if (!String(task.reasonForSlippage || "").trim()) errors.push(`${name} is slipped and needs a reason.`);
      if (!String(task.slippageImpact || "").trim())
        errors.push(`${name} is slipped and needs impact information.`);
      if (!task.recoveryNotPossible && !String(task.returnToGreen || "").trim())
        errors.push(`${name} is slipped and needs a return-to-green action or Recovery not possible.`);
    }
  });
  if (errors.length) {
    showMessage(
      errors[0] + (errors.length > 1 ? ` ${errors.length - 1} more issue(s) remain.` : ""),
      "error"
    );
    return false;
  }
  return true;
}
async function syncLinkedDemandDates() {
  const demands = PPMPlanning.getDemand();
  let changed = false;
  demands.forEach((demand) => {
    if (
      demand.projectCode !== projectCode ||
      !demand.linkedTaskId ||
      ["Rejected", "Cancelled", "Completed"].includes(demand.status)
    )
      return;
    const task = tasks.find((item) => item.taskId === demand.linkedTaskId);
    if (!task) return;
    const start = task.forecastStartDate || task.baselineStartDate || "",
      end = task.forecastEndDate || task.baselineEndDate || "";
    if (start && end && (demand.startDate !== start || demand.endDate !== end)) {
      demand.startDate = start;
      demand.endDate = end;
      const resource = PPMResources.findResource(demand.resourceId, "") || {};
      demand.normalisedHours = Math.round(PPMPlanning.normalisedDemandHours(demand, resource) * 10) / 10;
      demand.updatedAt = new Date().toISOString();
      demand.history = [
        ...(Array.isArray(demand.history) ? demand.history : []),
        {
          changedAt: demand.updatedAt,
          fromStatus: demand.status,
          toStatus: demand.status,
          changedBy: "Project plan",
          note: "Dates recalculated from linked plan item."
        }
      ];
      changed = true;
    }
  });
  if (!changed) return { changed: false, ok: true };
  /* Stage 16: the caller needs to know both whether dates moved and whether that reached the
     database, so both come back rather than a bare boolean. */
  const demandResult = await PPMPlanning.saveDemand(demands);
  return { changed: true, ok: demandResult ? demandResult.ok !== false : true, message: demandResult?.message };
}
async function savePlan() {
  if (projectArchived || !dirty) return;
  if (!validatePlan()) return;
  const now = new Date().toISOString();
  tasks.forEach((task) => {
    if (dirtyIds.has(task.taskId)) task.updatedAt = now;
    task.createdAt = task.createdAt || now;
  });
  const planResult = await savePlans();
  if (planResult && planResult.ok === false) {
    showMessage(planResult.message || "The project plan could not be saved.", "error");
    return;
  }
  const demandSync = await syncLinkedDemandDates();
  const demandDatesChanged = demandSync.changed;
  if (!demandSync.ok) {
    showMessage(`The plan was saved, but linked resource demand dates were not: ${demandSync.message}`, "error");
  }
  /* Stage 14: browser-side audit emission removed. public.audit_log records every
     task change against the signed-in person, verifiably. */
  originalTasks = new Map(tasks.map((task) => [task.taskId, JSON.parse(JSON.stringify(task))]));
  setClean();
  renderTable();
  const criticalSlipped = tasks.filter((t) => {
    const result = slippage(t);
    return result.slipped && result.critical;
  });
  showMessage(
    criticalSlipped.length
      ? `${criticalSlipped.length} critical-path item(s) are slipped and require elevated attention.`
      : `Project plan changes were saved.${demandDatesChanged ? " Linked resource demand dates were recalculated." : ""}`,
    criticalSlipped.length ? "critical" : "success"
  );
}
function renderSummary() {
  const conflicts = PPMPlanning.dependencyConflicts(tasks),
    slipped = tasks.filter((t) => slippage(t).slipped);
  document.getElementById("totalTasks").textContent = tasks.length;
  document.getElementById("milestoneCount").textContent = tasks.filter(
    (t) => t.taskType === "Milestone"
  ).length;
  document.getElementById("criticalCount").textContent = tasks.filter((t) => t.criticalPath).length;
  document.getElementById("slippedCount").textContent = slipped.length;
  document.getElementById("conflictCount").textContent = conflicts.length;
  document.getElementById("effortTotal").textContent =
    `${tasks.reduce((s, t) => s + Number(t.estimatedEffortHours || 0), 0).toLocaleString()}h`;
  document.getElementById("remainingTotal").textContent =
    `${tasks.reduce((s, t) => s + Number(t.remainingEffortHours || 0), 0).toLocaleString()}h`;
}
function openDependencies(taskId) {
  if (projectArchived) return;
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) return;
  editingDependencyTaskId = taskId;
  dependencyDraft = (task.dependencies || []).map((d) => ({ ...d }));
  document.getElementById("dependencyModalTitle").textContent =
    `Dependencies for ${task.taskName || "plan item"}`;
  renderDependencyRows();
  openModal("dependencyModal");
}
function externalItemOptions(projectId, type, selected) {
  if (!projectId) return '<option value="">Select reference</option>';
  if (type === "Project")
    return `<option value="${escapeHtml(projectId)}" selected>${escapeHtml(projectId)}</option>`;
  if (type === "Milestone") {
    const store = PPMPlanning.read("milestones", {});
    return (
      '<option value="">Select milestone</option>' +
      (store[projectId] || [])
        .map(
          (item) =>
            `<option value="${escapeHtml(item.milestoneId)}"${item.milestoneId === selected ? " selected" : ""}>${escapeHtml(item.milestoneName || item.milestoneId)}</option>`
        )
        .join("")
    );
  }
  const plans = readPlans();
  return (
    '<option value="">Select task</option>' +
    (plans[projectId] || [])
      .map(
        (item) =>
          `<option value="${escapeHtml(item.taskId)}"${item.taskId === selected ? " selected" : ""}>${escapeHtml(item.taskName || item.taskId)}</option>`
      )
      .join("")
  );
}
function renderDependencyRows() {
  const currentTask = tasks.find((t) => t.taskId === editingDependencyTaskId);
  const projectOptions = readProjects()
    .filter((p) => p.projectCode !== projectCode)
    .map(
      (p) =>
        `<option value="${escapeHtml(p.projectCode)}">${escapeHtml(p.projectCode)} - ${escapeHtml(p.projectName)}</option>`
    )
    .join("");
  document.getElementById("dependencyRows").innerHTML = dependencyDraft.length
    ? dependencyDraft
        .map(
          (d, index) =>
            `<div class="dependency-row" data-index="${index}"><div><label>Scope</label><select data-dep-field="scope">${optionMarkup(["Internal", "External"], d.scope || "Internal")}</select></div><div><label>Relationship</label><select data-dep-field="relationship">${optionMarkup(["FS", "SS", "FF", "SF"], d.relationship || "FS")}</select></div><div><label>Internal predecessor</label><select data-dep-field="predecessorTaskId"${d.scope === "External" ? " disabled" : ""}><option value="">Select predecessor</option>${tasks
              .filter((t) => t.taskId !== editingDependencyTaskId)
              .map(
                (t) =>
                  `<option value="${escapeHtml(t.taskId)}"${t.taskId === d.predecessorTaskId ? " selected" : ""}>${escapeHtml(t.taskName || t.taskId)}</option>`
              )
              .join(
                ""
              )}</select></div><div><label>External project</label><select data-dep-field="externalProjectCode"${d.scope !== "External" ? " disabled" : ""}><option value="">Select project</option>${projectOptions.replace(`value="${d.externalProjectCode}"`, `value="${d.externalProjectCode}" selected`)}</select></div><div><label>Reference type</label><select data-dep-field="externalReferenceType"${d.scope !== "External" ? " disabled" : ""}>${optionMarkup(["Project", "Milestone", "Task"], d.externalReferenceType || "Task")}</select></div><div><label>Linked reference</label><select data-dep-field="externalReference"${d.scope !== "External" ? " disabled" : ""}>${externalItemOptions(d.externalProjectCode, d.externalReferenceType || "Task", d.externalReference)}</select></div><button type="button" class="button danger small" data-permission="plan.edit" data-remove-dependency="${index}">Remove</button></div>`
        )
        .join("")
    : "<p>No dependencies have been added.</p>";
  document.querySelectorAll("[data-dep-field]").forEach((field) =>
    field.addEventListener("change", (event) => {
      const row = event.currentTarget.closest(".dependency-row"),
        index = Number(row.dataset.index);
      dependencyDraft[index][event.currentTarget.dataset.depField] = event.currentTarget.value;
      if (
        ["scope", "externalProjectCode", "externalReferenceType"].includes(
          event.currentTarget.dataset.depField
        )
      )
        renderDependencyRows();
    })
  );
  document.querySelectorAll("[data-remove-dependency]").forEach((button) =>
    button.addEventListener("click", () => {
      dependencyDraft.splice(Number(button.dataset.removeDependency), 1);
      renderDependencyRows();
    })
  );
}
function saveDependencies() {
  const candidate = dependencyDraft.map(PPMPlanning.normaliseDependency);
  const task = tasks.find((t) => t.taskId === editingDependencyTaskId);
  if (!task) return;
  const original = task.dependencies;
  task.dependencies = candidate;
  const cycle = PPMPlanning.dependencyCycle(tasks);
  if (cycle.length) {
    task.dependencies = original;
    showMessage("That dependency would create a circular link and was not applied.", "error");
    closeModal("dependencyModal");
    return;
  }
  markDirty(task.taskId);
  closeModal("dependencyModal");
  renderTable();
  const conflict = PPMPlanning.dependencyConflicts(tasks).find((c) => c.taskId === task.taskId);
  if (conflict) showMessage(conflict.message, "warning");
}
function openBaselineDecision(action, requestId = "") {
  const signedIn = PPMAuth.getCurrentUser(),
    request = requestId
      ? (PPMPlanning.getBaselineRequests()[projectCode] || []).find((row) => row.requestId === requestId)
      : null;
  if (
    !PPMAuth.can("plan.approveBaseline", projectCode) ||
    (request && request.requestedByResourceId === signedIn?.resourceId)
  ) {
    PPMAuth.permissionToast(
      "An authorised approver must be different from the person who submitted the baseline request."
    );
    return;
  }
  document.getElementById("baselineDecisionForm").reset();
  document.getElementById("baselineDecisionAction").value = action;
  document.getElementById("baselineRequestId").value = requestId;
  document.getElementById("baselineApprovalDate").value = PPMPlanning.todayIso();
  PPMResources.populatePersonSelect("baselineApprover", {
    selectedResourceId: signedIn.resourceId,
    blankLabel: "Signed-in approver",
    allowCreate: false
  });
  document.getElementById("baselineApprover").disabled = true;
  const reject = action === "rejectRequest";
  document.getElementById("baselineDecisionTitle").textContent = reject
    ? "Reject rebaseline request"
    : action === "approveRequest"
      ? "Approve rebaseline request"
      : "Approve initial baseline";
  document.getElementById("submitBaselineDecision").textContent = reject ? "Reject request" : "Approve";
  openModal("baselineDecisionModal");
}
async function submitBaselineDecision(event) {
  event.preventDefault();
  if (projectArchived) return;
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const action = document.getElementById("baselineDecisionAction").value,
    signedIn = PPMAuth.getCurrentUser(),
    requestIdForCheck = document.getElementById("baselineRequestId").value,
    requestForCheck = requestIdForCheck
      ? (PPMPlanning.getBaselineRequests()[projectCode] || []).find(
          (row) => row.requestId === requestIdForCheck
        )
      : null;
  if (
    !PPMAuth.can("plan.approveBaseline", projectCode) ||
    (requestForCheck && requestForCheck.requestedByResourceId === signedIn?.resourceId)
  ) {
    PPMAuth.permissionToast(
      "This decision would breach the authorised-approver or segregation-of-duties rule."
    );
    return;
  }
  const person = { resourceId: signedIn.resourceId, name: signedIn.fullName, email: signedIn.email },
    decision = {
      approvedBy: person.name,
      approvedByResourceId: person.resourceId,
      approvalDate: document.getElementById("baselineApprovalDate").value,
      decisionNotes: document.getElementById("baselineDecisionReason").value.trim(),
      status: action === "rejectRequest" ? "Rejected" : "Approved"
    },
    databaseWorkflow = Boolean(window.PPMChildDatabase?.workflowReady?.("baseline")),
    submitButton = document.getElementById("submitBaselineDecision"),
    originalLabel = submitButton.textContent;

  let entityId = "";

  /*
    Stage 17: no fallback. The else-branch below wrote rows the database refuses through its
    workflow guard trigger, and the refusal was swallowed by the write seam - so the screen
    showed a decision that never happened. If the workflow is unavailable the honest answer is
    to say so.
  */
  if (!databaseWorkflow) {
    showMessage(
      "The approval workflow is unavailable, so this cannot be recorded. Reload the page; if it " +
        "persists, the database connection or your sign-in has been lost.",
      "error"
    );
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Saving…";
  try {
    if (action === "approveInitial") {
      if (!validatePlan()) return;
      if (
        tasks.some(
          (t) => !["Phase", "Deliverable"].includes(t.taskType) && (!t.baselineStartDate || !t.baselineEndDate)
        )
      ) {
        showMessage("Every task and milestone needs baseline start and finish dates before approval.", "error");
        closeModal("baselineDecisionModal");
        return;
      }

      if (databaseWorkflow) {
        // Legacy approval also saved the current plan. Preserve that behaviour,
        // then let the RPC snapshot the exact PostgreSQL plan versions we just saved.
        const planResult = await savePlans();
        if (planResult && planResult.ok === false) {
          showMessage(planResult.message || "The project plan could not be saved before baseline approval.", "error");
          return;
        }
        const result = await PPMChildDatabase.commitBaselineWorkflow({
          operation: "approve_initial",
          projectCode,
          approvalDate: decision.approvalDate,
          decisionNotes: decision.decisionNotes
        });
        entityId = `BASELINE-v${result?.baselineVersion || currentBaseline()?.version || 1}`;
      } else {
        const baseline = await PPMPlanning.createApprovedBaseline(projectCode, tasks, {
          ...decision,
          reason: decision.decisionNotes
        });
        if (baseline && baseline.ok === false) {
          showMessage(baseline.message, "error");
          return;
        }
        entityId = `BASELINE-v${baseline.record.version}`;
        const planResult = await savePlans();
        if (planResult && planResult.ok === false) {
          showMessage(planResult.message || "The project plan could not be saved.", "error");
          return;
        }
      }
    } else {
      const requestId = document.getElementById("baselineRequestId").value,
        request = (PPMPlanning.getBaselineRequests()[projectCode] || []).find((r) => r.requestId === requestId);
      if (!request) return;
      entityId = requestId;

      if (databaseWorkflow) {
        if (action === "approveRequest") {
          // Preserve any ordinary plan edits already made in this browser before
          // the database applies the approved baseline dates atomically.
          const planResult = await savePlans();
          if (planResult && planResult.ok === false) {
            showMessage(planResult.message || "The project plan could not be saved before rebaseline approval.", "error");
            return;
          }
        }
        await PPMChildDatabase.commitBaselineWorkflow({
          operation: action === "approveRequest" ? "approve_request" : "reject_request",
          projectCode,
          request,
          approvalDate: decision.approvalDate,
          decisionNotes: decision.decisionNotes
        });
      } else {
        if (action === "approveRequest") {
          (request.proposedBaseline || []).forEach((proposed) => {
            const task = tasks.find((t) => t.taskId === proposed.taskId);
            if (task) {
              task.baselineStartDate = proposed.baselineStartDate;
              task.baselineEndDate = proposed.baselineEndDate;
            }
          });
          const planResult = await savePlans();
          if (planResult && planResult.ok === false) {
            showMessage(planResult.message || "The project plan could not be saved.", "error");
            return;
          }
          const approved = await PPMPlanning.createApprovedBaseline(projectCode, tasks, {
            ...decision,
            reason: request.reason,
            impact: request.impact
          });
          if (approved && approved.ok === false) {
            showMessage(approved.message, "error");
            return;
          }
        }
        const decided = await PPMPlanning.decideBaselineRequest(projectCode, requestId, decision);
        if (decided && decided.ok === false) {
          showMessage(decided.message, "error");
          return;
        }
      }
    }

    if (databaseWorkflow) {
      const plans = readPlans();
      tasks = PPMPlanning.normalisePlan(plans[projectCode] || []);
      PPMPlanning.calculateCriticalPath(tasks);
      originalTasks = new Map(tasks.map((task) => [task.taskId, JSON.parse(JSON.stringify(task))]));
      if (action !== "rejectRequest") setClean();
    }

    // Compatibility audit is emitted only after the database transaction commits.
    // public.audit_log remains the verified server-side audit trail.

    closeModal("baselineDecisionModal");
    renderBaselineGovernance();
    renderTable();
    showMessage(
      action === "rejectRequest"
        ? "Rebaseline request was rejected."
        : "Baseline approval was recorded and the approved dates are now read-only.",
      "success"
    );
  } catch (error) {
    showMessage(error?.message || String(error), "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}
function openRebaseline() {
  if (!currentBaseline() || projectArchived || !PPMAuth.can("plan.requestBaseline", projectCode)) {
    PPMAuth.permissionToast();
    return;
  }
  const signedIn = PPMAuth.getCurrentUser();
  document.getElementById("rebaselineForm").reset();
  PPMResources.populatePersonSelect("rebaselineRequestor", {
    selectedResourceId: signedIn.resourceId,
    blankLabel: "Signed-in requestor",
    allowCreate: false
  });
  document.getElementById("rebaselineRequestor").disabled = true;
  document.getElementById("rebaselineRows").innerHTML = tasks
    .map((task) => {
      const approved = approvedTaskBaseline(task.taskId) || {};
      return `<tr data-task-id="${escapeHtml(task.taskId)}"><td>${escapeHtml(task.taskName || task.taskId)}</td>
<td>${escapeHtml(approved.baselineStartDate || "")}</td>
<td>${escapeHtml(approved.baselineEndDate || "")}</td>
<td><input data-proposed="start" type="date" value="${escapeHtml(approved.baselineStartDate || "")}"></td>
<td><input data-proposed="end" type="date" value="${escapeHtml(approved.baselineEndDate || "")}"></td></tr>`;
    })
    .join("");
  openModal("rebaselineModal");
}
async function submitRebaseline(event) {
  event.preventDefault();
  if (!PPMAuth.can("plan.requestBaseline", projectCode)) {
    PPMAuth.permissionToast();
    return;
  }
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const signedIn = PPMAuth.getCurrentUser(),
    person = { resourceId: signedIn.resourceId, name: signedIn.fullName, email: signedIn.email },
    proposed = [...document.querySelectorAll("#rebaselineRows tr")].map((row) => ({
      taskId: row.dataset.taskId,
      baselineStartDate: row.querySelector('[data-proposed="start"]').value,
      baselineEndDate: row.querySelector('[data-proposed="end"]').value
    }));
  if (
    proposed.some((p) => p.baselineStartDate && p.baselineEndDate && p.baselineEndDate < p.baselineStartDate)
  ) {
    showMessage("A proposed baseline finish cannot be before its start.", "error");
    return;
  }

  const reason = document.getElementById("rebaselineReason").value.trim(),
    impact = document.getElementById("rebaselineImpact").value.trim(),
    databaseWorkflow = Boolean(window.PPMChildDatabase?.workflowReady?.("baseline")),
    submitButton = form.querySelector('[type="submit"]'),
    originalLabel = submitButton?.textContent || "Submit request";
  let request;

  /*
    Stage 17: no fallback. The else-branch below wrote rows the database refuses through its
    workflow guard trigger, and the refusal was swallowed by the write seam - so the screen
    showed a decision that never happened. If the workflow is unavailable the honest answer is
    to say so.
  */
  if (!databaseWorkflow) {
    showMessage(
      "The approval workflow is unavailable, so this cannot be recorded. Reload the page; if it " +
        "persists, the database connection or your sign-in has been lost.",
      "error"
    );
    return;
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Saving…";
  }
  try {
    if (databaseWorkflow) {
      request = {
        requestId: PPMPlanning.uid("REBASE"),
        projectCode,
        status: "Requested",
        createdAt: new Date().toISOString(),
        existingBaseline: currentBaseline(),
        proposedBaseline: proposed,
        reason,
        impact,
        requestedBy: person.name,
        requestedByResourceId: person.resourceId
      };
      const result = await PPMChildDatabase.commitBaselineWorkflow({
        operation: "request",
        projectCode,
        request
      });
      if (result?.requestId) request.requestId = result.requestId;
    } else {
      const requested = await PPMPlanning.saveBaselineRequest(projectCode, {
        existingBaseline: currentBaseline(),
        proposedBaseline: proposed,
        reason,
        impact,
        requestedBy: person.name,
        requestedByResourceId: person.resourceId
      });
      if (requested && requested.ok === false) {
        showMessage(requested.message, "error");
        return;
      }
      request = requested.record;
    }

    closeModal("rebaselineModal");
    renderBaselineGovernance();
    showMessage(
      "Rebaseline request submitted. Approved dates remain unchanged until a decision is recorded.",
      "success"
    );
  } catch (error) {
    showMessage(error?.message || String(error), "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  }
}
function renderBaselineGovernance() {
  const baseline = currentBaseline(),
    versions = PPMPlanning.getProjectBaselines(projectCode),
    requests = PPMPlanning.getBaselineRequests()[projectCode] || [];
  document.getElementById("baselineStatusBadge").textContent = baseline
    ? "Approved baseline"
    : "No approved baseline";
  document.getElementById("baselineStatusBadge").className = `badge ${baseline ? "green" : "amber"}`;
  document.getElementById("baselineVersionBadge").textContent = `Version ${baseline?.version || 0}`;
  document.getElementById("baselineApprovalMeta").textContent = baseline
    ? `Approved ${baseline.approvalDate || ""} by ${baseline.approvedBy || "Not recorded"}`
    : "Approval required";
  document.getElementById("approveBaselineButton").style.display = baseline ? "none" : "inline-flex";
  document.getElementById("requestRebaselineButton").disabled = !baseline || projectArchived;
  document.getElementById("baselineVersions").innerHTML = versions.length
    ? `<table class="history-table"><thead><tr><th>Version</th>
<th>Approved</th>
<th>Approver</th>
<th>Reason / impact</th>
<th>Items</th></tr></thead><tbody>${versions
        .slice()
        .reverse()
        .map(
          (v) =>
            `<tr><td>v${v.version}</td>
<td>${escapeHtml(v.approvalDate || "")}</td>
<td>${escapeHtml(v.approvedBy || "Not recorded")}</td>
<td>${escapeHtml(v.reason || "")}<br>${escapeHtml(v.impact || "")}</td>
<td>${v.taskBaselines?.length || 0}</td></tr>`
        )
        .join("")}</tbody></table>`
    : "<p>No approved baseline versions.</p>";
  document.getElementById("baselineRequests").innerHTML = requests.length
    ? `<table class="history-table"><thead><tr><th>Requested</th>
<th>Requestor</th>
<th>Reason / impact</th>
<th>Status</th>
<th>Decision</th></tr></thead><tbody>${requests
        .slice()
        .reverse()
        .map(
          (r) =>
            `<tr><td>${escapeHtml(new Date(r.createdAt).toLocaleDateString("en-GB"))}</td>
<td>${escapeHtml(r.requestedBy || "")}</td>
<td>${escapeHtml(r.reason || "")}<br>${escapeHtml(r.impact || "")}</td>
<td><span class="badge ${r.status === "Approved" ? "green" : r.status === "Rejected" ? "red" : "amber"}">${escapeHtml(r.status)}</span></td>
<td>${r.status === "Requested" && !projectArchived ? `<button class="button small" data-permission="plan.approveBaseline" data-request-action="approve" data-request-id="${r.requestId}">Approve</button> <button class="button danger small" data-permission="plan.approveBaseline" data-request-action="reject" data-request-id="${r.requestId}">Reject</button>` : escapeHtml(r.decisionNotes || "")}</td></tr>`
        )
        .join("")}</tbody></table>`
    : "<p>No rebaseline requests.</p>";
  document
    .querySelectorAll("[data-request-action]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        openBaselineDecision(
          b.dataset.requestAction === "approve" ? "approveRequest" : "rejectRequest",
          b.dataset.requestId
        )
      )
    );
}
function askDelete(taskId) {
  if (projectArchived) return;
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) return;
  pendingDeleteId = taskId;
  const childCount = tasks.filter((t) => t.parentTaskId === taskId).length,
    linked = tasks.filter((t) => (t.dependencies || []).some((d) => d.predecessorTaskId === taskId)).length,
    demands = PPMPlanning.getDemand().filter(
      (d) => (d.linkedTaskId || d.taskId) === taskId && !["Cancelled", "Rejected"].includes(d.status)
    ).length;
  document.getElementById("deleteMessage").textContent =
    `Delete ${task.taskName || "this plan item"}? ${childCount} child item(s), ${linked} dependency link(s) and ${demands} resource demand record(s) are linked. Child items will move to the deleted item's parent; linked resource demand will be cancelled.`;
  document.getElementById("deleteConfirmation").classList.add("visible");
}
async function confirmDelete() {
  const task = tasks.find((t) => t.taskId === pendingDeleteId);
  if (!task) return closeDelete();
  tasks
    .filter((t) => t.parentTaskId === task.taskId)
    .forEach((child) => (child.parentTaskId = task.parentTaskId || ""));
  tasks.forEach(
    (t) => (t.dependencies = (t.dependencies || []).filter((d) => d.predecessorTaskId !== task.taskId))
  );
  const demands = PPMPlanning.getDemand();
  demands
    .filter(
      (d) => (d.linkedTaskId || d.taskId) === task.taskId && !["Cancelled", "Rejected"].includes(d.status)
    )
    .forEach((d) => {
      d.status = "Cancelled";
      d.notes = [d.notes, "Cancelled because the linked plan item was removed."].filter(Boolean).join("\n");
    });
  const demandResult = await PPMPlanning.saveDemand(demands);
  if (demandResult && demandResult.ok === false) {
    showMessage(`The linked resource demand could not be cancelled: ${demandResult.message}`, "error");
    return;
  }
  tasks = tasks.filter((t) => t.taskId !== task.taskId);
  markDirty(task.taskId);
  closeDelete();
  renderTable();
  showMessage(
    "Plan item removed. Save the plan to confirm the schedule change; linked demand was cancelled.",
    "warning"
  );
}
function closeDelete() {
  document.getElementById("deleteConfirmation").classList.remove("visible");
  pendingDeleteId = "";
}
function renderFilters() {
  const fill = (id, values, label) => {
    const select = document.getElementById(id),
      current = select.value;
    select.innerHTML =
      `<option value="">${label}</option>` + values.map((v) => `<option>${escapeHtml(v)}</option>`).join("");
    if (values.includes(current)) select.value = current;
  };
  fill("phaseFilter", phases, "All phases");
  fill("typeFilter", types, "All item types");
  fill("statusFilter", statuses, "All statuses");
  const owner = document.getElementById("ownerFilter"),
    current = owner.value;
  owner.innerHTML =
    '<option value="">All owners</option>' +
    PPMResources.getResources()
      .filter((r) => tasks.some((t) => t.taskOwnerResourceId === r.resourceId))
      .map((r) => `<option value="${escapeHtml(r.resourceId)}">${escapeHtml(r.fullName)}</option>`)
      .join("");
  owner.value = current;
}
function timelineDependencySvg(rows, start, px, width) {
  const index = new Map(rows.map((task, i) => [task.taskId, i])),
    left = (value) => {
      const parsed = PPMPlanning.parseDate(value);
      return parsed ? Math.max(0, Math.min(width, ((parsed - start) / 86400000) * px)) : 0;
    };
  let paths = "";
  rows.forEach((task, successorIndex) =>
    (task.dependencies || [])
      .filter((dep) => dep.scope === "Internal" && index.has(dep.predecessorTaskId))
      .forEach((dep) => {
        const predecessor = rows[index.get(dep.predecessorTaskId)],
          relationship = dep.relationship || "FS",
          predecessorDate =
            relationship[0] === "S"
              ? predecessor.forecastStartDate || predecessor.baselineStartDate
              : predecessor.forecastEndDate || predecessor.baselineEndDate,
          successorDate =
            relationship[1] === "S"
              ? task.forecastStartDate || task.baselineStartDate
              : task.forecastEndDate || task.baselineEndDate;
        if (!predecessorDate || !successorDate) return;
        const x1 = left(predecessorDate),
          x2 = left(successorDate),
          y1 = index.get(predecessor.taskId) * 42 + 21,
          y2 = successorIndex * 42 + 21,
          bend = Math.max(x1 + 14, (x1 + x2) / 2);
        paths += `<path d="M ${x1} ${y1} H ${bend} V ${y2} H ${x2}" fill="none" stroke="${task.criticalPath && predecessor.criticalPath ? "#dc2626" : "#7c3aed"}" stroke-width="${task.criticalPath && predecessor.criticalPath ? 2.2 : 1.5}" marker-end="url(#dependencyArrow)"><title>${escapeHtml(predecessor.taskName)} ${escapeHtml(relationship)} ${escapeHtml(task.taskName)}</title></path>`;
      })
  );
  return paths
    ? `<svg class="timeline-dependencies"${styleAttr(`left:250px;top:36px;width:${width}px;height:${rows.length * 42}px`)} viewBox="0 0 ${width} ${rows.length * 42}" aria-label="Dependency links"><defs><marker id="dependencyArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#7c3aed"></path></marker></defs>${paths}</svg>`
    : "";
}
function renderTimeline() {
  const rows = filteredTasks().filter((t) => t.forecastStartDate || t.baselineStartDate || t.actualStartDate);
  if (!rows.length) {
    document.getElementById("timelineContainer").innerHTML =
      '<div class="empty-message visible">No dated plan items are available for this view.</div>';
    return;
  }
  const zoom = document.getElementById("timelineZoom").value,
    unitDays = { Week: 7, Month: 30, Quarter: 91, Year: 365 }[zoom],
    unitWidth = { Week: 90, Month: 110, Quarter: 130, Year: 150 }[zoom],
    dates = rows
      .flatMap((t) => [
        t.baselineStartDate,
        t.baselineEndDate,
        t.forecastStartDate,
        t.forecastEndDate,
        t.actualStartDate,
        t.actualEndDate
      ])
      .filter(Boolean)
      .sort(),
    start = PPMPlanning.parseDate(dates[0]),
    end = PPMPlanning.parseDate(dates[dates.length - 1]);
  start.setDate(start.getDate() - 3);
  end.setDate(end.getDate() + 7);
  const totalDays = Math.max(1, Math.ceil((end - start) / 86400000)),
    width = Math.max(750, Math.ceil(totalDays / unitDays) * unitWidth),
    px = width / totalDays,
    leftFor = (value) => {
      const d = PPMPlanning.parseDate(value);
      return d ? Math.max(0, ((d - start) / 86400000) * px) : 0;
    },
    bar = (s, e, cls, task) => {
      if (!s) return "";
      const l = leftFor(s),
        r = leftFor(e || s),
        w = Math.max(task.taskType === "Milestone" ? 12 : r - l + px, 4);
      return `<span class="timeline-bar ${cls} ${task.criticalPath ? "critical" : ""} ${task.taskType === "Milestone" ? "milestone" : ""}"${styleAttr(`left:${l}px;width:${w}px`)} title="${escapeHtml(task.taskName)}"></span>`;
    };
  let units = "";
  for (let d = 0, index = 0; d <= totalDays; d += unitDays, index++) {
    const date = new Date(start);
    date.setDate(date.getDate() + d);
    units += `<span class="timeline-unit"${styleAttr(`left:${d * px}px;width:${unitWidth}px`)}>${date.toLocaleDateString("en-GB", { month: "short", year: zoom === "Year" ? "numeric" : undefined, day: zoom === "Week" ? "2-digit" : undefined })}</span>`;
  }
  const header = `<div class="timeline-header"><div class="timeline-label">Plan item</div><div class="timeline-grid"${styleAttr(`width:${width}px;--unit-width:${unitWidth}px`)}>${units}</div></div>`;
  const body = rows
      .map(
        (task) =>
          `<div class="timeline-row"><div class="timeline-label"${styleAttr(`padding-left:${12 + hierarchyIndent(task) * 14}px`)}>${task.criticalPath ? "◆ " : ""}${escapeHtml(task.taskName || task.taskId)}</div><div class="timeline-grid"${styleAttr(`width:${width}px;--unit-width:${unitWidth}px`)}>${bar(task.baselineStartDate, task.baselineEndDate, "baseline", task)}${bar(task.forecastStartDate, task.forecastEndDate, "forecast", task)}${bar(task.actualStartDate, task.actualEndDate, "actual", task)}</div></div>`
      )
      .join(""),
    links = timelineDependencySvg(rows, start, px, width);
  const container = document.getElementById("timelineContainer");
  container.innerHTML = `<div class="timeline"${styleAttr(`width:${width + 250}px`)}>${header}${body}${links}</div>`;
  /* Before paint: the dependency overlay is absolutely positioned and would flash
     across the page for a frame if its box arrived a turn later. */
  PPMCore.applyComputedStyles(container);
}
function applyArchiveMode() {
  if (!projectArchived) return;
  document.getElementById("addTaskButton").disabled = true;
  document.getElementById("approveBaselineButton").disabled = true;
  document.getElementById("requestRebaselineButton").disabled = true;
  document
    .querySelectorAll(".inline-field,[data-action='delete'],[data-action='add'],.dependency-button")
    .forEach((el) => (el.disabled = true));
  setClean();
  showMessage(
    `This project is archived${project.archiveReason || project.archivedReason ? `: ${project.archiveReason || project.archivedReason}` : ""}. The plan and baseline history are read-only until it is reopened.`,
    "warning"
  );
}
function openModal(id) {
  document.getElementById(id).classList.add("visible");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  document.getElementById(id).classList.remove("visible");
  document.body.style.overflow = "";
}
function openNotificationBaseline() {
  if (baselineDeepLinkHandled || params.get("view") !== "baseline") return;
  baselineDeepLinkHandled = true;
  openModal("baselineHistoryModal");
  const requestId = params.get("item") || "";
  if (!requestId) return;
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-request-id="${CSS.escape(requestId)}"]`)?.closest("tr");
    if (row) {
      row.classList.add("ppm-notification-target");
      row.scrollIntoView({ block: "center", inline: "center" });
    }
  });
}
function load() {
  PPMResources.ensureLegacyResources();
  project =
    readProjects().find((p) => String(p.projectCode).toLowerCase() === projectCode.toLowerCase()) || null;
  if (!project) {
    showMessage("Select a project from the Project Register to open its plan.", "error");
    document.getElementById("addTaskButton").disabled = true;
    return;
  }
  projectArchived = PPMGovernance.isArchived(project);
  const plans = readPlans();
  tasks = PPMPlanning.normalisePlan(plans[projectCode] || []);
  originalTasks = new Map(tasks.map((task) => [task.taskId, JSON.parse(JSON.stringify(task))]));
  PPMPlanning.calculateCriticalPath(tasks);
  document.title = `${project.projectName} Plan | PPM Tool`;
  document.getElementById("projectName").textContent = `${project.projectName} plan`;
  document.getElementById("projectDescription").textContent =
    `Maintain the delivery hierarchy and approved schedule for ${project.projectCode}.`;
  document.getElementById("detailsButton").href =
    `project-details.html?code=${encodeURIComponent(projectCode)}`;
  document.getElementById("milestonesNav").href = `milestones.html?code=${encodeURIComponent(projectCode)}`;
  document.getElementById("raidLogNav").href = `raid-log.html?code=${encodeURIComponent(projectCode)}`;
  document.getElementById("financialNav").href =
    `financial-management.html?project=${encodeURIComponent(projectCode)}`;
  document.getElementById("auditNav").href = `audit-history.html?project=${encodeURIComponent(projectCode)}`;
  renderFilters();
  renderBaselineGovernance();
  setClean();
  renderTable();
  openNotificationBaseline();
}
document.getElementById("addTaskButton").addEventListener("click", appendTask);
document.getElementById("savePlanButton").addEventListener("click", savePlan);
["taskSearch", "phaseFilter", "typeFilter", "statusFilter", "ownerFilter", "planView"].forEach((id) =>
  document.getElementById(id).addEventListener(id === "taskSearch" ? "input" : "change", renderTable)
);
document.getElementById("timelineZoom").addEventListener("change", renderTimeline);
document
  .getElementById("closeDependencyModal")
  .addEventListener("click", () => closeModal("dependencyModal"));
document
  .getElementById("cancelDependencyButton")
  .addEventListener("click", () => closeModal("dependencyModal"));
document.getElementById("addDependencyButton").addEventListener("click", () => {
  dependencyDraft.push(PPMPlanning.normaliseDependency({}));
  renderDependencyRows();
});
document.getElementById("saveDependenciesButton").addEventListener("click", saveDependencies);
document
  .getElementById("approveBaselineButton")
  .addEventListener("click", () => openBaselineDecision("approveInitial"));
document.getElementById("requestRebaselineButton").addEventListener("click", openRebaseline);
document.getElementById("baselineHistoryButton").addEventListener("click", () => {
  renderBaselineGovernance();
  openModal("baselineHistoryModal");
});
document
  .getElementById("closeBaselineDecision")
  .addEventListener("click", () => closeModal("baselineDecisionModal"));
document
  .getElementById("cancelBaselineDecision")
  .addEventListener("click", () => closeModal("baselineDecisionModal"));
document.getElementById("baselineDecisionForm").addEventListener("submit", submitBaselineDecision);
document.getElementById("closeRebaseline").addEventListener("click", () => closeModal("rebaselineModal"));
document.getElementById("cancelRebaseline").addEventListener("click", () => closeModal("rebaselineModal"));
document.getElementById("rebaselineForm").addEventListener("submit", submitRebaseline);
document
  .getElementById("closeBaselineHistory")
  .addEventListener("click", () => closeModal("baselineHistoryModal"));
document
  .getElementById("doneBaselineHistory")
  .addEventListener("click", () => closeModal("baselineHistoryModal"));
document.getElementById("cancelDelete").addEventListener("click", closeDelete);
document.getElementById("confirmDelete").addEventListener("click", confirmDelete);
window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});
load();
