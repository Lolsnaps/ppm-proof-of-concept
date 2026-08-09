"use strict";

const VIEW_STORAGE_KEY = "ppmReportViews";
const SESSION_STORAGE_KEY = "ppmReportSessionState";
const DAY_MS = 86400000;
const STALE_DAYS = 30;
const filterIds = [
  "projectFilter",
  "portfolioFilter",
  "programmeFilter",
  "workstreamFilter",
  "managerFilter",
  "sponsorFilter",
  "leadFilter",
  "stageFilter",
  "statusFilter",
  "priorityFilter",
  "businessAreaFilter",
  "ragFilter",
  "resourceTeamFilter",
  "riskRatingFilter",
  "benefitTypeFilter",
  "dateFromFilter",
  "dateToFilter",
  "projectSort",
  "includeArchived"
];
let projects = [],
  portfolios = [],
  lifecycleTemplates = [],
  formalGates = [],
  reportingPeriods = [],
  resources = [],
  tasks = [],
  milestones = [],
  raidItems = [],
  statusReports = [],
  actions = [],
  decisions = [],
  benefits = [],
  financials = [],
  documents = [];
let activePane = "portfolioPane";
let activeMetric = null;
let visibleReportColumns = new Set();
let currentReport = null;

function parseJson(key, fallback) {
  const value = localStorage.getItem(key);
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(`${key} could not be loaded.`, error);
    return fallback;
  }
}
const escapeHtml = PPMCore.escapeHtml;

/* Bar fills and roadmap markers are computed proportions. style-src 'self' blocks
   inline style attributes, so they are applied through CSSOM by PPMCore. */
const styleAttr = PPMCore.styleAttribute;
const todayIso = PPMCore.todayIso;
function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? escapeHtml(value)
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function formatPercent(value) {
  const number = Number(value);
  return `${Number.isFinite(number) ? Math.round(number) : 0}%`;
}
function formatMoney(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-GB", {
        style: "currency",
        currency: "GBP",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    : "Not available";
}
function projectLink(code, name) {
  return `<a class="project-link" href="project-details.html?code=${encodeURIComponent(code)}">${escapeHtml(name || code)}</a>`;
}
function gateLink(gate, label) {
  return `<a class="project-link" href="stage-gates.html?code=${encodeURIComponent(gate.projectCode)}&item=${encodeURIComponent(gate.gateId)}">${escapeHtml(label || gate.gateName || gate.gateId)}</a>`;
}
function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
}
function flattenStore(store, projectField = "projectCode") {
  if (Array.isArray(store)) return store;
  if (!store || typeof store !== "object") return [];
  return Object.entries(store).flatMap(([code, items]) =>
    Array.isArray(items)
      ? items.map((item) => ({
          ...item,
          [projectField]:
            item[projectField] || item.projectId || (/^(programme:|__)/i.test(code) ? "" : code),
          programmeId: item.programmeId || (code.startsWith("programme:") ? code.slice(10) : "")
        }))
      : []
  );
}
function isClosedRaid(item) {
  return String(item.status || "").toLowerCase() === "closed";
}
function hasDecision(item) {
  if (item.decisionRequired === true) return true;
  const value = String(item.decisionRequired || "")
    .trim()
    .toLowerCase();
  return !!value && !["false", "no", "none", "not required", "n/a"].includes(value);
}
function openDecisionRows(codes) {
  const registered = decisions
    .filter((item) => inScope(item, codes) && !["Approved", "Rejected", "Closed"].includes(item.status))
    .map((item) => ({
      ...item,
      projectCode: item.projectCode || item.projectId,
      decisionId: item.decisionId || "Decision",
      title: item.decisionRequired || item.title || "Decision required",
      owner: item.decisionOwner || item.owner || "Unassigned",
      targetDate: item.requiredByDate || item.targetDate || "",
      priority: item.priority || "Not set",
      sourceType: "Decision register"
    }));
  const registeredRaidIds = new Set(registered.map((item) => item.relatedRaidId).filter(Boolean));
  const raidDecisions = raidItems
    .filter(
      (item) =>
        inScope(item, codes) &&
        !isClosedRaid(item) &&
        hasDecision(item) &&
        !registeredRaidIds.has(item.raidId)
    )
    .map((item) => ({
      ...item,
      projectCode: item.projectId || item.projectCode,
      decisionId: item.raidId || "RAID",
      title:
        typeof item.decisionRequired === "string" &&
        !["yes", "true"].includes(item.decisionRequired.toLowerCase())
          ? item.decisionRequired
          : item.title || "Decision required",
      decisionRequired: item.decisionRequired || item.title || "Decision required",
      owner: item.owner || "Unassigned",
      sourceType: "RAID"
    }));
  return [...registered, ...raidDecisions];
}
function milestoneStatus(item) {
  const pct = Math.min(100, Math.max(0, Number(item.percentageComplete) || 0));
  if (pct >= 100) return "Complete";
  const today = todayIso();
  if (
    (item.baselineStartDate && item.forecastStartDate && item.forecastStartDate > item.baselineStartDate) ||
    (item.baselineFinishDate &&
      item.forecastFinishDate &&
      item.forecastFinishDate > item.baselineFinishDate) ||
    (item.forecastFinishDate && today > item.forecastFinishDate)
  )
    return "Overdue";
  if (pct > 0 || (item.forecastStartDate && today >= item.forecastStartDate)) return "In Progress";
  return "Not Started";
}
function taskBehindPlan(task) {
  const pct = Number(task.percentageComplete) || 0;
  if (pct >= 100 || task.status === "Complete" || task.status === "Cancelled") return false;
  return Boolean(
    (task.baselineEndDate && task.forecastEndDate && task.forecastEndDate > task.baselineEndDate) ||
    (task.forecastEndDate && task.forecastEndDate < todayIso())
  );
}
function raidSeverity(item) {
  const score = Math.max(Number(item.inherentScore) || 0, Number(item.residualScore) || 0);
  if (score >= 20 || item.priority === "Critical") return "Critical";
  if (score >= 15 || item.priority === "High") return "High";
  if (score >= 8 || item.priority === "Medium") return "Medium";
  return "Low";
}
function portfolioForProject(project) {
  const id = project?.portfolioId || project?.portfolio;
  return PPMAdmin.findPortfolio(id) || portfolios.find((item) => item.name === project?.portfolio) || null;
}
function portfolioKey(project) {
  const portfolio = portfolioForProject(project);
  return portfolio?.portfolioId || project?.portfolioId || project?.portfolio || "";
}
function portfolioDisplay(project) {
  const portfolio = portfolioForProject(project);
  if (!portfolio) return project?.portfolio || "Not assigned";
  return `${portfolio.portfolioId} · ${portfolio.name}`;
}
function templateForProject(project) {
  return PPMAdmin.getTemplateForProject(project) || null;
}
function gateVersion(gate) {
  return Math.max(1, Number(gate.version || gate.revision || 1));
}
function formalGatePending(gate) {
  return (
    ["Submitted", "Conditionally Approved"].includes(gate.workflowStatus) ||
    (gate.routeRequirement === "Not Applicable" && gate.routeApprovalStatus === "Pending")
  );
}
function formalGateDueDate(gate) {
  return gate.meetingDate || "";
}
function formalGateOverdue(gate) {
  const due = formalGateDueDate(gate);
  return Boolean(due && due < todayIso() && formalGatePending(gate));
}
function workflowBadge(value) {
  const status = String(value || "Draft");
  const cls =
    status === "Approved"
      ? "green"
      : status === "Conditionally Approved" || status === "Submitted" || status === "Deferred"
        ? "amber"
        : status === "Rejected" || status === "Cancelled"
          ? "red"
          : "blue";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}
function approverSummary(gate) {
  return (
    (gate.requiredApprovers || [])
      .map(
        (item) =>
          `${item.name || item.email || item.resourceId || "Unassigned"} (${item.decision || "Pending"})`
      )
      .join("; ") || "No approvers assigned"
  );
}
function gateDocumentSummary(gate) {
  return (
    (gate.supportingDocuments || [])
      .map((item) => item.title || item.url)
      .filter(Boolean)
      .join("; ") || "None linked"
  );
}
function gateActionSummary(gate) {
  const ids = (gate.linkedActionIds || []).filter(Boolean);
  const drafts = (gate.actionsArising || []).map((item) => item.actionId || item.description).filter(Boolean);
  return [...new Set([...ids, ...drafts])].join("; ") || "None linked";
}
function gateInvolvesResource(gate, resource) {
  const id = resource?.resourceId,
    name = String(resource?.fullName || "").toLowerCase(),
    email = String(resource?.email || "").toLowerCase();
  const matches = (person) =>
    Boolean(
      (id && person?.resourceId === id) ||
      (name && String(person?.name || person || "").toLowerCase() === name) ||
      (email && String(person?.email || "").toLowerCase() === email)
    );
  return (
    matches({
      resourceId: gate.submissionOwnerResourceId,
      name: gate.submissionOwner,
      email: gate.submissionOwnerEmail
    }) ||
    matches({
      resourceId: gate.routeApproverResourceId,
      name: gate.routeApprover,
      email: gate.routeApproverEmail
    }) ||
    (gate.requiredApprovers || []).some(matches)
  );
}
function mandatoryReadiness(project, stageOverride) {
  const template = templateForProject(project);
  const stage = stageOverride || project.currentStage || "";
  const evaluation = PPMAdmin.evaluateProjectStage(project, stage, { includeRelated: true });
  const rules = evaluation.rules || [];
  const missing = evaluation.missing || [];
  const total = rules.length;
  return {
    template,
    stage,
    total,
    missing,
    complete: evaluation.valid,
    summary: total
      ? missing.length
        ? `${missing.length} of ${total} missing`
        : `${total} of ${total} complete`
      : missing.length
        ? missing.map((item) => item.label).join("; ")
        : "No mandatory rules configured"
  };
}
function requiredGateEvidence(project) {
  const template = templateForProject(project);
  const stages = (template?.stages || [])
    .filter((stage) => stage.active !== false)
    .sort((a, b) => a.order - b.order);
  const stage = stages.find((item) => item.name === project.currentStage);
  const required = Boolean(stage?.gateRequired);
  const gate =
    formalGates
      .filter(
        (item) =>
          item.projectCode === project.projectCode &&
          item.workflowStatus === "Approved" &&
          item.proposedNextStage === project.currentStage
      )
      .sort((a, b) =>
        String(b.completionDate || b.decisionDate || b.updatedAt).localeCompare(
          String(a.completionDate || a.decisionDate || a.updatedAt)
        )
      )[0] || null;
  return { required, gate, complete: !required || Boolean(gate) };
}
function closureStageForProject(project) {
  const stages = (templateForProject(project)?.stages || [])
    .filter((stage) => stage.active !== false)
    .sort((a, b) => a.order - b.order);
  return stages.at(-1)?.name || "Closure";
}
function approvedClosureGate(project) {
  const closureStage = closureStageForProject(project);
  return (
    formalGates
      .filter(
        (gate) =>
          gate.projectCode === project.projectCode &&
          gate.workflowStatus === "Approved" &&
          (gate.proposedNextStage === closureStage ||
            (!gate.proposedNextStage &&
              String(gate.gateName || "")
                .toLowerCase()
                .includes("closure")))
      )
      .sort((a, b) =>
        String(b.completionDate || b.decisionDate || b.updatedAt).localeCompare(
          String(a.completionDate || a.decisionDate || a.updatedAt)
        )
      )[0] || null
  );
}
function loadData() {
  projects = Array.isArray(parseJson("ppmProjects", [])) ? parseJson("ppmProjects", []) : [];
  portfolios = PPMAdmin.getPortfolios();
  lifecycleTemplates = PPMAdmin.getLifecycleTemplates();
  reportingPeriods = PPMAdmin.getReportingPeriods();
  formalGates = PPMStageGates.getAll();
  resources = PPMResources.ensureLegacyResources();
  const planStore = parseJson("ppmProjectPlans", {});
  tasks = Object.entries(planStore && typeof planStore === "object" ? planStore : {}).flatMap(
    ([code, items]) => (Array.isArray(items) ? items.map((item) => ({ ...item, projectCode: code })) : [])
  );
  milestones = flattenStore(parseJson("ppmProjectMilestones", {}));
  raidItems = flattenStore(parseJson("ppmProjectRaid", {}), "projectId");
  statusReports = flattenStore(parseJson("ppmStatusReports", {}));
  actions = flattenStore(parseJson("ppmProjectActions", {}));
  decisions = flattenStore(parseJson("ppmProjectDecisions", {}));
  benefits = flattenStore(parseJson("ppmProjectBenefits", {}));
  financials = flattenStore(parseJson("ppmProjectFinancials", {}));
  documents = flattenStore(parseJson("ppmProjectDocuments", {}));
  populateFilters();
}

function projectByCode(code) {
  return projects.find((item) => String(item.projectCode).toLowerCase() === String(code || "").toLowerCase());
}
function resourceById(id, name) {
  return PPMResources.findResource(id, name);
}
function taskResource(task) {
  return resourceById(task.taskOwnerResourceId, task.taskOwner);
}
function projectDate(project) {
  return project.targetImplementationDate || project.forecastEndDate || project.baselineEndDate || "";
}
function projectIsStale(project) {
  if (!project.updatedAt) return true;
  const updated = new Date(project.updatedAt).getTime();
  return Number.isNaN(updated) || Date.now() - updated > STALE_DAYS * DAY_MS;
}
function statusReportOverdue(project) {
  const due = project.statusReportDueDate || project.nextStatusReportDueDate || "";
  if (!due || due >= todayIso()) return false;
  const latest = latestStatusReport(project.projectCode);
  const submitted =
    latest?.submittedDate ||
    latest?.submittedAt ||
    latest?.approvedDate ||
    latest?.approvedAt ||
    latest?.updatedAt ||
    latest?.reportingPeriod ||
    "";
  return !submitted || submitted.slice(0, 10) < due;
}
function optionMarkup(values, selected = "") {
  return values
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`
    )
    .join("");
}
function setOptions(id, values, blankLabel) {
  const select = document.getElementById(id);
  const current = select.value;
  select.innerHTML = `<option value="">${blankLabel}</option>` + optionMarkup(unique(values));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}
function applyStoredSelectValue(field, value) {
  if (!field) return;
  const requested = String(value ?? "");
  field.value = requested;
  if (field.id === "portfolioFilter" && requested && field.value !== requested) {
    const legacy = [...field.options].find(
      (option) => option.textContent === requested || option.dataset.portfolioName === requested
    );
    field.value = legacy?.value || "";
  }
}
function setPortfolioOptions() {
  const select = document.getElementById("portfolioFilter"),
    current = select.value;
  const choices = new Map();
  projects.forEach((project) => {
    const key = portfolioKey(project);
    if (!key) return;
    const portfolio = portfolioForProject(project);
    choices.set(key, { label: portfolioDisplay(project), name: portfolio?.name || project.portfolio || "" });
  });
  select.innerHTML =
    '<option value="">All portfolios</option>' +
    [...choices.entries()]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(
        ([value, item]) =>
          `<option value="${escapeHtml(value)}" data-portfolio-name="${escapeHtml(item.name)}">${escapeHtml(item.label)}</option>`
      )
      .join("");
  applyStoredSelectValue(select, current);
}
function populateFilters() {
  const projectSelects = [
    document.getElementById("projectFilter"),
    document.getElementById("projectDashboardSelect")
  ];
  const projectOptions = [...projects]
    .sort((a, b) => String(a.projectName || "").localeCompare(String(b.projectName || "")))
    .map(
      (project) =>
        `<option value="${escapeHtml(project.projectCode)}">${escapeHtml(`${project.projectCode} - ${project.projectName}`)}</option>`
    )
    .join("");
  projectSelects[0].innerHTML = '<option value="">All projects</option>' + projectOptions;
  projectSelects[1].innerHTML = projectOptions || '<option value="">No projects</option>';
  setPortfolioOptions();
  setOptions(
    "programmeFilter",
    projects.map((p) => p.programme || p.programmeName),
    "All programmes"
  );
  setOptions(
    "workstreamFilter",
    projects.map((p) => p.workstream),
    "All workstreams"
  );
  setOptions(
    "managerFilter",
    projects.map((p) => p.projectManager),
    "All managers"
  );
  setOptions(
    "sponsorFilter",
    projects.map((p) => p.sponsor),
    "All sponsors"
  );
  setOptions(
    "leadFilter",
    projects.map((p) => p.projectLead),
    "All leads"
  );
  setOptions(
    "stageFilter",
    projects.map((p) => p.currentStage),
    "All stages"
  );
  setOptions(
    "statusFilter",
    projects.map((p) => p.projectStatus),
    "All statuses"
  );
  setOptions(
    "priorityFilter",
    projects.map((p) => p.priority),
    "All priorities"
  );
  setOptions(
    "businessAreaFilter",
    projects.map((p) => p.businessArea),
    "All business areas"
  );
  setOptions(
    "resourceTeamFilter",
    resources.map((r) => r.team),
    "All resource teams"
  );
  setOptions(
    "benefitTypeFilter",
    benefits.map((b) => b.benefitType || b.type),
    "All benefit types"
  );
  const userSelect = document.getElementById("personalUserSelect");
  userSelect.innerHTML =
    '<option value="">Select a user</option>' +
    resources
      .filter((r) => r.active !== false)
      .map(
        (r) =>
          `<option value="${escapeHtml(r.resourceId)}">${escapeHtml(`${r.fullName}${r.jobTitle ? ` - ${r.jobTitle}` : ""}`)}</option>`
      )
      .join("");
  if (resources[0]) userSelect.value = resources[0].resourceId;
  populateSavedViews();
  populateReportSelector();
}

function selectedFilterValues() {
  return Object.fromEntries(filterIds.map((id) => [id, document.getElementById(id).value]));
}
function filteredProjects() {
  const f = selectedFilterValues();
  let rows = projects.filter((project) => {
    if (f.includeArchived !== "yes" && (project.archived === true || project.projectStatus === "Archived"))
      return false;
    if (f.projectFilter && project.projectCode !== f.projectFilter) return false;
    if (f.portfolioFilter && portfolioKey(project) !== f.portfolioFilter) return false;
    if (f.programmeFilter && (project.programme || project.programmeName) !== f.programmeFilter) return false;
    if (f.workstreamFilter && project.workstream !== f.workstreamFilter) return false;
    if (f.managerFilter && project.projectManager !== f.managerFilter) return false;
    if (f.sponsorFilter && project.sponsor !== f.sponsorFilter) return false;
    if (f.leadFilter && project.projectLead !== f.leadFilter) return false;
    if (f.stageFilter && project.currentStage !== f.stageFilter) return false;
    if (f.statusFilter && project.projectStatus !== f.statusFilter) return false;
    if (f.priorityFilter && project.priority !== f.priorityFilter) return false;
    if (f.businessAreaFilter && project.businessArea !== f.businessAreaFilter) return false;
    if (f.ragFilter && (project.overallRag || "Not Assessed") !== f.ragFilter) return false;
    const date = projectDate(project);
    if (f.dateFromFilter && (!date || date < f.dateFromFilter)) return false;
    if (f.dateToFilter && (!date || date > f.dateToFilter)) return false;
    if (
      f.resourceTeamFilter &&
      !tasks.some(
        (task) =>
          task.projectCode === project.projectCode && taskResource(task)?.team === f.resourceTeamFilter
      )
    )
      return false;
    if (
      f.riskRatingFilter &&
      !raidItems.some(
        (item) =>
          (item.projectId || item.projectCode) === project.projectCode &&
          raidSeverity(item) === f.riskRatingFilter
      )
    )
      return false;
    if (
      f.benefitTypeFilter &&
      !benefits.some(
        (item) =>
          benefitAppliesToProject(item, project) && (item.benefitType || item.type) === f.benefitTypeFilter
      )
    )
      return false;
    return true;
  });
  const sort = f.projectSort;
  const ragOrder = { Red: 0, Amber: 1, Green: 2, "Not Assessed": 3 };
  const priorityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  rows.sort((a, b) => {
    if (sort === "rag") return (ragOrder[a.overallRag] ?? 9) - (ragOrder[b.overallRag] ?? 9);
    if (sort === "forecast") return String(projectDate(a)).localeCompare(String(projectDate(b)));
    if (sort === "priority") return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
    if (sort === "complete") return (Number(b.percentageComplete) || 0) - (Number(a.percentageComplete) || 0);
    return String(a.projectName || "").localeCompare(String(b.projectName || ""));
  });
  return rows;
}
function filteredProjectCodes() {
  return new Set(filteredProjects().map((p) => p.projectCode));
}
function benefitProgrammeName(item) {
  if (item.programmeName) return item.programmeName;
  const linked = projects.find((project) => project.programmeId === item.programmeId);
  return linked?.programme || linked?.workstream || item.programmeId || "No programme";
}
function benefitAppliesToProject(item, project) {
  const code = item.projectCode || item.projectId;
  if (code) return code === project.projectCode;
  if (!item.programmeId) return false;
  return project.programmeId === item.programmeId;
}
function inScope(item, codes) {
  const code = item.projectCode || item.projectId;
  if (code) return codes.has(code);
  if (!item.programmeId) return false;
  return projects.some(
    (project) => codes.has(project.projectCode) && project.programmeId === item.programmeId
  );
}
function appliedFilterLabels() {
  const labels = [];
  filterIds.forEach((id) => {
    const field = document.getElementById(id);
    if (
      field.value &&
      !(id === "includeArchived" && field.value === "no") &&
      !(id === "projectSort" && field.value === "name")
    )
      labels.push(
        `${field.previousElementSibling?.textContent || id}: ${field.options ? field.selectedOptions[0].textContent : field.value}`
      );
  });
  return labels;
}
function updateFilterSummary() {
  const labels = appliedFilterLabels();
  document.getElementById("filterSummary").textContent = labels.length
    ? labels.join(" | ")
    : "No filters applied";
}

function resourceAllocations(codes) {
  const assignments = tasks
    .filter((task) => codes.has(task.projectCode) && task.status !== "Cancelled")
    .map((task) => {
      const resource = taskResource(task);
      return {
        ...task,
        resource,
        start: task.forecastStartDate || task.baselineStartDate || "",
        finish: task.forecastEndDate || task.baselineEndDate || "",
        allocation: Number(task.allocationPercentage) || 100
      };
    });
  return resources
    .filter((r) => r.active !== false)
    .map((resource) => {
      const own = assignments.filter(
        (a) => a.resource?.resourceId === resource.resourceId && a.start && a.finish
      );
      const candidates = unique(own.flatMap((a) => [a.start]));
      let peak = 0;
      candidates.forEach((date) => {
        peak = Math.max(
          peak,
          own.filter((a) => a.start <= date && a.finish >= date).reduce((sum, a) => sum + a.allocation, 0)
        );
      });
      const today = todayIso();
      const current = own
        .filter((a) => a.start <= today && a.finish >= today)
        .reduce((sum, a) => sum + a.allocation, 0);
      return { resource, assignments: own, current, peak, over: Math.max(0, peak - 100) };
    });
}
function projectWarnings(project) {
  const warnings = [];
  const required = [
    ["projectManager", "Project manager"],
    ["sponsor", "Sponsor"],
    ["projectLead", "Project lead"],
    ["workstream", "Workstream"],
    ["priority", "Priority"],
    ["currentStage", "Lifecycle stage"],
    ["baselineEndDate", "Baseline end"],
    ["forecastEndDate", "Forecast end"]
  ];
  required.forEach(([key, label]) => {
    if (!project[key]) warnings.push(`${label} missing`);
  });
  [
    ["overallRag", "Overall"],
    ["scheduleRag", "Schedule"],
    ["scopeRag", "Scope"],
    ["financialRag", "Financial"],
    ["resourceRag", "Resources"],
    ["riskRag", "Risk"]
  ].forEach(([key, label]) => {
    if (!project[key] || project[key] === "Not Assessed") warnings.push(`${label} RAG not assessed`);
  });
  if (!project.updatedAt) warnings.push("Last update date missing");
  else if (projectIsStale(project)) warnings.push(`Project information is more than ${STALE_DAYS} days old`);
  mandatoryReadiness(project).missing.forEach((rule) =>
    warnings.push(`${rule.label} is mandatory at ${project.currentStage || "the current stage"}`)
  );
  tasks
    .filter((t) => t.projectCode === project.projectCode)
    .forEach((t) => {
      if (!taskResource(t)) warnings.push(`Task owner missing: ${t.taskName || "Unnamed task"}`);
      if (!(t.forecastStartDate || t.baselineStartDate) || !(t.forecastEndDate || t.baselineEndDate))
        warnings.push(`Task dates missing: ${t.taskName || "Unnamed task"}`);
    });
  return warnings;
}
function projectExceptionCount(project, codes) {
  const code = project.projectCode;
  return (
    milestones.filter(
      (m) => inScope(m, codes) && (m.projectCode || m.projectId) === code && milestoneStatus(m) === "Overdue"
    ).length +
    tasks.filter((t) => t.projectCode === code && taskBehindPlan(t)).length +
    raidItems.filter(
      (r) =>
        (r.projectId || r.projectCode) === code &&
        !isClosedRaid(r) &&
        ["High", "Critical"].includes(raidSeverity(r))
    ).length +
    formalGates.filter((g) => g.projectCode === code && formalGateOverdue(g)).length +
    projectWarnings(project).length
  );
}
function badge(value) {
  const clean = String(value || "Not Assessed");
  const cls =
    clean.toLowerCase() === "green"
      ? "green"
      : clean.toLowerCase() === "amber"
        ? "amber"
        : clean.toLowerCase() === "red"
          ? "red"
          : "";
  return `<span class="badge ${cls}">${escapeHtml(clean)}</span>`;
}
function distribution(rows, key, fallback = "Not set") {
  const counts = {};
  rows.forEach((row) => {
    const value = row[key] || fallback;
    counts[value] = (counts[value] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
function renderBars(id, data, field, emptyMessage) {
  const max = Math.max(1, ...data.map(([, count]) => count));
  document.getElementById(id).innerHTML = data.length
    ? data
        .map(
          ([label, count]) =>
            `<button type="button" class="bar-button" data-filter="${field}" data-value="${escapeHtml(label)}"><span class="bar-label">${field === "ragFilter" ? `<span class="rag-dot ${escapeHtml(label.toLowerCase())}"></span>` : ""}${escapeHtml(label)}</span><span class="bar-track"><span class="bar-fill"${styleAttr(`width:${(count / max) * 100}%`)}></span></span><span class="bar-value">${count}</span></button>`
        )
        .join("")
    : `<div class="empty-state">${escapeHtml(emptyMessage || "No projects match this view.")}</div>`;
}
function metricTone(metric) {
  if (metric.id === "all") return "neutral";
  if (metric.value === 0) return "good";
  if (["decisions", "stale", "quality", "gate-pending"].includes(metric.id)) return "warning";
  return "bad";
}

function metricDefinitions(codes, projectRows) {
  const scopeMilestones = milestones.filter((m) => inScope(m, codes));
  const scopeTasks = tasks.filter((t) => inScope(t, codes));
  const scopeRaid = raidItems.filter((r) => inScope(r, codes));
  const scopeGates = formalGates.filter((g) => inScope(g, codes));
  const allocations = resourceAllocations(codes);
  const qualityProjects = projectRows.filter((p) => projectWarnings(p).length);
  const decisionProjects = new Set(openDecisionRows(codes).map((item) => item.projectCode));
  return [
    {
      id: "all",
      label: "Projects",
      value: projectRows.length,
      detail: "Projects included in this view",
      codes: new Set(projectRows.map((p) => p.projectCode))
    },
    {
      id: "redamber",
      label: "Red / Amber overall RAG",
      value: projectRows.filter((p) => ["Red", "Amber"].includes(p.overallRag)).length,
      detail: "Projects requiring management attention",
      codes: new Set(
        projectRows.filter((p) => ["Red", "Amber"].includes(p.overallRag)).map((p) => p.projectCode)
      )
    },
    {
      id: "slippage",
      label: "Forecast delivery slippage",
      value: projectRows.filter(
        (p) => p.baselineEndDate && p.forecastEndDate && p.forecastEndDate > p.baselineEndDate
      ).length,
      detail: "Forecast later than baseline",
      codes: new Set(
        projectRows
          .filter((p) => p.baselineEndDate && p.forecastEndDate && p.forecastEndDate > p.baselineEndDate)
          .map((p) => p.projectCode)
      )
    },
    {
      id: "milestones",
      label: "Overdue milestones",
      value: scopeMilestones.filter((m) => milestoneStatus(m) === "Overdue").length,
      detail: "Forecast or baseline exception",
      codes: new Set(
        scopeMilestones
          .filter((m) => milestoneStatus(m) === "Overdue")
          .map((m) => m.projectCode || m.projectId)
      )
    },
    {
      id: "gate-pending",
      label: "Pending stage gates",
      value: scopeGates.filter(formalGatePending).length,
      detail: "Awaiting gate or route approval",
      codes: new Set(scopeGates.filter(formalGatePending).map((g) => g.projectCode))
    },
    {
      id: "gate-overdue",
      label: "Overdue stage gates",
      value: scopeGates.filter(formalGateOverdue).length,
      detail: "Scheduled meeting date has passed",
      codes: new Set(scopeGates.filter(formalGateOverdue).map((g) => g.projectCode))
    },
    {
      id: "tasks",
      label: "Tasks behind plan",
      value: scopeTasks.filter(taskBehindPlan).length,
      detail: "Slipped or past forecast finish",
      codes: new Set(scopeTasks.filter(taskBehindPlan).map((t) => t.projectCode))
    },
    {
      id: "raid",
      label: "High risks & issues",
      value: scopeRaid.filter((r) => !isClosedRaid(r) && ["High", "Critical"].includes(raidSeverity(r)))
        .length,
      detail: "Open high-severity records",
      codes: new Set(
        scopeRaid
          .filter((r) => !isClosedRaid(r) && ["High", "Critical"].includes(raidSeverity(r)))
          .map((r) => r.projectId || r.projectCode)
      )
    },
    {
      id: "resources",
      label: "Resource conflicts",
      value: allocations.filter((a) => a.over > 0).length,
      detail: "People above 100% peak",
      codes: new Set(
        allocations.filter((a) => a.over > 0).flatMap((a) => a.assignments.map((t) => t.projectCode))
      )
    },
    {
      id: "decisions",
      label: "Projects needing decisions",
      value: decisionProjects.size,
      detail: "Open decision-register or RAID records",
      codes: decisionProjects
    },
    {
      id: "reports",
      label: "Overdue status reports",
      value: projectRows.filter(statusReportOverdue).length,
      detail: "Past the reporting due date",
      codes: new Set(projectRows.filter(statusReportOverdue).map((p) => p.projectCode))
    },
    {
      id: "stale",
      label: "Projects with stale data",
      value: projectRows.filter(projectIsStale).length,
      detail: `Missing or older than ${STALE_DAYS} days`,
      codes: new Set(projectRows.filter(projectIsStale).map((p) => p.projectCode))
    },
    {
      id: "quality",
      label: "Data-quality warnings",
      value: projectRows.reduce((sum, p) => sum + projectWarnings(p).length, 0),
      detail: `Warnings across ${qualityProjects.length} project(s)`,
      codes: new Set(qualityProjects.map((p) => p.projectCode))
    }
  ];
}

function renderPortfolio() {
  const rows = filteredProjects();
  const codes = new Set(rows.map((p) => p.projectCode));
  const metrics = metricDefinitions(codes, rows);
  document.getElementById("portfolioMetrics").innerHTML = metrics
    .map(
      (metric) =>
        `<button type="button" class="metric-card tone-${metricTone(metric)} ${activeMetric === metric.id ? "active" : ""}" data-permission="none" data-metric="${metric.id}"><span class="metric-label">${escapeHtml(metric.label)}</span><span class="metric-value">${metric.value}</span><span class="metric-detail">${escapeHtml(metric.detail)}</span></button>`
    )
    .join("");
  renderBars(
    "statusChart",
    distribution(rows, "projectStatus"),
    "statusFilter",
    "No project statuses are available."
  );
  renderBars(
    "ragChart",
    distribution(rows, "overallRag", "Not Assessed"),
    "ragFilter",
    "No overall RAG assessments are available."
  );
  renderBars(
    "stageChart",
    distribution(rows, "currentStage"),
    "stageFilter",
    "No lifecycle stages are available."
  );
  renderBars(
    "workstreamChart",
    distribution(rows, "workstream"),
    "workstreamFilter",
    "No workstream assignments are available."
  );
  const portfolioRows = rows
      .map((p) => ({ ...p, portfolioDisplay: portfolioDisplay(p) }))
      .filter((p) => p.portfolioDisplay !== "Not assigned"),
    programmeRows = rows
      .filter((p) => p.programme || p.programmeName)
      .map((p) => ({ ...p, programme: p.programme || p.programmeName }));
  renderBars("portfolioChart", distribution(portfolioRows, "portfolioDisplay"), "portfolioFilter");
  renderBars("programmeChart", distribution(programmeRows, "programme"), "programmeFilter");
  if (!portfolioRows.length)
    document.getElementById("portfolioChart").innerHTML =
      '<div class="empty-state">Projects in this view have not yet been assigned to a portfolio.</div>';
  if (!programmeRows.length)
    document.getElementById("programmeChart").innerHTML =
      '<div class="empty-state">Projects in this view have not yet been assigned to a programme.</div>';
  let listed = rows;
  const metric = metrics.find((m) => m.id === activeMetric);
  if (metric && metric.id !== "all") listed = rows.filter((p) => metric.codes.has(p.projectCode));
  const listTitles = {
    redamber: "Projects with Red / Amber overall RAG",
    slippage: "Projects with forecast delivery slippage",
    milestones: "Projects with overdue milestones",
    "gate-pending": "Projects with pending stage gates",
    "gate-overdue": "Projects with overdue stage gates",
    tasks: "Projects with tasks behind plan",
    raid: "Projects with high risks or issues",
    resources: "Projects with resource conflicts",
    decisions: "Projects requiring decisions",
    reports: "Projects with overdue status reports",
    stale: "Projects with stale information",
    quality: "Projects with data-quality warnings"
  };
  document.getElementById("portfolioListTitle").textContent =
    metric && metric.id !== "all" ? listTitles[metric.id] || "Projects" : "Projects";
  document.getElementById("portfolioListDescription").textContent =
    metric && metric.id !== "all"
      ? "Select a project to review the detail behind this portfolio indicator."
      : "Select a project to review its full status, plan, milestones and RAID items.";
  document.getElementById("clearMetricButton").disabled = !activeMetric || activeMetric === "all";
  const body = document.getElementById("portfolioProjectRows");
  body.innerHTML = listed.length
    ? listed
        .map(
          (project) =>
            `<tr><td>${escapeHtml(project.projectCode)}</td>
<td>${projectLink(project.projectCode, project.projectName)}</td>
<td>${escapeHtml(portfolioDisplay(project))}</td>
<td>${escapeHtml(project.workstream || "Not set")}</td>
<td>${escapeHtml(project.projectManager || "Not assigned")}</td>
<td>${escapeHtml(project.projectStatus || "Not set")}</td>
<td>${badge(project.overallRag)}</td>
<td>${escapeHtml(project.currentStage || "Not set")}</td>
<td>${formatDate(project.baselineEndDate)}</td>
<td>${formatDate(project.forecastEndDate)}</td>
<td>${formatPercent(project.percentageComplete)}</td>
<td>${projectExceptionCount(project, codes)}</td></tr>`
        )
        .join("")
    : '<tr><td colspan="12" class="empty-state">No projects match this view.</td></tr>';
  renderMetricDetail(metric, codes);
  renderRoadmap(rows, codes);
  renderKeyRaid(codes);
  renderPortfolioFinancial(codes);
  renderPortfolioBenefits(codes);
}
function renderMetricDetail(metric, codes) {
  const panel = document.getElementById("metricDetailPanel");
  if (!metric || ["all", "redamber", "slippage"].includes(metric.id)) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  panel.hidden = false;
  let headings = [],
    rows = [];
  if (metric.id === "milestones") {
    headings = ["Milestone", "Project", "Forecast finish", "Status", "Open record"];
    rows = milestones
      .filter((m) => inScope(m, codes) && milestoneStatus(m) === "Overdue")
      .map((m) => [
        m.milestoneName || "Untitled",
        projectByCode(m.projectCode || m.projectId)?.projectName || m.projectCode || m.projectId,
        formatDate(m.forecastFinishDate || m.baselineFinishDate),
        milestoneStatus(m),
        `<a href="milestones.html?code=${encodeURIComponent(m.projectCode || m.projectId)}">View milestone</a>`
      ]);
  }
  if (metric.id === "gate-pending") {
    headings = ["Stage gate", "Project", "Approvers", "Meeting date", "Status", "Open record"];
    rows = formalGates
      .filter((g) => inScope(g, codes) && formalGatePending(g))
      .map((g) => [
        g.gateName || g.gateId,
        projectByCode(g.projectCode)?.projectName || g.projectCode,
        approverSummary(g),
        formatDate(g.meetingDate),
        g.routeApprovalStatus === "Pending" ? "Route approval pending" : g.workflowStatus,
        gateLink(g, "View stage gate")
      ]);
  }
  if (metric.id === "gate-overdue") {
    headings = ["Stage gate", "Project", "Owner", "Due date", "Status", "Open record"];
    rows = formalGates
      .filter((g) => inScope(g, codes) && formalGateOverdue(g))
      .map((g) => [
        g.gateName || g.gateId,
        projectByCode(g.projectCode)?.projectName || g.projectCode,
        g.submissionOwner || "Unassigned",
        formatDate(formalGateDueDate(g)),
        g.workflowStatus,
        gateLink(g, "View stage gate")
      ]);
  }
  if (metric.id === "tasks") {
    headings = ["Task", "Project", "Owner", "Forecast finish", "Open record"];
    rows = tasks
      .filter((t) => inScope(t, codes) && taskBehindPlan(t))
      .map((t) => [
        t.taskName || "Unnamed task",
        projectByCode(t.projectCode)?.projectName || t.projectCode,
        taskResource(t)?.fullName || t.taskOwner || "Unassigned",
        formatDate(t.forecastEndDate || t.baselineEndDate),
        `<a href="project-plan.html?code=${encodeURIComponent(t.projectCode)}">View task</a>`
      ]);
  }
  if (metric.id === "raid") {
    const source = raidItems.filter(
      (r) => inScope(r, codes) && !isClosedRaid(r) && ["High", "Critical"].includes(raidSeverity(r))
    );
    headings = ["RAID item", "Project", "Type", "Owner", "Open record"];
    rows = source.map((r) => [
      r.title || "Untitled",
      projectByCode(r.projectId || r.projectCode)?.projectName || r.projectId || r.projectCode,
      r.type || "RAID",
      r.owner || "Unassigned",
      `<a href="raid-log.html?code=${encodeURIComponent(r.projectId || r.projectCode)}">View RAID item</a>`
    ]);
  }
  if (metric.id === "decisions") {
    const source = openDecisionRows(codes);
    headings = ["Decision required", "Project", "Source", "Owner", "Open record"];
    rows = source.map((item) => [
      item.title,
      projectByCode(item.projectCode)?.projectName || item.projectCode,
      item.sourceType,
      item.owner,
      item.sourceType === "RAID"
        ? `<a href="raid-log.html?code=${encodeURIComponent(item.projectCode)}">View RAID item</a>`
        : `<a href="registers.html?tab=decisions&item=${encodeURIComponent(item.decisionId)}">View decision</a>`
    ]);
  }
  if (metric.id === "resources") {
    headings = ["Resource", "Project", "Task", "Dates", "Allocation", "Peak / overallocation"];
    resourceAllocations(codes)
      .filter((a) => a.over > 0)
      .forEach((a) =>
        a.assignments.forEach((t) =>
          rows.push([
            a.resource.fullName || "Unnamed resource",
            projectByCode(t.projectCode)?.projectName || t.projectCode,
            t.taskName || "Unnamed task",
            `${formatDate(t.start)} - ${formatDate(t.finish)}`,
            `${t.allocation}%`,
            `${a.peak}% / ${a.over}% over`
          ])
        )
      );
  }
  if (metric.id === "reports") {
    headings = ["Project", "Report due", "Latest status report", "Open project"];
    filteredProjects()
      .filter((p) => metric.codes.has(p.projectCode))
      .forEach((p) => {
        const latest = latestStatusReport(p.projectCode);
        rows.push([
          p.projectName || p.projectCode,
          formatDate(p.statusReportDueDate || p.nextStatusReportDueDate),
          latest?.reportingPeriod || latest?.updatedAt || "No report submitted",
          projectLink(p.projectCode, "Open project")
        ]);
      });
  }
  if (metric.id === "stale") {
    headings = ["Project", "Last update", "Freshness rule", "Open project"];
    filteredProjects()
      .filter((p) => metric.codes.has(p.projectCode))
      .forEach((p) =>
        rows.push([
          p.projectName || p.projectCode,
          formatDate((p.updatedAt || "").slice(0, 10)),
          `Older than ${STALE_DAYS} days or missing`,
          projectLink(p.projectCode, "Open project")
        ])
      );
  }
  if (metric.id === "quality") {
    headings = ["Project", "Warning", "Open project"];
    filteredProjects()
      .filter((p) => metric.codes.has(p.projectCode))
      .forEach((p) =>
        projectWarnings(p).forEach((w) =>
          rows.push([p.projectName || p.projectCode, w, projectLink(p.projectCode, "Open project")])
        )
      );
  }
  const emptyMessages = {
    milestones: "No overdue milestones.",
    "gate-pending": "No stage gates are awaiting approval.",
    "gate-overdue": "No stage gates are overdue.",
    tasks: "No tasks behind plan.",
    raid: "No open high risks or issues.",
    resources: "No resource conflicts.",
    decisions: "No decisions are currently required.",
    reports: "No overdue status reports.",
    stale: "No projects have stale information.",
    quality: "No data-quality warnings."
  };
  panel.innerHTML = `<h3 class="detail-heading">${escapeHtml(metric.label)} details</h3><p class="metric-detail">The items below make up this portfolio total.</p><div class="table-wrapper detail-table"><table><thead><tr>${headings.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((value, index) => `<td>${index === row.length - 1 && String(value).includes("<a ") ? value : escapeHtml(value)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${Math.max(1, headings.length)}" class="empty-state">${escapeHtml(emptyMessages[metric.id] || "No items require attention.")}</td></tr>`}</tbody></table></div>`;
}
function renderRoadmap(rows, codes) {
  const dated = rows.filter(projectDate).sort((a, b) => projectDate(a).localeCompare(projectDate(b)));
  if (!dated.length) {
    document.getElementById("roadmapContent").innerHTML =
      '<div class="empty-state">No delivery dates are available.</div>';
    return;
  }
  const dates = dated.map((p) => new Date(`${projectDate(p)}T00:00:00`).getTime());
  const min = Math.min(...dates),
    max = Math.max(...dates);
  const span = Math.max(DAY_MS, max - min);
  document.getElementById("roadmapContent").innerHTML = `<div class="roadmap">${dated
    .slice(0, 10)
    .map((project) => {
      const pos = ((new Date(`${projectDate(project)}T00:00:00`).getTime() - min) / span) * 100;
      return `<div class="roadmap-row"><span>${projectLink(project.projectCode, project.projectName)}</span><span class="roadmap-track"><span class="roadmap-marker"${styleAttr(`left:${pos}%`)}></span></span><span>${formatDate(projectDate(project))}</span></div>`;
    })
    .join("")}</div>`;
}
function renderKeyRaid(codes) {
  const rows = raidItems
    .filter(
      (r) =>
        inScope(r, codes) &&
        !isClosedRaid(r) &&
        (["High", "Critical"].includes(raidSeverity(r)) || r.type === "Dependency")
    )
    .slice(0, 10);
  document.getElementById("keyRaidContent").innerHTML = rows.length
    ? `<ul class="compact-list">${rows
        .map((item) => {
          const project = projectByCode(item.projectId || item.projectCode);
          return `<li><span class="badge ${item.type === "Dependency" ? "blue" : raidSeverity(item) === "Critical" ? "red" : "amber"}">${escapeHtml(item.type || "RAID")} - ${escapeHtml(raidSeverity(item))}</span><br><strong>${escapeHtml(item.title || "Untitled")}</strong><br>${project ? projectLink(project.projectCode, project.projectName) : escapeHtml(item.projectId || "")}</li>`;
        })
        .join("")}</ul>`
    : '<div class="empty-state">No open high risks or dependencies in this view.</div>';
}
function renderPortfolioFinancial(codes) {
  const rows = financials.filter((f) => inScope(f, codes));
  const container = document.getElementById("portfolioFinancialContent");
  if (!rows.length) {
    container.innerHTML =
      '<div class="empty-state">No financial information has been provided for the projects in this view. <a href="financial-management.html">Open Financial Management</a> to create the first cost plan.</div>';
    return;
  }
  const rags = distribution(rows, "financialRag", "Not Assessed"),
    total = (key) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  container.innerHTML = `<div class="table-wrapper"><table><thead><tr><th>Approved budget</th>
<th>Forecast</th>
<th>Actual</th>
<th>Committed</th>
<th>Estimate at completion</th>
<th>Budget variance</th></tr></thead><tbody><tr><td><strong>${formatMoney(total("approvedBudget"))}</strong></td>
<td>${formatMoney(total("forecastCost"))}</td>
<td>${formatMoney(total("actualCost"))}</td>
<td>${formatMoney(total("committedCost"))}</td>
<td>${formatMoney(total("estimateAtCompletion"))}</td>
<td>${formatMoney(total("budgetVariance"))}</td></tr></tbody></table></div><ul class="compact-list">${rags.map(([rag, count]) => `<li>${badge(rag)} ${count} project(s)</li>`).join("")}</ul><p><a href="financial-management.html">Manage financials</a> · <a href="#" onclick="switchPane('reportsPane');document.getElementById('reportSelector').value='financial';renderReport(true);return false">Open financial report</a></p>`;
}
function renderPortfolioBenefits(codes) {
  const rows = benefits.filter((b) => inScope(b, codes));
  const container = document.getElementById("portfolioBenefitsContent");
  if (!rows.length) {
    container.innerHTML =
      '<div class="empty-state">No benefits have been recorded for the projects or programmes in this view. <a href="benefits-management.html">Open Benefits Management</a> to add one.</div>';
    return;
  }
  const overdue = rows.filter(
    (b) =>
      (b.nextReviewDate || b.reviewDate) &&
      (b.nextReviewDate || b.reviewDate) < todayIso() &&
      !["Realised", "Closed"].includes(b.status)
  );
  container.innerHTML = `<p><strong>${rows.length}</strong> benefit record(s) in scope; <strong>${overdue.length}</strong> overdue review(s).</p><ul class="compact-list">${distribution(
    rows,
    "status",
    "Not set"
  )
    .map(([status, count]) => `<li>${escapeHtml(status)} - ${count}</li>`)
    .join(
      ""
    )}</ul><p><a href="#" onclick="switchPane('reportsPane');document.getElementById('reportSelector').value='benefits';renderReport(true);return false">Open benefits report</a> · <a href="benefits-management.html">Manage benefits</a></p>`;
}

function renderPersonal() {
  const resource = resources.find(
    (r) => r.resourceId === document.getElementById("personalUserSelect").value
  );
  const codes = filteredProjectCodes();
  if (!resource) {
    document.getElementById("personalMetrics").innerHTML = '<div class="empty-state">Select a user.</div>';
    return;
  }
  const name = resource.fullName;
  const myProjects = filteredProjects().filter(
    (p) =>
      [p.projectManager, p.sponsor, p.projectLead].includes(name) ||
      [p.projectManagerResourceId, p.sponsorResourceId, p.projectLeadResourceId].includes(resource.resourceId)
  );
  const myTasks = tasks.filter(
    (t) =>
      codes.has(t.projectCode) &&
      taskResource(t)?.resourceId === resource.resourceId &&
      t.status !== "Cancelled"
  );
  const overdue = myTasks.filter(taskBehindPlan);
  const myGates = formalGates
    .filter(
      (g) =>
        codes.has(g.projectCode) &&
        gateInvolvesResource(g, resource) &&
        !["Approved", "Rejected", "Cancelled"].includes(g.workflowStatus)
    )
    .sort((a, b) =>
      String(formalGateDueDate(a) || "9999").localeCompare(String(formalGateDueDate(b) || "9999"))
    );
  const myPendingGates = myGates.filter(
    (g) =>
      formalGatePending(g) &&
      ((g.requiredApprovers || []).some((a) => a.resourceId === resource.resourceId && !a.decision) ||
        (g.routeApproverResourceId === resource.resourceId && g.routeApprovalStatus === "Pending"))
  );
  const allocation = resourceAllocations(codes).find((a) => a.resource.resourceId === resource.resourceId);
  const reportsDue = myProjects.filter((p) => !latestStatusReport(p.projectCode)).length;
  const metricData = [
    ["My projects", myProjects.length],
    ["My tasks", myTasks.length],
    ["My overdue items", overdue.length],
    ["Gate approvals", myPendingGates.length],
    ["Resource allocation", allocation ? `${allocation.peak}% peak` : "0%"]
  ];
  document.getElementById("personalMetrics").innerHTML = metricData
    .map(
      ([label, value]) =>
        `<div class="metric-card static-card" data-permission="none"><span class="metric-label">${escapeHtml(label)}</span><span class="metric-value">${escapeHtml(value)}</span></div>`
    )
    .join("");
  document.getElementById("myProjectsContent").innerHTML = myProjects.length
    ? `<ul class="compact-list">${myProjects.map((p) => `<li>${projectLink(p.projectCode, p.projectName)}<br><span class="badge">${escapeHtml(p.projectStatus || "Not set")}</span> ${badge(p.overallRag)}</li>`).join("")}</ul>`
    : '<div class="empty-state">No projects assigned in the selected view.</div>';
  document.getElementById("myTasksContent").innerHTML = myTasks.length
    ? `<ul class="compact-list">${myTasks
        .slice(0, 12)
        .map(
          (t) =>
            `<li><strong>${escapeHtml(t.taskName || "Unnamed task")}</strong> ${taskBehindPlan(t) ? '<span class="badge overdue">Behind plan</span>' : ""}<br>${projectLink(t.projectCode, projectByCode(t.projectCode)?.projectName)} - ${formatDate(t.forecastEndDate || t.baselineEndDate)}</li>`
        )
        .join("")}</ul>`
    : '<div class="empty-state">No tasks assigned.</div>';
  document.getElementById("myMilestonesContent").innerHTML = myGates.length
    ? `<ul class="compact-list">${myGates
        .slice(0, 12)
        .map(
          (g) =>
            `<li>${gateLink(g, g.gateName)} ${formalGateOverdue(g) ? '<span class="badge overdue">Overdue</span>' : workflowBadge(g.workflowStatus)}<br>${projectLink(g.projectCode, projectByCode(g.projectCode)?.projectName)} · ${g.meetingDate ? `meeting ${formatDate(g.meetingDate)}` : "Meeting not set"}</li>`
        )
        .join("")}</ul>`
    : '<div class="empty-state">No formal stage gates are assigned or awaiting this colleague.</div>';
  const myActions = actions.filter(
    (action) =>
      codes.has(action.projectCode || action.projectId) &&
      ([action.owner, action.assignee, action.approver].includes(name) ||
        [action.ownerResourceId, action.assigneeResourceId, action.approverResourceId].includes(
          resource.resourceId
        ))
  );
  const gateApprovals = myPendingGates.map(
    (g) =>
      `<li>${gateLink(g, `${g.gateId} · ${g.gateName}`)}<br>${workflowBadge(g.routeApprovalStatus === "Pending" ? "Route approval pending" : g.workflowStatus)} · ${escapeHtml(projectByCode(g.projectCode)?.projectName || g.projectCode)}</li>`
  );
  document.getElementById("myActionsContent").innerHTML =
    myActions.length || gateApprovals.length
      ? `<ul class="compact-list">${gateApprovals.join("")}${myActions
          .slice(0, 12)
          .map(
            (action) =>
              `<li><strong>${escapeHtml(action.title || action.action || action.description || "Action")}</strong><br>${escapeHtml(action.status || "Open")} - due ${formatDate(action.dueDate)}</li>`
          )
          .join("")}</ul>`
      : '<div class="empty-state">No actions or approvals are assigned to this colleague.</div>';
  const notices = [];
  if (reportsDue)
    notices.push(`${reportsDue} assigned project(s) do not yet have a submitted status report.`);
  if (myPendingGates.length)
    notices.push(`${myPendingGates.length} formal stage-gate approval(s) need this colleague's decision.`);
  const overdueGates = myGates.filter(formalGateOverdue);
  if (overdueGates.length) notices.push(`${overdueGates.length} assigned stage gate(s) are overdue.`);
  if (allocation?.over)
    notices.push(`Resource conflict: peak allocation is ${allocation.peak}% (${allocation.over}% over).`);
  document.getElementById("myNotificationsContent").innerHTML =
    `<ul class="compact-list">${notices.map((n) => `<li>${escapeHtml(n)}</li>`).join("") || "<li>No reports are due and there are no new notifications.</li>"}</ul>`;
  const recent = myProjects
    .slice()
    .sort((a, b) =>
      String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""))
    )
    .slice(0, 8);
  document.getElementById("myRecentProjectsContent").innerHTML = recent.length
    ? `<ul class="compact-list">${recent.map((p) => `<li>${projectLink(p.projectCode, p.projectName)}<br>Updated ${formatDate((p.updatedAt || p.createdAt || "").slice(0, 10))}</li>`).join("")}</ul>`
    : '<div class="empty-state">No assigned project updates are available.</div>';
}
function latestStatusReport(code) {
  return (
    statusReports
      .filter((r) => (r.projectCode || r.projectId) === code)
      .sort((a, b) =>
        String(b.reportingPeriod || b.updatedAt || "").localeCompare(
          String(a.reportingPeriod || a.updatedAt || "")
        )
      )[0] || null
  );
}

function renderProjectDashboard() {
  const select = document.getElementById("projectDashboardSelect"),
    scopedProjects = filteredProjects(),
    globalProject = document.getElementById("projectFilter").value,
    currentProject = globalProject || select.value;
  select.innerHTML =
    scopedProjects
      .map(
        (item) =>
          `<option value="${escapeHtml(item.projectCode)}">${escapeHtml(`${item.projectCode} - ${item.projectName}`)}</option>`
      )
      .join("") || '<option value="">No projects match this view</option>';
  const project =
    scopedProjects.find((item) => item.projectCode === currentProject) || scopedProjects[0] || null;
  if (!project) {
    document.getElementById("projectDashboardContent").innerHTML =
      '<div class="empty-state">No project matches the selected filters.</div>';
    return;
  }
  select.value = project.projectCode;
  const code = project.projectCode;
  const projectTasks = tasks.filter((t) => t.projectCode === code);
  const projectMilestones = milestones.filter((m) => (m.projectCode || m.projectId) === code);
  const projectGates = formalGates
    .filter((g) => g.projectCode === code)
    .sort((a, b) =>
      String(b.submissionDate || b.createdAt).localeCompare(String(a.submissionDate || a.createdAt))
    );
  const projectRaid = raidItems.filter((r) => (r.projectId || r.projectCode) === code);
  const behind = projectTasks.filter(taskBehindPlan);
  const high = projectRaid.filter((r) => !isClosedRaid(r) && ["High", "Critical"].includes(raidSeverity(r)));
  const dependencies = projectRaid.filter((r) => !isClosedRaid(r) && r.type === "Dependency");
  const projectDecisions = openDecisionRows(new Set([code]));
  const allocations = resourceAllocations(new Set([code])).filter((a) => a.assignments.length);
  const warnings = projectWarnings(project);
  const latest = latestStatusReport(code);
  const projectFinancial = financials.find((f) => (f.projectCode || f.projectId) === code);
  const projectBenefits = benefits.filter((b) => (b.projectCode || b.projectId) === code);
  const calculated = project.calculatedRags || PPMPlanning.calculateProjectRags(project);
  const ragHistory = PPMPlanning.getRagHistory(code).slice().reverse();
  const lifecycle = templateForProject(project);
  const readiness = mandatoryReadiness(project);
  const dependencyDecisionRows = [
    ...dependencies.map((item) => [
      safeCell("Dependency"),
      safeCell(item.title || "Untitled dependency"),
      safeCell(item.owner || "Unassigned"),
      safeDate(item.targetDate || item.reviewDate),
      safeCell(item.status || "Open")
    ]),
    ...projectDecisions.map((item) => [
      safeCell("Decision"),
      safeCell(item.title || "Decision required"),
      safeCell(item.owner || "Unassigned"),
      safeDate(item.targetDate),
      safeCell(item.status || "Required")
    ])
  ];
  document.getElementById("projectDashboardContent").innerHTML = `
        <div class="summary-strip"><div class="summary-item"><span>Status / overall RAG</span><strong>${escapeHtml(project.projectStatus || "Not set")} - ${escapeHtml(project.overallRag || "Not Assessed")}</strong></div><div class="summary-item"><span>Current / next stage</span><strong>${escapeHtml(project.currentStage || "Not set")} / ${escapeHtml(project.nextStage || PPMStageGates.nextStage(project.currentStage, project) || "Not set")}</strong></div><div class="summary-item"><span>Portfolio</span><strong>${escapeHtml(portfolioDisplay(project))}</strong></div><div class="summary-item"><span>Lifecycle template</span><strong>${escapeHtml(lifecycle ? `${lifecycle.templateId} · ${lifecycle.name} v${lifecycle.version}` : "Not assigned")}</strong></div><div class="summary-item"><span>Baseline / forecast end</span><strong>${formatDate(project.baselineEndDate)} / ${formatDate(project.forecastEndDate)}</strong></div><div class="summary-item"><span>Percentage complete</span><strong>${formatPercent(project.percentageComplete)}</strong></div><div class="summary-item"><span>Mandatory-field readiness</span><strong>${escapeHtml(readiness.summary)}</strong></div><div class="summary-item"><span>Formal gates</span><strong>${projectGates.length} total · ${projectGates.filter(formalGatePending).length} pending</strong></div></div>
        <section class="ownership-section"><h3>Project ownership</h3><p>The people accountable for sponsorship and day-to-day delivery.</p><div class="ownership-grid">${ownershipCard("Project manager", project.projectManager, project.projectManagerEmail)}${ownershipCard("Sponsor", project.sponsor, project.sponsorEmail)}${ownershipCard("Project lead", project.projectLead, project.projectLeadEmail)}${ownershipCard("Workstream", project.workstream)}</div></section>
        <div class="rag-section-heading"><h3>Calculated and reported RAG</h3><p>Nine health dimensions are assessed from project evidence. A reported difference is identified as an override and must be justified.</p></div>
        <div class="rag-summary-grid">${ragComparisonItem("Overall", calculated.overall, project.overallRag)}${ragComparisonItem("Schedule", calculated.schedule, project.scheduleRag)}${ragComparisonItem("Scope", calculated.scope, project.scopeRag)}${ragComparisonItem("Financial", calculated.financial, project.financialRag)}${ragComparisonItem("Resources", calculated.resource, project.resourceRag)}${ragComparisonItem("Risk", calculated.risk, project.riskRag)}${ragComparisonItem("Benefits", calculated.benefit, project.benefitRag)}${ragComparisonItem("Quality", calculated.quality, project.qualityRag)}${ragComparisonItem("Readiness", calculated.operationalReadiness, project.operationalReadinessRag)}</div>
        <div class="heading-actions detail-actions"><a class="button" href="project-details.html?code=${encodeURIComponent(code)}">Project summary</a><a class="button light" href="project-plan.html?code=${encodeURIComponent(code)}">Project plan</a><a class="button light" href="milestones.html?code=${encodeURIComponent(code)}">Milestones</a><a class="button light" href="stage-gates.html?code=${encodeURIComponent(code)}">Stage gates</a><a class="button light" href="raid-log.html?code=${encodeURIComponent(code)}">RAID</a><a class="button light" href="registers.html?tab=statusReports">Status reports</a><a class="button light" href="registers.html?tab=actions" data-permission="none">Actions</a><a class="button light" href="registers.html?tab=decisions" data-permission="none">Decisions</a></div>
        <section class="project-narrative"><h3>Current position</h3><p>${escapeHtml(project.currentPosition || "No current position update has been provided.")}</p></section>
        ${dashboardTableSection(
          "Milestones",
          "Baseline, forecast and completion information from the project milestone log.",
          ["Milestone", "Baseline finish", "Forecast finish", "Complete", "Status"],
          projectMilestones
            .sort((a, b) =>
              String(a.forecastFinishDate || a.baselineFinishDate || "").localeCompare(
                String(b.forecastFinishDate || b.baselineFinishDate || "")
              )
            )
            .map((item) => [
              safeCell(item.milestoneName || "Untitled milestone"),
              safeDate(item.baselineFinishDate),
              safeDate(item.forecastFinishDate),
              safePercent(item.percentageComplete),
              badge(milestoneStatus(item))
            ]),
          "No milestones have been recorded for this project."
        )}
        ${dashboardTableSection(
          "Formal stage-gate workflow",
          "Governance submissions, independent approvers and recorded outcomes for this project.",
          [
            "Gate ID / version",
            "Gate",
            "Stage transition",
            "Owner / submitted",
            "Approvers",
            "Meeting / decision",
            "Outcome",
            "Open"
          ],
          projectGates.map((g) => [
            safeCell(`${g.gateId} / v${gateVersion(g)}`),
            safeCell(g.gateName),
            safeCell(`${g.currentStage || "Not set"} → ${g.proposedNextStage || "Not applicable"}`),
            safeCell(
              `${g.submissionOwner || "Unassigned"} / ${g.submissionDate ? formatDate(g.submissionDate) : "Not submitted"}`
            ),
            safeCell(approverSummary(g)),
            safeCell(`${formatDate(g.meetingDate)} / ${formatDate(g.decisionDate)}`),
            `${workflowBadge(g.workflowStatus)}${g.conditions ? `<br>${safeCell(g.conditions)}` : ""}`,
            gateLink(g, "Open stage gate")
          ]),
          "No formal stage-gate submission has been recorded for this project."
        )}
        ${dashboardTableSection(
          "Tasks behind plan",
          "Tasks whose forecast finish has slipped beyond baseline or is already overdue.",
          ["Task", "Owner", "Baseline finish", "Forecast finish", "Complete", "Reason / recovery action"],
          behind.map((item) => [
            safeCell(item.taskName || "Unnamed task"),
            safeCell(taskResource(item)?.fullName || item.taskOwner || "Unassigned"),
            safeDate(item.baselineEndDate),
            safeDate(item.forecastEndDate),
            safePercent(item.percentageComplete),
            safeCell(
              [item.reasonForSlippage, item.returnToGreen].filter(Boolean).join(" / ") || "Not provided"
            )
          ]),
          "No tasks behind plan."
        )}
        ${dashboardTableSection(
          "High risks and issues",
          "The highest-rated open items from the project RAID log.",
          ["Type", "Title", "Owner", "Rating", "Target / review date", "Status"],
          high.map((item) => [
            safeCell(item.type || "RAID"),
            safeCell(item.title || "Untitled item"),
            safeCell(item.owner || "Unassigned"),
            badge(raidSeverity(item)),
            safeDate(item.targetDate || item.reviewDate),
            safeCell(item.status || "Open")
          ]),
          "No open high risks or issues."
        )}
        ${dashboardTableSection("Dependencies and decisions", "Open dependencies and decisions requiring attention.", ["Category", "Item", "Owner", "Target date", "Status"], dependencyDecisionRows, "No dependencies or decisions requiring attention.")}
        ${dashboardTableSection(
          "Resource position",
          "Project assignments and the peak allocation for each resource.",
          ["Resource", "Team", "Role", "Assigned tasks", "Peak allocation", "Overallocation"],
          allocations.map((item) => [
            safeCell(item.resource.fullName || "Unnamed resource"),
            safeCell(item.resource.team || "No team"),
            safeCell(item.resource.jobTitle || item.resource.role || "No role"),
            safeCell(item.assignments.map((task) => task.taskName || "Unnamed task").join(", ")),
            safeCell(`${item.peak}%`),
            item.over
              ? `<span class="badge red">${item.over}% over</span>`
              : '<span class="badge green">Within capacity</span>'
          ]),
          "No resource assignments for this project."
        )}
        ${dashboardTableSection("Latest status report", "The most recent formal reporting submission for this project.", ["Reporting period", "Report status", "Overall RAG", "Submitted / updated"], latest ? [[safeCell(latest.reportingPeriod || "Latest period"), safeCell(latest.status || "Draft"), badge(latest.overallStatus || latest.overallRag || project.overallRag), safeDate(latest.submittedDate || latest.submittedAt || latest.approvedDate || latest.approvedAt || latest.updatedAt)]] : [], "No status report has been submitted for this project.")}
        ${dashboardTableSection(
          "RAG history and overrides",
          "Every calculated and reported RAG snapshot, with override explanations.",
          ["Recorded", "Dimension", "Calculated", "Reported", "Assessment", "Justification"],
          ragHistory.flatMap((entry) =>
            PPMPlanning.RAG_DIMENSIONS.map(([key, label]) => [
              safeCell(
                entry.recordedAt ? new Date(entry.recordedAt).toLocaleString("en-GB") : "Not recorded"
              ),
              safeCell(label),
              badge(entry.dimensions?.[key]?.calculated),
              badge(entry.dimensions?.[key]?.reported),
              safeCell(entry.dimensions?.[key]?.override ? "Override" : "Aligned"),
              safeCell(entry.dimensions?.[key]?.justification || "—")
            ])
          ),
          "No RAG status history has been recorded for this project."
        )}
        ${dashboardTableSection("Financial position", "The latest approved and forecast financial position for this project.", ["Financial RAG", "Approved budget", "Forecast", "Actual", "Committed", "Estimate at completion", "Variance", "Approval status", "Last update"], projectFinancial ? [[badge(projectFinancial.financialRag || project.financialRag), formatMoney(projectFinancial.approvedBudget ?? projectFinancial.budget), formatMoney(projectFinancial.forecastCost ?? projectFinancial.forecast), formatMoney(projectFinancial.actualCost ?? projectFinancial.actual), formatMoney(projectFinancial.committedCost ?? 0), formatMoney(projectFinancial.estimateAtCompletion ?? 0), formatMoney(projectFinancial.budgetVariance ?? projectFinancial.variance), safeCell(projectFinancial.budgetApprovalStatus || "No approved budget"), safeDate(projectFinancial.lastFinancialUpdateDate || projectFinancial.lastUpdated)]] : [], "No financial information has been provided for this project.")}
        ${dashboardTableSection(
          "Benefits",
          "Expected benefits, ownership and realisation dates.",
          ["Benefit", "Type", "Owner", "Target", "Status", "Realisation date"],
          projectBenefits.map((item) => [
            safeCell(item.description || item.benefitName || "Unnamed benefit"),
            safeCell(item.benefitType || item.type || "Not set"),
            safeCell(item.owner || "Unassigned"),
            safeCell(item.targetValue ?? item.target ?? "Not provided"),
            safeCell(item.status || "Not set"),
            safeDate(item.targetRealisationDate || item.realisationDate)
          ]),
          "No benefits have been recorded for this project. Use Benefits Management to add a project-level benefit."
        )}
        ${dashboardTableSection(
          "Data-quality warnings",
          "Missing or outdated information that should be reviewed.",
          ["Warning", "Suggested owner"],
          warnings.map((warning) => [safeCell(warning), safeCell(project.projectManager || "PMO")]),
          "No data-quality warnings for this project."
        )}`;
}
function ragSummaryItem(label, value) {
  const rag = value || "Not Assessed";
  const tone = rag === "Green" ? "rag-green" : rag === "Amber" ? "rag-amber" : rag === "Red" ? "rag-red" : "";
  return `<div class="rag-summary-item ${tone}"><span class="rag-title">${escapeHtml(label)} RAG</span><strong class="rag-value">${escapeHtml(rag)}</strong></div>`;
}
function ragComparisonItem(label, calculated, reported) {
  const report = reported || "Not Assessed",
    calc = calculated || "Not Assessed",
    tone =
      report === "Green" ? "rag-green" : report === "Amber" ? "rag-amber" : report === "Red" ? "rag-red" : "";
  return `<div class="rag-summary-item ${tone}"><span class="rag-title">${escapeHtml(label)}</span><span class="rag-caption">Reported</span><strong class="rag-value">${escapeHtml(report)}</strong><span class="rag-caption calculated">Calculated: ${escapeHtml(calc)}${calc !== report ? " · Override" : ""}</span></div>`;
}
function ownershipCard(label, name, email) {
  const displayName = name || "Not assigned";
  const emailMarkup = email
    ? `<a class="ownership-email" href="mailto:${encodeURIComponent(email)}">${escapeHtml(email)}</a>`
    : '<span class="ownership-email">No email recorded</span>';
  return `<div class="ownership-card"><span class="ownership-label">${escapeHtml(label)}</span><strong class="ownership-name">${escapeHtml(displayName)}</strong>${label === "Workstream" ? "" : emailMarkup}</div>`;
}
function safeCell(value) {
  return escapeHtml(value ?? "Not set");
}
function safeDate(value) {
  const text = String(value || "");
  return escapeHtml(formatDate(text.length >= 10 ? text.slice(0, 10) : text));
}
function safePercent(value) {
  return escapeHtml(formatPercent(value));
}
function dashboardTableSection(title, description, headers, rows, emptyMessage) {
  return `<section class="dashboard-data-section"><div class="dashboard-data-heading"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div><div class="table-wrapper"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty-state">${escapeHtml(emptyMessage)}</td></tr>`}</tbody></table></div></section>`;
}

const reportCatalogue = [
  ["portfolio-status", "Portfolio status report"],
  ["project-status", "Project status report"],
  ["rag-overrides", "RAG overrides report"],
  ["rag-history", "RAG history report"],
  ["baseline-governance", "Baseline governance report"],
  ["critical-path", "Critical-path alerts report"],
  ["milestones", "Milestone report"],
  ["exceptions", "Exceptions report"],
  ["tasks-behind", "Tasks-behind-plan report"],
  ["raid", "RAID report"],
  ["decisions", "Decisions-required report"],
  ["overdue-actions", "Overdue-actions report"],
  ["resource-demand", "Resource demand report"],
  ["resource-capacity", "Resource capacity report"],
  ["over-allocation", "Over-allocation report"],
  ["unfilled-demand", "Unfilled-demand report"],
  ["financial", "Financial report"],
  ["benefits", "Benefits report"],
  ["stage-gates", "Formal stage-gate report"],
  ["governance", "Governance-compliance report"],
  ["data-quality", "Data-quality report"],
  ["closure", "Project closure report"]
];
const reportEmptyMessages = {
  "portfolio-status": "No projects match the selected filters.",
  "project-status": "No project status information matches the selected filters.",
  "rag-overrides": "No calculated and reported RAG overrides have been recorded.",
  "rag-history": "No historical RAG assessments match the selected filters.",
  "baseline-governance": "No approved baselines or rebaseline requests match the selected filters.",
  "critical-path": "No slipped critical-path tasks require attention.",
  milestones: "No milestones match the selected filters.",
  exceptions: "No project exceptions require attention.",
  "tasks-behind": "No tasks behind plan.",
  raid: "No RAID items match the selected filters.",
  decisions: "No decisions are currently required.",
  "overdue-actions": "No overdue actions.",
  "resource-demand": "No resource demand matches the selected filters.",
  "resource-capacity": "No resource capacity information is available for this view.",
  "over-allocation": "No resources are over-allocated.",
  "unfilled-demand": "No unfilled resource demand.",
  financial: "No financial information matches the selected filters.",
  benefits: "No benefits match the selected filters.",
  "stage-gates": "No formal stage-gate records match the selected filters.",
  governance: "No governance-compliance results match the selected filters.",
  "data-quality": "No data-quality warnings.",
  closure: "No projects are currently at the closure stage."
};
function populateReportSelector() {
  const select = document.getElementById("reportSelector");
  const current = select.value || "portfolio-status";
  select.innerHTML = reportCatalogue.map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
  select.value = reportCatalogue.some(([id]) => id === current) ? current : "portfolio-status";
}
function col(key, label, format, groupable = true) {
  return { key, label, format: format || ((value) => escapeHtml(value ?? "")), groupable };
}
function formalGateReportRow(gate) {
  const project = projectByCode(gate.projectCode) || {};
  const portfolio = portfolioForProject(project);
  const lifecycle = templateForProject(project);
  return {
    ...gate,
    projectName: project.projectName || gate.projectName || "Unknown",
    portfolioId: portfolio?.portfolioId || project.portfolioId || "Not assigned",
    portfolioDisplay: portfolio
      ? `${portfolio.portfolioId} · ${portfolio.name}`
      : project.portfolio || "Not assigned",
    gateVersion: gateVersion(gate),
    lifecycleTemplate: lifecycle ? `${lifecycle.templateId} · ${lifecycle.name}` : "Not assigned",
    lifecycleVersion: lifecycle?.version || "Not set",
    stageTransition: `${gate.currentStage || "Not set"} → ${gate.proposedNextStage || "Not applicable"}`,
    routeStatus:
      gate.routeRequirement === "Not Applicable"
        ? `${gate.routeRequirement} · ${gate.routeApprovalStatus}`
        : gate.routeRequirement,
    approvers: approverSummary(gate),
    ownerAndSubmission: `${gate.submissionOwner || "Unassigned"}${gate.submissionDate ? ` · ${formatDate(gate.submissionDate)}` : " · Not submitted"}`,
    outcome: gate.decisionSummary || gate.workflowStatus,
    comments:
      [
        gate.submissionComments,
        gate.approvalComments,
        gate.routeApprovalComments,
        gate.rejectionDeferralReason
      ]
        .filter(Boolean)
        .join(" / ") || "No comments recorded",
    supportingDocuments: gateDocumentSummary(gate),
    linkedActions: gateActionSummary(gate),
    linkedDecision: gate.linkedDecisionId || "None linked",
    dueDate: formalGateDueDate(gate),
    overdue: formalGateOverdue(gate) ? "Overdue" : formalGatePending(gate) ? "Pending" : "No",
    open: gateLink(gate, "Open stage gate")
  };
}
function baseProjectRows(scope) {
  return scope.map((p) => {
    const portfolio = portfolioForProject(p),
      lifecycle = templateForProject(p);
    return {
      projectCode: p.projectCode,
      projectName: p.projectName,
      portfolioId: portfolio?.portfolioId || p.portfolioId || "Not assigned",
      portfolio: portfolioDisplay(p),
      lifecycleTemplate: lifecycle
        ? `${lifecycle.templateId} · ${lifecycle.name} v${lifecycle.version}`
        : "Not assigned",
      workstream: p.workstream || "Not set",
      projectManager: p.projectManager || "Not assigned",
      sponsor: p.sponsor || "Not assigned",
      projectLead: p.projectLead || "Not assigned",
      status: p.projectStatus || "Not set",
      rag: p.overallRag || "Not Assessed",
      scheduleRag: p.scheduleRag || "Not Assessed",
      scopeRag: p.scopeRag || "Not Assessed",
      financialRag: p.financialRag || "Not Assessed",
      resourceRag: p.resourceRag || "Not Assessed",
      riskRag: p.riskRag || "Not Assessed",
      stage: p.currentStage || "Not set",
      priority: p.priority || "Not set",
      baselineEnd: p.baselineEndDate || "",
      forecastEnd: p.forecastEndDate || "",
      complete: Number(p.percentageComplete) || 0,
      currentPosition: p.currentPosition || "",
      warnings: projectWarnings(p).length
    };
  });
}
function reportDefinition(id) {
  const scope = filteredProjects(),
    codes = new Set(scope.map((p) => p.projectCode)),
    base = baseProjectRows(scope),
    gap = {};
  const projectCols = [
    col("projectCode", "Project ID"),
    col("projectName", "Project", (v, row) => projectLink(row.projectCode, v)),
    col("portfolioId", "Portfolio ID"),
    col("portfolio", "Portfolio"),
    col("workstream", "Workstream"),
    col("projectManager", "Project manager"),
    col("status", "Status"),
    col("rag", "Overall RAG", badge),
    col("scheduleRag", "Schedule RAG", badge),
    col("scopeRag", "Scope RAG", badge),
    col("financialRag", "Financial RAG", badge),
    col("resourceRag", "Resources RAG", badge),
    col("riskRag", "Risk RAG", badge),
    col("stage", "Stage"),
    col("baselineEnd", "Baseline end", formatDate),
    col("forecastEnd", "Forecast end", formatDate),
    col("complete", "Complete", formatPercent)
  ];
  if (id === "portfolio-status")
    return {
      title: "Portfolio status report",
      description: "Portfolio delivery position by project, status, RAG, stage and dates.",
      columns: [...projectCols, col("priority", "Priority"), col("warnings", "Data warnings")],
      rows: base
    };
  if (id === "project-status")
    return {
      title: "Project status report",
      description: "Current project position with the latest formal status report where available.",
      columns: [
        ...projectCols,
        col("reportingPeriod", "Latest reporting period"),
        col("reportStatus", "Report status"),
        col("executiveSummary", "Executive summary"),
        col("progressThisPeriod", "Progress this period"),
        col("plannedNextPeriod", "Planned next period"),
        col("decisionsRequired", "Decisions required"),
        col("returnToGreenActions", "Return to green"),
        col("sponsorComments", "Sponsor comments")
      ],
      rows: base.map((row) => {
        const report = latestStatusReport(row.projectCode);
        return {
          ...row,
          reportingPeriod: report?.reportingPeriod || "Not available",
          reportStatus: report?.status || "Not available",
          executiveSummary: report?.executiveSummary || row.currentPosition || "Not available",
          progressThisPeriod: report?.progressThisPeriod || "Not available",
          plannedNextPeriod: report?.plannedNextPeriod || "Not available",
          decisionsRequired: report?.decisionsRequired || "Not available",
          returnToGreenActions: report?.returnToGreenActions || "Not available",
          sponsorComments: report?.sponsorComments || "Not available"
        };
      }),
      gap: statusReports.length
        ? ""
        : "No formal status reports have been submitted. Current project information is shown below."
    };
  if (id === "rag-overrides")
    return {
      title: "RAG overrides report",
      description:
        "Calculated and reported RAG values that differ, with the required management justification.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("recordedAt", "Recorded", (v) =>
          escapeHtml(v ? new Date(v).toLocaleString("en-GB") : "Not recorded")
        ),
        col("dimension", "Dimension"),
        col("calculated", "Calculated", badge),
        col("reported", "Reported", badge),
        col("justification", "Override justification"),
        col("recordedBy", "Recorded by")
      ],
      rows: scope.flatMap((project) =>
        PPMPlanning.getRagHistory(project.projectCode).flatMap((entry) =>
          PPMPlanning.RAG_DIMENSIONS.filter(([key]) => entry.dimensions?.[key]?.override).map(
            ([key, label]) => ({
              projectCode: project.projectCode,
              projectName: project.projectName,
              recordedAt: entry.recordedAt,
              dimension: label,
              calculated: entry.dimensions[key].calculated,
              reported: entry.dimensions[key].reported,
              justification: entry.dimensions[key].justification || "Not recorded",
              recordedBy: entry.recordedBy || "Project team"
            })
          )
        )
      )
    };
  if (id === "rag-history")
    return {
      title: "RAG history report",
      description: "Historical calculated and reported RAG assessments for trend and audit reporting.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("recordedAt", "Recorded", (v) =>
          escapeHtml(v ? new Date(v).toLocaleString("en-GB") : "Not recorded")
        ),
        col("dimension", "Dimension"),
        col("calculated", "Calculated", badge),
        col("reported", "Reported", badge),
        col("assessment", "Assessment"),
        col("justification", "Justification")
      ],
      rows: scope.flatMap((project) =>
        PPMPlanning.getRagHistory(project.projectCode).flatMap((entry) =>
          PPMPlanning.RAG_DIMENSIONS.map(([key, label]) => ({
            projectCode: project.projectCode,
            projectName: project.projectName,
            recordedAt: entry.recordedAt,
            dimension: label,
            calculated: entry.dimensions?.[key]?.calculated || "Not Assessed",
            reported: entry.dimensions?.[key]?.reported || "Not Assessed",
            assessment: entry.dimensions?.[key]?.override ? "Override" : "Aligned",
            justification: entry.dimensions?.[key]?.justification || "—"
          }))
        )
      )
    };
  if (id === "baseline-governance")
    return {
      title: "Baseline governance report",
      description: "Approved baseline versions and rebaseline requests retained for audit.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("recordType", "Record type"),
        col("version", "Version"),
        col("status", "Status"),
        col("reason", "Reason"),
        col("impact", "Impact"),
        col("requestedBy", "Requested / approved by"),
        col("recordedAt", "Recorded", (v) =>
          escapeHtml(v ? new Date(v).toLocaleString("en-GB") : "Not recorded")
        )
      ],
      rows: scope.flatMap((project) => [
        ...PPMPlanning.getProjectBaselines(project.projectCode).map((item) => ({
          projectCode: project.projectCode,
          projectName: project.projectName,
          recordType: "Approved baseline",
          version: item.version,
          status: item.status,
          reason: item.reason || "Initial / approved baseline",
          impact: item.impact || "—",
          requestedBy: item.approvedBy || "Not recorded",
          recordedAt: item.approvedAt
        })),
        ...(PPMPlanning.getBaselineRequests()[project.projectCode] || []).map((item) => ({
          projectCode: project.projectCode,
          projectName: project.projectName,
          recordType: "Rebaseline request",
          version: item.proposedVersion || "Proposed",
          status: item.status,
          reason: item.reason || "Not recorded",
          impact: item.impact || "Not recorded",
          requestedBy: item.requestedBy || item.decidedBy || "Not recorded",
          recordedAt: item.requestedAt || item.decidedAt || item.createdAt
        }))
      ])
    };
  if (id === "critical-path")
    return {
      title: "Critical-path alerts report",
      description: "Critical project-plan work and elevated slippage alerts against approved baselines.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("taskName", "Critical task"),
        col("owner", "Owner"),
        col("baselineEnd", "Approved baseline end", formatDate),
        col("forecastEnd", "Forecast end", formatDate),
        col("daysLate", "Days late"),
        col("impact", "Impact"),
        col("returnToGreen", "Return to green")
      ],
      rows: scope.flatMap((project) => {
        const rows = PPMPlanning.normalisePlan(
          tasks.filter((item) => item.projectCode === project.projectCode)
        );
        PPMPlanning.calculateCriticalPath(rows);
        return rows
          .filter((item) => item.criticalPath)
          .map((item) => {
            const slip = PPMPlanning.slippageResult(project.projectCode, item);
            return {
              projectCode: project.projectCode,
              projectName: project.projectName,
              taskName: item.taskName,
              owner: item.taskOwner || resourceById(item.taskOwnerResourceId)?.fullName || "Unassigned",
              baselineEnd: slip.approvedBaselineEndDate,
              forecastEnd: item.actualEndDate || item.forecastEndDate,
              daysLate: slip.daysLate,
              impact: item.slippageImpact || "Not recorded",
              returnToGreen: item.returnToGreen || "Not recorded"
            };
          })
          .filter((item) => item.daysLate > 0);
      })
    };
  if (id === "milestones")
    return {
      title: "Milestone report",
      description: "All milestones with baseline, forecast, completion and calculated status.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("milestoneName", "Milestone"),
        col("baselineStartDate", "Baseline start", formatDate),
        col("baselineFinishDate", "Baseline finish", formatDate),
        col("forecastStartDate", "Forecast start", formatDate),
        col("forecastFinishDate", "Forecast finish", formatDate),
        col("percentageComplete", "Complete", formatPercent),
        col("calculatedStatus", "Status")
      ],
      rows: milestones
        .filter((m) => inScope(m, codes))
        .map((m) => ({
          ...m,
          projectName: projectByCode(m.projectCode || m.projectId)?.projectName || "Unknown",
          calculatedStatus: milestoneStatus(m),
          projectCode: m.projectCode || m.projectId
        }))
    };
  if (id === "tasks-behind")
    return {
      title: "Tasks-behind-plan report",
      description: "Incomplete tasks whose forecast has slipped beyond baseline or is already overdue.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("taskName", "Task"),
        col("taskOwner", "Owner"),
        col("baselineEndDate", "Baseline end", formatDate),
        col("forecastEndDate", "Forecast end", formatDate),
        col("percentageComplete", "Complete", formatPercent),
        col("reasonForSlippage", "Reason for slippage"),
        col("returnToGreen", "Return to green")
      ],
      rows: tasks
        .filter((t) => inScope(t, codes) && taskBehindPlan(t))
        .map((t) => ({ ...t, projectName: projectByCode(t.projectCode)?.projectName || "Unknown" }))
    };
  if (id === "raid")
    return {
      title: "RAID report",
      description: "Risks, assumptions, issues and dependencies with ownership, review and severity.",
      columns: [
        col("raidId", "RAID ID"),
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("type", "Type"),
        col("title", "Title"),
        col("description", "Description"),
        col("owner", "Owner"),
        col("targetDate", "Target / review", formatDate),
        col("status", "Status"),
        col("priority", "Priority"),
        col("severity", "Risk rating"),
        col("escalationStatus", "Escalation")
      ],
      rows: raidItems
        .filter((r) => inScope(r, codes))
        .map((r) => ({
          ...r,
          projectCode: r.projectId || r.projectCode,
          projectName: projectByCode(r.projectId || r.projectCode)?.projectName || "Unknown",
          severity: raidSeverity(r)
        }))
    };
  if (id === "decisions")
    return {
      title: "Decisions-required report",
      description:
        "Open records from the decision register, plus RAID items that explicitly require a decision.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("decisionId", "Decision ID"),
        col("sourceType", "Source"),
        col("decisionRequired", "Decision required"),
        col("owner", "Owner"),
        col("targetDate", "Required by", formatDate),
        col("status", "Status")
      ],
      rows: openDecisionRows(codes).map((item) => ({
        ...item,
        projectName: projectByCode(item.projectCode)?.projectName || "Unknown"
      }))
    };
  if (id === "overdue-actions")
    return {
      title: "Overdue-actions report",
      description: "Actions past their due date and not complete.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("actionId", "Action ID"),
        col("title", "Action"),
        col("owner", "Owner"),
        col("dueDate", "Due date", formatDate),
        col("priority", "Priority"),
        col("status", "Status")
      ],
      rows: actions
        .filter(
          (a) =>
            inScope(a, codes) &&
            a.dueDate &&
            a.dueDate < todayIso() &&
            !["Complete", "Closed"].includes(a.status)
        )
        .map((a) => ({
          ...a,
          title: a.title || a.description || "Action",
          projectName: projectByCode(a.projectCode || a.projectId)?.projectName || "Unknown"
        })),
      gap: actions.length ? "" : "No action information has been provided."
    };
  const demand = tasks
    .filter((t) => inScope(t, codes) && t.status !== "Cancelled")
    .map((t) => {
      const resource = taskResource(t);
      return {
        ...t,
        projectName: projectByCode(t.projectCode)?.projectName || "Unknown",
        resourceName: resource?.fullName || t.taskOwner || "Unfilled",
        team: resource?.team || "Unfilled",
        role: resource?.jobTitle || resource?.role || "Unfilled",
        start: t.forecastStartDate || t.baselineStartDate || "",
        finish: t.forecastEndDate || t.baselineEndDate || "",
        allocation: Number(t.allocationPercentage) || 100
      };
    });
  if (id === "resource-demand")
    return {
      title: "Resource demand report",
      description: "Project task demand by person, team, role, dates and allocation.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("taskName", "Task"),
        col("resourceName", "Resource"),
        col("team", "Team"),
        col("role", "Role"),
        col("start", "Start", formatDate),
        col("finish", "Finish", formatDate),
        col("allocation", "Allocation", formatPercent)
      ],
      rows: demand
    };
  const capacity = resourceAllocations(codes).map((a) => ({
    resourceId: a.resource.resourceId,
    resourceName: a.resource.fullName,
    team: a.resource.team || "No team",
    role: a.resource.jobTitle || a.resource.role || "No role",
    current: a.current,
    peak: a.peak,
    capacity: 100,
    available: Math.max(0, 100 - a.current),
    over: a.over,
    assignmentCount: a.assignments.length
  }));
  if (id === "resource-capacity")
    return {
      title: "Resource capacity report",
      description: "Current and peak allocation against nominal 100% capacity.",
      columns: [
        col("resourceName", "Resource"),
        col("team", "Team"),
        col("role", "Role"),
        col("capacity", "Capacity", formatPercent),
        col("current", "Current allocation", formatPercent),
        col("available", "Available", formatPercent),
        col("peak", "Peak allocation", formatPercent),
        col("assignmentCount", "Assignments")
      ],
      rows: capacity
    };
  if (id === "over-allocation")
    return {
      title: "Over-allocation report",
      description: "Resources whose concurrent task demand exceeds 100%.",
      columns: [
        col("resourceName", "Resource"),
        col("team", "Team"),
        col("role", "Role"),
        col("peak", "Peak allocation", formatPercent),
        col("over", "Overallocation", formatPercent),
        col("assignmentCount", "Assignments"),
        col("assignmentDetail", "Assignment detail")
      ],
      rows: capacity
        .filter((r) => r.over > 0)
        .map((r) => {
          const source = resourceAllocations(codes).find((a) => a.resource.resourceId === r.resourceId);
          return {
            ...r,
            assignmentDetail: source.assignments
              .map((a) => `${a.projectCode}: ${a.taskName} (${a.allocation}%)`)
              .join("; ")
          };
        })
    };
  if (id === "unfilled-demand")
    return {
      title: "Unfilled-demand report",
      description: "Tasks without an active matching resource owner.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("taskName", "Task"),
        col("taskOwner", "Recorded owner"),
        col("start", "Start", formatDate),
        col("finish", "Finish", formatDate),
        col("allocation", "Allocation", formatPercent)
      ],
      rows: demand
        .filter((r) => !taskResource(r))
        .map((r) => ({ ...r, taskOwner: r.taskOwner || "Not assigned" }))
    };
  if (id === "financial")
    return {
      title: "Financial report",
      description:
        "Approved budget, forecast, actual, commitments and calculated completion variance by project.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("financialRag", "Financial RAG", badge),
        col("approvedBudget", "Approved budget", formatMoney),
        col("forecastCost", "Forecast", formatMoney),
        col("actualCost", "Actual", formatMoney),
        col("committedCost", "Committed", formatMoney),
        col("remainingForecast", "Remaining forecast", formatMoney),
        col("estimateAtCompletion", "Estimate at completion", formatMoney),
        col("budgetVariance", "Budget variance", formatMoney),
        col(
          "budgetVariancePercentage",
          "Variance %",
          (v) => `${Number(v || 0).toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`
        ),
        col("budgetApprovalStatus", "Budget approval"),
        col("financialOwner", "Financial owner"),
        col("financialCommentary", "Commentary"),
        col("lastFinancialUpdateDate", "Last update", formatDate)
      ],
      rows: scope.map((p) => {
        const f = financials.find((x) => (x.projectCode || x.projectId) === p.projectCode) || {};
        return {
          projectCode: p.projectCode,
          projectName: p.projectName,
          financialRag: f.financialRag || p.financialRag || "Not available",
          approvedBudget: f.approvedBudget ?? 0,
          forecastCost: f.forecastCost ?? 0,
          actualCost: f.actualCost ?? 0,
          committedCost: f.committedCost ?? 0,
          remainingForecast: f.remainingForecast ?? 0,
          estimateAtCompletion: f.estimateAtCompletion ?? 0,
          budgetVariance: f.budgetVariance ?? 0,
          budgetVariancePercentage: f.budgetVariancePercentage ?? 0,
          budgetApprovalStatus: f.budgetApprovalStatus || "No approved budget",
          financialOwner: f.financialOwner || "Not assigned",
          financialCommentary: f.financialCommentary || "No financial commentary has been provided",
          lastFinancialUpdateDate: f.lastFinancialUpdateDate || f.lastUpdated || ""
        };
      }),
      gap: financials.length
        ? ""
        : "No financial information has been provided. Unavailable values are clearly identified below."
    };
  if (id === "benefits")
    return {
      title: "Benefits report",
      description:
        "Project and programme benefit ownership, measures, targets, status and realisation timeline.",
      columns: [
        col("linkLevel", "Level"),
        col("programmeName", "Programme"),
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) =>
          r.projectCode ? projectLink(r.projectCode, v) : "Programme-level"
        ),
        col("benefitId", "Benefit ID"),
        col("description", "Benefit"),
        col("benefitType", "Type"),
        col("owner", "Owner"),
        col("targetValue", "Target"),
        col("currentValue", "Current value"),
        col("status", "Status"),
        col("realisationConfidence", "Confidence"),
        col("targetRealisationDate", "Realisation date", formatDate),
        col("lastReviewDate", "Last review", formatDate),
        col("nextReviewDate", "Next review", formatDate)
      ],
      rows: benefits
        .filter((b) => inScope(b, codes))
        .map((b) => ({
          ...b,
          linkLevel: b.linkLevel || (b.projectCode || b.projectId ? "Project" : "Programme"),
          programmeName: benefitProgrammeName(b),
          projectName: projectByCode(b.projectCode || b.projectId)?.projectName || "Programme-level",
          targetValue: b.targetValue ?? b.target ?? "",
          targetRealisationDate: b.targetRealisationDate || b.realisationDate || ""
        })),
      gap: benefits.length ? "" : "No benefits have been recorded for the selected projects or programmes."
    };
  if (id === "stage-gates")
    return {
      title: "Formal stage-gate report",
      description:
        "Submission, independent approval, outcome and linked governance evidence for every formal project stage gate.",
      columns: [
        col("portfolioId", "Portfolio ID"),
        col("portfolioDisplay", "Portfolio"),
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("gateId", "Gate ID"),
        col("gateVersion", "Gate version"),
        col("gateName", "Gate"),
        col("lifecycleTemplate", "Lifecycle template"),
        col("lifecycleVersion", "Lifecycle version"),
        col("stageTransition", "Stage transition"),
        col("routeStatus", "Governance route"),
        col("routeReason", "Route reason"),
        col("ownerAndSubmission", "Owner / submission"),
        col("approvers", "Required approvers"),
        col("meetingDate", "Meeting", formatDate),
        col("decisionDate", "Decision", formatDate),
        col("workflowStatus", "Outcome", workflowBadge),
        col("outcome", "Decision summary"),
        col("comments", "Comments / reason"),
        col("conditions", "Conditions"),
        col("supportingDocuments", "Supporting documents"),
        col("linkedActions", "Linked actions"),
        col("linkedDecision", "Linked decision"),
        col("completionDate", "Completion", formatDate),
        col("overdue", "Pending / overdue"),
        col("open", "Open", (v) => v, false)
      ],
      rows: formalGates.filter((g) => inScope(g, codes)).map(formalGateReportRow)
    };
  if (id === "governance")
    return {
      title: "Governance-compliance report",
      description:
        "Lifecycle-template readiness, mandatory data and approved stage-gate evidence alongside core project controls.",
      columns: [
        col("portfolioId", "Portfolio ID"),
        col("portfolio", "Portfolio"),
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("lifecycleTemplate", "Lifecycle template"),
        col("lifecycleVersion", "Version"),
        col("stage", "Current stage"),
        col("mandatory", "Mandatory fields"),
        col("missingMandatory", "Missing mandatory fields"),
        col("stageGate", "Approved gate evidence"),
        col("ownership", "Ownership"),
        col("dates", "Dates"),
        col("rag", "RAG"),
        col("plan", "Plan"),
        col("milestones", "Milestones"),
        col("raid", "RAID"),
        col("documents", "Documents"),
        col("result", "Result")
      ],
      rows: scope.map((p) => {
        const portfolio = portfolioForProject(p),
          lifecycle = templateForProject(p),
          mandatory = mandatoryReadiness(p),
          gateEvidence = requiredGateEvidence(p);
        const checks = {
          lifecycle: Boolean(lifecycle),
          mandatory: mandatory.complete,
          stageGate: gateEvidence.complete,
          ownership: Boolean(p.projectManager && p.sponsor && p.projectLead),
          dates: Boolean(p.baselineEndDate && p.forecastEndDate),
          rag: Boolean(p.overallRag && p.overallRag !== "Not Assessed"),
          plan: tasks.some((t) => t.projectCode === p.projectCode),
          milestones: milestones.some((m) => (m.projectCode || m.projectId) === p.projectCode),
          raid: raidItems.some((r) => (r.projectId || r.projectCode) === p.projectCode),
          documents: documents.some((d) => (d.projectCode || d.projectId) === p.projectCode)
        };
        return {
          portfolioId: portfolio?.portfolioId || p.portfolioId || "Not assigned",
          portfolio: portfolioDisplay(p),
          projectCode: p.projectCode,
          projectName: p.projectName,
          lifecycleTemplate: lifecycle ? `${lifecycle.templateId} · ${lifecycle.name}` : "Missing",
          lifecycleVersion: lifecycle?.version || "Not set",
          stage: p.currentStage || "Not set",
          mandatory: mandatory.summary,
          missingMandatory: mandatory.missing.map((rule) => rule.label).join("; ") || "None",
          stageGate: gateEvidence.required
            ? gateEvidence.gate
              ? `Approved · ${gateEvidence.gate.gateId}`
              : "Missing approved gate"
            : "Not required",
          ownership: checks.ownership ? "Complete" : "Missing",
          dates: checks.dates ? "Complete" : "Missing",
          rag: checks.rag ? "Complete" : "Missing",
          plan: checks.plan ? "Complete" : "Missing",
          milestones: checks.milestones ? "Complete" : "Missing",
          raid: checks.raid ? "Complete" : "Missing",
          documents: checks.documents ? "Complete" : "Missing",
          result: Object.values(checks).every(Boolean) ? "Compliant" : "Action required"
        };
      })
    };
  if (id === "data-quality")
    return {
      title: "Data-quality report",
      description: "Missing, stale or inconsistent information requiring correction.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("recordType", "Record type"),
        col("warning", "Warning"),
        col("severity", "Severity"),
        col("owner", "Suggested owner")
      ],
      rows: scope.flatMap((p) =>
        projectWarnings(p).map((warning) => ({
          projectCode: p.projectCode,
          projectName: p.projectName,
          recordType: "Project / plan",
          warning,
          severity: warning.includes("owner") || warning.includes("Sponsor") ? "High" : "Medium",
          owner: p.projectManager || "PMO"
        }))
      )
    };
  if (id === "closure")
    return {
      title: "Project closure report",
      description:
        "Closure readiness against the assigned lifecycle template, mandatory closure information and an approved formal closure gate.",
      columns: [
        col("portfolioId", "Portfolio ID"),
        col("portfolio", "Portfolio"),
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("lifecycleTemplate", "Lifecycle template"),
        col("status", "Status"),
        col("stage", "Stage"),
        col("closureMandatory", "Mandatory closure fields"),
        col("tasks", "Tasks complete"),
        col("milestones", "Milestones complete"),
        col("raid", "Open RAID"),
        col("documents", "Closure documents"),
        col("closureGate", "Approved closure gate"),
        col("gateDecision", "Gate decision"),
        col("openGate", "Open gate", (v) => v, false),
        col("readiness", "Closure readiness")
      ],
      rows: scope
        .filter((p) => p.projectStatus === "Completed" || p.currentStage === closureStageForProject(p))
        .map((p) => {
          const portfolio = portfolioForProject(p),
            lifecycle = templateForProject(p),
            closureStage = closureStageForProject(p),
            mandatory = mandatoryReadiness(p, closureStage),
            gate = approvedClosureGate(p),
            pt = tasks.filter((t) => t.projectCode === p.projectCode),
            pm = milestones.filter((m) => (m.projectCode || m.projectId) === p.projectCode),
            pr = raidItems.filter(
              (r) => (r.projectId || r.projectCode) === p.projectCode && !isClosedRaid(r)
            );
          const taskOk =
              pt.length > 0 &&
              pt.every((t) => t.status === "Complete" || Number(t.percentageComplete) >= 100),
            mileOk = pm.length > 0 && pm.every((m) => milestoneStatus(m) === "Complete"),
            docOk = documents.some(
              (d) =>
                (d.projectCode || d.projectId) === p.projectCode &&
                String(d.documentType || d.type || "")
                  .toLowerCase()
                  .includes("closure")
            ),
            gateOk = Boolean(gate),
            ready = mandatory.complete && taskOk && mileOk && !pr.length && docOk && gateOk;
          return {
            portfolioId: portfolio?.portfolioId || p.portfolioId || "Not assigned",
            portfolio: portfolioDisplay(p),
            projectCode: p.projectCode,
            projectName: p.projectName,
            lifecycleTemplate: lifecycle
              ? `${lifecycle.templateId} · ${lifecycle.name} v${lifecycle.version}`
              : "Not assigned",
            status: p.projectStatus,
            stage: p.currentStage,
            closureMandatory: mandatory.summary,
            tasks: taskOk ? "Complete" : "Incomplete",
            milestones: mileOk ? "Complete" : "Incomplete",
            raid: pr.length,
            documents: docOk ? "Present" : "Missing",
            closureGate: gate ? `${gate.gateId} / v${gateVersion(gate)}` : "Missing",
            gateDecision: gate?.decisionSummary || gate?.workflowStatus || "No approved decision",
            openGate: gate ? gateLink(gate, "Open closure gate") : "Not available",
            readiness: ready ? "Ready" : "Not ready"
          };
        })
    };
  if (id === "exceptions") {
    const rows = [];
    milestones
      .filter((m) => inScope(m, codes) && milestoneStatus(m) === "Overdue")
      .forEach((m) =>
        rows.push({
          projectCode: m.projectCode || m.projectId,
          projectName: projectByCode(m.projectCode || m.projectId)?.projectName || "Unknown",
          exceptionType: "Overdue milestone",
          record: m.milestoneName,
          owner: "Project manager",
          dueDate: m.forecastFinishDate,
          severity: "High"
        })
      );
    formalGates
      .filter((g) => inScope(g, codes) && formalGateOverdue(g))
      .forEach((g) =>
        rows.push({
          projectCode: g.projectCode,
          projectName: projectByCode(g.projectCode)?.projectName || "Unknown",
          exceptionType: "Overdue formal stage gate",
          record: `${g.gateId} · ${g.gateName}`,
          owner: g.submissionOwner || "Unassigned",
          dueDate: g.meetingDate,
          severity: "High"
        })
      );
    tasks
      .filter((t) => inScope(t, codes) && taskBehindPlan(t))
      .forEach((t) =>
        rows.push({
          projectCode: t.projectCode,
          projectName: projectByCode(t.projectCode)?.projectName || "Unknown",
          exceptionType: "Task behind plan",
          record: t.taskName,
          owner: t.taskOwner || "Unassigned",
          dueDate: t.forecastEndDate || t.baselineEndDate,
          severity: "High"
        })
      );
    raidItems
      .filter((r) => inScope(r, codes) && !isClosedRaid(r) && ["High", "Critical"].includes(raidSeverity(r)))
      .forEach((r) =>
        rows.push({
          projectCode: r.projectId || r.projectCode,
          projectName: projectByCode(r.projectId || r.projectCode)?.projectName || "Unknown",
          exceptionType: "High RAID",
          record: r.title,
          owner: r.owner || "Unassigned",
          dueDate: r.targetDate,
          severity: raidSeverity(r)
        })
      );
    return {
      title: "Exceptions report",
      description: "Consolidated schedule, milestone, formal stage-gate, RAID and governance exceptions.",
      columns: [
        col("projectCode", "Project ID"),
        col("projectName", "Project", (v, r) => projectLink(r.projectCode, v)),
        col("exceptionType", "Exception type"),
        col("record", "Record"),
        col("owner", "Owner"),
        col("dueDate", "Due date", formatDate),
        col("severity", "Severity")
      ],
      rows
    };
  }
  return { title: "Report", description: "", columns: [], rows: [] };
}

function renderReport(resetColumns = false) {
  currentReport = reportDefinition(document.getElementById("reportSelector").value);
  if (resetColumns || !visibleReportColumns.size)
    visibleReportColumns = new Set(currentReport.columns.map((c) => c.key));
  const columns = currentReport.columns.filter((c) => visibleReportColumns.has(c.key));
  const sortSelect = document.getElementById("reportSort");
  const currentSort = sortSelect.value;
  sortSelect.innerHTML = currentReport.columns
    .map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
    .join("");
  sortSelect.value = currentReport.columns.some((c) => c.key === currentSort)
    ? currentSort
    : currentReport.columns[0]?.key || "";
  const groupSelect = document.getElementById("reportGroup");
  const currentGroup = groupSelect.value;
  groupSelect.innerHTML =
    '<option value="">No grouping</option>' +
    currentReport.columns
      .filter((c) => c.groupable)
      .map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
      .join("");
  groupSelect.value = currentReport.columns.some((c) => c.key === currentGroup) ? currentGroup : "";
  document.getElementById("reportTitle").textContent = currentReport.title;
  document.getElementById("reportDescription").textContent = currentReport.description;
  document.getElementById("reportGenerated").textContent = `Generated: ${new Date().toLocaleString("en-GB")}`;
  const labels = appliedFilterLabels();
  document.getElementById("reportAppliedFilters").textContent =
    `Applied filters: ${labels.length ? labels.join("; ") : "None"}`;
  const gap = document.getElementById("reportGap");
  gap.textContent = currentReport.gap || "";
  gap.style.display = currentReport.gap ? "block" : "none";
  document.getElementById("columnOptions").innerHTML = currentReport.columns
    .map(
      (c) =>
        `<label class="column-option"><input type="checkbox" value="${escapeHtml(c.key)}" ${visibleReportColumns.has(c.key) ? "checked" : ""}>${escapeHtml(c.label)}</label>`
    )
    .join("");
  document.querySelectorAll("#columnOptions input").forEach((box) =>
    box.addEventListener("change", () => {
      if (box.checked) visibleReportColumns.add(box.value);
      else visibleReportColumns.delete(box.value);
      renderReport(false);
    })
  );
  const direction = document.getElementById("reportSortDirection").value;
  const sortKey = sortSelect.value;
  const rows = [...currentReport.rows].sort(
    (a, b) =>
      String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""), undefined, { numeric: true }) *
      (direction === "desc" ? -1 : 1)
  );
  const groupKey = groupSelect.value;
  document.getElementById("reportTableHead").innerHTML =
    `<tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  let body = "",
    lastGroup = Symbol("none");
  rows.forEach((row) => {
    if (groupKey && row[groupKey] !== lastGroup) {
      lastGroup = row[groupKey];
      body += `<tr class="group-row"><td colspan="${columns.length}">${escapeHtml(row[groupKey] || "Not set")}</td></tr>`;
    }
    body += `<tr>${columns.map((c) => `<td>${c.format(row[c.key], row)}</td>`).join("")}</tr>`;
  });
  document.getElementById("reportTableBody").innerHTML = body;
  const empty = document.getElementById("reportEmpty");
  empty.textContent =
    reportEmptyMessages[document.getElementById("reportSelector").value] ||
    "No information matches the selected filters.";
  empty.style.display = rows.length ? "none" : "block";
}

function applyPaneState() {
  document.querySelectorAll(".pane").forEach((p) => (p.hidden = p.id !== activePane));
  document.querySelectorAll(".tab-button").forEach((button) => {
    const active = button.dataset.pane === activePane;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}
function saveSessionState() {
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        filters: selectedFilterValues(),
        activePane,
        activeMetric,
        report: document.getElementById("reportSelector").value,
        personalUser: document.getElementById("personalUserSelect").value,
        projectDashboard: document.getElementById("projectDashboardSelect").value
      })
    );
  } catch (error) {
    console.warn("Report view state could not be retained.", error);
  }
}
function restoreSessionState() {
  const state = parseJsonFromSession(SESSION_STORAGE_KEY, {});
  Object.entries(state.filters || {}).forEach(([key, value]) =>
    applyStoredSelectValue(document.getElementById(key), value)
  );
  if (
    document
      .getElementById("reportSelector")
      .querySelector(`option[value="${CSS.escape(state.report || "")}"]`)
  )
    document.getElementById("reportSelector").value = state.report;
  if (
    document
      .getElementById("personalUserSelect")
      .querySelector(`option[value="${CSS.escape(state.personalUser || "")}"]`)
  )
    document.getElementById("personalUserSelect").value = state.personalUser;
  if (
    document
      .getElementById("projectDashboardSelect")
      .querySelector(`option[value="${CSS.escape(state.projectDashboard || "")}"]`)
  )
    document.getElementById("projectDashboardSelect").value = state.projectDashboard;
  activePane = document.getElementById(state.activePane) ? state.activePane : "portfolioPane";
  activeMetric = state.activeMetric || null;
  applyPaneState();
}
function parseJsonFromSession(key, fallback) {
  const value = sessionStorage.getItem(key);
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}
function switchPane(paneId) {
  activePane = paneId;
  applyPaneState();
  renderAll();
}
function renderAll() {
  updateFilterSummary();
  renderPortfolio();
  renderPersonal();
  renderProjectDashboard();
  renderReport(false);
  saveSessionState();
}
function showMessage(text, type) {
  const el = document.getElementById("pageMessage");
  el.textContent = text;
  el.className = `message ${type}`;
}
function clearFilters() {
  filterIds.forEach((id) => {
    const field = document.getElementById(id);
    field.value = id === "projectSort" ? "name" : id === "includeArchived" ? "no" : "";
  });
  activeMetric = null;
  renderAll();
}
function clickMetric(metricId) {
  activeMetric = metricId;
  renderPortfolio();
  saveSessionState();
  document
    .getElementById("portfolioProjectRows")
    .closest(".panel")
    .scrollIntoView({ behavior: "smooth", block: "start" });
}

function getSavedViews() {
  const views = parseJson(VIEW_STORAGE_KEY, []);
  return Array.isArray(views) ? views : [];
}
function populateSavedViews(selectedId = "") {
  const selector = document.getElementById("savedViewSelector");
  selector.innerHTML =
    '<option value="">Current unsaved view</option>' +
    getSavedViews()
      .sort(
        (a, b) =>
          (a.scope === "shared" ? -1 : 1) - (b.scope === "shared" ? -1 : 1) ||
          String(a.name).localeCompare(String(b.name))
      )
      .map(
        (v) =>
          `<option value="${escapeHtml(v.viewId)}">${v.scope === "shared" ? "[Shared] " : ""}${escapeHtml(v.name)}</option>`
      )
      .join("");
  selector.value = selectedId;
  document.getElementById("deleteViewButton").disabled = !selectedId;
}
function saveView() {
  const name = document.getElementById("savedViewName").value.trim();
  if (!name) {
    showMessage("Enter a name for this view.", "error");
    return;
  }
  const views = getSavedViews(),
    selected = document.getElementById("savedViewSelector").value,
    scope = document.getElementById("savedViewScope").value,
    now = new Date().toISOString();
  const view = {
    viewId: selected || `REPORT-VIEW-${Date.now()}`,
    name,
    scope,
    filters: selectedFilterValues(),
    activePane,
    report: document.getElementById("reportSelector").value,
    group: document.getElementById("reportGroup").value,
    sort: document.getElementById("reportSort").value,
    direction: document.getElementById("reportSortDirection").value,
    columns: [...visibleReportColumns],
    personalUser: document.getElementById("personalUserSelect").value,
    projectDashboard: document.getElementById("projectDashboardSelect").value,
    publishedBy: scope === "shared" ? "Current user" : "",
    publishedAt: scope === "shared" ? now : "",
    updatedAt: now
  };
  const index = views.findIndex((v) => v.viewId === view.viewId);
  if (index >= 0) views[index] = view;
  else views.push(view);
  localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(views));
  populateSavedViews(view.viewId);
  showMessage(
    `${name} was ${scope === "shared" ? "published as a shared view" : "saved as a personal view"}. Filters, sorting, visible columns and grouping were retained.`,
    "success"
  );
}
function loadView(id) {
  const view = getSavedViews().find((v) => v.viewId === id);
  document.getElementById("deleteViewButton").disabled = !view;
  if (!view) return;
  Object.entries(view.filters || {}).forEach(([key, value]) =>
    applyStoredSelectValue(document.getElementById(key), value)
  );
  document.getElementById("reportSelector").value = view.report || "portfolio-status";
  document.getElementById("personalUserSelect").value = view.personalUser || "";
  document.getElementById("projectDashboardSelect").value = view.projectDashboard || "";
  document.getElementById("savedViewScope").value = view.scope || "personal";
  visibleReportColumns = new Set(view.columns || []);
  switchPane(view.activePane || "portfolioPane");
  document.getElementById("reportGroup").value = view.group || "";
  document.getElementById("reportSort").value = view.sort || "";
  document.getElementById("reportSortDirection").value = view.direction || "asc";
  document.getElementById("savedViewName").value = view.name;
  renderAll();
}
function deleteView() {
  const id = document.getElementById("savedViewSelector").value;
  if (!id) return;
  const views = getSavedViews(),
    view = views.find((v) => v.viewId === id);
  localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(views.filter((v) => v.viewId !== id)));
  populateSavedViews();
  document.getElementById("savedViewName").value = "";
  showMessage(`${view?.name || "View"} was deleted.`, "success");
}

function exportRows() {
  const columns = currentReport.columns.filter((c) => visibleReportColumns.has(c.key));
  const sortKey = document.getElementById("reportSort").value;
  const direction = document.getElementById("reportSortDirection").value === "desc" ? -1 : 1;
  const rows = [...currentReport.rows].sort(
    (a, b) =>
      String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""), undefined, { numeric: true }) *
      direction
  );
  return { columns, rows };
}
function csvCell(value) {
  return `"${String(value ?? "")
    .replaceAll('"', '""')
    .replace(/<[^>]*>/g, "")}"`;
}
function download(content, type, fileName) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function exportCsv() {
  const { columns, rows } = exportRows(),
    meta = [
      `Classification,Internal`,
      `Generated,${new Date().toLocaleString("en-GB")}`,
      `Applied filters,${appliedFilterLabels().join("; ") || "None"}`,
      ""
    ];
  const lines = [
    ...meta,
    columns.map((c) => csvCell(c.label)).join(","),
    ...rows.map((row) => columns.map((c) => csvCell(String(row[c.key] ?? ""))).join(","))
  ];
  download(
    "\ufeff" + lines.join("\r\n"),
    "text/csv;charset=utf-8",
    `${document.getElementById("reportSelector").value}-${todayIso()}.csv`
  );
}
function exportExcel() {
  const { columns, rows } = exportRows();
  const table = `<table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(row[c.key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const html = `<html><head><meta charset="UTF-8"></head><body><h2>${escapeHtml(currentReport.title)}</h2><p>Classification: Internal<br>Generated: ${escapeHtml(new Date().toLocaleString("en-GB"))}<br>Applied filters: ${escapeHtml(appliedFilterLabels().join("; ") || "None")}</p>${table}</body></html>`;
  download(
    html,
    "application/vnd.ms-excel",
    `${document.getElementById("reportSelector").value}-${todayIso()}.xls`
  );
}
function officePackHtml(mode) {
  const { columns, rows } = exportRows();
  const chunks =
    mode === "PowerPoint"
      ? Array.from({ length: Math.max(1, Math.ceil(rows.length / 8)) }, (_, i) =>
          rows.slice(i * 8, i * 8 + 8)
        )
      : [rows];
  const tables = chunks
    .map(
      (chunk, index) =>
        `<section class="page"><h1>${escapeHtml(currentReport.title)}${chunks.length > 1 ? ` - ${index + 1} of ${chunks.length}` : ""}</h1><p>${escapeHtml(currentReport.description)}</p><table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead><tbody>${chunk.map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(String(row[c.key] ?? "").replace(/<[^>]*>/g, ""))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}">${escapeHtml(reportEmptyMessages[document.getElementById("reportSelector").value] || "No information matches the selected filters.")}</td></tr>`}</tbody></table><footer>Classification: Internal | Generated: ${escapeHtml(new Date().toLocaleString("en-GB"))} | Filters: ${escapeHtml(appliedFilterLabels().join("; ") || "None")}</footer></section>`
    )
    .join("");
  return `<html><head><meta charset="UTF-8"></head><body>${tables}</body></html>`;
}
function exportWord() {
  download(
    officePackHtml("Word"),
    "application/msword",
    `${document.getElementById("reportSelector").value}-${todayIso()}.doc`
  );
}
function exportPowerPoint() {
  download(
    officePackHtml("PowerPoint"),
    "application/vnd.ms-powerpoint",
    `${document.getElementById("reportSelector").value}-${todayIso()}.ppt`
  );
}

/* ===================================================================== */
/*  PDF export                                                           */
/*                                                                       */
/*  Every report gets a cover page, a KPI band and styled tables through  */
/*  the shared engine in ppm-report-pdf.js. The five reports that are     */
/*  circulated most also get a hand-built layout below, with their own    */
/*  headline measures, charts and grouped sections.                       */
/* ===================================================================== */

function pdfMeta() {
  const user = typeof PPMAuth !== "undefined" ? PPMAuth.getCurrentUser() : null;
  return {
    generatedBy: user ? user.fullName || user.email : "",
    preparedFor: "Foresters Portfolio",
    classification: "Internal",
    period: reportingPeriods.find((period) => period.status === "Open")?.name || "Current position",
    filters: appliedFilterLabels()
  };
}

// Turns the on-screen report definition into plain table data for the PDF.
function pdfTableFromReport() {
  const { columns, rows } = exportRows();
  return {
    columns: columns.map((column) => ({ key: column.key, label: column.label })),
    rows,
    empty:
      reportEmptyMessages[document.getElementById("reportSelector").value] ||
      "No information matches the selected filters."
  };
}

function ragChart(rows, key, title) {
  const order = ["Green", "Amber", "Red", "Not Assessed"];
  const counts = distribution(rows, key, "Not Assessed").sort(
    (a, b) => order.indexOf(a[0]) - order.indexOf(b[0])
  );
  return {
    title,
    type: "donut",
    data: counts.map(([label, value]) => ({ label, value, tone: label.toLowerCase() }))
  };
}

function moneyTotals(rows) {
  const total = (key) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  return {
    budget: total("approvedBudget"),
    forecast: total("forecastCost"),
    actual: total("actualCost"),
    committed: total("committedCost"),
    eac: total("estimateAtCompletion"),
    variance: total("budgetVariance")
  };
}

/* ---------------------------------------------- bespoke report layouts */

const PDF_LAYOUTS = {
  "portfolio-status"(scope, codes) {
    const metrics = metricDefinitions(codes, scope);
    const pick = (id) => metrics.find((metric) => metric.id === id)?.value ?? 0;
    const attention = scope.filter((project) => ["Red", "Amber"].includes(project.overallRag));
    return {
      title: "Portfolio status report",
      subtitle: `${scope.length} project${scope.length === 1 ? "" : "s"} as at ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`,
      standfirst:
        "A single view of delivery health across the portfolio: overall and dimension RAG, schedule confidence, governance position and the projects that need management attention this period.",
      kpis: [
        { label: "Projects in scope", value: scope.length },
        { label: "Red / Amber", value: pick("redamber"), tone: pick("redamber") ? "amber" : "green" },
        { label: "Forecast slippage", value: pick("slippage"), tone: pick("slippage") ? "amber" : "green" },
        {
          label: "Overdue milestones",
          value: pick("milestones"),
          tone: pick("milestones") ? "red" : "green"
        },
        { label: "Pending gates", value: pick("gate-pending"), tone: "blue" }
      ],
      charts: [
        ragChart(scope, "overallRag", "Overall RAG distribution"),
        {
          title: "Projects by lifecycle stage",
          type: "bar",
          data: distribution(scope, "currentStage").map(([label, value]) => ({ label, value, tone: "plum" }))
        },
        {
          title: "Projects by status",
          type: "bar",
          data: distribution(scope, "projectStatus").map(([label, value]) => ({ label, value, tone: "blue" }))
        }
      ],
      sections: [
        {
          heading: "Projects requiring attention",
          intro:
            "Projects reporting a Red or Amber overall RAG, ordered with Red first. These should be the focus of the portfolio review.",
          table: {
            columns: [
              { key: "projectCode", label: "ID" },
              { key: "projectName", label: "Project" },
              { key: "projectManager", label: "Project manager" },
              { key: "currentStage", label: "Stage" },
              { key: "overallRag", label: "Overall" },
              { key: "scheduleRag", label: "Schedule" },
              { key: "financialRag", label: "Financial" },
              { key: "resourceRag", label: "Resource" },
              { key: "currentPosition", label: "Current position" }
            ],
            rows: attention.sort(
              (a, b) => (a.overallRag === "Red" ? 0 : 1) - (b.overallRag === "Red" ? 0 : 1)
            ),
            empty: "No projects are reporting a Red or Amber overall RAG."
          }
        },
        {
          heading: "Full portfolio register",
          intro:
            "Every project in the current filter, with baseline and forecast delivery dates and reported completion.",
          table: {
            columns: [
              { key: "projectCode", label: "ID" },
              { key: "projectName", label: "Project" },
              { key: "portfolio", label: "Portfolio" },
              { key: "workstream", label: "Programme" },
              { key: "projectStatus", label: "Status" },
              { key: "overallRag", label: "RAG" },
              { key: "baselineEndDate", label: "Baseline end" },
              { key: "forecastEndDate", label: "Forecast end" },
              { key: "percentageComplete", label: "%" }
            ],
            rows: scope
          }
        }
      ]
    };
  },

  "project-status"(scope, codes) {
    return {
      title: "Project status report",
      subtitle: `Delivery position for ${scope.length} project${scope.length === 1 ? "" : "s"}`,
      standfirst:
        "Reported position, dimension RAG and delivery dates for each project, together with the commentary supplied by the project manager.",
      kpis: [
        { label: "Projects", value: scope.length },
        { label: "On track", value: scope.filter((p) => p.overallRag === "Green").length, tone: "green" },
        { label: "Watch", value: scope.filter((p) => p.overallRag === "Amber").length, tone: "amber" },
        { label: "Escalate", value: scope.filter((p) => p.overallRag === "Red").length, tone: "red" },
        { label: "Stale data", value: scope.filter(projectIsStale).length, tone: "neutral" }
      ],
      charts: [ragChart(scope, "overallRag", "Overall RAG")],
      sections: [
        {
          heading: "Reported status",
          table: {
            columns: [
              { key: "projectCode", label: "ID" },
              { key: "projectName", label: "Project" },
              { key: "projectManager", label: "Manager" },
              { key: "sponsor", label: "Sponsor" },
              { key: "overallRag", label: "Overall" },
              { key: "scheduleRag", label: "Schedule" },
              { key: "scopeRag", label: "Scope" },
              { key: "financialRag", label: "Financial" },
              { key: "resourceRag", label: "Resource" },
              { key: "riskRag", label: "Risk" }
            ],
            rows: scope
          }
        },
        {
          heading: "Commentary and delivery dates",
          intro: "Current position narrative alongside the baseline and forecast delivery dates.",
          table: {
            columns: [
              { key: "projectCode", label: "ID" },
              { key: "baselineEndDate", label: "Baseline end" },
              { key: "forecastEndDate", label: "Forecast end" },
              { key: "percentageComplete", label: "%" },
              { key: "currentPosition", label: "Current position" }
            ],
            rows: scope
          }
        }
      ]
    };
  },

  exceptions(scope, codes) {
    const metrics = metricDefinitions(codes, scope);
    const exceptions = scope
      .map((project) => ({
        projectCode: project.projectCode,
        projectName: project.projectName,
        projectManager: project.projectManager || "Not assigned",
        overallRag: project.overallRag || "Not Assessed",
        warnings: projectWarnings(project).join("; ") || "None",
        count: projectExceptionCount(project, codes)
      }))
      .filter((row) => row.warnings !== "None");
    return {
      title: "Exceptions report",
      subtitle: "Items outside tolerance across the current portfolio view",
      standfirst:
        "Everything currently breaching a portfolio tolerance: schedule slippage, overdue milestones and gates, tasks behind plan, high-severity RAID and resource conflicts.",
      kpis: metrics
        .filter((metric) =>
          ["slippage", "milestones", "gate-overdue", "tasks", "raid", "resources"].includes(metric.id)
        )
        .map((metric) => ({
          label: metric.label,
          value: metric.value,
          tone: metric.value ? "red" : "green",
          note: metric.detail
        })),
      charts: [
        {
          title: "Exceptions by type",
          type: "bar",
          data: metrics
            .filter((metric) =>
              [
                "slippage",
                "milestones",
                "gate-overdue",
                "tasks",
                "raid",
                "resources",
                "reports",
                "stale"
              ].includes(metric.id)
            )
            .map((metric) => ({
              label: metric.label,
              value: metric.value,
              tone: metric.value ? "red" : "green"
            }))
        }
      ],
      sections: [
        {
          heading: "Projects with open exceptions",
          intro:
            "Each project that currently breaches at least one tolerance, with the specific warnings raised against it.",
          table: {
            columns: [
              { key: "projectCode", label: "ID" },
              { key: "projectName", label: "Project" },
              { key: "projectManager", label: "Manager" },
              { key: "overallRag", label: "RAG" },
              { key: "warnings", label: "Exceptions raised" }
            ],
            rows: exceptions,
            empty: "No projects are currently outside tolerance."
          }
        },
        {
          heading: "Overdue milestones",
          intro:
            "Milestones whose forecast has moved beyond baseline, or whose forecast finish has passed without completion.",
          table: {
            columns: [
              { key: "projectCode", label: "Project" },
              { key: "milestoneName", label: "Milestone" },
              { key: "baselineFinishDate", label: "Baseline finish" },
              { key: "forecastFinishDate", label: "Forecast finish" },
              { key: "percentageComplete", label: "%" }
            ],
            rows: milestones.filter((item) => inScope(item, codes) && milestoneStatus(item) === "Overdue"),
            empty: "No milestones are currently overdue."
          }
        },
        {
          heading: "High-severity RAID",
          intro: "Open risks and issues assessed as High or Critical, plus all open dependencies.",
          table: {
            columns: [
              { key: "projectId", label: "Project" },
              { key: "type", label: "Type" },
              { key: "title", label: "Title" },
              { key: "owner", label: "Owner" },
              { key: "status", label: "Status" },
              { key: "targetDate", label: "Target" }
            ],
            rows: raidItems.filter(
              (item) =>
                inScope(item, codes) &&
                !isClosedRaid(item) &&
                (["High", "Critical"].includes(raidSeverity(item)) || item.type === "Dependency")
            ),
            empty: "No open high-severity RAID records."
          }
        }
      ]
    };
  },

  financial(scope, codes) {
    const rows = financials.filter((item) => inScope(item, codes));
    const totals = moneyTotals(rows);
    const over = rows.filter((row) => Number(row.budgetVariance || 0) < 0);
    return {
      title: "Financial report",
      subtitle: "Budget, forecast, actual and committed cost by project",
      standfirst:
        "Consolidated cost position across the current portfolio view, with the projects carrying an adverse variance called out separately.",
      kpis: [
        { label: "Approved budget", value: formatMoney(totals.budget) },
        { label: "Forecast", value: formatMoney(totals.forecast) },
        { label: "Actual", value: formatMoney(totals.actual) },
        { label: "Estimate at completion", value: formatMoney(totals.eac) },
        {
          label: "Budget variance",
          value: formatMoney(totals.variance),
          tone: totals.variance < 0 ? "red" : "green"
        }
      ],
      charts: [ragChart(rows, "financialRag", "Financial RAG distribution")],
      sections: [
        {
          heading: "Projects with adverse variance",
          intro:
            "Projects forecasting above their approved budget. These require a funding decision or a re-forecast.",
          table: {
            columns: [
              { key: "projectCode", label: "Project" },
              { key: "financialRag", label: "RAG" },
              { key: "approvedBudget", label: "Budget" },
              { key: "forecastCost", label: "Forecast" },
              { key: "actualCost", label: "Actual" },
              { key: "budgetVariance", label: "Variance" },
              { key: "financialOwner", label: "Owner" }
            ],
            rows: over.map((row) => ({
              ...row,
              approvedBudget: formatMoney(row.approvedBudget),
              forecastCost: formatMoney(row.forecastCost),
              actualCost: formatMoney(row.actualCost),
              budgetVariance: formatMoney(row.budgetVariance)
            })),
            empty: "No projects are forecasting above their approved budget."
          }
        },
        {
          heading: "Full cost position",
          table: {
            columns: [
              { key: "projectCode", label: "Project" },
              { key: "financialRag", label: "RAG" },
              { key: "approvedBudget", label: "Budget" },
              { key: "forecastCost", label: "Forecast" },
              { key: "actualCost", label: "Actual" },
              { key: "committedCost", label: "Committed" },
              { key: "estimateAtCompletion", label: "EAC" },
              { key: "budgetVariance", label: "Variance" }
            ],
            rows: rows.map((row) => ({
              ...row,
              approvedBudget: formatMoney(row.approvedBudget),
              forecastCost: formatMoney(row.forecastCost),
              actualCost: formatMoney(row.actualCost),
              committedCost: formatMoney(row.committedCost),
              estimateAtCompletion: formatMoney(row.estimateAtCompletion),
              budgetVariance: formatMoney(row.budgetVariance)
            })),
            empty: "No financial information has been recorded for the projects in this view."
          },
          notes: "Values are reported in GBP and reflect the latest saved cost plan for each project."
        }
      ]
    };
  },

  "stage-gates"(scope, codes) {
    const gates = formalGates.filter((gate) => inScope(gate, codes)).map(formalGateReportRow);
    const pending = gates.filter((row) => row.overdue === "Pending" || row.overdue === "Overdue");
    return {
      title: "Formal stage-gate report",
      subtitle: "Governance submissions, approvers and decisions",
      standfirst:
        "Every formal gate in the current view, with its submission version, assigned approvers, recorded decision and supporting evidence.",
      kpis: [
        { label: "Gates recorded", value: gates.length },
        {
          label: "Awaiting decision",
          value: gates.filter((row) => row.overdue === "Pending").length,
          tone: "amber"
        },
        { label: "Overdue", value: gates.filter((row) => row.overdue === "Overdue").length, tone: "red" },
        {
          label: "Approved",
          value: gates.filter((row) => row.workflowStatus === "Approved").length,
          tone: "green"
        },
        {
          label: "Rejected / deferred",
          value: gates.filter((row) => ["Rejected", "Deferred"].includes(row.workflowStatus)).length,
          tone: "red"
        }
      ],
      charts: [
        {
          title: "Gates by workflow status",
          type: "bar",
          data: distribution(gates, "workflowStatus", "Draft").map(([label, value]) => ({ label, value }))
        }
      ],
      sections: [
        {
          heading: "Gates awaiting a decision",
          intro:
            "Submitted gates that have not yet reached a recorded outcome, with the scheduled meeting date.",
          table: {
            columns: [
              { key: "projectCode", label: "Project" },
              { key: "gateName", label: "Gate" },
              { key: "gateVersion", label: "Ver" },
              { key: "stageTransition", label: "Stage movement" },
              { key: "ownerAndSubmission", label: "Submitted by" },
              { key: "dueDate", label: "Meeting" },
              { key: "overdue", label: "Position" },
              { key: "approvers", label: "Approvers" }
            ],
            rows: pending,
            empty: "No gates are currently awaiting a decision."
          }
        },
        {
          heading: "Complete gate register",
          table: {
            columns: [
              { key: "projectCode", label: "Project" },
              { key: "gateName", label: "Gate" },
              { key: "gateVersion", label: "Ver" },
              { key: "workflowStatus", label: "Status" },
              { key: "routeStatus", label: "Route" },
              { key: "outcome", label: "Outcome" },
              { key: "supportingDocuments", label: "Evidence" },
              { key: "comments", label: "Comments" }
            ],
            rows: gates
          }
        }
      ]
    };
  }
};

// Any report without a bespoke layout still gets the cover page, a headline
// count and the same styled table treatment.
function genericPdfSpec() {
  const table = pdfTableFromReport();
  return {
    title: currentReport.title,
    subtitle: `${table.rows.length} row${table.rows.length === 1 ? "" : "s"} in the current view`,
    standfirst: currentReport.description || "",
    kpis: [
      { label: "Rows in this report", value: table.rows.length },
      { label: "Projects in scope", value: filteredProjects().length },
      { label: "Filters applied", value: appliedFilterLabels().length || "None" }
    ],
    sections: [{ heading: currentReport.title, table }]
  };
}

function exportPdf() {
  const button = document.getElementById("exportPdfButton");
  const original = button.textContent;
  try {
    const reportId = document.getElementById("reportSelector").value;
    const scope = filteredProjects();
    const codes = filteredProjectCodes();
    const layout = PDF_LAYOUTS[reportId];
    const spec = layout ? layout(scope, codes) : genericPdfSpec();
    spec.meta = { ...pdfMeta(), ...(spec.meta || {}) };
    button.textContent = "Building PDF...";
    button.disabled = true;
    PPMReportPdf.download(spec, reportId);
    showMessage(`${spec.title} was exported as a PDF.`, "success");
  } catch (error) {
    showMessage(error.message || "The PDF could not be generated.", "error");
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

document
  .querySelectorAll(".tab-button")
  .forEach((button) => button.addEventListener("click", () => switchPane(button.dataset.pane)));
filterIds.forEach((id) =>
  document.getElementById(id).addEventListener("change", () => {
    activeMetric = null;
    renderAll();
  })
);
document.getElementById("clearFiltersButton").addEventListener("click", clearFilters);
document.getElementById("clearMetricButton").addEventListener("click", () => {
  activeMetric = null;
  renderPortfolio();
  saveSessionState();
});
document.getElementById("portfolioMetrics").addEventListener("click", (event) => {
  const card = event.target.closest("[data-metric]");
  if (card) clickMetric(card.dataset.metric);
});
document
  .querySelectorAll("#statusChart,#ragChart,#stageChart,#workstreamChart,#portfolioChart,#programmeChart")
  .forEach((chart) =>
    chart.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      applyStoredSelectValue(document.getElementById(button.dataset.filter), button.dataset.value);
      activeMetric = null;
      renderAll();
    })
  );
document.getElementById("personalUserSelect").addEventListener("change", renderPersonal);
document.getElementById("projectDashboardSelect").addEventListener("change", renderProjectDashboard);
document.getElementById("reportSelector").addEventListener("change", () => {
  visibleReportColumns = new Set();
  renderReport(true);
});
["reportGroup", "reportSort", "reportSortDirection"].forEach((id) =>
  document.getElementById(id).addEventListener("change", () => renderReport(false))
);
document.getElementById("exportCsvButton").addEventListener("click", exportCsv);
document.getElementById("exportExcelButton").addEventListener("click", exportExcel);
document.getElementById("exportWordButton").addEventListener("click", exportWord);
document.getElementById("exportPowerPointButton").addEventListener("click", exportPowerPoint);
document.getElementById("printViewButton").addEventListener("click", () => window.print());
document.getElementById("exportPdfButton").addEventListener("click", exportPdf);
document.getElementById("saveViewButton").addEventListener("click", saveView);
document.getElementById("deleteViewButton").addEventListener("click", deleteView);
document.getElementById("savedViewSelector").addEventListener("change", function () {
  loadView(this.value);
});
document.getElementById("refreshDataButton").addEventListener("click", () => {
  loadData();
  renderAll();
  showMessage("Dashboard data is up to date.", "success");
});

loadData();
restoreSessionState();
renderAll();
