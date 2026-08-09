(function () {
  "use strict";

  const RESOURCE_KEY = "ppmResources";
  const SESSION_KEY = "ppmAuthSession";
  const CURRENT_USER_KEY = "ppmCurrentUser";

  /*
    Stage 3E removed the browser's own password system. Passwords are verified by
    Supabase Auth and a TOTP factor is required before the application will
    complete a sign-in, so nothing password-shaped is stored, hashed or counted
    here any more.

    RETIRED_CREDENTIAL_KEY is kept only so the one-time cleanup below can delete
    the leftover store from browsers that used the old system. Nothing reads it.
  */
  const RETIRED_CREDENTIAL_KEY = "ppmAuthCredentials";

  // These still govern the compatibility session (ppmAuthSession / ppmCurrentUser)
  // that legacy pages read. They are session lifetime rules, not password rules.
  const SESSION_HOURS = 8;
  const IDLE_MINUTES = 30;
  const originalStorageGet = Storage.prototype.getItem;
  const originalStorageSet = Storage.prototype.setItem;
  let storageScopeInstalled = false;
  let currentSession = null;
  let currentResource = null;
  let lastTouch = 0;

  const ALL_PERMISSIONS = [
    "home.view",
    "projects.view",
    "projects.create",
    "projects.edit",
    "projects.status",
    "projects.archive",
    "administration.view",
    "administration.edit",
    "portfolios.view",
    "portfolios.edit",
    "programmes.view",
    "programmes.edit",
    "programmes.approve",
    "milestones.view",
    "milestones.edit",
    "stageGates.view",
    "stageGates.submit",
    "stageGates.approve",
    "stageGates.override",
    "plan.view",
    "plan.edit",
    "plan.requestBaseline",
    "plan.approveBaseline",
    "raid.view",
    "raid.edit",
    "registers.view",
    "registers.edit",
    "benefits.view",
    "benefits.edit",
    "resources.view",
    "resources.viewContact",
    "resources.edit",
    "resources.manageTeam",
    "users.manage",
    "resourceManagement.view",
    "resourceManagement.edit",
    "resourceManagement.publishScenario",
    "financials.viewRag",
    "financials.viewDetail",
    "financials.edit",
    "financials.configure",
    "financials.approve",
    "audit.view",
    "reports.view",
    "reports.export",
    "views.publish",
    "search.use"
  ];

  const ROLE_DEFINITIONS = {
    "System Administrator": {
      description: "Full configuration, user administration, records, approvals and audit access.",
      defaultScope: "Portfolio-wide",
      permissions: ALL_PERMISSIONS
    },
    "Portfolio Manager / PMO Manager": {
      description: "Portfolio-wide project, resource, governance, baseline, reporting and approval control.",
      defaultScope: "Portfolio-wide",
      permissions: ALL_PERMISSIONS.filter((permission) => permission !== "users.manage")
    },
    "Project Manager": {
      description:
        "Maintain assigned projects, plans, milestones, status, RAID, benefits and resource forecasts.",
      defaultScope: "Assigned projects",
      permissions: [
        "home.view",
        "projects.view",
        "projects.create",
        "projects.edit",
        "projects.status",
        "portfolios.view",
        "programmes.view",
        "milestones.view",
        "milestones.edit",
        "stageGates.view",
        "stageGates.submit",
        "plan.view",
        "plan.edit",
        "plan.requestBaseline",
        "raid.view",
        "raid.edit",
        "registers.view",
        "registers.edit",
        "benefits.view",
        "benefits.edit",
        "resources.view",
        "resourceManagement.view",
        "resourceManagement.edit",
        "financials.viewRag",
        "financials.viewDetail",
        "financials.edit",
        "reports.view",
        "reports.export",
        "search.use"
      ]
    },
    "PMO Analyst": {
      description:
        "Portfolio maintenance, data-quality review, governance updates and reporting without self-approval.",
      defaultScope: "Portfolio-wide",
      permissions: [
        "home.view",
        "projects.view",
        "projects.create",
        "projects.edit",
        "projects.status",
        "administration.view",
        "portfolios.view",
        "portfolios.edit",
        "programmes.view",
        "programmes.edit",
        "milestones.view",
        "milestones.edit",
        "stageGates.view",
        "stageGates.submit",
        "plan.view",
        "plan.edit",
        "plan.requestBaseline",
        "raid.view",
        "raid.edit",
        "registers.view",
        "registers.edit",
        "benefits.view",
        "benefits.edit",
        "resources.view",
        "resources.viewContact",
        "resourceManagement.view",
        "financials.viewRag",
        "financials.viewDetail",
        "financials.edit",
        "audit.view",
        "reports.view",
        "reports.export",
        "views.publish",
        "search.use"
      ]
    },
    "Project Sponsor / Project Lead": {
      description:
        "Review and approve assigned project scope, status, stage gates, closure, finance and benefits.",
      defaultScope: "Assigned projects",
      permissions: [
        "home.view",
        "projects.view",
        "projects.status",
        "portfolios.view",
        "programmes.view",
        "milestones.view",
        "stageGates.view",
        "stageGates.approve",
        "plan.view",
        "plan.approveBaseline",
        "raid.view",
        "registers.view",
        "registers.edit",
        "benefits.view",
        "financials.viewRag",
        "financials.viewDetail",
        "financials.approve",
        "reports.view",
        "reports.export",
        "search.use"
      ]
    },
    "Resource Manager / Team Manager": {
      description:
        "Manage team capacity, availability, resource requests and assignments without wider project editing.",
      defaultScope: "Team projects",
      permissions: [
        "home.view",
        "projects.view",
        "portfolios.view",
        "milestones.view",
        "stageGates.view",
        "plan.view",
        "raid.view",
        "resources.view",
        "resources.viewContact",
        "resources.manageTeam",
        "resourceManagement.view",
        "resourceManagement.edit",
        "resourceManagement.publishScenario",
        "reports.view",
        "reports.export",
        "search.use"
      ]
    },
    "Project Team Member": {
      description: "View assigned projects and update tasks and actions owned by the signed-in person.",
      defaultScope: "Assigned projects",
      permissions: [
        "home.view",
        "projects.view",
        "portfolios.view",
        "milestones.view",
        "stageGates.view",
        "plan.view",
        "plan.edit",
        "raid.view",
        "registers.view",
        "registers.edit",
        "resources.view",
        "resourceManagement.view",
        "reports.view",
        "search.use"
      ]
    },
    "Executive / Steering User": {
      description: "Read-only portfolio dashboards, approved reports and project summaries.",
      defaultScope: "Portfolio-wide",
      permissions: [
        "home.view",
        "projects.view",
        "portfolios.view",
        "programmes.view",
        "milestones.view",
        "stageGates.view",
        "plan.view",
        "raid.view",
        "registers.view",
        "benefits.view",
        "resourceManagement.view",
        "financials.viewRag",
        "financials.viewDetail",
        "reports.view",
        "reports.export",
        "search.use"
      ]
    },
    "Read-only / Auditor": {
      description:
        "Read-only selected records, historical versions, approval evidence and permitted exports.",
      defaultScope: "Selected projects",
      permissions: [
        "home.view",
        "projects.view",
        "portfolios.view",
        "programmes.view",
        "milestones.view",
        "stageGates.view",
        "plan.view",
        "raid.view",
        "registers.view",
        "benefits.view",
        "resources.view",
        "resourceManagement.view",
        "financials.viewRag",
        "financials.viewDetail",
        "audit.view",
        "reports.view",
        "reports.export",
        "search.use"
      ]
    }
  };

  const PAGE_RULES = {
    "home.html": ["home.view"],
    "administration.html": ["administration.view", "portfolios.view"],
    "index.html": ["projects.view"],
    "add-project.html": ["projects.create", "projects.edit", "projects.status"],
    "project-details.html": ["projects.view"],
    "project-plan.html": ["plan.view"],
    "programme.html": ["programmes.view"],
    "milestones.html": ["milestones.view"],
    "stage-gates.html": ["stageGates.view"],
    "raid-log.html": ["raid.view"],
    "registers.html": ["registers.view"],
    "benefits-management.html": ["benefits.view"],
    "resource-directory.html": ["resources.view"],
    "resource-management.html": ["resourceManagement.view"],
    "financial-management.html": ["financials.viewRag", "financials.viewDetail"],
    "audit-history.html": ["audit.view"],
    "reports.html": ["reports.view"],
    "search.html": ["search.use"]
  };

  const NAV_RULES = {
    "home.html": "home.view",
    "administration.html": "administration.view",
    "index.html": "projects.view",
    "programme.html": "programmes.view",
    "milestones.html": "milestones.view",
    "stage-gates.html": "stageGates.view",
    "raid-log.html": "raid.view",
    "registers.html": "registers.view",
    "benefits-management.html": "benefits.view",
    "resource-directory.html": "resources.view",
    "resource-management.html": "resourceManagement.view",
    "financial-management.html": "financials.viewRag",
    "audit-history.html": "audit.view",
    "reports.html": "reports.view",
    "search.html": "search.use"
  };

  const PAGE_EDIT_RULES = {
    "index.html": "projects.edit",
    "add-project.html": "projects.edit",
    "project-details.html": "projects.edit",
    "project-plan.html": "plan.edit",
    "programme.html": "programmes.edit",
    "milestones.html": "milestones.edit",
    "raid-log.html": "raid.edit",
    "registers.html": "registers.edit",
    "benefits-management.html": "benefits.edit",
    "resource-directory.html": "resources.edit",
    "resource-management.html": "resourceManagement.edit",
    "financial-management.html": "financials.edit"
  };

  const PROJECT_OBJECT_KEYS = new Set([
    "ppmProjectPlans",
    "ppmProjectMilestones",
    "ppmProjectRaid",
    "ppmProjectActions",
    "ppmProjectDecisions",
    "ppmProjectFinancials",
    "ppmProjectBenefits",
    "ppmProjectDocuments",
    "ppmStatusReports",
    "ppmPlanBaselines",
    "ppmPlanBaselineRequests",
    "ppmRagHistory",
    "ppmStageGates",
    /*
      These two were listed as arrays but are stored as objects keyed by project
      code — confirmed against a real backup. The mismatch was not cosmetic:

        reading  filterProjectArray returns a non-array unchanged, so a scoped
                 user was handed EVERY project's financial entries and approval
                 requests, unfiltered.
        writing  mergeProjectArray coerces a non-array to [], so the first save
                 by a scoped user replaced both collections with an empty array
                 and destroyed them.

      Only users below Portfolio-wide scope were affected, because the filter is
      not installed for Portfolio-wide, which is why this went unnoticed.
    */
    "ppmFinancialEntries",
    "ppmFinancialApprovalRequests"
  ]);
  const RESOURCE_SCENARIO_KEY = "ppmResourceScenarios";
  const PROJECT_ARRAY_KEYS = new Set([
    "ppmResourceDemand",
    "ppmAuditHistory"
  ]);

  const parseJson = (value, fallback) => PPMCore.parseJson(value, fallback);

  function rawGet(key) {
    return originalStorageGet.call(localStorage, key);
  }
  function rawSet(key, value) {
    originalStorageSet.call(localStorage, key, value);
  }
  function rawRead(key, fallback) {
    return parseJson(rawGet(key), fallback);
  }

  /* ------------------------------------------------------------ storage facade

    There are two ways to reach stored data, and the difference matters:

      readScoped / writeScoped   Go through the patched localStorage, so a user
                                 whose access is limited to certain projects only
                                 ever sees and writes those projects' records.
                                 Use this for anything a normal user reads.

      readGlobal / writeGlobal   Bypass the permission filter and return the full
                                 contents. Only correct for configuration that is
                                 not project-scoped (portfolios, lifecycle
                                 templates, reference lists) and for the few admin
                                 screens that must legitimately see every project,
                                 such as the project-access picker.

    Previously these were chosen implicitly: calling localStorage directly gave
    you the filtered view and calling rawRead gave you everything, which was
    impossible to tell apart at the call site. Always pass a short `reason` to
    readGlobal / writeGlobal so the justification sits next to the code.

    SCOPED_KEYS below is the authoritative list of what the filter covers.
  ------------------------------------------------------------------------- */

  const SCOPED_KEYS = new Set([
    "ppmProjects",
    ...PROJECT_OBJECT_KEYS,
    ...PROJECT_ARRAY_KEYS,
    RESOURCE_SCENARIO_KEY
  ]);

  function isScopedKey(key) {
    return SCOPED_KEYS.has(String(key));
  }

  function readScoped(key, fallback) {
    return parseJson(localStorage.getItem(key), fallback);
  }

  function writeScoped(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  }

  // eslint-disable-next-line no-unused-vars -- `reason` documents the call site
  function readGlobal(key, fallback, reason) {
    return rawRead(key, fallback);
  }

  // eslint-disable-next-line no-unused-vars -- `reason` documents the call site
  function writeGlobal(key, value, reason) {
    rawSet(key, JSON.stringify(value));
    return value;
  }

  function getResources() {
    const rows = rawRead(RESOURCE_KEY, []);
    return Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
  }
  function saveResources(rows) {
    rawSet(RESOURCE_KEY, JSON.stringify(rows));
  }
  function getResource(resourceId) {
    return getResources().find((row) => row.resourceId === resourceId) || null;
  }
  /*
    One-time Stage 3E cleanup. Browsers that used the old password system still
    have the credential store sitting in localStorage, and restoring an old
    backup could have put it back. It can no longer be used to sign in, but a
    file full of password hashes should not linger, so it is removed on load.

    Safe to run on every page load: removeItem on a missing key does nothing.
  */
  function removeRetiredCredentialStore() {
    try {
      if (originalStorageGet.call(localStorage, RETIRED_CREDENTIAL_KEY) === null) return;
      localStorage.removeItem(RETIRED_CREDENTIAL_KEY);
      console.info("Removed the obsolete local credential store; sign-in is handled by Supabase Auth.");
    } catch (error) {
      console.error("Could not remove the obsolete local credential store:", error);
    }
  }

  function roleNames() {
    return Object.keys(ROLE_DEFINITIONS);
  }
  function roleDefinition(roleName) {
    return ROLE_DEFINITIONS[roleName] || null;
  }
  /*
    A person holds their access role plus any number of additional roles, and their
    permissions are the union of all of them.

    Why: the two roles a real executive needs were mutually exclusive. Executive is
    portfolio-wide and approves nothing; Project Sponsor approves stage gates, baselines and
    budgets but only sees assigned projects. An executive who sponsors two projects could
    have visibility or authority, never both - and naming them as an approver was refused
    outright by the workflow, so the gate could not even be submitted.

    This mirrors private.person_has_permission() in the database, which is the boundary that
    actually decides. If these two ever disagree the database wins, and the user is shown a
    button that fails - so they are deliberately the same shape: overrides first, then the
    union of every role held.
  */
  function rolesOf(resource) {
    const held = [resource?.accessRole, ...(Array.isArray(resource?.additionalRoles) ? resource.additionalRoles : [])];
    return [...new Set(held.map((role) => String(role || "").trim()).filter(Boolean))];
  }

  /* Widest first, so the order doubles as the comparison. */
  const SCOPE_BREADTH = ["Portfolio-wide", "Team projects", "Assigned projects", "Selected projects"];

  function effectiveScope(resource) {
    /* An explicit scope on the person always wins: it is a deliberate administrative act,
       and every account in the pilot has one set. */
    if (resource?.accessScope) return resource.accessScope;

    /* Otherwise the widest default among the roles held. Taking the narrowest would mean
       adding a role could reduce what somebody sees, which nobody would predict. */
    const defaults = rolesOf(resource)
      .map((role) => roleDefinition(role)?.defaultScope)
      .filter(Boolean);
    return SCOPE_BREADTH.find((scope) => defaults.includes(scope)) || "Selected projects";
  }

  function basePermissions(resource) {
    const union = new Set();
    rolesOf(resource).forEach((role) => {
      (roleDefinition(role)?.permissions || []).forEach((permission) => union.add(permission));
    });
    return union;
  }

  /*
    Does this person hold a permission through any of their roles, ignoring project scope?
    Used where the question is "is this a capability of theirs" rather than "may they do it
    here" - team management, for instance, which is about the person rather than a project.
  */
  function holdsPermission(resource, permission) {
    const override = resource?.permissionOverrides?.[permission];
    if (override === "allow") return true;
    if (override === "deny") return false;
    return basePermissions(resource).has(permission);
  }
  function can(permission, projectCode) {
    const resource = currentResource || getCurrentUser();
    if (!resource) return false;
    const override = resource.permissionOverrides?.[permission];
    const allowed =
      override === "allow" || (override !== "deny" && basePermissions(resource).has(permission));
    return Boolean(allowed && (!projectCode || canAccessProject(projectCode, resource)));
  }
  function canAny(permissions, projectCode) {
    return permissions.some((permission) => can(permission, projectCode));
  }

  function normalise(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }
  function recordProjectCode(record) {
    return String(record?.projectCode || record?.projectId || record?.code || "").trim();
  }
  function projectAssignments(resource) {
    const codes = new Set((resource?.selectedProjectCodes || []).filter(Boolean));
    const id = resource?.resourceId || "";
    const name = normalise(resource?.fullName);
    const email = normalise(resource?.email);
    const projects = rawRead("ppmProjects", []);
    const matchesPerson = (record) => {
      const fields = [
        "projectManager",
        "sponsor",
        "projectLead",
        "deputyProjectManager",
        "businessAnalyst",
        "technicalLead",
        "benefitOwner",
        "financialOwner"
      ];
      return fields.some(
        (field) =>
          record?.[`${field}ResourceId`] === id ||
          (name && normalise(record?.[field]) === name) ||
          (email && normalise(record?.[`${field}Email`]) === email)
      );
    };
    if (Array.isArray(projects))
      projects.forEach((project) => {
        if (matchesPerson(project) || project.createdByResourceId === id)
          codes.add(recordProjectCode(project));
      });

    const objectKeys = [
      "ppmProjectPlans",
      "ppmProjectRaid",
      "ppmProjectActions",
      "ppmProjectDecisions",
      "ppmProjectBenefits",
      "ppmStageGates"
    ];
    objectKeys.forEach((key) => {
      const store = rawRead(key, {});
      const groups = Array.isArray(store) ? { legacy: store } : store;
      if (!groups || typeof groups !== "object") return;
      Object.entries(groups).forEach(([code, rows]) => {
        if (!Array.isArray(rows)) return;
        if (
          rows.some((row) => {
            const assignedIds = [
              row.taskOwnerResourceId,
              row.ownerResourceId,
              row.raisedByResourceId,
              row.resolutionOwnerResourceId,
              row.decisionOwnerResourceId,
              row.benefitOwnerResourceId,
              row.submissionOwnerResourceId,
              row.routeApproverResourceId
            ];
            const assignedNames = [
              row.taskOwner,
              row.owner,
              row.raisedBy,
              row.resolutionOwner,
              row.decisionOwner,
              row.benefitOwner,
              row.submissionOwner,
              row.routeApprover
            ];
            const approvers = Array.isArray(row.requiredApprovers) ? row.requiredApprovers : [];
            return (
              assignedIds.includes(id) ||
              approvers.some(
                (approver) =>
                  approver?.resourceId === id ||
                  (email && normalise(approver?.email) === email) ||
                  (name && normalise(approver?.name) === name)
              ) ||
              (name && assignedNames.some((value) => normalise(value) === name))
            );
          })
        ) {
          codes.add(code === "legacy" ? recordProjectCode(rows[0]) : code);
        }
      });
    });

    const demand = rawRead("ppmResourceDemand", []);
    if (Array.isArray(demand))
      demand.forEach((row) => {
        if ([row.resourceId, row.resourceResourceId, row.assignedResourceId].includes(id))
          codes.add(recordProjectCode(row));
      });

    if (effectiveScope(resource) === "Team projects") {
      const team = normalise(resource?.team);
      if (team && Array.isArray(demand))
        demand.forEach((row) => {
          if ([row.team, row.owningTeam, row.requiredTeam].some((value) => normalise(value) === team))
            codes.add(recordProjectCode(row));
        });
      const teamResourceIds = new Set(
        getResources()
          .filter((row) => normalise(row.team) === team)
          .map((row) => row.resourceId)
      );
      const planStore = rawRead("ppmProjectPlans", {});
      if (planStore && typeof planStore === "object")
        Object.entries(planStore).forEach(([code, rows]) => {
          if (Array.isArray(rows) && rows.some((row) => teamResourceIds.has(row.taskOwnerResourceId)))
            codes.add(code);
        });
    }
    codes.delete("");
    return codes;
  }

  function canAccessProject(projectCode, resource) {
    const user = resource || currentResource || getCurrentUser();
    if (!user || !projectCode) return false;
    if (effectiveScope(user) === "Portfolio-wide") return true;
    return projectAssignments(user).has(String(projectCode));
  }
  function filterProjects(projects, resource) {
    const rows = Array.isArray(projects) ? projects : [];
    const user = resource || currentResource || getCurrentUser();
    if (!user) return [];
    return effectiveScope(user) === "Portfolio-wide"
      ? rows
      : rows.filter((project) => canAccessProject(recordProjectCode(project), user));
  }

  function filterProjectObject(store, user) {
    if (!store || typeof store !== "object" || Array.isArray(store)) return store;
    return Object.fromEntries(Object.entries(store).filter(([code]) => canAccessProject(code, user)));
  }
  function filterProjectArray(rows, user) {
    if (!Array.isArray(rows)) return rows;
    return rows.filter((row) => {
      const code = recordProjectCode(row);
      return !code || canAccessProject(code, user);
    });
  }

  function resourceScenarioProjectCodes(row) {
    const demands = Array.isArray(row?.demands) ? row.demands : [];
    return [...new Set(demands.map(recordProjectCode).filter(Boolean))];
  }

  function canAccessResourceScenario(row, user) {
    const codes = resourceScenarioProjectCodes(row);
    return codes.every((code) => canAccessProject(code, user));
  }

  function filterResourceScenarios(rows, user) {
    if (!Array.isArray(rows)) return rows;
    return rows.filter((row) => canAccessResourceScenario(row, user));
  }
  function mergeProjectObject(existing, incoming, user) {
    const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
    const next = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
    const hidden = Object.fromEntries(Object.entries(base).filter(([code]) => !canAccessProject(code, user)));
    return { ...hidden, ...next };
  }
  function mergeProjectArray(existing, incoming, user) {
    const base = Array.isArray(existing) ? existing : [];
    const next = Array.isArray(incoming) ? incoming : [];
    return [
      ...base.filter((row) => {
        const code = recordProjectCode(row);
        return code && !canAccessProject(code, user);
      }),
      ...next
    ];
  }

  function mergeResourceScenarios(existing, incoming, user) {
    const base = Array.isArray(existing) ? existing : [];
    const next = Array.isArray(incoming) ? incoming : [];
    return [
      ...base.filter((row) => !canAccessResourceScenario(row, user)),
      ...next
    ];
  }

  function installStorageScope(resource) {
    if (storageScopeInstalled || effectiveScope(resource) === "Portfolio-wide") return;
    storageScopeInstalled = true;
    Storage.prototype.getItem = function (key) {
      const value = originalStorageGet.call(this, key);
      if (this !== localStorage || !currentResource || !value) return value;
      if (key === "ppmProjects") return JSON.stringify(filterProjects(parseJson(value, []), currentResource));
      if (PROJECT_OBJECT_KEYS.has(key))
        return JSON.stringify(filterProjectObject(parseJson(value, {}), currentResource));
      if (key === RESOURCE_SCENARIO_KEY)
        return JSON.stringify(filterResourceScenarios(parseJson(value, []), currentResource));
      if (PROJECT_ARRAY_KEYS.has(key))
        return JSON.stringify(filterProjectArray(parseJson(value, []), currentResource));
      return value;
    };
    Storage.prototype.setItem = function (key, value) {
      if (this !== localStorage || !currentResource) return originalStorageSet.call(this, key, value);
      if (key === "ppmProjects") {
        const merged = mergeProjectArray(parseJson(rawGet(key), []), parseJson(value, []), currentResource);
        return rawSet(key, JSON.stringify(merged));
      }
      if (PROJECT_OBJECT_KEYS.has(key)) {
        const merged = mergeProjectObject(parseJson(rawGet(key), {}), parseJson(value, {}), currentResource);
        return rawSet(key, JSON.stringify(merged));
      }
      if (key === RESOURCE_SCENARIO_KEY) {
        const merged = mergeResourceScenarios(
          parseJson(rawGet(key), []),
          parseJson(value, []),
          currentResource
        );
        return rawSet(key, JSON.stringify(merged));
      }
      if (PROJECT_ARRAY_KEYS.has(key)) {
        const merged = mergeProjectArray(parseJson(rawGet(key), []), parseJson(value, []), currentResource);
        return rawSet(key, JSON.stringify(merged));
      }
      return originalStorageSet.call(this, key, value);
    };
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  // Still used to generate the compatibility session ID, which is why this and
  // bytesToBase64 survived the Stage 3E credential removal. base64ToBytes went
  // with the PBKDF2 code; it only ever decoded password salts.
  function randomToken(bytes) {
    const values = new Uint8Array(bytes);
    crypto.getRandomValues(values);
    return bytesToBase64(values);
  }

  function audit(action, resource, summary, changes) {
    const rows = rawRead("ppmAuditHistory", []);
    const now = new Date().toISOString();
    const record = {
      auditId: `AUD-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      timestamp: now,
      projectCode: "",
      entityType: "User access",
      entityId: resource?.resourceId || "AUTH",
      action,
      summary,
      actorName: resource?.fullName || resource?.email || "Unknown user",
      actorResourceId: resource?.resourceId || "",
      actorEmail: resource?.email || "",
      actorRole: resource?.accessRole || "",
      changes: Array.isArray(changes) ? changes : [],
      sourcePage: currentPage()
    };
    rawSet("ppmAuditHistory", JSON.stringify([...(Array.isArray(rows) ? rows : []), record]));
  }

  /*
    The old PPMAuth.login(email, password) lived here. It read ppmAuthCredentials,
    PBKDF2-hashed the candidate password, counted failed attempts and applied a
    local lockout — all of it inside the browser, where a user with developer
    tools could rewrite any of it.

    It was removed in Stage 3E. The only sign-in path is now login.html →
    Supabase Auth password check → TOTP factor → AAL2 session, which the database
    also enforces through row-level security. Nothing in this file verifies a
    password any more.
  */

  function endSession(reason) {
    const storedSession = parseJson(sessionStorage.getItem(SESSION_KEY), null);
    const resource =
      currentResource || (storedSession?.resourceId ? getResource(storedSession.resourceId) : null);
    if (resource)
      audit(
        "Signed out",
        resource,
        `${resource.fullName || resource.email} signed out${reason ? ` (${reason})` : ""}.`
      );
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(CURRENT_USER_KEY);
    currentSession = null;
    currentResource = null;
  }
  function establishSupabaseSession(person, authUserId, options) {
    if (!person?.legacy_resource_id)
      throw new Error("The authenticated account is not linked to a PPM Resource record.");

    const rows = getResources();
    const index = rows.findIndex((row) => row.resourceId === person.legacy_resource_id);
    const legacy =
      person.legacy_payload && typeof person.legacy_payload === "object" && !Array.isArray(person.legacy_payload)
        ? person.legacy_payload
        : {};
    const existing = index >= 0 ? rows[index] : {};
    const resource = {
      ...legacy,
      ...existing,
      resourceId: person.legacy_resource_id,
      fullName: person.full_name || existing.fullName || legacy.fullName || person.legacy_resource_id,
      email: person.email || existing.email || legacy.email || "",
      team: person.team ?? existing.team ?? legacy.team ?? "",
      department: person.department ?? existing.department ?? legacy.department ?? "",
      jobTitle: person.job_title ?? existing.jobTitle ?? legacy.jobTitle ?? "",
      accessRole: person.access_role || "",
      /* Every role held, so can() unions them exactly as private.person_has_permission does. */
      additionalRoles: Array.isArray(person.additional_roles) ? person.additional_roles : [],
      accessScope:
        person.access_scope ||
        effectiveScope({
          accessRole: person.access_role,
          additionalRoles: Array.isArray(person.additional_roles) ? person.additional_roles : []
        }),
      selectedProjectCodes: Array.isArray(person.selected_project_codes) ? person.selected_project_codes : [],
      permissionOverrides:
        person.permission_overrides && typeof person.permission_overrides === "object"
          ? person.permission_overrides
          : {},
      active: person.active !== false,
      accountStatus: person.account_status || "Active",
      supabaseUserId: authUserId || ""
    };

    if (index >= 0) rows[index] = resource;
    else rows.push(resource);
    saveResources(rows);

    const now = Date.now();
    const session = {
      sessionId: randomToken(24),
      resourceId: resource.resourceId,
      authUserId: authUserId || "",
      issuedAt: new Date(now).toISOString(),
      lastActivityAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_HOURS * 60 * 60000).toISOString(),
      provider: "supabase"
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    sessionStorage.setItem(
      CURRENT_USER_KEY,
      JSON.stringify({
        resourceId: resource.resourceId,
        name: resource.fullName,
        email: resource.email,
        role: resource.accessRole,
        authUserId: authUserId || ""
      })
    );

    currentSession = session;
    currentResource = resource;
    installStorageScope(resource);

    if (options?.audit !== false)
      audit("Signed in", resource, `${resource.fullName || resource.email} signed in using Supabase Auth and MFA.`);

    return resource;
  }

  async function logout() {
    try {
      if (window.PPMSupabase?.auth) {
        const { error } = await window.PPMSupabase.auth.signOut({ scope: "local" });
        if (error) console.error("Supabase sign-out failed:", error);
      }
    } finally {
      endSession("");
      location.href = "login.html";
    }
  }
  function readValidSession() {
    const session = parseJson(sessionStorage.getItem(SESSION_KEY), null);
    if (!session?.resourceId) return null;
    const now = Date.now();
    const lastActivity = new Date(session.lastActivityAt || session.issuedAt || 0).getTime();
    if (new Date(session.expiresAt || 0).getTime() <= now || now - lastActivity > IDLE_MINUTES * 60000) {
      endSession("session expired");
      return null;
    }
    const resource = getResource(session.resourceId);
    if (
      !resource ||
      resource.active === false ||
      resource.accountStatus !== "Active" ||
      !resource.accessRole
    ) {
      endSession("account unavailable");
      return null;
    }
    currentSession = session;
    currentResource = resource;
    return session;
  }
  function getCurrentUser() {
    if (currentResource) return currentResource;
    return readValidSession() ? currentResource : null;
  }
  function touchSession() {
    if (!currentSession || Date.now() - lastTouch < 60000) return;
    lastTouch = Date.now();
    currentSession.lastActivityAt = new Date().toISOString();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
  }

  function currentPage() {
    const value = location.pathname.split("/").pop();
    return value || "index.html";
  }
  function safeReturnUrl() {
    const candidate = new URLSearchParams(location.search).get("return") || "home.html";
    return /^[a-z0-9-]+\.html(?:\?[a-z0-9%_=&.-]*)?$/i.test(candidate) ? candidate : "home.html";
  }
  function loginUrl() {
    const target = `${currentPage()}${location.search || ""}`;
    return `login.html?return=${encodeURIComponent(target)}`;
  }
  function pageAllowed(page) {
    const permissions = PAGE_RULES[page] || ["home.view"];
    if (page === "add-project.html") {
      const mode = new URLSearchParams(location.search).get("mode");
      if (mode === "status") return can("projects.status");
      if (new URLSearchParams(location.search).get("code")) return can("projects.edit");
      return can("projects.create");
    }
    return canAny(permissions);
  }
  function requestedProjectCode() {
    const query = new URLSearchParams(location.search);
    return query.get("code") || query.get("project") || query.get("projectCode") || "";
  }

  function applyNavigation() {
    const nav = document.querySelector("nav");
    if (!nav) return;
    if (!nav.querySelector('a[href="home.html"]')) {
      const link = document.createElement("a");
      link.href = "home.html";
      link.textContent = "Home";
      if (currentPage() === "home.html") link.className = "active";
      nav.insertBefore(link, nav.firstChild);
    }
    const baseHref = (value) => String(value || "").split(/[?#]/)[0];
    const findLink = (href) =>
      [...nav.querySelectorAll("a[href]")].find((link) => baseHref(link.getAttribute("href")) === href) ||
      null;
    const ensureLink = (href, label, beforeHref) => {
      if (findLink(href)) return;
      const link = document.createElement("a");
      const code = requestedProjectCode();
      link.href = href === "stage-gates.html" && code ? `${href}?code=${encodeURIComponent(code)}` : href;
      link.textContent = label;
      if (currentPage() === href) link.className = "active";
      const before = beforeHref ? findLink(beforeHref) : null;
      if (before) nav.insertBefore(link, before);
      else nav.appendChild(link);
    };
    ensureLink("stage-gates.html", "Stage Gates", "raid-log.html");
    ensureLink("administration.html", "Administration", "search.html");
    nav.querySelectorAll("a[href]").forEach((link) => {
      const file = baseHref(link.getAttribute("href"));
      const permission = NAV_RULES[file];
      if (
        permission &&
        !can(permission) &&
        !(file === "financial-management.html" && can("financials.viewDetail"))
      ) {
        link.dataset.ppmPermissionHidden = "true";
        link.setAttribute("aria-hidden", "true");
        link.tabIndex = -1;
      }
    });
  }

  function injectSessionBar() {
    const header = document.querySelector("header");
    if (!header || header.querySelector(".ppm-session-bar")) return;
    header.classList.add("ppm-auth-header");
    const bar = document.createElement("div");
    bar.className = "ppm-session-bar";
    bar.innerHTML = `<div class="ppm-session-identity"><span class="ppm-session-name"></span><span class="ppm-session-role"></span></div><button type="button" class="ppm-session-button">Sign out</button>`;
    bar.querySelector(".ppm-session-name").textContent = currentResource.fullName || currentResource.email;
    bar.querySelector(".ppm-session-role").textContent =
      `${currentResource.accessRole} · ${effectiveScope(currentResource)}`;
    bar.querySelector("button").addEventListener("click", logout);
    header.appendChild(bar);
  }

  function permissionToast(message) {
    document.querySelector(".ppm-permission-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "ppm-permission-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message || "Your current permission level does not allow this action.";
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function accessDenied() {
    const main = document.querySelector("main") || document.body;
    main.innerHTML = `<section class="ppm-access-denied"><div class="ppm-access-denied-card"><h2>Access not available</h2><p>Your current role or project scope does not include this page. You can return to your landing page or sign out and use another authorised account.</p><div class="ppm-access-denied-actions"><a class="ppm-auth-action" href="home.html">Go to Home</a><button class="ppm-auth-action secondary" id="ppmDeniedSignOut" type="button">Sign out</button></div></div></section>`;
    document.getElementById("ppmDeniedSignOut")?.addEventListener("click", logout);
  }

  /* ----------------------------------------------------------- permissions

    Every control that changes data must declare the permission it needs:

        <button data-permission="milestones.edit">Save changes</button>

    Controls that do not change data — Cancel, Close, filters, tab switches,
    display preferences — declare that explicitly instead:

        <button data-permission="none">Cancel</button>

    Anything that looks like it changes data but carries no tag is treated as
    forbidden and disabled. That is deliberate: a new button cannot reach
    production without someone deciding what permission it needs. Untagged
    controls are reported once on load via reportUntaggedControls().

    The old behaviour inferred the permission from the button's label text,
    which meant renaming a button silently changed its security.
  ------------------------------------------------------------------------ */

  const NOT_A_MUTATION = "none";

  // Only genuinely clickable things. The <tr class="add-row"> wrapper is not
  // interactive — the .add-row-button inside it is the control that matters.
  const CONTROL_SELECTOR = "button, a.button, .add-row-button, [role='button']";

  function isMutationControl(element) {
    if (element?.closest?.(".ppm-notification-centre")) return false;
    if (element?.closest?.(".ppm-history-modal")) return false;
    if (element?.dataset?.permission) return true;
    const text =
      `${element?.id || ""} ${element?.className || ""} ${element?.textContent || ""}`.toLowerCase();
    return /add|save|edit|delete|remove|archive|reopen|duplicate|approve|reject|submit|publish|deactivate|reactivate|decision|baseline|reset|create|update|manage categor/.test(
      text
    );
  }

  /*
    Returns the permission a control requires:
      a permission name  -> the user must hold it
      NOT_A_MUTATION     -> explicitly safe, never blocked
      ""                 -> untagged; the caller blocks it
  */
  function actionPermission(element) {
    const declared = element?.dataset?.permission;
    if (declared) return declared;
    return "";
  }

  const untaggedControls = new Set();

  function reportUntaggedControls() {
    if (!untaggedControls.size) return;
    const list = [...untaggedControls].sort();
    console.warn(
      `[PPM permissions] ${list.length} control(s) on ${currentPage()} change data but have no ` +
        `data-permission attribute, so they have been disabled. Add data-permission="<permission>" ` +
        `to each, or data-permission="none" if the control does not change data:\n  ` +
        list.join("\n  ")
    );
  }

  function describeControl(element) {
    const label = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `<${element.tagName.toLowerCase()}${element.id ? ` id="${element.id}"` : ""}${
      element.className ? ` class="${String(element.className).split(" ")[0]}"` : ""
    }> ${label}`;
  }

  /*
    Runs once during init, and again whenever a page injects controls afterwards - the
    project details page hosts the project form on demand, and controls that arrive after
    this pass would otherwise keep their Save button enabled for a read-only role. UI
    state is not the security boundary (RLS and the RPCs are), but it should not invite a
    user to attempt something the database will refuse.
  */
  function applyControlPermissions() {
    const page = currentPage();
    const projectCode = requestedProjectCode();
    /* Cleared so a second pass reports only what is still untagged, rather than
       repeating the first pass's list. */
    untaggedControls.clear();
    document.querySelectorAll("[data-permission]").forEach((element) => {
      // data-permission="none" marks a control that does not change data, such as
      // Cancel, a tab switch or a filter. It must never be hidden — "none" is not
      // a grantable permission, so it would otherwise fail the check below.
      if (element.dataset.permission === NOT_A_MUTATION) return;
      if (!can(element.dataset.permission, projectCode)) element.dataset.ppmPermissionHidden = "true";
    });
    document.querySelectorAll(CONTROL_SELECTOR).forEach((element) => {
      if (!isMutationControl(element)) return;
      const required = actionPermission(element);
      if (required === NOT_A_MUTATION) return;
      if (!required) untaggedControls.add(describeControl(element));
      // Fail closed: no tag means no permission, so the control is disabled.
      if (!required || !can(required, projectCode)) {
        element.classList.add("ppm-control-restricted");
        element.setAttribute("aria-disabled", "true");
        if (element.tagName === "BUTTON") element.disabled = true;
      }
    });
    reportUntaggedControls();
    const editPermission = PAGE_EDIT_RULES[page];
    if (editPermission && !can(editPermission, projectCode)) {
      document
        .querySelectorAll("main input, main textarea, main select, main [contenteditable]")
        .forEach((control) => {
          const signature = `${control.id || ""} ${control.className || ""}`.toLowerCase();
          const browsingControl =
            control.type === "search" ||
            /filter|search|selector|projectselect|view|zoom|sort|group|reportselector|tab/.test(signature);
          if (browsingControl) return;
          if (control.hasAttribute("contenteditable")) control.setAttribute("contenteditable", "false");
          else control.disabled = true;
        });
      if (!document.querySelector(".ppm-read-only-note") && document.querySelector("main")) {
        const note = document.createElement("div");
        note.className = "ppm-read-only-note";
        note.textContent =
          "Read-only access: your current role can view this information but cannot change it.";
        document.querySelector("main").prepend(note);
      }
    }
  }

  /*
    Some people may update the plan, but only the rows they own.

    This asked whether their single access role was the exact string "Project Team Member".
    The capability it was reaching for is "may edit the plan, but is not trusted with the
    whole of it", which is expressible: a team member holds plan.edit but not
    plan.requestBaseline, while every role that maintains a plan holds both.

    Stated as a capability it also behaves correctly for somebody holding two roles - a team
    member who is also a project manager gets the whole plan, because they hold the role that
    says so - where the role-name comparison would have restricted them on the strength of a
    string.
  */
  function restrictedToOwnPlanRows(resource) {
    return holdsPermission(resource, "plan.edit") && !holdsPermission(resource, "plan.requestBaseline");
  }

  function enforceOwnPlanRows() {
    if (!restrictedToOwnPlanRows(currentResource) || currentPage() !== "project-plan.html") return;
    const code = requestedProjectCode();
    const store = rawRead("ppmProjectPlans", {});
    const tasks = Array.isArray(store?.[code]) ? store[code] : [];
    document.querySelectorAll("tr[data-task-id]").forEach((row) => {
      const task = tasks.find((item) => item.taskId === row.dataset.taskId);
      if (task?.taskOwnerResourceId === currentResource.resourceId) return;
      row.querySelectorAll("input, select, textarea, button").forEach((control) => {
        control.disabled = true;
      });
      row.title = "Only the assigned task owner can update this row.";
    });
  }

  function enforceResourcePrivacy() {
    if (currentPage() !== "resource-directory.html") return;
    if (!can("resources.viewContact")) {
      document.querySelectorAll(".resource-email").forEach((element) => {
        element.removeAttribute("href");
        element.textContent = "Contact details restricted";
      });
    }
    /*
      A capability, not a job title. This asked whether somebody's single access role was
      the exact string "Resource Manager / Team Manager", which was already fragile - anyone
      who managed a team under a different role saw the whole directory - and breaks outright
      now that a person can hold that role as one of several.
    */
    if (holdsPermission(currentResource, "resources.manageTeam") && !can("resources.edit")) {
      const ownTeam = normalise(currentResource.team);
      document.querySelectorAll("#resourceTableBody tr").forEach((row) => {
        const id = row.querySelector("td")?.textContent?.trim();
        const resource = getResource(id);
        if (resource && normalise(resource.team) !== ownTeam) row.hidden = true;
      });
    }
  }

  function maskFinancialDetail() {
    if (
      currentPage() !== "financial-management.html" ||
      can("financials.viewDetail") ||
      !can("financials.viewRag")
    )
      return;
    const main = document.querySelector("main");
    if (!main) return;
    const projects = filterProjects(rawRead("ppmProjects", []));
    main.innerHTML = `<div class="page-heading"><div><h2>Financial status</h2><p>Your role can view financial RAG status but not budget, forecast, actual or commitment values.</p></div></div><div class="ppm-scope-note">Cost values and approval detail are restricted. Contact the Project Manager, Sponsor or PMO if you need additional access.</div><section class="ppm-finance-rag-only">${
      projects
        .map((project) => {
          const rag = String(project.financialRag || "Not Assessed");
          return `<article class="ppm-finance-rag-card"><h3>${escapeHtml(project.projectCode)} · ${escapeHtml(project.projectName || "Unnamed project")}</h3><span class="ppm-finance-rag-badge ${rag.toLowerCase()}">${escapeHtml(rag)}</span></article>`;
        })
        .join("") || "<p>No financial RAG records are available within your project scope.</p>"
    }</section>`;
  }
  const escapeHtml = PPMCore.escapeHtml;

  function applyDynamicRestrictions() {
    applyControlPermissions();
    enforceOwnPlanRows();
    enforceResourcePrivacy();
  }

  function requireAuth() {
    document.documentElement.classList.add("ppm-auth-pending");
    const page = currentPage();
    if (page === "login.html") {
      document.documentElement.classList.remove("ppm-auth-pending");
      return null;
    }
    if (!readValidSession()) {
      location.replace(loginUrl());
      return null;
    }
    installStorageScope(currentResource);
    document.documentElement.classList.remove("ppm-auth-pending");
    return currentResource;
  }

  async function initialisePage() {
    const page = currentPage();
    if (page === "login.html") {
      document.documentElement.classList.remove("ppm-auth-pending");
      return;
    }
    if (!currentResource && !requireAuth()) return;
    const hydration = [];
    if (window.PPMDatabase?.ready) hydration.push(PPMDatabase.ready);
    if (window.PPMChildDatabase?.ready) hydration.push(PPMChildDatabase.ready);
    if (hydration.length) await Promise.allSettled(hydration);
    applyNavigation();
    injectSessionBar();
    const code = requestedProjectCode();
    if (!pageAllowed(page) || (code && page !== "add-project.html" && !canAccessProject(code)))
      accessDenied();
    else {
      maskFinancialDetail();
      setTimeout(applyDynamicRestrictions, 0);
      const observer = new MutationObserver(() => {
        clearTimeout(observer.ppmTimer);
        observer.ppmTimer = setTimeout(applyDynamicRestrictions, 40);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    ["click", "keydown", "pointerdown"].forEach((eventName) =>
      document.addEventListener(eventName, touchSession, { passive: true })
    );
    document.addEventListener(
      "click",
      (event) => {
        const control = event.target.closest(CONTROL_SELECTOR);
        if (!control || !isMutationControl(control)) return;
        const required = actionPermission(control);
        if (required === NOT_A_MUTATION) return;
        // Fail closed here too, so a click cannot slip past an untagged control.
        if (!required || !can(required, requestedProjectCode())) {
          event.preventDefault();
          event.stopImmediatePropagation();
          permissionToast(
            required ? undefined : "This action is not available because it has no permission configured."
          );
        }
      },
      true
    );
    document.addEventListener(
      "submit",
      (event) => {
        const permission = event.target?.dataset?.permission || PAGE_EDIT_RULES[page];
        if (permission && !can(permission, requestedProjectCode())) {
          event.preventDefault();
          event.stopImmediatePropagation();
          permissionToast();
        }
      },
      true
    );
  }

  // Clear out any leftover local password store before anything else reads
  // storage. Runs on every page and does nothing once the key is gone.
  removeRetiredCredentialStore();

  // This executes before each page's inline application script, so project-scoped
  // users only receive their permitted project records from the prototype store.
  requireAuth();
  document.addEventListener("DOMContentLoaded", () => {
    initialisePage().catch((error) => console.error("PPM authentication page initialisation failed.", error));
  });

  window.PPMAuth = {
    ALL_PERMISSIONS,
    ROLE_DEFINITIONS,
    roleNames,
    roleDefinition,
    getResources,
    saveResources,
    getResource,
    getCurrentUser,
    establishSupabaseSession,
    effectiveScope,
    can,
    canAny,
    /* Capability tests that ignore project scope, for questions about the person rather
       than a project - team management, and what to show in the account summary. */
    holdsPermission,
    rolesOf,

    canAccessProject,
    /* For pages that inject controls after init - see applyControlPermissions(). */
    applyControlPermissions,
    filterProjects,
    projectAssignments,
    // Stage 3E removed passwordProblems, setPassword, hasCredential and login.
    // Sign-in is Supabase Auth + TOTP only; nothing here handles passwords.
    logout,
    endSession,
    audit,
    safeReturnUrl,
    permissionToast,
    SCOPED_KEYS,
    isScopedKey,
    readScoped,
    writeScoped,
    readGlobal,
    writeGlobal,
    // Low-level, unfiltered access. Prefer readGlobal / writeGlobal, which say
    // the same thing but record why the permission filter is being bypassed.
    rawRead,
    rawSet
  };
})();
