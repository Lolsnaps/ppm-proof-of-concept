"use strict";

const initialProjects = [
  {
    projectCode: "PRJ-00001",
    projectName: "Telephony Future-State Architecture",
    description:
      "Define options and a recommendation for the future telephony and customer interaction architecture.",
    projectManager: "Alex Kain",
    sponsor: "",
    projectLead: "",
    workstream: "Servicing",
    priority: "High",
    projectStatus: "Active",
    currentStage: "Discovery",
    nextStage: "Requirements and Design",
    overallRag: "Green",
    scheduleRag: "Green",
    scopeRag: "Green",
    financialRag: "Green",
    resourceRag: "Green",
    riskRag: "Green",
    deliveryConfidence: "Confident",
    baselineStartDate: "",
    baselineEndDate: "2026-10-31",
    forecastStartDate: "",
    forecastEndDate: "2026-10-31",
    targetImplementationDate: "",
    percentageComplete: 35,
    currentPosition: "Requirements workshops are underway.",
    nextSteps: "",
    highLevelScope: "",
    outOfScope: "",
    reasonForSlippage: "",
    returnToGreen: ""
  },
  {
    projectCode: "PRJ-00002",
    projectName: "Speech Analytics",
    description: "Assess and implement speech analytics capabilities.",
    projectManager: "Alex Kain",
    sponsor: "",
    projectLead: "",
    workstream: "Servicing",
    priority: "Medium",
    projectStatus: "Planned",
    currentStage: "Intake",
    nextStage: "Discovery",
    overallRag: "Not Assessed",
    scheduleRag: "Not Assessed",
    scopeRag: "Not Assessed",
    financialRag: "Not Assessed",
    resourceRag: "Not Assessed",
    riskRag: "Not Assessed",
    deliveryConfidence: "Not Assessed",
    baselineStartDate: "",
    baselineEndDate: "2026-12-18",
    forecastStartDate: "",
    forecastEndDate: "2026-12-18",
    targetImplementationDate: "",
    percentageComplete: 5,
    currentPosition: "Planning depends on the telephony architecture decision.",
    nextSteps: "",
    highLevelScope: "",
    outOfScope: "",
    reasonForSlippage: "",
    returnToGreen: ""
  },
  {
    projectCode: "PRJ-00003",
    projectName: "IRIS Live Chat Changes",
    description: "Move Live Chat from the post-login area to the pre-login journey.",
    projectManager: "Alex Kain",
    sponsor: "",
    projectLead: "",
    workstream: "Servicing",
    priority: "Medium",
    projectStatus: "Completed",
    currentStage: "Closure",
    nextStage: "",
    overallRag: "Green",
    scheduleRag: "Green",
    scopeRag: "Green",
    financialRag: "Green",
    resourceRag: "Green",
    riskRag: "Green",
    deliveryConfidence: "Confident",
    baselineStartDate: "",
    baselineEndDate: "2026-08-03",
    forecastStartDate: "",
    forecastEndDate: "2026-08-03",
    targetImplementationDate: "2026-08-03",
    percentageComplete: 100,
    currentPosition: "Implementation completed.",
    nextSteps: "",
    highLevelScope: "",
    outOfScope: "",
    reasonForSlippage: "",
    returnToGreen: ""
  }
];

const pageParameters = new URLSearchParams(window.location.search);

const projectCodeToEdit = pageParameters.get("code");

const isEditMode = Boolean(projectCodeToEdit);

const editMode = pageParameters.get("mode") || "details";

const isStatusUpdateMode = isEditMode && editMode === "status";

const ragFieldMap = {
  overall: "overallRag",
  schedule: "scheduleRag",
  scope: "scopeRag",
  financial: "financialRag",
  resource: "resourceRag",
  risk: "riskRag",
  benefit: "benefitRag",
  quality: "qualityRag",
  operationalReadiness: "operationalReadinessRag"
};

let currentCalculatedRags = {};

function ragJustificationId(key) {
  return `${key}RagOverrideJustification`;
}

function reportedRagsFromForm() {
  return Object.fromEntries(
    Object.entries(ragFieldMap).map(([key, fieldId]) => [key, readFieldValue(fieldId) || "Not Assessed"])
  );
}

function ragJustificationsFromForm() {
  return Object.fromEntries(
    Object.keys(ragFieldMap).map((key) => [key, readFieldValue(ragJustificationId(key))])
  );
}

function ragCandidate() {
  const existing = isEditMode
    ? getProjects().find(
        (item) => String(item.projectCode).toLowerCase() === String(projectCodeToEdit).toLowerCase()
      ) || {}
    : {};
  return {
    ...existing,
    projectCode: readFieldValue("projectCode"),
    highLevelScope: readFieldValue("highLevelScope"),
    costEstimate: Number(readFieldValue("costEstimate")) || 0,
    indicativeCosts: Number(readFieldValue("indicativeCosts")) || 0,
    expectedBenefits: readFieldValue("expectedBenefits"),
    benefitMeasures: readFieldValue("benefitMeasures"),
    successMeasures: readFieldValue("successMeasures"),
    defectsBlockers: readFieldValue("defectsBlockers"),
    testDatesStatus: readFieldValue("testDatesStatus"),
    operationalReadinessStatus: readFieldValue("operationalReadinessStatus")
  };
}

function ragBadgeClass(value) {
  return value === "Green" ? "green" : value === "Amber" ? "amber" : value === "Red" ? "red" : "";
}

function updateCalculatedRags() {
  currentCalculatedRags = PPMPlanning.calculateProjectRags(ragCandidate());
  Object.entries(ragFieldMap).forEach(([key, fieldId]) => {
    const calculated = currentCalculatedRags[key] || "Not Assessed";
    const reported = readFieldValue(fieldId) || "Not Assessed";
    const badge = document.getElementById(`calculated-${key}`);
    const reason = document.getElementById(ragJustificationId(key));
    if (badge) {
      badge.textContent = `Calculated: ${calculated}`;
      badge.className = `calculated-rag ${ragBadgeClass(calculated)}`;
    }
    if (reason) {
      const overridden = reported !== calculated;
      reason.classList.toggle("visible", overridden);
      reason.required = overridden;
      reason.placeholder = overridden
        ? `Explain why reported ${reported} differs from calculated ${calculated}`
        : "";
    }
  });
}

function setupRagAssessment() {
  PPMPlanning.RAG_DIMENSIONS.forEach(([key, label]) => {
    const field = document.getElementById(ragFieldMap[key]);
    if (!field) return;
    const fieldContainer = field.closest(".form-field");
    const labelElement = fieldContainer.querySelector("label");
    if (labelElement && !labelElement.dataset.ragLabelUpdated) {
      labelElement.childNodes[0].textContent = `Reported ${label} RAG `;
      labelElement.dataset.ragLabelUpdated = "true";
    }
    if (!document.getElementById(`calculated-${key}`)) {
      const badge = document.createElement("span");
      badge.id = `calculated-${key}`;
      badge.className = "calculated-rag";
      field.insertAdjacentElement("afterend", badge);
    }
    if (!document.getElementById(ragJustificationId(key))) {
      const reason = document.createElement("textarea");
      reason.id = ragJustificationId(key);
      reason.className = "rag-override-reason";
      reason.maxLength = 2000;
      fieldContainer.appendChild(reason);
    }
    field.addEventListener("change", updateCalculatedRags);
  });
}

function validateRagOverrides() {
  updateCalculatedRags();
  const reported = reportedRagsFromForm();
  const reasons = ragJustificationsFromForm();
  const missing = Object.keys(ragFieldMap).filter(
    (key) => reported[key] !== currentCalculatedRags[key] && !reasons[key]
  );
  if (!missing.length) return true;
  showMessage(
    `Add an override justification for ${missing.length} reported RAG value${missing.length === 1 ? "" : "s"} that differ from the calculated status.`,
    "error"
  );
  document.getElementById(ragJustificationId(missing[0]))?.focus();
  return false;
}

function openRagConfig() {
  const config = PPMPlanning.getRagConfig();
  Object.keys(PPMPlanning.DEFAULT_RAG_CONFIG).forEach((key) => setFieldValue(key, config[key]));
  document.getElementById("ragConfigModal").classList.add("visible");
  document.body.style.overflow = "hidden";
}

function closeRagConfig() {
  document.getElementById("ragConfigModal").classList.remove("visible");
  document.body.style.overflow = "";
}

async function saveRagConfigForm(event) {
  event.preventDefault();
  const config = Object.fromEntries(
    Object.keys(PPMPlanning.DEFAULT_RAG_CONFIG).map((key) => [key, Number(readFieldValue(key))])
  );
  if (
    config.scheduleRedToleranceDays <= config.scheduleAmberToleranceDays ||
    config.resourceRedUtilisation <= config.resourceAmberUtilisation ||
    config.financialRedVariance <= config.financialAmberVariance
  ) {
    showMessage("Each red threshold must be higher than its corresponding amber threshold.", "error");
    return;
  }
  const ragResult = await PPMPlanning.saveRagConfig(config);
  if (ragResult && ragResult.ok === false) {
    showMessage(ragResult.message, "error");
    return;
  }
  closeRagConfig();
  updateCalculatedRags();
  showMessage("RAG calculation thresholds were updated.", "success");
}

/*
  Stage 16: projects come from PPMStore, and the seed is returned rather than written.

  Persisting a hard-coded demo portfolio when storage was empty predates the database and is now
  actively wrong: hydration runs before this, so an empty read means the portfolio is genuinely
  empty or hydration was refused, and inventing projects is the last thing to do either way.
*/
function getProjects() {
  const stored = PPMStore.projects.all();
  const rows = stored.length ? stored : [...initialProjects];
  return window.PPMAdmin ? PPMAdmin.migrateLegacyProjectLifecycleAssignments(rows) : rows;
}

/* Stage 16: the one write seam. Callers must look at what comes back. */
async function saveProjects(projects) {
  if (!window.PPMStore) {
    return { ok: false, reason: "failed", message: "The data layer is not loaded on this page.", queued: false };
  }
  return window.PPMStore.projects.replaceAll(projects);
}

const projectPeopleFields = [
  ["requestor", "requestor", "Select a requestor"],
  ["projectManager", "projectManager", "Select a project manager"],
  ["sponsor", "sponsor", "Select a project sponsor"],
  ["projectLead", "projectLead", "Select a project lead"],
  ["deputyProjectManager", "deputyProjectManager", "Select a deputy project manager"],
  ["businessOwner", "businessOwner", "Select a business owner"],
  ["technicalLead", "technicalLead", "Select a technical lead"],
  ["businessAnalyst", "businessAnalyst", "Select a business analyst"],
  ["testLead", "testLead", "Select a test lead"],
  ["changeLead", "changeLead", "Select a change lead"],
  ["financeContact", "financeContact", "Select a finance contact"],
  ["complianceContact", "complianceContact", "Select a compliance contact"],
  ["benefitOwner", "benefitOwner", "Select a benefit owner"]
];

function populateProjectPeople(project = {}) {
  projectPeopleFields.forEach(([fieldId, property, blankLabel]) => {
    PPMResources.populatePersonSelect(fieldId, {
      selectedResourceId: project[`${property}ResourceId`],
      legacyName: project[property],
      blankLabel
    });
  });
}

function peopleDataFromForm() {
  return projectPeopleFields.reduce((result, [fieldId, property]) => {
    const person = PPMResources.getSelectedPerson(fieldId);
    result[property] = person.name;
    result[`${property}ResourceId`] = person.resourceId;
    result[`${property}Email`] = person.email;
    return result;
  }, {});
}

function setFieldValue(fieldId, value) {
  const field = document.getElementById(fieldId);

  if (!field) {
    return;
  }

  field.value = value === null || value === undefined ? "" : value;
}

function setWorkstreamValue(value, programmeId, portfolioId) {
  const field = document.getElementById("workstream");
  const portfolio = PPMAdmin.findPortfolio(portfolioId || readFieldValue("portfolio"));
  const programmes = PPMGovernance.getProgrammes();
  const selected = PPMGovernance.findProgramme(programmeId, value);
  const available = programmes.filter(
    (programme) =>
      programme.active !== false &&
      (!portfolio ||
        programme.portfolioId === portfolio.portfolioId ||
        (!programme.portfolioId &&
          String(programme.portfolio || "").toLowerCase() === String(portfolio.name).toLowerCase()))
  );
  field.innerHTML =
    '<option value="">Select a programme / workstream</option>' +
    available
      .map(
        (programme) =>
          `<option value="${PPMGovernance.escapeHtml(programme.programmeId)}">${PPMGovernance.escapeHtml(programme.name)}</option>`
      )
      .join("");
  if (selected && !available.some((programme) => programme.programmeId === selected.programmeId))
    field.insertAdjacentHTML(
      "beforeend",
      `<option value="${PPMGovernance.escapeHtml(selected.programmeId)}">${PPMGovernance.escapeHtml(selected.name)} (belongs to another portfolio)</option>`
    );
  if (selected) field.value = selected.programmeId;
  else if (value) {
    field.insertAdjacentHTML(
      "beforeend",
      `<option value="legacy:${PPMGovernance.escapeHtml(value)}">${PPMGovernance.escapeHtml(value)} (legacy - reassign)</option>`
    );
    field.value = `legacy:${value}`;
  }
}

function populateReferenceSelect(fieldId, category, blankLabel, selectedValue) {
  const field = document.getElementById(fieldId);
  if (!field || !window.PPMAdmin) return;
  const selected = selectedValue ?? field.value;
  const rows = PPMAdmin.getReferenceValues(category);
  field.innerHTML =
    `<option value="${blankLabel === "Not set" && fieldId === "priority" ? "Not Set" : ""}">${blankLabel}</option>` +
    rows
      .map(
        (row) =>
          `<option value="${PPMGovernance.escapeHtml(row.value)}">${PPMGovernance.escapeHtml(row.label || row.value)}</option>`
      )
      .join("");
  if (selected && ![...field.options].some((option) => option.value === selected)) {
    const legacy = document.createElement("option");
    legacy.value = selected;
    legacy.textContent = `${selected} (existing value)`;
    field.appendChild(legacy);
  }
  field.value = selected || (fieldId === "priority" ? "Not Set" : "");
}

function populatePortfolioSelect(project = {}) {
  const field = document.getElementById("portfolio");
  if (!field || !window.PPMAdmin) return;
  const rows = PPMAdmin.getPortfolios();
  const existing = PPMAdmin.findPortfolio(project.portfolioId || project.portfolio || field.value);
  field.innerHTML =
    '<option value="">Select a portfolio</option>' +
    rows
      .filter((row) => row.active !== false || row.portfolioId === existing?.portfolioId)
      .map(
        (row) =>
          `<option value="${PPMGovernance.escapeHtml(row.portfolioId)}">${PPMGovernance.escapeHtml(row.name)}${row.active === false ? " (inactive)" : ""}</option>`
      )
      .join("");
  field.value =
    existing?.portfolioId ||
    (!project.projectCode ? rows.find((row) => row.active !== false)?.portfolioId : "") ||
    "";
}

function populateLifecycleTemplateSelect(project = {}) {
  const field = document.getElementById("lifecycleTemplateId");
  if (!field || !window.PPMAdmin) return;
  const templates = PPMAdmin.getLifecycleTemplates();
  const portfolio = PPMAdmin.findPortfolio(
    project.portfolioId || project.portfolio || readFieldValue("portfolio")
  );
  const selected =
    project.lifecycleTemplateId ||
    field.value ||
    portfolio?.lifecycleTemplateId ||
    PPMAdmin.getTemplateForProject({ ...project, portfolioId: portfolio?.portfolioId || project.portfolioId })
      ?.templateId ||
    "";
  field.innerHTML =
    '<option value="">Select a lifecycle template</option>' +
    templates
      .filter((row) => row.active !== false || row.templateId === selected)
      .map(
        (row) =>
          `<option value="${PPMGovernance.escapeHtml(row.templateId)}">${PPMGovernance.escapeHtml(row.name)} · v${Number(row.version || 1)}${row.active === false ? " (retired)" : ""}</option>`
      )
      .join("");
  field.value = selected;
  const selectedTemplate = templates.find((row) => row.templateId === selected);
  setFieldValue(
    "lifecycleTemplateVersion",
    project.lifecycleTemplateVersion || selectedTemplate?.version || 1
  );
}

function selectedLifecycleTemplate() {
  const id = readFieldValue("lifecycleTemplateId");
  return PPMAdmin.getTemplateForProject({
    lifecycleTemplateId: id,
    lifecycleTemplateVersion: Number(readFieldValue("lifecycleTemplateVersion") || 1),
    projectType: readFieldValue("projectType")
  });
}

function configuredStageNames() {
  return (
    PPMAdmin.projectStages({
      lifecycleTemplateId: readFieldValue("lifecycleTemplateId"),
      lifecycleTemplateVersion: Number(readFieldValue("lifecycleTemplateVersion") || 1),
      projectType: readFieldValue("projectType")
    }) || []
  )
    .map((stage) => (typeof stage === "string" ? stage : stage.name))
    .filter(Boolean);
}

function populateLifecycleStages(project = {}) {
  const stages = configuredStageNames();
  if (!stages.length) return;
  const current = project.currentStage || readFieldValue("currentStage") || stages[0];
  const next = project.nextStage || readFieldValue("nextStage");
  const currentField = document.getElementById("currentStage");
  const nextField = document.getElementById("nextStage");
  currentField.innerHTML = stages
    .map(
      (stage) =>
        `<option value="${PPMGovernance.escapeHtml(stage)}">${PPMGovernance.escapeHtml(stage)}</option>`
    )
    .join("");
  if (!stages.includes(current))
    currentField.insertAdjacentHTML(
      "beforeend",
      `<option value="${PPMGovernance.escapeHtml(current)}">${PPMGovernance.escapeHtml(current)} (template mismatch)</option>`
    );
  currentField.value = current;
  nextField.innerHTML =
    '<option value="">Not set</option>' +
    stages
      .map(
        (stage) =>
          `<option value="${PPMGovernance.escapeHtml(stage)}">${PPMGovernance.escapeHtml(stage)}</option>`
      )
      .join("");
  nextField.value = stages.includes(next) ? next : stages[stages.indexOf(current) + 1] || "";
}

function updateStageOverrideVisibility() {
  const container = document.getElementById("stageOverrideField");
  if (!container) return;
  const original = isEditMode
    ? getProjects().find(
        (project) => String(project.projectCode).toLowerCase() === String(projectCodeToEdit).toLowerCase()
      )
    : null;
  const changed = Boolean(
    original && readFieldValue("currentStage") && readFieldValue("currentStage") !== original.currentStage
  );
  container.hidden = !changed;
  const field = document.getElementById("stageOverrideReason");
  field.required = changed && PPMAuth.can("stageGates.override", original?.projectCode);
}

function deriveNextStage() {
  const stages = configuredStageNames();
  const current = readFieldValue("currentStage");
  const index = stages.indexOf(current);
  setFieldValue("nextStage", index >= 0 ? stages[index + 1] || "" : "");
  updateStageOverrideVisibility();
}

function populateAdministrationFields(project = {}) {
  populateReferenceSelect("projectType", "projectTypes", "Not set", project.projectType);
  populateReferenceSelect("businessArea", "businessAreas", "Not set", project.businessArea);
  populateReferenceSelect(
    "confidentialityClassification",
    "confidentialityLevels",
    "Not set",
    project.confidentialityClassification
  );
  populateReferenceSelect("priority", "priorities", "Not set", project.priority || "Not Set");
  populateReferenceSelect("projectStatus", "projectStatuses", "Not set", project.projectStatus || "Proposed");
  populatePortfolioSelect(project);
  const portfolio = PPMAdmin.findPortfolio(
    project.portfolioId || project.portfolio || readFieldValue("portfolio")
  );
  populateLifecycleTemplateSelect(
    project.lifecycleTemplateId
      ? project
      : {
          ...project,
          portfolioId: portfolio?.portfolioId || "",
          lifecycleTemplateId: portfolio?.lifecycleTemplateId || ""
        }
  );
  populateLifecycleStages(project);
  setWorkstreamValue(
    project.workstream || project.programme,
    project.programmeId,
    portfolio?.portfolioId || ""
  );
}

function setSectionAvailable(sectionId, isAvailable) {
  const section = document.getElementById(sectionId);

  section.style.display = isAvailable ? "block" : "none";

  section.querySelectorAll("input, select, textarea, button").forEach((field) => {
    field.disabled = !isAvailable;
  });
}

function configureEditSections() {
  if (!isEditMode) {
    return;
  }

  setSectionAvailable("projectDetailsSection", !isStatusUpdateMode);

  setSectionAvailable("ownershipSection", !isStatusUpdateMode);
  setSectionAvailable("strategicSection", !isStatusUpdateMode);

  setSectionAvailable("lifecycleSection", isStatusUpdateMode);

  setSectionAvailable("projectStatusSection", isStatusUpdateMode);

  setSectionAvailable("lifecycleAssuranceSection", true);

  document.getElementById("cancelLink").href = `project-details.html?code=${encodeURIComponent(
    projectCodeToEdit
  )}`;
}

function generateProjectCode() {
  const projects = getProjects();

  const projectNumbers = projects.map((project) => {
    const code = String(project.projectCode || "");

    const match = code.match(/PRJ-(\d+)/i);

    return match ? Number(match[1]) : 0;
  });

  const highestNumber = projectNumbers.length > 0 ? Math.max(...projectNumbers) : 0;

  const nextNumber = highestNumber + 1;

  return `PRJ-${String(nextNumber).padStart(5, "0")}`;
}

function populateProjectCode() {
  const projectCode = generateProjectCode();

  setFieldValue("projectCode", projectCode);

  document.getElementById("projectReference").textContent = projectCode;
}

function updateRagPreview() {
  const rag = document.getElementById("overallRag").value;

  const preview = document.getElementById("ragPreview");

  preview.textContent = rag;
  preview.className = "rag-preview";

  if (rag === "Green") {
    preview.classList.add("rag-green");
  }

  if (rag === "Amber") {
    preview.classList.add("rag-amber");
  }

  if (rag === "Red") {
    preview.classList.add("rag-red");
  }
}

function projectHasSlipped() {
  const baselineEnd = document.getElementById("baselineEndDate").value;

  const forecastEnd = document.getElementById("forecastEndDate").value;

  return Boolean(baselineEnd && forecastEnd && forecastEnd > baselineEnd);
}

function checkSlippage() {
  const warning = document.getElementById("slippageWarning");

  const reason = document.getElementById("reasonForSlippage");

  const returnToGreen = document.getElementById("returnToGreen");

  const reasonMarker = document.getElementById("slippageRequiredMarker");

  const returnMarker = document.getElementById("returnToGreenRequiredMarker");

  if (projectHasSlipped()) {
    warning.classList.add("visible");

    reason.required = true;
    returnToGreen.required = true;

    reasonMarker.hidden = false;
    returnMarker.hidden = false;
  } else {
    warning.classList.remove("visible");

    reason.required = false;
    returnToGreen.required = false;

    reasonMarker.hidden = true;
    returnMarker.hidden = true;
  }
}

function showMessage(text, type) {
  const message = document.getElementById("pageMessage");

  message.textContent = text;
  message.className = `message ${type}`;

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function clearMessage() {
  const message = document.getElementById("pageMessage");

  message.textContent = "";
  message.className = "message";
}

function validateDates() {
  const baselineStart = document.getElementById("baselineStartDate").value;

  const baselineEnd = document.getElementById("baselineEndDate").value;

  const forecastStart = document.getElementById("forecastStartDate").value;

  const forecastEnd = document.getElementById("forecastEndDate").value;

  const targetImplementation = document.getElementById("targetImplementationDate").value;

  if (baselineStart && baselineEnd && baselineEnd < baselineStart) {
    showMessage("Baseline end date cannot be before baseline start date.", "error");

    return false;
  }

  if (forecastStart && forecastEnd && forecastEnd < forecastStart) {
    showMessage("Forecast end date cannot be before forecast start date.", "error");

    return false;
  }

  if (forecastStart && targetImplementation && targetImplementation < forecastStart) {
    showMessage("Target implementation date cannot be before the forecast start date.", "error");

    return false;
  }

  return true;
}

function validatePercentage() {
  const percentage = Number(document.getElementById("percentageComplete").value);

  if (Number.isNaN(percentage) || percentage < 0 || percentage > 100) {
    showMessage("Percentage complete must be between 0 and 100.", "error");

    return false;
  }

  return true;
}

function readFieldValue(fieldId) {
  const field = document.getElementById(fieldId);
  if (!field) return "";
  return typeof field.value === "string" ? field.value.trim() : field.value;
}

const lifecycleRequirements = [
  {
    level: 0,
    items: [
      ["projectName", "Project name"],
      ["requestor", "Requestor"],
      ["businessArea", "Business area"],
      ["businessProblem", "Business problem"],
      ["desiredOutcome", "Desired outcome"],
      ["highLevelScope", "High-level scope"],
      ["sponsor", "Sponsor or proposed sponsor"],
      [{ any: ["strategicDriver", "regulatoryDriver"] }, "Strategic or regulatory driver"],
      ["targetImplementationDate", "Indicative delivery date"],
      [{ id: "priority", invalid: ["", "Not Set"] }, "Initial priority"],
      ["initialResourceRequirements", "Initial resource requirements"]
    ]
  },
  {
    level: 1,
    items: [
      [{ id: "sponsorConfirmationStatus", valid: ["Confirmed"] }, "Confirmed sponsor"],
      ["projectLead", "Project lead"],
      ["projectManager", "Project manager"],
      ["strategicObjective", "Detailed objectives"],
      ["inScope", "Detailed scope"],
      ["outOfScope", "Scope exclusions"],
      ["additionalStakeholders", "Stakeholders"],
      ["assumptionsConstraints", "Assumptions and constraints"],
      ["initialRaidSummary", "Initial RAID"],
      ["indicativeCosts", "Indicative costs"],
      ["resourceDemandSummary", "Indicative resource demand"],
      ["expectedBenefits", "Initial benefits"],
      ["discoveryDeliverables", "Discovery deliverables"]
    ]
  },
  {
    level: 2,
    items: [
      [{ id: "requirementsApprovalStatus", valid: ["Approved"] }, "Approved requirements"],
      ["solutionOptions", "Solution options"],
      ["deliveryPlanSummary", "Confirmed delivery plan"],
      ["baselineStartDate", "Baseline start date"],
      ["baselineEndDate", "Baseline end date"],
      ["detailedResourceDemand", "Detailed resource demand"],
      ["costEstimate", "Cost estimate"],
      ["deliveryDependencies", "Delivery dependencies"],
      ["testApproach", "Test approach"],
      ["operationalReadinessRequirements", "Operational-readiness requirements"],
      ["implementationApproach", "Implementation approach"],
      ["benefitMeasures", "Benefit measures"]
    ]
  },
  {
    level: 3,
    items: [
      [{ id: "baselineApprovalStatus", valid: ["Approved"] }, "Approved baseline"],
      ["testDatesStatus", "Test dates and status"],
      ["defectsBlockers", "Defects or delivery blockers"],
      ["deploymentDependencies", "Deployment dependencies"],
      ["goLiveCriteria", "Go-live criteria"]
    ]
  },
  {
    level: 5,
    items: [
      ["approvedImplementationDate", "Approved implementation date"],
      [{ id: "goLiveApprovalStatus", valid: ["Approved", "Conditionally Approved"] }, "Go-live approval"],
      [{ id: "operationalReadinessStatus", valid: ["Ready"] }, "Operational-readiness status"],
      ["trainingStatus", "Training status"],
      ["communicationsStatus", "Communications status"],
      ["supportModel", "Support model"],
      ["hypercarePlan", "Hypercare plan"],
      ["rollbackPlan", "Rollback plan"],
      ["outstandingRisksIssues", "Outstanding risks and issues"]
    ]
  },
  {
    level: 7,
    items: [
      ["actualEndDate", "Actual completion date"],
      ["closureSummary", "Closure summary"],
      ["finalFinancialPosition", "Final financial position"],
      ["outstandingActions", "Outstanding actions"],
      ["benefitsHandover", "Benefits handover"],
      ["lessonsLearned", "Lessons learned"],
      [{ id: "closureApprovalStatus", valid: ["Approved"] }, "Closure approval"],
      ["archiveLocation", "Archive location"]
    ]
  }
];

function requirementFieldId(requirement) {
  if (typeof requirement === "string") return requirement;
  if (requirement && requirement.id) return requirement.id;
  if (requirement && Array.isArray(requirement.any)) return requirement.any[0];
  return "";
}

function requirementComplete(requirement) {
  if (typeof requirement === "string") return Boolean(readFieldValue(requirement));
  if (requirement.any) return requirement.any.some((fieldId) => Boolean(readFieldValue(fieldId)));
  const value = readFieldValue(requirement.id);
  if (requirement.valid) return requirement.valid.includes(value);
  if (requirement.invalid) return !requirement.invalid.includes(value);
  return Boolean(value);
}

const mandatoryFieldAliases = {
  objectives: { any: ["strategicObjective", "desiredOutcome"] },
  scope: { any: ["inScope", "highLevelScope"] },
  strategicDrivers: { any: ["strategicDriver", "regulatoryDriver"] },
  benefits: "expectedBenefits",
  solutionDesign: "solutionOptions",
  deliveryApproach: { any: ["deliveryPlanSummary", "implementationApproach"] },
  financialOwner: "financeContact",
  budget: { any: ["costEstimate", "indicativeCosts"] },
  implementationPlan: "implementationApproach",
  operationalReadiness: { any: ["operationalReadinessRequirements", "operationalReadinessStatus"] },
  closureApproval: { id: "closureApprovalStatus", valid: ["Approved"] }
};

function configuredLifecycleRequirements(stage) {
  if (!window.PPMAdmin) return null;
  const template = selectedLifecycleTemplate();
  const stages = PPMAdmin.projectStages({
    lifecycleTemplateId: template?.templateId,
    lifecycleTemplateVersion: template?.version,
    projectType: readFieldValue("projectType")
  });
  const stageIndex = stages.findIndex((item) => (typeof item === "string" ? item : item.name) === stage);
  if (!template || stageIndex < 0) return [];
  const seen = new Set();
  return stages
    .slice(0, stageIndex + 1)
    .flatMap((item) => {
      const stageName = typeof item === "string" ? item : item.name;
      return PPMAdmin.getMandatoryRulesForStage(
        stageName,
        readFieldValue("projectType") || "*",
        template.templateId,
        template.version
      );
    })
    .filter((rule) => rule.required !== false && !seen.has(rule.fieldId) && seen.add(rule.fieldId))
    .map((rule) => {
      let requirement =
        Array.isArray(rule.anyFieldIds) && rule.anyFieldIds.length
          ? { any: rule.anyFieldIds }
          : mandatoryFieldAliases[rule.fieldId] || rule.fieldId;
      if ((rule.validValues?.length || rule.invalidValues?.length) && typeof requirement === "string")
        requirement = {
          id: requirement,
          ...(rule.validValues?.length ? { valid: rule.validValues } : {}),
          ...(rule.invalidValues?.length ? { invalid: rule.invalidValues } : {})
        };
      return [requirement, rule.label || PPMAdmin.FIELD_LABELS?.[rule.fieldId] || rule.fieldId];
    });
}

function lifecycleMissingItems() {
  const stage = readFieldValue("currentStage") || "Intake";
  const projectConfiguration = {
    lifecycleTemplateId: readFieldValue("lifecycleTemplateId"),
    lifecycleTemplateVersion: Number(readFieldValue("lifecycleTemplateVersion") || 1),
    projectType: readFieldValue("projectType")
  };
  const stageLevel = PPMGovernance.stageIndex(stage, projectConfiguration);
  const missing = [];
  if (stageLevel < 0)
    missing.push({
      label: `Current stage “${stage}” is not present in the assigned lifecycle template`,
      fieldId: "currentStage"
    });
  const configured = configuredLifecycleRequirements(stage);
  const requirements =
    configured === null
      ? lifecycleRequirements.filter((group) => group.level <= stageLevel).flatMap((group) => group.items)
      : configured;
  requirements.forEach(([requirement, label]) => {
    if (!requirementComplete(requirement)) missing.push({ label, fieldId: requirementFieldId(requirement) });
  });
  if (stageLevel >= 3) {
    const projectCode = readFieldValue("projectCode");
    const tasks = PPMStore.plans.forProject(projectCode);
    const projectMilestones = PPMStore.milestones.forProject(projectCode);
    if (!tasks.length) missing.push({ label: "Detailed project-plan tasks", fieldId: "" });
    if (!projectMilestones.length) missing.push({ label: "Project milestones", fieldId: "" });
    if (tasks.length && !tasks.some((task) => task.taskOwnerResourceId || task.taskOwner))
      missing.push({ label: "Resource assignments", fieldId: "" });
  }
  return missing;
}

function updateLifecycleReadiness() {
  const stage = readFieldValue("currentStage") || "Intake";
  const stageLevel = PPMGovernance.stageIndex(stage, {
    lifecycleTemplateId: readFieldValue("lifecycleTemplateId"),
    lifecycleTemplateVersion: Number(readFieldValue("lifecycleTemplateVersion") || 1),
    projectType: readFieldValue("projectType")
  });
  document.querySelectorAll(".lifecycle-group").forEach((group) => {
    group.classList.toggle("future-stage", Number(group.dataset.stageLevel) > stageLevel);
  });
  document.querySelectorAll(".field-missing").forEach((field) => field.classList.remove("field-missing"));
  const missing = lifecycleMissingItems();
  missing.forEach((item) => {
    const field = item.fieldId ? document.getElementById(item.fieldId) : null;
    if (field) field.classList.add("field-missing");
  });
  const panel = document.getElementById("lifecycleReadiness");
  document.getElementById("lifecycleReadinessTitle").textContent = `${stage} readiness`;
  document.getElementById("lifecycleReadinessText").textContent = missing.length
    ? `${missing.length} required item${missing.length === 1 ? " is" : "s are"} still missing for this stage.`
    : "All mandatory information for this lifecycle stage is complete.";
  document.getElementById("lifecycleMissingList").innerHTML = missing
    .map((item) => `<li>${item.label}</li>`)
    .join("");
  panel.classList.toggle("ready", missing.length === 0);
  return missing;
}

function validateLifecycleStage() {
  const missing = updateLifecycleReadiness();
  if (!missing.length) return true;
  showMessage(
    `Complete the ${missing.length} lifecycle requirement${missing.length === 1 ? "" : "s"} shown below before saving this stage.`,
    "error"
  );
  document.getElementById("lifecycleReadiness").scrollIntoView({ behavior: "smooth", block: "center" });
  return false;
}

function validateStageTransition() {
  deriveNextStage();
  if (!isEditMode) return true;
  const existing = getProjects().find(
    (project) => String(project.projectCode).toLowerCase() === String(projectCodeToEdit).toLowerCase()
  );
  const proposedStage = readFieldValue("currentStage");
  if (!existing || !proposedStage || proposedStage === existing.currentStage) return true;
  const approvedGate = window.PPMStageGates?.getForProject(existing.projectCode).some(
    (gate) =>
      gate.workflowStatus === "Approved" &&
      gate.currentStage === existing.currentStage &&
      gate.proposedNextStage === proposedStage
  );
  if (approvedGate) return true;
  if (!PPMAuth.can("stageGates.override", existing.projectCode)) {
    showMessage(
      "Project stages advance through an approved formal stage gate. Open Stage Gates to submit the change for independent approval.",
      "error"
    );
    return false;
  }
  if (!readFieldValue("stageOverrideReason")) {
    showMessage(
      "Enter a stage override justification before making this exceptional lifecycle change.",
      "error"
    );
    document.getElementById("stageOverrideReason").focus();
    return false;
  }
  return true;
}

function validateProgrammePortfolioAssignment() {
  const selected = PPMGovernance.selectedProgramme("workstream");
  if (!selected.programmeId) return true;
  const programme = PPMGovernance.findProgramme(selected.programmeId, selected.name);
  const portfolio = PPMAdmin.findPortfolio(readFieldValue("portfolio"));
  const matches =
    programme &&
    portfolio &&
    (programme.portfolioId === portfolio.portfolioId ||
      (!programme.portfolioId &&
        String(programme.portfolio || "").toLowerCase() === String(portfolio.name).toLowerCase()));
  if (matches) return true;
  showMessage("Choose a programme or workstream that belongs to the selected portfolio.", "error");
  document.getElementById("workstream").focus();
  return false;
}

function createProjectFromForm() {
  const projectManager = PPMResources.getSelectedPerson("projectManager");

  const sponsor = PPMResources.getSelectedPerson("sponsor");

  const projectLead = PPMResources.getSelectedPerson("projectLead");

  const selectedProgramme = PPMGovernance.selectedProgramme("workstream");

  const selectedPortfolio = PPMAdmin.findPortfolio(readFieldValue("portfolio"));

  const lifecycleTemplate = selectedLifecycleTemplate();

  return {
    ...peopleDataFromForm(),
    projectCode: document.getElementById("projectCode").value,

    projectName: document.getElementById("projectName").value.trim(),

    description: document.getElementById("description").value.trim(),

    projectManager: projectManager.name,

    projectManagerResourceId: projectManager.resourceId,

    projectManagerEmail: projectManager.email,

    sponsor: sponsor.name,

    sponsorResourceId: sponsor.resourceId,

    sponsorEmail: sponsor.email,

    projectLead: projectLead.name,

    projectLeadResourceId: projectLead.resourceId,

    projectLeadEmail: projectLead.email,

    programmeId: selectedProgramme.programmeId,
    programme: selectedProgramme.name,
    workstream: selectedProgramme.name,

    priority: document.getElementById("priority").value,

    projectStatus: document.getElementById("projectStatus").value,

    currentStage: document.getElementById("currentStage").value,

    nextStage: document.getElementById("nextStage").value,

    overallRag: document.getElementById("overallRag").value,

    scheduleRag: document.getElementById("scheduleRag").value,

    scopeRag: document.getElementById("scopeRag").value,

    financialRag: document.getElementById("financialRag").value,

    resourceRag: document.getElementById("resourceRag").value,

    riskRag: document.getElementById("riskRag").value,

    benefitRag: readFieldValue("benefitRag"),
    qualityRag: readFieldValue("qualityRag"),
    operationalReadinessRag: readFieldValue("operationalReadinessRag"),
    calculatedRags: { ...currentCalculatedRags },
    ragOverrideJustifications: ragJustificationsFromForm(),

    deliveryConfidence: document.getElementById("deliveryConfidence").value,

    baselineStartDate: document.getElementById("baselineStartDate").value,

    baselineEndDate: document.getElementById("baselineEndDate").value,

    forecastStartDate: document.getElementById("forecastStartDate").value,

    forecastEndDate: document.getElementById("forecastEndDate").value,

    targetImplementationDate: document.getElementById("targetImplementationDate").value,

    percentageComplete: Number(document.getElementById("percentageComplete").value),

    currentPosition: document.getElementById("currentPosition").value.trim(),

    nextSteps: document.getElementById("nextSteps").value.trim(),

    highLevelScope: document.getElementById("highLevelScope").value.trim(),

    outOfScope: document.getElementById("outOfScope").value.trim(),

    reasonForSlippage: document.getElementById("reasonForSlippage").value.trim(),

    returnToGreen: document.getElementById("returnToGreen").value.trim(),

    shortName: readFieldValue("shortName"),
    formerName: readFieldValue("formerName"),
    projectType: readFieldValue("projectType"),
    projectClassification: readFieldValue("projectClassification"),
    businessArea: readFieldValue("businessArea"),
    confidentialityClassification: readFieldValue("confidentialityClassification"),
    portfolioId: selectedPortfolio?.portfolioId || "",
    portfolio: selectedPortfolio?.name || "",
    lifecycleTemplateId: lifecycleTemplate?.templateId || "",
    lifecycleTemplateVersion: Number(lifecycleTemplate?.version || 1),
    inScope: readFieldValue("inScope"),
    businessProblem: readFieldValue("businessProblem"),
    desiredOutcome: readFieldValue("desiredOutcome"),
    additionalStakeholders: readFieldValue("additionalStakeholders"),
    businessPriority: readFieldValue("businessPriority"),
    strategicDriver: readFieldValue("strategicDriver"),
    mandatoryDeliveryDate: readFieldValue("mandatoryDeliveryDate"),
    strategicObjective: readFieldValue("strategicObjective"),
    regulatoryDriver: readFieldValue("regulatoryDriver"),
    customerOutcome: readFieldValue("customerOutcome"),
    expectedBenefits: readFieldValue("expectedBenefits"),
    successMeasures: readFieldValue("successMeasures"),
    strategicDependencies: readFieldValue("strategicDependencies"),
    initialResourceRequirements: readFieldValue("initialResourceRequirements"),
    approvalStatus: readFieldValue("approvalStatus"),
    dateLogged: readFieldValue("dateLogged"),
    proposedStartDate: readFieldValue("proposedStartDate"),
    currentStageGate: readFieldValue("currentStageGate"),
    nextStageGateDate: readFieldValue("nextStageGateDate"),
    actualStartDate: readFieldValue("actualStartDate"),
    actualEndDate: readFieldValue("actualEndDate"),
    closureDate: readFieldValue("closureDate"),
    assumptionsConstraints: readFieldValue("assumptionsConstraints"),
    sponsorConfirmationStatus: readFieldValue("sponsorConfirmationStatus"),
    initialRaidSummary: readFieldValue("initialRaidSummary"),
    indicativeCosts: Number(readFieldValue("indicativeCosts")) || 0,
    resourceDemandSummary: readFieldValue("resourceDemandSummary"),
    discoveryDeliverables: readFieldValue("discoveryDeliverables"),
    requirementsApprovalStatus: readFieldValue("requirementsApprovalStatus"),
    solutionOptions: readFieldValue("solutionOptions"),
    deliveryPlanSummary: readFieldValue("deliveryPlanSummary"),
    detailedResourceDemand: readFieldValue("detailedResourceDemand"),
    costEstimate: Number(readFieldValue("costEstimate")) || 0,
    fundingSource: readFieldValue("fundingSource"),
    deliveryDependencies: readFieldValue("deliveryDependencies"),
    testApproach: readFieldValue("testApproach"),
    operationalReadinessRequirements: readFieldValue("operationalReadinessRequirements"),
    implementationApproach: readFieldValue("implementationApproach"),
    benefitMeasures: readFieldValue("benefitMeasures"),
    baselineApprovalStatus: readFieldValue("baselineApprovalStatus"),
    testDatesStatus: readFieldValue("testDatesStatus"),
    defectsBlockers: readFieldValue("defectsBlockers"),
    deploymentDependencies: readFieldValue("deploymentDependencies"),
    goLiveCriteria: readFieldValue("goLiveCriteria"),
    approvedImplementationDate: readFieldValue("approvedImplementationDate"),
    goLiveApprovalStatus: readFieldValue("goLiveApprovalStatus"),
    operationalReadinessStatus: readFieldValue("operationalReadinessStatus"),
    trainingStatus: readFieldValue("trainingStatus"),
    communicationsStatus: readFieldValue("communicationsStatus"),
    supportModel: readFieldValue("supportModel"),
    hypercarePlan: readFieldValue("hypercarePlan"),
    rollbackPlan: readFieldValue("rollbackPlan"),
    outstandingRisksIssues: readFieldValue("outstandingRisksIssues"),
    closureSummary: readFieldValue("closureSummary"),
    finalFinancialPosition: readFieldValue("finalFinancialPosition"),
    outstandingActions: readFieldValue("outstandingActions"),
    benefitsHandover: readFieldValue("benefitsHandover"),
    lessonsLearned: readFieldValue("lessonsLearned"),
    closureApprovalStatus: readFieldValue("closureApprovalStatus"),
    archiveLocation: readFieldValue("archiveLocation"),
    stageOverrideReason: readFieldValue("stageOverrideReason")
  };
}

function loadProjectForEditing() {
  if (!isEditMode) {
    populateProjectCode();
    setWorkstreamValue("", "");
    if (!readFieldValue("dateLogged")) {
      const now = new Date();
      setFieldValue(
        "dateLogged",
        new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
      );
    }
    updateRagPreview();
    updateCalculatedRags();
    checkSlippage();
    updateLifecycleReadiness();

    return;
  }

  const projects = getProjects();

  const projectBeforeAudit = isEditMode
    ? projects.find(
        (project) => String(project.projectCode).toLowerCase() === String(projectCodeToEdit).toLowerCase()
      )
    : null;

  const project = projects.find((item) => {
    return String(item.projectCode).toLowerCase() === String(projectCodeToEdit).toLowerCase();
  });

  if (!project) {
    document.getElementById("projectForm").style.display = "none";

    document.getElementById("projectReference").textContent = projectCodeToEdit;

    showMessage(
      "The selected project could not be found. Return to the Project Register and select Edit again.",
      "error"
    );

    return;
  }

  document.getElementById("pageTitle").textContent = isStatusUpdateMode
    ? "Update project status"
    : "Edit project details";

  document.getElementById("pageDescription").textContent = isStatusUpdateMode
    ? "Update the project stage, dates, health assessment and delivery commentary."
    : "Update the project ownership, scope and core information.";

  document.getElementById("saveButton").textContent = isStatusUpdateMode
    ? "Save status update"
    : "Save project details";

  document.getElementById("clearButton").style.display = "none";

  document.getElementById("projectReference").textContent = project.projectCode;

  document.getElementById("milestonesNavigation").href = `milestones.html?code=${encodeURIComponent(
    project.projectCode
  )}`;

  document.title = isStatusUpdateMode
    ? `Update ${project.projectName} status | PPM Tool`
    : `Edit ${project.projectName} | PPM Tool`;

  setFieldValue("projectCode", project.projectCode);

  setFieldValue("projectName", project.projectName);

  setFieldValue("description", project.description);

  populateProjectPeople(project);

  setWorkstreamValue(project.workstream, project.programmeId);

  setFieldValue("priority", project.priority || "Not Set");

  setFieldValue("projectStatus", project.projectStatus || "Proposed");

  setFieldValue("currentStage", project.currentStage || "Intake");

  setFieldValue("nextStage", project.nextStage);

  setFieldValue("overallRag", project.overallRag || "Not Assessed");

  setFieldValue("scheduleRag", project.scheduleRag || "Not Assessed");

  setFieldValue("scopeRag", project.scopeRag || "Not Assessed");

  setFieldValue("financialRag", project.financialRag || "Not Assessed");

  setFieldValue("resourceRag", project.resourceRag || "Not Assessed");

  setFieldValue("riskRag", project.riskRag || "Not Assessed");

  setFieldValue("benefitRag", project.benefitRag || "Not Assessed");
  setFieldValue("qualityRag", project.qualityRag || "Not Assessed");
  setFieldValue("operationalReadinessRag", project.operationalReadinessRag || "Not Assessed");

  setFieldValue("deliveryConfidence", project.deliveryConfidence || "Not Assessed");

  setFieldValue("baselineStartDate", project.baselineStartDate);

  setFieldValue("baselineEndDate", project.baselineEndDate);

  setFieldValue("forecastStartDate", project.forecastStartDate);

  setFieldValue("forecastEndDate", project.forecastEndDate);

  setFieldValue("targetImplementationDate", project.targetImplementationDate);

  setFieldValue("percentageComplete", project.percentageComplete ?? 0);

  setFieldValue("currentPosition", project.currentPosition);

  setFieldValue("nextSteps", project.nextSteps);

  setFieldValue("highLevelScope", project.highLevelScope);

  setFieldValue("outOfScope", project.outOfScope);

  setFieldValue("reasonForSlippage", project.reasonForSlippage);

  setFieldValue("returnToGreen", project.returnToGreen);

  [
    "shortName",
    "formerName",
    "projectType",
    "projectClassification",
    "businessArea",
    "confidentialityClassification",
    "portfolio",
    "inScope",
    "businessProblem",
    "desiredOutcome",
    "additionalStakeholders",
    "businessPriority",
    "strategicDriver",
    "mandatoryDeliveryDate",
    "strategicObjective",
    "regulatoryDriver",
    "customerOutcome",
    "expectedBenefits",
    "successMeasures",
    "strategicDependencies",
    "initialResourceRequirements",
    "approvalStatus",
    "dateLogged",
    "proposedStartDate",
    "currentStageGate",
    "nextStageGateDate",
    "actualStartDate",
    "actualEndDate",
    "closureDate",
    "sponsorConfirmationStatus",
    "assumptionsConstraints",
    "initialRaidSummary",
    "indicativeCosts",
    "resourceDemandSummary",
    "discoveryDeliverables",
    "requirementsApprovalStatus",
    "solutionOptions",
    "deliveryPlanSummary",
    "detailedResourceDemand",
    "costEstimate",
    "fundingSource",
    "deliveryDependencies",
    "testApproach",
    "operationalReadinessRequirements",
    "implementationApproach",
    "benefitMeasures",
    "baselineApprovalStatus",
    "testDatesStatus",
    "defectsBlockers",
    "deploymentDependencies",
    "goLiveCriteria",
    "approvedImplementationDate",
    "goLiveApprovalStatus",
    "operationalReadinessStatus",
    "trainingStatus",
    "communicationsStatus",
    "supportModel",
    "hypercarePlan",
    "rollbackPlan",
    "outstandingRisksIssues",
    "closureSummary",
    "finalFinancialPosition",
    "outstandingActions",
    "benefitsHandover",
    "lessonsLearned",
    "closureApprovalStatus",
    "archiveLocation",
    "stageOverrideReason"
  ].forEach((fieldId) => setFieldValue(fieldId, project[fieldId]));

  populateAdministrationFields(project);

  Object.entries(project.ragOverrideJustifications || {}).forEach(([key, value]) => {
    setFieldValue(ragJustificationId(key), value);
  });

  updateRagPreview();
  updateCalculatedRags();
  checkSlippage();
  updateLifecycleReadiness();
  configureEditSections();

  if (PPMGovernance.isArchived(project)) {
    document
      .querySelectorAll("#projectForm input, #projectForm select, #projectForm textarea, #projectForm button")
      .forEach((field) => {
        field.disabled = true;
      });
    document.getElementById("cancelLink").removeAttribute("aria-disabled");
    showMessage(
      "This project is archived and read-only. Reopen it from the Projects page to make changes.",
      "warning"
    );
  }
}

async function saveProject(event) {
  event.preventDefault();

  clearMessage();
  checkSlippage();

  if (isEditMode) {
    const existing = getProjects().find(
      (project) => String(project.projectCode).toLowerCase() === String(projectCodeToEdit).toLowerCase()
    );
    if (PPMGovernance.isArchived(existing)) {
      showMessage(
        "Archived projects are read-only. Reopen this project from the Projects page before editing it.",
        "error"
      );
      return;
    }
  }

  if (!isEditMode || isStatusUpdateMode) {
    if (!validateDates()) {
      return;
    }

    if (!validatePercentage()) {
      return;
    }
  }

  if (!validateProgrammePortfolioAssignment()) {
    return;
  }

  if (!validateStageTransition()) {
    return;
  }

  if (!validateLifecycleStage()) {
    return;
  }

  if ((!isEditMode || isStatusUpdateMode) && !validateRagOverrides()) {
    return;
  }

  const form = document.getElementById("projectForm");

  if (!form.checkValidity()) {
    form.reportValidity();

    showMessage("Complete all required fields before saving.", "error");

    return;
  }

  const projects = getProjects();

  const projectFromForm = createProjectFromForm();

  let savedProject = null;

  if (isEditMode) {
    const projectIndex = projects.findIndex((project) => {
      return String(project.projectCode).toLowerCase() === String(projectCodeToEdit).toLowerCase();
    });

    if (projectIndex === -1) {
      showMessage("The selected project could not be found.", "error");

      return;
    }

    const existingProject = projects[projectIndex];

    const stageChanged =
      projectFromForm.currentStage && projectFromForm.currentStage !== existingProject.currentStage;
    const stageOverrideHistory =
      stageChanged && projectFromForm.stageOverrideReason
        ? [
            ...(Array.isArray(existingProject.stageOverrideHistory)
              ? existingProject.stageOverrideHistory
              : []),
            {
              fromStage: existingProject.currentStage || "",
              toStage: projectFromForm.currentStage,
              reason: projectFromForm.stageOverrideReason,
              changedAt: new Date().toISOString(),
              changedByResourceId: PPMAuth.getCurrentUser()?.resourceId || "",
              changedBy: PPMAuth.getCurrentUser()?.fullName || PPMAuth.getCurrentUser()?.email || ""
            }
          ]
        : existingProject.stageOverrideHistory;

    projects[projectIndex] = {
      ...existingProject,
      ...projectFromForm,
      stageOverrideHistory,

      projectCode: existingProject.projectCode,

      createdAt: existingProject.createdAt || new Date().toISOString(),

      updatedAt: new Date().toISOString()
    };

    savedProject = projects[projectIndex];

    const savedResult = await saveProjects(projects);
    if (savedResult && savedResult.ok === false) {
      showMessage(savedResult.message, "error");
      return;
    }

    sessionStorage.setItem(
      "ppmSuccessMessage",
      isStatusUpdateMode
        ? `${projectFromForm.projectName} status was updated successfully.`
        : `${projectFromForm.projectName} details were updated successfully.`
    );
  } else {
    const duplicateCode = projects.some((project) => {
      return String(project.projectCode).toLowerCase() === projectFromForm.projectCode.toLowerCase();
    });

    if (duplicateCode) {
      showMessage("A project with this project code already exists.", "error");

      return;
    }

    const newProject = {
      ...projectFromForm,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    projects.push(newProject);
    savedProject = newProject;
    await saveProjects(projects);

    sessionStorage.setItem("ppmSuccessMessage", `${newProject.projectName} was added successfully.`);
  }

  if (savedProject && (!isEditMode || isStatusUpdateMode)) {
    const recorded = await PPMPlanning.recordRagHistory(
      savedProject.projectCode,
      savedProject.calculatedRags || currentCalculatedRags,
      reportedRagsFromForm(),
      ragJustificationsFromForm(),
      savedProject.projectManager || savedProject.projectManagerEmail || "Project team"
    );
    /* Stage 16: the project is already saved by this point, so a refused snapshot is reported
       as exactly that rather than implying the whole save failed. */
    if (recorded && recorded.ok === false) {
      showMessage(`The project was saved, but its RAG history entry was not recorded: ${recorded.message}`, "error");
    }
  }

  if (savedProject) {
    const auditFields = [
      "projectName",
      "shortName",
      "description",
      "projectType",
      "businessArea",
      "portfolio",
      "programmeId",
      "workstream",
      "confidentialityClassification",
      "projectStatus",
      "currentStage",
      "nextStage",
      "percentageComplete",
      "proposedStartDate",
      "forecastStartDate",
      "forecastEndDate",
      "actualStartDate",
      "actualEndDate",
      "projectManager",
      "sponsor",
      "projectLead",
      "businessOwner",
      "overallRag",
      "scheduleRag",
      "scopeRag",
      "financialRag",
      "resourceRag",
      "riskRag",
      "deliveryConfidence",
      "currentPosition",
      "nextSteps",
      "reasonForSlippage",
      "returnToGreen",
      "approvalStatus",
      "requirementsApprovalStatus",
      "baselineApprovalStatus",
      "goLiveApprovalStatus",
      "closureApprovalStatus"
    ];

    if (
      projectBeforeAudit &&
      projectBeforeAudit.currentStage !== savedProject.currentStage &&
      savedProject.stageOverrideReason
    ) {

    }
  }

  window.location.href = isEditMode
    ? `project-details.html?code=${encodeURIComponent(projectCodeToEdit)}`
    : "index.html";
}

function clearForm() {
  const confirmed = confirm("Clear all information entered on this form?");

  if (!confirmed) {
    return;
  }

  document.getElementById("projectForm").reset();

  clearMessage();
  populateProjectPeople();
  setWorkstreamValue("", "");
  populateAdministrationFields();
  populateProjectCode();
  const now = new Date();
  setFieldValue(
    "dateLogged",
    new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  );
  updateRagPreview();
  updateCalculatedRags();
  checkSlippage();
  updateLifecycleReadiness();

  document.getElementById("projectName").focus();
}

document.getElementById("projectForm").addEventListener("submit", saveProject);

document.getElementById("clearButton").addEventListener("click", clearForm);

document.getElementById("overallRag").addEventListener("change", updateRagPreview);

document.getElementById("baselineEndDate").addEventListener("change", checkSlippage);

document.getElementById("forecastEndDate").addEventListener("change", checkSlippage);

document.getElementById("currentStage").addEventListener("change", () => {
  deriveNextStage();
  updateLifecycleReadiness();
});
document.getElementById("lifecycleTemplateId").addEventListener("change", () => {
  const template = PPMAdmin.getLifecycleTemplates().find(
    (row) => row.templateId === readFieldValue("lifecycleTemplateId")
  );
  setFieldValue("lifecycleTemplateVersion", template?.version || 1);
  populateLifecycleStages();
  deriveNextStage();
  updateLifecycleReadiness();
});
document.getElementById("portfolio").addEventListener("change", () => {
  const portfolio = PPMAdmin.findPortfolio(readFieldValue("portfolio"));
  const selectedProgramme = PPMGovernance.selectedProgramme("workstream");
  const template =
    PPMAdmin.getLifecycleTemplates().find(
      (row) => row.templateId === portfolio?.lifecycleTemplateId && row.active !== false
    ) ||
    PPMAdmin.getTemplateForProject({
      portfolioId: portfolio?.portfolioId || "",
      projectType: readFieldValue("projectType")
    });
  setFieldValue("lifecycleTemplateId", template?.templateId || "");
  setFieldValue("lifecycleTemplateVersion", template?.version || 1);
  setWorkstreamValue(selectedProgramme.name, selectedProgramme.programmeId, portfolio?.portfolioId || "");
  populateLifecycleStages();
  deriveNextStage();
  updateLifecycleReadiness();
});
document.getElementById("projectType").addEventListener("change", () => {
  populateLifecycleTemplateSelect({
    projectType: readFieldValue("projectType"),
    lifecycleTemplateId: readFieldValue("lifecycleTemplateId"),
    lifecycleTemplateVersion: Number(readFieldValue("lifecycleTemplateVersion") || 1)
  });
  populateLifecycleStages();
  deriveNextStage();
  updateLifecycleReadiness();
});
document.getElementById("projectForm").addEventListener("input", updateLifecycleReadiness);
document.getElementById("projectForm").addEventListener("change", updateLifecycleReadiness);

document.getElementById("configureRagThresholds").addEventListener("click", openRagConfig);
document.getElementById("closeRagConfig").addEventListener("click", closeRagConfig);
document.getElementById("cancelRagConfig").addEventListener("click", closeRagConfig);
document.getElementById("ragConfigForm").addEventListener("submit", saveRagConfigForm);
document.getElementById("ragConfigModal").addEventListener("click", (event) => {
  if (event.target.id === "ragConfigModal") closeRagConfig();
});

[
  "baselineEndDate",
  "forecastEndDate",
  "percentageComplete",
  "highLevelScope",
  "costEstimate",
  "indicativeCosts",
  "expectedBenefits",
  "benefitMeasures",
  "successMeasures",
  "defectsBlockers",
  "testDatesStatus",
  "operationalReadinessStatus"
].forEach((id) => {
  const field = document.getElementById(id);
  if (field) {
    field.addEventListener("input", updateCalculatedRags);
    field.addEventListener("change", updateCalculatedRags);
  }
});

async function initialiseAddProjectPage() {
  if (window.PPMChildDatabase?.ready) await PPMChildDatabase.ready;
  getProjects();
  PPMGovernance.getProgrammes();
  PPMResources.ensureLegacyResources();
  populateProjectPeople();
  setWorkstreamValue("", "");
  populateAdministrationFields();
  setupRagAssessment();
  loadProjectForEditing();
  document.getElementById("nextStage").disabled = true;
  updateStageOverrideVisibility();
}

initialiseAddProjectPage().catch((error) => {
  console.error("Project editor: child database hydration did not complete cleanly; using the local copy.", error);
  getProjects();
  PPMGovernance.getProgrammes();
  PPMResources.ensureLegacyResources();
  populateProjectPeople();
  setWorkstreamValue("", "");
  populateAdministrationFields();
  setupRagAssessment();
  loadProjectForEditing();
  document.getElementById("nextStage").disabled = true;
  updateStageOverrideVisibility();
});
