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

  /*
    Stage 16: the one write seam.

    The old signature returned the normalised programmes, and two callers assigned from it.
    Normalising and saving are different jobs, so they are separate now: normaliseProgrammes()
    is pure and callers use it directly, and this returns what the database said. The
    normalised list is included on the result so the assignment at the call site still has
    something to assign - but it is no longer the only thing coming back, which is the point.
  */
  async function saveProgrammes(programmes) {
    const normalised = normaliseProgrammes(programmes);
    if (!window.PPMStore) {
      return {
        ok: false,
        reason: "failed",
        message: "The data layer is not loaded on this page, so nothing was saved.",
        queued: false,
        programmes: normalised
      };
    }
    const result = await window.PPMStore.programmes.replaceAll(normalised);
    return { ...result, programmes: normalised };
  }

  /*
    Stage 16: awaited, and only the projects that actually changed are written.

    This rewrote every project in the portfolio whenever any one of their programme references
    had drifted - the read-modify-write that let two people editing different projects
    overwrite each other. replaceAll writes only the rows that differ, each against its own
    version, so an untouched project is not written at all.
  */
  async function migrateProjectProgrammeReferences(programmes) {
    const projects = parseJson(localStorage.getItem(PROJECT_STORAGE_KEY), []);
    if (!Array.isArray(projects)) return { ok: true, saved: 0, nothingToDo: true };
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
    if (!changed) return { ok: true, saved: 0, nothingToDo: true };
    if (!window.PPMStore) {
      return {
        ok: false,
        reason: "failed",
        message: "The data layer is not loaded on this page, so programme references were not updated.",
        queued: false
      };
    }
    return window.PPMStore.projects.replaceAll(projects);
  }

  /*
    Stage 16: read and write separated, for the same reason as the resources getter.

    This wrote on every single call - it saved the programmes and then rewrote every project
    whose programme reference had drifted, on a function named "get". Sixteen call sites across
    six files use the return value, so it cannot become asynchronous, and it should never have
    been writing in the first place.

    Seeding the defaults is part of deriving, not part of saving: a portfolio with no
    programmes yet still needs the default list to render, and backfillProgrammes() is what
    makes that permanent.
  */
  function getProgrammes() {
    const stored = parseJson(localStorage.getItem(PROGRAMME_STORAGE_KEY), null);
    if (Array.isArray(stored) && stored.length) return normaliseProgrammes(stored);
    return DEFAULT_PROGRAMME_NAMES.map(defaultProgramme);
  }

  /*
    The write half: persist the programmes, then bring project references into line with them.
    Called once where it matters rather than on every read.
  */
  async function backfillProgrammes() {
    const programmes = getProgrammes();
    const result = await saveProgrammes(programmes);
    if (!result.ok) return result;
    const references = await migrateProjectProgrammeReferences(result.programmes);
    return references && references.ok === false ? references : result;
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
    backfillProgrammes,
    normaliseProgrammes,
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
