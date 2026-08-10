"use strict";

const pageParameters = new URLSearchParams(window.location.search);
let projectCode = pageParameters.get("code") || "";
let pendingFocusMilestoneId = pageParameters.get("item") || "";
let projects = [];
let project = null;
let projectArchived = false;
let projectMilestones = [];
let editingMilestoneId = null;
let hasUnsavedMilestoneChanges = false;
let dirtyMilestoneIds = new Set();
let pendingDeleteMilestoneId = null;
let originalMilestones = new Map();
let deletedMilestones = new Map();

// Cells tracked in the change history, with the labels users see in the timeline.
const MILESTONE_AUDIT_FIELDS = [
  { key: "milestoneName", label: "Milestone" },
  { key: "baselineStartDate", label: "Baseline start" },
  { key: "baselineFinishDate", label: "Baseline finish" },
  { key: "forecastStartDate", label: "Forecast start" },
  { key: "forecastFinishDate", label: "Forecast finish" },
  { key: "percentageComplete", label: "Complete (%)" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" }
];

const parseStoredJson = (key, fallback) => PPMCore.readJson(key, fallback);

function getProjects() {
  const items = parseStoredJson("ppmProjects", []);
  return Array.isArray(items) ? items : [];
}

function getMilestoneStore() {
  const store = parseStoredJson("ppmProjectMilestones", {});
  return store && typeof store === "object" && !Array.isArray(store) ? store : {};
}

// Formal lifecycle gates are governed on stage-gates.html. Any legacy row that was
// typed "Stage Gate" here becomes a plain delivery milestone, keeping all other values.
async function migrateLegacyStageGateRows() {
  const store = getMilestoneStore();
  let changed = 0;
  Object.values(store).forEach((rows) => {
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      if (row && typeof row === "object" && row.milestoneType !== "Milestone") {
        row.milestoneType = "Milestone";
        changed += 1;
      }
    });
  });
  /* Stage 16: awaited, and the count is only reported once the database has it. */
  if (!changed) return 0;
  const saved = await window.PPMStore?.milestones.replaceAll(store);
  if (saved && saved.ok === false) throw new Error(saved.message);
  return changed;
}

async function saveMilestones() {
  if (projectArchived) return false;
  const store = getMilestoneStore();
  store[projectCode] = projectMilestones;
  if (!window.PPMStore) return false;
  const saved = await window.PPMStore.milestones.replaceAll(store);
  if (saved && saved.ok === false) {
    showMessage(saved.message, "error");
    return false;
  }
  return true;
}

const escapeHtml = PPMCore.escapeHtml;

const todayIso = PPMCore.todayIso;

function calculateStatus(milestone) {
  const percentage = Math.min(100, Math.max(0, Number(milestone.percentageComplete) || 0));
  if (percentage >= 100) return "Complete";

  const slippedStart =
    milestone.baselineStartDate &&
    milestone.forecastStartDate &&
    milestone.forecastStartDate > milestone.baselineStartDate;
  const slippedFinish =
    milestone.baselineFinishDate &&
    milestone.forecastFinishDate &&
    milestone.forecastFinishDate > milestone.baselineFinishDate;
  const missedForecast = milestone.forecastFinishDate && todayIso() > milestone.forecastFinishDate;

  if (slippedStart || slippedFinish || missedForecast) return "Overdue";
  if (percentage > 0 || (milestone.forecastStartDate && todayIso() >= milestone.forecastStartDate))
    return "In Progress";
  return "Not Started";
}

function statusClass(status) {
  return status.toLowerCase().replace(" ", "-");
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "Invalid date"
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function showMessage(text, type) {
  const message = document.getElementById("pageMessage");
  message.textContent = text;
  message.className = `message ${type}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearMessage() {
  const message = document.getElementById("pageMessage");
  message.textContent = "";
  message.className = "message";
}

function renderSelectOptions(values, selectedValue) {
  return values
    .map((value) => {
      const selected = value === selectedValue ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
    })
    .join("");
}

function setMilestoneDirty(isDirty) {
  hasUnsavedMilestoneChanges = isDirty;
  if (!isDirty) dirtyMilestoneIds = new Set();
  const saveButton = document.getElementById("saveMilestonesButton");
  const indicator = document.getElementById("milestoneUnsavedIndicator");
  saveButton.disabled = !isDirty || !project;
  saveButton.textContent = isDirty ? "Save changes" : "Saved";
  indicator.textContent = isDirty ? "Unsaved changes" : "All changes saved";
  indicator.classList.toggle("dirty", isDirty);
}

function markMilestoneDirty(milestoneId) {
  dirtyMilestoneIds.add(milestoneId);
  setMilestoneDirty(true);
  const row = document.querySelector(`tr[data-milestone-id="${CSS.escape(milestoneId)}"]`);
  if (row) row.classList.add("dirty-row");
}

function populateProjectSelector() {
  const selector = document.getElementById("projectSelector");
  selector.innerHTML = '<option value="">Select a project</option>';
  [...projects]
    .sort((first, second) => String(first.projectName || "").localeCompare(String(second.projectName || "")))
    .forEach((item) => {
      const option = document.createElement("option");
      option.value = item.projectCode;
      option.textContent = `${item.projectCode} — ${item.projectName}`;
      selector.appendChild(option);
    });
  selector.value = projectCode;
}

function loadSelectedProject() {
  project =
    projects.find((item) => String(item.projectCode).toLowerCase() === String(projectCode).toLowerCase()) ||
    null;

  if (!project) {
    projectArchived = false;
    projectCode = "";
    projectMilestones = [];
    document.getElementById("projectSelector").value = "";
    document.getElementById("pageTitle").textContent = "Project milestones";
    document.getElementById("pageDescription").textContent =
      "Select a project to maintain its delivery milestones.";
    document.getElementById("projectContext").textContent =
      "Choose a project to view its milestone schedule.";
    document.getElementById("emptyMilestoneMessage").textContent =
      "Select a project, then add its first milestone row.";
    document.getElementById("addMilestoneButton").disabled = true;
    setMilestoneDirty(false);
    document.getElementById("projectDetailsButton").href = "index.html";
    document.getElementById("projectDetailsButton").textContent = "Back to projects";
    document.getElementById("raidNavigation").href = "raid-log.html";
    renderMilestones();
    return;
  }

  projectArchived = PPMGovernance.isArchived(project);

  const store = getMilestoneStore();
  projectMilestones = Array.isArray(store[projectCode]) ? store[projectCode] : [];
  document.title = `${project.projectName} Milestones | PPM Tool`;
  document.getElementById("pageTitle").textContent = `${project.projectName} milestones`;
  document.getElementById("pageDescription").textContent =
    `Maintain delivery milestones for ${project.projectCode}.`;
  document.getElementById("projectContext").textContent =
    `${project.workstream || "No workstream"} programme · ${project.currentStage || "No current stage"} · ${project.projectStatus || "No project status"}`;
  document.getElementById("emptyMilestoneMessage").textContent =
    "No milestones have been added for this project.";
  const gatesLink = document.getElementById("stageGatesLink");
  if (gatesLink) gatesLink.href = `stage-gates.html?code=${encodeURIComponent(projectCode)}`;
  document.getElementById("addMilestoneButton").disabled = false;
  document.getElementById("projectDetailsButton").href =
    `project-details.html?code=${encodeURIComponent(projectCode)}`;
  document.getElementById("projectDetailsButton").textContent = "Project details";
  document.getElementById("raidNavigation").href = `raid-log.html?code=${encodeURIComponent(projectCode)}`;
  refreshCalculatedStatuses();
  originalMilestones = new Map(
    projectMilestones.map((item) => [item.milestoneId, JSON.parse(JSON.stringify(item))])
  );
  deletedMilestones.clear();
  setMilestoneDirty(false);
  renderMilestones();
  applyArchivedMilestoneMode();
}

function applyArchivedMilestoneMode() {
  if (!projectArchived) return;
  document.getElementById("addMilestoneButton").disabled = true;
  document.getElementById("saveMilestonesButton").disabled = true;
  document.getElementById("saveMilestonesButton").textContent = "Read-only";
  document
    .querySelectorAll(".inline-field, .delete-milestone, .add-inline-milestone")
    .forEach((control) => (control.disabled = true));
  showMessage(
    `This project was archived${project.archiveReason || project.archivedReason ? `: ${project.archiveReason || project.archivedReason}` : ""}. Its milestones are read-only until the project is reopened from the Project Register.`,
    "warning"
  );
}

async function refreshCalculatedStatuses() {
  let changed = false;
  projectMilestones.forEach((milestone) => {
    const status = calculateStatus(milestone);
    if (milestone.status !== status) {
      milestone.status = status;
      milestone.statusUpdatedAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed && !projectArchived) await saveMilestones();
}

function filteredMilestones() {
  const search = document.getElementById("milestoneSearch").value.trim().toLowerCase();
  const status = document.getElementById("milestoneStatusFilter").value;
  return projectMilestones.filter((milestone) => {
    const calculatedStatus = calculateStatus(milestone);
    const searchable = [milestone.milestoneName, milestone.notes].join(" ").toLowerCase();
    return (!search || searchable.includes(search)) && (!status || calculatedStatus === status);
  });
}

function renderMilestones() {
  const rows = filteredMilestones();
  const tableBody = document.getElementById("milestoneTableBody");
  tableBody.innerHTML = rows
    .map((milestone) => {
      const status = calculateStatus(milestone);
      const percentage = Math.min(100, Math.max(0, Number(milestone.percentageComplete) || 0));
      return `
          <tr data-milestone-id="${escapeHtml(milestone.milestoneId)}" class="${status === "Overdue" ? "overdue" : ""} ${dirtyMilestoneIds.has(milestone.milestoneId) ? "dirty-row" : ""}">
            <td><input type="text" class="inline-field inline-name" data-field="milestoneName" data-id="${escapeHtml(milestone.milestoneId)}" aria-label="Milestone name" value="${escapeHtml(milestone.milestoneName)}"></td>
            <td><input type="date" class="inline-field inline-date" data-field="baselineStartDate" data-id="${escapeHtml(milestone.milestoneId)}" aria-label="Baseline start date" value="${escapeHtml(milestone.baselineStartDate)}"></td>
            <td><input type="date" class="inline-field inline-date" data-field="baselineFinishDate" data-id="${escapeHtml(milestone.milestoneId)}" aria-label="Baseline finish date" value="${escapeHtml(milestone.baselineFinishDate)}"></td>
            <td><input type="date" class="inline-field inline-date" data-field="forecastStartDate" data-id="${escapeHtml(milestone.milestoneId)}" aria-label="Forecast start date" value="${escapeHtml(milestone.forecastStartDate)}"></td>
            <td><input type="date" class="inline-field inline-date" data-field="forecastFinishDate" data-id="${escapeHtml(milestone.milestoneId)}" aria-label="Forecast finish date" value="${escapeHtml(milestone.forecastFinishDate)}"></td>
            <td><input type="number" class="inline-field inline-number" data-field="percentageComplete" data-id="${escapeHtml(milestone.milestoneId)}" aria-label="Percentage complete" min="0" max="100" step="1" value="${escapeHtml(percentage)}"></td>
            <td><span class="badge ${statusClass(status)}" data-status>${status}</span></td>
            <td><textarea class="inline-field inline-notes" data-field="notes" data-id="${escapeHtml(milestone.milestoneId)}" aria-label="Milestone notes" placeholder="Add notes">${escapeHtml(milestone.notes || "")}</textarea></td>
            <td><div class="row-actions">${PPMChangeLog.historyButton("Milestone", milestone.milestoneId, milestone.milestoneName || milestone.milestoneId)}<button type="button" class="button danger small delete-milestone" data-permission="milestones.edit" data-id="${escapeHtml(milestone.milestoneId)}">Delete</button></div></td>
          </tr>
        `;
    })
    .join("");

  if (project && !projectArchived) {
    tableBody.insertAdjacentHTML(
      "beforeend",
      '<tr class="add-row"><td colspan="9"><button type="button" class="add-row-button add-inline-milestone" data-permission="milestones.edit">+ Add milestone row</button></td></tr>'
    );
  }

  document.getElementById("emptyMilestoneMessage").style.display = rows.length ? "none" : "block";
  updateMilestoneSummary();

  document.querySelectorAll(".inline-field").forEach((field) => {
    const eventName = field.tagName === "SELECT" || field.type === "date" ? "change" : "input";
    field.addEventListener(eventName, handleInlineMilestoneChange);
  });
  document
    .querySelectorAll(".delete-milestone")
    .forEach((button) => button.addEventListener("click", () => deleteMilestone(button.dataset.id)));
  document
    .querySelectorAll(".add-inline-milestone")
    .forEach((button) => button.addEventListener("click", appendInlineMilestone));
  applyArchivedMilestoneMode();
  if (pendingFocusMilestoneId) {
    const row = document.querySelector(`[data-milestone-id="${CSS.escape(pendingFocusMilestoneId)}"]`);
    if (row) {
      pendingFocusMilestoneId = "";
      row.classList.add("ppm-notification-target");
      requestAnimationFrame(() => row.scrollIntoView({ block: "center", inline: "center" }));
    }
  }
}

function updateMilestoneSummary() {
  document.getElementById("totalMilestones").textContent = projectMilestones.length;
  document.getElementById("completeMilestones").textContent = projectMilestones.filter(
    (item) => calculateStatus(item) === "Complete"
  ).length;
  document.getElementById("inProgressMilestones").textContent = projectMilestones.filter(
    (item) => calculateStatus(item) === "In Progress"
  ).length;
  document.getElementById("overdueMilestones").textContent = projectMilestones.filter(
    (item) => calculateStatus(item) === "Overdue"
  ).length;
}

function handleInlineMilestoneChange(event) {
  if (projectArchived) return;
  const field = event.currentTarget;
  const milestone = projectMilestones.find((item) => item.milestoneId === field.dataset.id);
  if (!milestone) return;
  const property = field.dataset.field;
  milestone[property] =
    property === "percentageComplete" ? (field.value === "" ? "" : Number(field.value)) : field.value;
  milestone.status = calculateStatus(milestone);
  const row = field.closest("tr");
  row.classList.toggle("overdue", milestone.status === "Overdue");
  const badge = row.querySelector("[data-status]");
  badge.textContent = milestone.status;
  badge.className = `badge ${statusClass(milestone.status)}`;
  markMilestoneDirty(milestone.milestoneId);
  updateMilestoneSummary();
  clearMessage();
}

function generateMilestoneId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `MILESTONE-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function appendInlineMilestone() {
  if (!project || projectArchived) return;
  document.getElementById("milestoneSearch").value = "";
  document.getElementById("milestoneStatusFilter").value = "";
  const now = new Date().toISOString();
  const milestone = {
    milestoneId: generateMilestoneId(),
    projectCode,
    milestoneName: "",
    milestoneType: "Milestone",
    percentageComplete: 0,
    baselineStartDate: "",
    baselineFinishDate: "",
    forecastStartDate: "",
    forecastFinishDate: "",
    notes: "",
    status: "Not Started",
    createdAt: now,
    updatedAt: now
  };
  projectMilestones.push(milestone);
  dirtyMilestoneIds.add(milestone.milestoneId);
  setMilestoneDirty(true);
  renderMilestones();
  requestAnimationFrame(() => {
    const field = document.querySelector(
      `[data-id="${CSS.escape(milestone.milestoneId)}"][data-field="milestoneName"]`
    );
    if (field) {
      field.scrollIntoView({ block: "nearest", inline: "center" });
      field.focus();
    }
  });
}

function setFieldValue(id, value) {
  document.getElementById(id).value = value ?? "";
}

function showMilestoneModal() {
  document.getElementById("milestoneModal").classList.add("visible");
  document.body.style.overflow = "hidden";
  document.getElementById("milestoneName").focus();
}

function closeMilestoneModal() {
  document.getElementById("milestoneModal").classList.remove("visible");
  document.body.style.overflow = "";
  editingMilestoneId = null;
}

function openAddMilestone() {
  if (!project || projectArchived) return;
  editingMilestoneId = null;
  document.getElementById("milestoneForm").reset();
  document.getElementById("milestonePercentage").value = 0;
  document.getElementById("milestoneModalTitle").textContent = "Add milestone";
  updateStatusPreview();
  showMilestoneModal();
}

function openEditMilestone(milestoneId) {
  if (projectArchived) return;
  const milestone = projectMilestones.find((item) => item.milestoneId === milestoneId);
  if (!milestone) return;
  editingMilestoneId = milestoneId;
  document.getElementById("milestoneModalTitle").textContent = "Edit milestone";
  setFieldValue("milestoneName", milestone.milestoneName);
  setFieldValue("milestonePercentage", milestone.percentageComplete ?? 0);
  setFieldValue("baselineStartDate", milestone.baselineStartDate);
  setFieldValue("baselineFinishDate", milestone.baselineFinishDate);
  setFieldValue("forecastStartDate", milestone.forecastStartDate);
  setFieldValue("forecastFinishDate", milestone.forecastFinishDate);
  setFieldValue("milestoneNotes", milestone.notes);
  updateStatusPreview();
  showMilestoneModal();
}

function milestoneFromForm() {
  return {
    milestoneId:
      editingMilestoneId ||
      (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `MILESTONE-${Date.now()}`),
    projectCode,
    milestoneName: document.getElementById("milestoneName").value.trim(),
    milestoneType: "Milestone",
    percentageComplete: Number(document.getElementById("milestonePercentage").value),
    baselineStartDate: document.getElementById("baselineStartDate").value,
    baselineFinishDate: document.getElementById("baselineFinishDate").value,
    forecastStartDate: document.getElementById("forecastStartDate").value,
    forecastFinishDate: document.getElementById("forecastFinishDate").value,
    notes: document.getElementById("milestoneNotes").value.trim()
  };
}

function validateMilestoneDates(milestone) {
  if (milestone.baselineFinishDate < milestone.baselineStartDate) {
    showMessage("Baseline finish date cannot be before baseline start date.", "error");
    return false;
  }
  if (milestone.forecastFinishDate < milestone.forecastStartDate) {
    showMessage("Forecast finish date cannot be before forecast start date.", "error");
    return false;
  }
  return true;
}

function showMilestoneValidationError(milestone, property, message) {
  showMessage(message, "error");
  const field = document.querySelector(
    `[data-id="${CSS.escape(milestone.milestoneId)}"][data-field="${property}"]`
  );
  if (field) field.focus();
  return false;
}

function validateInlineMilestones() {
  for (let index = 0; index < projectMilestones.length; index += 1) {
    const milestone = projectMilestones[index];
    const rowName = String(milestone.milestoneName || "").trim();
    milestone.milestoneName = rowName;
    milestone.notes = String(milestone.notes || "").trim();
    if (!rowName)
      return showMilestoneValidationError(milestone, "milestoneName", `Milestone ${index + 1} needs a name.`);
    milestone.milestoneType = "Milestone";

    const percentage = Number(milestone.percentageComplete);
    if (
      milestone.percentageComplete === "" ||
      Number.isNaN(percentage) ||
      percentage < 0 ||
      percentage > 100
    ) {
      return showMilestoneValidationError(
        milestone,
        "percentageComplete",
        `${rowName} needs a completion value between 0 and 100%.`
      );
    }
    milestone.percentageComplete = percentage;

    for (const [property, label] of [
      ["baselineStartDate", "baseline start date"],
      ["baselineFinishDate", "baseline finish date"],
      ["forecastStartDate", "forecast start date"],
      ["forecastFinishDate", "forecast finish date"]
    ]) {
      if (!milestone[property])
        return showMilestoneValidationError(milestone, property, `${rowName} needs a ${label}.`);
    }

    if (milestone.baselineFinishDate < milestone.baselineStartDate)
      return showMilestoneValidationError(
        milestone,
        "baselineFinishDate",
        `${rowName} has a baseline finish before its start.`
      );
    if (milestone.forecastFinishDate < milestone.forecastStartDate)
      return showMilestoneValidationError(
        milestone,
        "forecastFinishDate",
        `${rowName} has a forecast finish before its start.`
      );

    const now = new Date().toISOString();
    milestone.status = calculateStatus(milestone);
    milestone.statusUpdatedAt = now;
    if (dirtyMilestoneIds.has(milestone.milestoneId)) milestone.updatedAt = now;
    milestone.createdAt = milestone.createdAt || now;
  }
  return true;
}

async function saveInlineMilestones() {
  if (projectArchived) {
    applyArchivedMilestoneMode();
    return;
  }
  if (!hasUnsavedMilestoneChanges || !project) return;
  if (!validateInlineMilestones()) return;
  await saveMilestones();
  // Records created, updated and deleted rows in one pass, cell by cell.
  PPMChangeLog.trackCollection({
    before: originalMilestones,
    after: projectMilestones,
    idField: "milestoneId",
    only: dirtyMilestoneIds,
    entityType: "Milestone",
    projectCode,
    fields: MILESTONE_AUDIT_FIELDS,
    statusField: "status",
    name: (row) => row.milestoneName || row.milestoneId
  });
  originalMilestones = new Map(
    projectMilestones.map((item) => [item.milestoneId, JSON.parse(JSON.stringify(item))])
  );
  deletedMilestones.clear();
  setMilestoneDirty(false);
  renderMilestones();
  showMessage("Milestone changes were saved.", "success");
}

async function saveMilestone(event) {
  event.preventDefault();
  if (projectArchived) {
    closeMilestoneModal();
    applyArchivedMilestoneMode();
    return;
  }
  clearMessage();
  const form = event.currentTarget;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const milestone = milestoneFromForm();
  if (!validateMilestoneDates(milestone)) return;
  if (
    Number.isNaN(milestone.percentageComplete) ||
    milestone.percentageComplete < 0 ||
    milestone.percentageComplete > 100
  ) {
    showMessage("Percentage complete must be between 0 and 100.", "error");
    return;
  }

  const now = new Date().toISOString();
  milestone.status = calculateStatus(milestone);
  milestone.statusUpdatedAt = now;

  const beforeAudit = editingMilestoneId
    ? JSON.parse(
        JSON.stringify(projectMilestones.find((item) => item.milestoneId === editingMilestoneId) || {})
      )
    : null;
  if (editingMilestoneId) {
    const index = projectMilestones.findIndex((item) => item.milestoneId === editingMilestoneId);
    const existing = projectMilestones[index];
    projectMilestones[index] = {
      ...existing,
      ...milestone,
      createdAt: existing.createdAt || now,
      updatedAt: now
    };
    showMessage(`${milestone.milestoneName} was updated.`, "success");
  } else {
    projectMilestones.push({ ...milestone, createdAt: now, updatedAt: now });
    showMessage(`${milestone.milestoneName} was added.`, "success");
  }

  await saveMilestones();
  const savedMilestone = projectMilestones.find((item) => item.milestoneId === milestone.milestoneId);
  PPMChangeLog.recordRow({
    before: beforeAudit,
    after: savedMilestone,
    entityType: "Milestone",
    entityId: milestone.milestoneId,
    projectCode,
    fields: MILESTONE_AUDIT_FIELDS,
    statusField: "status",
    name: milestone.milestoneName
  });
  originalMilestones = new Map(
    projectMilestones.map((item) => [item.milestoneId, JSON.parse(JSON.stringify(item))])
  );
  closeMilestoneModal();
  renderMilestones();
}

function deleteMilestone(milestoneId) {
  if (projectArchived) return;
  const milestone = projectMilestones.find((item) => item.milestoneId === milestoneId);
  if (!milestone) return;
  pendingDeleteMilestoneId = milestoneId;
  const name = String(milestone.milestoneName || "").trim() || "this milestone row";
  document.getElementById("deleteMilestoneMessage").textContent =
    `Delete ${name}? The row will be removed when you save your changes.`;
  document.getElementById("deleteMilestoneConfirmation").classList.add("visible");
  document.body.style.overflow = "hidden";
  document.getElementById("cancelDeleteMilestoneButton").focus();
}

function closeDeleteMilestoneConfirmation() {
  document.getElementById("deleteMilestoneConfirmation").classList.remove("visible");
  document.body.style.overflow = "";
  pendingDeleteMilestoneId = null;
}

function confirmDeleteMilestone() {
  if (projectArchived) {
    closeDeleteMilestoneConfirmation();
    return;
  }
  const milestone = projectMilestones.find((item) => item.milestoneId === pendingDeleteMilestoneId);
  if (!milestone) {
    closeDeleteMilestoneConfirmation();
    return;
  }
  const milestoneId = milestone.milestoneId;
  const name = String(milestone.milestoneName || "").trim() || "Milestone row";
  deletedMilestones.set(milestoneId, JSON.parse(JSON.stringify(milestone)));
  projectMilestones = projectMilestones.filter((item) => item.milestoneId !== milestoneId);
  closeDeleteMilestoneConfirmation();
  dirtyMilestoneIds.add(milestoneId);
  setMilestoneDirty(true);
  renderMilestones();
  showMessage(`${name} was removed. Select Save changes to confirm.`, "success");
}

function updateStatusPreview() {
  const milestone = milestoneFromForm();
  const status = calculateStatus(milestone);
  const preview = document.getElementById("milestoneStatusPreview");
  preview.textContent = status;
  preview.className = `badge status-preview ${statusClass(status)}`;
}

document.getElementById("projectSelector").addEventListener("change", function () {
  if (hasUnsavedMilestoneChanges) {
    this.value = projectCode;
    showMessage("Save the current milestone changes before switching project.", "error");
    return;
  }
  projectCode = this.value;
  const url = projectCode ? `milestones.html?code=${encodeURIComponent(projectCode)}` : "milestones.html";
  window.history.replaceState({}, "", url);
  clearMessage();
  loadSelectedProject();
});
document.getElementById("addMilestoneButton").addEventListener("click", appendInlineMilestone);
document.getElementById("saveMilestonesButton").addEventListener("click", saveInlineMilestones);
document
  .getElementById("cancelDeleteMilestoneButton")
  .addEventListener("click", closeDeleteMilestoneConfirmation);
document.getElementById("confirmDeleteMilestoneButton").addEventListener("click", confirmDeleteMilestone);
document.getElementById("closeMilestoneModalButton").addEventListener("click", closeMilestoneModal);
document.getElementById("cancelMilestoneButton").addEventListener("click", closeMilestoneModal);
document.getElementById("milestoneForm").addEventListener("submit", saveMilestone);
document.getElementById("milestoneSearch").addEventListener("input", renderMilestones);
document.getElementById("milestoneStatusFilter").addEventListener("change", renderMilestones);
[
  "milestonePercentage",
  "baselineStartDate",
  "baselineFinishDate",
  "forecastStartDate",
  "forecastFinishDate"
].forEach((id) => document.getElementById(id).addEventListener("input", updateStatusPreview));
document.getElementById("milestoneModal").addEventListener("click", function (event) {
  if (event.target === this) closeMilestoneModal();
});
document.getElementById("deleteMilestoneConfirmation").addEventListener("click", function (event) {
  if (event.target === this) closeDeleteMilestoneConfirmation();
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    document.getElementById("deleteMilestoneConfirmation").classList.contains("visible")
  )
    closeDeleteMilestoneConfirmation();
  else if (event.key === "Escape" && document.getElementById("milestoneModal").classList.contains("visible"))
    closeMilestoneModal();
});
window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedMilestoneChanges) return;
  event.preventDefault();
  event.returnValue = "";
});

async function initialiseMilestonesPage() {
  if (window.PPMChildDatabase?.ready) await PPMChildDatabase.ready;
  await migrateLegacyStageGateRows();
  projects = getProjects();
  populateProjectSelector();
  loadSelectedProject();
}

initialiseMilestonesPage().catch(async (error) => {
  console.error("Milestones: database hydration did not complete cleanly; using the local copy.", error);
  await migrateLegacyStageGateRows();
  projects = getProjects();
  populateProjectSelector();
  loadSelectedProject();
});
