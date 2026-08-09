"use strict";

const RAID_STORAGE_KEY = "ppmProjectRaid";
const pageParameters = new URLSearchParams(window.location.search);
const requestedProjectId = pageParameters.get("code") || "";
const requestedRaidId = pageParameters.get("item") || "";

if (requestedProjectId) {
  document.getElementById("milestonesNavigation").href = `milestones.html?code=${encodeURIComponent(
    requestedProjectId
  )}`;
}

let projects = getProjects();
let raidStore = getRaidStore();
let editingRaidId = null;
let pendingDeleteRaidId = null;
let hasUnsavedRaidChanges = false;
let dirtyRaidIds = new Set();
let originalRaidItems = new Map();
let deletedRaidItems = new Map();

const commonFieldIds = [
  "raidId",
  "raidType",
  "projectId",
  "raidTitle",
  "raidStatus",
  "raidDescription",
  "dateRaised",
  "targetDate",
  "raidPriority",
  "escalationStatus",
  "lastReviewedDate",
  "relatedTasks",
  "relatedActions",
  "attachments",
  "raidComments",
  "dateClosed",
  "closureEvidence"
];

const riskFieldIds = [
  "riskCause",
  "riskEvent",
  "riskEffect",
  "inherentProbability",
  "inherentImpact",
  "inherentScore",
  "mitigation",
  "contingency",
  "residualProbability",
  "residualImpact",
  "residualScore",
  "riskAppetitePosition",
  "escalationThreshold",
  "riskTrend",
  "reviewFrequency"
];

const issueFieldIds = [
  "dateIdentified",
  "businessImpact",
  "deliveryImpact",
  "rootCause",
  "resolutionPlan",
  "expectedResolutionDate",
  "actualResolutionDate",
  "workaround",
  "decisionRequired"
];

const dependencyFieldIds = [
  "dependencyScope",
  "dependencyDirection",
  "provider",
  "recipient",
  "requiredByDate",
  "dependencyConfidence",
  "impactIfMissed",
  "relatedProject",
  "relatedMilestone",
  "acceptanceCriteria"
];

function getProjects() {
  const storedProjects = localStorage.getItem("ppmProjects");
  if (!storedProjects) return [];

  try {
    const parsed = JSON.parse(storedProjects);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Projects could not be loaded.", error);
    return [];
  }
}

function getRaidStore() {
  const storedRaid = localStorage.getItem(RAID_STORAGE_KEY);
  if (!storedRaid) return {};

  try {
    return normaliseRaidStore(JSON.parse(storedRaid));
  } catch (error) {
    console.error("RAID items could not be loaded.", error);
    return {};
  }
}

function normaliseRaidStore(value) {
  const normalised = {};

  if (Array.isArray(value)) {
    value.forEach((item) =>
      addNormalisedItem(normalised, item, item && (item.projectId || item.projectCode))
    );
    return normalised;
  }

  if (!value || typeof value !== "object") return normalised;

  Object.entries(value).forEach(([projectId, items]) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => addNormalisedItem(normalised, item, projectId));
  });

  return normalised;
}

function addNormalisedItem(store, item, fallbackProjectId) {
  if (!item || typeof item !== "object") return;
  const projectId = String(item.projectId || item.projectCode || fallbackProjectId || "").trim();
  if (!projectId) return;
  if (!Array.isArray(store[projectId])) store[projectId] = [];
  store[projectId].push({ ...item, projectId });
}

function saveRaidStore() {
  localStorage.setItem(RAID_STORAGE_KEY, JSON.stringify(raidStore));
}

function getAllRaidItems() {
  return Object.values(raidStore)
    .filter(Array.isArray)
    .flat()
    .filter((item) => item && typeof item === "object");
}

function getProject(projectId) {
  return projects.find(
    (project) => String(project.projectCode || "").toLowerCase() === String(projectId || "").toLowerCase()
  );
}

function isArchivedProject(projectId) {
  const linkedProject = getProject(projectId);
  return Boolean(linkedProject && PPMGovernance.isArchived(linkedProject));
}

function findRaidItem(raidId) {
  return getAllRaidItems().find((item) => item.raidId === raidId) || null;
}

function populateRaidPeople(item = {}) {
  PPMResources.populatePersonSelect("raidOwner", {
    selectedResourceId: item.ownerResourceId,
    legacyName: item.owner,
    blankLabel: "Select an owner"
  });

  PPMResources.populatePersonSelect("raisedBy", {
    selectedResourceId: item.raisedByResourceId,
    legacyName: item.raisedBy,
    blankLabel: "Select who raised the item"
  });

  PPMResources.populatePersonSelect("resolutionOwner", {
    selectedResourceId: item.resolutionOwnerResourceId,
    legacyName: item.resolutionOwner,
    blankLabel: "Select a resolution owner"
  });
}

const escapeHtml = PPMCore.escapeHtml;

function renderOptions(values, selectedValue, blankLabel) {
  const blank =
    blankLabel === undefined
      ? ""
      : `<option value=""${selectedValue ? "" : " selected"}>${escapeHtml(blankLabel)}</option>`;
  return (
    blank +
    values
      .map((value) => {
        const selected = value === selectedValue ? " selected" : "";
        return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
      })
      .join("")
  );
}

function renderProjectOptionMarkup(selectedProjectId) {
  return (
    '<option value="">Select project</option>' +
    projects
      .slice()
      .sort((a, b) => String(a.projectCode || "").localeCompare(String(b.projectCode || "")))
      .map((project) => {
        const projectId = String(project.projectCode || "");
        const selected = projectId === selectedProjectId ? " selected" : "";
        const archived = PPMGovernance.isArchived(project);
        const disabled = archived && !selected ? " disabled" : "";
        const suffix = archived ? " (Archived)" : "";
        return `<option value="${escapeHtml(projectId)}"${selected}${disabled}>${escapeHtml(`${projectId} - ${project.projectName || "Unnamed project"}${suffix}`)}</option>`;
      })
      .join("")
  );
}

function setRaidDirty(isDirty) {
  hasUnsavedRaidChanges = isDirty;
  if (!isDirty) dirtyRaidIds = new Set();
  const saveButton = document.getElementById("saveRaidChangesButton");
  const indicator = document.getElementById("raidUnsavedIndicator");
  saveButton.disabled = !isDirty;
  saveButton.textContent = isDirty ? "Save changes" : "Saved";
  indicator.textContent = isDirty ? "Unsaved changes" : "All changes saved";
  indicator.classList.toggle("dirty", isDirty);
}

function markRaidDirty(raidId) {
  dirtyRaidIds.add(raidId);
  setRaidDirty(true);
  const row = document.querySelector(`tr[data-raid-id="${CSS.escape(raidId)}"]`);
  if (row) row.classList.add("dirty-row");
}

function captureRaidSnapshot() {
  originalRaidItems = new Map(
    getAllRaidItems().map((item) => [item.raidId, JSON.parse(JSON.stringify(item))])
  );
}

function rebuildRaidStoreByProject() {
  const rebuilt = {};
  getAllRaidItems().forEach((item) => {
    const projectId = String(item.projectId || "").trim();
    if (!projectId) return;
    if (!Array.isArray(rebuilt[projectId])) rebuilt[projectId] = [];
    rebuilt[projectId].push(item);
  });
  raidStore = rebuilt;
}

function todayValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isClosed(item) {
  return String(item.status || "").toLowerCase() === "closed";
}

function reviewIntervalDays(frequency) {
  return { Weekly: 7, Fortnightly: 14, Monthly: 31, Quarterly: 92 }[frequency] || 0;
}

function isReviewOverdue(item) {
  if (isClosed(item)) return false;
  const today = todayValue();
  if (item.targetDate && item.targetDate < today) return true;

  const interval = reviewIntervalDays(item.reviewFrequency);
  if (!interval || !item.lastReviewedDate) return false;

  const reviewed = new Date(`${item.lastReviewedDate}T00:00:00`);
  reviewed.setDate(reviewed.getDate() + interval);
  return reviewed.toISOString().slice(0, 10) < today;
}

function isEscalated(item) {
  const status = String(item.escalationStatus || "");
  return status && status !== "Not Escalated";
}

function populateProjectOptions() {
  const selects = [document.getElementById("projectFilter"), document.getElementById("projectId")];

  projects
    .slice()
    .sort((a, b) => String(a.projectCode || "").localeCompare(String(b.projectCode || "")))
    .forEach((project) => {
      const projectId = String(project.projectCode || "");
      const archived = PPMGovernance.isArchived(project);
      const label = `${projectId} - ${project.projectName || "Unnamed project"}${archived ? " (Archived)" : ""}`;
      selects.forEach((select) => {
        const option = document.createElement("option");
        option.value = projectId;
        option.textContent = label;
        if (select.id === "projectId" && archived) option.disabled = true;
        select.appendChild(option);
      });
    });

  if (requestedProjectId && getProject(requestedProjectId)) {
    document.getElementById("projectFilter").value = requestedProjectId;
  }
}

function applyRaidArchiveMode() {
  const selectedProjectId = document.getElementById("projectFilter").value;
  const selectedIsArchived = isArchivedProject(selectedProjectId);
  const raiseButton = document.getElementById("raiseRaidButton");
  raiseButton.disabled = selectedIsArchived;
  raiseButton.title = selectedIsArchived ? "Reopen the project before adding RAID items." : "";

  document.querySelectorAll("tr[data-raid-id]").forEach((row) => {
    const item = findRaidItem(row.dataset.raidId);
    if (!item || !isArchivedProject(item.projectId)) return;
    row.classList.add("archived-row");
    row.querySelectorAll(".inline-field").forEach((control) => (control.disabled = true));
    const moreButton = row.querySelector(".more-raid-fields");
    if (moreButton) moreButton.textContent = "View fields";
  });

  if (selectedIsArchived) {
    const linkedProject = getProject(selectedProjectId);
    showMessage(
      `This project was archived${linkedProject.archiveReason || linkedProject.archivedReason ? `: ${linkedProject.archiveReason || linkedProject.archivedReason}` : ""}. Its RAID items are read-only until the project is reopened from the Project Register.`,
      "warning"
    );
  } else if (document.getElementById("pageMessage").classList.contains("warning")) {
    clearMessage();
  }
}

function getFilteredItems() {
  const search = document.getElementById("searchFilter").value.trim().toLowerCase();
  const projectId = document.getElementById("projectFilter").value.toLowerCase();
  const type = document.getElementById("typeFilter").value;
  const status = document.getElementById("statusFilter").value;

  return getAllRaidItems()
    .filter((item) => {
      const searchable = [
        item.raidId,
        item.title,
        item.description,
        item.owner,
        item.projectId,
        item.type,
        item.comments
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!search || searchable.includes(search)) &&
        (!projectId || String(item.projectId || "").toLowerCase() === projectId) &&
        (!type || item.type === type) &&
        (!status || item.status === status)
      );
    })
    .sort((a, b) => {
      const closedDifference = Number(isClosed(a)) - Number(isClosed(b));
      if (closedDifference) return closedDifference;
      return String(b.dateRaised || "").localeCompare(String(a.dateRaised || ""));
    });
}

function renderSummary() {
  const items = getAllRaidItems();
  document.getElementById("totalItems").textContent = items.length;
  document.getElementById("openItems").textContent = items.filter((item) => !isClosed(item)).length;
  document.getElementById("overdueItems").textContent = items.filter(isReviewOverdue).length;
  document.getElementById("escalatedItems").textContent = items.filter(isEscalated).length;
}

function renderRaidItems() {
  const items = getFilteredItems();
  const tableBody = document.getElementById("raidTableBody");
  const emptyMessage = document.getElementById("emptyMessage");
  tableBody.innerHTML = "";

  items.forEach((item) => {
    const row = document.createElement("tr");
    row.dataset.raidId = item.raidId;
    row.classList.toggle("dirty-row", dirtyRaidIds.has(item.raidId));

    row.innerHTML = `
          <td><strong>${escapeHtml(item.raidId || "Not set")}</strong></td>
          <td><select class="inline-field inline-type" data-field="type" data-raid-id="${escapeHtml(item.raidId)}" aria-label="RAID type">${renderOptions(["Risk", "Assumption", "Issue", "Dependency"], item.type || "Risk")}</select></td>
          <td><select class="inline-field inline-project" data-field="projectId" data-raid-id="${escapeHtml(item.raidId)}" aria-label="Project ID">${renderProjectOptionMarkup(item.projectId || "")}</select></td>
          <td><input type="text" class="inline-field inline-title" data-field="title" data-raid-id="${escapeHtml(item.raidId)}" aria-label="RAID title" value="${escapeHtml(item.title || "")}" placeholder="Enter title"></td>
          <td><textarea class="inline-field inline-description" data-field="description" data-raid-id="${escapeHtml(item.raidId)}" aria-label="RAID description" placeholder="Enter description">${escapeHtml(item.description || "")}</textarea></td>
          <td><select class="inline-field inline-person" data-field="ownerResourceId" data-raid-id="${escapeHtml(item.raidId)}" aria-label="RAID owner"></select></td>
          <td><select class="inline-field inline-person" data-field="raisedByResourceId" data-raid-id="${escapeHtml(item.raidId)}" aria-label="Raised by"></select></td>
          <td><input type="date" class="inline-field inline-date" data-field="dateRaised" data-raid-id="${escapeHtml(item.raidId)}" aria-label="Date raised" value="${escapeHtml(item.dateRaised || "")}"></td>
          <td><input type="date" class="inline-field inline-date" data-field="targetDate" data-raid-id="${escapeHtml(item.raidId)}" aria-label="Target or review date" value="${escapeHtml(item.targetDate || "")}">${isReviewOverdue(item) ? '<span class="badge overdue">Review overdue</span>' : ""}</td>
          <td><select class="inline-field inline-status" data-field="status" data-raid-id="${escapeHtml(item.raidId)}" aria-label="RAID status">${renderOptions(["Open", "In Progress", "Monitoring", "On Hold", "Closed"], item.status || "Open")}</select></td>
          <td><select class="inline-field inline-priority" data-field="priority" data-raid-id="${escapeHtml(item.raidId)}" aria-label="RAID priority">${renderOptions(["Low", "Medium", "High", "Critical"], item.priority || "Medium")}</select></td>
          <td><select class="inline-field inline-escalation" data-field="escalationStatus" data-raid-id="${escapeHtml(item.raidId)}" aria-label="Escalation status">${renderOptions(["Not Escalated", "Escalation Required", "Escalated", "PMO Review Required", "Under PMO Review"], item.escalationStatus || "Not Escalated")}</select></td>
          <td><div class="action-group">${PPMChangeLog.historyButton("RAID item", item.raidId, item.title || item.raidId)}<button type="button" class="button small light more-raid-fields" data-raid-id="${escapeHtml(item.raidId)}">More fields</button><button type="button" class="button small danger delete-raid-row" data-permission="raid.edit" data-raid-id="${escapeHtml(item.raidId)}" ${isArchivedProject(item.projectId) ? "disabled" : ""}>Delete</button></div></td>
        `;

    tableBody.appendChild(row);

    PPMResources.populatePersonSelect(row.querySelector('[data-field="ownerResourceId"]'), {
      selectedResourceId: item.ownerResourceId,
      legacyName: item.owner,
      blankLabel: "Select an owner",
      allowGeneric: true
    });
    PPMResources.populatePersonSelect(row.querySelector('[data-field="raisedByResourceId"]'), {
      selectedResourceId: item.raisedByResourceId,
      legacyName: item.raisedBy,
      blankLabel: "Select who raised it",
      allowGeneric: true
    });
  });

  if (!isArchivedProject(document.getElementById("projectFilter").value)) {
    tableBody.insertAdjacentHTML(
      "beforeend",
      '<tr class="add-row"><td colspan="13"><button type="button" class="add-row-button add-inline-raid" data-permission="raid.edit">+ Add RAID row</button></td></tr>'
    );
  }
  emptyMessage.style.display = items.length ? "none" : "block";
  renderSummary();
  attachTableEvents();
  applyRaidArchiveMode();
}

function attachTableEvents() {
  document.querySelectorAll(".more-raid-fields").forEach((button) => {
    button.addEventListener("click", () => openEditRaidItem(button.dataset.raidId));
  });

  document.querySelectorAll(".raid-inline-field, .inline-field[data-raid-id]").forEach((field) => {
    const eventName = field.tagName === "SELECT" || field.type === "date" ? "change" : "input";
    field.addEventListener(eventName, handleInlineRaidChange);
  });

  document
    .querySelectorAll(".add-inline-raid")
    .forEach((button) => button.addEventListener("click", appendInlineRaidItem));
  document
    .querySelectorAll(".delete-raid-row")
    .forEach((button) => button.addEventListener("click", () => deleteRaidRow(button.dataset.raidId)));
}

function handleInlineRaidChange(event) {
  const field = event.currentTarget;
  const item = findRaidItem(field.dataset.raidId);
  if (!item) return;
  if (isArchivedProject(item.projectId)) {
    applyRaidArchiveMode();
    return;
  }
  const property = field.dataset.field;

  if (property === "ownerResourceId") {
    const person = PPMResources.getSelectedPerson(field);
    item.ownerResourceId = person.resourceId;
    item.owner = person.name;
    item.ownerEmail = person.email;
  } else if (property === "raisedByResourceId") {
    const person = PPMResources.getSelectedPerson(field);
    item.raisedByResourceId = person.resourceId;
    item.raisedBy = person.name;
    item.raisedByEmail = person.email;
  } else {
    item[property] = field.value;
  }

  if (property === "status" && item.status === "Closed" && !item.dateClosed) item.dateClosed = todayValue();
  markRaidDirty(item.raidId);
  renderSummary();
  clearMessage();
}

function appendInlineRaidItem() {
  const currentProjectFilter = document.getElementById("projectFilter").value;
  if (isArchivedProject(currentProjectFilter)) {
    applyRaidArchiveMode();
    return;
  }
  const defaultProjectId = getProject(requestedProjectId)
    ? requestedProjectId
    : getProject(currentProjectFilter)
      ? currentProjectFilter
      : "";

  document.getElementById("searchFilter").value = "";
  document.getElementById("typeFilter").value = "";
  document.getElementById("statusFilter").value = "";
  document.getElementById("projectFilter").value = defaultProjectId;

  const now = new Date().toISOString();
  const item = {
    raidId: generateRaidId(),
    type: "Risk",
    projectId: defaultProjectId,
    title: "",
    description: "",
    owner: "",
    ownerResourceId: "",
    ownerEmail: "",
    raisedBy: "",
    raisedByResourceId: "",
    raisedByEmail: "",
    dateRaised: todayValue(),
    targetDate: "",
    status: "Open",
    priority: "Medium",
    escalationStatus: "Not Escalated",
    lastReviewedDate: todayValue(),
    comments: "",
    auditHistory: [],
    createdAt: now,
    updatedAt: now
  };

  const storageKey = defaultProjectId || "__DRAFT__";
  if (!Array.isArray(raidStore[storageKey])) raidStore[storageKey] = [];
  raidStore[storageKey].push(item);
  dirtyRaidIds.add(item.raidId);
  setRaidDirty(true);
  renderRaidItems();
  requestAnimationFrame(() => {
    const field = document.querySelector(`[data-raid-id="${CSS.escape(item.raidId)}"][data-field="title"]`);
    if (field) {
      field.scrollIntoView({ block: "nearest", inline: "center" });
      field.focus();
    }
  });
}

function showRaidValidationError(item, property, message) {
  showMessage(message, "error");
  const field =
    document.querySelector(`[data-raid-id="${CSS.escape(item.raidId)}"][data-field="${property}"]`) ||
    document.querySelector(`.more-raid-fields[data-raid-id="${CSS.escape(item.raidId)}"]`);
  if (field) field.focus();
  return false;
}

function validateInlineRaidItems() {
  const allowedTypes = ["Risk", "Assumption", "Issue", "Dependency"];
  const allowedStatuses = ["Open", "In Progress", "Monitoring", "On Hold", "Closed"];
  const allowedPriorities = ["Low", "Medium", "High", "Critical"];

  for (const item of getAllRaidItems()) {
    if (dirtyRaidIds.has(item.raidId) && isArchivedProject(item.projectId)) {
      return showRaidValidationError(
        item,
        "projectId",
        `${item.raidId} belongs to an archived project and cannot be changed.`
      );
    }
    item.title = String(item.title || "").trim();
    item.description = String(item.description || "").trim();
    item.projectId = String(item.projectId || "").trim();

    if (!allowedTypes.includes(item.type))
      return showRaidValidationError(item, "type", `${item.raidId} needs a valid RAID type.`);
    if (!getProject(item.projectId))
      return showRaidValidationError(
        item,
        "projectId",
        `${item.raidId} needs a project from the project register.`
      );
    if (!item.title) return showRaidValidationError(item, "title", `${item.raidId} needs a title.`);
    if (!item.description)
      return showRaidValidationError(item, "description", `${item.raidId} needs a description.`);

    const owner = PPMResources.findResource(item.ownerResourceId, item.owner);
    if (!owner)
      return showRaidValidationError(
        item,
        "ownerResourceId",
        `${item.raidId} needs an owner from the resource directory.`
      );
    item.ownerResourceId = owner.resourceId || "";
    item.owner = owner.fullName || "";
    item.ownerEmail = owner.email || "";

    const raisedBy = PPMResources.findResource(item.raisedByResourceId, item.raisedBy);
    if (!raisedBy)
      return showRaidValidationError(
        item,
        "raisedByResourceId",
        `${item.raidId} needs a raised-by person from the resource directory.`
      );
    item.raisedByResourceId = raisedBy.resourceId || "";
    item.raisedBy = raisedBy.fullName || "";
    item.raisedByEmail = raisedBy.email || "";

    if (!item.dateRaised)
      return showRaidValidationError(item, "dateRaised", `${item.raidId} needs a date raised.`);
    if (!item.targetDate)
      return showRaidValidationError(item, "targetDate", `${item.raidId} needs a target or review date.`);
    if (!allowedStatuses.includes(item.status))
      return showRaidValidationError(item, "status", `${item.raidId} needs a valid status.`);
    if (!allowedPriorities.includes(item.priority))
      return showRaidValidationError(item, "priority", `${item.raidId} needs a valid priority.`);
    if (item.status === "Closed" && (!item.dateClosed || !String(item.closureEvidence || "").trim())) {
      return showRaidValidationError(
        item,
        "closureEvidence",
        `${item.raidId} is closed and needs a closed date and closure evidence in More fields.`
      );
    }
  }
  return true;
}

function saveInlineRaidChanges() {
  if (!hasUnsavedRaidChanges) return;
  if (!validateInlineRaidItems()) return;
  const now = new Date().toISOString();

  getAllRaidItems().forEach((item) => {
    if (!dirtyRaidIds.has(item.raidId)) return;
    const original = originalRaidItems.get(item.raidId);
    item.createdAt = (original && original.createdAt) || item.createdAt || now;
    item.updatedAt = now;
    item.auditHistory = original
      ? auditChanges(original, item)
      : [{ changedAt: now, summary: "RAID item created" }];
  });

  rebuildRaidStoreByProject();
  saveRaidStore();
  /* Stage 14: browser-side audit emission removed; the database records RAID
     changes and closures itself. The in-record auditHistory built above is a
     different thing - it is part of the RAID record the user reads. */
  deletedRaidItems.clear();
  captureRaidSnapshot();
  setRaidDirty(false);
  renderRaidItems();
  showMessage("RAID changes were saved.", "success");
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

function showModal() {
  document.getElementById("raidModal").classList.add("visible");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.getElementById("raidModal").classList.remove("visible");
  document.body.style.overflow = "";
  editingRaidId = null;
  applyRaidArchiveMode();
}

function setRaidModalReadOnly(readOnly) {
  document
    .querySelectorAll("#raidForm input, #raidForm select, #raidForm textarea")
    .forEach((field) => (field.disabled = readOnly));
  document.getElementById("saveRaidButton").style.display = readOnly ? "none" : "inline-block";
  document.getElementById("cancelRaidButton").textContent = readOnly ? "Close" : "Cancel";
}

function setDefaultFormValues() {
  document.getElementById("dateRaised").value = todayValue();
  document.getElementById("lastReviewedDate").value = todayValue();
  document.getElementById("raidStatus").value = "Open";
  document.getElementById("raidPriority").value = "Medium";
  document.getElementById("escalationStatus").value = "Not Escalated";

  const selectedProjectId = document.getElementById("projectFilter").value;
  const defaultProjectId =
    getProject(selectedProjectId) && !isArchivedProject(selectedProjectId)
      ? selectedProjectId
      : getProject(requestedProjectId) && !isArchivedProject(requestedProjectId)
        ? requestedProjectId
        : "";
  document.getElementById("projectId").value = defaultProjectId;
}

function openAddRaidItem() {
  const selectedProjectId = document.getElementById("projectFilter").value;
  if (isArchivedProject(selectedProjectId)) {
    applyRaidArchiveMode();
    return;
  }

  clearMessage();
  setRaidModalReadOnly(false);
  editingRaidId = null;
  document.getElementById("raidForm").reset();
  document.getElementById("raidModalTitle").textContent = "Raise RAID item";
  document.getElementById("saveRaidButton").textContent = "Save RAID item";
  document.getElementById("auditSection").hidden = true;
  populateRaidPeople();
  setDefaultFormValues();
  updateTypeFields();
  updateScores();
  showModal();
  document.getElementById("raidType").focus();
}

function openEditRaidItem(raidId) {
  const item = findRaidItem(raidId);
  if (!item) {
    showMessage("The selected RAID item could not be found.", "error");
    return;
  }

  clearMessage();
  editingRaidId = raidId;
  document.getElementById("raidForm").reset();
  document.getElementById("raidModalTitle").textContent = `Edit ${raidId}`;
  document.getElementById("saveRaidButton").textContent = "Save changes";

  [...commonFieldIds, ...riskFieldIds, ...issueFieldIds, ...dependencyFieldIds].forEach((fieldId) => {
    const field = document.getElementById(fieldId);
    if (field) field.value = item[fieldMap(fieldId)] ?? "";
  });

  populateRaidPeople(item);

  updateTypeFields();
  updateScores();
  renderAuditHistory(item.auditHistory || []);
  setRaidModalReadOnly(isArchivedProject(item.projectId));
  showModal();
}

function fieldMap(fieldId) {
  return (
    {
      raidType: "type",
      raidTitle: "title",
      raidStatus: "status",
      raidDescription: "description",
      raidOwner: "owner",
      raidPriority: "priority",
      raidComments: "comments"
    }[fieldId] || fieldId
  );
}

function renderAuditHistory(history) {
  const auditSection = document.getElementById("auditSection");
  const auditList = document.getElementById("auditList");
  auditList.innerHTML = "";

  history
    .slice()
    .reverse()
    .forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = `${new Date(entry.changedAt).toLocaleString("en-GB")}: ${entry.summary}`;
      auditList.appendChild(item);
    });

  auditSection.hidden = history.length === 0;
}

function updateTypeFields() {
  const type = document.getElementById("raidType").value;
  document.getElementById("riskFields").classList.toggle("visible", type === "Risk");
  document.getElementById("issueFields").classList.toggle("visible", type === "Issue");
  document.getElementById("dependencyFields").classList.toggle("visible", type === "Dependency");
}

function score(probabilityId, impactId) {
  const probability = Number(document.getElementById(probabilityId).value);
  const impact = Number(document.getElementById(impactId).value);
  return probability && impact ? probability * impact : "";
}

function updateScores() {
  document.getElementById("inherentScore").value = score("inherentProbability", "inherentImpact");
  document.getElementById("residualScore").value = score("residualProbability", "residualImpact");
}

function getFieldValue(fieldId) {
  const field = document.getElementById(fieldId);
  return field ? field.value.trim() : "";
}

function collectRaidItem() {
  const item = {};
  [...commonFieldIds, ...riskFieldIds, ...issueFieldIds, ...dependencyFieldIds].forEach((fieldId) => {
    item[fieldMap(fieldId)] = getFieldValue(fieldId);
  });

  item.raidId = editingRaidId || generateRaidId();
  item.projectId = getFieldValue("projectId");
  item.inherentScore = getFieldValue("inherentScore");
  item.residualScore = getFieldValue("residualScore");

  const owner = PPMResources.getSelectedPerson("raidOwner");

  const raisedBy = PPMResources.getSelectedPerson("raisedBy");

  const resolutionOwner = PPMResources.getSelectedPerson("resolutionOwner");

  item.owner = owner.name;
  item.ownerResourceId = owner.resourceId;
  item.ownerEmail = owner.email;
  item.raisedBy = raisedBy.name;
  item.raisedByResourceId = raisedBy.resourceId;
  item.raisedByEmail = raisedBy.email;
  item.resolutionOwner = resolutionOwner.name;
  item.resolutionOwnerResourceId = resolutionOwner.resourceId;
  item.resolutionOwnerEmail = resolutionOwner.email;
  return item;
}

function generateRaidId() {
  const maximum = getAllRaidItems().reduce((currentMaximum, item) => {
    const match = String(item.raidId || "").match(/^RAID-(\d+)$/i);
    return match ? Math.max(currentMaximum, Number(match[1])) : currentMaximum;
  }, 0);

  return `RAID-${String(maximum + 1).padStart(4, "0")}`;
}

function auditChanges(existingItem, updatedItem) {
  const auditedFields = [
    ["owner", "Owner"],
    ["targetDate", "Target date"],
    ["status", "Status"],
    ["inherentScore", "Inherent score"],
    ["residualScore", "Residual score"]
  ];

  const changes = auditedFields
    .filter(([field]) => String(existingItem[field] ?? "") !== String(updatedItem[field] ?? ""))
    .map(
      ([field, label]) =>
        `${label}: ${existingItem[field] || "not set"} to ${updatedItem[field] || "not set"}`
    );

  const history = Array.isArray(existingItem.auditHistory) ? [...existingItem.auditHistory] : [];
  if (changes.length) history.push({ changedAt: new Date().toISOString(), summary: changes.join("; ") });
  return history;
}

function removeStoredRaidItem(raidId) {
  Object.keys(raidStore).forEach((projectId) => {
    if (!Array.isArray(raidStore[projectId])) return;
    raidStore[projectId] = raidStore[projectId].filter((item) => item.raidId !== raidId);
    if (raidStore[projectId].length === 0) delete raidStore[projectId];
  });
}

function deleteRaidRow(raidId) {
  const item = findRaidItem(raidId);
  if (!item || isArchivedProject(item.projectId)) return;
  pendingDeleteRaidId = raidId;
  document.getElementById("deleteRaidMessage").textContent =
    `Delete ${raidId}: ${item.title || "this RAID row"}? The row will be removed when you select Save changes.`;
  document.getElementById("deleteRaidConfirmation").classList.add("visible");
  document.body.style.overflow = "hidden";
  document.getElementById("cancelDeleteRaidButton").focus();
}

function closeDeleteRaidConfirmation() {
  pendingDeleteRaidId = null;
  document.getElementById("deleteRaidConfirmation").classList.remove("visible");
  document.body.style.overflow = "";
}

function confirmDeleteRaidRow() {
  const item = pendingDeleteRaidId ? findRaidItem(pendingDeleteRaidId) : null;
  if (!item || isArchivedProject(item.projectId)) {
    closeDeleteRaidConfirmation();
    return;
  }
  const raidId = item.raidId;
  const title = item.title || raidId;
  deletedRaidItems.set(raidId, JSON.parse(JSON.stringify(item)));
  removeStoredRaidItem(raidId);
  closeDeleteRaidConfirmation();
  dirtyRaidIds.add(raidId);
  setRaidDirty(true);
  renderRaidItems();
  showMessage(`${title} was removed. Select Save changes to confirm.`, "success");
}

function validateClosure(item) {
  if (item.status !== "Closed") return true;
  if (!item.dateClosed || !item.closureEvidence) {
    showMessage("Closed RAID items require a date closed and closure evidence.", "error");
    return false;
  }
  return true;
}

function saveRaidItem(event) {
  event.preventDefault();
  const existingBeforeSave = editingRaidId ? findRaidItem(editingRaidId) : null;
  if (existingBeforeSave && isArchivedProject(existingBeforeSave.projectId)) {
    closeModal();
    applyRaidArchiveMode();
    return;
  }
  const form = document.getElementById("raidForm");
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const item = collectRaidItem();
  if (!validateClosure(item)) return;

  const existingItem = editingRaidId ? findRaidItem(editingRaidId) : null;
  const now = new Date().toISOString();

  if (existingItem) {
    item.createdAt = existingItem.createdAt || now;
    item.updatedAt = now;
    item.auditHistory = Array.isArray(existingItem.auditHistory) ? existingItem.auditHistory : [];
    removeStoredRaidItem(editingRaidId);
  } else {
    item.createdAt = now;
    item.updatedAt = now;
    item.auditHistory = [];
  }

  if (!Array.isArray(raidStore[item.projectId])) raidStore[item.projectId] = [];
  raidStore[item.projectId].push(item);
  closeModal();
  dirtyRaidIds.add(item.raidId);
  setRaidDirty(true);
  renderRaidItems();
  showMessage(`${item.raidId} was updated. Select Save changes to confirm.`, "success");
}

function reopenRaidItem(raidId) {
  const item = findRaidItem(raidId);
  if (!item) return;
  if (isArchivedProject(item.projectId)) {
    applyRaidArchiveMode();
    return;
  }
  if (!confirm(`Reopen ${raidId}: ${item.title}?`)) return;

  const previousStatus = item.status || "Closed";
  item.status = "Open";
  item.dateClosed = "";
  item.updatedAt = new Date().toISOString();
  item.auditHistory = Array.isArray(item.auditHistory) ? item.auditHistory : [];
  item.auditHistory.push({
    changedAt: item.updatedAt,
    summary: `Status: ${previousStatus} to Open; item reopened after recurrence`
  });

  saveRaidStore();

  renderRaidItems();
  showMessage(`${raidId} was reopened.`, "success");
}

["searchFilter", "projectFilter", "typeFilter", "statusFilter"].forEach((fieldId) => {
  document
    .getElementById(fieldId)
    .addEventListener(fieldId === "searchFilter" ? "input" : "change", renderRaidItems);
});

document.getElementById("raiseRaidButton").addEventListener("click", appendInlineRaidItem);
document.getElementById("saveRaidChangesButton").addEventListener("click", saveInlineRaidChanges);
document.getElementById("closeRaidModalButton").addEventListener("click", closeModal);
document.getElementById("cancelRaidButton").addEventListener("click", closeModal);
document.getElementById("raidForm").addEventListener("submit", saveRaidItem);
document.getElementById("raidType").addEventListener("change", updateTypeFields);
document.getElementById("cancelDeleteRaidButton").addEventListener("click", closeDeleteRaidConfirmation);
document.getElementById("confirmDeleteRaidButton").addEventListener("click", confirmDeleteRaidRow);
document.getElementById("deleteRaidConfirmation").addEventListener("click", function (event) {
  if (event.target === this) closeDeleteRaidConfirmation();
});

["inherentProbability", "inherentImpact", "residualProbability", "residualImpact"].forEach((fieldId) => {
  document.getElementById(fieldId).addEventListener("input", updateScores);
});

document.getElementById("raidStatus").addEventListener("change", function () {
  if (this.value === "Closed" && !document.getElementById("dateClosed").value) {
    document.getElementById("dateClosed").value = todayValue();
  }
});

document.getElementById("raidModal").addEventListener("click", function (event) {
  if (event.target === this) closeModal();
});

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" && document.getElementById("raidModal").classList.contains("visible")) {
    closeModal();
  }
  if (
    event.key === "Escape" &&
    document.getElementById("deleteRaidConfirmation").classList.contains("visible")
  ) {
    closeDeleteRaidConfirmation();
  }
});

window.addEventListener("beforeunload", function (event) {
  if (!hasUnsavedRaidChanges) return;
  event.preventDefault();
  event.returnValue = "";
});

PPMResources.ensureLegacyResources();
populateProjectOptions();
populateRaidPeople();
captureRaidSnapshot();
setRaidDirty(false);
renderRaidItems();

if (requestedRaidId) {
  openEditRaidItem(requestedRaidId);
}
