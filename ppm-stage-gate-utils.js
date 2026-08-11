(function () {
  "use strict";

  /*
    Stage 16: collections, not storage keys. These four were the localStorage keys this module
    read and wrote; they are now what PPMStore and both adapters call the same data, so the
    workflow capture below keys its snapshot by collection too and nothing is translated.
  */
  const GATES = "stageGates";
  const PROJECTS = "projects";
  const ACTIONS = "actions";
  const DECISIONS = "decisions";
  const STATUSES = [
    "Draft",
    "Submitted",
    "Conditionally Approved",
    "Approved",
    "Deferred",
    "Rejected",
    "Cancelled"
  ];
  const ROUTE_REQUIREMENTS = ["Required", "Optional", "Not Applicable"];
  const ROUTE_APPROVAL_STATUSES = ["Not Required", "Not Requested", "Pending", "Approved", "Rejected"];
  const DEFAULT_STAGE_ORDER = [
    "Intake",
    "Discovery",
    "Requirements and Design",
    "Build",
    "Test",
    "Implementation",
    "Hypercare",
    "Closure"
  ];
  const EDITABLE_STATUSES = new Set(["Draft", "Deferred", "Rejected"]);
  let workflowCapture = null;

  const clone = PPMCore.clone;

  /*
    Every collection this module touches is project-scoped data.

    That used to mean reading through PPMAuth's permission-filtered view of localStorage and
    writing back through the same filter, which merged in the records the user could not see so
    that a save did not discard them. Stage 16 removed the need: the store holds whatever RLS
    allowed this person to load, and writes are row by row, so records outside their access are
    never read, never written, and cannot be lost by anything happening here.
  */
  function rawRead(collection, fallback) {
    if (workflowCapture?.stores?.has(collection)) return clone(workflowCapture.stores.get(collection));
    return window.PPMStore ? window.PPMStore[collection].read() : fallback;
  }

  /*
    Stage 16: two modes, and the difference matters.

    INSIDE A WORKFLOW CAPTURE this writes nothing. It collects the intended state so
    runTransactionalWorkflow can send the whole set to the transactional function, which commits
    it as one transaction. That branch runs before any await, so although this is an async
    function the capture is complete the moment it is called - a caller inside the capture can
    ignore the returned promise, and transitionLocal and its siblings do.

    OUTSIDE A CAPTURE - drafting a gate, deleting a draft - it is an ordinary write and goes
    through the one seam like everything else. It used to go through PPMAuth.writeScoped into
    the patched localStorage, which returned before the database had been asked anything.
  */
  async function rawWrite(collection, value) {
    if (workflowCapture) {
      workflowCapture.stores.set(collection, clone(value));
      return { ok: true, captured: true, value };
    }
    if (!window.PPMStore) {
      return {
        ok: false,
        reason: "failed",
        message: "The data layer is not loaded on this page, so nothing was saved.",
        queued: false
      };
    }
    return window.PPMStore.replaceAll(collection, value);
  }

  function today() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function nowIso() {
    return new Date().toISOString();
  }
  function clean(value) {
    return String(value ?? "").trim();
  }
  function lower(value) {
    return clean(value).toLowerCase();
  }
  function stageOrder() {
    return Array.isArray(window.PPMGovernance?.STAGE_ORDER) && window.PPMGovernance.STAGE_ORDER.length
      ? [...window.PPMGovernance.STAGE_ORDER]
      : [...DEFAULT_STAGE_ORDER];
  }

  function projectStageOrder(projectOrCode) {
    const project = typeof projectOrCode === "string" ? findProject(projectOrCode) : projectOrCode;
    if (window.PPMAdmin?.projectStages && project) {
      const configured = window.PPMAdmin.projectStages(project);
      if (Array.isArray(configured)) {
        const names = configured
          .map((stage) => clean(stage && typeof stage === "object" ? stage.name : stage))
          .filter(Boolean);
        if (names.length) return names;
      }
    }
    return stageOrder();
  }

  function currentUser(explicitUser) {
    if (explicitUser && typeof explicitUser === "object") return explicitUser;
    return window.PPMAuth?.getCurrentUser?.() || null;
  }

  function permissionIsRegistered(permission) {
    return (
      Array.isArray(window.PPMAuth?.ALL_PERMISSIONS) && window.PPMAuth.ALL_PERMISSIONS.includes(permission)
    );
  }

  function can(permission, projectCode) {
    return Boolean(window.PPMAuth?.can?.(permission, projectCode));
  }

  function canView(projectCode) {
    if (!window.PPMAuth) return true;
    const byRole = permissionIsRegistered("stageGates.view")
      ? can("stageGates.view", projectCode)
      : can("projects.view", projectCode);
    return byRole || namedApproverOfAny(projectCode);
  }

  function canEdit(projectCode) {
    if (!window.PPMAuth) return true;
    return permissionIsRegistered("stageGates.submit")
      ? can("stageGates.submit", projectCode)
      : can("projects.edit", projectCode);
  }

  function canApprove(projectCode) {
    if (!window.PPMAuth) return true;
    return permissionIsRegistered("stageGates.approve")
      ? can("stageGates.approve", projectCode)
      : can("programmes.approve", projectCode) || can("projects.status", projectCode);
  }

  function canOverride(projectCode) {
    if (!window.PPMAuth) return true;
    return permissionIsRegistered("stageGates.override")
      ? can("stageGates.override", projectCode)
      : canApprove(projectCode);
  }

  function resourceHasPermission(resource, permission) {
    if (!resource || !permissionIsRegistered(permission)) return true;
    const override = resource.permissionOverrides?.[permission];
    if (override === "allow") return true;
    if (override === "deny") return false;
    const definition = window.PPMAuth?.roleDefinition?.(resource.accessRole);
    return Array.isArray(definition?.permissions) && definition.permissions.includes(permission);
  }

  function getProjectsRaw() {
    const rows = rawRead(PROJECTS, []);
    return Array.isArray(rows) ? rows.filter(Boolean) : [];
  }

  function findProject(projectCode) {
    return getProjectsRaw().find((project) => lower(project.projectCode) === lower(projectCode)) || null;
  }

  function isArchived(project) {
    return Boolean(
      project && (project.archived || project.isArchived || project.projectStatus === "Archived")
    );
  }

  function normalisePerson(source, fallback) {
    const value = source && typeof source === "object" ? source : {};
    const backup = fallback && typeof fallback === "object" ? fallback : {};
    return {
      resourceId: clean(value.resourceId || value.id || backup.resourceId || backup.id),
      name: clean(value.name || value.fullName || value.displayName || backup.name || backup.fullName),
      email: lower(value.email || backup.email),
      role: clean(value.role || value.jobTitle || value.accessRole || backup.role)
    };
  }

  function personFromResourceId(resourceId, fallback) {
    const id = clean(resourceId);
    const resources = window.PPMAuth?.getResources?.() || rawRead("people", []);
    const resource = Array.isArray(resources) ? resources.find((item) => item?.resourceId === id) : null;
    return normalisePerson(resource || {}, fallback || { resourceId: id });
  }

  /*
    Is this the same person?

    The resource id decides it whenever both sides have one - equal or not. It used to test the
    ids for equality, then fall through to comparing email addresses, which meant two people who
    share a mailbox matched, and the "both have ids, so no" line below it could never be reached.

    That was survivable while this only chose which row to highlight. Stage 18 made being named
    as an approver the authority to decide a gate, so it now answers "may this person approve",
    and it must answer it the same way the database does - private.is_named_gate_approver()
    matches on resourceId alone. A browser that is looser than the database offers buttons the
    database then refuses, which is the least useful place to discover a disagreement.

    Email and name remain the fallback for legacy approver entries recorded before resource ids
    were carried on them.
  */
  function samePerson(left, right) {
    const a = normalisePerson(left);
    const b = normalisePerson(right);
    if (a.resourceId && b.resourceId) return a.resourceId === b.resourceId;
    if (a.email && b.email) return a.email === b.email;
    return Boolean(a.name && b.name && lower(a.name) === lower(b.name));
  }

  function normaliseApprovers(source, legacyIds) {
    const values = Array.isArray(source) ? source : [];
    const ids = Array.isArray(legacyIds) ? legacyIds : clean(legacyIds).split(",").map(clean).filter(Boolean);
    const candidates = values.length ? values : ids.map((resourceId) => ({ resourceId }));
    const seen = new Set();
    return candidates
      .map((item) => {
        const person = personFromResourceId(item?.resourceId, item);
        const key = person.resourceId || person.email || lower(person.name);
        if (!key || seen.has(key)) return null;
        seen.add(key);
        return {
          ...person,
          decision: STATUSES.includes(item?.decision) ? item.decision : clean(item?.decision),
          decisionComments: clean(item?.decisionComments || item?.comments),
          decidedAt: clean(item?.decidedAt)
        };
      })
      .filter(Boolean);
  }

  function normaliseDocuments(source) {
    const values = Array.isArray(source) ? source : clean(source).split(/\r?\n/).filter(Boolean);
    return values
      .map((item) => {
        if (item && typeof item === "object")
          return { title: clean(item.title || item.name || item.url), url: clean(item.url || item.link) };
        const text = clean(item);
        const parts = text.split("|").map(clean);
        return parts.length > 1
          ? { title: parts[0] || parts[1], url: parts.slice(1).join("|") }
          : { title: text, url: /^https?:\/\//i.test(text) ? text : "" };
      })
      .filter((item) => item.title || item.url);
  }

  function normaliseActions(source, defaults) {
    const values = Array.isArray(source) ? source : clean(source).split(/\r?\n/).filter(Boolean);
    const fallback = defaults || {};
    return values
      .map((item) => {
        const record = item && typeof item === "object" ? item : { description: clean(item) };
        const owner = personFromResourceId(record.ownerResourceId || fallback.ownerResourceId, {
          name: record.owner || fallback.owner,
          email: record.ownerEmail || fallback.ownerEmail
        });
        return {
          description: clean(record.description || record.action || record.title),
          owner: owner.name,
          ownerResourceId: owner.resourceId,
          ownerEmail: owner.email,
          dueDate: clean(record.dueDate || fallback.dueDate),
          actionId: clean(record.actionId)
        };
      })
      .filter((item) => item.description);
  }

  function revisionNumber(value) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  function normaliseSubmissionHistory(source, gate) {
    const history = (Array.isArray(source) ? source : []).filter(Boolean).map((item, index) => {
      const revision = revisionNumber(item.revision || item.version || index + 1);
      return {
        revision,
        version: revision,
        submissionType: clean(item.submissionType || item.type || "Stage gate"),
        submittedAt: clean(item.submittedAt || item.timestamp),
        submittedOn: clean(item.submittedOn || item.submissionDate || item.submittedAt).slice(0, 10),
        submittedBy: clean(item.submittedBy || item.actorName),
        submittedByResourceId: clean(item.submittedByResourceId || item.actorResourceId),
        comments: clean(item.comments || item.submissionComments),
        gateName: clean(item.gateName),
        projectCode: clean(item.projectCode),
        currentStage: clean(item.currentStage),
        proposedNextStage: clean(item.proposedNextStage),
        submissionOwner: clean(item.submissionOwner),
        submissionOwnerResourceId: clean(item.submissionOwnerResourceId),
        meetingDate: clean(item.meetingDate),
        routeRequirement: clean(item.routeRequirement),
        routeReason: clean(item.routeReason),
        requiredApproverResourceIds: Array.isArray(item.requiredApproverResourceIds)
          ? item.requiredApproverResourceIds.map(clean).filter(Boolean)
          : [],
        supportingDocuments: normaliseDocuments(item.supportingDocuments),
        actionsArising: normaliseActions(item.actionsArising)
      };
    });
    if (!history.length && (gate?.submittedAt || gate?.routeRequestedAt)) {
      const revision = revisionNumber(gate.revision || gate.version);
      const submittedAt = clean(gate.submittedAt || gate.routeRequestedAt);
      history.push({
        revision,
        version: revision,
        submissionType: gate.routeRequirement === "Not Applicable" ? "Route exception" : "Stage gate",
        submittedAt,
        submittedOn: clean(gate.submissionDate || submittedAt).slice(0, 10),
        submittedBy: clean(gate.submittedBy || gate.routeRequestedBy),
        submittedByResourceId: clean(gate.submittedByResourceId || gate.routeRequestedByResourceId),
        comments: clean(gate.submissionComments),
        gateName: clean(gate.gateName),
        projectCode: clean(gate.projectCode),
        currentStage: clean(gate.currentStage),
        proposedNextStage: clean(gate.proposedNextStage),
        submissionOwner: clean(gate.submissionOwner),
        submissionOwnerResourceId: clean(gate.submissionOwnerResourceId),
        meetingDate: clean(gate.meetingDate),
        routeRequirement: clean(gate.routeRequirement),
        routeReason: clean(gate.routeReason),
        requiredApproverResourceIds: Array.isArray(gate.requiredApproverResourceIds)
          ? gate.requiredApproverResourceIds.map(clean).filter(Boolean)
          : [],
        supportingDocuments: normaliseDocuments(gate.supportingDocuments),
        actionsArising: normaliseActions(gate.actionsArising)
      });
    }
    return history.sort(
      (a, b) => a.revision - b.revision || String(a.submittedAt).localeCompare(String(b.submittedAt))
    );
  }

  function normaliseGate(source) {
    const gate = source && typeof source === "object" ? { ...source } : {};
    const project = findProject(gate.projectCode);
    const submitter = personFromResourceId(gate.submissionOwnerResourceId, {
      name: gate.submissionOwner,
      email: gate.submissionOwnerEmail
    });
    const routeApprover = personFromResourceId(gate.routeApproverResourceId, {
      name: gate.routeApprover,
      email: gate.routeApproverEmail
    });
    const actionOwner = personFromResourceId(gate.actionOwnerResourceId, {
      name: gate.actionOwner,
      email: gate.actionOwnerEmail
    });
    const routeRequirement = ROUTE_REQUIREMENTS.includes(gate.routeRequirement)
      ? gate.routeRequirement
      : "Required";
    const workflowStatus = STATUSES.includes(gate.workflowStatus || gate.status)
      ? gate.workflowStatus || gate.status
      : "Draft";
    const approvers = normaliseApprovers(gate.requiredApprovers, gate.requiredApproverResourceIds);
    const submissionHistory = normaliseSubmissionHistory(gate.submissionHistory, gate);
    const revision = Math.max(
      revisionNumber(gate.revision || gate.version),
      ...submissionHistory.map((item) => item.revision)
    );
    const normalised = {
      gateId: clean(gate.gateId),
      gateName: clean(gate.gateName || gate.title || "Stage gate"),
      projectCode: clean(gate.projectCode),
      projectName: clean(gate.projectName || project?.projectName),
      programmeId: clean(gate.programmeId || project?.programmeId),
      programmeName: clean(gate.programmeName || project?.programme || project?.workstream),
      currentStage: clean(gate.currentStage || project?.currentStage || stageOrder()[0]),
      proposedNextStage: clean(gate.proposedNextStage || gate.proposedStage || gate.nextStage),
      routeRequirement,
      routeReason: clean(gate.routeReason || gate.notApplicableReason || gate.governanceRouteReason),
      routeApprovalStatus:
        routeRequirement === "Not Applicable"
          ? ROUTE_APPROVAL_STATUSES.includes(gate.routeApprovalStatus) &&
            gate.routeApprovalStatus !== "Not Required"
            ? gate.routeApprovalStatus
            : gate.routeRequestedAt
              ? "Pending"
              : "Not Requested"
          : "Not Required",
      routeApprover: routeApprover.name,
      routeApproverResourceId: routeApprover.resourceId,
      routeApproverEmail: routeApprover.email,
      routeApprovalDate: clean(gate.routeApprovalDate),
      routeApprovalComments: clean(gate.routeApprovalComments),
      routeRequestedBy: clean(gate.routeRequestedBy),
      routeRequestedByResourceId: clean(gate.routeRequestedByResourceId),
      routeRequestedAt: clean(gate.routeRequestedAt),
      submissionOwner: submitter.name,
      submissionOwnerResourceId: submitter.resourceId,
      submissionOwnerEmail: submitter.email,
      submissionDate: clean(gate.submissionDate),
      submittedBy: clean(gate.submittedBy),
      submittedByResourceId: clean(gate.submittedByResourceId),
      submittedAt: clean(gate.submittedAt),
      requiredApprovers: approvers,
      requiredApproverResourceIds: approvers.map((item) => item.resourceId).filter(Boolean),
      meetingDate: clean(gate.meetingDate),
      decisionDate: clean(gate.decisionDate),
      workflowStatus,
      status: workflowStatus,
      revision,
      version: revision,
      submissionComments: clean(gate.submissionComments || gate.comments),
      approvalComments: clean(gate.approvalComments),
      conditions: clean(gate.conditions),
      rejectionDeferralReason: clean(gate.rejectionDeferralReason || gate.outcomeReason),
      supportingDocuments: normaliseDocuments(gate.supportingDocuments || gate.documentLinks),
      actionsArising: normaliseActions(gate.actionsArising || gate.actionTexts, {
        owner: actionOwner.name,
        ownerResourceId: actionOwner.resourceId,
        ownerEmail: actionOwner.email,
        dueDate: gate.actionDueDate
      }),
      actionOwner: actionOwner.name,
      actionOwnerResourceId: actionOwner.resourceId,
      actionOwnerEmail: actionOwner.email,
      actionDueDate: clean(gate.actionDueDate),
      linkedActionIds: Array.isArray(gate.linkedActionIds)
        ? gate.linkedActionIds.map(clean).filter(Boolean)
        : [],
      decisionSummary: clean(gate.decisionSummary || gate.finalDecision),
      linkedDecisionId: clean(gate.linkedDecisionId),
      completionDate: clean(gate.completionDate),
      createdAt: clean(gate.createdAt),
      createdBy: clean(gate.createdBy),
      createdByResourceId: clean(gate.createdByResourceId),
      updatedAt: clean(gate.updatedAt),
      updatedBy: clean(gate.updatedBy),
      updatedByResourceId: clean(gate.updatedByResourceId),
      decisionHistory: Array.isArray(gate.decisionHistory) ? gate.decisionHistory.filter(Boolean) : [],
      routeApprovalHistory: Array.isArray(gate.routeApprovalHistory)
        ? gate.routeApprovalHistory.filter(Boolean)
        : [],
      submissionHistory,
      databaseId: gate.databaseId || "",
      databaseVersion:
        gate.databaseVersion === undefined || gate.databaseVersion === null ? undefined : Number(gate.databaseVersion),
      recordSource: gate.recordSource || ""
    };
    return normalised;
  }

  function readStoreRaw() {
    const stored = rawRead(GATES, {});
    if (Array.isArray(stored)) {
      return stored.reduce((groups, source) => {
        const gate = normaliseGate(source);
        if (!gate.projectCode) return groups;
        (groups[gate.projectCode] ||= []).push(gate);
        return groups;
      }, {});
    }
    if (!stored || typeof stored !== "object") return {};
    return Object.entries(stored).reduce((groups, [projectCode, rows]) => {
      if (!Array.isArray(rows)) return groups;
      groups[projectCode] = rows
        .filter(Boolean)
        .map((source) => normaliseGate({ ...source, projectCode: source.projectCode || projectCode }));
      return groups;
    }, {});
  }

  function flattenStore(store) {
    return Object.values(store || {})
      .filter(Array.isArray)
      .flat()
      .filter(Boolean)
      .map(normaliseGate);
  }

  function getAll() {
    return flattenStore(readStoreRaw())
      .filter((gate) => canView(gate.projectCode))
      .map(clone);
  }

  function getForProject(projectCode) {
    const code = clean(projectCode);
    if (!code || !canView(code)) return [];
    return getAll().filter((gate) => lower(gate.projectCode) === lower(code));
  }

  function find(gateId, projectCode) {
    const id = clean(gateId);
    if (!id) return null;
    return (
      getAll().find(
        (gate) => gate.gateId === id && (!projectCode || lower(gate.projectCode) === lower(projectCode))
      ) || null
    );
  }

  function findRaw(gateId, projectCode) {
    const id = clean(gateId);
    return (
      flattenStore(readStoreRaw()).find(
        (gate) => gate.gateId === id && (!projectCode || lower(gate.projectCode) === lower(projectCode))
      ) || null
    );
  }

  function nextGateId() {
    const maximum = flattenStore(readStoreRaw()).reduce((current, gate) => {
      const match = gate.gateId.match(/^(?:GATE|SG)-(\d+)$/i);
      return match ? Math.max(current, Number(match[1])) : current;
    }, 0);
    return `GATE-${String(maximum + 1).padStart(5, "0")}`;
  }

  function nextStage(currentStage, projectOrCode) {
    const stages = projectStageOrder(projectOrCode);
    const index = stages.indexOf(currentStage);
    return index >= 0 && index < stages.length - 1 ? stages[index + 1] : "";
  }

  function newGate(projectCode, overrides) {
    const project = findProject(projectCode);
    if (!project) throw new Error("Select a project from the Project Register before adding a stage gate.");
    if (!canEdit(project.projectCode))
      throw new Error("Your permissions do not allow you to add a stage gate for this project.");
    if (isArchived(project))
      throw new Error("Archived projects are read-only and cannot receive a new stage gate.");
    const actor = normalisePerson(currentUser());
    const owner = personFromResourceId(project.projectManagerResourceId, {
      name: project.projectManager,
      email: project.projectManagerEmail
    });
    const gate = normaliseGate({
      gateId: nextGateId(),
      gateName: `${nextStage(project.currentStage || projectStageOrder(project)[0], project) || project.currentStage || "Closure"} gate`,
      projectCode: project.projectCode,
      projectName: project.projectName,
      programmeId: project.programmeId,
      programmeName: project.programme || project.workstream,
      currentStage: project.currentStage || projectStageOrder(project)[0],
      proposedNextStage: nextStage(project.currentStage || projectStageOrder(project)[0], project),
      routeRequirement: "Required",
      routeApprovalStatus: "Not Required",
      submissionOwner: owner.name || actor.name,
      submissionOwnerResourceId: owner.resourceId || actor.resourceId,
      submissionOwnerEmail: owner.email || actor.email,
      workflowStatus: "Draft",
      createdAt: nowIso(),
      createdBy: actor.name,
      createdByResourceId: actor.resourceId,
      updatedAt: nowIso(),
      updatedBy: actor.name,
      updatedByResourceId: actor.resourceId,
      ...(overrides || {})
    });
    gate.revision = gate.version = 1;
    gate.submissionHistory = [];
    return gate;
  }

  function recordSubmission(gate, actor, submissionType, comments, timestamp) {
    const history = normaliseSubmissionHistory(gate.submissionHistory, null);
    const revision = history.length
      ? Math.max(...history.map((item) => revisionNumber(item.revision || item.version))) + 1
      : 1;
    const submittedAt = clean(timestamp) || nowIso();
    const entry = {
      revision,
      version: revision,
      submissionType: clean(submissionType || "Stage gate"),
      submittedAt,
      submittedOn: clean(gate.submissionDate || submittedAt).slice(0, 10),
      submittedBy: actor.name,
      submittedByResourceId: actor.resourceId,
      comments: clean(comments),
      gateName: gate.gateName,
      projectCode: gate.projectCode,
      currentStage: gate.currentStage,
      proposedNextStage: gate.proposedNextStage,
      submissionOwner: gate.submissionOwner,
      submissionOwnerResourceId: gate.submissionOwnerResourceId,
      meetingDate: gate.meetingDate,
      routeRequirement: gate.routeRequirement,
      routeReason: gate.routeReason,
      requiredApproverResourceIds: gate.requiredApprovers.map((item) => item.resourceId).filter(Boolean),
      supportingDocuments: clone(gate.supportingDocuments),
      actionsArising: clone(gate.actionsArising)
    };
    gate.revision = gate.version = revision;
    gate.submissionHistory = [...history, entry];
    return entry;
  }

  /*
    Two different questions, deliberately kept apart.

      errors    the record cannot be written as described - no gate id, a stage that is not in
                the project's lifecycle, a next stage equal to the current one. These are
                statements about the data, and they still refuse.

      advice    the organisation's own readiness rules say something is outstanding. These no
                longer refuse anything.

    WHY READINESS STOPPED BLOCKING

    It was refusing submission and approval on behalf of the people whose judgement the gate
    exists to record. A stage gate IS the decision - if a sponsor wants to approve with three
    evidence items outstanding, because they know something the mandatory-field list does not,
    that is precisely the call they are accountable for. Software that refuses is not enforcing
    governance; it is substituting a checklist for a decision and leaving the person no way to
    record that they made one.

    So the rules are still evaluated, still shown, and now carried onto the decision record: an
    approval made with items outstanding says so, permanently, with the list. That is a better
    governance artefact than a refusal, because a refusal leaves no trace at all - the person
    simply fills in whatever unblocks the button.

    The database never enforced readiness. This was only ever a browser rule.
  */
  function validate(gateSource, mode) {
    const gate = normaliseGate(gateSource);
    const errors = [];
    const advice = [];
    const project = findProject(gate.projectCode);
    const configuredStages = project ? projectStageOrder(project) : stageOrder();
    if (!gate.gateId) errors.push("Gate ID is required.");
    if (!gate.projectCode || !project) errors.push("A valid project is required.");
    if (!gate.gateName) errors.push("Gate name is required.");
    if (!gate.currentStage) errors.push("Current stage is required.");
    if (gate.routeRequirement !== "Not Applicable" && !gate.proposedNextStage)
      errors.push("Proposed next stage is required.");
    if (gate.currentStage && !configuredStages.includes(gate.currentStage))
      errors.push(`${gate.currentStage} is not part of the project's assigned lifecycle template.`);
    if (
      gate.routeRequirement !== "Not Applicable" &&
      gate.proposedNextStage &&
      !configuredStages.includes(gate.proposedNextStage)
    )
      errors.push(`${gate.proposedNextStage} is not part of the project's assigned lifecycle template.`);
    if (gate.routeRequirement !== "Not Applicable" && gate.proposedNextStage === gate.currentStage)
      errors.push("Proposed next stage must be different from the current stage.");
    if (gate.routeRequirement === "Not Applicable" && !gate.routeReason)
      errors.push("A reason is required when a gate is not applicable.");
    if (gate.routeRequirement === "Not Applicable" && !gate.routeApproverResourceId)
      errors.push("An approver is required for a not-applicable route.");
    if (mode === "submit") {
      if (project && clean(project.currentStage) !== gate.currentStage)
        errors.push(
          `The project is now at ${project.currentStage || "an unset stage"}; refresh this gate before submitting it.`
        );
      if (!gate.submissionOwnerResourceId) errors.push("Submission owner is required before submission.");
      if (!gate.requiredApprovers.length)
        errors.push("At least one required approver is needed before submission.");
      if (gate.requiredApprovers.some((approver) => !approver.resourceId))
        errors.push("Every required approver must be selected from Resources.");
      const resources = window.PPMAuth?.getResources?.() || rawRead("people", []);
      const unauthorisedApprover = gate.requiredApprovers.find((approver) => {
        const resource = Array.isArray(resources)
          ? resources.find((item) => item?.resourceId === approver.resourceId)
          : null;
        return (
          !resource ||
          (permissionIsRegistered("stageGates.approve") &&
            (resource.accountStatus !== "Active" || !resourceHasPermission(resource, "stageGates.approve")))
        );
      });
      /*
        Stage 18 made being named the authority, and dropped the matching rule from
        ppm_commit_stage_gate_workflow. This is its browser twin: it now only asks whether the
        person can actually sign in, because naming somebody who can never open the tool leaves
        the gate stuck with no way to say so.
      */
      if (unauthorisedApprover)
        errors.push(
          `${unauthorisedApprover.name || unauthorisedApprover.resourceId} does not have an active account, so could never record a decision.`
        );
      if (
        gate.requiredApprovers.some((approver) =>
          samePerson(approver, {
            resourceId: gate.submissionOwnerResourceId,
            name: gate.submissionOwner,
            email: gate.submissionOwnerEmail
          })
        )
      )
        errors.push("The submission owner cannot also be a required approver.");
      if (gate.routeRequirement === "Not Applicable")
        errors.push(
          "Use the governance-route exception approval instead of submitting a not-applicable gate."
        );
      if (project && gate.proposedNextStage && window.PPMAdmin?.evaluateProjectStage) {
        const readiness = window.PPMAdmin.evaluateProjectStage(project, gate.proposedNextStage, {
          includeRelated: true
        });
        if (!readiness.valid) {
          advice.push({
            stage: gate.proposedNextStage,
            outstanding: readiness.missing.map((item) => item.label),
            summary: readinessSentence(gate.proposedNextStage, readiness.missing)
          });
        }
      }
    }
    if (project && isArchived(project)) errors.push("Archived projects are read-only.");
    return { valid: errors.length === 0, errors, advice, gate };
  }

  /* One sentence naming what is outstanding, for a dialogue and for the decision record. */
  function readinessSentence(stage, missing) {
    const rows = Array.isArray(missing) ? missing : [];
    if (!rows.length) return "";
    const labels = rows.slice(0, 8).map((item) => item.label || item).join(", ");
    const remainder = rows.length > 8 ? ` and ${rows.length - 8} more` : "";
    return `${stage} readiness is incomplete: ${labels}${remainder}.`;
  }

  /*
    What the organisation's rules say is outstanding for this gate's proposed stage.

    Exported so the page can show it before somebody commits, and so a decision can record it.
    Answering with an empty list when the rules cannot be evaluated is deliberate: an unavailable
    checklist is not evidence of a problem, and must not read as one.
  */
  function readinessFor(gateSource) {
    const gate = normaliseGate(gateSource);
    const project = findProject(gate.projectCode);
    if (!project || !gate.proposedNextStage || !window.PPMAdmin?.evaluateProjectStage) {
      return { outstanding: [], summary: "" };
    }
    const readiness = window.PPMAdmin.evaluateProjectStage(project, gate.proposedNextStage, {
      includeRelated: true
    });
    if (readiness.valid) return { outstanding: [], summary: "" };
    const outstanding = readiness.missing.map((item) => item.label);
    return { outstanding, summary: readinessSentence(gate.proposedNextStage, readiness.missing) };
  }

  /*
    Stage 14 removed the browser-side audit writer that used to live here.

    It wrote governance events into ppmAuditHistory in localStorage, which the
    Audit History page then showed as unverified. Every one of those events is now
    recorded by a database trigger from the authenticated identity, into an
    append-only table the application has no privilege to change. Writing a second,
    weaker copy from the browser added no information and invited the two to
    disagree.

    The workflow capture below still collects UI events, because those drive
    on-screen notifications rather than the audit trail.
  */

  function fieldChanges(before, after) {
    const fields = [
      ["gateName", "Gate name"],
      ["projectCode", "Project ID"],
      ["currentStage", "Current stage"],
      ["proposedNextStage", "Proposed next stage"],
      ["routeRequirement", "Route requirement"],
      ["routeReason", "Route reason"],
      ["routeApprover", "Route approver"],
      ["routeApprovalStatus", "Route approval status"],
      ["submissionOwner", "Submission owner"],
      ["requiredApprovers", "Required approvers"],
      ["submissionDate", "Submission date"],
      ["meetingDate", "Meeting date"],
      ["decisionDate", "Decision date"],
      ["workflowStatus", "Workflow status"],
      ["revision", "Gate version"],
      ["submissionComments", "Submission comments"],
      ["approvalComments", "Approval comments"],
      ["conditions", "Conditions"],
      ["rejectionDeferralReason", "Rejection / deferral reason"],
      ["supportingDocuments", "Supporting documents"],
      ["actionsArising", "Actions arising"],
      ["linkedActionIds", "Linked actions"],
      ["linkedDecisionId", "Linked decision"],
      ["completionDate", "Completion date"]
    ];
    return fields.reduce((changes, [key, label]) => {
      const oldValue = before?.[key] ?? "";
      const newValue = after?.[key] ?? "";
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue))
        changes.push({ field: key, label, before: oldValue, after: newValue });
      return changes;
    }, []);
  }

  async function writeGate(gate, oldProjectCode) {
    const store = readStoreRaw();
    const removeFrom = clean(oldProjectCode || gate.projectCode);
    if (store[removeFrom])
      store[removeFrom] = store[removeFrom].filter((item) => item.gateId !== gate.gateId);
    (store[gate.projectCode] ||= []).push(normaliseGate(gate));
    rawWrite(GATES, store);
  }

  async function save(gateSource) {
    const incoming = normaliseGate(gateSource);
    const existing = findRaw(incoming.gateId);
    const project = findProject(incoming.projectCode);
    if (!project) throw new Error("The selected project is no longer available.");
    if (!canEdit(incoming.projectCode) || (existing && !canEdit(existing.projectCode)))
      throw new Error("Your permissions do not allow you to edit this stage gate.");
    if (isArchived(project) || (existing && isArchived(findProject(existing.projectCode))))
      throw new Error("Archived projects are read-only.");
    if (existing && !EDITABLE_STATUSES.has(existing.workflowStatus))
      throw new Error(
        `${existing.gateId} is ${existing.workflowStatus.toLowerCase()} and is read-only; use its workflow actions.`
      );
    if (existing && existing.routeApprovalStatus === "Pending" && existing.routeRequestedAt) {
      if (JSON.stringify(incoming) === JSON.stringify(existing)) return clone(existing);
      throw new Error(
        `${existing.gateId} has a route exception awaiting decision and is read-only; use its workflow actions.`
      );
    }
    if (existing && incoming.workflowStatus !== existing.workflowStatus)
      throw new Error("Use the stage-gate workflow actions to change status.");
    if (!existing) incoming.workflowStatus = incoming.status = "Draft";
    const checked = validate(incoming, "save");
    if (!checked.valid) throw new Error(checked.errors.join(" "));
    const actor = normalisePerson(currentUser());
    const gate = checked.gate;
    gate.projectName = project.projectName || gate.projectName;
    gate.programmeId = project.programmeId || gate.programmeId;
    gate.programmeName = project.programme || project.workstream || gate.programmeName;
    gate.createdAt = existing?.createdAt || gate.createdAt || nowIso();
    gate.createdBy = existing?.createdBy || gate.createdBy || actor.name;
    gate.createdByResourceId = existing?.createdByResourceId || gate.createdByResourceId || actor.resourceId;
    if (existing) {
      gate.revision = gate.version = revisionNumber(existing.revision || existing.version);
      gate.submissionHistory = clone(existing.submissionHistory);
      gate.decisionHistory = clone(existing.decisionHistory);
      gate.routeApprovalHistory = clone(existing.routeApprovalHistory);
      gate.linkedActionIds = clone(existing.linkedActionIds);
      gate.linkedDecisionId = existing.linkedDecisionId;
      gate.submittedAt = existing.submittedAt;
      gate.submittedBy = existing.submittedBy;
      gate.submittedByResourceId = existing.submittedByResourceId;
    } else {
      gate.revision = gate.version = 1;
      gate.submissionHistory = [];
      gate.decisionHistory = [];
      gate.routeApprovalHistory = [];
      gate.linkedActionIds = [];
      gate.linkedDecisionId = "";
    }
    gate.updatedAt = nowIso();
    gate.updatedBy = actor.name;
    gate.updatedByResourceId = actor.resourceId;
    if (gate.routeRequirement !== "Not Applicable") {
      gate.routeApprovalStatus = "Not Required";
      gate.routeReason = gate.routeReason || "";
      gate.routeApprover = "";
      gate.routeApproverResourceId = "";
      gate.routeApproverEmail = "";
      gate.routeApprovalDate = "";
    } else {
      const routeChanged =
        !existing ||
        existing.routeRequirement !== "Not Applicable" ||
        existing.routeApproverResourceId !== gate.routeApproverResourceId ||
        existing.routeReason !== gate.routeReason;
      if (routeChanged) {
        gate.routeApprovalStatus = "Not Requested";
        gate.routeApprovalDate = "";
        gate.routeApprovalComments = "";
        gate.routeRequestedBy = "";
        gate.routeRequestedByResourceId = "";
        gate.routeRequestedAt = "";
      } else {
        gate.routeApprovalStatus = existing.routeApprovalStatus;
        gate.routeApprovalDate = existing.routeApprovalDate;
        gate.routeApprovalComments = existing.routeApprovalComments;
        gate.routeRequestedBy = existing.routeRequestedBy;
        gate.routeRequestedByResourceId = existing.routeRequestedByResourceId;
        gate.routeRequestedAt = existing.routeRequestedAt;
      }
    }
    const written = await writeGate(gate, existing?.projectCode);
    if (written && written.ok === false) throw new Error(written.message);
    dispatchChange("saved", gate);
    return clone(gate);
  }

  async function deleteGate(gateId, projectCode) {
    const existing = findRaw(gateId, projectCode);
    if (!existing) return false;
    if (!canEdit(existing.projectCode))
      throw new Error("Your permissions do not allow you to delete this stage gate.");
    if (isArchived(findProject(existing.projectCode))) throw new Error("Archived projects are read-only.");
    if (existing.routeApprovalStatus === "Pending" && existing.routeRequestedAt)
      throw new Error(
        "A route exception awaiting decision is retained as governance history and cannot be deleted."
      );
    const deletableStatuses = databaseWorkflowEnabled() ? ["Draft"] : ["Draft", "Deferred", "Rejected"];
    if (!deletableStatuses.includes(existing.workflowStatus))
      throw new Error(
        databaseWorkflowEnabled()
          ? "Once Stage 11A is database-authoritative, only Draft stage gates can be deleted; any decided/submitted gate is retained as governance history."
          : "Submitted, approved or closed stage gates are retained as governance history and cannot be deleted."
      );
    const store = readStoreRaw();
    store[existing.projectCode] = (store[existing.projectCode] || []).filter(
      (gate) => gate.gateId !== existing.gateId
    );
    if (!store[existing.projectCode].length) delete store[existing.projectCode];

    /* Awaited: the gate is only reported deleted, and the change only announced, once the
       database has accepted it. */
    const removed = await rawWrite(GATES, store);
    if (removed && removed.ok === false) throw new Error(removed.message);

    dispatchChange("deleted", existing);
    return true;
  }

  /*
    Stage 18: being named as a required approver IS the authority to decide.

    It used to be one of two conditions - the person had to be named AND their role had to hold
    stageGates.approve for that project. That is the wrong shape for an approval. An executive
    who wants a subject-matter expert to sign a gate has to have the expert's role changed for
    every other screen in the application first, and a sponsor named on a project outside their
    scope simply cannot act.

    The controls that make an approval mean something are elsewhere and unchanged: the submitter
    cannot name themselves, you cannot decide a gate you submitted or own, only a named approver
    can decide, approvers are frozen once a decision is being recorded, and the decision is
    written by a database trigger from the authenticated identity.
  */
  function isAssignedApprover(gate, user) {
    const actor = normalisePerson(currentUser(user));
    return gate.requiredApprovers.some((approver) => samePerson(approver, actor));
  }

  /* Being named is also a reason to be able to see the gate at all: an approver on a project
     outside their scope must still be able to open the thing they are being asked to sign. */
  function namedApproverOfAny(projectCode) {
    const actor = normalisePerson(currentUser());
    if (!actor?.resourceId && !actor?.email) return false;
    return flattenStore(readStoreRaw())
      .filter((gate) => lower(gate.projectCode) === lower(projectCode))
      .some((gate) => (gate.requiredApprovers || []).some((approver) => samePerson(approver, actor)));
  }

  function isSelfApproval(gate, user) {
    const actor = normalisePerson(currentUser(user));
    return [
      {
        resourceId: gate.submissionOwnerResourceId,
        name: gate.submissionOwner,
        email: gate.submissionOwnerEmail
      },
      { resourceId: gate.submittedByResourceId, name: gate.submittedBy }
    ].some((person) => samePerson(person, actor));
  }

  function canCancel(gate, user) {
    const actor = normalisePerson(currentUser(user));
    const ownerOrSubmitter = [
      {
        resourceId: gate.submissionOwnerResourceId,
        name: gate.submissionOwner,
        email: gate.submissionOwnerEmail
      },
      { resourceId: gate.submittedByResourceId, name: gate.submittedBy }
    ].some((person) => samePerson(person, actor));
    return ownerOrSubmitter || canOverride(gate.projectCode);
  }

  function allowedTransitions(gateSource, explicitUser) {
    const gate = normaliseGate(gateSource);
    const project = findProject(gate.projectCode);
    if (!project || isArchived(project)) return [];
    const transitions = [];
    const editable = canEdit(gate.projectCode);
    const assigned = isAssignedApprover(gate, explicitUser);
    /* Stage 18: named, and not their own gate. The role test that used to be here is gone -
       see isAssignedApprover() for why. */
    const approvable = assigned && !isSelfApproval(gate, explicitUser);
    if (gate.routeRequirement === "Not Applicable") {
      if (
        editable &&
        gate.workflowStatus === "Draft" &&
        gate.routeApprovalStatus !== "Pending" &&
        canCancel(gate, explicitUser)
      )
        transitions.push("Cancelled");
      return transitions;
    }
    if (gate.workflowStatus === "Draft" && editable) {
      transitions.push("Submitted");
      if (canCancel(gate, explicitUser)) transitions.push("Cancelled");
    }
    if (["Deferred", "Rejected"].includes(gate.workflowStatus) && editable) {
      transitions.push("Draft", "Submitted");
      if (canCancel(gate, explicitUser)) transitions.push("Cancelled");
    }
    if (["Submitted", "Conditionally Approved"].includes(gate.workflowStatus)) {
      if (approvable) transitions.push("Conditionally Approved", "Approved", "Deferred", "Rejected");
      if (editable && canCancel(gate, explicitUser)) transitions.push("Cancelled");
    }
    return [...new Set(transitions)];
  }

  function nextRecordId(collection, prefix, idField) {
    const store = rawRead(collection, {});
    const rows = Array.isArray(store)
      ? store
      : Object.values(store || {})
          .filter(Array.isArray)
          .flat();
    const maximum = rows.reduce((current, row) => {
      const match = clean(row?.[idField]).match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
      return match ? Math.max(current, Number(match[1])) : current;
    }, 0);
    return `${prefix}-${String(maximum + 1).padStart(4, "0")}`;
  }

  function addGroupedRecord(collection, projectCode, record) {
    const stored = rawRead(collection, {});
    const store = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    (store[projectCode] ||= []).push(record);
    rawWrite(collection, store);
  }

  function createActions(gate) {
    const created = [];
    gate.actionsArising
      .filter((item) => !item.actionId)
      .forEach((item) => {
        const actionId = nextRecordId(ACTIONS, "ACT", "actionId");
        const record = {
          actionId,
          projectCode: gate.projectCode,
          description: item.description,
          source: `Stage gate ${gate.gateId} v${gate.revision}`,
          owner: item.owner || gate.submissionOwner,
          ownerResourceId: item.ownerResourceId || gate.submissionOwnerResourceId,
          ownerEmail: item.ownerEmail || gate.submissionOwnerEmail,
          supportingOwners: "",
          dateRaised: gate.decisionDate || today(),
          dueDate: item.dueDate || gate.actionDueDate || "",
          priority: "High",
          status: "Open",
          completionDate: "",
          completionCommentary: "",
          evidence: "",
          escalationStatus: "Not Escalated",
          relatedRecords: gate.gateId,
          createdAt: nowIso(),
          updatedAt: nowIso()
        };
        addGroupedRecord(ACTIONS, gate.projectCode, record);
        item.actionId = actionId;
        created.push(actionId);
      });
    gate.linkedActionIds = [...new Set([...gate.linkedActionIds, ...created])];
  }

  function defaultDecisionSummary(gate, status) {
    if (status === "Rejected")
      return `Rejected: ${gate.gateName}${gate.rejectionDeferralReason ? ` — ${gate.rejectionDeferralReason}` : ""}`;
    if (status === "Deferred")
      return `Deferred: ${gate.gateName}${gate.rejectionDeferralReason ? ` — ${gate.rejectionDeferralReason}` : ""}`;
    if (status === "Conditionally Approved")
      return `Conditionally approved: ${gate.gateName}${gate.conditions ? ` — ${gate.conditions}` : ""}`;
    if (status === "Approved")
      return `Approved: ${gate.gateName}${gate.proposedNextStage ? ` — progress to ${gate.proposedNextStage}` : ""}`;
    if (status === "Cancelled") return `Cancelled: ${gate.gateName}`;
    return `${status || "Decision recorded"}: ${gate.gateName}`;
  }

  function createDecision(gate) {
    const decisionId = gate.linkedDecisionId || nextRecordId(DECISIONS, "DEC", "decisionId");
    const primaryApprover = gate.requiredApprovers[0] || {};
    const routeDecision =
      gate.routeRequirement === "Not Applicable" &&
      ["Approved", "Rejected"].includes(gate.routeApprovalStatus)
        ? gate.routeApprovalStatus
        : "";
    const status =
      routeDecision ||
      (gate.workflowStatus === "Approved" || gate.workflowStatus === "Conditionally Approved"
        ? "Approved"
        : gate.workflowStatus);
    const isRouteException = Boolean(routeDecision);
    const record = {
      decisionId,
      projectCode: gate.projectCode,
      decisionRequired: isRouteException
        ? `${gate.gateName}: approve the governance route as not applicable`
        : `${gate.gateName}: move from ${gate.currentStage} to ${gate.proposedNextStage || "the next approved stage"}`,
      background: gate.submissionComments || `Formal decision for ${gate.gateId}.`,
      optionsConsidered: "Approve; conditionally approve; defer; reject",
      recommendation: isRouteException
        ? `Treat the gate as not applicable: ${gate.routeReason}`
        : gate.proposedNextStage
          ? `Progress to ${gate.proposedNextStage}.`
          : "Apply the agreed governance route.",
      decisionOwner: isRouteException ? gate.routeApprover : primaryApprover.name,
      decisionOwnerResourceId: isRouteException ? gate.routeApproverResourceId : primaryApprover.resourceId,
      decisionOwnerEmail: isRouteException ? gate.routeApproverEmail : primaryApprover.email,
      requiredByDate: gate.meetingDate || gate.decisionDate,
      status,
      finalDecision:
        gate.decisionSummary || defaultDecisionSummary(gate, routeDecision || gate.workflowStatus),
      decisionDate: gate.decisionDate,
      rationale: isRouteException
        ? gate.routeApprovalComments || gate.routeReason
        : ["Rejected", "Deferred"].includes(gate.workflowStatus)
          ? gate.rejectionDeferralReason || gate.approvalComments
          : gate.approvalComments || gate.rejectionDeferralReason,
      conditions: gate.conditions,
      impact:
        !isRouteException && gate.workflowStatus === "Approved"
          ? `Project stage updated to ${gate.proposedNextStage}.`
          : "Project stage was not changed.",
      relatedRecords: gate.gateId,
      supportingEvidence: gate.supportingDocuments
        .map((item) => item.url || item.title)
        .filter(Boolean)
        .join("; "),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const stored = rawRead(DECISIONS, {});
    const store = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    const rows = Array.isArray(store[gate.projectCode]) ? store[gate.projectCode] : [];
    const existingIndex = rows.findIndex((item) => item?.decisionId === decisionId);
    const previousDecisionStatus = existingIndex >= 0 ? clean(rows[existingIndex]?.status) : "";
    if (existingIndex >= 0) {
      record.createdAt = rows[existingIndex].createdAt || record.createdAt;
      rows[existingIndex] = { ...rows[existingIndex], ...record };
    } else rows.push(record);
    store[gate.projectCode] = rows;
    rawWrite(DECISIONS, store);
    gate.linkedDecisionId = decisionId;
    return decisionId;
  }

  function validateProjectStageAdvance(gate) {
    const projects = clone(getProjectsRaw());
    const index = projects.findIndex((project) => lower(project.projectCode) === lower(gate.projectCode));
    if (index < 0) throw new Error("The linked project could not be found.");
    const project = projects[index];
    if (isArchived(project)) throw new Error("An archived project cannot progress through a stage gate.");
    const beforeStage = project.currentStage || "";
    if (clean(beforeStage) !== clean(gate.currentStage))
      throw new Error(
        `The project is now at ${beforeStage || "an unset stage"}; ${gate.gateId} cannot advance it from its earlier ${gate.currentStage} snapshot.`
      );
    return { projects, index, project, beforeStage };
  }

  function updateProjectStage(gate, validatedContext) {
    const context = validatedContext || validateProjectStageAdvance(gate);
    const { projects, index, project, beforeStage } = context;
    const history = Array.isArray(project.stageHistory) ? [...project.stageHistory] : [];
    history.push({
      gateId: gate.gateId,
      revision: gate.revision,
      gateName: gate.gateName,
      fromStage: beforeStage,
      toStage: gate.proposedNextStage,
      approvedAt: nowIso(),
      decisionDate: gate.decisionDate
    });
    project.currentStage = gate.proposedNextStage;
    project.nextStage = nextStage(gate.proposedNextStage, project);
    project.currentStageGate = gate.gateName;
    project.stageHistory = history;
    project.updatedAt = nowIso();
    projects[index] = project;
    rawWrite(PROJECTS, projects);
  }

  function transitionLocal(gateId, toStatus, details) {
    const existing = findRaw(gateId);
    if (!existing || !canView(existing.projectCode))
      throw new Error("The stage gate could not be found or is outside your project access.");
    const project = findProject(existing.projectCode);
    if (!project) throw new Error("The linked project could not be found.");
    if (isArchived(project))
      throw new Error("Archived projects are read-only and their stage gates cannot be changed.");
    if (!STATUSES.includes(toStatus)) throw new Error("Select a valid stage-gate status.");
    if (!allowedTransitions(existing).includes(toStatus)) {
      if (
        isSelfApproval(existing) &&
        ["Approved", "Conditionally Approved", "Deferred", "Rejected"].includes(toStatus)
      ) {
        throw new Error("You cannot approve or decide a stage gate that you submitted or own.");
      }
      if (
        ["Approved", "Conditionally Approved", "Deferred", "Rejected"].includes(toStatus) &&
        !isAssignedApprover(existing)
      ) {
        throw new Error("Only an assigned required approver can make this decision.");
      }
      throw new Error(`The transition from ${existing.workflowStatus} to ${toStatus} is not permitted.`);
    }
    const values = details || {};
    const gate = normaliseGate(existing);
    const actor = normalisePerson(currentUser());
    const fromStatus = gate.workflowStatus;

    if (toStatus === "Draft") {
      gate.workflowStatus = gate.status = "Draft";
      gate.decisionDate = "";
      gate.approvalComments = "";
      gate.conditions = "";
      gate.rejectionDeferralReason = "";
      gate.decisionSummary = "";
      gate.completionDate = "";
      gate.requiredApprovers = gate.requiredApprovers.map((approver) => ({
        ...approver,
        decision: "",
        decisionComments: "",
        decidedAt: ""
      }));
    } else if (toStatus === "Submitted") {
      const checked = validate(gate, "submit");
      if (!checked.valid) throw new Error(checked.errors.join(" "));
      const submittedAt = nowIso();
      gate.workflowStatus = gate.status = "Submitted";
      gate.submissionDate = clean(values.submissionDate) || today();
      gate.submittedAt = submittedAt;
      gate.submittedBy = actor.name;
      gate.submittedByResourceId = actor.resourceId;
      gate.submissionComments = clean(
        values.comments || values.submissionComments || gate.submissionComments
      );
      gate.decisionDate = "";
      gate.approvalComments = "";
      gate.conditions = "";
      gate.rejectionDeferralReason = "";
      gate.decisionSummary = "";
      gate.completionDate = "";
      gate.requiredApprovers = gate.requiredApprovers.map((approver) => ({
        ...approver,
        decision: "",
        decisionComments: "",
        decidedAt: ""
      }));
      recordSubmission(gate, actor, "Stage gate", gate.submissionComments, submittedAt);
    } else if (toStatus === "Cancelled") {
      gate.workflowStatus = gate.status = "Cancelled";
      gate.rejectionDeferralReason = clean(
        values.reason || values.comments || "Cancelled by the submission owner."
      );
      gate.decisionDate = clean(values.decisionDate) || today();
      gate.decisionSummary = defaultDecisionSummary(gate, "Cancelled");
      gate.completionDate = today();
    } else {
      const comments = clean(values.comments || values.approvalComments);
      const reason = clean(values.reason || values.rejectionDeferralReason);
      const conditions = clean(values.conditions);
      if (toStatus === "Conditionally Approved" && !conditions)
        throw new Error("Conditions are required for conditional approval.");
      if (["Deferred", "Rejected"].includes(toStatus) && !reason)
        throw new Error(`A reason is required when a gate is ${toStatus.toLowerCase()}.`);
      /*
        Readiness is recorded, not enforced. This used to throw, which meant an approver who had
        decided to proceed had no way to say so - and no trace of the decision survived. The
        outstanding items now travel onto the decision, so the history reads "Approved, with 4
        readiness items outstanding" and names them.
      */
      const outstandingAtDecision = readinessFor(gate).outstanding;
      const unlinkedActions = gate.actionsArising.filter((item) => !item.actionId);
      if (unlinkedActions.some((item) => !item.ownerResourceId))
        throw new Error(
          "Every action arising needs an owner selected from Resources before the decision is recorded."
        );
      if (unlinkedActions.some((item) => !item.dueDate))
        throw new Error("Every action arising needs a due date before the decision is recorded.");
      const approverIndex = gate.requiredApprovers.findIndex((approver) => samePerson(approver, actor));
      if (approverIndex < 0) throw new Error("Only an assigned required approver can make this decision.");
      gate.requiredApprovers[approverIndex] = {
        ...gate.requiredApprovers[approverIndex],
        decision: toStatus,
        decisionComments: comments || reason || conditions,
        decidedAt: nowIso()
      };
      gate.decisionDate = clean(values.decisionDate) || today();
      gate.meetingDate = clean(values.meetingDate) || gate.meetingDate;
      gate.approvalComments =
        comments || (["Deferred", "Rejected"].includes(toStatus) ? "" : gate.approvalComments);
      gate.conditions = ["Deferred", "Rejected"].includes(toStatus) ? "" : conditions || gate.conditions;
      gate.rejectionDeferralReason = reason;
      if (toStatus === "Approved") {
        const everyApproverApproved = gate.requiredApprovers.every(
          (approver) => approver.decision === "Approved"
        );
        const conditionalDecisionRemains = gate.requiredApprovers.some(
          (approver) => approver.decision === "Conditionally Approved"
        );
        gate.workflowStatus = gate.status = everyApproverApproved
          ? "Approved"
          : conditionalDecisionRemains
            ? "Conditionally Approved"
            : "Submitted";
        if (everyApproverApproved) {
          gate.completionDate = today();
          gate.conditions = "";
        }
      } else {
        gate.workflowStatus = gate.status = toStatus;
        if (["Rejected"].includes(toStatus)) gate.completionDate = today();
      }
      gate.decisionSummary =
        gate.workflowStatus === "Submitted"
          ? `Approval recorded: ${gate.gateName} — awaiting the remaining required approver decisions`
          : defaultDecisionSummary(gate, gate.workflowStatus);
      gate.decisionHistory.push({
        revision: gate.revision,
        decision: toStatus,
        actorName: actor.name,
        actorResourceId: actor.resourceId,
        comments,
        conditions,
        reason,
        /*
          What the readiness rules said was outstanding at the moment of the decision.

          The point of not blocking is that the decision belongs to the person. The point of
          recording this is that the decision should say what they were looking at when they made
          it - six months later, "approved with the security test and training status outstanding"
          is the sentence somebody needs, and it cannot be reconstructed afterwards because the
          items get completed in the meantime.
        */
        readinessOutstanding: outstandingAtDecision,
        decidedAt: nowIso()
      });
    }

    gate.requiredApproverResourceIds = gate.requiredApprovers.map((item) => item.resourceId).filter(Boolean);
    gate.updatedAt = nowIso();
    gate.updatedBy = actor.name;
    gate.updatedByResourceId = actor.resourceId;

    const shouldAdvanceProject = gate.workflowStatus === "Approved" && fromStatus !== "Approved";
    const stageAdvanceContext = shouldAdvanceProject ? validateProjectStageAdvance(gate) : null;
    if (["Approved", "Conditionally Approved", "Deferred", "Rejected"].includes(gate.workflowStatus))
      createDecision(gate);
    if (["Approved", "Conditionally Approved", "Deferred", "Rejected"].includes(gate.workflowStatus))
      createActions(gate);
    if (shouldAdvanceProject) updateProjectStage(gate, stageAdvanceContext);
    writeGate(gate, existing.projectCode);
    dispatchChange("transitioned", gate);
    return clone(gate);
  }

  function requestRouteExceptionLocal(gateId, details) {
    const existing = findRaw(gateId);
    if (!existing || !canEdit(existing.projectCode))
      throw new Error("Your permissions do not allow you to request this governance-route exception.");
    const project = findProject(existing.projectCode);
    if (!project) throw new Error("The linked project could not be found.");
    if (isArchived(project))
      throw new Error("Archived projects are read-only and their stage gates cannot be changed.");
    if (existing.workflowStatus !== "Draft")
      throw new Error("A route exception can only be requested while the gate is Draft.");
    if (existing.routeApprovalStatus === "Pending" && existing.routeRequestedAt)
      throw new Error("This route exception is already awaiting a decision.");
    const gate = normaliseGate(existing);
    gate.routeRequirement = "Not Applicable";
    gate.revision = gate.version = revisionNumber(existing.revision || existing.version);
    gate.submissionHistory = clone(existing.submissionHistory);
    gate.decisionHistory = clone(existing.decisionHistory);
    gate.routeApprovalHistory = clone(existing.routeApprovalHistory);
    gate.linkedActionIds = clone(existing.linkedActionIds);
    gate.linkedDecisionId = existing.linkedDecisionId;
    const checked = validate(gate, "save");
    if (!checked.valid) throw new Error(checked.errors.join(" "));
    const actor = normalisePerson(currentUser());
    const routeApprover = personFromResourceId(gate.routeApproverResourceId, {
      name: gate.routeApprover,
      email: gate.routeApproverEmail
    });
    if (samePerson(actor, routeApprover))
      throw new Error("The person requesting a governance-route exception cannot approve it.");
    const routeResources = window.PPMAuth?.getResources?.() || rawRead("people", []);
    const routeApproverResource =
      window.PPMAuth?.getResource?.(routeApprover.resourceId) ||
      (Array.isArray(routeResources)
        ? routeResources.find((item) => item.resourceId === routeApprover.resourceId)
        : null);
    if (
      !routeApproverResource ||
      !resourceHasPermission(routeApproverResource, "stageGates.override") ||
      routeApproverResource.accountStatus !== "Active"
    )
      throw new Error(
        "The assigned route approver does not have an active account with governance-route override permission."
      );
    const requestedAt = nowIso();
    gate.routeApprovalStatus = "Pending";
    gate.routeRequestedBy = actor.name;
    gate.routeRequestedByResourceId = actor.resourceId;
    gate.routeRequestedAt = requestedAt;
    gate.routeApprovalDate = "";
    gate.routeApprovalComments = "";
    gate.submissionDate = today();
    gate.submittedAt = requestedAt;
    gate.submittedBy = actor.name;
    gate.submittedByResourceId = actor.resourceId;
    recordSubmission(gate, actor, "Route exception", gate.routeReason, requestedAt);
    gate.updatedAt = requestedAt;
    gate.updatedBy = actor.name;
    gate.updatedByResourceId = actor.resourceId;
    writeGate(gate, existing.projectCode);
    dispatchChange("route-requested", gate);
    return clone(gate);
  }

  function decideRouteExceptionLocal(gateId, decision, details) {
    const existing = findRaw(gateId);
    if (!existing || !canView(existing.projectCode))
      throw new Error("The stage gate could not be found or is outside your project access.");
    const project = findProject(existing.projectCode);
    if (!project) throw new Error("The linked project could not be found.");
    if (isArchived(project))
      throw new Error("Archived projects are read-only and their stage gates cannot be changed.");
    if (!["Approved", "Rejected"].includes(decision))
      throw new Error("Select Approved or Rejected for the route exception.");
    if (
      existing.routeRequirement !== "Not Applicable" ||
      existing.routeApprovalStatus !== "Pending" ||
      !existing.routeRequestedAt
    )
      throw new Error("This stage gate does not have a submitted route exception awaiting decision.");
    const actor = normalisePerson(currentUser());
    const assigned = personFromResourceId(existing.routeApproverResourceId, {
      name: existing.routeApprover,
      email: existing.routeApproverEmail
    });
    if (!samePerson(actor, assigned))
      throw new Error("Only the assigned route approver can decide this exception.");
    if (!canOverride(existing.projectCode))
      throw new Error("Your permissions do not allow you to approve governance-route exceptions.");
    if (
      samePerson(actor, {
        resourceId: existing.routeRequestedByResourceId,
        name: existing.routeRequestedBy
      }) ||
      isSelfApproval(existing, actor)
    ) {
      throw new Error("You cannot approve a governance-route exception that you requested or own.");
    }
    const comments = clean(details?.comments || details?.reason);
    if (decision === "Rejected" && !comments) throw new Error("A rejection reason is required.");
    const gate = normaliseGate(existing);
    gate.routeApprovalStatus = decision;
    gate.routeApprovalDate = clean(details?.decisionDate) || today();
    gate.routeApprovalComments = comments;
    gate.routeApprovalHistory.push({
      decision,
      actorName: actor.name,
      actorResourceId: actor.resourceId,
      comments,
      decidedAt: nowIso()
    });
    if (decision === "Approved") {
      gate.workflowStatus = gate.status = "Cancelled";
      gate.completionDate = today();
      gate.rejectionDeferralReason = `Not applicable: ${gate.routeReason}`;
    } else {
      gate.workflowStatus = gate.status = "Draft";
      gate.completionDate = "";
    }
    gate.decisionDate = gate.routeApprovalDate;
    gate.decisionSummary =
      decision === "Rejected"
        ? `Rejected: governance route remains applicable — ${comments}`
        : `Approved: governance route not applicable — ${gate.routeReason}`;
    gate.updatedAt = nowIso();
    gate.updatedBy = actor.name;
    gate.updatedByResourceId = actor.resourceId;
    const unlinkedActions = gate.actionsArising.filter((item) => !item.actionId);
    if (unlinkedActions.some((item) => !item.ownerResourceId))
      throw new Error(
        "Every action arising needs an owner selected from Resources before the route decision is recorded."
      );
    if (unlinkedActions.some((item) => !item.dueDate))
      throw new Error("Every action arising needs a due date before the route decision is recorded.");
    createDecision(gate);
    createActions(gate);
    writeGate(gate, existing.projectCode);
    dispatchChange("route-decided", gate);
    return clone(gate);
  }

  /*
    Stage 17. Was stage11AReady(), retired in Stage 14, which made this silently false and sent
    every stage-gate transition down a path the database refuses. See
    STAGE-17-WORKFLOWS-UNREACHABLE.md.
  */
  function databaseWorkflowEnabled() {
    return Boolean(window.PPMChildDatabase?.workflowReady?.("stageGate"));
  }

  function groupedRows(store, projectCode) {
    const rows = store && typeof store === "object" && !Array.isArray(store) ? store[projectCode] : null;
    return Array.isArray(rows) ? rows.filter(Boolean) : [];
  }

  function findById(rows, idField, id) {
    return (Array.isArray(rows) ? rows : []).find((row) => clean(row?.[idField]) === clean(id)) || null;
  }

  function changedRows(beforeStore, afterStore, projectCode, idField) {
    const before = new Map(groupedRows(beforeStore, projectCode).map((row) => [clean(row?.[idField]), row]));
    return groupedRows(afterStore, projectCode).filter((row) => {
      const key = clean(row?.[idField]);
      const previous = before.get(key);
      return key && (!previous || JSON.stringify(previous) !== JSON.stringify(row));
    });
  }

  function runTransactionalWorkflow(operation, requestedStatus, callback) {
    /*
      Stage 17: there is no longer a fallback.

      This used to run the callback directly when the workflow was unavailable, writing the
      gate, its decision and the project stage as three separate local writes. That path had
      not worked since Stage 14 - the database refuses every one of those writes through
      private.guard_stage_gate_workflow_write, which permits a workflow column to change only
      while the transactional function is running. The refusal went to the console and the
      screen showed the transition as though it had happened.

      Refusing here instead is the whole point: a governance transition either goes through the
      transaction that enforces self-approval, segregation of duties and approver eligibility,
      or it does not happen. Silently doing something weaker is what caused this.
    */
    if (!databaseWorkflowEnabled()) {
      throw new Error(
        "The governance workflow is unavailable, so this stage-gate change cannot be recorded. " +
          "Reload the page; if it persists, the database connection or your sign-in has been lost."
      );
    }
    if (workflowCapture) return callback();

    return (async () => {
    // Capture every local mutation first. Nothing is saved, no audit entry is emitted and no
    // change event is dispatched until PostgreSQL has committed the whole workflow transaction.
    const before = {
      gates: rawRead(GATES, {}),
      actions: rawRead(ACTIONS, {}),
      decisions: rawRead(DECISIONS, {}),
      projects: rawRead(PROJECTS, [])
    };
    const capture = { stores: new Map(), events: [] };
    workflowCapture = capture;
    let calculatedGate;
    try {
      calculatedGate = callback();
    } catch (error) {
      workflowCapture = null;
      throw error;
    }
    workflowCapture = null;

    const projectCode = clean(calculatedGate?.projectCode);
    const gateId = clean(calculatedGate?.gateId);
    const beforeGate = findById(groupedRows(before.gates, projectCode), "gateId", gateId);
    if (!beforeGate) throw new Error(`${gateId || "The stage gate"} is not present in the loaded database snapshot.`);

    const afterActions = capture.stores.get(ACTIONS) || before.actions;
    const afterDecisions = capture.stores.get(DECISIONS) || before.decisions;
    const afterProjects = capture.stores.get(PROJECTS) || before.projects;
    const actions = changedRows(before.actions, afterActions, projectCode, "actionId");
    const decision = calculatedGate.linkedDecisionId
      ? findById(groupedRows(afterDecisions, projectCode), "decisionId", calculatedGate.linkedDecisionId)
      : null;
    const projectChanged = capture.stores.has(PROJECTS);
    const project = projectChanged
      ? (Array.isArray(afterProjects)
          ? afterProjects.find((row) => lower(row?.projectCode) === lower(projectCode))
          : null)
      : null;
    const beforeProject = projectChanged
      ? (Array.isArray(before.projects)
          ? before.projects.find((row) => lower(row?.projectCode) === lower(projectCode))
          : null)
      : null;

    await window.PPMChildDatabase.commitStageGateWorkflow({
      operation,
      requestedStatus,
      gate: calculatedGate,
      expectedGateVersion: beforeGate.databaseVersion,
      actions,
      decision,
      project,
      expectedProjectVersion: beforeProject?.databaseVersion
    });

    // PostgreSQL is authoritative now. Only after it commits do we replay the
    // legacy UX audit/event signals. Server-side audit remains the security log.
    capture.events.forEach((event) => dispatchChange(event.type, event.gate));
    return find(gateId, projectCode) || clone(calculatedGate);

    })();
  }

  function transition(gateId, toStatus, details) {
    return runTransactionalWorkflow("transition", toStatus, () => transitionLocal(gateId, toStatus, details));
  }

  function requestRouteException(gateId, details) {
    return runTransactionalWorkflow("route_request", "Pending", () => requestRouteExceptionLocal(gateId, details));
  }

  function decideRouteException(gateId, decision, details) {
    return runTransactionalWorkflow("route_decision", decision, () =>
      decideRouteExceptionLocal(gateId, decision, details)
    );
  }

  function getPendingForUser(explicitUser) {
    const actor = normalisePerson(currentUser(explicitUser));
    return getAll().filter((gate) => {
      const project = findProject(gate.projectCode);
      if (!project || isArchived(project)) return false;
      const gateApproval =
        ["Submitted", "Conditionally Approved"].includes(gate.workflowStatus) &&
        gate.requiredApprovers.some(
          (approver) => samePerson(approver, actor) && approver.decision !== "Approved"
        ) &&
        !isSelfApproval(gate, actor);
      const routeApproval =
        gate.routeRequirement === "Not Applicable" &&
        gate.routeApprovalStatus === "Pending" &&
        Boolean(gate.routeRequestedAt) &&
        samePerson(
          {
            resourceId: gate.routeApproverResourceId,
            name: gate.routeApprover,
            email: gate.routeApproverEmail
          },
          actor
        ) &&
        !samePerson({ resourceId: gate.routeRequestedByResourceId, name: gate.routeRequestedBy }, actor) &&
        canOverride(gate.projectCode);
      return gateApproval || routeApproval;
    });
  }

  function dispatchChange(type, gate) {
    if (workflowCapture) {
      workflowCapture.events.push({ type, gate: clone(gate) });
      return;
    }
    window.dispatchEvent(new CustomEvent("ppm-stage-gates-changed", { detail: { type, gate: clone(gate) } }));
    window.dispatchEvent(
      new CustomEvent("ppm-data-changed", {
        detail: { entityType: "Stage gate", type, projectCode: gate.projectCode, entityId: gate.gateId }
      })
    );
  }

  window.PPMStageGates = {
    STATUSES: [...STATUSES],
    ROUTE_REQUIREMENTS: [...ROUTE_REQUIREMENTS],
    ROUTE_APPROVAL_STATUSES: [...ROUTE_APPROVAL_STATUSES],
    STAGE_ORDER: stageOrder(),
    getAll,
    getForProject,
    find,
    newGate,
    save,
    delete: deleteGate,
    getPendingForUser,
    allowedTransitions,
    transition,
    requestRouteException,
    decideRouteException,
    validate,
    normaliseGate,
    canView,
    canEdit,
    canApprove,
    namedApproverOfAny,
    readinessFor,
    canOverride,
    isAssignedApprover,
    isSelfApproval,
    getStageOrder: projectStageOrder,
    nextStage
  };
})();
