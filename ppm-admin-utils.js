(function () {
  "use strict";

  const KEYS = Object.freeze({
    portfolios: "ppmPortfolios",
    lifecycleTemplates: "ppmLifecycleTemplates",
    referenceData: "ppmReferenceData",
    mandatoryRules: "ppmLifecycleMandatoryRules",
    ragConfig: "ppmRagConfig",
    reportingCalendars: "ppmReportingCalendars",
    reportingPeriods: "ppmReportingPeriods",
    schemaVersion: "ppmAdminSchemaVersion"
  });

  const SCHEMA_VERSION = 2;
  const DEFAULT_STAGE_NAMES = Object.freeze([
    "Intake",
    "Discovery",
    "Requirements and Design",
    "Build",
    "Test",
    "Implementation",
    "Hypercare",
    "Closure"
  ]);

  const DEFAULT_RAG_CONFIG = Object.freeze({
    scheduleAmberToleranceDays: 5,
    scheduleRedToleranceDays: 20,
    resourceAmberUtilisation: 100,
    resourceRedUtilisation: 115,
    financialAmberVariance: 5,
    financialRedVariance: 10,
    underUtilisationThreshold: 70
  });

  const REFERENCE_DEFINITIONS = Object.freeze({
    projectTypes: {
      label: "Project types",
      values: ["Change project", "Regulatory", "Technology", "Product", "Operational", "M&A", "BAU"]
    },
    businessAreas: {
      label: "Business areas",
      values: [
        "Servicing",
        "Sales",
        "Propositions",
        "Mergers & Acquisitions",
        "Operations",
        "Technology",
        "Finance",
        "People",
        "Risk & Compliance"
      ]
    },
    confidentialityLevels: {
      label: "Confidentiality levels",
      values: ["Internal", "Confidential", "Highly Confidential", "Restricted"]
    },
    priorities: { label: "Priorities", values: ["Critical", "High", "Medium", "Low"] },
    projectStatuses: {
      label: "Project statuses",
      values: ["Proposed", "Planned", "Active", "On Hold", "Completed", "Cancelled", "Archived"]
    },
    reportingFrequencies: {
      label: "Reporting frequencies",
      values: ["Weekly", "Fortnightly", "Monthly", "Quarterly"]
    },
    ragStatuses: { label: "RAG statuses", values: ["Not Assessed", "Green", "Amber", "Red"] },
    raidTypes: { label: "RAID types", values: ["Risk", "Assumption", "Issue", "Dependency"] },
    taskStatuses: {
      label: "Task statuses",
      values: ["Not Started", "In Progress", "Blocked", "Complete", "Cancelled"]
    },
    milestoneStatuses: {
      label: "Milestone statuses",
      values: ["Not Started", "In Progress", "Complete", "Overdue", "Cancelled"]
    },
    benefitTypes: {
      label: "Benefit types",
      values: ["Financial", "Customer", "Operational", "Risk reduction", "Regulatory", "People"]
    },
    financialYears: { label: "Financial years", values: ["April to March", "January to December"] }
  });

  const clone = PPMCore.clone;

  const parseJson = (value, fallback) => PPMCore.parseJson(value, fallback, "PPM administration data");

  /*
    Administration deliberately reads and writes the unfiltered store.

    Most keys here are configuration (portfolios, lifecycle templates, reference
    lists, calendars) which is not project-scoped at all. The exceptions are
    ppmProjects and ppmProgrammes, which reconcileProgrammeMembership() and
    migrateLegacyProjectLifecycleAssignments() rewrite wholesale. Those must read
    and write the complete list: if a project-scoped user reconciled against a
    filtered view, saving would drop every project they cannot see.

    Reads and writes must therefore use the same unfiltered path — never mix.
  */
  function read(key, fallback) {
    if (window.PPMAuth && typeof window.PPMAuth.readGlobal === "function") {
      const value = window.PPMAuth.readGlobal(
        key,
        clone(fallback),
        "administration reconciles whole collections and must not drop out-of-scope records when saving"
      );
      return value === undefined || value === null ? clone(fallback) : value;
    }
    return parseJson(localStorage.getItem(key), fallback);
  }

  /*
    Stage 16: the second write seam is gone.

    This used PPMAuth.writeGlobal, which existed specifically to bypass the patched
    localStorage - and that is exactly what caused the Stage 12 bug. The child adapter hooked
    only Storage.prototype.setItem, so every configuration store here saved locally and never
    reached PostgreSQL, with no error anywhere: lifecycle templates, reference data, mandatory
    rules, RAG thresholds, calendars and periods, all silently browser-only.

    A design needing two independent interceptions to stay in step will eventually have one of
    them missing. There is one way in now, and it says what happened.

    The collection is looked up from the key rather than mapped by hand, so adding a
    configuration store to an adapter is all it takes to make it writable.
  */
  async function rawWrite(key, value) {
    if (!window.PPMStore) {
      return {
        ok: false,
        reason: "failed",
        message: "The data layer is not loaded on this page, so nothing was saved.",
        queued: false
      };
    }
    const collection = window.PPMStore.collectionFor(key);
    if (!collection) {
      return {
        ok: false,
        reason: "invalid",
        message: `No collection is registered for "${key}", so it cannot be saved.`,
        queued: false
      };
    }
    return window.PPMStore.replaceAll(collection, value);
  }

  /*
    The change event now fires only after the database has accepted the write. It used to fire
    regardless, so every listener redrew itself from a value that might never have been saved.
  */
  async function write(key, value, detail) {
    const result = await rawWrite(key, value);
    if (!result.ok) return result;
    window.dispatchEvent(
      new CustomEvent("ppm-admin-changed", {
        detail: { key, value: clone(value), ...(detail || {}) }
      })
    );
    return result;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  const todayIso = PPMCore.todayIso;

  function isoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(value, days) {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    if (!date) return "";
    date.setDate(date.getDate() + Number(days || 0));
    return isoDate(date);
  }

  function uid(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  function nextSequentialId(prefix, rows, field, width) {
    const highest = (Array.isArray(rows) ? rows : []).reduce((maximum, row) => {
      const match = String((row && row[field]) || "").match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
      return Math.max(maximum, match ? Number(match[1]) : 0);
    }, 0);
    return `${prefix}-${String(highest + 1).padStart(width || 5, "0")}`;
  }

  function actorName() {
    const user =
      window.PPMAuth && typeof window.PPMAuth.getCurrentUser === "function"
        ? window.PPMAuth.getCurrentUser()
        : null;
    return String((user && (user.fullName || user.name || user.email)) || "Prototype administrator");
  }


  /*
    Returns the database result with the saved value attached. It used to return the value
    alone, which is why every caller simply passed it on - there was nothing else to report.
    There is now, and a caller that ignores result.ok is one that will tell somebody their
    configuration was saved when it was refused.
  */
  async function saveCollection(key, value, entityType, options) {
    void (options || {});
    const result = await write(key, value, { entityType });
    return { ...result, value: clone(value) };
  }

  function defaultPortfolio() {
    const timestamp = nowIso();
    return {
      portfolioId: "PORT-00001",
      name: "Foresters Portfolio",
      description: "Foresters Financial UK change portfolio.",
      owner: "",
      ownerResourceId: "",
      ownerEmail: "",
      executiveSponsor: "",
      executiveSponsorResourceId: "",
      executiveSponsorEmail: "",
      status: "Active",
      active: true,
      reportingCalendarId: "CAL-00001",
      financialYearStartMonth: 4,
      financialYear: currentFinancialYear(4),
      lifecycleTemplateId: "LIFE-00001",
      defaultReportingFrequency: "Monthly",
      currentReportingPeriodId: "",
      programmeIds: [],
      objectives: "",
      priorities: "",
      budget: 0,
      currency: "GBP",
      risks: [],
      issues: [],
      dependencies: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function currentFinancialYear(startMonth) {
    const now = new Date();
    const monthIndex = Math.min(12, Math.max(1, Number(startMonth || 1))) - 1;
    const startYear = now.getMonth() >= monthIndex ? now.getFullYear() : now.getFullYear() - 1;
    return `${startYear}/${String(startYear + 1).slice(-2)}`;
  }

  function normalisePerson(record, prefix) {
    return {
      [`${prefix}`]: String((record && record[prefix]) || "").trim(),
      [`${prefix}ResourceId`]: String((record && record[`${prefix}ResourceId`]) || "").trim(),
      [`${prefix}Email`]: String((record && record[`${prefix}Email`]) || "").trim()
    };
  }

  function normaliseStringList(value) {
    if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
    return String(value || "")
      .split(/\r?\n|\s*;\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalisePortfolio(row, index) {
    const base = defaultPortfolio();
    const source = row && typeof row === "object" ? row : {};
    const portfolioId = String(
      source.portfolioId || source.id || `PORT-${String(index + 1).padStart(5, "0")}`
    ).trim();
    return {
      ...base,
      ...source,
      ...normalisePerson(source, "owner"),
      ...normalisePerson(source, "executiveSponsor"),
      portfolioId,
      name: String(source.name || `Portfolio ${index + 1}`).trim(),
      description: String(source.description || "").trim(),
      status: String(source.status || (source.active === false ? "Inactive" : "Active")),
      active: source.active !== false && source.status !== "Inactive",
      financialYearStartMonth: Math.min(12, Math.max(1, Number(source.financialYearStartMonth || 4))),
      financialYear: String(
        source.financialYear || currentFinancialYear(source.financialYearStartMonth || 4)
      ),
      currentReportingPeriodId: String(source.currentReportingPeriodId || source.reportingPeriodId || ""),
      programmeIds: Array.isArray(source.programmeIds) ? source.programmeIds.map(String) : [],
      budget: Number(source.budget || 0),
      currency: String(source.currency || "GBP"),
      risks: normaliseStringList(source.risks || source.portfolioRisks),
      issues: normaliseStringList(source.issues || source.portfolioIssues),
      dependencies: normaliseStringList(source.dependencies || source.portfolioDependencies),
      createdAt: source.createdAt || base.createdAt,
      updatedAt: source.updatedAt || base.updatedAt
    };
  }

  function getPortfolios() {
    const stored = read(KEYS.portfolios, null);
    const rows = Array.isArray(stored) && stored.length ? stored : [defaultPortfolio()];
    const normalised = rows.filter(Boolean).map(normalisePortfolio);
    const programmes = read("ppmProgrammes", []);
    if (Array.isArray(programmes)) {
      normalised.forEach((portfolio) => {
        portfolio.programmeIds = [];
      });
      programmes.forEach((programme) => {
        const programmeId = String((programme && (programme.programmeId || programme.workstreamId)) || "");
        const match =
          normalised.find((portfolio) => portfolio.portfolioId === programme.portfolioId) ||
          normalised.find(
            (portfolio) =>
              String(portfolio.name).toLowerCase() === String(programme.portfolio || "").toLowerCase()
          );
        if (programmeId && match && !match.programmeIds.includes(programmeId))
          match.programmeIds.push(programmeId);
      });
    }
    if (
      !Array.isArray(stored) ||
      !stored.length ||
      JSON.stringify(rows.filter(Boolean).map(normalisePortfolio)) !== JSON.stringify(normalised)
    ) {
    /* Stage 16: derived only. seedDefaults() is what persists the defaults, once. */
    }
    return clone(normalised);
  }

  /* Stage 16: async, because it writes. Both callers await it. */
  async function syncProgrammePortfolioReferences(portfolios) {
    const programmes = read("ppmProgrammes", []);
    if (!Array.isArray(programmes) || !programmes.length) return;
    const portfolioByProgramme = new Map();
    portfolios.forEach((portfolio) =>
      (portfolio.programmeIds || []).forEach((programmeId) =>
        portfolioByProgramme.set(String(programmeId), portfolio)
      )
    );
    let changed = false;
    programmes.forEach((programme) => {
      const programmeId = String(programme.programmeId || programme.workstreamId || "");
      const selected = portfolioByProgramme.get(programmeId);
      const managedPortfolio = portfolios.find(
        (portfolio) =>
          portfolio.portfolioId === programme.portfolioId ||
          String(portfolio.name).toLowerCase() === String(programme.portfolio || "").toLowerCase()
      );
      if (
        selected &&
        (programme.portfolioId !== selected.portfolioId || programme.portfolio !== selected.name)
      ) {
        programme.portfolioId = selected.portfolioId;
        programme.portfolio = selected.name;
        programme.updatedAt = nowIso();
        changed = true;
      } else if (!selected && managedPortfolio && (programme.portfolioId || programme.portfolio)) {
        programme.portfolioId = "";
        programme.portfolio = "";
        programme.updatedAt = nowIso();
        changed = true;
      }
    });
    if (changed) return rawWrite("ppmProgrammes", programmes);
    return { ok: true, saved: 0, nothingToDo: true };
  }

  async function savePortfolios(rows, options) {
    let values = (Array.isArray(rows) ? rows : [])
      .filter(Boolean)
      .map((row, index) => normalisePortfolio({ ...row, updatedAt: row.updatedAt || nowIso() }, index));
    const preferredId = String((options && options.entityId) || "");
    const ordered = preferredId
      ? [
          ...values.filter((row) => row.portfolioId === preferredId),
          ...values.filter((row) => row.portfolioId !== preferredId)
        ]
      : values;
    const assignedProgrammeIds = new Set();
    ordered.forEach((portfolio) => {
      portfolio.programmeIds = (portfolio.programmeIds || []).filter((programmeId) => {
        const id = String(programmeId);
        if (!id || assignedProgrammeIds.has(id)) return false;
        assignedProgrammeIds.add(id);
        return true;
      });
    });
    values = values.map(
      (portfolio) => ordered.find((row) => row.portfolioId === portfolio.portfolioId) || portfolio
    );
    const saved = await saveCollection(KEYS.portfolios, values, "Portfolio", options);
    if (!saved.ok) return saved;
    const synced = await syncProgrammePortfolioReferences(saved.value);
    if (synced && synced.ok === false) return synced;
    const reconciled = await reconcileProgrammeMembership();
    if (reconciled && reconciled.ok === false) return reconciled;
    return { ...saved, value: reconciled.portfolios };
  }

  /*
    Stage 16: async, and every write inside is awaited. It brings portfolios, programmes and
    projects into line with each other, so three writes have to succeed - and a caller now
    learns if one of them did not, rather than the screen showing a membership the database
    never accepted.
  */
  async function reconcileProgrammeMembership() {
    const storedPortfolios = read(KEYS.portfolios, null);
    const portfolios = (
      Array.isArray(storedPortfolios) && storedPortfolios.length ? storedPortfolios : [defaultPortfolio()]
    )
      .filter(Boolean)
      .map(normalisePortfolio);
    const programmes = read("ppmProgrammes", []);
    if (!Array.isArray(programmes)) return { portfolios: clone(portfolios), programmes: [], projects: [] };
    portfolios.forEach((portfolio) => {
      portfolio.programmeIds = [];
    });
    let programmesChanged = false;
    programmes.forEach((programme) => {
      const programmeId = String((programme && (programme.programmeId || programme.workstreamId)) || "");
      const portfolio =
        portfolios.find((row) => row.portfolioId === programme.portfolioId) ||
        portfolios.find(
          (row) => String(row.name).toLowerCase() === String(programme.portfolio || "").toLowerCase()
        );
      if (!programmeId || !portfolio) return;
      if (!portfolio.programmeIds.includes(programmeId)) portfolio.programmeIds.push(programmeId);
      if (programme.portfolioId !== portfolio.portfolioId || programme.portfolio !== portfolio.name) {
        programme.portfolioId = portfolio.portfolioId;
        programme.portfolio = portfolio.name;
        programme.updatedAt = nowIso();
        programmesChanged = true;
      }
    });
    const portfolioResult = await rawWrite(KEYS.portfolios, portfolios);
    if (!portfolioResult.ok) return { ...portfolioResult, portfolios };
    if (programmesChanged) {
      const programmeResult = await rawWrite("ppmProgrammes", programmes);
      if (!programmeResult.ok) return { ...programmeResult, portfolios };
    }

    const projects = read("ppmProjects", []);
    let projectsChanged = false;
    if (Array.isArray(projects)) {
      projects.forEach((project) => {
        const programme =
          programmes.find(
            (row) => String(row.programmeId || row.workstreamId || "") === String(project.programmeId || "")
          ) ||
          programmes.find(
            (row) =>
              String(row.name || row.workstream || "").toLowerCase() ===
              String(project.programme || project.workstream || "").toLowerCase()
          );
        if (!programme) return;
        const portfolio =
          portfolios.find((row) => row.portfolioId === programme.portfolioId) ||
          portfolios.find(
            (row) => String(row.name).toLowerCase() === String(programme.portfolio || "").toLowerCase()
          );
        if (
          !portfolio ||
          (project.portfolioId === portfolio.portfolioId && project.portfolio === portfolio.name)
        )
          return;
        project.portfolioId = portfolio.portfolioId;
        project.portfolio = portfolio.name;
        project.updatedAt = nowIso();
        projectsChanged = true;
      });
      if (projectsChanged) {
        const projectResult = await rawWrite("ppmProjects", projects);
        if (!projectResult.ok) return { ...projectResult, portfolios };
      }
    }
    return {
      portfolios: clone(portfolios),
      programmes: clone(programmes),
      projects: clone(Array.isArray(projects) ? projects : [])
    };
  }

  function findPortfolio(portfolioIdOrName) {
    const target = String(portfolioIdOrName || "")
      .trim()
      .toLowerCase();
    return (
      getPortfolios().find(
        (row) => String(row.portfolioId).toLowerCase() === target || String(row.name).toLowerCase() === target
      ) || null
    );
  }

  function nextPortfolioId(rows) {
    return nextSequentialId("PORT", rows || getPortfolios(), "portfolioId", 5);
  }

  function stageSlug(name) {
    return (
      String(name || "stage")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "STAGE"
    );
  }

  function defaultStages() {
    return DEFAULT_STAGE_NAMES.map((name, index) => ({
      stageId: `STG-${stageSlug(name)}`,
      name,
      order: index + 1,
      active: true,
      gateRequired: index > 0,
      gateName: index === 0 ? "" : `${name} gate`,
      description: ""
    }));
  }

  function defaultLifecycleTemplate() {
    const timestamp = nowIso();
    return {
      templateId: "LIFE-00001",
      name: "Standard project lifecycle",
      description: "Default Foresters lifecycle from intake through closure.",
      applicableProjectTypes: ["*"],
      stages: defaultStages(),
      active: true,
      isDefault: true,
      version: 1,
      effectiveFrom: todayIso(),
      createdAt: timestamp,
      updatedAt: timestamp,
      versions: []
    };
  }

  function normaliseStage(stage, index) {
    const source = stage && typeof stage === "object" ? stage : {};
    const name = String(source.name || source.stageName || `Stage ${index + 1}`).trim();
    return {
      ...source,
      stageId: String(source.stageId || `STG-${stageSlug(name)}-${index + 1}`).trim(),
      name,
      order: Number(source.order || index + 1),
      active: source.active !== false,
      gateRequired: Boolean(source.gateRequired),
      gateName: String(source.gateName || "").trim(),
      description: String(source.description || "").trim()
    };
  }

  function normaliseTemplate(row, index) {
    const base = defaultLifecycleTemplate();
    const source = row && typeof row === "object" ? row : {};
    const stages = (Array.isArray(source.stages) && source.stages.length ? source.stages : defaultStages())
      .filter(Boolean)
      .map(normaliseStage)
      .sort((a, b) => a.order - b.order)
      .map((stage, stageIndex) => ({ ...stage, order: stageIndex + 1 }));
    return {
      ...base,
      ...source,
      templateId: String(source.templateId || `LIFE-${String(index + 1).padStart(5, "0")}`).trim(),
      name: String(source.name || `Lifecycle template ${index + 1}`).trim(),
      description: String(source.description || "").trim(),
      applicableProjectTypes:
        Array.isArray(source.applicableProjectTypes) && source.applicableProjectTypes.length
          ? source.applicableProjectTypes.map(String)
          : ["*"],
      stages,
      active: source.active !== false,
      isDefault: Boolean(source.isDefault),
      version: Math.max(1, Number(source.version || 1)),
      versions: Array.isArray(source.versions) ? source.versions : [],
      createdAt: source.createdAt || base.createdAt,
      updatedAt: source.updatedAt || base.updatedAt
    };
  }

  function getLifecycleTemplates() {
    const stored = read(KEYS.lifecycleTemplates, null);
    let rows = Array.isArray(stored) && stored.length ? stored : [defaultLifecycleTemplate()];
    rows = rows.filter(Boolean).map(normaliseTemplate);
    if (!rows.some((row) => row.isDefault && row.active)) {
      const firstActive = rows.find((row) => row.active) || rows[0];
      if (firstActive) firstActive.isDefault = true;
    }
    /* Stage 16: derived only. seedDefaults() is what persists the defaults, once. */
    return clone(rows);
  }

  async function saveLifecycleTemplates(rows, options) {
    let values = (Array.isArray(rows) ? rows : []).filter(Boolean).map(normaliseTemplate);
    const defaultId =
      values.find((row) => row.isDefault && row.active)?.templateId ||
      values.find((row) => row.active)?.templateId;
    values = values.map((row) => ({ ...row, isDefault: row.templateId === defaultId }));
    return saveCollection(KEYS.lifecycleTemplates, values, "Lifecycle template", options);
  }

  function nextLifecycleTemplateId(rows) {
    return nextSequentialId("LIFE", rows || getLifecycleTemplates(), "templateId", 5);
  }

  function getTemplateForProject(project) {
    const allTemplates = getLifecycleTemplates();
    const templates = allTemplates.filter((row) => row.active);
    if (!allTemplates.length) return null;
    const source = project && typeof project === "object" ? project : {};
    const explicit = allTemplates.find((row) => row.templateId === source.lifecycleTemplateId);
    if (explicit) {
      const requestedVersion = Number(source.lifecycleTemplateVersion || explicit.version);
      if (requestedVersion !== Number(explicit.version)) {
        const snapshot = (explicit.versions || []).find((row) => Number(row.version) === requestedVersion);
        if (snapshot)
          return clone({
            ...explicit,
            ...snapshot,
            templateId: explicit.templateId,
            version: requestedVersion,
            active: false,
            isHistoricalVersion: true,
            versions: explicit.versions
          });
      }
      return explicit;
    }
    const portfolio =
      getPortfolios().find((row) => row.portfolioId === source.portfolioId) ||
      getPortfolios().find(
        (row) => String(row.name).toLowerCase() === String(source.portfolio || "").toLowerCase()
      );
    const portfolioTemplate =
      portfolio &&
      allTemplates.find((row) => row.templateId === portfolio.lifecycleTemplateId && row.active !== false);
    if (portfolioTemplate) return portfolioTemplate;
    const projectType = String(source.projectType || "")
      .trim()
      .toLowerCase();
    const matched =
      projectType &&
      templates.find((row) =>
        row.applicableProjectTypes.some((value) => String(value).toLowerCase() === projectType)
      );
    return matched || templates.find((row) => row.isDefault) || templates[0] || allTemplates[0];
  }

  function projectStages(projectOrTemplateId) {
    const templates = getLifecycleTemplates();
    let template;
    if (typeof projectOrTemplateId === "string")
      template = templates.find((row) => row.templateId === projectOrTemplateId);
    else template = getTemplateForProject(projectOrTemplateId || {});
    template = template || templates.find((row) => row.isDefault) || templates[0];
    return clone(
      ((template && template.stages) || [])
        .filter((stage) => stage.active !== false)
        .sort((a, b) => a.order - b.order)
    );
  }

  function deriveLegacyProjectLifecycleAssignments(projectRows) {
    const supplied = Array.isArray(projectRows);
    const stored = supplied ? projectRows : read("ppmProjects", null);
    if (!Array.isArray(stored)) return [];
    const projects = clone(stored);
    const templates = getLifecycleTemplates();
    const activeTemplates = templates.filter((row) => row.active !== false);
    const portfolios = getPortfolios();
    let changed = false;
    projects.forEach((project) => {
      if (!project || typeof project !== "object") return;
      const explicitTemplateId = String(project.lifecycleTemplateId || "").trim();
      let template = templates.find((row) => row.templateId === explicitTemplateId);
      let assignmentSource = "explicit";
      if (!explicitTemplateId) {
        const portfolio =
          portfolios.find((row) => row.portfolioId === project.portfolioId) ||
          portfolios.find(
            (row) => String(row.name).toLowerCase() === String(project.portfolio || "").toLowerCase()
          );
        template =
          portfolio &&
          templates.find((row) => row.templateId === portfolio.lifecycleTemplateId && row.active !== false);
        assignmentSource = template ? "portfolio-default" : "project-type-default";
        if (!template) {
          const projectType = String(project.projectType || "")
            .trim()
            .toLowerCase();
          template =
            projectType &&
            activeTemplates.find((row) =>
              (row.applicableProjectTypes || []).some((value) => String(value).toLowerCase() === projectType)
            );
        }
        template =
          template || activeTemplates.find((row) => row.isDefault) || activeTemplates[0] || templates[0];
        if (template) {
          project.lifecycleTemplateId = template.templateId;
          changed = true;
        }
      }
      const explicitVersion = Number(project.lifecycleTemplateVersion);
      if (template && (!Number.isFinite(explicitVersion) || explicitVersion < 1)) {
        project.lifecycleTemplateVersion = Number(template.version || 1);
        changed = true;
      }
      if ((!explicitTemplateId || !Number.isFinite(explicitVersion) || explicitVersion < 1) && template) {
        if (!project.lifecycleAssignmentMigratedAt) project.lifecycleAssignmentMigratedAt = nowIso();
        if (!project.lifecycleAssignmentSource) project.lifecycleAssignmentSource = assignmentSource;
      }
    });
    /*
      Stage 16: pure. This used to persist whichever way it had been called - straight to
      localStorage when handed rows, through the writeGlobal seam when not. Two write paths
      inside one function that four external call sites use inline, in expressions, and none
      of them could have awaited either.
    */
    return { projects: clone(projects), changed };
  }

  /* The old name and the old contract: returns the migrated projects, writes nothing. */
  function migrateLegacyProjectLifecycleAssignments(projectRows) {
    return deriveLegacyProjectLifecycleAssignments(projectRows).projects;
  }

  /* The write half, called from seedDefaults(). */
  async function backfillLegacyProjectLifecycleAssignments(projectRows) {
    const { projects, changed } = deriveLegacyProjectLifecycleAssignments(projectRows);
    if (!changed) return { ok: true, saved: 0, nothingToDo: true };
    if (!window.PPMStore) {
      return { ok: false, reason: "failed", message: "The data layer is not loaded on this page.", queued: false };
    }
    return window.PPMStore.projects.replaceAll(projects);
  }

  function referenceRow(category, value, index) {
    const categoryCode = String(category || "REF")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[^a-z0-9]+/gi, "-")
      .toUpperCase();
    return {
      referenceId: `REF-${categoryCode}-${String(index + 1).padStart(3, "0")}`,
      code: String(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_|_$/g, ""),
      value: String(value),
      label: String(value),
      active: true,
      sortOrder: (index + 1) * 10
    };
  }

  function defaultReferenceData() {
    return Object.fromEntries(
      Object.entries(REFERENCE_DEFINITIONS).map(([category, definition]) => [
        category,
        definition.values.map((value, index) => referenceRow(category, value, index))
      ])
    );
  }

  function normaliseReferenceData(source) {
    const defaults = defaultReferenceData();
    const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const categories = new Set([...Object.keys(defaults), ...Object.keys(input)]);
    return Object.fromEntries(
      [...categories].map((category) => {
        const rows = Array.isArray(input[category]) ? input[category] : defaults[category] || [];
        return [
          category,
          rows
            .filter(Boolean)
            .map((row, index) => {
              const value = typeof row === "string" ? row : row.value || row.label || row.code || "";
              return {
                ...referenceRow(category, value, index),
                ...(typeof row === "object" ? row : {}),
                value: String(value),
                label: String((typeof row === "object" && row.label) || value),
                active: typeof row === "object" ? row.active !== false : true,
                sortOrder: Number((typeof row === "object" && row.sortOrder) || (index + 1) * 10)
              };
            })
            .sort((a, b) => a.sortOrder - b.sortOrder)
        ];
      })
    );
  }

  function getReferenceData() {
    const stored = read(KEYS.referenceData, null);
    const values = normaliseReferenceData(stored || defaultReferenceData());
    /* Stage 16: derived only. seedDefaults() is what persists the defaults, once. */
    return clone(values);
  }

  async function saveReferenceData(value, options) {
    return saveCollection(KEYS.referenceData, normaliseReferenceData(value), "Reference data", options);
  }

  function getReferenceValues(category, options) {
    const settings = options || {};
    const rows = getReferenceData()[category] || [];
    return clone(
      rows
        .filter((row) => settings.includeInactive || row.active !== false)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    );
  }

  function referenceCategories() {
    const data = getReferenceData();
    return Object.keys(data).map((key) => ({
      key,
      label:
        REFERENCE_DEFINITIONS[key]?.label ||
        key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())
    }));
  }

  const FIELD_LABELS = Object.freeze({
    projectName: "Project name",
    requestor: "Requestor",
    projectType: "Project type",
    businessArea: "Business area",
    businessProblem: "Business problem",
    desiredOutcome: "Desired outcome",
    highLevelScope: "High-level scope",
    workstream: "Programme / workstream",
    sponsor: "Sponsor",
    sponsorConfirmationStatus: "Confirmed sponsor",
    projectManager: "Project manager",
    projectLead: "Project lead",
    strategicObjective: "Detailed objectives",
    inScope: "Detailed scope",
    outOfScope: "Scope exclusions",
    additionalStakeholders: "Stakeholders",
    assumptionsConstraints: "Assumptions and constraints",
    initialRaidSummary: "Initial RAID",
    indicativeCosts: "Indicative costs",
    resourceDemandSummary: "Indicative resource demand",
    expectedBenefits: "Initial benefits",
    discoveryDeliverables: "Discovery deliverables",
    targetImplementationDate: "Indicative delivery date",
    priority: "Initial priority",
    initialResourceRequirements: "Initial resource requirements",
    objectives: "Objectives",
    scope: "Scope",
    strategicDrivers: "Strategic drivers",
    requirementsApprovalStatus: "Approved requirements",
    solutionOptions: "Solution options",
    deliveryPlanSummary: "Confirmed delivery plan",
    detailedResourceDemand: "Detailed resource demand",
    costEstimate: "Cost estimate",
    deliveryDependencies: "Delivery dependencies",
    operationalReadinessRequirements: "Operational-readiness requirements",
    implementationApproach: "Implementation approach",
    benefitMeasures: "Benefit measures",
    baselineStartDate: "Baseline start date",
    baselineEndDate: "Baseline end date",
    forecastStartDate: "Forecast start date",
    forecastEndDate: "Forecast end date",
    fundingSource: "Funding source",
    financialOwner: "Financial owner",
    budget: "Approved budget",
    benefitOwner: "Benefit owner",
    benefits: "Expected benefits",
    solutionDesign: "Solution design",
    deliveryApproach: "Delivery approach",
    testApproach: "Test approach",
    baselineApprovalStatus: "Approved baseline",
    testDatesStatus: "Test dates and status",
    defectsBlockers: "Defects or delivery blockers",
    deploymentDependencies: "Deployment dependencies",
    goLiveCriteria: "Go-live criteria",
    implementationPlan: "Implementation plan",
    operationalReadiness: "Operational readiness assessment",
    approvedImplementationDate: "Approved implementation date",
    goLiveApprovalStatus: "Go-live approval",
    operationalReadinessStatus: "Operational-readiness status",
    trainingStatus: "Training status",
    communicationsStatus: "Communications status",
    supportModel: "Support model",
    hypercarePlan: "Hypercare plan",
    rollbackPlan: "Rollback plan",
    outstandingRisksIssues: "Outstanding risks and issues",
    actualStartDate: "Actual start date",
    actualEndDate: "Actual end date",
    closureSummary: "Closure summary",
    finalFinancialPosition: "Final financial position",
    outstandingActions: "Outstanding actions",
    benefitsHandover: "Benefits handover",
    lessonsLearned: "Lessons learned",
    closureApproval: "Closure approval",
    closureApprovalStatus: "Closure approval",
    archiveLocation: "Archive location"
  });

  function mandatoryRule(templateId, stage, fieldId, options) {
    const settings = options || {};
    return {
      ruleId: `RULE-${templateId}-${stageSlug(stage)}-${stageSlug(fieldId)}`,
      templateId,
      templateVersion: Math.max(1, Number(settings.templateVersion || 1)),
      projectType: settings.projectType || "*",
      stage,
      stageId: settings.stageId || `STG-${stageSlug(stage)}`,
      fieldId,
      label: settings.label || FIELD_LABELS[fieldId] || fieldId,
      required: settings.required !== false,
      active: settings.active !== false,
      guidance: settings.guidance || "",
      anyFieldIds: Array.isArray(settings.anyFieldIds) ? settings.anyFieldIds.map(String) : [],
      validValues: Array.isArray(settings.validValues) ? settings.validValues.map(String) : [],
      invalidValues: Array.isArray(settings.invalidValues) ? settings.invalidValues.map(String) : [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  function defaultMandatoryRules() {
    const templateId = "LIFE-00001";
    const definitions = {
      Intake: [
        "projectName",
        "requestor",
        "businessArea",
        "businessProblem",
        "desiredOutcome",
        "highLevelScope",
        "sponsor",
        { fieldId: "strategicDrivers", anyFieldIds: ["strategicDriver", "regulatoryDriver"] },
        "targetImplementationDate",
        { fieldId: "priority", invalidValues: ["", "Not Set"] },
        "initialResourceRequirements"
      ],
      Discovery: [
        { fieldId: "sponsorConfirmationStatus", validValues: ["Confirmed"] },
        "projectLead",
        "projectManager",
        "strategicObjective",
        "inScope",
        "outOfScope",
        "additionalStakeholders",
        "assumptionsConstraints",
        "initialRaidSummary",
        "indicativeCosts",
        "resourceDemandSummary",
        "expectedBenefits",
        "discoveryDeliverables"
      ],
      "Requirements and Design": [
        { fieldId: "requirementsApprovalStatus", validValues: ["Approved"] },
        "solutionOptions",
        "deliveryPlanSummary",
        "baselineStartDate",
        "baselineEndDate",
        "detailedResourceDemand",
        "costEstimate",
        "deliveryDependencies",
        "testApproach",
        "operationalReadinessRequirements",
        "implementationApproach",
        "benefitMeasures"
      ],
      Build: [
        { fieldId: "baselineApprovalStatus", validValues: ["Approved"] },
        "testDatesStatus",
        "defectsBlockers",
        "deploymentDependencies",
        "goLiveCriteria"
      ],
      Test: [],
      Implementation: [
        "approvedImplementationDate",
        { fieldId: "goLiveApprovalStatus", validValues: ["Approved", "Conditionally Approved"] },
        { fieldId: "operationalReadinessStatus", validValues: ["Ready"] },
        "trainingStatus",
        "communicationsStatus",
        "supportModel",
        "hypercarePlan",
        "rollbackPlan",
        "outstandingRisksIssues"
      ],
      Hypercare: [],
      Closure: [
        "actualEndDate",
        "closureSummary",
        "finalFinancialPosition",
        "outstandingActions",
        "benefitsHandover",
        "lessonsLearned",
        { fieldId: "closureApprovalStatus", validValues: ["Approved"] },
        "archiveLocation"
      ]
    };
    return Object.entries(definitions).flatMap(([stage, fields]) =>
      fields.map((definition) => {
        const fieldId = typeof definition === "string" ? definition : definition.fieldId;
        return mandatoryRule(templateId, stage, fieldId, typeof definition === "string" ? {} : definition);
      })
    );
  }

  function normaliseRule(row, index, fallbackVersion) {
    const source = row && typeof row === "object" ? row : {};
    const templateId = String(source.templateId || "LIFE-00001");
    const stage = String(source.stage || source.stageName || "Intake");
    const fieldId = String(source.fieldId || `customField${index + 1}`);
    const templateVersion = Math.max(1, Number(source.templateVersion || fallbackVersion || 1));
    return {
      ...mandatoryRule(templateId, stage, fieldId, { templateVersion }),
      ...source,
      ruleId: String(source.ruleId || uid("RULE")),
      templateId,
      templateVersion,
      projectType: String(source.projectType || "*"),
      stage,
      stageId: String(source.stageId || `STG-${stageSlug(stage)}`),
      fieldId,
      label: String(source.label || FIELD_LABELS[fieldId] || fieldId),
      required: source.required !== false,
      active: source.active !== false
    };
  }

  function getMandatoryRules() {
    const stored = read(KEYS.mandatoryRules, null);
    const templates = getLifecycleTemplates();
    const templateVersions = Object.fromEntries(
      templates.map((row) => [row.templateId, Number(row.version || 1)])
    );
    const sourceRows = Array.isArray(stored) && stored.length ? stored : defaultMandatoryRules();
    const versionMigrationRequired = sourceRows.some((row) => !row || !Number(row.templateVersion));
    const rows = sourceRows
      .filter(Boolean)
      .map((row, index) => normaliseRule(row, index, templateVersions[row.templateId || "LIFE-00001"] || 1));
    /*
      Stage 16: derived only. seedDefaults() persists the defaults, once.

      The seeding write that used to be here was the body of a brace-less `if`. Replacing just
      that line with a comment left the `if` with no body of its own, so `return clone(rows)`
      became its body - and this function returned undefined whenever rules already existed,
      which is every populated portfolio. Callers filter what it returns, so the project list
      and the lifecycle readiness section both failed with "cannot read properties of undefined".
      A condition with no braces is one careless edit from silently swallowing the next line.
    */
    void versionMigrationRequired;
    return clone(rows);
  }

  async function saveMandatoryRules(rows, options) {
    const templateVersions = Object.fromEntries(
      getLifecycleTemplates().map((row) => [row.templateId, Number(row.version || 1)])
    );
    const values = (Array.isArray(rows) ? rows : [])
      .filter(Boolean)
      .map((row, index) =>
        normaliseRule({ ...row, updatedAt: nowIso() }, index, templateVersions[row.templateId] || 1)
      );
    return saveCollection(KEYS.mandatoryRules, values, "Lifecycle mandatory rule", options);
  }

  function getMandatoryRulesForTemplateVersion(templateId, templateVersion) {
    const templates = getLifecycleTemplates();
    const template =
      templates.find((row) => row.templateId === templateId) ||
      templates.find((row) => row.isDefault) ||
      templates[0];
    if (!template) return [];
    const resolvedVersion = Math.max(1, Number(templateVersion || template.version || 1));
    const allRules = getMandatoryRules();
    let rows = allRules.filter(
      (rule) =>
        rule.templateId === template.templateId && Number(rule.templateVersion || 1) === resolvedVersion
    );
    if (!rows.length && resolvedVersion !== Number(template.version || 1)) {
      const snapshot = (template.versions || []).find((row) => Number(row.version) === resolvedVersion);
      if (Array.isArray(snapshot && snapshot.mandatoryRules))
        rows = snapshot.mandatoryRules.map((row, index) =>
          normaliseRule(
            { ...row, templateId: template.templateId, templateVersion: resolvedVersion },
            index,
            resolvedVersion
          )
        );
    }
    if (!rows.length && resolvedVersion === Number(template.version || 1)) {
      const availableVersions = allRules
        .filter((rule) => rule.templateId === template.templateId)
        .map((rule) => Number(rule.templateVersion || 1))
        .filter((version) => version < resolvedVersion);
      const latestInheritedVersion = availableVersions.length ? Math.max(...availableVersions) : 0;
      if (latestInheritedVersion) {
        const stageById = new Map(
          (template.stages || []).map((stage) => [String(stage.stageId || ""), stage])
        );
        const stageByName = new Map(
          (template.stages || []).map((stage) => [String(stage.name || "").toLowerCase(), stage])
        );
        rows = allRules
          .filter(
            (rule) =>
              rule.templateId === template.templateId &&
              Number(rule.templateVersion || 1) === latestInheritedVersion
          )
          .map((rule, index) => {
            const stage =
              stageById.get(String(rule.stageId || "")) ||
              stageByName.get(String(rule.stage || "").toLowerCase());
            return stage
              ? normaliseRule(
                  {
                    ...rule,
                    ruleId: uid("RULE"),
                    templateVersion: resolvedVersion,
                    stage: stage.name,
                    stageId: stage.stageId
                  },
                  index,
                  resolvedVersion
                )
              : null;
          })
          .filter(Boolean);
      }
    }
    return clone(rows);
  }

  function cloneMandatoryRulesForTemplate(
    sourceTemplateId,
    sourceVersion,
    targetTemplateId,
    targetVersion,
    targetStages
  ) {
    const stages = (Array.isArray(targetStages) ? targetStages : []).filter(Boolean);
    const byStageId = new Map(stages.map((stage) => [String(stage.stageId || ""), stage]));
    const byName = new Map(stages.map((stage) => [String(stage.name || "").toLowerCase(), stage]));
    return getMandatoryRulesForTemplateVersion(sourceTemplateId, sourceVersion)
      .map((rule, index) => {
        const stage =
          byStageId.get(String(rule.stageId || "")) || byName.get(String(rule.stage || "").toLowerCase());
        if (!stage) return null;
        return normaliseRule(
          {
            ...rule,
            ruleId: uid("RULE"),
            templateId: targetTemplateId,
            templateVersion: targetVersion,
            stage: stage.name,
            stageId: stage.stageId,
            createdAt: nowIso(),
            updatedAt: nowIso()
          },
          index,
          targetVersion
        );
      })
      .filter(Boolean);
  }

  function getMandatoryRulesForStage(stage, projectType, templateId, templateVersion) {
    const stageValue = String(stage || "")
      .trim()
      .toLowerCase();
    const typeValue = String(projectType || "*")
      .trim()
      .toLowerCase();
    const template =
      getLifecycleTemplates().find((row) => row.templateId === templateId) ||
      getLifecycleTemplates().find((row) => row.isDefault) ||
      getLifecycleTemplates()[0];
    const resolvedTemplateId = (template && template.templateId) || "LIFE-00001";
    const resolvedVersion = Math.max(1, Number(templateVersion || (template && template.version) || 1));
    const candidates = getMandatoryRulesForTemplateVersion(resolvedTemplateId, resolvedVersion).filter(
      (rule) =>
        rule.active !== false &&
        [rule.stage, rule.stageId].some(
          (value) =>
            String(value || "")
              .trim()
              .toLowerCase() === stageValue
        ) &&
        ["*", typeValue].includes(
          String(rule.projectType || "*")
            .trim()
            .toLowerCase()
        )
    );
    const resolved = new Map();
    candidates
      .sort((a, b) => (a.projectType === "*" ? 0 : 1) - (b.projectType === "*" ? 0 : 1))
      .forEach((rule) => resolved.set(rule.fieldId, rule));
    return clone([...resolved.values()].sort((a, b) => a.label.localeCompare(b.label)));
  }

  function evaluateProjectStage(project, stage, options) {
    const source = project && typeof project === "object" ? project : {};
    const settings = options || {};
    const template = getTemplateForProject(source);
    const stages = projectStages(source);
    const targetStage = String(stage || source.currentStage || stages[0]?.name || "");
    const stageIndex = stages.findIndex((item) => item.name === targetStage || item.stageId === targetStage);
    const missing = [];
    if (!template || stageIndex < 0) {
      missing.push({
        fieldId: "currentStage",
        label: `Stage “${targetStage || "Not set"}” is not present in the assigned lifecycle template.`
      });
      return {
        valid: false,
        stage: targetStage,
        stageIndex,
        templateId: template?.templateId || source.lifecycleTemplateId || "",
        templateVersion: template?.version || source.lifecycleTemplateVersion || "",
        missing
      };
    }
    const seen = new Set();
    const rules = stages
      .slice(0, stageIndex + 1)
      .flatMap((item) =>
        getMandatoryRulesForStage(item.name, source.projectType || "*", template.templateId, template.version)
      )
      .filter((rule) => rule.required !== false && !seen.has(rule.fieldId) && seen.add(rule.fieldId));
    rules.forEach((rule) => {
      const fieldIds = rule.anyFieldIds?.length ? rule.anyFieldIds : [rule.fieldId];
      const values = fieldIds.map((fieldId) => source[fieldId]);
      let complete;
      if (rule.validValues?.length)
        complete = values.some((value) => rule.validValues.includes(String(value ?? "")));
      else if (rule.invalidValues?.length)
        complete = values.some(
          (value) => value !== null && value !== undefined && !rule.invalidValues.includes(String(value))
        );
      else
        complete = values.some(
          (value) =>
            value !== null &&
            value !== undefined &&
            String(value).trim() !== "" &&
            !(typeof value === "number" && value === 0)
        );
      if (!complete)
        missing.push({
          fieldId: rule.fieldId,
          label: rule.label || FIELD_LABELS[rule.fieldId] || rule.fieldId,
          rule: clone(rule)
        });
    });
    if (settings.includeRelated && stageIndex >= 3 && source.projectCode) {
      const planStore = read("ppmProjectPlans", {});
      const milestoneStore = read("ppmProjectMilestones", {});
      const tasks = Array.isArray(planStore?.[source.projectCode]) ? planStore[source.projectCode] : [];
      const milestones = Array.isArray(milestoneStore?.[source.projectCode])
        ? milestoneStore[source.projectCode]
        : [];
      if (!tasks.length) missing.push({ fieldId: "projectPlan", label: "Detailed project-plan tasks" });
      if (!milestones.length) missing.push({ fieldId: "projectMilestones", label: "Project milestones" });
      if (tasks.length && !tasks.some((task) => task.taskOwnerResourceId || task.taskOwner))
        missing.push({ fieldId: "resourceAssignments", label: "Resource assignments" });
    }
    return {
      valid: missing.length === 0,
      stage: targetStage,
      stageIndex,
      templateId: template.templateId,
      templateVersion: template.version,
      missing,
      rules: clone(rules)
    };
  }

  function getRagConfig() {
    const stored = read(KEYS.ragConfig, {});
    return clone({ ...DEFAULT_RAG_CONFIG, ...(stored && typeof stored === "object" ? stored : {}) });
  }

  async function saveRagConfig(config, options) {
    const current = getRagConfig();
    const values = { ...current, ...(config || {}), updatedAt: nowIso(), updatedBy: actorName() };
    Object.keys(DEFAULT_RAG_CONFIG).forEach((key) => {
      values[key] = Number(values[key]);
    });
    return saveCollection(KEYS.ragConfig, values, "RAG threshold", options);
  }

  function defaultReportingCalendar() {
    const timestamp = nowIso();
    return {
      calendarId: "CAL-00001",
      name: "Monthly portfolio reporting",
      description: "Default monthly reporting calendar for Foresters Portfolio.",
      portfolioId: "PORT-00001",
      frequency: "Monthly",
      dueOffsetDays: 5,
      financialYearStartMonth: 4,
      active: true,
      isDefault: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  function normaliseCalendar(row, index) {
    const base = defaultReportingCalendar();
    const source = row && typeof row === "object" ? row : {};
    return {
      ...base,
      ...source,
      calendarId: String(source.calendarId || `CAL-${String(index + 1).padStart(5, "0")}`),
      name: String(source.name || `Reporting calendar ${index + 1}`),
      description: String(source.description || ""),
      portfolioId: String(source.portfolioId || ""),
      frequency: String(source.frequency || "Monthly"),
      dueOffsetDays: Math.max(0, Number(source.dueOffsetDays ?? 5)),
      financialYearStartMonth: Math.min(12, Math.max(1, Number(source.financialYearStartMonth || 4))),
      active: source.active !== false,
      isDefault: Boolean(source.isDefault),
      createdAt: source.createdAt || base.createdAt,
      updatedAt: source.updatedAt || base.updatedAt
    };
  }

  function getReportingCalendars() {
    const stored = read(KEYS.reportingCalendars, null);
    let rows = (Array.isArray(stored) && stored.length ? stored : [defaultReportingCalendar()])
      .filter(Boolean)
      .map(normaliseCalendar);
    if (!rows.some((row) => row.isDefault && row.active)) {
      const first = rows.find((row) => row.active) || rows[0];
      if (first) first.isDefault = true;
    }
    /* Stage 16: derived only. seedDefaults() is what persists the defaults, once. */
    return clone(rows);
  }

  async function saveReportingCalendars(rows, options) {
    let values = (Array.isArray(rows) ? rows : []).filter(Boolean).map(normaliseCalendar);
    const defaultId =
      values.find((row) => row.isDefault && row.active)?.calendarId ||
      values.find((row) => row.active)?.calendarId;
    values = values.map((row) => ({ ...row, isDefault: row.calendarId === defaultId }));
    return saveCollection(KEYS.reportingCalendars, values, "Reporting calendar", options);
  }

  function nextReportingCalendarId(rows) {
    return nextSequentialId("CAL", rows || getReportingCalendars(), "calendarId", 5);
  }

  function normalisePeriod(row, index) {
    const source = row && typeof row === "object" ? row : {};
    return {
      ...source,
      periodId: String(source.periodId || `PER-${String(index + 1).padStart(6, "0")}`),
      calendarId: String(source.calendarId || "CAL-00001"),
      name: String(source.name || `Reporting period ${index + 1}`),
      startDate: String(source.startDate || ""),
      endDate: String(source.endDate || ""),
      submissionDueDate: String(source.submissionDueDate || ""),
      status: String(source.status || (source.locked ? "Locked" : "Upcoming")),
      locked: Boolean(source.locked || source.status === "Locked" || source.status === "Closed"),
      lockedAt: String(source.lockedAt || ""),
      lockedBy: String(source.lockedBy || ""),
      createdAt: source.createdAt || nowIso(),
      updatedAt: source.updatedAt || nowIso()
    };
  }

  function getReportingPeriods(calendarId) {
    const stored = read(KEYS.reportingPeriods, []);
    const rows = (Array.isArray(stored) ? stored : []).filter(Boolean).map(normalisePeriod);
    return clone(calendarId ? rows.filter((row) => row.calendarId === calendarId) : rows);
  }

  async function saveReportingPeriods(rows, options) {
    const values = (Array.isArray(rows) ? rows : [])
      .filter(Boolean)
      .map((row, index) => normalisePeriod({ ...row, updatedAt: nowIso() }, index));
    return saveCollection(KEYS.reportingPeriods, values, "Reporting period", options);
  }

  function periodStatus(startDate, endDate, locked) {
    if (locked) return "Locked";
    const today = todayIso();
    if (today < startDate) return "Upcoming";
    if (today > endDate) return "Closed";
    return "Open";
  }

  function monthName(date) {
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(date);
  }

  function quarterName(date, financialYearStartMonth) {
    const startMonth = Number(financialYearStartMonth || 1) - 1;
    const offset = (date.getMonth() - startMonth + 12) % 12;
    const quarter = Math.floor(offset / 3) + 1;
    const financialStartYear = date.getMonth() >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
    return `Q${quarter} FY${String(financialStartYear + 1).slice(-2)}`;
  }

  function periodBounds(cursor, frequency, financialYearStartMonth) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    const nameFrequency = String(frequency || "Monthly").toLowerCase();
    if (nameFrequency === "weekly") {
      end.setDate(end.getDate() + 6);
      return {
        start,
        end,
        next: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1),
        name: `Week commencing ${start.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
      };
    }
    if (nameFrequency === "fortnightly") {
      end.setDate(end.getDate() + 13);
      return {
        start,
        end,
        next: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1),
        name: `Fortnight commencing ${start.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`
      };
    }
    if (nameFrequency === "quarterly") {
      end.setMonth(end.getMonth() + 3, 0);
      return {
        start,
        end,
        next: new Date(end.getFullYear(), end.getMonth() + 1, 1),
        name: quarterName(start, financialYearStartMonth)
      };
    }
    if (nameFrequency === "annual" || nameFrequency === "yearly") {
      end.setFullYear(end.getFullYear() + 1, end.getMonth(), 0);
      return {
        start,
        end,
        next: new Date(end.getFullYear(), end.getMonth() + 1, 1),
        name: `FY${String(end.getFullYear()).slice(-2)}`
      };
    }
    end.setMonth(end.getMonth() + 1, 0);
    return { start, end, next: new Date(end.getFullYear(), end.getMonth() + 1, 1), name: monthName(start) };
  }

  function calendarAnchor(calendar, startValue) {
    const provided = parseDate(startValue);
    if (provided) return provided;
    const today = parseDate(todayIso());
    const frequency = String(calendar.frequency || "Monthly").toLowerCase();
    if (frequency === "weekly" || frequency === "fortnightly") {
      const day = today.getDay() || 7;
      today.setDate(today.getDate() - day + 1);
      return today;
    }
    if (frequency === "quarterly") {
      const financialStart = Number(calendar.financialYearStartMonth || 1) - 1;
      const offset = (today.getMonth() - financialStart + 12) % 12;
      const startMonth = today.getMonth() - (offset % 3);
      return new Date(today.getFullYear(), startMonth, 1);
    }
    if (frequency === "annual" || frequency === "yearly") {
      const startMonth = Number(calendar.financialYearStartMonth || 1) - 1;
      const year = today.getMonth() >= startMonth ? today.getFullYear() : today.getFullYear() - 1;
      return new Date(year, startMonth, 1);
    }
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }

  function ensureReportingPeriods(calendarIdOrCalendar, options) {
    const settings = options || {};
    const calendars = getReportingCalendars();
    const calendar =
      typeof calendarIdOrCalendar === "object"
        ? normaliseCalendar(calendarIdOrCalendar, 0)
        : calendars.find((row) => row.calendarId === calendarIdOrCalendar) ||
          calendars.find((row) => row.isDefault);
    if (!calendar) return [];
    const existingAll = getReportingPeriods();
    const existing = existingAll.filter((row) => row.calendarId === calendar.calendarId);
    const existingKeys = new Set(existing.map((row) => `${row.startDate}|${row.endDate}`));
    const count = Math.max(
      1,
      Math.min(
        104,
        Number(
          settings.count ||
            { Weekly: 13, Fortnightly: 13, Monthly: 12, Quarterly: 8, Annual: 3 }[calendar.frequency] ||
            12
        )
      )
    );
    let cursor = calendarAnchor(calendar, settings.startDate);
    const generated = [];
    for (let index = 0; index < count; index += 1) {
      const bounds = periodBounds(cursor, calendar.frequency, calendar.financialYearStartMonth);
      const startDate = isoDate(bounds.start);
      const endDate = isoDate(bounds.end);
      const key = `${startDate}|${endDate}`;
      if (!existingKeys.has(key)) {
        generated.push(
          normalisePeriod(
            {
              periodId: uid("PER"),
              calendarId: calendar.calendarId,
              name: bounds.name,
              startDate,
              endDate,
              submissionDueDate: addDays(endDate, calendar.dueOffsetDays),
              status: periodStatus(startDate, endDate, false),
              locked: false
            },
            existingAll.length + generated.length
          )
        );
        existingKeys.add(key);
      }
      cursor = bounds.next;
    }
    const combined = [...existingAll, ...generated].sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (generated.length) {
      saveReportingPeriods(combined, {
        audit: settings.audit !== false,
        action: "Reporting periods generated",
        summary: `${generated.length} reporting period${generated.length === 1 ? " was" : "s were"} generated for ${calendar.name}.`,
        entityId: calendar.calendarId
      });
    }
    return clone(combined.filter((row) => row.calendarId === calendar.calendarId));
  }

  async function seedDefaults() {
    /*
      Stage 16: seeding happens here, explicitly and awaited, rather than as a side effect of
      each getter. Every configuration getter used to persist its own defaults on first read -
      nine more writes hidden inside functions named get. Once writes became asynchronous those
      would have been floating promises nobody could see fail.
    */
    await rawWrite(KEYS.portfolios, getPortfolios());
    await rawWrite(KEYS.lifecycleTemplates, getLifecycleTemplates());
    await rawWrite(KEYS.referenceData, getReferenceData());
    await rawWrite(KEYS.mandatoryRules, getMandatoryRules());
    await rawWrite(KEYS.ragConfig, getRagConfig());
    const calendars = getReportingCalendars();
    await rawWrite(KEYS.reportingCalendars, calendars);
    if (!read(KEYS.reportingPeriods, null)) await rawWrite(KEYS.reportingPeriods, []);
    await backfillLegacyProjectLifecycleAssignments();
    /*
      The schema version marks this browser, not a business collection - there is no table for
      it and PPMStore would rightly refuse it. It stays in localStorage, which is the one reason
      ppm-admin-utils.js remains on the Stage 16 list in VERIFY-STATIC.mjs.
    */
    localStorage.setItem(KEYS.schemaVersion, JSON.stringify(SCHEMA_VERSION));
    return {
      portfolios: getPortfolios(),
      lifecycleTemplates: getLifecycleTemplates(),
      referenceData: getReferenceData(),
      mandatoryRules: getMandatoryRules(),
      ragConfig: getRagConfig(),
      reportingCalendars: calendars,
      reportingPeriods: getReportingPeriods()
    };
  }

  window.PPMAdmin = Object.freeze({
    KEYS,
    SCHEMA_VERSION,
    DEFAULT_STAGE_NAMES,
    DEFAULT_RAG_CONFIG,
    REFERENCE_DEFINITIONS,
    FIELD_LABELS,
    getPortfolios,
    savePortfolios,
    reconcileProgrammeMembership,
    findPortfolio,
    nextPortfolioId,
    getLifecycleTemplates,
    saveLifecycleTemplates,
    nextLifecycleTemplateId,
    getTemplateForProject,
    projectStages,
    migrateLegacyProjectLifecycleAssignments,
    backfillLegacyProjectLifecycleAssignments,
    getReferenceData,
    saveReferenceData,
    getReferenceValues,
    referenceCategories,
    getMandatoryRules,
    saveMandatoryRules,
    getMandatoryRulesForTemplateVersion,
    cloneMandatoryRulesForTemplate,
    getMandatoryRulesForStage,
    evaluateProjectStage,
    getRagConfig,
    saveRagConfig,
    getReportingCalendars,
    saveReportingCalendars,
    nextReportingCalendarId,
    getReportingPeriods,
    saveReportingPeriods,
    ensureReportingPeriods,
    normalisePortfolio,
    normaliseTemplate,
    normaliseRule,
    normaliseCalendar,
    normalisePeriod,
    seedDefaults,
    uid,
    todayIso
    /*
      `audit` was listed here and no function of that name exists in this file - a leftover
      from retiring the local audit helper. A shorthand property naming an undefined
      identifier is a ReferenceError, thrown while building this object, so
      window.PPMAdmin was never assigned at all and seedDefaults() never ran. Every page
      that loads this module reported "audit is not defined" and then behaved as though
      PPMAdmin did not exist, which most callers guard for, so it went unnoticed.
    */
  });

  /*
    Stage 16: seeding is asynchronous now, because it writes to the database.

    Nothing awaits this and nothing can - it runs while the module is being defined, before any
    page script exists. That is acceptable for seeding specifically: it writes defaults that are
    already present in memory, so a page renders correctly whether or not the write has landed.
    What is not acceptable is failing silently, which is what the old fire-and-forget writes did,
    so the failure is reported.
  */
  seedDefaults().catch((error) =>
    console.error("PPMAdmin: the default configuration could not be saved.", error)
  );
})();
