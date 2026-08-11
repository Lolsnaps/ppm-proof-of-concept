(function () {
  "use strict";

  /*
    Stage 16: collections, not storage keys.

    These were the eight localStorage keys this module read and wrote. They are now the names of
    the collections themselves, which is what both PPMStore and the two adapters call them, so
    there is one vocabulary rather than a translation in the middle. Section 2g of
    VERIFY-STATIC.mjs checks every name here against the adapters' own registries.
  */
  const KEYS = {
    baselines: "planBaselines",
    baselineRequests: "baselineRequests",
    ragHistory: "ragHistory",
    ragConfig: "ragConfig",
    demand: "resourceDemand",
    absence: "resourceAbsence",
    scenarios: "resourceScenarios",
    resourceConfig: "resourceConfig"
  };

  const DEFAULT_RAG_CONFIG = {
    scheduleAmberToleranceDays: 5,
    scheduleRedToleranceDays: 20,
    resourceAmberUtilisation: 100,
    resourceRedUtilisation: 115,
    financialAmberVariance: 5,
    financialRedVariance: 10,
    underUtilisationThreshold: 70
  };

  const DEFAULT_RESOURCE_CONFIG = {
    overAllocationWarningPercent: 100,
    overAllocationCriticalPercent: 115,
    underUtilisationPercent: 70,
    includeProvisionalByDefault: true,
    warningThreshold: 100,
    overAllocationThreshold: 115,
    underUtilisationThreshold: 70,
    includeProvisionalInCapacity: true,
    standardDayHours: 7.5,
    maximumHierarchyDepth: 8
  };

  const RAG_DIMENSIONS = [
    ["overall", "Overall health"],
    ["schedule", "Schedule"],
    ["scope", "Scope"],
    ["financial", "Financials"],
    ["resource", "Resources"],
    ["risk", "Risks"],
    ["benefit", "Benefits"],
    ["quality", "Quality"],
    ["operationalReadiness", "Operational readiness"]
  ];

  /*
    Stage 16: reads come from PPMStore, which holds what PostgreSQL confirmed, rather than from
    the localStorage mirror the adapters used to hydrate. The fallback survives for the one case
    it was ever really for - a page where the data layer failed to load, where an empty list is
    better than a thrown error taking the rest of the script with it.
  */
  function read(collection, fallback) {
    if (!window.PPMStore) return fallback;
    const namespace = window.PPMStore[collection];
    if (!namespace || typeof namespace.read !== "function") {
      console.error(`PPMPlanning: "${collection}" is not a registered PPMStore collection.`);
      return fallback;
    }
    return namespace.read();
  }

  /*
    Stage 16: the one write seam.

    Was localStorage.setItem, which reached PostgreSQL only because both adapters had replaced
    Storage.prototype.setItem, and which returned before the database had been asked anything.

    Named collections rather than storage keys, so nothing has to be translated on the way in.
  */
  async function write(collection, value) {
    if (!window.PPMStore) {
      return {
        ok: false,
        reason: "failed",
        message: "The data layer is not loaded on this page, so nothing was saved.",
        queued: false,
        value
      };
    }
    const namespace = window.PPMStore[collection];
    if (!namespace || typeof namespace.replaceAll !== "function") {
      console.error(`PPMPlanning: "${collection}" is not a registered PPMStore collection.`);
      return {
        ok: false,
        reason: "invalid",
        message: `The planning collection "${collection}" is not registered, so nothing was saved.`,
        queued: false,
        value
      };
    }
    const result = await namespace.replaceAll(value);
    return { ...result, value };
  }

  function uid(prefix) {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const todayIso = PPMCore.todayIso;

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isoDate(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function addDays(value, days) {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    if (!date) return "";
    date.setDate(date.getDate() + Number(days || 0));
    return isoDate(date);
  }

  function workingDaysBetween(startValue, endValue) {
    const start = parseDate(startValue);
    const end = parseDate(endValue);
    if (!start || !end || end < start) return 0;
    let days = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) days += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return days;
  }

  function calendarDaysLate(value, baseline) {
    const date = parseDate(value);
    const base = parseDate(baseline);
    if (!date || !base || date <= base) return 0;
    return Math.ceil((date - base) / 86400000);
  }

  function normaliseDependency(dependency) {
    if (typeof dependency === "string") {
      return {
        dependencyId: uid("DEP"),
        predecessorTaskId: dependency,
        relationship: "FS",
        scope: "Internal",
        externalProjectCode: "",
        externalReference: "",
        notes: ""
      };
    }
    return {
      dependencyId: (dependency && dependency.dependencyId) || uid("DEP"),
      predecessorTaskId: (dependency && dependency.predecessorTaskId) || "",
      relationship: (dependency && dependency.relationship) || (dependency && dependency.type) || "FS",
      scope: (dependency && dependency.scope) || "Internal",
      externalProjectCode: (dependency && dependency.externalProjectCode) || "",
      externalReferenceType:
        (dependency && (dependency.externalReferenceType || dependency.referenceType)) || "Task",
      externalReference: (dependency && dependency.externalReference) || "",
      notes: (dependency && dependency.notes) || ""
    };
  }

  function normaliseTask(task, index) {
    const row = task && typeof task === "object" ? task : {};
    const taskId = row.taskId || `TASK-${String(index + 1).padStart(4, "0")}`;
    return {
      ...row,
      taskId,
      taskType:
        row.taskType || (row.milestoneIndicator ? "Milestone" : row.parentTaskId ? "Subtask" : "Task"),
      parentTaskId: row.parentTaskId || "",
      taskName: row.taskName || "",
      deliverable: row.deliverable || "",
      taskOwner: row.taskOwner || "",
      taskOwnerResourceId: row.taskOwnerResourceId || "",
      supportingContributorIds: Array.isArray(row.supportingContributorIds)
        ? row.supportingContributorIds
        : [],
      priority: row.priority || "Medium",
      actualStartDate: row.actualStartDate || "",
      actualEndDate: row.actualEndDate || "",
      estimatedEffortHours: row.estimatedEffortHours === "" ? "" : Number(row.estimatedEffortHours || 0),
      remainingEffortHours: row.remainingEffortHours === "" ? "" : Number(row.remainingEffortHours || 0),
      dependencies: Array.isArray(row.dependencies)
        ? row.dependencies.map(normaliseDependency)
        : row.predecessorTaskId
          ? [normaliseDependency(row.predecessorTaskId)]
          : [],
      criticalPath: Boolean(row.criticalPath || row.isCritical),
      slippageImpact: row.slippageImpact || "",
      recoveryNotPossible: Boolean(row.recoveryNotPossible),
      mandatory: row.mandatory !== false
    };
  }

  function normalisePlan(tasks) {
    return Array.isArray(tasks) ? tasks.map(normaliseTask) : [];
  }

  function childrenOf(tasks, parentTaskId) {
    return tasks.filter((task) => task.parentTaskId === parentTaskId);
  }

  function hierarchyDepth(tasks, taskId) {
    const map = new Map(tasks.map((task) => [task.taskId, task]));
    const visited = new Set();
    let current = map.get(taskId);
    let depth = 0;
    while (current && current.parentTaskId) {
      if (visited.has(current.taskId)) return Number.POSITIVE_INFINITY;
      visited.add(current.taskId);
      current = map.get(current.parentTaskId);
      depth += 1;
    }
    return depth;
  }

  function hierarchyErrors(tasks, maximumDepth) {
    const maxDepth = Number(maximumDepth || getResourceConfig().maximumHierarchyDepth || 8);
    const ids = new Set(tasks.map((task) => task.taskId));
    const errors = [];
    tasks.forEach((task) => {
      if (task.parentTaskId && !ids.has(task.parentTaskId))
        errors.push(`${task.taskName || task.taskId} has a missing parent.`);
      if (task.parentTaskId === task.taskId)
        errors.push(`${task.taskName || task.taskId} cannot be its own parent.`);
      const depth = hierarchyDepth(tasks, task.taskId);
      if (!Number.isFinite(depth))
        errors.push(`${task.taskName || task.taskId} has a circular parent hierarchy.`);
      else if (depth > maxDepth)
        errors.push(`${task.taskName || task.taskId} exceeds the maximum hierarchy depth of ${maxDepth}.`);
    });
    return [...new Set(errors)];
  }

  function calculateParentProgress(tasks) {
    const rows = normalisePlan(tasks);
    const byDepth = rows
      .slice()
      .sort((a, b) => hierarchyDepth(rows, b.taskId) - hierarchyDepth(rows, a.taskId));
    byDepth.forEach((parent) => {
      const children = childrenOf(rows, parent.taskId).filter(
        (child) => child.status !== "Cancelled" && child.status !== "Not Applicable"
      );
      if (!children.length) return;
      const weights = children.map((child) => Number(child.estimatedEffortHours || child.durationDays || 1));
      const totalWeight = weights.reduce((sum, value) => sum + Math.max(0.1, value), 0);
      parent.percentageComplete = Math.round(
        children.reduce(
          (sum, child, index) => sum + Number(child.percentageComplete || 0) * Math.max(0.1, weights[index]),
          0
        ) / totalWeight
      );
      if (children.every((child) => ["Complete", "Cancelled", "Not Applicable"].includes(child.status)))
        parent.status = "Complete";
      else if (children.some((child) => child.status === "Blocked")) parent.status = "Blocked";
      else if (
        children.some((child) => Number(child.percentageComplete || 0) > 0 || child.status === "In Progress")
      )
        parent.status = "In Progress";
      else parent.status = "Not Started";
      const original = tasks.find((task) => task.taskId === parent.taskId);
      if (original)
        Object.assign(original, { percentageComplete: parent.percentageComplete, status: parent.status });
    });
    return tasks;
  }

  function incompleteChildErrors(tasks) {
    const errors = [];
    tasks.forEach((parent) => {
      if (parent.status !== "Complete") return;
      const incomplete = childrenOf(tasks, parent.taskId).filter(
        (child) =>
          child.mandatory !== false && !["Complete", "Cancelled", "Not Applicable"].includes(child.status)
      );
      if (incomplete.length)
        errors.push(
          `${parent.taskName || parent.taskId} cannot be complete while ${incomplete.length} mandatory child item${incomplete.length === 1 ? " is" : "s are"} incomplete.`
        );
    });
    return errors;
  }

  function dependencyCycle(tasks) {
    const ids = new Set(tasks.map((task) => task.taskId));
    const graph = new Map(tasks.map((task) => [task.taskId, []]));
    tasks.forEach((task) => {
      (task.dependencies || [])
        .filter((dependency) => dependency.scope !== "External" && ids.has(dependency.predecessorTaskId))
        .forEach((dependency) => {
          graph.get(dependency.predecessorTaskId).push(task.taskId);
        });
    });
    const state = new Map();
    let cycle = [];
    function visit(id, path) {
      if (state.get(id) === 1) {
        cycle = [...path, id];
        return true;
      }
      if (state.get(id) === 2) return false;
      state.set(id, 1);
      for (const next of graph.get(id) || []) if (visit(next, [...path, id])) return true;
      state.set(id, 2);
      return false;
    }
    for (const id of graph.keys()) if (visit(id, [])) break;
    return cycle;
  }

  function taskDates(task) {
    return {
      start: task.forecastStartDate || task.baselineStartDate || "",
      finish: task.forecastEndDate || task.baselineEndDate || ""
    };
  }

  function dependencyConflicts(tasks) {
    const map = new Map(tasks.map((task) => [task.taskId, task]));
    const conflicts = [];
    tasks.forEach((task) => {
      const successor = taskDates(task);
      (task.dependencies || []).forEach((dependency) => {
        if (dependency.scope === "External") return;
        const predecessor = map.get(dependency.predecessorTaskId);
        if (!predecessor) return;
        const pred = taskDates(predecessor);
        const relationship = dependency.relationship || "FS";
        let conflict = false;
        if (relationship === "FS")
          conflict = Boolean(pred.finish && successor.start && successor.start < pred.finish);
        if (relationship === "SS")
          conflict = Boolean(pred.start && successor.start && successor.start < pred.start);
        if (relationship === "FF")
          conflict = Boolean(pred.finish && successor.finish && successor.finish < pred.finish);
        if (relationship === "SF")
          conflict = Boolean(pred.start && successor.finish && successor.finish < pred.start);
        if (conflict)
          conflicts.push({
            taskId: task.taskId,
            predecessorTaskId: predecessor.taskId,
            relationship,
            message: `${task.taskName || task.taskId} conflicts with ${predecessor.taskName || predecessor.taskId} (${relationship}).`
          });
      });
    });
    return conflicts;
  }

  function durationForCriticalPath(task) {
    if (task.taskType === "Milestone") return 0;
    const dated = workingDaysBetween(
      task.forecastStartDate || task.baselineStartDate,
      task.forecastEndDate || task.baselineEndDate
    );
    return Math.max(1, Number(task.durationDays || dated || 1));
  }

  function calculateCriticalPath(tasks) {
    const rows = normalisePlan(tasks);
    const childIds = new Set(rows.filter((task) => task.parentTaskId).map((task) => task.parentTaskId));
    const nodes = rows.filter(
      (task) => !childIds.has(task.taskId) && !["Cancelled", "Not Applicable"].includes(task.status)
    );
    const ids = new Set(nodes.map((task) => task.taskId));
    const successors = new Map(nodes.map((task) => [task.taskId, []]));
    const predecessorIds = new Map(nodes.map((task) => [task.taskId, []]));
    nodes.forEach((task) =>
      (task.dependencies || []).forEach((dependency) => {
        if (dependency.scope === "External" || !ids.has(dependency.predecessorTaskId)) return;
        successors.get(dependency.predecessorTaskId).push(task.taskId);
        predecessorIds.get(task.taskId).push(dependency.predecessorTaskId);
      })
    );
    const indegree = new Map(nodes.map((task) => [task.taskId, predecessorIds.get(task.taskId).length]));
    const queue = nodes.filter((task) => indegree.get(task.taskId) === 0).map((task) => task.taskId);
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      (successors.get(id) || []).forEach((next) => {
        indegree.set(next, indegree.get(next) - 1);
        if (indegree.get(next) === 0) queue.push(next);
      });
    }
    if (order.length !== nodes.length)
      return { criticalTaskIds: [], projectDuration: 0, cycle: dependencyCycle(rows) };
    const map = new Map(nodes.map((task) => [task.taskId, task]));
    const earlyStart = new Map();
    const earlyFinish = new Map();
    order.forEach((id) => {
      const start = Math.max(0, ...predecessorIds.get(id).map((pred) => earlyFinish.get(pred) || 0));
      earlyStart.set(id, start);
      earlyFinish.set(id, start + durationForCriticalPath(map.get(id)));
    });
    const projectDuration = Math.max(0, ...earlyFinish.values());
    const lateFinish = new Map();
    const lateStart = new Map();
    order
      .slice()
      .reverse()
      .forEach((id) => {
        const following = successors.get(id) || [];
        const finish = following.length
          ? Math.min(...following.map((next) => lateStart.get(next)))
          : projectDuration;
        lateFinish.set(id, finish);
        lateStart.set(id, finish - durationForCriticalPath(map.get(id)));
      });
    const criticalTaskIds = order.filter(
      (id) => Math.abs((lateStart.get(id) || 0) - (earlyStart.get(id) || 0)) < 0.001
    );
    rows.forEach((row) => {
      row.criticalPath = criticalTaskIds.includes(row.taskId);
    });
    rows
      .filter((row) => childIds.has(row.taskId))
      .forEach((parent) => {
        const stack = [parent.taskId];
        let isCritical = false;
        while (stack.length) {
          const parentId = stack.pop();
          rows
            .filter((row) => row.parentTaskId === parentId)
            .forEach((child) => {
              if (criticalTaskIds.includes(child.taskId)) isCritical = true;
              stack.push(child.taskId);
            });
        }
        parent.criticalPath = isCritical;
      });
    rows.forEach((row) => {
      const original = tasks.find((task) => task.taskId === row.taskId);
      if (original) original.criticalPath = row.criticalPath;
    });
    return { criticalTaskIds, projectDuration, cycle: [] };
  }

  function getBaselines() {
    const value = read(KEYS.baselines, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function getProjectBaselines(projectCode) {
    const store = getBaselines();
    return Array.isArray(store[projectCode]) ? store[projectCode] : [];
  }

  function latestApprovedBaseline(projectCode) {
    return (
      getProjectBaselines(projectCode)
        .filter((baseline) => baseline.status === "Approved")
        .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0] || null
    );
  }

  function baselineSnapshot(tasks) {
    return normalisePlan(tasks).map((task) => ({
      taskId: task.taskId,
      taskName: task.taskName,
      taskType: task.taskType,
      baselineStartDate: task.baselineStartDate || "",
      baselineEndDate: task.baselineEndDate || "",
      estimatedEffortHours: Number(task.estimatedEffortHours || 0)
    }));
  }

  function databaseBaselineWorkflowEnabled() {
    /* Stage 17: was stage11BReady(), retired in Stage 14 and silently false ever since. */
    return Boolean(window.PPMChildDatabase?.workflowReady?.("baseline"));
  }

  async function createApprovedBaseline(projectCode, tasks, approval) {
    if (databaseBaselineWorkflowEnabled())
      throw new Error("Approved baselines must be created through the Stage 11B database workflow.");
    const store = getBaselines();
    const versions = Array.isArray(store[projectCode]) ? store[projectCode] : [];
    const version = versions.reduce((maximum, item) => Math.max(maximum, Number(item.version || 0)), 0) + 1;
    const record = {
      baselineId: uid("BASELINE"),
      projectCode,
      version,
      status: "Approved",
      reason: approval.reason || (version === 1 ? "Initial baseline approval" : "Approved rebaseline"),
      impact: approval.impact || "",
      approvedBy: approval.approvedBy || "",
      approvedByResourceId: approval.approvedByResourceId || "",
      approvalDate: approval.approvalDate || todayIso(),
      approvedAt: new Date().toISOString(),
      taskBaselines: baselineSnapshot(tasks)
    };
    versions.push(record);
    store[projectCode] = versions;
    /*
      Stage 16: the write result comes back with the record. Awaiting a write and then returning
      the record regardless would be the original defect wearing an await - the caller would
      still be told a baseline exists that the database may have refused.
    */
    const result = await write(KEYS.baselines, store);
    return { ...result, record };
  }

  function getBaselineRequests() {
    const value = read(KEYS.baselineRequests, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  async function saveBaselineRequest(projectCode, request) {
    if (databaseBaselineWorkflowEnabled())
      throw new Error("Rebaseline requests must be submitted through the Stage 11B database workflow.");
    const store = getBaselineRequests();
    const rows = Array.isArray(store[projectCode]) ? store[projectCode] : [];
    const record = {
      requestId: uid("REBASE"),
      projectCode,
      status: "Requested",
      createdAt: new Date().toISOString(),
      ...request
    };
    rows.push(record);
    store[projectCode] = rows;
    /* Same contract as createApprovedBaseline: the result, with the record attached. */
    const result = await write(KEYS.baselineRequests, store);
    return { ...result, record };
  }

  async function decideBaselineRequest(projectCode, requestId, decision) {
    if (databaseBaselineWorkflowEnabled())
      throw new Error("Rebaseline decisions must be recorded through the Stage 11B database workflow.");
    const store = getBaselineRequests();
    const rows = Array.isArray(store[projectCode]) ? store[projectCode] : [];
    const request = rows.find((item) => item.requestId === requestId);
    if (!request) return null;
    Object.assign(request, {
      status: decision.status,
      approval: decision.status,
      approvedBy: decision.approvedBy || "",
      approvedByResourceId: decision.approvedByResourceId || "",
      approvalDate: decision.approvalDate || todayIso(),
      decisionNotes: decision.decisionNotes || "",
      decidedAt: new Date().toISOString()
    });
    store[projectCode] = rows;
    const result = await write(KEYS.baselineRequests, store);
    return { ...result, record: request };
  }

  function baselineTaskRecord(projectCode, taskId) {
    const baseline = latestApprovedBaseline(projectCode);
    return baseline ? baseline.taskBaselines.find((item) => item.taskId === taskId) || null : null;
  }

  function slippageResult(projectCode, task) {
    const approved = baselineTaskRecord(projectCode, task.taskId);
    if (!approved || !approved.baselineEndDate)
      return {
        slipped: false,
        daysLate: 0,
        critical: Boolean(task.criticalPath),
        approvedBaselineEndDate: ""
      };
    const endDate = task.actualEndDate || task.forecastEndDate || "";
    const daysLate = calendarDaysLate(endDate, approved.baselineEndDate);
    return {
      slipped: daysLate > 0,
      daysLate,
      critical: Boolean(task.criticalPath),
      approvedBaselineEndDate: approved.baselineEndDate
    };
  }

  function getRagConfig() {
    return { ...DEFAULT_RAG_CONFIG, ...(read(KEYS.ragConfig, {}) || {}) };
  }

  async function saveRagConfig(config) {
    return write(KEYS.ragConfig, { ...getRagConfig(), ...config, updatedAt: new Date().toISOString() });
  }

  function getResourceConfig() {
    const stored = read(KEYS.resourceConfig, {}) || {};
    return {
      ...DEFAULT_RESOURCE_CONFIG,
      ...stored,
      warningThreshold: Number(
        stored.warningThreshold ??
          stored.overAllocationWarningPercent ??
          DEFAULT_RESOURCE_CONFIG.warningThreshold
      ),
      overAllocationThreshold: Number(
        stored.overAllocationThreshold ??
          stored.overAllocationCriticalPercent ??
          DEFAULT_RESOURCE_CONFIG.overAllocationThreshold
      ),
      underUtilisationThreshold: Number(
        stored.underUtilisationThreshold ??
          stored.underUtilisationPercent ??
          DEFAULT_RESOURCE_CONFIG.underUtilisationThreshold
      ),
      includeProvisionalInCapacity: Boolean(
        stored.includeProvisionalInCapacity ??
        stored.includeProvisionalByDefault ??
        DEFAULT_RESOURCE_CONFIG.includeProvisionalInCapacity
      )
    };
  }

  async function saveResourceConfig(config) {
    return write(KEYS.resourceConfig, {
      ...getResourceConfig(),
      ...config,
      updatedAt: new Date().toISOString()
    });
  }

  function ragRank(value) {
    return { "Not Assessed": 0, Grey: 0, Green: 1, Amber: 2, Red: 3 }[value] ?? 0;
  }

  function worstRag(values) {
    const assessed = values.filter((value) => ragRank(value) > 0);
    return assessed.length ? assessed.sort((a, b) => ragRank(b) - ragRank(a))[0] : "Not Assessed";
  }

  function getDemand() {
    const rows = read(KEYS.demand, []);
    return Array.isArray(rows) ? rows : [];
  }

  async function saveDemand(rows) {
    return write(KEYS.demand, Array.isArray(rows) ? rows : []);
  }
  function getAbsences() {
    const rows = read(KEYS.absence, []);
    return Array.isArray(rows) ? rows : [];
  }
  async function saveAbsences(rows) {
    return write(KEYS.absence, Array.isArray(rows) ? rows : []);
  }
  function getScenarios() {
    const rows = read(KEYS.scenarios, []);
    return Array.isArray(rows) ? rows : [];
  }
  async function saveScenarios(rows) {
    return write(KEYS.scenarios, Array.isArray(rows) ? rows : []);
  }

  function calculateProjectRags(project, options) {
    const settings = options || {};
    const config = getRagConfig();
    const plans = settings.plans || read("plans", {});
    const tasks = normalisePlan(Array.isArray(plans[project.projectCode]) ? plans[project.projectCode] : []);
    calculateCriticalPath(tasks);
    const slipped = tasks
      .map((task) => ({ task, result: slippageResult(project.projectCode, task) }))
      .filter((item) => item.result.slipped);
    const worstDays = Math.max(0, ...slipped.map((item) => item.result.daysLate));
    let schedule = "Not Assessed";
    if (latestApprovedBaseline(project.projectCode)) {
      if (slipped.some((item) => item.result.critical) || worstDays > config.scheduleRedToleranceDays)
        schedule = "Red";
      else if (worstDays > config.scheduleAmberToleranceDays || slipped.length) schedule = "Amber";
      else schedule = "Green";
    }

    const demand = getDemand().filter(
      (item) =>
        item.projectCode === project.projectCode &&
        !["Rejected", "Cancelled", "Completed"].includes(item.status)
    );
    const unfilledCritical = demand.some(
      (item) => !item.resourceId && ["Critical", "High"].includes(item.priority)
    );
    const provisional = demand.some((item) => !["Confirmed", "Completed"].includes(item.status));
    let resource = demand.length
      ? unfilledCritical
        ? "Red"
        : provisional
          ? "Amber"
          : "Green"
      : tasks.length
        ? tasks.some((task) => !task.taskOwnerResourceId && !["Phase", "Deliverable"].includes(task.taskType))
          ? "Amber"
          : "Green"
        : "Not Assessed";

    const raidStore = settings.raid || read("raid", {});
    const raid = Array.isArray(raidStore[project.projectCode]) ? raidStore[project.projectCode] : [];
    const openRaid = raid.filter((item) => item.status !== "Closed");
    const risk = !raid.length
      ? "Not Assessed"
      : openRaid.some((item) => item.priority === "Critical" || item.escalationStatus === "Escalated")
        ? "Red"
        : openRaid.some(
              (item) => item.priority === "High" || String(item.escalationStatus || "").includes("Required")
            )
          ? "Amber"
          : "Green";

    const scope = openRaid.some((item) => item.type === "Issue" && item.priority === "Critical")
      ? "Red"
      : openRaid.some((item) => item.type === "Issue" && ["High", "Medium"].includes(item.priority))
        ? "Amber"
        : project.highLevelScope
          ? "Green"
          : "Not Assessed";
    const cost = Number(project.costEstimate || project.indicativeCosts || 0);
    const budget = Number(project.approvedBudget || project.budget || 0);
    const variance = budget > 0 ? ((cost - budget) / budget) * 100 : 0;
    const financial =
      !cost && !budget
        ? "Not Assessed"
        : variance > config.financialRedVariance
          ? "Red"
          : variance > config.financialAmberVariance
            ? "Amber"
            : "Green";
    const benefit = !project.expectedBenefits
      ? "Not Assessed"
      : project.benefitMeasures || project.successMeasures
        ? "Green"
        : "Amber";
    const blockers = String(project.defectsBlockers || "").trim();
    const testStatus = String(project.testDatesStatus || "").toLowerCase();
    const quality = blockers
      ? "Red"
      : !testStatus
        ? "Not Assessed"
        : testStatus.includes("complete") || testStatus.includes("pass")
          ? "Green"
          : "Amber";
    const readiness =
      project.operationalReadinessStatus === "Ready"
        ? "Green"
        : project.operationalReadinessStatus === "Not Ready"
          ? "Red"
          : project.operationalReadinessStatus
            ? "Amber"
            : "Not Assessed";
    const dimensions = {
      schedule,
      scope,
      financial,
      resource,
      risk,
      benefit,
      quality,
      operationalReadiness: readiness
    };
    dimensions.overall = worstRag(Object.values(dimensions));
    return dimensions;
  }

  /*
    Stage 11E: recorded status history is append-only.

    This function and getRagHistory() are the only two ways the application
    touches ppmRagHistory, and appending is deliberately the only thing either of
    them does. Once recorded status is database-authoritative that is no longer
    just a convention: public.rag_history has no UPDATE or DELETE grant, so an
    edit or removal is refused by PostgreSQL and the database copy is restored over
    the local change.

    So do not add an edit or delete path here. If a status was reported wrongly,
    the correction is a new snapshot, which is also what leaves an honest trail.

    Stage 16 made the scoping honest rather than clever. It used to rely on the patched
    localStorage handing back a filtered view, so that a user limited to certain projects read
    and wrote only those projects' history and the merge on save preserved what they could not
    see. Now the store holds whatever RLS let this person load, and the write is row by row:
    history belonging to projects they cannot see is not read, not written, and therefore cannot
    be discarded by anything happening here.
  */
  async function recordRagHistory(projectCode, calculated, reported, justifications, recordedBy) {
    const store = read(KEYS.ragHistory, {});
    const rows = Array.isArray(store[projectCode]) ? store[projectCode] : [];
    const dimensions = {};
    RAG_DIMENSIONS.forEach(([key]) => {
      dimensions[key] = {
        calculated: calculated[key] || "Not Assessed",
        reported: reported[key] || "Not Assessed",
        override: calculated[key] !== reported[key],
        justification: justifications[key] || ""
      };
    });
    const entry = {
      statusId: uid("STATUS"),
      projectCode,
      recordedAt: new Date().toISOString(),
      recordedBy: recordedBy || "",
      dimensions
    };
    rows.push(entry);
    store[projectCode] = rows;

    /*
      Appended, not replaced. rag_history is append-only - there is no UPDATE or DELETE grant,
      enforced three ways in the database - so rewriting the whole collection would try to
      re-save every earlier snapshot and be refused. One row, keyed by its project.
    */
    if (!window.PPMStore) {
      return { ok: false, reason: "failed", message: "The data layer is not loaded on this page.", queued: false, entry };
    }
    const result = await window.PPMStore.ragHistory.save(entry, { storageGroup: projectCode });
    return { ...result, entry };
  }

  function getRagHistory(projectCode) {
    const store = read(KEYS.ragHistory, {});
    return Array.isArray(store[projectCode]) ? store[projectCode] : [];
  }

  function workingPeriodHours(resource, startDate, endDate) {
    const days = workingDaysBetween(startDate, endDate);
    const weekly = Number((resource && resource.standardWeeklyCapacity) || 37.5);
    return (days * weekly) / 5;
  }

  function absenceHours(resourceId, startDate, endDate) {
    return getAbsences()
      .filter(
        (item) =>
          item.resourceId === resourceId &&
          item.status === "Approved" &&
          item.startDate <= endDate &&
          item.endDate >= startDate
      )
      .reduce((sum, item) => {
        const overlapStart = item.startDate > startDate ? item.startDate : startDate;
        const overlapEnd = item.endDate < endDate ? item.endDate : endDate;
        return (
          sum +
          workingDaysBetween(overlapStart, overlapEnd) *
            Number(item.hoursPerDay || getResourceConfig().standardDayHours)
        );
      }, 0);
  }

  function availableCapacity(resource, startDate, endDate) {
    const contracted = workingPeriodHours(resource, startDate, endDate);
    const weeks = Math.max(1 / 5, workingDaysBetween(startDate, endDate) / 5);
    const absence = absenceHours(resource && resource.resourceId, startDate, endDate);
    const nonWorking = weeks * Number((resource && resource.nonWorkingHoursPerWeek) || 0);
    const operational = weeks * Number((resource && resource.fixedOperationalHoursPerWeek) || 0);
    const other = weeks * Number((resource && resource.otherUnavailableHoursPerWeek) || 0);
    return {
      contracted,
      absence,
      nonWorking,
      operational,
      other,
      available: Math.max(0, contracted - absence - nonWorking - operational - other)
    };
  }

  function normalisedDemandHours(demand, resource, startDate, endDate) {
    const start = startDate || demand.startDate;
    const end = endDate || demand.endDate;
    if (demand.allocationMethod === "Hours") return Number(demand.hours || demand.normalisedHours || 0);
    return (
      (availableCapacity(resource || {}, start, end).available * Number(demand.allocationPercentage || 0)) /
      100
    );
  }

  function overlap(firstStart, firstEnd, secondStart, secondEnd) {
    return Boolean(
      firstStart && firstEnd && secondStart && secondEnd && firstStart <= secondEnd && secondStart <= firstEnd
    );
  }

  function likelyDuplicateDemand(rows) {
    const duplicates = [];
    rows.forEach((item, index) =>
      rows.slice(index + 1).forEach((other) => {
        if (
          item.resourceId &&
          item.resourceId === other.resourceId &&
          item.projectCode === other.projectCode &&
          overlap(item.startDate, item.endDate, other.startDate, other.endDate) &&
          !["Rejected", "Cancelled"].includes(item.status) &&
          !["Rejected", "Cancelled"].includes(other.status)
        )
          duplicates.push([item.demandId, other.demandId]);
      })
    );
    return duplicates;
  }

  window.PPMPlanning = {
    RAG_DIMENSIONS,
    DEFAULT_RAG_CONFIG,
    DEFAULT_RESOURCE_CONFIG,
    read,
    write,
    uid,
    todayIso,
    parseDate,
    isoDate,
    addDays,
    workingDaysBetween,
    calendarDaysLate,
    normaliseTask,
    normalisePlan,
    childrenOf,
    hierarchyDepth,
    hierarchyErrors,
    calculateParentProgress,
    incompleteChildErrors,
    normaliseDependency,
    dependencyCycle,
    dependencyConflicts,
    calculateCriticalPath,
    getBaselines,
    getProjectBaselines,
    latestApprovedBaseline,
    baselineSnapshot,
    createApprovedBaseline,
    getBaselineRequests,
    saveBaselineRequest,
    decideBaselineRequest,
    baselineTaskRecord,
    slippageResult,
    getRagConfig,
    saveRagConfig,
    getResourceConfig,
    saveResourceConfig,
    calculateProjectRags,
    recordRagHistory,
    getRagHistory,
    worstRag,
    getDemand,
    saveDemand,
    getAbsences,
    saveAbsences,
    getScenarios,
    saveScenarios,
    workingPeriodHours,
    absenceHours,
    availableCapacity,
    normalisedDemandHours,
    overlap,
    likelyDuplicateDemand
  };
})();
