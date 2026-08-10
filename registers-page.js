"use strict";
const descriptions = {
  actions:
    "Track accountable follow-up work, due dates, completion evidence and escalation. An action may originate from RAID, a milestone, a gate or a meeting without duplicating the source record.",
  decisions:
    "Record governed choices and approvals, including options, recommendation, authority, outcome and rationale. A RAID item can reference the resulting decision record.",
  financials:
    "Review calculated project financial totals and maintain ownership, RAG and commentary. Use Financial Management for cost lines, categories and controlled budget approvals.",
  benefits:
    "Track benefit ownership, measurement, targets, confidence and post-project realisation from PPM-BEN-001–003.",
  documents: "Link governed project evidence with the metadata required by PPM-DOC-001–003.",
  statusReports:
    "Generate, review and control formal project status reports from PPM-STS-005–007. Prepopulated content remains Draft until reviewed."
};
const parameters = new URLSearchParams(window.location.search);
const registerTypes = ["actions", "decisions", "financials", "documents", "statusReports"];
let activeType = registerTypes.includes(parameters.get("tab")) ? parameters.get("tab") : "actions";
let projects = [];
let records = [];
let resources = [];
let dirtyIds = new Set();
let hasUnsavedChanges = false;
let pendingDeleteId = "";
let pendingFocusItem = parameters.get("item") || "";
let originalRecords = new Map();

const escapeHtml = PPMCore.escapeHtml;

/* Column widths come from the register schema, so they are data, not styling.
   Dropped by style-src 'self' as inline attributes; applied through CSSOM instead. */
const styleAttr = PPMCore.styleAttribute;
function schema() {
  return PPMRegisters.schemas[activeType];
}
function recordId(record) {
  return String(record[schema().idField] || "");
}
function isArchived(projectCode) {
  const project = projects.find(
    (item) => String(item.projectCode).toLowerCase() === String(projectCode || "").toLowerCase()
  );
  return Boolean(project && (project.archived || project.isArchived || project.projectStatus === "Archived"));
}
function today() {
  return PPMRegisters.isoToday();
}
function setMessage(text, type) {
  const message = document.getElementById("pageMessage");
  message.textContent = text;
  message.className = `message ${type}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function clearMessage() {
  document.getElementById("pageMessage").className = "message";
}
function setDirty(value = true) {
  hasUnsavedChanges = value;
  const button = document.getElementById("saveChangesButton"),
    indicator = document.getElementById("unsavedIndicator");
  button.disabled = !value;
  button.textContent = value ? "Save changes" : "Saved";
  indicator.textContent = value ? "Unsaved changes" : "All changes saved";
  indicator.classList.toggle("dirty", value);
}
function loadProjects() {
  const stored = PPMRegisters.readJson("ppmProjects", []);
  projects = Array.isArray(stored) ? stored : [];
  resources = PPMResources.ensureLegacyResources();
}
function loadRecords() {
  records = PPMRegisters.readRecords(activeType);
  originalRecords = new Map(records.map((record) => [recordId(record), JSON.parse(JSON.stringify(record))]));
  dirtyIds = new Set();
  setDirty(false);
}

function renderTabs() {
  document.getElementById("registerTabs").innerHTML = registerTypes
    .map((key) => {
      const value = PPMRegisters.schemas[key],
        label =
          key === "actions" ? "Action Register" : key === "decisions" ? "Decision Register" : value.label;
      return `<button type="button" class="tab-button ${key === activeType ? "active" : ""}" data-permission="none" data-register="${key}" role="tab" aria-selected="${key === activeType}">${escapeHtml(label)}</button>`;
    })
    .join("");
  document
    .querySelectorAll("[data-register]")
    .forEach((button) => button.addEventListener("click", () => switchRegister(button.dataset.register)));
}
function switchRegister(type) {
  if (type === activeType) return;
  if (hasUnsavedChanges) {
    setMessage("Save the current register changes before opening another register.", "error");
    return;
  }
  activeType = type;
  window.history.replaceState({}, "", `registers.html?tab=${encodeURIComponent(type)}`);
  document.getElementById("registerSearch").value = "";
  document.getElementById("projectFilter").value = "";
  loadRecords();
  renderAll();
}
function projectOptions(selected) {
  return (
    '<option value="">Select project</option>' +
    projects
      .slice()
      .sort((a, b) => String(a.projectCode).localeCompare(String(b.projectCode)))
      .map(
        (project) =>
          `<option value="${escapeHtml(project.projectCode)}" ${project.projectCode === selected ? "selected" : ""} ${isArchived(project.projectCode) && project.projectCode !== selected ? "disabled" : ""}>${escapeHtml(project.projectCode)} - ${escapeHtml(project.projectName || "Unnamed project")}${isArchived(project.projectCode) ? " (Archived)" : ""}</option>`
      )
      .join("")
  );
}
function optionMarkup(options, selected) {
  return [
    '<option value="">Select</option>',
    ...options.map(
      (option) =>
        `<option value="${escapeHtml(option)}" ${String(option) === String(selected || "") ? "selected" : ""}>${escapeHtml(option)}</option>`
    )
  ].join("");
}
function personResource(record, key) {
  return PPMResources.findResource(record[`${key}ResourceId`], record[key]);
}
function controlMarkup(field, record) {
  const value = record[field.key] ?? "",
    id = recordId(record),
    disabled =
      isArchived(record.projectCode) || (activeType === "statusReports" && record.status === "Locked"),
    common = `class="inline-field" data-id="${escapeHtml(id)}" data-field="${escapeHtml(field.key)}" aria-label="${escapeHtml(field.label)}" ${disabled ? "disabled" : ""}`;
  if (field.type === "id") return `<input ${common} value="${escapeHtml(value)}" readonly>`;
  if (field.type === "project") return `<select ${common}>${projectOptions(value)}</select>`;
  if (field.type === "select") return `<select ${common}>${optionMarkup(field.options, value)}</select>`;
  if (field.type === "textarea")
    return `<textarea ${common} placeholder="Enter ${escapeHtml(field.label.toLowerCase())}">${escapeHtml(value)}</textarea>`;
  if (field.type === "calculated")
    return `<span class="calculated" data-calculated="${escapeHtml(field.key)}">${escapeHtml(formatCalculated(field.key, value))}</span>`;
  if (field.type === "person") return `<select ${common} data-person="true"></select>`;
  return `<input ${common} type="${field.type === "number" ? "number" : field.type === "url" ? "url" : field.type === "date" ? "date" : "text"}" ${field.type === "number" ? 'step="0.01"' : ""} value="${escapeHtml(value)}">`;
}
function formatCalculated(key, value) {
  if (key === "budgetVariancePercentage")
    return `${Number(value || 0).toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
  if (
    [
      "approvedBudget",
      "forecastCost",
      "actualCost",
      "committedCost",
      "remainingForecast",
      "contingency",
      "estimateAtCompletion",
      "budgetVariance"
    ].includes(key)
  )
    return Number(value || 0).toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  return value;
}
function filteredRecords() {
  const search = document.getElementById("registerSearch").value.trim().toLowerCase(),
    project = document.getElementById("projectFilter").value,
    status = document.getElementById("statusFilter").value;
  return records.filter((record) => {
    const text = schema()
      .fields.map((field) => record[field.key])
      .join(" ")
      .toLowerCase();
    return (
      (!search || text.includes(search)) &&
      (!project || record.projectCode === project) &&
      (!status || String(record[schema().statusField] || "") === status)
    );
  });
}
function renderFilters() {
  const currentProject = document.getElementById("projectFilter").value,
    currentStatus = document.getElementById("statusFilter").value;
  document.getElementById("projectFilter").innerHTML =
    '<option value="">All projects</option>' +
    projects
      .map(
        (project) =>
          `<option value="${escapeHtml(project.projectCode)}">${escapeHtml(project.projectCode)} - ${escapeHtml(project.projectName || "Unnamed project")}</option>`
      )
      .join("");
  document.getElementById("projectFilter").value = currentProject;
  const statuses = [...new Set(records.map((record) => record[schema().statusField]).filter(Boolean))].sort();
  document.getElementById("statusFilter").innerHTML =
    '<option value="">All statuses</option>' +
    statuses.map((status) => `<option>${escapeHtml(status)}</option>`).join("");
  document.getElementById("statusFilter").value = statuses.includes(currentStatus) ? currentStatus : "";
}
function renderTable() {
  const currentSchema = schema(),
    rows = filteredRecords();
  document.getElementById("registerHead").innerHTML =
    `<tr>${currentSchema.fields.map((field) => `<th${styleAttr(`min-width:${field.width}px;width:${field.width}px`)} class="${field.required ? "field-required" : ""}">${escapeHtml(field.label)}</th>`).join("")}<th class="actions-cell">Row actions</th></tr>`;
  document.getElementById("registerBody").innerHTML =
    rows
      .map((record) => {
        const id = recordId(record),
          locked = activeType === "statusReports" && record.status === "Locked";
        return `<tr data-record-id="${escapeHtml(id)}" class="${dirtyIds.has(id) ? "dirty-row" : ""} ${locked ? "locked-row" : ""} ${isArchived(record.projectCode) ? "archived-row" : ""}">${currentSchema.fields.map((field) => `<td${styleAttr(`min-width:${field.width}px;width:${field.width}px`)}>${controlMarkup(field, record)}${field.key === "projectCode" && isArchived(record.projectCode) ? '<span class="row-note">Archived project - row is read-only.</span>' : ""}</td>`).join("")}<td class="actions-cell"><div class="button-row">${PPMChangeLog.historyButton(schema().label.replace(/s$/, ""), id, id)}${locked ? `<button type="button" class="button light small revise-row" data-permission="registers.edit" data-id="${escapeHtml(id)}">Revise</button>` : ""}<button type="button" class="button danger small delete-row" data-permission="registers.edit" data-id="${escapeHtml(id)}">Delete</button></div>${locked ? '<span class="row-note">Locked versions remain unchanged.</span>' : ""}</td></tr>`;
      })
      .join("") +
    `<tr class="add-row"><td colspan="${currentSchema.fields.length + 1}"><button type="button" class="add-row-button" data-permission="registers.edit">+ Add ${escapeHtml(currentSchema.singular)} row</button></td></tr>`;
  document.getElementById("emptyState").style.display = rows.length ? "none" : "block";
  populatePeople();
  attachTableEvents();
  updateSummary();
  focusRequestedItem();
}
function focusRequestedItem() {
  if (!pendingFocusItem) return;
  const row = [...document.querySelectorAll("[data-record-id]")].find(
    (item) => item.dataset.recordId === pendingFocusItem
  );
  if (!row) return;
  pendingFocusItem = "";
  row.classList.add("target-row");
  requestAnimationFrame(() => row.scrollIntoView({ block: "center", inline: "center" }));
}
function populatePeople() {
  document.querySelectorAll('[data-person="true"]').forEach((select) => {
    const record = records.find((item) => recordId(item) === select.dataset.id),
      key = select.dataset.field,
      person = personResource(record, key);
    PPMResources.populatePersonSelect(select, {
      selectedResourceId: record[`${key}ResourceId`] || person?.resourceId || "",
      legacyName: record[key] || "",
      blankLabel: `Select ${key.replace(/([A-Z])/g, " $1").toLowerCase()}`,
      allowGeneric: true
    });
  });
}
function attachTableEvents() {
  document.querySelectorAll(".inline-field").forEach((field) => {
    if (field.readOnly || field.disabled) return;
    field.addEventListener(
      ["SELECT", "INPUT"].includes(field.tagName) &&
        field.type !== "text" &&
        field.type !== "number" &&
        field.type !== "url"
        ? "change"
        : "input",
      handleChange
    );
  });
  document
    .querySelectorAll(".delete-row")
    .forEach((button) => button.addEventListener("click", () => openDelete(button.dataset.id)));
  document
    .querySelectorAll(".revise-row")
    .forEach((button) => button.addEventListener("click", () => reviseRow(button.dataset.id)));
  document.querySelectorAll(".add-row-button").forEach((button) => button.addEventListener("click", addRow));
}
function handleChange(event) {
  const field = event.currentTarget,
    record = records.find((item) => recordId(item) === field.dataset.id);
  if (!record) return;
  const key = field.dataset.field;
  if (field.dataset.person) {
    const person = PPMResources.getSelectedPerson(field);
    record[key] = person.name;
    record[`${key}ResourceId`] = person.resourceId;
    record[`${key}Email`] = person.email;
  } else record[key] = field.type === "number" ? (field.value === "" ? 0 : Number(field.value)) : field.value;
  if (activeType === "financials") Object.assign(record, PPMRegisters.prepareRecord(activeType, record));
  record.updatedAt = new Date().toISOString();
  dirtyIds.add(recordId(record));
  setDirty(true);
  if (activeType === "financials") renderTable();
  else updateSummary();
  clearMessage();
}
function defaultProject() {
  const selected = document.getElementById("projectFilter").value;
  if (selected && !isArchived(selected)) return selected;
  return projects.find((project) => !isArchived(project.projectCode))?.projectCode || "";
}
function addRow() {
  const record = PPMRegisters.newRecord(activeType, records, defaultProject());
  records.push(record);
  dirtyIds.add(recordId(record));
  setDirty(true);
  document.getElementById("registerSearch").value = "";
  renderFilters();
  renderTable();
  requestAnimationFrame(() => {
    const field = document.querySelector(
      `[data-id="${CSS.escape(recordId(record))}"][data-field="${CSS.escape(schema().fields.find((item) => item.required && item.type !== "project")?.key || "projectCode")}"]`
    );
    if (field) {
      field.scrollIntoView({ block: "nearest", inline: "center" });
      field.focus();
    }
  });
}
function reviseRow(id) {
  const source = records.find((record) => recordId(record) === id);
  if (!source) return;
  const revision = PPMRegisters.reviseStatusReport(source, records);
  records.push(revision);
  dirtyIds.add(recordId(revision));
  setDirty(true);
  renderFilters();
  renderTable();
  setMessage(
    `${id} was copied to revision ${revision.version}. Review and save the new Draft row.`,
    "success"
  );
}
function openDelete(id) {
  const record = records.find((item) => recordId(item) === id);
  if (!record) return;
  pendingDeleteId = id;
  document.getElementById("deleteTitle").textContent = `Delete ${schema().singular} row?`;
  document.getElementById("deleteMessage").textContent =
    `Delete ${id}? This row will be removed when you select Save changes. Other project records will not be affected.`;
  document.getElementById("deleteConfirmation").classList.add("visible");
  document.body.style.overflow = "hidden";
  document.getElementById("cancelDeleteButton").focus();
}
function closeDelete() {
  pendingDeleteId = "";
  document.getElementById("deleteConfirmation").classList.remove("visible");
  document.body.style.overflow = "";
}
function confirmDelete() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  records = records.filter((record) => recordId(record) !== id);
  closeDelete();
  dirtyIds.add(id);
  setDirty(true);
  renderFilters();
  renderTable();
  setMessage(`${id} was removed. Select Save changes to confirm.`, "success");
}
function validate() {
  const currentSchema = schema();
  for (const record of records) {
    for (const field of currentSchema.fields.filter((item) => item.required)) {
      if (
        record[field.key] === undefined ||
        record[field.key] === null ||
        String(record[field.key]).trim() === ""
      ) {
        setMessage(`${recordId(record)} needs ${field.label.toLowerCase()}.`, "error");
        const control = document.querySelector(
          `[data-id="${CSS.escape(recordId(record))}"][data-field="${CSS.escape(field.key)}"]`
        );
        if (control) {
          control.scrollIntoView({ block: "center", inline: "center" });
          control.focus();
        }
        return false;
      }
    }
    if (!projects.some((project) => project.projectCode === record.projectCode)) {
      setMessage(`${recordId(record)} must link to a project in the Project Register.`, "error");
      return false;
    }
    if (activeType === "documents") {
      try {
        const url = new URL(record.link);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch (error) {
        setMessage(`${recordId(record)} needs a valid http or https repository link.`, "error");
        return false;
      }
    }
  }
  if (currentSchema.uniqueProject) {
    const codes = records.map((record) => record.projectCode),
      duplicate = codes.find((code, index) => codes.indexOf(code) !== index);
    if (duplicate) {
      setMessage(`${duplicate} already has a financial row. Edit the existing row instead.`, "error");
      return false;
    }
  }
  return true;
}
async function saveChanges() {
  if (!hasUnsavedChanges) return;
  if (!validate()) return;
  const now = new Date().toISOString();
  records = records.map((record) => {
    const prepared = PPMRegisters.prepareRecord(activeType, record);
    if (dirtyIds.has(recordId(record))) prepared.updatedAt = now;
    if (activeType === "statusReports") {
      if (prepared.status === "Submitted" && !prepared.submittedDate) prepared.submittedDate = today();
      if (["Approved", "Locked"].includes(prepared.status) && !prepared.approvedDate)
        prepared.approvedDate = today();
      prepared.reviewed = true;
    }
    return prepared;
  });
  /* Stage 16: awaited, and the page only reloads and reports success if it landed. */
  const saved = await PPMRegisters.writeRecords(activeType, records);
  if (saved && saved.ok === false) {
    setMessage(saved.message, "error");
    return;
  }

  /* Stage 14: browser-side audit emission removed. The database records register
     inserts, updates and status movements from the authenticated identity. */
  loadRecords();
  renderAll();
  setMessage(
    `${schema().label} register changes were saved and are available to reports, dashboards, search and audit history.`,
    "success"
  );
}
function updateSummary() {
  const rows = filteredRecords(),
    closed = new Set([
      "Complete",
      "Closed",
      "Approved",
      "Rejected",
      "Realised",
      "No longer applicable",
      "Archived",
      "Locked"
    ]);
  document.getElementById("totalRows").textContent = rows.length;
  document.getElementById("linkedProjects").textContent = new Set(
    rows.map((record) => record.projectCode).filter(Boolean)
  ).size;
  document.getElementById("openRows").textContent = rows.filter(
    (record) => !closed.has(String(record[schema().statusField] || ""))
  ).length;
  document.getElementById("overdueRows").textContent = rows.filter((record) => {
    const date = record.dueDate || record.requiredByDate || record.nextReviewDate || record.reviewDate;
    return date && date < today() && !closed.has(String(record[schema().statusField] || ""));
  }).length;
}
function renderAll() {
  renderTabs();
  renderFilters();
  document.getElementById("registerTitle").textContent = `${schema().label} register`;
  document.getElementById("registerDescription").textContent = descriptions[activeType];
  document.getElementById("addRowButton").textContent =
    activeType === "statusReports" ? "Generate draft report" : `Add ${schema().singular} row`;
  renderTable();
}

document.getElementById("registerSearch").addEventListener("input", renderTable);
document.getElementById("projectFilter").addEventListener("change", renderTable);
document.getElementById("statusFilter").addEventListener("change", renderTable);
document.getElementById("addRowButton").addEventListener("click", addRow);
document.getElementById("saveChangesButton").addEventListener("click", saveChanges);
document.getElementById("cancelDeleteButton").addEventListener("click", closeDelete);
document.getElementById("confirmDeleteButton").addEventListener("click", confirmDelete);
document.getElementById("deleteConfirmation").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDelete();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.getElementById("deleteConfirmation").classList.contains("visible"))
    closeDelete();
});
window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedChanges) return;
  event.preventDefault();
  event.returnValue = "";
});
loadProjects();
loadRecords();
renderAll();
