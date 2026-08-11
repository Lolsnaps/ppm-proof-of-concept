"use strict";
const parameters = new URLSearchParams(window.location.search);
const benefitTypes = [
  "Financial",
  "Customer",
  "Operational efficiency",
  "Risk reduction",
  "Regulatory",
  "Strategic",
  "Colleague",
  "Other"
];
const benefitStatuses = [
  "Proposed",
  "Approved",
  "In delivery",
  "Partially realised",
  "Realised",
  "Not realised",
  "No longer applicable"
];
const confidenceOptions = ["Not Assessed", "High", "Medium", "Low"];
let programmes = [],
  projects = [],
  benefits = [],
  originalBenefits = new Map(),
  dirtyIds = new Set(),
  hasUnsavedChanges = false,
  pendingDeleteId = "",
  pendingFocusItem = parameters.get("item") || "";

const escapeHtml = PPMCore.escapeHtml;
function today() {
  return PPMRegisters.isoToday();
}
function projectByCode(code) {
  return (
    projects.find(
      (project) => String(project.projectCode).toLowerCase() === String(code || "").toLowerCase()
    ) || null
  );
}
function programmeById(id) {
  return programmes.find((programme) => programme.programmeId === id) || null;
}
function programmeForProject(project) {
  return project
    ? PPMGovernance.findProgramme(project.programmeId, project.programme || project.workstream)
    : null;
}
function isArchived(project) {
  return Boolean(project && (project.archived || project.isArchived || project.projectStatus === "Archived"));
}
function optionMarkup(options, selected, blank = "Select") {
  return [
    `<option value="">${escapeHtml(blank)}</option>`,
    ...options.map(
      (option) =>
        `<option value="${escapeHtml(option)}" ${String(option) === String(selected || "") ? "selected" : ""}>${escapeHtml(option)}</option>`
    )
  ].join("");
}
function showMessage(text, type) {
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
  const button = document.getElementById("saveButton"),
    indicator = document.getElementById("unsavedIndicator");
  button.disabled = !value;
  button.textContent = value ? "Save changes" : "Saved";
  indicator.textContent = value ? "Unsaved changes" : "All changes saved";
  indicator.classList.toggle("dirty", value);
}
function normaliseBenefit(source) {
  const record = PPMRegisters.prepareRecord("benefits", source),
    project = projectByCode(record.projectCode),
    programme = programmeById(record.programmeId) || programmeForProject(project);
  record.linkLevel = record.linkLevel || (record.projectCode ? "Project" : "Programme");
  record.programmeId = programme?.programmeId || record.programmeId || "";
  record.programmeName = programme?.name || record.programmeName || "";
  record.projectName = project?.projectName || record.projectName || "";
  return record;
}
// Cells tracked in the benefit change history.
const BENEFIT_AUDIT_FIELDS = [
  { key: "linkLevel", label: "Benefit level" },
  { key: "programmeId", label: "Programme" },
  { key: "projectCode", label: "Project" },
  { key: "description", label: "Description" },
  { key: "benefitType", label: "Benefit type" },
  { key: "owner", label: "Owner" },
  { key: "baselineValue", label: "Baseline value" },
  { key: "targetValue", label: "Target value" },
  { key: "measurementUnit", label: "Measurement unit" },
  { key: "currentValue", label: "Current value" },
  { key: "targetRealisationDate", label: "Target realisation date" },
  { key: "status", label: "Status" },
  { key: "realisationConfidence", label: "Realisation confidence" },
  { key: "nextReviewDate", label: "Next review date" },
  { key: "measurementMethod", label: "Measurement method" },
  { key: "commentary", label: "Commentary" },
  { key: "evidence", label: "Evidence" }
];
function loadData() {
  programmes = PPMGovernance.getProgrammes();
  projects = PPMStore.projects.all();
  benefits = PPMRegisters.readRecords("benefits").map(normaliseBenefit);
  originalBenefits = new Map(
    benefits.map((record) => [record.benefitId, JSON.parse(JSON.stringify(record))])
  );
  dirtyIds = new Set();
  setDirty(false);
}
function projectOptions(selected, programmeId) {
  return (
    '<option value="">Select a project</option>' +
    projects
      .slice()
      .sort((a, b) => String(a.projectCode).localeCompare(String(b.projectCode)))
      .map((project) => {
        const programme = programmeForProject(project),
          outside = programmeId && programme?.programmeId !== programmeId;
        return `<option value="${escapeHtml(project.projectCode)}" ${project.projectCode === selected ? "selected" : ""} ${outside || (isArchived(project) && project.projectCode !== selected) ? "disabled" : ""}>${escapeHtml(project.projectCode)} - ${escapeHtml(project.projectName || "Unnamed project")}${outside ? " (different programme)" : ""}${isArchived(project) ? " (Archived)" : ""}</option>`;
      })
      .join("")
  );
}
function programmeOptions(selected) {
  return (
    '<option value="">Select a programme</option>' +
    programmes
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (programme) =>
          `<option value="${escapeHtml(programme.programmeId)}" ${programme.programmeId === selected ? "selected" : ""}>${escapeHtml(programme.name)} (${escapeHtml(programme.programmeId)})</option>`
      )
      .join("")
  );
}
function field(record, key, markup) {
  return markup.replace(
    "{{COMMON}}",
    `class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="${escapeHtml(key)}" aria-label="${escapeHtml(key.replace(/([A-Z])/g, " $1"))}"`
  );
}
function rowMarkup(record) {
  const project = projectByCode(record.projectCode),
    archived = isArchived(project),
    disabled = archived ? " disabled" : "",
    programmeOnly = record.linkLevel === "Programme";
  return `<tr data-benefit-id="${escapeHtml(record.benefitId)}" class="${dirtyIds.has(record.benefitId) ? "dirty-row" : ""} ${archived ? "archived-row" : ""}">
      <td><input class="inline-field" value="${escapeHtml(record.benefitId)}" readonly aria-label="Benefit ID"></td>
      <td><select class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="linkLevel" aria-label="Benefit level"${disabled}>${optionMarkup(["Project", "Programme"], record.linkLevel)}</select></td>
      <td><select class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="programmeId" aria-label="Programme"${disabled}>${programmeOptions(record.programmeId)}</select>${record.programmeId ? `<a class="record-link" href="programme.html?programme=${encodeURIComponent(record.programmeId)}">Open programme</a>` : ""}</td>
      <td><select class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="projectCode" aria-label="Project" ${programmeOnly || archived ? "disabled" : ""}>${projectOptions(record.projectCode, record.programmeId)}</select>${record.projectCode ? `<a class="record-link" href="project-details.html?code=${encodeURIComponent(record.projectCode)}">Open project</a>` : programmeOnly ? '<span class="row-note">Programme-level benefit</span>' : ""}${archived ? '<span class="row-note">Archived project - row is read-only.</span>' : ""}</td>
      <td><textarea class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="description" aria-label="Benefit description" placeholder="Describe the measurable outcome"${disabled}>${escapeHtml(record.description || "")}</textarea></td>
      <td><select class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="benefitType" aria-label="Benefit type"${disabled}>${optionMarkup(benefitTypes, record.benefitType)}</select></td>
      <td><select class="inline-field benefit-owner" data-id="${escapeHtml(record.benefitId)}" data-field="ownerResourceId" aria-label="Benefit owner"${disabled}></select></td>
      <td><input class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="baselineValue" aria-label="Baseline value" value="${escapeHtml(record.baselineValue || "")}"${disabled}></td>
      <td><input class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="targetValue" aria-label="Target value" value="${escapeHtml(record.targetValue || "")}"${disabled}></td>
      <td><input class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="measurementUnit" aria-label="Measurement unit" value="${escapeHtml(record.measurementUnit || "")}"${disabled}></td>
      <td><input class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="currentValue" aria-label="Current value" value="${escapeHtml(record.currentValue || "")}"${disabled}></td>
      <td><input type="date" class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="targetRealisationDate" aria-label="Target realisation date" value="${escapeHtml(record.targetRealisationDate || "")}"${disabled}></td>
      <td><select class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="status" aria-label="Benefit status"${disabled}>${optionMarkup(benefitStatuses, record.status)}</select></td>
      <td><select class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="realisationConfidence" aria-label="Realisation confidence"${disabled}>${optionMarkup(confidenceOptions, record.realisationConfidence)}</select></td>
      <td><input type="date" class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="nextReviewDate" aria-label="Next review date" value="${escapeHtml(record.nextReviewDate || "")}"${disabled}></td>
      <td><textarea class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="measurementMethod" aria-label="Measurement method"${disabled}>${escapeHtml(record.measurementMethod || "")}</textarea></td>
      <td><textarea class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="commentary" aria-label="Benefit commentary"${disabled}>${escapeHtml(record.commentary || "")}</textarea></td>
      <td><input class="inline-field" data-id="${escapeHtml(record.benefitId)}" data-field="evidence" aria-label="Benefit evidence" value="${escapeHtml(record.evidence || "")}"${disabled}></td>
      <td><div class="row-actions">${PPMChangeLog.historyButton("Benefit", record.benefitId, record.benefitName || record.benefitId)}<button type="button" class="button danger small delete-benefit" data-permission="benefits.edit" data-id="${escapeHtml(record.benefitId)}" ${archived ? "disabled" : ""}>Delete</button></div></td>
    </tr>`;
}
function filteredBenefits() {
  const search = document.getElementById("benefitSearch").value.trim().toLowerCase(),
    programme = document.getElementById("programmeFilter").value,
    project = document.getElementById("projectFilter").value,
    status = document.getElementById("statusFilter").value;
  return benefits.filter((record) => {
    const text = [
      record.benefitId,
      record.description,
      record.benefitType,
      record.owner,
      record.measurementMethod,
      record.commentary,
      record.targetValue,
      record.programmeName,
      record.projectName
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!search || text.includes(search)) &&
      (!programme || record.programmeId === programme) &&
      (!project || record.projectCode === project) &&
      (!status || record.status === status)
    );
  });
}
function renderFilters() {
  const programmeValue = document.getElementById("programmeFilter").value,
    projectValue = document.getElementById("projectFilter").value,
    statusValue = document.getElementById("statusFilter").value;
  document.getElementById("programmeFilter").innerHTML =
    '<option value="">All programmes</option>' +
    programmes
      .map(
        (programme) =>
          `<option value="${escapeHtml(programme.programmeId)}">${escapeHtml(programme.name)}</option>`
      )
      .join("");
  document.getElementById("programmeFilter").value = programmeValue;
  document.getElementById("projectFilter").innerHTML =
    '<option value="">All projects</option>' +
    projects
      .map(
        (project) =>
          `<option value="${escapeHtml(project.projectCode)}">${escapeHtml(project.projectCode)} - ${escapeHtml(project.projectName || "Unnamed project")}</option>`
      )
      .join("");
  document.getElementById("projectFilter").value = projectValue;
  document.getElementById("statusFilter").innerHTML =
    '<option value="">All statuses</option>' +
    benefitStatuses.map((status) => `<option>${escapeHtml(status)}</option>`).join("");
  document.getElementById("statusFilter").value = statusValue;
}
function populateOwners() {
  document.querySelectorAll(".benefit-owner").forEach((select) => {
    const record = benefits.find((item) => item.benefitId === select.dataset.id);
    PPMResources.populatePersonSelect(select, {
      selectedResourceId: record.ownerResourceId || "",
      legacyName: record.owner || "",
      blankLabel: "Select benefit owner",
      allowGeneric: true
    });
  });
}
function renderSummary(rows) {
  document.getElementById("totalBenefits").textContent = rows.length;
  document.getElementById("deliveryBenefits").textContent = rows.filter((record) =>
    ["Approved", "In delivery", "Partially realised"].includes(record.status)
  ).length;
  document.getElementById("realisedBenefits").textContent = rows.filter(
    (record) => record.status === "Realised"
  ).length;
  document.getElementById("atRiskBenefits").textContent = rows.filter(
    (record) => record.realisationConfidence === "Low" || record.status === "Not realised"
  ).length;
  document.getElementById("overdueBenefits").textContent = rows.filter(
    (record) =>
      record.nextReviewDate &&
      record.nextReviewDate < today() &&
      !["Realised", "No longer applicable"].includes(record.status)
  ).length;
}
function renderTable() {
  const rows = filteredBenefits();
  document.getElementById("benefitBody").innerHTML =
    rows.map(rowMarkup).join("") +
    `<tr class="add-row"><td colspan="19"><button type="button" class="add-row-button" data-permission="benefits.edit">+ Add benefit row</button></td></tr>`;
  document.getElementById("emptyState").style.display = rows.length ? "none" : "block";
  populateOwners();
  attachEvents();
  renderSummary(rows);
  focusRequestedItem();
}
function focusRequestedItem() {
  if (!pendingFocusItem) return;
  const row = [...document.querySelectorAll("[data-benefit-id]")].find(
    (item) => item.dataset.benefitId === pendingFocusItem
  );
  if (!row) return;
  pendingFocusItem = "";
  row.classList.add("target-row");
  requestAnimationFrame(() => row.scrollIntoView({ block: "center", inline: "center" }));
}
function attachEvents() {
  document.querySelectorAll(".inline-field[data-id]").forEach((control) => {
    if (control.disabled) return;
    control.addEventListener(control.tagName === "SELECT" ? "change" : "input", handleChange);
  });
  document
    .querySelectorAll(".delete-benefit")
    .forEach((button) => button.addEventListener("click", () => openDelete(button.dataset.id)));
  document
    .querySelectorAll(".add-row-button")
    .forEach((button) => button.addEventListener("click", addBenefit));
}
function handleChange(event) {
  const control = event.currentTarget,
    record = benefits.find((item) => item.benefitId === control.dataset.id);
  if (!record) return;
  const key = control.dataset.field;
  if (key === "ownerResourceId") {
    const person = PPMResources.getSelectedPerson(control);
    record.owner = person.name;
    record.ownerResourceId = person.resourceId;
    record.ownerEmail = person.email;
  } else {
    record[key] = control.value;
    if (key === "linkLevel" && control.value === "Programme") {
      record.projectCode = "";
      record.projectName = "";
    }
    if (key === "projectCode") {
      const project = projectByCode(control.value),
        programme = programmeForProject(project);
      record.projectName = project?.projectName || "";
      record.programmeId = programme?.programmeId || "";
      record.programmeName = programme?.name || "";
      record.linkLevel = "Project";
    }
    if (key === "programmeId") {
      const programme = programmeById(control.value);
      record.programmeName = programme?.name || "";
      if (
        record.projectCode &&
        programmeForProject(projectByCode(record.projectCode))?.programmeId !== control.value
      ) {
        record.projectCode = "";
        record.projectName = "";
      }
    }
  }
  record.updatedAt = new Date().toISOString();
  dirtyIds.add(record.benefitId);
  setDirty(true);
  clearMessage();
  if (["linkLevel", "programmeId", "projectCode"].includes(key)) renderTable();
  else renderSummary(filteredBenefits());
}
function defaultProject() {
  const selected = document.getElementById("projectFilter").value;
  if (selected && !isArchived(projectByCode(selected))) return selected;
  return projects.find((project) => !isArchived(project))?.projectCode || "";
}
function addBenefit() {
  const record = normaliseBenefit(
    PPMRegisters.newRecord("benefits", benefits, parameters.get("project") || defaultProject())
  );
  if (parameters.get("programme") && !parameters.get("project")) {
    record.linkLevel = "Programme";
    record.programmeId = parameters.get("programme");
    record.programmeName = programmeById(record.programmeId)?.name || "";
    record.projectCode = "";
    record.projectName = "";
  }
  benefits.push(record);
  dirtyIds.add(record.benefitId);
  setDirty(true);
  document.getElementById("benefitSearch").value = "";
  renderFilters();
  renderTable();
  requestAnimationFrame(() => {
    const control = document.querySelector(
      `[data-id="${CSS.escape(record.benefitId)}"][data-field="description"]`
    );
    if (control) {
      control.scrollIntoView({ block: "center", inline: "center" });
      control.focus();
    }
  });
}
function openDelete(id) {
  const record = benefits.find((item) => item.benefitId === id);
  if (!record) return;
  pendingDeleteId = id;
  document.getElementById("deleteMessage").textContent =
    `Delete ${id}: ${record.description || "this benefit"}? The row will be removed when you select Save changes.`;
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
  benefits = benefits.filter((record) => record.benefitId !== id);
  closeDelete();
  dirtyIds.add(id);
  setDirty(true);
  renderFilters();
  renderTable();
  showMessage(`${id} was removed. Select Save changes to confirm.`, "success");
}
function validationError(record, key, message) {
  showMessage(message, "error");
  const control = document.querySelector(
    `[data-id="${CSS.escape(record.benefitId)}"][data-field="${CSS.escape(key)}"]`
  );
  if (control) {
    control.scrollIntoView({ block: "center", inline: "center" });
    control.focus();
  }
  return false;
}
function validate() {
  for (const record of benefits) {
    if (!["Project", "Programme"].includes(record.linkLevel))
      return validationError(record, "linkLevel", `${record.benefitId} needs a benefit level.`);
    if (!programmeById(record.programmeId))
      return validationError(record, "programmeId", `${record.benefitId} must link to a programme.`);
    if (record.linkLevel === "Project" && !projectByCode(record.projectCode))
      return validationError(record, "projectCode", `${record.benefitId} must link to a project.`);
    for (const [key, label] of [
      ["description", "benefit description"],
      ["benefitType", "benefit type"],
      ["owner", "owner"],
      ["targetValue", "target value"],
      ["targetRealisationDate", "target realisation date"],
      ["status", "status"]
    ])
      if (!String(record[key] || "").trim())
        return validationError(
          record,
          key === "owner" ? "ownerResourceId" : key,
          `${record.benefitId} needs a ${label}.`
        );
  }
  return true;
}
async function saveChanges() {
  if (!hasUnsavedChanges || !validate()) return;
  const now = new Date().toISOString();
  benefits = benefits.map((record) => {
    const prepared = normaliseBenefit(PPMRegisters.prepareRecord("benefits", record));
    prepared.updatedAt = dirtyIds.has(record.benefitId) ? now : record.updatedAt;
    prepared.lastReviewDate = prepared.lastReviewDate || "";
    return prepared;
  });
  /* Stage 16: awaited. The audit entries below describe changes that have been made, so a
     refused save must stop before they are recorded. */
  const saved = await PPMRegisters.writeRecords("benefits", benefits);
  if (saved && saved.ok === false) {
    setMessage(saved.message, "error");
    return;
  }

  /* A PPMChangeLog.trackCollection() call was here. Stage 14: PostgreSQL records every change
     itself; see the note at the top of ppm-change-log.js for why this one survived it. */
  loadData();
  renderAll();
  showMessage(
    "Benefit changes were saved and are available to reports, formal status reporting and global search.",
    "success"
  );
}
function renderAll() {
  renderFilters();
  renderTable();
}

document.getElementById("benefitSearch").addEventListener("input", renderTable);
document.getElementById("programmeFilter").addEventListener("change", renderTable);
document.getElementById("projectFilter").addEventListener("change", renderTable);
document.getElementById("statusFilter").addEventListener("change", renderTable);
document.getElementById("addBenefitButton").addEventListener("click", addBenefit);
document.getElementById("saveButton").addEventListener("click", saveChanges);
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
loadData();
renderFilters();
if (parameters.get("programme"))
  document.getElementById("programmeFilter").value = parameters.get("programme");
if (parameters.get("project")) document.getElementById("projectFilter").value = parameters.get("project");
renderTable();
