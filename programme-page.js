"use strict";


let programmes = PPMGovernance.getProgrammes();
let programmeMilestones = parseStore("programmeMilestones", {});
let programmeRaid = parseStore("programmeRaid", {});
let editingProgrammeId = "";
let pendingConfirmation = null;

/* Stage 16: read from PPMStore in the collection's registered shape, rather than parsing the
   localStorage mirror. Programme milestones and RAID are keyed by "programme:<id>". */
function parseStore(collection, fallback) {
  if (!window.PPMStore) return fallback;
  const value = PPMStore[collection].read();
  return value === null || value === undefined ? fallback : value;
}
// Cells tracked in the programme change history.
const PROGRAMME_AUDIT_FIELDS = [
  { key: "name", label: "Programme name" },
  { key: "portfolio", label: "Portfolio" },
  { key: "description", label: "Description" },
  { key: "overallStatus", label: "Status" },
  { key: "overallRag", label: "Overall RAG" },
  { key: "sponsor", label: "Sponsor" },
  { key: "lead", label: "Lead" },
  { key: "programmeManager", label: "Programme manager" },
  { key: "startDate", label: "Start date" },
  { key: "endDate", label: "End date" },
  { key: "budget", label: "Budget" },
  { key: "strategicObjective", label: "Strategic objective" },
  { key: "benefits", label: "Benefits" },
  { key: "commentary", label: "Commentary" },
  { key: "nextSteps", label: "Next steps" }
];
const PROGRAMME_MILESTONE_FIELDS = [
  { key: "title", label: "Milestone" },
  { key: "type", label: "Type" },
  { key: "baselineDate", label: "Baseline date" },
  { key: "forecastDate", label: "Forecast date" },
  { key: "percentageComplete", label: "Complete (%)" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  { key: "notes", label: "Notes" }
];
const PROGRAMME_RAID_FIELDS = [
  { key: "type", label: "Type" },
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "targetDate", label: "Target date" },
  { key: "response", label: "Response" },
  { key: "owner", label: "Owner" }
];
const escapeHtml = PPMCore.escapeHtml;
function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function formatMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number
    ? number.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 })
    : "Not set";
}
function getProjects() {
  const projects = parseStore("projects", []);
  return Array.isArray(projects) ? projects : [];
}
function programmeProjects(programme) {
  return getProjects().filter(
    (project) =>
      project.programmeId === programme.programmeId ||
      String(project.workstream || project.programme || "").toLowerCase() ===
        String(programme.name).toLowerCase()
  );
}
function person(id) {
  return PPMResources.getSelectedPerson(id);
}
function personLabel(name) {
  return name || "Not assigned";
}
function ragBadge(value) {
  const rag = value || "Not Assessed";
  const tone = rag === "Green" ? "green" : rag === "Amber" ? "amber" : rag === "Red" ? "red" : "";
  return `<span class="badge ${tone}">${escapeHtml(rag)}</span>`;
}
function recordId(prefix, records) {
  const highest = (records || []).reduce((max, item) => {
    const match = String(item.recordId || "").match(/(\d+)$/);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
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

function renderSummary() {
  const projects = getProjects().filter((project) => !PPMGovernance.isArchived(project));
  const openRaid = Object.values(programmeRaid)
    .flat()
    .filter((item) => item.status !== "Closed");
  document.getElementById("programmeCount").textContent = programmes.length;
  document.getElementById("activeProgrammeCount").textContent = programmes.filter(
    (item) => item.overallStatus === "Active"
  ).length;
  document.getElementById("programmeProjectCount").textContent = projects.filter((project) =>
    PPMGovernance.findProgramme(project.programmeId, project.workstream)
  ).length;
  document.getElementById("programmeBudget").textContent = formatMoney(
    programmes.reduce((sum, item) => sum + (Number(item.budget) || 0), 0)
  ).replace("Not set", "£0");
  document.getElementById("programmeRaidCount").textContent = openRaid.length;
}

function filteredProgrammes() {
  const search = document.getElementById("programmeSearch").value.trim().toLowerCase();
  const status = document.getElementById("programmeStatusFilter").value;
  const rag = document.getElementById("programmeRagFilter").value;
  return programmes.filter((programme) => {
    const projects = programmeProjects(programme);
    const searchable = [
      programme.programmeId,
      programme.name,
      programme.description,
      programme.sponsor,
      programme.lead,
      programme.programmeManager,
      programme.strategicObjective,
      programme.benefits,
      ...projects.map((project) => `${project.projectCode} ${project.projectName}`)
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!search || searchable.includes(search)) &&
      (!status || programme.overallStatus === status) &&
      (!rag || programme.overallRag === rag)
    );
  });
}

function projectsMarkup(programme) {
  const projects = programmeProjects(programme);
  if (!projects.length)
    return '<div class="empty-state">No projects are associated with this programme.</div>';
  return `<div class="table-wrapper"><table><thead><tr><th>Project</th>
<th>Manager</th>
<th>Status</th>
<th>RAG</th>
<th>Stage</th></tr></thead><tbody>${projects
    .map(
      (
        project
      ) => `<tr><td><a class="project-link" href="project-details.html?code=${encodeURIComponent(project.projectCode)}">${escapeHtml(project.projectName)}</a><br>${escapeHtml(project.projectCode)}</td>
<td>${escapeHtml(personLabel(project.projectManager))}</td>
<td>${escapeHtml(project.archived ? "Archived" : project.projectStatus || "Not set")}</td>
<td>${ragBadge(project.overallRag)}</td>
<td>${escapeHtml(project.currentStage || "Not set")}</td></tr>`
    )
    .join("")}</tbody></table></div>`;
}

function milestonesMarkup(programme) {
  const rows = Array.isArray(programmeMilestones[programme.programmeId])
    ? programmeMilestones[programme.programmeId]
    : [];
  if (!rows.length) return '<div class="empty-state">No programme milestones have been recorded.</div>';
  return `<div class="table-wrapper"><table><thead><tr><th>Milestone</th>
<th>Forecast</th>
<th>Status</th>
<th>Actions</th></tr></thead><tbody>${rows
    .map(
      (
        row
      ) => `<tr><td><strong>${escapeHtml(row.title)}</strong><br>${escapeHtml(row.type || "Milestone")}</td>
<td>${formatDate(row.forecastDate || row.baselineDate)}</td>
<td>${escapeHtml(row.status || "Not Started")} · ${Number(row.percentageComplete) || 0}%</td>
<td>${PPMChangeLog.historyButton("Programme milestone", row.recordId, row.title || row.recordId)} <button class="button light small record-edit" data-permission="programmes.edit" data-kind="milestone" data-programme-id="${escapeHtml(programme.programmeId)}" data-record-id="${escapeHtml(row.recordId)}">Edit</button> <button class="button danger small record-remove" data-permission="programmes.edit" data-kind="milestone" data-programme-id="${escapeHtml(programme.programmeId)}" data-record-id="${escapeHtml(row.recordId)}">Remove</button></td></tr>`
    )
    .join("")}</tbody></table></div>`;
}

function raidMarkup(programme) {
  const rows = Array.isArray(programmeRaid[programme.programmeId])
    ? programmeRaid[programme.programmeId]
    : [];
  if (!rows.length) return '<div class="empty-state">No programme-level RAID items have been recorded.</div>';
  return `<div class="table-wrapper"><table><thead><tr><th>Item</th>
<th>Owner</th>
<th>Status</th>
<th>Actions</th></tr></thead><tbody>${rows
    .map(
      (
        row
      ) => `<tr><td><span class="badge blue">${escapeHtml(row.type || "RAID")}</span><br><strong>${escapeHtml(row.title)}</strong><br>${escapeHtml(row.priority || "Medium")}</td>
<td>${escapeHtml(personLabel(row.owner))}</td>
<td>${escapeHtml(row.status || "Open")}<br>${formatDate(row.targetDate)}</td>
<td>${PPMChangeLog.historyButton("Programme RAID", row.recordId, row.title || row.recordId)} <button class="button light small record-edit" data-permission="programmes.edit" data-kind="raid" data-programme-id="${escapeHtml(programme.programmeId)}" data-record-id="${escapeHtml(row.recordId)}">Edit</button> <button class="button danger small record-remove" data-permission="programmes.edit" data-kind="raid" data-programme-id="${escapeHtml(programme.programmeId)}" data-record-id="${escapeHtml(row.recordId)}">Remove</button></td></tr>`
    )
    .join("")}</tbody></table></div>`;
}

function renderProgrammes() {
  const rows = filteredProgrammes();
  document.getElementById("programmeList").innerHTML = rows.length
    ? rows
        .map(
          (programme) =>
            `<article class="programme-card"><div class="programme-heading"><div><h3>${escapeHtml(programme.name)}</h3><p>${escapeHtml(programme.programmeId)} · ${escapeHtml(programme.portfolio || "No portfolio")} · ${programmeProjects(programme).length} project(s)</p></div><div class="heading-actions">${ragBadge(programme.overallRag)}<span class="badge">${escapeHtml(programme.overallStatus || "Not set")}</span><a class="button light small" href="benefits-management.html?programme=${encodeURIComponent(programme.programmeId)}">Manage benefits</a><button class="button small programme-edit" data-programme-id="${escapeHtml(programme.programmeId)}" data-permission="programmes.edit">Edit programme</button></div></div><div class="programme-body"><div class="programme-information"><div class="info-card"><span class="info-label">Sponsor</span><span class="info-value">${escapeHtml(personLabel(programme.sponsor))}</span></div><div class="info-card"><span class="info-label">Lead</span><span class="info-value">${escapeHtml(personLabel(programme.lead))}</span></div><div class="info-card"><span class="info-label">Programme manager</span><span class="info-value">${escapeHtml(personLabel(programme.programmeManager))}</span></div><div class="info-card"><span class="info-label">Dates</span><span class="info-value">${formatDate(programme.startDate)} – ${formatDate(programme.endDate)}</span></div><div class="info-card"><span class="info-label">Budget</span><span class="info-value">${formatMoney(programme.budget)}</span></div><div class="info-card"><span class="info-label">Status</span><span class="info-value">${escapeHtml(programme.overallStatus || "Not set")}</span></div></div><div class="programme-narrative"><div class="narrative-card"><h4>Strategic objective</h4><p>${escapeHtml(programme.strategicObjective || "Not recorded")}</p></div><div class="narrative-card"><h4>Expected benefits</h4><p>${escapeHtml(programme.benefits || "Not recorded")}</p></div><div class="narrative-card"><h4>Commentary and next steps</h4><p>${escapeHtml([programme.commentary, programme.nextSteps].filter(Boolean).join("\n\n") || "Not recorded")}</p></div></div><div class="record-grid"><section class="record-panel"><div class="section-heading"><div><h4>Associated projects</h4><p>Projects linked through the programme ID.</p></div><a class="button light small" href="add-project.html" data-permission="projects.create">Add project</a></div>${projectsMarkup(programme)}</section><section class="record-panel"><div class="section-heading"><div><h4>Programme milestones</h4><p>Key programme dates and stage gates.</p></div><button class="button small record-add" data-kind="milestone" data-permission="programmes.edit" data-programme-id="${escapeHtml(programme.programmeId)}">Add milestone</button></div>${milestonesMarkup(programme)}</section><section class="record-panel"><div class="section-heading"><div><h4>Programme RAID</h4><p>Risks, assumptions, issues and dependencies.</p></div><button class="button small record-add" data-kind="raid" data-permission="programmes.edit" data-programme-id="${escapeHtml(programme.programmeId)}">Add RAID</button></div>${raidMarkup(programme)}</section></div></div></article>`
        )
        .join("")
    : '<div class="empty-state">No programmes match the selected filters.</div>';
  attachCardEvents();
  renderSummary();
}

function populateProgrammePeople(programme = {}) {
  PPMResources.populatePersonSelect("programmeSponsor", {
    selectedResourceId: programme.sponsorResourceId,
    legacyName: programme.sponsor,
    blankLabel: "Select a sponsor"
  });
  PPMResources.populatePersonSelect("programmeLead", {
    selectedResourceId: programme.leadResourceId,
    legacyName: programme.lead,
    blankLabel: "Select a lead"
  });
  PPMResources.populatePersonSelect("programmeManager", {
    selectedResourceId: programme.programmeManagerResourceId,
    legacyName: programme.programmeManager,
    blankLabel: "Select a programme manager"
  });
}
function populateProgrammePortfolio(programme = {}) {
  const field = document.getElementById("programmePortfolio"),
    portfolios = PPMAdmin.getPortfolios(),
    selected =
      PPMAdmin.findPortfolio(programme.portfolioId || programme.portfolio) ||
      portfolios.find((item) => item.active !== false);
  field.innerHTML =
    '<option value="">Select a portfolio</option>' +
    portfolios
      .filter((item) => item.active !== false || item.portfolioId === selected?.portfolioId)
      .map(
        (item) =>
          `<option value="${escapeHtml(item.portfolioId)}">${escapeHtml(item.name)}${item.active === false ? " (inactive)" : ""}</option>`
      )
      .join("");
  field.value = selected?.portfolioId || "";
}
function openProgramme(programmeId) {
  clearMessage();
  editingProgrammeId = programmeId || "";
  const programme = programmes.find((item) => item.programmeId === programmeId) || {};
  document.getElementById("programmeForm").reset();
  document.getElementById("programmeModalTitle").textContent = programmeId
    ? "Edit programme"
    : "Add programme";
  document.getElementById("programmeId").value = programmeId || PPMGovernance.nextProgrammeId(programmes);
  document.getElementById("programmeName").value = programme.name || "";
  populateProgrammePortfolio(programme);
  document.getElementById("programmeDescription").value = programme.description || "";
  document.getElementById("programmeStatus").value = programme.overallStatus || "Active";
  document.getElementById("programmeRag").value = programme.overallRag || "Not Assessed";
  document.getElementById("programmeStartDate").value = programme.startDate || "";
  document.getElementById("programmeEndDate").value = programme.endDate || "";
  document.getElementById("programmeBudgetInput").value = programme.budget ?? "";
  document.getElementById("programmeObjective").value = programme.strategicObjective || "";
  document.getElementById("programmeBenefits").value = programme.benefits || "";
  document.getElementById("programmeCommentary").value = programme.commentary || "";
  document.getElementById("programmeNextSteps").value = programme.nextSteps || "";
  populateProgrammePeople(programme);
  document.getElementById("programmeModal").classList.add("visible");
  document.getElementById("programmeName").focus();
}
function closeProgramme() {
  document.getElementById("programmeModal").classList.remove("visible");
}
/* A submit handler, so the async chain that starts at the save stops here. */
async function saveProgramme(event) {
  event.preventDefault();
  const sponsor = person("programmeSponsor"),
    lead = person("programmeLead"),
    manager = person("programmeManager"),
    portfolio = PPMAdmin.findPortfolio(document.getElementById("programmePortfolio").value);
  const old = programmes.find((item) => item.programmeId === editingProgrammeId);
  const record = {
    ...(old || {}),
    programmeId: document.getElementById("programmeId").value,
    name: document.getElementById("programmeName").value.trim(),
    portfolioId: portfolio?.portfolioId || "",
    portfolio: portfolio?.name || "",
    description: document.getElementById("programmeDescription").value.trim(),
    overallStatus: document.getElementById("programmeStatus").value,
    overallRag: document.getElementById("programmeRag").value,
    sponsor: sponsor.name,
    sponsorResourceId: sponsor.resourceId,
    sponsorEmail: sponsor.email,
    lead: lead.name,
    leadResourceId: lead.resourceId,
    leadEmail: lead.email,
    programmeManager: manager.name,
    programmeManagerResourceId: manager.resourceId,
    programmeManagerEmail: manager.email,
    startDate: document.getElementById("programmeStartDate").value,
    endDate: document.getElementById("programmeEndDate").value,
    budget: Number(document.getElementById("programmeBudgetInput").value) || 0,
    strategicObjective: document.getElementById("programmeObjective").value.trim(),
    benefits: document.getElementById("programmeBenefits").value.trim(),
    commentary: document.getElementById("programmeCommentary").value.trim(),
    nextSteps: document.getElementById("programmeNextSteps").value.trim(),
    active: document.getElementById("programmeStatus").value !== "Inactive",
    createdAt: old?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (record.startDate && record.endDate && record.endDate < record.startDate) {
    setMessage("Programme end date cannot be before its start date.", "error");
    return;
  }
  const index = programmes.findIndex((item) => item.programmeId === record.programmeId);
  if (index >= 0) programmes[index] = record;
  else programmes.push(record);
  /*
    Stage 16: awaited, and nothing below runs unless the database accepted it. The audit entry
    and the project updates that follow both describe a change that has been made - writing
    them after a refused save would record something that did not happen.
  */
  const programmeResult = await PPMGovernance.saveProgrammes(programmes);
  if (!programmeResult.ok) {
    setMessage(programmeResult.message, "error");
    return;
  }
  programmes = programmeResult.programmes;

  PPMChangeLog.recordRow({
    before: old,
    after: record,
    entityType: "Programme",
    entityId: record.programmeId,
    fields: PROGRAMME_AUDIT_FIELDS,
    statusField: "overallStatus",
    name: record.name
  });
  const projects = getProjects();
  let projectsChanged = false;
  projects.forEach((project) => {
    if (
      project.programmeId === record.programmeId ||
      (old && String(project.workstream).toLowerCase() === String(old.name).toLowerCase())
    ) {
      project.programmeId = record.programmeId;
      project.programme = record.name;
      project.workstream = record.name;
      project.updatedAt = new Date().toISOString();
      projectsChanged = true;
    }
  });
  if (projectsChanged) {
    const projectResult = await PPMStore.projects.replaceAll(projects);
    if (!projectResult.ok) {
      setMessage(
        `${record.name} was saved, but the projects that reference it were not updated: ${projectResult.message}`,
        "error"
      );
      renderProgrammes();
      return;
    }
  }

  closeProgramme();
  renderProgrammes();
  setMessage(`${record.name} was saved.`, "success");
}

function findRecord(kind, programmeId, id) {
  const store = kind === "milestone" ? programmeMilestones : programmeRaid;
  return (store[programmeId] || []).find((item) => item.recordId === id) || {};
}
function populateRecordPeople(record = {}) {
  PPMResources.populatePersonSelect("milestoneOwner", {
    selectedResourceId: record.ownerResourceId,
    legacyName: record.owner,
    blankLabel: "Select an owner"
  });
  PPMResources.populatePersonSelect("programmeRaidOwner", {
    selectedResourceId: record.ownerResourceId,
    legacyName: record.owner,
    blankLabel: "Select an owner"
  });
}
function openRecord(kind, programmeId, id = "") {
  const record = findRecord(kind, programmeId, id);
  document.getElementById("recordForm").reset();
  document.getElementById("recordProgrammeId").value = programmeId;
  document.getElementById("recordId").value = id;
  document.getElementById("recordKind").value = kind;
  document.getElementById("milestoneFields").hidden = kind !== "milestone";
  document.getElementById("raidFields").hidden = kind !== "raid";
  document.getElementById("recordModalTitle").textContent = `${id ? "Edit" : "Add"} programme ${kind}`;
  document.getElementById("recordModalDescription").textContent =
    kind === "milestone"
      ? "Maintain a programme milestone or stage gate."
      : "Maintain a programme-level risk, assumption, issue or dependency.";
  if (kind === "milestone") {
    document.getElementById("milestoneTitle").value = record.title || "";
    document.getElementById("milestoneType").value = record.type || "Milestone";
    document.getElementById("milestoneBaselineDate").value = record.baselineDate || "";
    document.getElementById("milestoneForecastDate").value = record.forecastDate || "";
    document.getElementById("milestoneComplete").value = record.percentageComplete ?? 0;
    document.getElementById("milestoneStatus").value = record.status || "Not Started";
    document.getElementById("milestoneNotes").value = record.notes || "";
  } else {
    document.getElementById("programmeRaidType").value = record.type || "Risk";
    document.getElementById("programmeRaidTitle").value = record.title || "";
    document.getElementById("programmeRaidDescription").value = record.description || "";
    document.getElementById("programmeRaidPriority").value = record.priority || "Medium";
    document.getElementById("programmeRaidStatus").value = record.status || "Open";
    document.getElementById("programmeRaidTargetDate").value = record.targetDate || "";
    document.getElementById("programmeRaidResponse").value = record.response || "";
  }
  populateRecordPeople(record);
  document.getElementById("recordModal").classList.add("visible");
  (kind === "milestone"
    ? document.getElementById("milestoneTitle")
    : document.getElementById("programmeRaidTitle")
  ).focus();
}
function closeRecord() {
  document.getElementById("recordModal").classList.remove("visible");
}
/* Submit handler: the async chain ends here. */
async function saveRecord(event) {
  event.preventDefault();
  const kind = document.getElementById("recordKind").value,
    programmeId = document.getElementById("recordProgrammeId").value,
    id = document.getElementById("recordId").value;
  const store = kind === "milestone" ? programmeMilestones : programmeRaid;
  const records = Array.isArray(store[programmeId]) ? [...store[programmeId]] : [];
  const owner = person(kind === "milestone" ? "milestoneOwner" : "programmeRaidOwner");
  let record;
  if (kind === "milestone") {
    const title = document.getElementById("milestoneTitle").value.trim();
    if (!title) {
      setMessage("Enter a milestone title.", "error");
      return;
    }
    record = {
      recordId: id || recordId("PM", records),
      title,
      type: document.getElementById("milestoneType").value,
      baselineDate: document.getElementById("milestoneBaselineDate").value,
      forecastDate: document.getElementById("milestoneForecastDate").value,
      percentageComplete: Number(document.getElementById("milestoneComplete").value) || 0,
      status: document.getElementById("milestoneStatus").value,
      notes: document.getElementById("milestoneNotes").value.trim(),
      owner: owner.name,
      ownerResourceId: owner.resourceId,
      ownerEmail: owner.email
    };
  } else {
    const title = document.getElementById("programmeRaidTitle").value.trim(),
      description = document.getElementById("programmeRaidDescription").value.trim();
    if (!title || !description) {
      setMessage("Enter a RAID title and description.", "error");
      return;
    }
    record = {
      recordId: id || recordId("PRAID", records),
      type: document.getElementById("programmeRaidType").value,
      title,
      description,
      priority: document.getElementById("programmeRaidPriority").value,
      status: document.getElementById("programmeRaidStatus").value,
      targetDate: document.getElementById("programmeRaidTargetDate").value,
      response: document.getElementById("programmeRaidResponse").value.trim(),
      owner: owner.name,
      ownerResourceId: owner.resourceId,
      ownerEmail: owner.email
    };
  }
  record.updatedAt = new Date().toISOString();
  record.createdAt = findRecord(kind, programmeId, id).createdAt || record.updatedAt;
  const index = records.findIndex((item) => item.recordId === record.recordId);
  if (index >= 0) records[index] = record;
  else records.push(record);
  store[programmeId] = records;

  /*
    Stage 16: one record, not the whole store.

    These collections are keyed by programme, so the storage group has to be stated - the
    adapter derives it from a project or programme CODE, and these records carry a programmeId.
    Passing the group explicitly is also why this is a single save rather than replaceAll:
    replaceAll diffs the entire collection, so handing it one programme's records would read
    every other programme's as deleted.
  */
  const recordResult = await PPMStore[kind === "milestone" ? "programmeMilestones" : "programmeRaid"].save(
    record,
    { storageGroup: programmeId }
  );
  if (!recordResult.ok) {
    setMessage(recordResult.message, "error");
    return;
  }

  PPMChangeLog.recordRow({
    before: id ? findRecord(kind, programmeId, id) : null,
    after: record,
    entityType: kind === "milestone" ? "Programme milestone" : "Programme RAID",
    entityId: record.recordId,
    fields: kind === "milestone" ? PROGRAMME_MILESTONE_FIELDS : PROGRAMME_RAID_FIELDS,
    statusField: "status",
    name: record.title
  });
  closeRecord();
  renderProgrammes();
  setMessage(`Programme ${kind} saved.`, "success");
}

function askConfirmation(title, message, action) {
  pendingConfirmation = action;
  document.getElementById("confirmationTitle").textContent = title;
  document.getElementById("confirmationMessage").textContent = message;
  document.getElementById("confirmationBackground").classList.add("visible");
}
function closeConfirmation() {
  pendingConfirmation = null;
  document.getElementById("confirmationBackground").classList.remove("visible");
}
function removeRecord(kind, programmeId, id) {
  const store = kind === "milestone" ? programmeMilestones : programmeRaid;
  const record = findRecord(kind, programmeId, id);
  askConfirmation(
    `Remove programme ${kind}?`,
    `Remove “${record.title || "this record"}”? This only removes the selected programme-level record.`,
    async () => {
      const removal = await PPMStore[kind === "milestone" ? "programmeMilestones" : "programmeRaid"].remove(
        record,
        { storageGroup: programmeId }
      );
      if (!removal.ok) {
        setMessage(removal.message, "error");
        return;
      }
      store[programmeId] = (store[programmeId] || []).filter((item) => item.recordId !== id);

      PPMChangeLog.recordDeletion({
        before: record,
        entityType: kind === "milestone" ? "Programme milestone" : "Programme RAID",
        entityId: id,
        fields: kind === "milestone" ? PROGRAMME_MILESTONE_FIELDS : PROGRAMME_RAID_FIELDS,
        statusField: "status",
        name: record.title
      });
      renderProgrammes();
      setMessage(`Programme ${kind} removed.`, "success");
    }
  );
}
function attachCardEvents() {
  document
    .querySelectorAll(".programme-edit")
    .forEach((button) => button.addEventListener("click", () => openProgramme(button.dataset.programmeId)));
  document
    .querySelectorAll(".record-add")
    .forEach((button) =>
      button.addEventListener("click", () => openRecord(button.dataset.kind, button.dataset.programmeId))
    );
  document
    .querySelectorAll(".record-edit")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openRecord(button.dataset.kind, button.dataset.programmeId, button.dataset.recordId)
      )
    );
  document
    .querySelectorAll(".record-remove")
    .forEach((button) =>
      button.addEventListener("click", () =>
        removeRecord(button.dataset.kind, button.dataset.programmeId, button.dataset.recordId)
      )
    );
}

document.getElementById("addProgrammeButton").addEventListener("click", () => openProgramme(""));
document.getElementById("programmeForm").addEventListener("submit", saveProgramme);
document.getElementById("closeProgrammeModal").addEventListener("click", closeProgramme);
document.getElementById("cancelProgrammeButton").addEventListener("click", closeProgramme);
document.getElementById("recordForm").addEventListener("submit", saveRecord);
document.getElementById("closeRecordModal").addEventListener("click", closeRecord);
document.getElementById("cancelRecordButton").addEventListener("click", closeRecord);
document.getElementById("cancelConfirmation").addEventListener("click", closeConfirmation);
document.getElementById("confirmAction").addEventListener("click", () => {
  const action = pendingConfirmation;
  closeConfirmation();
  if (action) action();
});
["programmeSearch", "programmeStatusFilter", "programmeRagFilter"].forEach((id) =>
  document
    .getElementById(id)
    .addEventListener(id === "programmeSearch" ? "input" : "change", renderProgrammes)
);
document
  .getElementById("programmeForm")
  .addEventListener("submit", async () => {
    /* Awaited so a failure to reconcile membership is visible rather than a rejected promise
       nobody is listening to. */
    const reconciled = await PPMAdmin.reconcileProgrammeMembership();
    if (reconciled && reconciled.ok === false) setMessage(reconciled.message, "error");
  });
const programmeParameters = new URLSearchParams(window.location.search),
  requestedProgramme = programmeParameters.get("programme"),
  requestedProgrammeItem = programmeParameters.get("item") || "";
if (requestedProgramme) document.getElementById("programmeSearch").value = requestedProgramme;
renderProgrammes();
if (requestedProgrammeItem)
  requestAnimationFrame(() => {
    const row = document
      .querySelector(`[data-record-id="${CSS.escape(requestedProgrammeItem)}"]`)
      ?.closest("tr");
    if (row) {
      row.classList.add("ppm-notification-target");
      row.scrollIntoView({ block: "center", inline: "center" });
    }
  });
