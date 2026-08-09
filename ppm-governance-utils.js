(function () {
  "use strict";

  const PROGRAMME_STORAGE_KEY = "ppmProgrammes";
  const PROJECT_STORAGE_KEY = "ppmProjects";

  const DEFAULT_PROGRAMME_NAMES = ["Servicing", "Sales", "Propositions", "Mergers & Acquisitions", "BAU"];

  const STAGE_ORDER = [
    "Intake",
    "Discovery",
    "Requirements and Design",
    "Build",
    "Test",
    "Implementation",
    "Hypercare",
    "Closure"
  ];

  const parseJson = (value, fallback) => PPMCore.parseJson(value, fallback, "PPM governance data");

  function programmeIdForIndex(index) {
    return `PRG-${String(index + 1).padStart(5, "0")}`;
  }

  function defaultProgramme(name, index) {
    return {
      programmeId: programmeIdForIndex(index),
      name,
      description: `${name} change portfolio and delivery workstream.`,
      portfolio: "Foresters Portfolio",
      sponsor: "",
      sponsorResourceId: "",
      sponsorEmail: "",
      lead: "",
      leadResourceId: "",
      leadEmail: "",
      programmeManager: "",
      programmeManagerResourceId: "",
      programmeManagerEmail: "",
      startDate: "",
      endDate: "",
      overallStatus: "Active",
      overallRag: "Not Assessed",
      strategicObjective: "",
      budget: "",
      benefits: "",
      commentary: "",
      nextSteps: "",
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normaliseProgrammes(programmes) {
    const rows = Array.isArray(programmes) ? programmes.filter(Boolean) : [];
    const usedIds = new Set();
    return rows.map((programme, index) => {
      let programmeId = String(programme.programmeId || programme.workstreamId || "").trim();
      if (!programmeId || usedIds.has(programmeId)) programmeId = programmeIdForIndex(index);
      usedIds.add(programmeId);
      return {
        ...defaultProgramme(programme.name || `Programme ${index + 1}`, index),
        ...programme,
        programmeId,
        name: String(programme.name || programme.workstream || `Programme ${index + 1}`).trim(),
        active: programme.active !== false
      };
    });
  }

  function saveProgrammes(programmes) {
    const normalised = normaliseProgrammes(programmes);
    localStorage.setItem(PROGRAMME_STORAGE_KEY, JSON.stringify(normalised));
    return normalised;
  }

  function migrateProjectProgrammeReferences(programmes) {
    const projects = parseJson(localStorage.getItem(PROJECT_STORAGE_KEY), []);
    if (!Array.isArray(projects)) return;
    let changed = false;
    projects.forEach((project) => {
      const byId = programmes.find((programme) => programme.programmeId === project.programmeId);
      const byName = programmes.find(
        (programme) =>
          String(programme.name).toLowerCase() ===
          String(project.workstream || project.programme || "").toLowerCase()
      );
      const match = byId || byName;
      if (match && (project.programmeId !== match.programmeId || project.workstream !== match.name)) {
        project.programmeId = match.programmeId;
        project.programme = match.name;
        project.workstream = match.name;
        changed = true;
      }
    });
    if (changed) localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(projects));
  }

  function getProgrammes() {
    const stored = parseJson(localStorage.getItem(PROGRAMME_STORAGE_KEY), null);
    let programmes;
    if (Array.isArray(stored) && stored.length) {
      programmes = normaliseProgrammes(stored);
    } else {
      programmes = DEFAULT_PROGRAMME_NAMES.map(defaultProgramme);
    }
    programmes = saveProgrammes(programmes);
    migrateProjectProgrammeReferences(programmes);
    return programmes;
  }

  function nextProgrammeId(programmes) {
    const highest = (programmes || getProgrammes()).reduce((maximum, programme) => {
      const match = String(programme.programmeId || "").match(/PRG-(\d+)/i);
      return Math.max(maximum, match ? Number(match[1]) : 0);
    }, 0);
    return `PRG-${String(highest + 1).padStart(5, "0")}`;
  }

  function findProgramme(programmeId, fallbackName) {
    const programmes = getProgrammes();
    return (
      programmes.find((programme) => programme.programmeId === programmeId) ||
      programmes.find(
        (programme) => String(programme.name).toLowerCase() === String(fallbackName || "").toLowerCase()
      ) ||
      null
    );
  }

  function populateProgrammeSelect(selectOrId, options) {
    const select = typeof selectOrId === "string" ? document.getElementById(selectOrId) : selectOrId;
    if (!select) return;
    const settings = options || {};
    const programmes = getProgrammes().filter((programme) => programme.active !== false);
    const selectedId = settings.selectedProgrammeId || "";
    const legacyName = settings.legacyName || "";
    select.innerHTML =
      `<option value="">${settings.blankLabel || "Select a programme / workstream"}</option>` +
      programmes
        .map(
          (programme) =>
            `<option value="${escapeAttribute(programme.programmeId)}">${escapeHtml(programme.name)}</option>`
        )
        .join("");
    const selected = findProgramme(selectedId, legacyName);
    if (selected) select.value = selected.programmeId;
    else if (legacyName) {
      const option = document.createElement("option");
      option.value = `legacy:${legacyName}`;
      option.textContent = `${legacyName} (legacy - reassign)`;
      select.appendChild(option);
      select.value = option.value;
    }
  }

  function selectedProgramme(selectOrId) {
    const select = typeof selectOrId === "string" ? document.getElementById(selectOrId) : selectOrId;
    if (!select || !select.value) return { programmeId: "", name: "" };
    if (select.value.startsWith("legacy:")) return { programmeId: "", name: select.value.slice(7) };
    const programme = findProgramme(select.value, "");
    return programme
      ? { programmeId: programme.programmeId, name: programme.name }
      : { programmeId: "", name: "" };
  }

  const escapeHtml = PPMCore.escapeHtml;

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function isArchived(project) {
    return Boolean(project && (project.archived === true || project.projectStatus === "Archived"));
  }

  function archiveProject(project, reason) {
    const now = new Date().toISOString();
    const history = Array.isArray(project.archiveHistory) ? [...project.archiveHistory] : [];
    history.push({
      reason: String(reason || "").trim(),
      archivedAt: now,
      previousStatus: project.projectStatus || "Planned"
    });
    return {
      ...project,
      preArchiveStatus: project.projectStatus || "Planned",
      projectStatus: "Archived",
      archived: true,
      archivedAt: now,
      archiveReason: String(reason || "").trim(),
      archivedReason: String(reason || "").trim(),
      archiveHistory: history,
      updatedAt: now
    };
  }

  function reopenProject(project, reason) {
    const now = new Date().toISOString();
    const history = Array.isArray(project.reopenHistory) ? [...project.reopenHistory] : [];
    history.push({ reason: String(reason || "").trim(), reopenedAt: now });
    return {
      ...project,
      projectStatus:
        project.preArchiveStatus && project.preArchiveStatus !== "Archived"
          ? project.preArchiveStatus
          : "Planned",
      archived: false,
      reopenedAt: now,
      reopenReason: String(reason || "").trim(),
      reopenHistory: history,
      updatedAt: now
    };
  }

  function stagesForProject(project) {
    if (window.PPMAdmin && typeof window.PPMAdmin.projectStages === "function") {
      const configured = window.PPMAdmin.projectStages(project || {});
      if (Array.isArray(configured) && configured.length) {
        return configured
          .map((stage) => (typeof stage === "string" ? stage : stage && stage.name))
          .filter(Boolean);
      }
    }
    return [...STAGE_ORDER];
  }

  function stageIndex(stage, project) {
    const index = stagesForProject(project).indexOf(stage);
    return index;
  }

  window.PPMGovernance = {
    PROGRAMME_STORAGE_KEY,
    PROJECT_STORAGE_KEY,
    DEFAULT_PROGRAMME_NAMES,
    STAGE_ORDER,
    getProgrammes,
    saveProgrammes,
    nextProgrammeId,
    findProgramme,
    populateProgrammeSelect,
    selectedProgramme,
    isArchived,
    archiveProject,
    reopenProject,
    stagesForProject,
    stageIndex,
    escapeHtml
  };
})();
