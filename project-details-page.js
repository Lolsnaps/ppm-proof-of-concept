"use strict";

const pageParameters = new URLSearchParams(window.location.search);

const projectCode = pageParameters.get("code");

let project = null;
let projectDocuments = [];
let projectRaidItems = [];
let editingDocumentId = null;
let pendingDeleteDocumentId = null;

function getProjects() {
  const storedProjects = localStorage.getItem("ppmProjects");

  if (!storedProjects) {
    return [];
  }

  try {
    const projects = JSON.parse(storedProjects);

    return Array.isArray(projects) ? projects : [];
  } catch (error) {
    console.error("Projects could not be loaded.", error);

    return [];
  }
}

function getProjectPlans() {
  const storedPlans = localStorage.getItem("ppmProjectPlans");

  if (!storedPlans) {
    return {};
  }

  try {
    const plans = JSON.parse(storedPlans);

    if (plans && typeof plans === "object" && !Array.isArray(plans)) {
      return plans;
    }
  } catch (error) {
    console.error("Project plans could not be loaded.", error);
  }

  return {};
}

function getAllProjectDocuments() {
  const storedDocuments = localStorage.getItem("ppmProjectDocuments");

  if (!storedDocuments) {
    return {};
  }

  try {
    const documents = JSON.parse(storedDocuments);

    if (documents && typeof documents === "object" && !Array.isArray(documents)) {
      return documents;
    }
  } catch (error) {
    console.error("Project documents could not be loaded.", error);
  }

  return {};
}

function getAllProjectRaid() {
  const storedRaid = localStorage.getItem("ppmProjectRaid");

  if (!storedRaid) {
    return {};
  }

  try {
    const parsedRaid = JSON.parse(storedRaid);

    if (Array.isArray(parsedRaid)) {
      return parsedRaid.reduce((store, item) => {
        const itemProjectId = String(item.projectId || item.projectCode || "").trim();

        if (!itemProjectId) {
          return store;
        }

        if (!Array.isArray(store[itemProjectId])) {
          store[itemProjectId] = [];
        }

        store[itemProjectId].push({
          ...item,
          projectId: itemProjectId
        });

        return store;
      }, {});
    }

    if (parsedRaid && typeof parsedRaid === "object") {
      return parsedRaid;
    }
  } catch (error) {
    console.error("RAID items could not be loaded.", error);
  }

  return {};
}

function getProjectRaidItems(selectedProjectCode) {
  const allRaid = getAllProjectRaid();

  return Object.entries(allRaid)
    .filter((entry) => Array.isArray(entry[1]))
    .flatMap(([storedProjectId, items]) =>
      items.map((item) => ({
        ...item,
        projectId: item.projectId || item.projectCode || storedProjectId
      }))
    )
    .filter(
      (item) => String(item.projectId || "").toLowerCase() === String(selectedProjectCode || "").toLowerCase()
    );
}

async function saveProjectDocuments() {
  const allDocuments = getAllProjectDocuments();

  allDocuments[projectCode] = projectDocuments;

  if (!window.PPMStore) {
    return { ok: false, reason: "failed", message: "The data layer is not loaded on this page.", queued: false };
  }
  return window.PPMStore.documents.replaceAll(allDocuments);
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

function setText(elementId, value) {
  const element = document.getElementById(elementId);

  const hasValue = value !== null && value !== undefined && String(value).trim() !== "";

  element.textContent = hasValue ? value : "Not set";

  element.classList.toggle("not-set", !hasValue);
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "";
  }

  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function displayValue(value, type) {
  if (type === "date") return formatDate(value) || "Not set";
  if (type === "money") {
    const number = Number(value);
    return Number.isFinite(number) && number
      ? number.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 })
      : "Not set";
  }
  return value === null || value === undefined || String(value).trim() === "" ? "Not set" : String(value);
}

function extendedGroup(title, fields) {
  return `<section class="extended-section"><h4>${escapeHtml(title)}</h4><div class="detail-grid">${fields.map(([label, value, type]) => `<div class="detail-field"><div class="detail-label">${escapeHtml(label)}</div><div class="detail-value ${displayValue(value, type) === "Not set" ? "not-set" : ""}">${escapeHtml(displayValue(value, type))}</div></div>`).join("")}</div></section>`;
}

function renderExtendedProjectInformation() {
  const portfolio = PPMAdmin.findPortfolio(project.portfolioId || project.portfolio);
  const lifecycleTemplate = PPMAdmin.getTemplateForProject(project);
  const groups = [
    extendedGroup("Identification", [
      ["Short name", project.shortName],
      ["Former name or alias", project.formerName],
      ["Project type", project.projectType],
      ["Classification", project.projectClassification],
      ["Business area", project.businessArea],
      ["Confidentiality", project.confidentialityClassification],
      ["Portfolio", portfolio?.name || project.portfolio],
      ["Programme / workstream", project.programme || project.workstream]
    ]),
    extendedGroup("Governance configuration", [
      ["Portfolio ID", portfolio?.portfolioId || project.portfolioId],
      ["Lifecycle template", lifecycleTemplate?.name],
      ["Template version", project.lifecycleTemplateVersion || lifecycleTemplate?.version],
      ["Current stage", project.currentStage],
      ["Derived next stage", project.nextStage],
      ["Reporting calendar", portfolio?.reportingCalendarId]
    ]),
    extendedGroup("Delivery ownership", [
      ["Requestor", project.requestor],
      ["Deputy project manager", project.deputyProjectManager],
      ["Business owner", project.businessOwner],
      ["Technical lead", project.technicalLead],
      ["Business analyst", project.businessAnalyst],
      ["Test lead", project.testLead],
      ["Change / readiness lead", project.changeLead],
      ["Finance contact", project.financeContact],
      ["Compliance contact", project.complianceContact],
      ["Additional stakeholders", project.additionalStakeholders]
    ]),
    extendedGroup("Strategic information", [
      ["Strategic objective", project.strategicObjective],
      ["Business priority", project.businessPriority],
      ["Strategic / regulatory driver", project.strategicDriver || project.regulatoryDriver],
      ["Mandatory delivery date", project.mandatoryDeliveryDate, "date"],
      ["Customer outcome", project.customerOutcome],
      ["Expected benefits", project.expectedBenefits],
      ["Benefit owner", project.benefitOwner],
      ["Success measures", project.successMeasures],
      ["Strategic dependencies", project.strategicDependencies]
    ]),
    extendedGroup("Approval and actual dates", [
      ["Approval status", project.approvalStatus],
      ["Date logged", project.dateLogged, "date"],
      ["Proposed start", project.proposedStartDate, "date"],
      ["Actual start", project.actualStartDate, "date"],
      ["Actual completion", project.actualEndDate, "date"],
      ["Closure date", project.closureDate, "date"],
      ["Current stage gate", project.currentStageGate],
      ["Next stage-gate date", project.nextStageGateDate, "date"]
    ]),
    extendedGroup("Lifecycle evidence", [
      ["Sponsor confirmation", project.sponsorConfirmationStatus],
      ["Assumptions and constraints", project.assumptionsConstraints],
      ["Initial RAID", project.initialRaidSummary],
      ["Indicative costs", project.indicativeCosts, "money"],
      ["Resource demand", project.resourceDemandSummary || project.detailedResourceDemand],
      ["Requirements approval", project.requirementsApprovalStatus],
      ["Solution options", project.solutionOptions],
      ["Cost estimate", project.costEstimate, "money"],
      ["Funding source", project.fundingSource],
      ["Baseline approval", project.baselineApprovalStatus],
      ["Test status", project.testDatesStatus],
      ["Go-live approval", project.goLiveApprovalStatus],
      ["Operational readiness", project.operationalReadinessStatus],
      ["Closure approval", project.closureApprovalStatus]
    ])
  ];
  document.getElementById("extendedProjectInformation").innerHTML = groups.join("");
}

const readinessRequirements = [
  {
    level: 0,
    items: [
      ["projectName", "Project name"],
      ["requestor", "Requestor"],
      ["businessArea", "Business area"],
      ["businessProblem", "Business problem"],
      ["desiredOutcome", "Desired outcome"],
      ["highLevelScope", "High-level scope"],
      ["sponsor", "Sponsor"],
      ["strategicDriver", "Strategic or regulatory driver"],
      ["targetImplementationDate", "Indicative delivery date"],
      ["priority", "Initial priority"],
      ["initialResourceRequirements", "Initial resource requirements"]
    ]
  },
  {
    level: 1,
    items: [
      ["sponsorConfirmationStatus", "Confirmed sponsor"],
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
      ["requirementsApprovalStatus", "Approved requirements"],
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
      ["baselineApprovalStatus", "Approved baseline"],
      ["testDatesStatus", "Test dates and status"],
      ["defectsBlockers", "Defects or blockers"],
      ["deploymentDependencies", "Deployment dependencies"],
      ["goLiveCriteria", "Go-live criteria"]
    ]
  },
  {
    level: 5,
    items: [
      ["approvedImplementationDate", "Approved implementation date"],
      ["goLiveApprovalStatus", "Go-live approval"],
      ["operationalReadinessStatus", "Operational readiness"],
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
      ["closureApprovalStatus", "Closure approval"],
      ["archiveLocation", "Archive location"]
    ]
  }
];

function renderLifecycleReadiness() {
  const evaluation = PPMAdmin.evaluateProjectStage(project, project.currentStage, { includeRelated: true });
  const missing = (evaluation.missing || []).map((item) => item.label || item.fieldId);
  const container = document.getElementById("lifecycleReadinessDetail");
  container.innerHTML = missing.length
    ? `<p><strong>${escapeHtml(project.currentStage || "Intake")}:</strong> ${missing.length} mandatory item${missing.length === 1 ? " is" : "s are"} incomplete.</p><ul class="readiness-list">${missing.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<div class="readiness-complete">All mandatory information for ${escapeHtml(project.currentStage || "Intake")} is complete.</div>`;
}

function renderStageGateSummary() {
  const gates = PPMStageGates.getForProject(project.projectCode)
    .slice()
    .sort((a, b) =>
      String(b.updatedAt || b.submittedAt || "").localeCompare(String(a.updatedAt || a.submittedAt || ""))
    );
  const container = document.getElementById("stageGateSummary");
  if (!gates.length) {
    container.innerHTML =
      '<div class="empty-message">No formal stage-gate records have been created for this project.</div>';
    return;
  }
  const latest = gates[0];
  const approvers =
    (latest.requiredApprovers || [])
      .map(
        (approver) =>
          `${approver.name || approver.email || "Unassigned"}${approver.decision ? ` · ${approver.decision}` : ""}`
      )
      .join("; ") || "Not assigned";
  const rows = gates
    .slice(0, 5)
    .map(
      (gate) =>
        `<tr><td><a href="stage-gates.html?code=${encodeURIComponent(project.projectCode)}&item=${encodeURIComponent(gate.gateId)}">${escapeHtml(gate.gateId)} · v${Number(gate.revision || gate.version || 1)}</a></td>
<td>${escapeHtml(gate.gateName)}</td>
<td>${escapeHtml(gate.currentStage)} → ${escapeHtml(gate.proposedNextStage || "No progression")}</td>
<td>${escapeHtml(gate.workflowStatus)}</td>
<td>${escapeHtml(formatDate(gate.decisionDate || gate.meetingDate) || "Not set")}</td></tr>`
    )
    .join("");
  container.innerHTML = `<div class="detail-grid"><div class="detail-field"><div class="detail-label">Latest gate</div><div class="detail-value">${escapeHtml(latest.gateName)} · v${Number(latest.revision || latest.version || 1)}</div></div><div class="detail-field"><div class="detail-label">Workflow status</div><div class="detail-value">${escapeHtml(latest.workflowStatus)}</div></div><div class="detail-field"><div class="detail-label">Proposed stage</div><div class="detail-value">${escapeHtml(latest.proposedNextStage || "No progression")}</div></div><div class="detail-field"><div class="detail-label">Required approvers</div><div class="detail-value">${escapeHtml(approvers)}</div></div></div><div class="history-table-wrap"><table class="history-table"><thead><tr><th>Gate ID / version</th>
<th>Gate</th>
<th>Transition</th>
<th>Status</th>
<th>Decision / meeting</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function getRagClass(rag) {
  if (rag === "Green") {
    return "rag-green";
  }

  if (rag === "Amber") {
    return "rag-amber";
  }

  if (rag === "Red") {
    return "rag-red";
  }

  return "";
}

function renderRagHistory() {
  const container = document.getElementById("ragHistory");
  const history = PPMPlanning.getRagHistory(project.projectCode).slice().reverse();
  if (!history.length) {
    container.innerHTML =
      '<div class="history-empty">No project status updates have been recorded yet. Use <strong>Update project status</strong> to create the first calculated and reported RAG snapshot.</div>';
    return;
  }
  const rows = history
    .flatMap((entry) =>
      PPMPlanning.RAG_DIMENSIONS.map(([key, label]) => {
        const detail = (entry.dimensions && entry.dimensions[key]) || {};
        const date = entry.recordedAt
          ? new Date(entry.recordedAt).toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            })
          : "Not recorded";
        return `<tr><td>${escapeHtml(date)}</td>
<td>${escapeHtml(label)}</td>
<td><span class="rag ${getRagClass(detail.calculated)}">${escapeHtml(detail.calculated || "Not Assessed")}</span></td>
<td><span class="rag ${getRagClass(detail.reported)}">${escapeHtml(detail.reported || "Not Assessed")}</span></td>
<td>${detail.override ? "<strong>Override</strong>" : "Aligned"}</td>
<td>${escapeHtml(detail.justification || (detail.override ? "Justification not recorded" : "—"))}</td>
<td>${escapeHtml(entry.recordedBy || "Project team")}</td></tr>`;
      })
    )
    .join("");
  container.innerHTML = `<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Recorded</th>
<th>Dimension</th>
<th>Calculated</th>
<th>Reported</th>
<th>Assessment</th>
<th>Justification</th>
<th>Recorded by</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function loadProject() {
  if (!projectCode) {
    showMessage("No project was selected. Return to the Project Register and select a project.", "error");

    disableProjectPage();
    return;
  }

  const projects = getProjects();

  project = projects.find((item) => {
    return String(item.projectCode).toLowerCase() === String(projectCode).toLowerCase();
  });

  if (!project) {
    showMessage("The selected project could not be found.", "error");

    disableProjectPage();
    return;
  }

  const allDocuments = getAllProjectDocuments();

  projectDocuments = Array.isArray(allDocuments[projectCode]) ? allDocuments[projectCode] : [];

  projectRaidItems = getProjectRaidItems(projectCode);

  /*
    Each render step is independent, so one failing does not take the rest of the page with
    it - and, more to the point, does not take the buttons with it.

    This used to be a plain sequence with configureProjectLinks() seventh in the list. Any
    error in the six calls before it meant nothing after it ran, so every button on the page
    silently stopped working while the page still looked fine. The step that failed is named
    rather than swallowed.
  */
  [
    ["project details", populateProjectDetails],
    ["extended information", renderExtendedProjectInformation],
    ["lifecycle readiness", renderLifecycleReadiness],
    ["stage gate summary", renderStageGateSummary],
    ["RAG history", renderRagHistory],
    ["links and editors", configureProjectLinks],
    ["plan summary", updatePlanSummary],
    ["milestone summary", updateMilestoneSummary],
    ["RAID items", renderRaidItems],
    ["documents", renderDocuments],
    ["archive mode", applyArchiveMode]
  ].forEach(([what, step]) => {
    try {
      step();
    } catch (error) {
      console.error(`Project details: the ${what} section failed to render.`, error);
      showMessage(`The ${what} section could not be shown: ${error?.message || error}`, "error");
    }
  });
}

function projectIsArchived() {
  return Boolean(project && PPMGovernance.isArchived(project));
}

function applyArchiveMode() {
  if (!projectIsArchived()) {
    return;
  }

  const notice = document.getElementById("archivedNotice");
  const archivedDate = project.archivedAt
    ? new Date(project.archivedAt).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      })
    : "an earlier date";

  notice.hidden = false;
  document.getElementById("archivedNoticeText").textContent =
    `Archived on ${archivedDate}. Reason: ${project.archiveReason || project.archivedReason || "Not recorded"}. Reopen it from the Project Register to make changes.`;

  document.getElementById("editProjectButton").style.display = "none";
  document.getElementById("updateStatusButton").style.display = "none";
  document.getElementById("addDocumentButton").style.display = "none";

  const raidButton = document.getElementById("manageRaidButton");
  raidButton.textContent = "View RAID";
  document.getElementById("manageStageGatesButton").textContent = "View stage gates";

  document
    .querySelectorAll(".edit-document-button, .delete-document-button")
    .forEach((button) => (button.style.display = "none"));
}

function disableProjectPage() {
  document.getElementById("editProjectButton").style.display = "none";

  document.getElementById("updateStatusButton").style.display = "none";

  document.getElementById("addDocumentButton").disabled = true;

  document.getElementById("manageRaidButton").style.display = "none";
}

/*
  Renders the calculated RAG assessment at the foot of the page: what the
  evidence suggests for each dimension, alongside what was reported, with any
  difference called out. Reported status stays at the top of the page because
  that is what the project manager is accountable for.
*/
function renderCalculatedRags(ragDimensions, calculatedRags) {
  const overall = document.getElementById("summaryCalculatedRag");
  if (overall) {
    overall.textContent = calculatedRags.overall || "Not Assessed";
    overall.className = `rag ${getRagClass(calculatedRags.overall)}`;
  }

  const container = document.getElementById("calculatedRagDetail");
  if (!container) return;

  const rows = ragDimensions.map(([label, , reportedValue, calculatedValue]) => {
    const reported = reportedValue || "Not Assessed";
    const calculated = calculatedValue || "Not Assessed";
    const differs = reported !== calculated && calculatedValue;
    return `<tr${differs ? ' class="rag-variance"' : ""}>
        <td>${escapeHtml(label)}</td>
        <td><span class="rag ${getRagClass(reported)}">${escapeHtml(reported)}</span></td>
        <td><span class="rag ${getRagClass(calculated)}">${escapeHtml(calculated)}</span></td>
        <td>${differs ? "Reported status differs from the evidence" : "Consistent"}</td>
      </tr>`;
  });

  const variances = ragDimensions.filter(
    ([, , reportedValue, calculatedValue]) =>
      calculatedValue && (reportedValue || "Not Assessed") !== calculatedValue
  ).length;

  container.innerHTML = `${
    variances
      ? `<div class="variance-note">${variances} dimension${variances === 1 ? "" : "s"} differ${variances === 1 ? "s" : ""} from the calculated assessment. Differences should carry a recorded explanation.</div>`
      : '<div class="variance-note consistent">Reported status matches the calculated assessment across every dimension.</div>'
  }
    <table class="calculated-rag-table">
      <thead><tr><th>Dimension</th><th>Reported</th><th>Calculated</th><th>Position</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
}

/*
  Lets any section on this page be minimised. Each <section data-collapsible="id">
  gets a toggle on its heading; the open or closed state is remembered per person
  so the page opens the way they left it.
*/
const SECTION_STATE_KEY = "ppmProjectDetailSections";

function readSectionState() {
  const stored = PPMCore.readJson(SECTION_STATE_KEY, {});
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

function writeSectionState(state) {
  localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(state));
}

function setSectionOpen(section, open, remember) {
  section.classList.toggle("collapsed", !open);
  const toggle = section.querySelector(".panel-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", String(open));
  if (!remember) return;
  const state = readSectionState();
  state[section.dataset.collapsible] = open ? "open" : "closed";
  writeSectionState(state);
}

function initCollapsibleSections() {
  const state = readSectionState();

  document.querySelectorAll("section[data-collapsible]").forEach((section) => {
    const heading = section.querySelector(".panel-heading");
    const text = heading && heading.querySelector("div");
    if (!heading || !text || heading.querySelector(".panel-toggle")) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "panel-toggle";
    // Minimising a section changes nothing about the data.
    toggle.dataset.permission = "none";
    toggle.innerHTML = '<span class="panel-caret" aria-hidden="true"></span>';
    heading.insertBefore(toggle, heading.firstChild);
    toggle.appendChild(text);

    // Some panel bodies already carry an id the page script writes into
    // (calculatedRagDetail, lifecycleReadinessDetail, stageGateSummary), so
    // only name the ones that do not.
    const body = section.querySelector(".panel-body");
    if (body) {
      if (!body.id) body.id = `${section.dataset.collapsible}-body`;
      toggle.setAttribute("aria-controls", body.id);
    }

    const remembered = state[section.dataset.collapsible];
    const open = remembered ? remembered === "open" : section.dataset.default !== "closed";
    setSectionOpen(section, open, false);

    toggle.addEventListener("click", () => {
      setSectionOpen(section, section.classList.contains("collapsed"), true);
    });
  });

  const setAll = (open) =>
    document
      .querySelectorAll("section[data-collapsible]")
      .forEach((section) => setSectionOpen(section, open, true));

  document.getElementById("expandAllSections")?.addEventListener("click", () => setAll(true));
  document.getElementById("collapseAllSections")?.addEventListener("click", () => setAll(false));
}

function populateProjectDetails() {
  document.title = `${project.projectName} | PPM Tool`;

  /* The heading is #projectHeading, not #projectName: this page hosts the project form,
     whose project-name input owns that id. Two elements sharing one id means
     getElementById returns whichever comes first in the document, and one of the two
     readers silently gets the wrong element. */
  document.getElementById("projectHeading").textContent = project.projectName;

  document.getElementById("projectReference").textContent =
    `${project.projectCode} · ${project.programme || project.workstream || "No programme / workstream"}`;

  setText("summaryStatus", project.projectStatus);

  setText("summaryStage", project.currentStage);

  setText("summaryPercentage", `${Number(project.percentageComplete || 0)}%`);

  const ragElement = document.getElementById("summaryRag");

  ragElement.textContent = project.overallRag || "Not Assessed";

  ragElement.className = `rag ${getRagClass(project.overallRag)}`;

  const calculatedRags = project.calculatedRags || PPMPlanning.calculateProjectRags(project);

  // Dimension, reported value, calculated value. The reported values sit near the
  // top of the page; the calculated comparison is rendered at the bottom.
  const ragDimensions = [
    ["Schedule", "summaryScheduleRag", project.scheduleRag, calculatedRags.schedule],
    ["Scope", "summaryScopeRag", project.scopeRag, calculatedRags.scope],
    ["Financial", "summaryFinancialRag", project.financialRag, calculatedRags.financial],
    ["Resources", "summaryResourceRag", project.resourceRag, calculatedRags.resource],
    ["Risk", "summaryRiskRag", project.riskRag, calculatedRags.risk],
    ["Benefits", "summaryBenefitRag", project.benefitRag, calculatedRags.benefit],
    ["Quality", "summaryQualityRag", project.qualityRag, calculatedRags.quality],
    [
      "Operational readiness",
      "summaryOperationalReadinessRag",
      project.operationalReadinessRag,
      calculatedRags.operationalReadiness
    ]
  ];

  ragDimensions.forEach(([, elementId, ragValue]) => {
    const element = document.getElementById(elementId);
    const value = ragValue || "Not Assessed";
    element.textContent = value;
    element.className = `rag ${getRagClass(value)}`;
  });

  renderCalculatedRags(ragDimensions, calculatedRags);

  setText("detailProjectCode", project.projectCode);

  setText("detailProjectManager", project.projectManager);

  setText("detailSponsor", project.sponsor);

  setText("detailProjectLead", project.projectLead);

  setText("detailWorkstream", project.workstream);

  setText("detailPriority", project.priority);

  setText("detailDescription", project.description);

  setText("detailScope", project.highLevelScope);

  setText("detailOutOfScope", project.outOfScope);

  setText("detailCurrentStage", project.currentStage);

  setText("detailNextStage", project.nextStage);

  setText("detailBaselineStart", formatDate(project.baselineStartDate));

  setText("detailBaselineEnd", formatDate(project.baselineEndDate));

  setText("detailForecastStart", formatDate(project.forecastStartDate));

  setText("detailForecastEnd", formatDate(project.forecastEndDate));

  setText("detailImplementationDate", formatDate(project.targetImplementationDate));

  setText("detailDeliveryConfidence", project.deliveryConfidence);

  setText("detailCurrentPosition", project.currentPosition);

  setText("detailNextSteps", project.nextSteps);

  setText("detailSlippage", project.reasonForSlippage);

  setText("detailReturnToGreen", project.returnToGreen);
}

/* ------------------------------------------------- the three project editors

   Editing happens here. "Edit project details", "Update project status" and "Edit assurance
   evidence" each render one form from ppm-project-fields.js into the panel below the
   heading. None of them navigates anywhere, and none of them touches the page that creates
   a project, which is all that page is for.

   The split is the point. What a project IS changes rarely; what it is DOING changes every
   reporting cycle; the stage evidence is answered as each stage arrives. One button onto all
   113 fields is what made changing a status feel like filling the creation form in again.
*/

const EDITOR_MESSAGES = {
  details: (project) => `${project.projectName} was updated.`,
  status: (project) => `The status update for ${project.projectName} was saved.`,
  assurance: (project) => `The assurance evidence for ${project.projectName} was saved.`
};

let openEditorForm = null;

function editorHost() {
  return document.getElementById("projectEditorHost");
}

function showEditorProblems(problems) {
  const summary = document.getElementById("projectEditorProblems");
  if (!summary) return;
  if (!problems.length) {
    summary.textContent = "";
    summary.classList.remove("visible");
    return;
  }
  /* The count, not the list. Each problem is already written against the field it belongs
     to, and the field is where the reader has to go. */
  summary.textContent =
    problems.length === 1
      ? "One field needs attention before this can be saved."
      : `${problems.length} fields need attention before this can be saved.`;
  summary.classList.add("visible");
}

function closeEditor() {
  openEditorForm = null;
  document.getElementById("projectEditorPanel").hidden = true;
  showEditorProblems([]);
}

function startEditing(formName) {
  if (!project) {
    showMessage("The project has not finished loading yet. Reload the page and try again.", "error");
    return;
  }
  const panel = document.getElementById("projectEditorPanel");
  const host = editorHost();

  openEditorForm = formName;
  document.getElementById("projectEditorTitle").textContent = PPMProjectForms.titleOf(formName);
  document.getElementById("projectEditorDescription").textContent = PPMProjectForms.descriptionOf(formName);
  document.getElementById("projectEditorCount").textContent =
    `${project.projectCode} · ${PPMProjectForms.fieldCount(formName)} fields`;

  PPMProjectForms.render(host, formName);
  PPMProjectForms.populate(host, formName, project);
  showEditorProblems([]);

  /*
    Save asks for whatever the open form asks for. A status update needs projects.status, and
    the button is markup shared by all three forms - left at projects.edit it would refuse the
    one role whose whole job is updating status.
  */
  const save = document.getElementById("projectEditorSave");
  save.dataset.permission = PPMProjectForms.permissionOf(formName);
  save.disabled = false;
  save.removeAttribute("aria-disabled");
  save.classList.remove("ppm-control-restricted");

  /*
    Controls that arrive after PPMAuth's startup pass are invisible to it, so a read-only
    role would keep an enabled Save. UI state is not the security boundary - row-level
    security is - but it should not invite an attempt the database will refuse.
  */
  if (window.PPMAuth && typeof PPMAuth.applyControlPermissions === "function")
    PPMAuth.applyControlPermissions();

  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

/*
  Saving.

  The patch covers only the form that was open, and it is merged over the record this page
  already loaded. That is what preserves `databaseVersion`, and with it optimistic locking:
  re-reading the record here would defeat the protection it exists to give.

  Stage 16: the write goes through PPMStore and is awaited, so a refusal is shown rather than
  swallowed. It used to be localStorage.setItem, which reached PostgreSQL only because both
  adapters patched it - and returned before the database had been asked anything, so this page
  could report a saved project the database had rejected.

  The audit trail is written by database triggers from the authenticated identity, so there is
  nothing to record from here.
*/
async function saveEditor() {
  if (!openEditorForm || !project) return;
  const formName = openEditorForm;
  const host = editorHost();

  const problems = PPMProjectForms.validate(host, formName, project);
  if (problems.length) {
    showEditorProblems(problems);
    host
      .querySelector(".pf-field-invalid input, .pf-field-invalid select, .pf-field-invalid textarea")
      ?.focus();
    return;
  }

  const updated = {
    ...project,
    ...PPMProjectForms.read(host, formName),
    updatedAt: new Date().toISOString()
  };

  if (formName === "status") {
    updated.calculatedRags = PPMProjectForms.refreshCalculated(host, project);
  }

  const projects = getProjects().map((item) =>
    String(item.projectCode).toLowerCase() === String(updated.projectCode).toLowerCase() ? updated : item
  );

  const savedProject = await window.PPMStore?.projects.replaceAll(projects);
  if (!savedProject || savedProject.ok === false) {
    const message = savedProject?.message || "The data layer is not loaded on this page.";
    console.error("The project could not be saved.", message);
    showMessage(
      savedProject?.queued
        ? `${message} It is saved on this computer and will be retried.`
        : `The project could not be saved, so nothing has been changed. ${message}`,
      savedProject?.queued ? "warning" : "error"
    );
    return;
  }

  /*
    A status update is also a point in the RAG history, which is append-only - the correction
    for a wrong status is another snapshot, never an edit. Recorded for the status form only,
    because that is the only one that reports health.
  */
  if (formName === "status" && window.PPMPlanning?.recordRagHistory) {
    const recorded = await PPMPlanning.recordRagHistory(
      updated.projectCode,
      updated.calculatedRags || {},
      Object.fromEntries(
        (PPMPlanning.RAG_DIMENSIONS || []).map(([key]) => [key, updated[`${key}Rag`] || "Not Assessed"])
      ),
      updated.ragOverrideJustifications || {},
      updated.projectManager || updated.projectManagerEmail || "Project team"
    );
    /*
      Stage 16: the snapshot is part of the status update, so a refused one is reported rather
      than lost. The project itself has already saved at this point - saying so plainly is
      better than a message that implies neither happened.
    */
    if (recorded && recorded.ok === false) {
      closeEditor();
      loadProject();
      showMessage(
        `The status was saved, but the RAG history entry was not recorded: ${recorded.message}`,
        "error"
      );
      return;
    }
  }

  closeEditor();
  loadProject();
  showMessage(EDITOR_MESSAGES[formName](updated), "success");
}

/*
  Bound once per control: loadProject() runs again after every save, and a second listener
  would open the editor, or save it, twice.

  The handler is wrapped, because a listener that throws does so into nothing. The button
  appears dead, the console holds the only evidence, and "the button does nothing" is all
  anyone can report. Twice now that has cost a round trip, so a failure here says what it was.
*/
function bindOnce(id, handler) {
  const element = document.getElementById(id);
  if (!element || element.dataset.ppmEditorBound === "true") return;
  element.dataset.ppmEditorBound = "true";
  element.addEventListener("click", (event) => {
    try {
      handler(event);
    } catch (error) {
      console.error(`Project editor: #${id} failed.`, error);
      showMessage(
        `The editor could not open: ${error?.message || error}. Press F12, open Console, and send that line.`,
        "error"
      );
    }
  });
}

function bindEditorControls() {
  /* Two ways in to each editor: the buttons in the heading, and the quick links in the
     "Plan and delivery records" panel further down. */
  [
    ["editProjectButton", "details"],
    ["updateStatusButton", "status"],
    ["editAssuranceButton", "assurance"],
    ["projectEditLink", "details"],
    ["projectStatusLink", "status"],
    ["projectAssuranceLink", "assurance"]
  ].forEach(([id, formName]) => {
    bindOnce(id, () => {
      if (document.getElementById(id).getAttribute("aria-disabled") === "true") return;
      startEditing(formName);
    });
  });

  bindOnce("projectEditorSave", saveEditor);
  bindOnce("projectEditorCancel", closeEditor);

  /* The calculated RAG badges follow what is typed, so an override is visible while it is
     being made rather than when the save refuses it. */
  const host = editorHost();
  if (host && host.dataset.ppmEditorListeners !== "true") {
    host.dataset.ppmEditorListeners = "true";
    host.addEventListener("change", () => {
      if (openEditorForm === "status") PPMProjectForms.refreshCalculated(host, project);
    });
  }
}

function configureProjectLinks() {
  const encodedCode = encodeURIComponent(projectCode);

  const planUrl = `project-plan.html?code=${encodedCode}`;

  const milestonesUrl = `milestones.html?code=${encodedCode}`;

  const raidUrl = `raid-log.html?code=${encodedCode}`;

  const benefitsUrl = `benefits-management.html?project=${encodedCode}`;

  const financialUrl = `financial-management.html?project=${encodedCode}`;

  const auditUrl = `audit-history.html?project=${encodedCode}`;

  const stageGatesUrl = `stage-gates.html?code=${encodedCode}`;

  bindEditorControls();

  document.getElementById("manageBenefitsButton").href = benefitsUrl;

  document.getElementById("manageFinancialsButton").href = financialUrl;
  document.getElementById("viewAuditButton").href = auditUrl;
  document.getElementById("manageStageGatesButton").href = stageGatesUrl;
  document.getElementById("stageGatePanelLink").href = stageGatesUrl;
  document.getElementById("projectStageGatesLink").href = stageGatesUrl;
  document.getElementById("financialNavigation").href = financialUrl;
  document.getElementById("auditNavigation").href = auditUrl;

  document.getElementById("projectPlanLink").href = planUrl;

  document.getElementById("projectMilestonesLink").href = milestonesUrl;

  document.getElementById("milestonesNavigation").href = milestonesUrl;

  document.getElementById("projectRaidLink").href = raidUrl;

  document.getElementById("manageRaidButton").href = raidUrl;

  const raidNavigationLink = document.querySelector('nav a[href="raid-log.html"]');

  if (raidNavigationLink) {
    raidNavigationLink.href = raidUrl;
  }

  const stageGateNavigationLink = document.querySelector('nav a[href^="stage-gates.html"]');
  if (stageGateNavigationLink) stageGateNavigationLink.href = stageGatesUrl;
}

function updateMilestoneSummary() {
  const storedMilestones = localStorage.getItem("ppmProjectMilestones");

  let milestoneStore = {};

  if (storedMilestones) {
    try {
      milestoneStore = JSON.parse(storedMilestones);
    } catch (error) {
      console.error("Milestones could not be loaded.", error);
    }
  }

  if (!milestoneStore || typeof milestoneStore !== "object" || Array.isArray(milestoneStore)) {
    milestoneStore = {};
  }

  const milestones = Array.isArray(milestoneStore[projectCode]) ? milestoneStore[projectCode] : [];

  const overdue = milestones.filter((milestone) => milestone.status === "Overdue").length;

  document.getElementById("projectMilestonesDescription").textContent =
    milestones.length === 0
      ? "No milestones or stage-gates have been recorded."
      : `${milestones.length} milestone${milestones.length === 1 ? "" : "s"}, ${overdue} overdue.`;
}

function updatePlanSummary() {
  const allPlans = getProjectPlans();

  const projectPlan = Array.isArray(allPlans[projectCode]) ? allPlans[projectCode] : [];

  const total = projectPlan.length;

  const completed = projectPlan.filter((task) => task.status === "Complete").length;

  const blocked = projectPlan.filter((task) => task.status === "Blocked").length;

  const slipped = projectPlan.filter((task) => {
    return Boolean(
      task.baselineEndDate && task.forecastEndDate && task.forecastEndDate > task.baselineEndDate
    );
  }).length;

  document.getElementById("totalTasks").textContent = total;

  document.getElementById("completedTasks").textContent = completed;

  document.getElementById("blockedTasks").textContent = blocked;

  document.getElementById("slippedTasks").textContent = slipped;

  document.getElementById("projectPlanDescription").textContent =
    total === 0
      ? "No tasks have been added."
      : `${total} ${total === 1 ? "task" : "tasks"}, ${completed} complete.`;
}

const escapeHtml = PPMCore.escapeHtml;

function isRaidReviewOverdue(item) {
  if (String(item.status || "").toLowerCase() === "closed") {
    return false;
  }

  const today = new Date();

  const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  if (item.targetDate && item.targetDate < localToday) {
    return true;
  }

  const reviewDays = {
    Weekly: 7,
    Fortnightly: 14,
    Monthly: 31,
    Quarterly: 92
  }[item.reviewFrequency];

  if (!reviewDays || !item.lastReviewedDate) {
    return false;
  }

  const nextReview = new Date(`${item.lastReviewedDate}T00:00:00`);

  nextReview.setDate(nextReview.getDate() + reviewDays);

  return nextReview.toISOString().slice(0, 10) < localToday;
}

function renderRaidItems() {
  const raidList = document.getElementById("raidList");

  const emptyMessage = document.getElementById("emptyRaidMessage");

  raidList.innerHTML = "";

  projectRaidItems
    .slice()
    .sort((firstItem, secondItem) => {
      const firstClosed = String(firstItem.status || "").toLowerCase() === "closed";

      const secondClosed = String(secondItem.status || "").toLowerCase() === "closed";

      return Number(firstClosed) - Number(secondClosed);
    })
    .forEach((item) => {
      const card = document.createElement("div");

      card.className = "raid-card";

      const isClosed = String(item.status || "").toLowerCase() === "closed";

      const itemUrl = `raid-log.html?code=${encodeURIComponent(projectCode)}&item=${encodeURIComponent(
        item.raidId || ""
      )}`;

      card.innerHTML = `
            <div class="raid-card-heading">
              <a
                class="raid-title"
                href="${itemUrl}"
              >
                ${escapeHtml(item.raidId || "RAID item")}:
                ${escapeHtml(item.title || "Untitled item")}
              </a>

              <span class="raid-badge ${isClosed ? "closed" : ""}">
                ${escapeHtml(item.status || "Open")}
              </span>
            </div>

            <div class="raid-meta">
              <span class="raid-badge ${escapeHtml(String(item.type || "").toLowerCase())}">
                ${escapeHtml(item.type || "Not set")}
              </span>

              <span class="raid-badge">
                Owner: ${escapeHtml(item.owner || "Not assigned")}
              </span>

              <span class="raid-badge">
                Priority: ${escapeHtml(item.priority || "Not set")}
              </span>

              <span class="raid-badge">
                Target: ${escapeHtml(formatDate(item.targetDate) || "Not set")}
              </span>

              ${isRaidReviewOverdue(item) ? '<span class="raid-badge overdue">Review overdue</span>' : ""}
            </div>

            <div class="raid-description">
              ${escapeHtml(item.description || "No description entered.")}
            </div>
          `;

      raidList.appendChild(card);
    });

  emptyMessage.style.display = projectRaidItems.length === 0 ? "block" : "none";

  const itemCount = projectRaidItems.length;

  document.getElementById("projectRaidDescription").textContent =
    itemCount === 0
      ? "No RAID items are linked to this project."
      : `${itemCount} RAID ${itemCount === 1 ? "item" : "items"} linked to this project.`;
}

function isAllowedDocumentUrl(url) {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
  } catch (error) {
    return false;
  }
}

function renderDocuments() {
  const documentList = document.getElementById("documentList");

  const emptyMessage = document.getElementById("emptyDocumentMessage");

  documentList.innerHTML = "";

  projectDocuments.forEach((documentLink) => {
    const card = document.createElement("div");

    card.className = "document-card";

    const safeUrl = isAllowedDocumentUrl(documentLink.url) ? documentLink.url : "#";

    card.innerHTML = `
          <div class="document-information">
            <a
              class="document-name"
              href="${escapeHtml(safeUrl)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${escapeHtml(documentLink.name)}
            </a>

            <span class="document-type">
              ${escapeHtml(documentLink.type)}
            </span>

            ${
              documentLink.notes
                ? `
                  <span class="document-notes">
                    ${escapeHtml(documentLink.notes)}
                  </span>
                `
                : ""
            }
          </div>

          <div class="document-actions">
            <a
              class="button small plan-button"
              href="${escapeHtml(safeUrl)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open
            </a>

            <button
              type="button"
              class="button small edit-document-button"
              data-document-id="${escapeHtml(documentLink.documentId)}"
            >
              Edit
            </button>

            <button
              type="button"
              class="button small danger delete-document-button"
              data-document-id="${escapeHtml(documentLink.documentId)}"
            >
              Delete
            </button>
          </div>
        `;

    documentList.appendChild(card);
  });

  emptyMessage.style.display = projectDocuments.length === 0 ? "block" : "none";

  attachDocumentEvents();
}

function attachDocumentEvents() {
  document.querySelectorAll(".edit-document-button").forEach((button) => {
    button.addEventListener("click", function () {
      openEditDocument(this.dataset.documentId);
    });
  });

  document.querySelectorAll(".delete-document-button").forEach((button) => {
    button.addEventListener("click", function () {
      deleteDocument(this.dataset.documentId);
    });
  });
}

function openAddDocument() {
  if (projectIsArchived()) {
    showMessage(
      "Archived projects are read-only. Reopen this project from the Project Register before adding documents.",
      "warning"
    );
    return;
  }

  editingDocumentId = null;

  document.getElementById("documentForm").reset();

  document.getElementById("documentModalTitle").textContent = "Add document link";

  document.getElementById("saveDocumentButton").textContent = "Save link";

  showDocumentModal();

  document.getElementById("documentType").focus();
}

function openEditDocument(documentId) {
  if (projectIsArchived()) {
    showMessage(
      "Archived projects are read-only. Reopen this project from the Project Register before editing documents.",
      "warning"
    );
    return;
  }

  const documentLink = projectDocuments.find((item) => item.documentId === documentId);

  if (!documentLink) {
    showMessage("The selected document link could not be found.", "error");

    return;
  }

  editingDocumentId = documentId;

  document.getElementById("documentModalTitle").textContent = "Edit document link";

  document.getElementById("saveDocumentButton").textContent = "Save changes";

  document.getElementById("documentType").value = documentLink.type || "";

  document.getElementById("documentName").value = documentLink.name || "";

  document.getElementById("documentUrl").value = documentLink.url || "";

  document.getElementById("documentNotes").value = documentLink.notes || "";

  showDocumentModal();
}

function showDocumentModal() {
  document.getElementById("documentModal").classList.add("visible");

  document.body.style.overflow = "hidden";
}

function closeDocumentModal() {
  document.getElementById("documentModal").classList.remove("visible");

  document.body.style.overflow = "";

  editingDocumentId = null;
}

function generateDocumentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `DOC-${Date.now()}-` + Math.random().toString(16).slice(2);
}

// Cells tracked in the document-link change history.
const DOCUMENT_AUDIT_FIELDS = [
  { key: "name", label: "Document name" },
  { key: "documentType", label: "Document type" },
  { key: "url", label: "Link" },
  { key: "owner", label: "Owner" },
  { key: "version", label: "Version" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" }
];

function currentProjectCode() {
  return new URLSearchParams(location.search).get("code") || "";
}

async function saveDocument(event) {
  event.preventDefault();

  if (projectIsArchived()) {
    closeDocumentModal();
    showMessage("Archived projects are read-only. No document changes were saved.", "warning");
    return;
  }

  const form = document.getElementById("documentForm");

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const url = document.getElementById("documentUrl").value.trim();

  if (!isAllowedDocumentUrl(url)) {
    alert("Enter a valid Teams or SharePoint web link.");

    return;
  }

  const documentLink = {
    documentId: editingDocumentId || generateDocumentId(),

    type: document.getElementById("documentType").value,

    name: document.getElementById("documentName").value.trim(),

    url,

    notes: document.getElementById("documentNotes").value.trim(),

    updatedAt: new Date().toISOString()
  };

  if (editingDocumentId) {
    const documentIndex = projectDocuments.findIndex((item) => item.documentId === editingDocumentId);

    if (documentIndex === -1) {
      alert("The selected document link could not be found.");

      return;
    }

    const existingDocument = projectDocuments[documentIndex];

    const beforeDocument = JSON.parse(JSON.stringify(existingDocument));

    projectDocuments[documentIndex] = {
      ...existingDocument,
      ...documentLink,
      documentId: existingDocument.documentId,
      createdAt: existingDocument.createdAt || new Date().toISOString()
    };

    PPMChangeLog.recordRow({
      before: beforeDocument,
      after: projectDocuments[documentIndex],
      entityType: "Project document",
      entityId: existingDocument.documentId,
      projectCode: currentProjectCode(),
      fields: DOCUMENT_AUDIT_FIELDS,
      name: documentLink.name
    });

    showMessage(`${documentLink.name} was updated.`, "success");
  } else {
    const addedDocument = {
      ...documentLink,
      createdAt: new Date().toISOString()
    };

    projectDocuments.push(addedDocument);

    PPMChangeLog.recordRow({
      before: null,
      after: addedDocument,
      entityType: "Project document",
      entityId: addedDocument.documentId,
      projectCode: currentProjectCode(),
      fields: DOCUMENT_AUDIT_FIELDS,
      name: documentLink.name
    });

    showMessage(`${documentLink.name} was added.`, "success");
  }

  await saveProjectDocuments();
  closeDocumentModal();
  renderDocuments();
}

function deleteDocument(documentId) {
  if (projectIsArchived()) {
    showMessage(
      "Archived projects are read-only. Reopen this project before removing document links.",
      "warning"
    );
    return;
  }

  const documentLink = projectDocuments.find((item) => item.documentId === documentId);

  if (!documentLink) {
    return;
  }

  pendingDeleteDocumentId = documentId;
  document.getElementById("deleteDocumentMessage").textContent =
    `Delete the link to ${documentLink.name}? This removes the PPM link only; the governed source document is not deleted.`;
  document.getElementById("deleteDocumentConfirmation").classList.add("visible");
  document.body.style.overflow = "hidden";
  document.getElementById("cancelDeleteDocumentButton").focus();
}

function closeDeleteDocumentConfirmation() {
  pendingDeleteDocumentId = null;
  document.getElementById("deleteDocumentConfirmation").classList.remove("visible");
  document.body.style.overflow = "";
}

async function confirmDeleteDocument() {
  const documentLink = projectDocuments.find((item) => item.documentId === pendingDeleteDocumentId);
  if (!documentLink) {
    closeDeleteDocumentConfirmation();
    return;
  }
  const removedDocument = JSON.parse(JSON.stringify(documentLink));
  projectDocuments = projectDocuments.filter((item) => item.documentId !== pendingDeleteDocumentId);
  PPMChangeLog.recordDeletion({
    before: removedDocument,
    entityType: "Project document",
    entityId: removedDocument.documentId,
    projectCode: currentProjectCode(),
    fields: DOCUMENT_AUDIT_FIELDS,
    name: removedDocument.name
  });
  closeDeleteDocumentConfirmation();
  await saveProjectDocuments();
  renderDocuments();
  showMessage(`${documentLink.name} was removed.`, "success");
}

document.getElementById("addDocumentButton").addEventListener("click", openAddDocument);

document.getElementById("closeDocumentModalButton").addEventListener("click", closeDocumentModal);

document.getElementById("cancelDocumentButton").addEventListener("click", closeDocumentModal);

document.getElementById("documentForm").addEventListener("submit", saveDocument);

document
  .getElementById("cancelDeleteDocumentButton")
  .addEventListener("click", closeDeleteDocumentConfirmation);
document.getElementById("confirmDeleteDocumentButton").addEventListener("click", confirmDeleteDocument);
document.getElementById("deleteDocumentConfirmation").addEventListener("click", function (event) {
  if (event.target === this) closeDeleteDocumentConfirmation();
});

document.getElementById("documentModal").addEventListener("click", function (event) {
  if (event.target === this) {
    closeDocumentModal();
  }
});

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" && document.getElementById("documentModal").classList.contains("visible")) {
    closeDocumentModal();
  }
  if (
    event.key === "Escape" &&
    document.getElementById("deleteDocumentConfirmation").classList.contains("visible")
  ) {
    closeDeleteDocumentConfirmation();
  }
});

initCollapsibleSections();

/*
  Bound before anything is rendered, and deliberately not only from inside loadProject().

  Whether the buttons work must not depend on whether the page rendered. If the record is
  missing, or a section throws, the reader still gets a button that opens and explains itself
  rather than one that does nothing at all.
*/
bindEditorControls();

loadProject();

const savedProjectMessage = sessionStorage.getItem("ppmSuccessMessage");

if (savedProjectMessage) {
  showMessage(savedProjectMessage, "success");

  sessionStorage.removeItem("ppmSuccessMessage");
}
