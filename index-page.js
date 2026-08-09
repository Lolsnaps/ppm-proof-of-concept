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

let projects = getProjects();

function getProjects() {
  const storedProjects = localStorage.getItem("ppmProjects");

  if (storedProjects) {
    try {
      const parsedProjects = JSON.parse(storedProjects);

      if (Array.isArray(parsedProjects)) {
        return window.PPMAdmin
          ? PPMAdmin.migrateLegacyProjectLifecycleAssignments(parsedProjects)
          : parsedProjects;
      }
    } catch (error) {
      console.error("Projects could not be loaded.", error);
    }
  }

  localStorage.setItem("ppmProjects", JSON.stringify(initialProjects));

  return window.PPMAdmin
    ? PPMAdmin.migrateLegacyProjectLifecycleAssignments(initialProjects)
    : [...initialProjects];
}

function getProjectPlans() {
  const storedPlans = localStorage.getItem("ppmProjectPlans");

  if (!storedPlans) {
    return {};
  }

  try {
    const parsedPlans = JSON.parse(storedPlans);

    if (parsedPlans && typeof parsedPlans === "object" && !Array.isArray(parsedPlans)) {
      return parsedPlans;
    }
  } catch (error) {
    console.error("Project plans could not be loaded.", error);
  }

  return {};
}

function saveProjects() {
  localStorage.setItem("ppmProjects", JSON.stringify(projects));
}

const escapeHtml = PPMCore.escapeHtml;

/* A percentage-complete bar is a computed width, so it cannot be a class.
   style-src 'self' blocks style attributes; PPMCore applies these through CSSOM. */
const styleAttr = PPMCore.styleAttribute;

function formatDate(dateValue) {
  if (!dateValue) {
    return "Not set";
  }

  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function normalisePercentage(value) {
  const percentage = Number(value);

  if (Number.isNaN(percentage)) {
    return 0;
  }

  return Math.min(100, Math.max(0, percentage));
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

  return "rag-grey";
}

function getStatusClass(status) {
  if (status === "Active") {
    return "status-active";
  }

  if (status === "Completed") {
    return "status-completed";
  }

  if (status === "On Hold") {
    return "status-on-hold";
  }

  if (status === "Cancelled") {
    return "status-cancelled";
  }

  return "";
}

function getTaskCount(projectCode) {
  const projectPlans = getProjectPlans();

  const projectPlan = projectPlans[projectCode];

  if (!Array.isArray(projectPlan)) {
    return 0;
  }

  return projectPlan.length;
}

function getFilteredProjects() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();

  const status = document.getElementById("statusFilter").value;

  const rag = document.getElementById("ragFilter").value;

  return projects.filter(function (project) {
    const searchableText = [
      project.projectCode,
      project.projectName,
      project.projectManager,
      project.sponsor,
      project.projectLead,
      project.workstream,
      project.description,
      project.archiveReason,
      project.archivedReason
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const matchesSearch = searchableText.includes(search);

    const archived = PPMGovernance.isArchived(project);

    const matchesStatus =
      status === "Archived"
        ? archived
        : status
          ? !archived && project.projectStatus === status
          : search
            ? true
            : !archived;

    const matchesRag = !rag || project.overallRag === rag;

    return matchesSearch && matchesStatus && matchesRag;
  });
}

function renderProjects() {
  const filteredProjects = getFilteredProjects();

  const tableBody = document.getElementById("projectTableBody");

  const emptyMessage = document.getElementById("emptyMessage");

  tableBody.innerHTML = "";

  filteredProjects.forEach(function (project) {
    const projectCode = String(project.projectCode || "");

    const percentage = normalisePercentage(project.percentageComplete);

    const taskCount = getTaskCount(projectCode);

    const encodedCode = encodeURIComponent(projectCode);

    const detailsUrl = `project-details.html?code=${encodedCode}`;

    const planUrl = `project-plan.html?code=${encodedCode}`;

    const milestonesUrl = `milestones.html?code=${encodedCode}`;

    const editUrl = `add-project.html?code=${encodedCode}&mode=details`;

    const isArchived = PPMGovernance.isArchived(project);
    const canArchive = ["Completed", "Cancelled", "Rejected"].includes(project.projectStatus);
    const projectActions = isArchived
      ? `<a class="button details-button" href="${detailsUrl}">Details</a><button type="button" class="button duplicate-button" data-permission="projects.create" data-project-code="${escapeHtml(projectCode)}">Duplicate</button><button type="button" class="button reopen-button" data-permission="projects.archive" data-project-code="${escapeHtml(projectCode)}">Reopen</button>`
      : `<a class="button details-button" href="${detailsUrl}">Details</a><a class="button plan-button" href="${planUrl}">Plan</a><a class="button details-button" href="${milestonesUrl}">Milestones</a><a class="button edit-button" href="${editUrl}" data-permission="projects.edit">Edit</a><button type="button" class="button duplicate-button" data-permission="projects.create" data-project-code="${escapeHtml(projectCode)}">Duplicate</button>${canArchive ? `<button type="button" class="button archive-button" data-permission="projects.archive" data-project-code="${escapeHtml(projectCode)}">Archive</button>` : ""}`;

    const row = document.createElement("tr");

    if (isArchived) row.classList.add("archived-row");

    const taskText =
      taskCount === 0 ? "No plan tasks" : taskCount === 1 ? "1 plan task" : `${taskCount} plan tasks`;

    row.innerHTML = `
            <td>
              ${escapeHtml(projectCode)}
            </td>

            <td>
              <a
                class="project-name"
                href="${detailsUrl}"
              >
                ${escapeHtml(project.projectName)}
              </a>

              <span
                class="project-description"
              >
                ${escapeHtml(project.description || project.currentPosition || "No description entered.")}
              </span>

              <span
                class="plan-count"
              >
                ${taskText}
              </span>
            </td>

            <td>
              ${escapeHtml(project.projectManager || "Not assigned")}
            </td>

            <td>
              <span
                class="status ${getStatusClass(project.projectStatus)}"
              >
                ${escapeHtml(project.projectStatus || "Proposed")}
              </span>
            </td>

            <td>
              <span
                class="rag ${getRagClass(project.overallRag)}"
              >
                ${escapeHtml(project.overallRag || "Not Assessed")}
              </span>
            </td>

            <td>
              ${formatDate(project.forecastEndDate)}
            </td>

            <td>
              <div
                class="percentage-wrapper"
              >
                <span
                  class="percentage-text"
                >
                  ${percentage}%
                </span>

                <div
                  class="progress-track"
                >
                  <div
                    class="progress-value"${styleAttr(`width:${percentage}%`)}
                  ></div>
                </div>
              </div>
            </td>

            <td>
              <div
                class="action-buttons"
              >
                ${projectActions}
              </div>
            </td>
          `;

    tableBody.appendChild(row);
  });

  emptyMessage.style.display = filteredProjects.length === 0 ? "block" : "none";

  attachProjectActionEvents();
  updateSummary();
}

function attachProjectActionEvents() {
  document
    .querySelectorAll(".duplicate-button")
    .forEach((button) =>
      button.addEventListener("click", () => openDuplicateModal(button.dataset.projectCode))
    );
  document
    .querySelectorAll(".archive-button")
    .forEach((button) =>
      button.addEventListener("click", () => openArchiveModal(button.dataset.projectCode, "archive"))
    );
  document
    .querySelectorAll(".reopen-button")
    .forEach((button) =>
      button.addEventListener("click", () => openArchiveModal(button.dataset.projectCode, "reopen"))
    );
}

function updateSummary() {
  const liveProjects = projects.filter((project) => !PPMGovernance.isArchived(project));
  document.getElementById("totalProjects").textContent = liveProjects.length;

  document.getElementById("activeProjects").textContent = liveProjects.filter(function (project) {
    return project.projectStatus === "Active";
  }).length;

  document.getElementById("amberProjects").textContent = liveProjects.filter(function (project) {
    return project.overallRag === "Amber";
  }).length;

  document.getElementById("redProjects").textContent = liveProjects.filter(function (project) {
    return project.overallRag === "Red";
  }).length;

  document.getElementById("archivedProjects").textContent = projects.filter((project) =>
    PPMGovernance.isArchived(project)
  ).length;
}

function nextProjectCode() {
  const highest = projects.reduce((maximum, project) => {
    const match = String(project.projectCode || "").match(/PRJ-(\d+)/i);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0);
  return `PRJ-${String(highest + 1).padStart(5, "0")}`;
}

function readObjectStore(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function closeDuplicateModal() {
  document.getElementById("duplicateModal").classList.remove("visible");
}

function openDuplicateModal(projectCode) {
  const source = projects.find((project) => project.projectCode === projectCode);
  if (!source) return;
  document.getElementById("duplicateForm").reset();
  document.getElementById("duplicateSourceCode").value = projectCode;
  document.getElementById("duplicateProjectName").value = `${source.projectName} - Copy`;
  document.getElementById("copyRoles").checked = true;
  document.getElementById("copyPlan").checked = true;
  document.getElementById("copyMilestones").checked = true;
  document.getElementById("copyOpenRaid").checked = false;
  document.getElementById("copyLifecycle").checked = true;
  document.getElementById("duplicateModal").classList.add("visible");
  document.getElementById("duplicateProjectName").focus();
}

function clearPerson(project, property) {
  project[property] = "";
  project[`${property}ResourceId`] = "";
  project[`${property}Email`] = "";
}

function duplicateProject(event) {
  event.preventDefault();
  const sourceCode = document.getElementById("duplicateSourceCode").value;
  const source = projects.find((project) => project.projectCode === sourceCode);
  const name = document.getElementById("duplicateProjectName").value.trim();
  if (!source || !name) return;
  const newCode = nextProjectCode();
  const now = new Date().toISOString();
  const assignedLifecycle = PPMAdmin.getTemplateForProject(source);
  const lifecycleStages = PPMAdmin.projectStages(source).map((stage) => stage.name);
  const duplicated = {
    ...source,
    lifecycleTemplateId: assignedLifecycle?.templateId || source.lifecycleTemplateId || "",
    lifecycleTemplateVersion: Number(assignedLifecycle?.version || source.lifecycleTemplateVersion || 1),
    projectCode: newCode,
    projectName: name,
    shortName: "",
    projectStatus: "Proposed",
    preArchiveStatus: "",
    archived: false,
    archivedAt: "",
    archiveReason: "",
    archivedReason: "",
    reopenedAt: "",
    reopenReason: "",
    archiveHistory: [],
    reopenHistory: [],
    currentStage: lifecycleStages[0] || "Intake",
    nextStage: lifecycleStages[1] || "",
    approvalStatus: "Draft",
    requirementsApprovalStatus: "",
    baselineApprovalStatus: "",
    goLiveApprovalStatus: "",
    closureApprovalStatus: "",
    actualStartDate: "",
    actualEndDate: "",
    closureDate: "",
    approvedImplementationDate: "",
    currentStageGate: "",
    nextStageGateDate: "",
    overallRag: "Not Assessed",
    scheduleRag: "Not Assessed",
    scopeRag: "Not Assessed",
    financialRag: "Not Assessed",
    resourceRag: "Not Assessed",
    riskRag: "Not Assessed",
    deliveryConfidence: "Not Assessed",
    percentageComplete: 0,
    currentPosition: "",
    nextSteps: "",
    reasonForSlippage: "",
    returnToGreen: "",
    dateLogged: now.slice(0, 10),
    createdAt: now,
    updatedAt: now
  };
  [
    "auditHistory",
    "statusHistory",
    "statusReports",
    "approvals",
    "approvalHistory",
    "stageOverrideHistory",
    "stageOverrideReason",
    "decisionHistory",
    "gateSubmissions"
  ].forEach((property) => delete duplicated[property]);
  if (!document.getElementById("copyRoles").checked) {
    [
      "requestor",
      "projectManager",
      "deputyProjectManager",
      "sponsor",
      "projectLead",
      "businessOwner",
      "technicalLead",
      "businessAnalyst",
      "testLead",
      "changeLead",
      "financeContact",
      "complianceContact",
      "benefitOwner"
    ].forEach((property) => clearPerson(duplicated, property));
  }
  if (!document.getElementById("copyLifecycle").checked) {
    [
      "assumptionsConstraints",
      "initialRaidSummary",
      "indicativeCosts",
      "resourceDemandSummary",
      "discoveryDeliverables",
      "solutionOptions",
      "deliveryPlanSummary",
      "detailedResourceDemand",
      "costEstimate",
      "deliveryDependencies",
      "testApproach",
      "operationalReadinessRequirements",
      "implementationApproach",
      "benefitMeasures",
      "testDatesStatus",
      "defectsBlockers",
      "deploymentDependencies",
      "goLiveCriteria",
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
      "archiveLocation"
    ].forEach((property) => {
      duplicated[property] = typeof duplicated[property] === "number" ? 0 : "";
    });
  }
  projects.push(duplicated);
  saveProjects();


  if (document.getElementById("copyPlan").checked) {
    const plans = readObjectStore("ppmProjectPlans");
    const tasks = Array.isArray(plans[sourceCode]) ? plans[sourceCode] : [];
    plans[newCode] = tasks.map((task, index) => ({
      ...task,
      taskId: `${newCode}-TASK-${String(index + 1).padStart(4, "0")}`,
      projectCode: newCode,
      status: "Not Started",
      percentageComplete: 0,
      actualStartDate: "",
      actualEndDate: "",
      createdAt: now,
      updatedAt: now
    }));
    localStorage.setItem("ppmProjectPlans", JSON.stringify(plans));
  }
  if (document.getElementById("copyMilestones").checked) {
    const milestones = readObjectStore("ppmProjectMilestones");
    const rows = Array.isArray(milestones[sourceCode]) ? milestones[sourceCode] : [];
    milestones[newCode] = rows.map((item, index) => ({
      ...item,
      milestoneId: `${newCode}-MS-${String(index + 1).padStart(4, "0")}`,
      projectCode: newCode,
      status: "Not Started",
      percentageComplete: 0,
      actualDate: "",
      createdAt: now,
      updatedAt: now
    }));
    localStorage.setItem("ppmProjectMilestones", JSON.stringify(milestones));
  }
  if (document.getElementById("copyOpenRaid").checked) {
    const raid = readObjectStore("ppmProjectRaid");
    const rows = Array.isArray(raid[sourceCode]) ? raid[sourceCode] : [];
    raid[newCode] = rows
      .filter((item) => item.status !== "Closed")
      .map((item, index) => ({
        ...item,
        raidId: `${newCode}-RAID-${String(index + 1).padStart(4, "0")}`,
        projectId: newCode,
        projectCode: newCode,
        status: "Open",
        dateClosed: "",
        closureEvidence: "",
        createdAt: now,
        updatedAt: now
      }));
    localStorage.setItem("ppmProjectRaid", JSON.stringify(raid));
  }
  closeDuplicateModal();
  document.getElementById("statusFilter").value = "";
  renderProjects();
  showSuccessMessage(`${name} was created as ${newCode}.`);
}

function closeArchiveModal() {
  document.getElementById("archiveModal").classList.remove("visible");
}

function openArchiveModal(projectCode, action) {
  const project = projects.find((item) => item.projectCode === projectCode);
  if (!project) return;
  document.getElementById("archiveForm").reset();
  document.getElementById("archiveProjectCode").value = projectCode;
  document.getElementById("archiveAction").value = action;
  document.getElementById("archiveModalTitle").textContent =
    action === "reopen" ? "Reopen project" : "Archive project";
  document.getElementById("archiveModalDescription").textContent =
    action === "reopen"
      ? "Reopening restores editing while retaining the archive and reopen history."
      : "The project, plan, milestones, RAID and documents will be retained as read-only.";
  document.getElementById("confirmArchive").textContent =
    action === "reopen" ? "Reopen project" : "Archive project";
  document.getElementById("archiveModal").classList.add("visible");
  document.getElementById("archiveReason").focus();
}

function saveArchiveAction(event) {
  event.preventDefault();
  const code = document.getElementById("archiveProjectCode").value;
  const action = document.getElementById("archiveAction").value;
  const reason = document.getElementById("archiveReason").value.trim();
  const index = projects.findIndex((project) => project.projectCode === code);
  if (index < 0 || !reason) return;
  if (
    action === "archive" &&
    !["Completed", "Cancelled", "Rejected"].includes(projects[index].projectStatus)
  ) {
    closeArchiveModal();
    showSuccessMessage("Only completed, cancelled or rejected projects can be archived.");
    return;
  }
  const projectBeforeAudit = { ...projects[index] };
  projects[index] =
    action === "reopen"
      ? PPMGovernance.reopenProject(projects[index], reason)
      : PPMGovernance.archiveProject(projects[index], reason);
  saveProjects();

  closeArchiveModal();
  document.getElementById("statusFilter").value = action === "reopen" ? "" : "Archived";
  renderProjects();
  showSuccessMessage(`${projects[index].projectName} was ${action === "reopen" ? "reopened" : "archived"}.`);
}

function showSuccessMessage(message) {
  const messageBox = document.getElementById("successMessage");

  messageBox.textContent = message;

  messageBox.classList.add("visible");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function displayStoredSuccessMessage() {
  const storedMessage = sessionStorage.getItem("ppmSuccessMessage");

  if (!storedMessage) {
    return;
  }

  showSuccessMessage(storedMessage);

  sessionStorage.removeItem("ppmSuccessMessage");
}

document.getElementById("searchInput").addEventListener("input", renderProjects);

document.getElementById("statusFilter").addEventListener("change", renderProjects);

document.getElementById("ragFilter").addEventListener("change", renderProjects);

document.getElementById("duplicateForm").addEventListener("submit", duplicateProject);
document.getElementById("closeDuplicateModal").addEventListener("click", closeDuplicateModal);
document.getElementById("cancelDuplicate").addEventListener("click", closeDuplicateModal);
document.getElementById("archiveForm").addEventListener("submit", saveArchiveAction);
document.getElementById("closeArchiveModal").addEventListener("click", closeArchiveModal);
document.getElementById("cancelArchive").addEventListener("click", closeArchiveModal);

window.addEventListener("storage", function (event) {
  if (event.key === "ppmProjects" || event.key === "ppmProjectPlans") {
    projects = getProjects();

    renderProjects();
  }
});

PPMGovernance.getProgrammes();
projects = getProjects();
displayStoredSuccessMessage();
renderProjects();
