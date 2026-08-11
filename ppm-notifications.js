(function () {
  "use strict";

  const STATE_KEY = "ppmNotificationState";
  const DAY_MS = 86400000;
  const CLOSED_TASK_STATUSES = new Set(["Complete", "Completed", "Cancelled", "Not Applicable"]);
  const CLOSED_RAID_STATUSES = new Set(["Closed", "Cancelled", "Resolved"]);
  const CLOSED_ACTION_STATUSES = new Set(["Complete", "Completed", "Closed", "Cancelled"]);
  const REVIEW_INTERVALS = {
    Weekly: 7,
    Fortnightly: 14,
    Monthly: 30,
    Quarterly: 91,
    "Six-monthly": 182,
    Annually: 365
  };
  const SEVERITY_RANK = { critical: 4, high: 3, normal: 2, info: 1 };
  let items = [];
  let activeFilter = "all";
  let bellButton = null;
  let panel = null;

  /*
    Stage 16: notifications are built from PPMStore.

    They are still built only from records the signed-in person may see, and that is now true for
    a better reason. This used to call PPMAuth.readScoped, whose filtering was a client-side
    convenience layered over the localStorage mirror. The store holds whatever RLS allowed this
    person to load, so the scoping is the database's and cannot be talked out of.

    rows() replaces the local flattenStore: all() already unpacks the project-keyed shape and
    fills in a row's project code or programme id from the key it is filed under.
  */
  function raw(collection, fallback) {
    if (!window.PPMStore) return fallback;
    const value = PPMStore[collection].read();
    return value === null || value === undefined ? fallback : value;
  }

  function rows(collection) {
    return window.PPMStore ? PPMStore[collection].all() : [];
  }
  function normalise(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }
  const todayIso = PPMCore.todayIso;
  function dateValue(value) {
    if (!value) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function isoDate(value) {
    const date = dateValue(value);
    if (!date) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function addDays(value, count) {
    const date = dateValue(value);
    if (!date) return "";
    date.setDate(date.getDate() + Number(count || 0));
    return isoDate(date);
  }
  function daysUntil(value) {
    const date = dateValue(value);
    const today = dateValue(todayIso());
    return date ? Math.round((date - today) / DAY_MS) : null;
  }
  function isRecent(value, days) {
    const date = dateValue(value);
    return Boolean(
      date &&
      Date.now() - date.getTime() <= Number(days || 30) * DAY_MS &&
      Date.now() >= date.getTime() - DAY_MS
    );
  }
  function formatDate(value) {
    const date = dateValue(value);
    return date
      ? date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : "Date not recorded";
  }
  function dueLabel(value) {
    const days = daysUntil(value);
    if (days === null) return "Date not recorded";
    if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`;
    if (days === 0) return "Due today";
    if (days === 1) return "Due tomorrow";
    return `Due in ${days} days`;
  }
  function money(value) {
    return Number(value || 0).toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0
    });
  }
  const escapeHtml = PPMCore.escapeHtml;
  function stableId(parts) {
    return parts
      .map((part) =>
        String(part ?? "")
          .trim()
          .replaceAll("|", "-")
      )
      .join("|");
  }

  /*
    Being named is the point.

    Every approval notification used to read "you are the named approver AND your role may
    approve", so a person named on a record whose roles cannot act was told nothing at all.
    The record then sat there indefinitely, and the one person who could have chased it was
    the one person kept in the dark.

    Now the named person is always told, and if their roles cannot act the notification says
    so. The fix is usually to give them the role that can - a person may hold several - which
    is what this message points at.
  */
  /*
    Added to a notification when the person is being asked for something their role cannot do, so
    the answer is "ask an administrator" rather than a button that does nothing.

    Only use it where the role genuinely still decides. Stage 18 made being named as a required
    approver on a stage gate the authority in its own right, so saying it there would send
    somebody to an administrator to fix a problem they do not have - which is the same shape of
    misdirection as the message that blamed the account for a Draft gate.
  */
  function blockedNote(canAct, whatToDo) {
    return canAct ? "" : ` \u00b7 Your access roles cannot ${whatToDo} - ask an administrator`;
  }

  function assignedTo(record, field, user) {
    const id = record?.[`${field}ResourceId`];
    if (id && id === user.resourceId) return true;
    const legacy = record?.[field];
    return Boolean(legacy && normalise(legacy) === normalise(user.fullName || user.name));
  }
  function projectPerson(project, field, user) {
    return assignedTo(project, field, user);
  }
  function projectApprover(project, user) {
    return (
      projectPerson(project, "sponsor", user) ||
      projectPerson(project, "projectLead", user) ||
      projectPerson(project, "lead", user)
    );
  }
  function projectDeliveryOwner(project, user) {
    return (
      projectPerson(project, "projectManager", user) || projectPerson(project, "deputyProjectManager", user)
    );
  }
  function activeProject(project) {
    return Boolean(
      project &&
      !project.archived &&
      !project.isArchived &&
      project.projectStatus !== "Archived" &&
      !["Completed", "Cancelled", "Rejected"].includes(project.projectStatus)
    );
  }

  /*
    Which notifications this person has dismissed, on this computer.

    Browser state, in localStorage, and read directly so that is obvious. It briefly went through
    raw() when the reads were migrated to PPMStore - raw() takes a collection name, STATE_KEY is a
    storage key, and PPMStore["ppmNotificationState"] is undefined, so every page load threw
    before the notification bell could render.
  */
  function stateFor(resourceId) {
    const store = PPMCore.readJson(STATE_KEY, {});
    const state =
      store && typeof store === "object" && store[resourceId] && typeof store[resourceId] === "object"
        ? store[resourceId]
        : {};
    return {
      read: state.read && typeof state.read === "object" ? state.read : {},
      updatedAt: state.updatedAt || ""
    };
  }
  function saveState(resourceId, state) {
    const store = PPMCore.readJson(STATE_KEY, {});
    const next = store && typeof store === "object" && !Array.isArray(store) ? store : {};
    const cutoff = Date.now() - 120 * DAY_MS;
    const read = Object.fromEntries(
      Object.entries(state.read || {}).filter(
        ([, timestamp]) => !timestamp || new Date(timestamp).getTime() >= cutoff
      )
    );
    next[resourceId] = { read, updatedAt: new Date().toISOString() };
    /*
      Which notifications this person has dismissed, on this computer. There is no table for it
      and it is not portfolio data, so localStorage is the right home and it says so plainly.

      It used to prefer PPMAuth.writeScoped, whose name promised a permission-filtered write.
      That filter went with the prototype patch in Stage 16 - the function is now an ordinary
      localStorage write with a misleading name, and going through it hid the fact that this is
      browser state rather than something the database keeps.
    */
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
  }

  function notificationBuilder(user, scopedCodes, projectMap) {
    const notifications = [];
    const seen = new Set();
    const formalGateProjectCodes = new Set();
    const canUseProject = (code) => !code || scopedCodes.has(code);
    const add = (notification) => {
      if (!notification?.id || seen.has(notification.id) || !notification.href) return;
      if (notification.projectCode && !canUseProject(notification.projectCode)) return;
      seen.add(notification.id);
      notifications.push({
        severity: "normal",
        category: "due",
        projectCode: "",
        entityId: "",
        dueDate: "",
        eventDate: "",
        ...notification
      });
    };
    const projectLabel = (code) => projectMap.get(code)?.projectName || code || "Portfolio-wide";

    // Explicitly assigned budget approvals and recent outcomes for their requestors.
    if (PPMAuth.can("financials.viewDetail"))
      rows("financialApprovals").forEach((approval) => {
        if (!canUseProject(approval.projectCode)) return;
        if (
          approval.status === "Pending Approval" &&
          approval.approverResourceId === user.resourceId &&
          approval.requesterResourceId !== user.resourceId
        ) {
          const canDecide = PPMAuth.can("financials.approve", approval.projectCode);
          add({
            id: stableId(["budget-approval", approval.approvalId, approval.status]),
            category: "approval",
            severity: "high",
            title: "Budget approval awaiting your decision",
            detail: `${projectLabel(approval.projectCode)} · ${approval.requestType || "Budget request"} for ${money(approval.proposedBudget)}`,
            meta: `Assigned approver${blockedNote(canDecide, "approve budgets")}`,
            href: `financial-management.html?project=${encodeURIComponent(approval.projectCode)}&item=${encodeURIComponent(approval.approvalId)}`,
            projectCode: approval.projectCode,
            entityId: approval.approvalId,
            eventDate: approval.requestedAt
          });
        }
        if (
          ["Approved", "Rejected"].includes(approval.status) &&
          approval.requesterResourceId === user.resourceId &&
          isRecent(approval.decisionAt, 30)
        ) {
          add({
            id: stableId(["budget-outcome", approval.approvalId, approval.status]),
            category: "update",
            severity: approval.status === "Rejected" ? "high" : "info",
            title: `Budget request ${approval.status.toLowerCase()}`,
            detail: `${projectLabel(approval.projectCode)} · ${money(approval.proposedBudget)}`,
            meta: approval.decisionComments || "A decision has been recorded",
            href: `financial-management.html?project=${encodeURIComponent(approval.projectCode)}&item=${encodeURIComponent(approval.approvalId)}`,
            projectCode: approval.projectCode,
            entityId: approval.approvalId,
            eventDate: approval.decisionAt
          });
        }
      });

    // Plan baselines requiring an authorised independent approver.
    if (PPMAuth.can("plan.view")) {
      rows("baselineRequests").forEach((request) => {
        if (
          !canUseProject(request.projectCode) ||
          request.status !== "Requested" ||
          request.requestedByResourceId === user.resourceId ||
          !PPMAuth.can("plan.approveBaseline", request.projectCode)
        )
          return;
        add({
          id: stableId(["baseline-approval", request.requestId, request.status]),
          category: "approval",
          severity: "high",
          title: "Rebaseline request awaiting approval",
          detail: `${projectLabel(request.projectCode)} · ${request.reason || "Schedule baseline change"}`,
          meta: "Independent approval required",
          href: `project-plan.html?code=${encodeURIComponent(request.projectCode)}&view=baseline&item=${encodeURIComponent(request.requestId)}`,
          projectCode: request.projectCode,
          entityId: request.requestId,
          eventDate: request.createdAt
        });
      });
      const baselines = raw("planBaselines", {});
      const plans = raw("plans", {});
      scopedCodes.forEach((code) => {
        const project = projectMap.get(code);
        const tasks = Array.isArray(plans?.[code]) ? plans[code] : [];
        const versions = Array.isArray(baselines?.[code]) ? baselines[code] : [];
        if (
          !activeProject(project) ||
          !tasks.some((task) => task.baselineStartDate && task.baselineEndDate) ||
          versions.some((row) => row.status === "Approved") ||
          !PPMAuth.can("plan.approveBaseline", code)
        )
          return;
        add({
          id: stableId(["initial-baseline", code, tasks.length]),
          category: "approval",
          severity: "normal",
          title: "Initial project-plan baseline needs approval",
          detail: `${projectLabel(code)} · ${tasks.length} plan item${tasks.length === 1 ? "" : "s"}`,
          meta: "Approval required before baseline dates are controlled",
          href: `project-plan.html?code=${encodeURIComponent(code)}&view=baseline`,
          projectCode: code,
          entityId: `BASELINE-${code}`
        });
      });
    }

    // Formal lifecycle gates: independent decisions, outcomes and scheduled meetings.
    if (PPMAuth.can("stageGates.view"))
      rows("stageGates").forEach((gate) => {
        if (!canUseProject(gate.projectCode)) return;
        const project = projectMap.get(gate.projectCode);
        if (!activeProject(project)) return;
        formalGateProjectCodes.add(gate.projectCode);
        const approver = (Array.isArray(gate.requiredApprovers) ? gate.requiredApprovers : []).find(
          (person) =>
            person.resourceId === user.resourceId ||
            (person.email && normalise(person.email) === normalise(user.email)) ||
            (person.name && normalise(person.name) === normalise(user.fullName))
        );
        const submitterIsUser =
          assignedTo(gate, "submissionOwner", user) || gate.submittedByResourceId === user.resourceId;
        const selfApproval = submitterIsUser && Boolean(approver);
        const href = `stage-gates.html?code=${encodeURIComponent(gate.projectCode)}&item=${encodeURIComponent(gate.gateId)}`;
        const routeApproverIsUser =
          assignedTo(gate, "routeApprover", user) ||
          Boolean(gate.routeApproverEmail && normalise(gate.routeApproverEmail) === normalise(user.email));
        const routeRequesterIsUser = assignedTo(gate, "routeRequestedBy", user);
        const routeDecisionRecorded =
          gate.routeRequirement === "Not Applicable" &&
          ["Approved", "Rejected"].includes(gate.routeApprovalStatus);
        const routeSelfApproval = routeRequesterIsUser || submitterIsUser;
        if (
          gate.routeRequirement === "Not Applicable" &&
          gate.routeApprovalStatus === "Pending" &&
          gate.routeRequestedAt &&
          routeApproverIsUser &&
          !routeSelfApproval
        ) {
          const canOverride = PPMAuth.can("stageGates.override", gate.projectCode);
          add({
            id: stableId([
              "formal-route-approval",
              gate.gateId,
              gate.revision || gate.version || 1,
              gate.routeRequestedAt
            ]),
            category: "approval",
            severity: "high",
            title: "Governance-route exception awaiting your decision",
            detail: `${gate.gateName || gate.gateId} · ${projectLabel(gate.projectCode)}`,
            meta: `${gate.routeReason || "Not-applicable route approval"}${blockedNote(canOverride, "approve a governance-route exception")}`,
            href,
            projectCode: gate.projectCode,
            entityId: gate.gateId,
            eventDate: gate.routeRequestedAt
          });
        }
        if (
          ["Submitted", "Conditionally Approved"].includes(gate.workflowStatus) &&
          approver &&
          approver.decision !== "Approved" &&
          !selfApproval
        ) {
          /*
            Stage 18: no blockedNote here. Being named as a required approver is the authority to
            decide this gate, whatever the person's role - so the note would have been wrong, and
            it was: an Executive / Steering User named as an approver was told their access roles
            could not approve stage gates, on the notification asking them to approve one.
          */
          add({
            id: stableId(["formal-gate-approval", gate.gateId, gate.workflowStatus, gate.updatedAt]),
            category: "approval",
            severity: "high",
            title: "Stage gate awaiting your decision",
            detail: `${gate.gateName || gate.gateId} Â· ${projectLabel(gate.projectCode)}`,
            meta: `${gate.currentStage || "Current stage"} to ${gate.proposedNextStage || "no stage progression"} \u00b7 Independent approval`,
            href,
            projectCode: gate.projectCode,
            entityId: gate.gateId,
            eventDate: gate.submittedAt || gate.updatedAt
          });
        }
        if (
          routeDecisionRecorded &&
          routeRequesterIsUser &&
          isRecent(gate.routeApprovalDate || gate.updatedAt, 30)
        ) {
          add({
            id: stableId([
              "formal-route-outcome",
              gate.gateId,
              gate.revision || gate.version || 1,
              gate.routeApprovalStatus,
              gate.routeApprovalDate || gate.updatedAt
            ]),
            category: "update",
            severity: gate.routeApprovalStatus === "Rejected" ? "high" : "info",
            title: `Governance-route exception ${gate.routeApprovalStatus.toLowerCase()}`,
            detail: `${gate.gateName || gate.gateId} · ${projectLabel(gate.projectCode)}`,
            meta: gate.routeApprovalComments || gate.routeReason || "The route decision has been recorded",
            href,
            projectCode: gate.projectCode,
            entityId: gate.gateId,
            eventDate: gate.routeApprovalDate || gate.updatedAt
          });
        }
        if (
          !routeDecisionRecorded &&
          ["Approved", "Conditionally Approved", "Deferred", "Rejected", "Cancelled"].includes(
            gate.workflowStatus
          ) &&
          submitterIsUser &&
          isRecent(gate.decisionDate || gate.updatedAt, 30)
        ) {
          add({
            id: stableId([
              "formal-gate-outcome",
              gate.gateId,
              gate.workflowStatus,
              gate.decisionDate || gate.updatedAt
            ]),
            category: "update",
            severity: ["Rejected", "Deferred"].includes(gate.workflowStatus) ? "high" : "info",
            title: `Stage gate ${gate.workflowStatus.toLowerCase()}`,
            detail: `${gate.gateName || gate.gateId} Â· ${projectLabel(gate.projectCode)}`,
            meta:
              gate.conditions ||
              gate.rejectionDeferralReason ||
              gate.approvalComments ||
              "The governance decision has been recorded",
            href,
            projectCode: gate.projectCode,
            entityId: gate.gateId,
            eventDate: gate.decisionDate || gate.updatedAt
          });
        }
        const meetingDays = daysUntil(gate.meetingDate);
        const responsible =
          submitterIsUser || Boolean(approver) || routeApproverIsUser || projectDeliveryOwner(project, user);
        const meetingIsOpen =
          ["Draft", "Submitted", "Conditionally Approved"].includes(gate.workflowStatus) &&
          gate.routeApprovalStatus !== "Rejected";
        if (responsible && meetingIsOpen && meetingDays !== null && meetingDays <= 7) {
          add({
            id: stableId(["formal-gate-meeting", gate.gateId, gate.meetingDate, gate.workflowStatus]),
            category: "due",
            severity: meetingDays < 0 ? "critical" : meetingDays <= 1 ? "high" : "normal",
            title:
              meetingDays < 0
                ? "Stage-gate meeting is overdue"
                : meetingDays === 0
                  ? "Stage-gate meeting is today"
                  : "Stage-gate meeting is approaching",
            detail: `${gate.gateName || gate.gateId} Â· ${projectLabel(gate.projectCode)}`,
            meta: `${dueLabel(gate.meetingDate)} Â· ${gate.workflowStatus}`,
            href,
            projectCode: gate.projectCode,
            entityId: gate.gateId,
            dueDate: gate.meetingDate
          });
        }
      });

    // Overdue and due-today plan work, owned by the signed-in person.
    if (PPMAuth.can("plan.view"))
      rows("plans").forEach((task) => {
        if (
          !canUseProject(task.projectCode) ||
          !activeProject(projectMap.get(task.projectCode)) ||
          CLOSED_TASK_STATUSES.has(task.status) ||
          Number(task.percentageComplete || 0) >= 100
        )
          return;
        const responsible =
          assignedTo(task, "taskOwner", user) ||
          (!task.taskOwnerResourceId &&
            !task.taskOwner &&
            projectDeliveryOwner(projectMap.get(task.projectCode), user));
        const days = daysUntil(task.forecastEndDate);
        if (!responsible || days === null || days > 0) return;
        add({
          id: stableId(["task-overdue", task.projectCode, task.taskId, task.forecastEndDate]),
          category: "due",
          severity: task.criticalPath || days < -7 ? "critical" : "high",
          title: days < 0 ? "Project-plan task is overdue" : "Project-plan task is due today",
          detail: `${task.taskName || task.taskId} · ${projectLabel(task.projectCode)}`,
          meta: `${dueLabel(task.forecastEndDate)} · ${Number(task.percentageComplete || 0)}% complete${task.criticalPath ? " · Critical path" : ""}`,
          href: `project-plan.html?code=${encodeURIComponent(task.projectCode)}&item=${encodeURIComponent(task.taskId)}`,
          projectCode: task.projectCode,
          entityId: task.taskId,
          dueDate: task.forecastEndDate
        });
      });

    // RAID review periods, escalation and target dates.
    if (PPMAuth.can("raid.view"))
      rows("raid").forEach((raid) => {
        if (
          !canUseProject(raid.projectCode) ||
          CLOSED_RAID_STATUSES.has(raid.status) ||
          !assignedTo(raid, "owner", user)
        )
          return;
        const isRisk = normalise(raid.type) === "risk";
        const interval = REVIEW_INTERVALS[raid.reviewFrequency] || 0;
        const reviewDue =
          isRisk && interval ? addDays(raid.lastReviewedDate || raid.dateRaised, interval) : raid.targetDate;
        const days = daysUntil(reviewDue);
        const escalation = ["Escalation Required", "PMO Review Required"].includes(raid.escalationStatus);
        if ((days === null || days > 0) && !escalation) return;
        const title = escalation
          ? `${raid.type || "RAID"} item requires escalation`
          : isRisk
            ? days < 0
              ? "Risk review is overdue"
              : "Risk review is due today"
            : days < 0
              ? `${raid.type || "RAID"} target date has passed`
              : `${raid.type || "RAID"} item is due today`;
        add({
          id: stableId(["raid-review", raid.raidId, reviewDue, raid.escalationStatus]),
          category: "due",
          severity:
            escalation || raid.priority === "Critical" || (days !== null && days < -7) ? "critical" : "high",
          title,
          detail: `${raid.title || raid.raidId} · ${projectLabel(raid.projectCode)}`,
          meta: escalation ? raid.escalationStatus : dueLabel(reviewDue),
          href: `raid-log.html?code=${encodeURIComponent(raid.projectCode)}&item=${encodeURIComponent(raid.raidId)}`,
          projectCode: raid.projectCode,
          entityId: raid.raidId,
          dueDate: reviewDue
        });
      });

    // Accountable actions and decision-owner approvals.
    if (PPMAuth.can("registers.view")) {
      rows("actions").forEach((action) => {
        if (
          !canUseProject(action.projectCode) ||
          CLOSED_ACTION_STATUSES.has(action.status) ||
          !assignedTo(action, "owner", user)
        )
          return;
        const days = daysUntil(action.dueDate);
        const blocked = action.status === "Blocked" || action.escalationStatus === "Escalation Required";
        if ((days === null || days > 0) && !blocked) return;
        add({
          id: stableId([
            "action-due",
            action.actionId,
            action.dueDate,
            action.status,
            action.escalationStatus
          ]),
          category: "due",
          severity:
            blocked || action.priority === "Critical" || (days !== null && days < -7) ? "critical" : "high",
          title: blocked
            ? "Owned action is blocked or escalated"
            : days < 0
              ? "Owned action is overdue"
              : "Owned action is due today",
          detail: `${action.description || action.actionId} · ${projectLabel(action.projectCode)}`,
          meta: blocked
            ? `${action.status} · ${action.escalationStatus || "Escalation required"}`
            : dueLabel(action.dueDate),
          href: `registers.html?tab=actions&item=${encodeURIComponent(action.actionId)}`,
          projectCode: action.projectCode,
          entityId: action.actionId,
          dueDate: action.dueDate
        });
      });
      rows("decisions").forEach((decision) => {
        if (
          !canUseProject(decision.projectCode) ||
          !["Required", "Under Review"].includes(decision.status) ||
          !assignedTo(decision, "decisionOwner", user)
        )
          return;
        const days = daysUntil(decision.requiredByDate);
        add({
          id: stableId(["decision-required", decision.decisionId, decision.status, decision.requiredByDate]),
          category: "approval",
          severity: days !== null && days < 0 ? "critical" : "high",
          title: "Decision requires your response",
          detail: `${decision.decisionRequired || decision.decisionId} · ${projectLabel(decision.projectCode)}`,
          meta: decision.requiredByDate ? dueLabel(decision.requiredByDate) : "Decision owner",
          href: `registers.html?tab=decisions&item=${encodeURIComponent(decision.decisionId)}`,
          projectCode: decision.projectCode,
          entityId: decision.decisionId,
          dueDate: decision.requiredByDate
        });
      });
    }

    // Benefits owned by the user: scheduled reviews and target realisation.
    if (PPMAuth.can("benefits.view"))
      rows("benefits").forEach((benefit) => {
        if (benefit.projectCode && !canUseProject(benefit.projectCode)) return;
        if (
          !assignedTo(benefit, "owner", user) ||
          ["Realised", "No longer applicable"].includes(benefit.status)
        )
          return;
        const baseHref = `benefits-management.html?${benefit.projectCode ? `project=${encodeURIComponent(benefit.projectCode)}&` : benefit.programmeId ? `programme=${encodeURIComponent(benefit.programmeId)}&` : ""}item=${encodeURIComponent(benefit.benefitId)}`;
        const reviewDays = daysUntil(benefit.nextReviewDate);
        if (reviewDays !== null && reviewDays <= 0)
          add({
            id: stableId(["benefit-review", benefit.benefitId, benefit.nextReviewDate]),
            category: "due",
            severity: reviewDays < -14 ? "high" : "normal",
            title: reviewDays < 0 ? "Benefit review is overdue" : "Benefit review is due today",
            detail: benefit.description || benefit.benefitId,
            meta: dueLabel(benefit.nextReviewDate),
            href: baseHref,
            projectCode: benefit.projectCode,
            entityId: benefit.benefitId,
            dueDate: benefit.nextReviewDate
          });
        const targetDays = daysUntil(benefit.targetRealisationDate);
        if (targetDays !== null && targetDays <= 0)
          add({
            id: stableId([
              "benefit-target",
              benefit.benefitId,
              benefit.targetRealisationDate,
              benefit.status
            ]),
            category: "due",
            severity: benefit.realisationConfidence === "Low" || targetDays < -14 ? "high" : "normal",
            title:
              targetDays < 0
                ? "Benefit realisation target has passed"
                : "Benefit realisation target is today",
            detail: benefit.description || benefit.benefitId,
            meta: `${dueLabel(benefit.targetRealisationDate)} · ${benefit.status || "Not assessed"}`,
            href: baseHref,
            projectCode: benefit.projectCode,
            entityId: benefit.benefitId,
            dueDate: benefit.targetRealisationDate
          });
      });

    // Milestones and project stage gates.
    if (PPMAuth.can("milestones.view"))
      rows("milestones").forEach((milestone) => {
        if (
          !canUseProject(milestone.projectCode) ||
          !activeProject(projectMap.get(milestone.projectCode)) ||
          Number(milestone.percentageComplete || 0) >= 100 ||
          milestone.status === "Complete"
        )
          return;
        const responsible =
          assignedTo(milestone, "owner", user) ||
          (!milestone.ownerResourceId &&
            !milestone.owner &&
            projectDeliveryOwner(projectMap.get(milestone.projectCode), user));
        const due = milestone.forecastFinishDate || milestone.forecastDate;
        const days = daysUntil(due);
        if (!responsible || days === null || days > 0) return;
        add({
          id: stableId([
            "milestone-due",
            milestone.projectCode,
            milestone.milestoneId || milestone.recordId,
            due
          ]),
          category: "due",
          severity: days < -7 ? "critical" : "high",
          title: days < 0 ? "Milestone is overdue" : "Milestone is due today",
          detail: `${milestone.milestoneName || milestone.title || milestone.milestoneId} · ${projectLabel(milestone.projectCode)}`,
          meta: dueLabel(due),
          href: `milestones.html?code=${encodeURIComponent(milestone.projectCode)}&item=${encodeURIComponent(milestone.milestoneId || milestone.recordId || "")}`,
          projectCode: milestone.projectCode,
          entityId: milestone.milestoneId || milestone.recordId,
          dueDate: due
        });
      });
    scopedCodes.forEach((code) => {
      const project = projectMap.get(code);
      if (!activeProject(project)) return;
      if (formalGateProjectCodes.has(code)) return;
      const gateDays = daysUntil(project.nextStageGateDate);
      if (
        gateDays !== null &&
        gateDays <= 7 &&
        (projectDeliveryOwner(project, user) || projectApprover(project, user))
      )
        add({
          id: stableId(["stage-gate", code, project.currentStageGate, project.nextStageGateDate]),
          category: "due",
          severity: gateDays < 0 ? "critical" : gateDays <= 1 ? "high" : "normal",
          title:
            gateDays < 0
              ? "Project stage gate is overdue"
              : gateDays === 0
                ? "Project stage gate is today"
                : "Project stage gate is approaching",
          detail: `${project.currentStageGate || project.nextStage || "Next stage gate"} · ${projectLabel(code)}`,
          meta: dueLabel(project.nextStageGateDate),
          href: `project-details.html?code=${encodeURIComponent(code)}`,
          projectCode: code,
          entityId: `GATE-${code}`,
          dueDate: project.nextStageGateDate
        });
    });

    // Project lifecycle approvals assigned to sponsors and leads.
    if (PPMAuth.can("projects.view")) {
      const approvalFields = [
        ["approvalStatus", "Project approval"],
        ["requirementsApprovalStatus", "Requirements approval"],
        ["goLiveApprovalStatus", "Go-live approval"],
        ["closureApprovalStatus", "Closure approval"]
      ];
      scopedCodes.forEach((code) => {
        const project = projectMap.get(code);
        if (!activeProject(project) || !projectApprover(project, user)) return;
        approvalFields.forEach(([field, label]) => {
          if (project[field] !== "Pending Approval") return;
          add({
            id: stableId(["project-approval", code, field, project[field]]),
            category: "approval",
            severity:
              field === "goLiveApprovalStatus" || field === "closureApprovalStatus" ? "high" : "normal",
            title: `${label} awaiting your review`,
            detail: projectLabel(code),
            meta: `${project.currentStage || "Lifecycle"} governance`,
            href: `project-details.html?code=${encodeURIComponent(code)}`,
            projectCode: code,
            entityId: `${code}-${field}`
          });
        });
      });
    }

    // Status reports and governed documents.
    if (PPMAuth.can("registers.view")) {
      rows("statusReports").forEach((report) => {
        if (!canUseProject(report.projectCode)) return;
        const project = projectMap.get(report.projectCode);
        if (report.status === "Submitted" && projectApprover(project, user))
          add({
            id: stableId(["status-approval", report.reportId, report.status]),
            category: "approval",
            severity: "high",
            title: "Status report awaiting sponsor review",
            detail: `${report.reportingPeriod || report.reportId} · ${projectLabel(report.projectCode)}`,
            meta: "Submitted for approval",
            href: `registers.html?tab=statusReports&item=${encodeURIComponent(report.reportId)}`,
            projectCode: report.projectCode,
            entityId: report.reportId,
            eventDate: report.submittedDate
          });
        const dueDays = daysUntil(report.dueDate);
        if (
          projectDeliveryOwner(project, user) &&
          dueDays !== null &&
          dueDays <= 0 &&
          !["Submitted", "Approved", "Locked"].includes(report.status)
        )
          add({
            id: stableId(["status-due", report.reportId, report.dueDate, report.status]),
            category: "due",
            severity: dueDays < -3 ? "critical" : "high",
            title: dueDays < 0 ? "Status report is overdue" : "Status report is due today",
            detail: `${report.reportingPeriod || report.reportId} · ${projectLabel(report.projectCode)}`,
            meta: `${dueLabel(report.dueDate)} · ${report.status}`,
            href: `registers.html?tab=statusReports&item=${encodeURIComponent(report.reportId)}`,
            projectCode: report.projectCode,
            entityId: report.reportId,
            dueDate: report.dueDate
          });
        if (
          projectDeliveryOwner(project, user) &&
          report.status === "Returned" &&
          isRecent(report.updatedAt, 30)
        )
          add({
            id: stableId(["status-returned", report.reportId, report.updatedAt]),
            category: "update",
            severity: "high",
            title: "Status report was returned for changes",
            detail: `${report.reportingPeriod || report.reportId} · ${projectLabel(report.projectCode)}`,
            meta: report.sponsorComments || "Review the sponsor comments",
            href: `registers.html?tab=statusReports&item=${encodeURIComponent(report.reportId)}`,
            projectCode: report.projectCode,
            entityId: report.reportId,
            eventDate: report.updatedAt
          });
      });
      rows("documents").forEach((documentRecord) => {
        if (!canUseProject(documentRecord.projectCode)) return;
        const project = projectMap.get(documentRecord.projectCode);
        const href = `registers.html?tab=documents&item=${encodeURIComponent(documentRecord.documentId)}`;
        if (documentRecord.approvalStatus === "Pending" && projectApprover(project, user))
          add({
            id: stableId([
              "document-approval",
              documentRecord.documentId,
              documentRecord.version,
              documentRecord.approvalStatus
            ]),
            category: "approval",
            severity: "normal",
            title: "Document approval is pending",
            detail: `${documentRecord.title || documentRecord.documentId} · ${projectLabel(documentRecord.projectCode)}`,
            meta: documentRecord.documentType || "Governance document",
            href,
            projectCode: documentRecord.projectCode,
            entityId: documentRecord.documentId,
            eventDate: documentRecord.updatedAt
          });
        const reviewDays = daysUntil(documentRecord.reviewDate);
        if (
          assignedTo(documentRecord, "owner", user) &&
          reviewDays !== null &&
          reviewDays <= 0 &&
          !["Archived", "Superseded"].includes(documentRecord.status)
        )
          add({
            id: stableId(["document-review", documentRecord.documentId, documentRecord.reviewDate]),
            category: "due",
            severity: reviewDays < -14 ? "high" : "normal",
            title: reviewDays < 0 ? "Document review is overdue" : "Document review is due today",
            detail: `${documentRecord.title || documentRecord.documentId} · ${projectLabel(documentRecord.projectCode)}`,
            meta: dueLabel(documentRecord.reviewDate),
            href,
            projectCode: documentRecord.projectCode,
            entityId: documentRecord.documentId,
            dueDate: documentRecord.reviewDate
          });
        if (
          assignedTo(documentRecord, "owner", user) &&
          ["Approved", "Rejected"].includes(documentRecord.approvalStatus) &&
          isRecent(documentRecord.updatedAt, 30)
        )
          add({
            id: stableId([
              "document-outcome",
              documentRecord.documentId,
              documentRecord.version,
              documentRecord.approvalStatus
            ]),
            category: "update",
            severity: documentRecord.approvalStatus === "Rejected" ? "high" : "info",
            title: `Document ${documentRecord.approvalStatus.toLowerCase()}`,
            detail: `${documentRecord.title || documentRecord.documentId} · ${projectLabel(documentRecord.projectCode)}`,
            meta: documentRecord.notes || `Version ${documentRecord.version || "not recorded"}`,
            href,
            projectCode: documentRecord.projectCode,
            entityId: documentRecord.documentId,
            eventDate: documentRecord.updatedAt
          });
      });
    }

    // Resource requests, requester outcomes, critical unfilled demand and absence review.
    if (PPMAuth.can("resourceManagement.view")) {
      const resources = raw("people", []);
      const resourceMap = new Map(
        (Array.isArray(resources) ? resources : []).map((resource) => [resource.resourceId, resource])
      );
      rows("resourceDemand").forEach((demand) => {
        if (demand.projectCode && !canUseProject(demand.projectCode)) return;
        const href = `resource-management.html?view=demand&item=${encodeURIComponent(demand.demandId)}`;
        if (
          demand.status === "Requested" &&
          demand.approverResourceId === user.resourceId &&
          demand.requestorResourceId !== user.resourceId
        )
          add({
            id: stableId(["demand-approval", demand.demandId, demand.status]),
            category: "approval",
            severity: demand.priority === "Critical" ? "critical" : "high",
            title: "Resource demand awaiting your approval",
            detail: `${demand.roleSkill || "Resource request"} · ${projectLabel(demand.projectCode)}`,
            meta: `${demand.allocationMethod === "Hours" ? `${Number(demand.hours || 0)} hours` : `${Number(demand.allocationPercentage || 0)}% allocation`} · starts ${formatDate(demand.startDate)}`,
            href,
            projectCode: demand.projectCode,
            entityId: demand.demandId,
            eventDate: demand.updatedAt || demand.createdAt
          });
        if (
          ["Confirmed", "Rejected"].includes(demand.status) &&
          demand.requestorResourceId === user.resourceId &&
          isRecent(demand.updatedAt, 30)
        )
          add({
            id: stableId(["demand-outcome", demand.demandId, demand.status, demand.updatedAt]),
            category: "update",
            severity: demand.status === "Rejected" ? "high" : "info",
            title: `Resource demand ${demand.status.toLowerCase()}`,
            detail: `${demand.roleSkill || demand.demandId} · ${projectLabel(demand.projectCode)}`,
            meta: demand.notes || "The resource request has been updated",
            href,
            projectCode: demand.projectCode,
            entityId: demand.demandId,
            eventDate: demand.updatedAt
          });
        const startDays = daysUntil(demand.startDate);
        const currentTeam = normalise(user.team);
        const demandTeam = normalise(demand.team || resourceMap.get(demand.resourceId)?.team);
        const managerForTeam =
          PPMAuth.holdsPermission(user, "resources.manageTeam") &&
          currentTeam &&
          demandTeam === currentTeam;
        if (
          !demand.resourceId &&
          ["Critical", "High"].includes(demand.priority) &&
          ["Proposed", "Requested", "Provisionally assigned"].includes(demand.status) &&
          startDays !== null &&
          startDays <= 14 &&
          (projectDeliveryOwner(projectMap.get(demand.projectCode), user) || managerForTeam)
        )
          add({
            id: stableId(["unfilled-demand", demand.demandId, demand.startDate, demand.status]),
            category: "due",
            severity: demand.priority === "Critical" || startDays < 0 ? "critical" : "high",
            title: "Urgent resource demand remains unfilled",
            detail: `${demand.roleSkill || demand.demandId} · ${projectLabel(demand.projectCode)}`,
            meta: `${dueLabel(demand.startDate).replace("Due", "Starts")} · ${demand.priority} priority`,
            href,
            projectCode: demand.projectCode,
            entityId: demand.demandId,
            dueDate: demand.startDate
          });
      });
      /* Whoever manages a team, whatever else they are. */
      if (PPMAuth.holdsPermission(user, "resources.manageTeam") && user.team)
        rows("resourceAbsence").forEach((absence) => {
          const person = resourceMap.get(absence.resourceId);
          if (absence.status !== "Proposed" || normalise(person?.team) !== normalise(user.team)) return;
          add({
            id: stableId(["absence-review", absence.absenceId, absence.status, absence.startDate]),
            category: "approval",
            severity:
              daysUntil(absence.startDate) !== null && daysUntil(absence.startDate) <= 3 ? "high" : "normal",
            title: "Team absence needs review",
            detail: `${person?.fullName || absence.resourceId} · ${absence.type || "Absence"}`,
            meta: `${formatDate(absence.startDate)} to ${formatDate(absence.endDate)}`,
            href: `resource-management.html?view=availability&item=${encodeURIComponent(absence.absenceId)}`,
            entityId: absence.absenceId,
            dueDate: absence.startDate
          });
        });
    }

    // Programme-level milestones and RAID items assigned directly to the user.
    if (PPMAuth.can("programmes.view")) {
      const programmes = raw("programmes", []);
      const programmeMap = new Map(
        (Array.isArray(programmes) ? programmes : []).map((programme) => [programme.programmeId, programme])
      );
      rows("programmeRaid").forEach((raid) => {
        if (!assignedTo(raid, "owner", user) || CLOSED_RAID_STATUSES.has(raid.status)) return;
        const days = daysUntil(raid.targetDate);
        if (days === null || days > 0) return;
        const programme = programmeMap.get(raid.programmeId);
        add({
          id: stableId(["programme-raid", raid.recordId, raid.targetDate]),
          category: "due",
          severity: raid.priority === "Critical" || days < -7 ? "critical" : "high",
          title: days < 0 ? "Programme RAID item is overdue" : "Programme RAID item is due today",
          detail: `${raid.title || raid.recordId} · ${programme?.name || raid.programmeId}`,
          meta: dueLabel(raid.targetDate),
          href: `programme.html?programme=${encodeURIComponent(raid.programmeId)}&item=${encodeURIComponent(raid.recordId)}`,
          entityId: raid.recordId,
          dueDate: raid.targetDate
        });
      });
      rows("programmeMilestones").forEach((milestone) => {
        if (
          !assignedTo(milestone, "owner", user) ||
          Number(milestone.percentageComplete || 0) >= 100 ||
          milestone.status === "Complete"
        )
          return;
        const due = milestone.forecastDate || milestone.baselineDate;
        const days = daysUntil(due);
        if (days === null || days > 0) return;
        const programme = programmeMap.get(milestone.programmeId);
        add({
          id: stableId(["programme-milestone", milestone.recordId, due]),
          category: "due",
          severity: days < -7 ? "critical" : "high",
          title: days < 0 ? "Programme milestone is overdue" : "Programme milestone is due today",
          detail: `${milestone.title || milestone.recordId} · ${programme?.name || milestone.programmeId}`,
          meta: dueLabel(due),
          href: `programme.html?programme=${encodeURIComponent(milestone.programmeId)}&item=${encodeURIComponent(milestone.recordId)}`,
          entityId: milestone.recordId,
          dueDate: due
        });
      });
    }

    return notifications
      .sort((a, b) => {
        const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (severity) return severity;
        const aDue = a.dueDate
          ? dateValue(a.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER;
        const bDue = b.dueDate
          ? dateValue(b.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER;
        if (aDue !== bDue) return aDue - bDue;
        return String(b.eventDate || "").localeCompare(String(a.eventDate || ""));
      })
      .slice(0, 100);
  }

  function getNotifications() {
    const user = window.PPMAuth?.getCurrentUser?.();
    if (!user) return [];
    const rawProjects = raw("projects", []);
    const projects = PPMAuth.filterProjects(Array.isArray(rawProjects) ? rawProjects : []);
    const projectMap = new Map(projects.map((project) => [project.projectCode, project]));
    return notificationBuilder(user, new Set(projectMap.keys()), projectMap);
  }

  function isRead(id) {
    const user = PPMAuth.getCurrentUser();
    return Boolean(user && stateFor(user.resourceId).read[id]);
  }
  function setRead(id, value) {
    const user = PPMAuth.getCurrentUser();
    if (!user) return;
    const state = stateFor(user.resourceId);
    if (value) state.read[id] = new Date().toISOString();
    else delete state.read[id];
    saveState(user.resourceId, state);
    render();
  }
  function markAllRead() {
    const user = PPMAuth.getCurrentUser();
    if (!user) return;
    const state = stateFor(user.resourceId);
    const now = new Date().toISOString();
    items.forEach((item) => {
      state.read[item.id] = now;
    });
    saveState(user.resourceId, state);
    render();
  }
  function categoryLabel(category) {
    return { approval: "Approval", due: "Due / overdue", update: "Update" }[category] || "Notification";
  }

  function render() {
    if (!bellButton || !panel) return;
    const user = PPMAuth.getCurrentUser();
    if (!user) return;
    const state = stateFor(user.resourceId);
    const unread = items.filter((item) => !state.read[item.id]);
    const badge = bellButton.querySelector(".ppm-notification-badge");
    badge.textContent = unread.length > 99 ? "99+" : String(unread.length);
    badge.hidden = unread.length === 0;
    bellButton.setAttribute(
      "aria-label",
      unread.length ? `Notifications, ${unread.length} unread` : "Notifications, none unread"
    );
    const header = panel.querySelector(".ppm-notification-summary");
    header.textContent = `${unread.length} unread · ${items.length} total`;
    panel.querySelector(".ppm-notification-mark-all").disabled = unread.length === 0;
    const counts = { all: items.length, approval: 0, due: 0, update: 0 };
    items.forEach((item) => {
      counts[item.category] = (counts[item.category] || 0) + 1;
    });
    panel.querySelectorAll("[data-notification-filter]").forEach((button) => {
      const filter = button.dataset.notificationFilter;
      button.classList.toggle("active", filter === activeFilter);
      button.setAttribute("aria-pressed", String(filter === activeFilter));
      button.querySelector("span").textContent = counts[filter] || 0;
    });
    const visible = activeFilter === "all" ? items : items.filter((item) => item.category === activeFilter);
    const list = panel.querySelector(".ppm-notification-list");
    list.innerHTML = visible.length
      ? visible
          .map((item) => {
            const read = Boolean(state.read[item.id]);
            return `<article class="ppm-notification-item ${read ? "read" : "unread"} severity-${escapeHtml(item.severity)}" data-notification-id="${escapeHtml(item.id)}">
        <button class="ppm-notification-open" type="button" data-open-notification="${escapeHtml(item.id)}">
          <span class="ppm-notification-kind">${escapeHtml(categoryLabel(item.category))}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="ppm-notification-detail">${escapeHtml(item.detail)}</span>
          <span class="ppm-notification-meta">${escapeHtml(item.meta || (item.dueDate ? dueLabel(item.dueDate) : "Open item"))}</span>
        </button>
        <button class="ppm-notification-read-toggle" type="button" data-toggle-notification="${escapeHtml(item.id)}" aria-label="Mark ${escapeHtml(item.title)} as ${read ? "unread" : "read"}">${read ? "Mark unread" : "Mark read"}</button>
      </article>`;
          })
          .join("")
      : `<div class="ppm-notification-empty"><strong>${items.length ? "No notifications in this view" : "You're all caught up"}</strong><span>${items.length ? "Choose another filter to see your other notifications." : "There are no approvals, overdue items or updates requiring your attention."}</span></div>`;
  }

  function refresh() {
    items = getNotifications();
    render();
    window.dispatchEvent(
      new CustomEvent("ppm-notifications-refreshed", {
        detail: { total: items.length, unread: items.filter((item) => !isRead(item.id)).length }
      })
    );
    return items;
  }

  function openPanel(force) {
    if (!panel || !bellButton) return;
    const opening = force === undefined ? panel.hidden : Boolean(force);
    if (opening) refresh();
    panel.hidden = !opening;
    bellButton.setAttribute("aria-expanded", String(opening));
    if (opening) panel.querySelector(".ppm-notification-close").focus({ preventScroll: true });
  }

  function inject() {
    const sessionBar = document.querySelector(".ppm-session-bar");
    if (!sessionBar || sessionBar.querySelector(".ppm-notification-centre")) return false;
    const centre = document.createElement("div");
    centre.className = "ppm-notification-centre";
    centre.innerHTML = `<button class="ppm-notification-bell" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="Notifications">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>
      <span class="ppm-notification-badge" hidden>0</span>
    </button>
    <section class="ppm-notification-panel" role="dialog" aria-label="Notifications" hidden>
      <div class="ppm-notification-panel-head"><div><h2>Notifications</h2><p class="ppm-notification-summary">0 unread · 0 total</p></div><button class="ppm-notification-close" type="button" aria-label="Close notifications">×</button></div>
      <div class="ppm-notification-tools"><div class="ppm-notification-filters" role="group" aria-label="Filter notifications">
        <button type="button" class="active" data-notification-filter="all" aria-pressed="true">All <span>0</span></button>
        <button type="button" data-notification-filter="approval" aria-pressed="false">Approvals <span>0</span></button>
        <button type="button" data-notification-filter="due" aria-pressed="false">Due <span>0</span></button>
        <button type="button" data-notification-filter="update" aria-pressed="false">Updates <span>0</span></button>
      </div><button class="ppm-notification-mark-all" type="button">Mark all read</button></div>
      <div class="ppm-notification-list" aria-live="polite"></div>
    </section>`;
    const signOut = sessionBar.querySelector(".ppm-session-button");
    sessionBar.insertBefore(centre, signOut || null);
    bellButton = centre.querySelector(".ppm-notification-bell");
    panel = centre.querySelector(".ppm-notification-panel");
    bellButton.addEventListener("click", () => openPanel());
    panel.querySelector(".ppm-notification-close").addEventListener("click", () => openPanel(false));
    panel.querySelector(".ppm-notification-mark-all").addEventListener("click", markAllRead);
    panel.addEventListener("click", (event) => {
      const filter = event.target.closest("[data-notification-filter]");
      if (filter) {
        activeFilter = filter.dataset.notificationFilter;
        render();
        return;
      }
      const toggle = event.target.closest("[data-toggle-notification]");
      if (toggle) {
        setRead(toggle.dataset.toggleNotification, !isRead(toggle.dataset.toggleNotification));
        return;
      }
      const open = event.target.closest("[data-open-notification]");
      if (!open) return;
      const item = items.find((row) => row.id === open.dataset.openNotification);
      if (!item) return;
      setRead(item.id, true);
      window.location.href = item.href;
    });
    document.addEventListener("click", (event) => {
      if (!panel.hidden && !centre.contains(event.target)) openPanel(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) openPanel(false);
    });
    refresh();
    return true;
  }

  async function initialise() {
    if (!window.PPMAuth?.getCurrentUser?.()) return;
    const hydration = [];
    if (window.PPMDatabase?.ready) hydration.push(PPMDatabase.ready);
    if (window.PPMChildDatabase?.ready) hydration.push(PPMChildDatabase.ready);
    if (hydration.length) await Promise.allSettled(hydration);
    if (!inject()) {
      const observer = new MutationObserver(() => {
        if (inject()) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 5000);
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
    /* "storage" fires when another tab writes localStorage. Notifications are built from
       PPMStore now, which no tab writes, so this cannot fire for portfolio data - it is kept
       only because the dismissed-notification state below genuinely does live in localStorage
       and is worth picking up from a second tab. */
    window.addEventListener("storage", refresh);
    setInterval(refresh, 60000);
  }

  window.PPMNotifications = { getNotifications, refresh, markAllRead, setRead, isRead };
  document.addEventListener("DOMContentLoaded", () => {
    initialise().catch((error) => console.error("PPM notifications initialisation failed.", error));
  });
})();
