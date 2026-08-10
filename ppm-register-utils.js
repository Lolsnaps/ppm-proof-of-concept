(function () {
  "use strict";

  const REGISTER_SCHEMAS = {
    actions: {
      label: "Actions",
      singular: "action",
      storageKey: "ppmProjectActions",
      idField: "actionId",
      idPrefix: "ACT",
      statusField: "status",
      fields: [
        field("actionId", "Action ID", "id", 118),
        field("projectCode", "Project ID", "project", 170, true),
        field("description", "Action", "textarea", 250, true),
        field("source", "Source", "text", 160, true),
        field("owner", "Owner", "person", 190, true),
        field("supportingOwners", "Supporting owners", "text", 190),
        field("dateRaised", "Date raised", "date", 140, true),
        field("dueDate", "Due date", "date", 140, true),
        field("priority", "Priority", "select", 130, true, ["Low", "Medium", "High", "Critical"]),
        field("status", "Status", "select", 145, true, [
          "Open",
          "In Progress",
          "Blocked",
          "Complete",
          "Closed"
        ]),
        field("completionDate", "Completion date", "date", 150),
        field("completionCommentary", "Completion commentary", "textarea", 230),
        field("evidence", "Evidence / link", "text", 220),
        field("escalationStatus", "Escalation", "select", 170, false, [
          "Not Escalated",
          "Escalation Required",
          "Escalated",
          "PMO Review Required"
        ]),
        field("relatedRecords", "Related RAID, milestone, gate or meeting", "text", 250)
      ],
      defaults: { priority: "Medium", status: "Open", escalationStatus: "Not Escalated" }
    },
    decisions: {
      label: "Decisions",
      singular: "decision",
      storageKey: "ppmProjectDecisions",
      idField: "decisionId",
      idPrefix: "DEC",
      statusField: "status",
      fields: [
        field("decisionId", "Decision ID", "id", 125),
        field("projectCode", "Project ID", "project", 170, true),
        field("decisionRequired", "Decision required", "textarea", 250, true),
        field("background", "Background", "textarea", 240, true),
        field("optionsConsidered", "Options considered", "textarea", 240),
        field("recommendation", "Recommendation", "textarea", 230),
        field("decisionOwner", "Decision owner", "person", 190, true),
        field("requiredByDate", "Required by", "date", 145, true),
        field("status", "Status", "select", 150, true, [
          "Required",
          "Under Review",
          "Approved",
          "Rejected",
          "Deferred",
          "Closed"
        ]),
        field("finalDecision", "Final decision", "textarea", 230),
        field("decisionDate", "Decision date", "date", 145),
        field("rationale", "Rationale", "textarea", 220),
        field("conditions", "Conditions", "textarea", 200),
        field("impact", "Impact", "textarea", 220),
        field("relatedRecords", "Related project records", "text", 230),
        field("supportingEvidence", "Supporting evidence", "text", 220)
      ],
      defaults: { status: "Required" }
    },
    financials: {
      label: "Financials",
      singular: "financial record",
      storageKey: "ppmProjectFinancials",
      idField: "financialId",
      idPrefix: "FIN",
      statusField: "financialRag",
      uniqueProject: true,
      fields: [
        field("financialId", "Financial ID", "id", 120),
        field("projectCode", "Project ID", "project", 170, true),
        field("approvedBudget", "Approved budget", "calculated", 145, true),
        field("forecastCost", "Forecast cost", "calculated", 140),
        field("actualCost", "Actual cost", "calculated", 135),
        field("committedCost", "Committed cost", "calculated", 145),
        field("remainingForecast", "Remaining forecast", "calculated", 160),
        field("contingency", "Contingency", "calculated", 130),
        field("estimateAtCompletion", "Estimate at completion", "calculated", 175),
        field("budgetVariance", "Budget variance", "calculated", 150),
        field("budgetVariancePercentage", "Variance %", "calculated", 125),
        field("fundingSource", "Funding source", "text", 175),
        field("financialOwner", "Financial owner", "person", 190, true),
        field("financialRag", "Financial RAG", "select", 145, true, [
          "Not Assessed",
          "Green",
          "Amber",
          "Red"
        ]),
        field("financialCommentary", "Financial commentary", "textarea", 260),
        field("lastFinancialUpdateDate", "Last financial update", "date", 165, true)
      ],
      defaults: {
        approvedBudget: 0,
        forecastCost: 0,
        actualCost: 0,
        committedCost: 0,
        remainingForecast: 0,
        contingency: 0,
        financialRag: "Not Assessed"
      }
    },
    benefits: {
      label: "Benefits",
      singular: "benefit",
      storageKey: "ppmProjectBenefits",
      idField: "benefitId",
      idPrefix: "BEN",
      statusField: "status",
      fields: [
        field("benefitId", "Benefit ID", "id", 120),
        field("linkLevel", "Benefit level", "select", 145, true, ["Project", "Programme"]),
        field("programmeId", "Programme ID", "text", 155),
        field("projectCode", "Project ID", "project", 170),
        field("description", "Benefit", "textarea", 250, true),
        field("benefitType", "Benefit type", "text", 165, true),
        field("owner", "Owner", "person", 190, true),
        field("baselineValue", "Baseline value", "text", 145),
        field("targetValue", "Target value", "text", 145, true),
        field("measurementUnit", "Unit", "text", 130),
        field("measurementMethod", "Measurement method", "textarea", 210),
        field("dataSource", "Data source", "text", 180),
        field("targetRealisationDate", "Target realisation", "date", 165, true),
        field("leadIndicators", "Lead indicators", "textarea", 210),
        field("currentValue", "Current value", "text", 145),
        field("status", "Status", "select", 165, true, [
          "Proposed",
          "Approved",
          "In delivery",
          "Partially realised",
          "Realised",
          "Not realised",
          "No longer applicable"
        ]),
        field("realisationConfidence", "Confidence", "select", 145, false, [
          "Not Assessed",
          "High",
          "Medium",
          "Low"
        ]),
        field("reviewFrequency", "Review frequency", "select", 155, false, [
          "Monthly",
          "Quarterly",
          "Six-monthly",
          "Annually"
        ]),
        field("lastReviewDate", "Last review", "date", 145),
        field("nextReviewDate", "Next review", "date", 145),
        field("commentary", "Commentary", "textarea", 230),
        field("evidence", "Evidence", "text", 210)
      ],
      defaults: {
        linkLevel: "Project",
        status: "Proposed",
        realisationConfidence: "Not Assessed",
        reviewFrequency: "Quarterly"
      }
    },
    documents: {
      label: "Documents",
      singular: "document link",
      storageKey: "ppmProjectDocuments",
      idField: "documentId",
      idPrefix: "DOC",
      statusField: "status",
      fields: [
        field("documentId", "Document ID", "id", 120),
        field("projectCode", "Project ID", "project", 170, true),
        field("documentType", "Document type", "select", 190, true, [
          "Business Case",
          "Project Profile",
          "Requirements",
          "Solution Design",
          "Project Plan",
          "RAID Log",
          "Stage-Gate Pack",
          "Status Report",
          "Test Evidence",
          "Operational Readiness",
          "Implementation Plan",
          "Approvals",
          "Closure Report",
          "Lessons Learned",
          "Other"
        ]),
        field("title", "Title", "text", 240, true),
        field("version", "Version", "text", 105),
        field("owner", "Owner", "person", 190, true),
        field("status", "Status", "select", 145, false, [
          "Draft",
          "In Review",
          "Approved",
          "Superseded",
          "Archived"
        ]),
        field("link", "Repository link", "url", 280, true),
        field("linkedDate", "Linked date", "date", 145, true),
        field("approvalStatus", "Approval status", "select", 155, false, [
          "Not Required",
          "Pending",
          "Approved",
          "Rejected"
        ]),
        field("approvedVersion", "Approved version", "text", 145),
        field("reviewDate", "Review date", "date", 145),
        field("classification", "Classification", "select", 160, false, [
          "Internal",
          "Confidential",
          "Highly Confidential"
        ]),
        field("notes", "Notes", "textarea", 220)
      ],
      defaults: { status: "Draft", approvalStatus: "Pending", classification: "Internal" }
    },
    statusReports: {
      label: "Status Reports",
      singular: "status report",
      storageKey: "ppmStatusReports",
      idField: "reportId",
      idPrefix: "STS",
      statusField: "status",
      fields: [
        field("reportId", "Report ID", "id", 120),
        field("projectCode", "Project ID", "project", 170, true),
        field("reportingPeriodId", "Period ID", "text", 155),
        field("reportingPeriod", "Reporting period", "text", 160, true),
        field("overallStatus", "Overall status", "select", 145, true, [
          "Not Assessed",
          "Green",
          "Amber",
          "Red"
        ]),
        field("scheduleRag", "Schedule RAG", "select", 140, false, ["Not Assessed", "Green", "Amber", "Red"]),
        field("resourceRag", "Resource RAG", "select", 140, false, ["Not Assessed", "Green", "Amber", "Red"]),
        field("financialRag", "Financial RAG", "select", 140, false, [
          "Not Assessed",
          "Green",
          "Amber",
          "Red"
        ]),
        field("scopeRag", "Scope RAG", "select", 130, false, ["Not Assessed", "Green", "Amber", "Red"]),
        field("benefitRag", "Benefits RAG", "select", 140, false, ["Not Assessed", "Green", "Amber", "Red"]),
        field("riskRag", "Risk RAG", "select", 130, false, ["Not Assessed", "Green", "Amber", "Red"]),
        field("qualityRag", "Quality RAG", "select", 135, false, ["Not Assessed", "Green", "Amber", "Red"]),
        field("operationalReadinessRag", "Readiness RAG", "select", 155, false, [
          "Not Assessed",
          "Green",
          "Amber",
          "Red"
        ]),
        field("executiveSummary", "Executive summary", "textarea", 280, true),
        field("progressThisPeriod", "Progress this period", "textarea", 250),
        field("plannedNextPeriod", "Planned next period", "textarea", 250),
        field("completedMilestones", "Completed milestones", "textarea", 240),
        field("upcomingMilestones", "Upcoming / overdue milestones", "textarea", 260),
        field("tasksBehindPlan", "Tasks behind plan", "textarea", 250),
        field("risksAndIssues", "Risks and issues", "textarea", 250),
        field("decisionsRequired", "Decisions required", "textarea", 240),
        field("dependencies", "Dependencies", "textarea", 230),
        field("resourcePosition", "Resource position", "textarea", 230),
        field("financialPosition", "Financial position", "textarea", 230),
        field("scopeChanges", "Scope changes", "textarea", 220),
        field("benefitsUpdate", "Benefits update", "textarea", 230),
        field("returnToGreenActions", "Return-to-green actions", "textarea", 250),
        field("sponsorComments", "Sponsor / approver comments", "textarea", 250),
        field("status", "Workflow status", "select", 150, true, [
          "Draft",
          "Submitted",
          "Returned",
          "Approved",
          "Locked"
        ]),
        field("version", "Version", "calculated", 95),
        field("dueDate", "Due date", "date", 140),
        field("submittedDate", "Submitted date", "date", 145),
        field("approvedDate", "Approved date", "date", 145)
      ],
      defaults: {
        overallStatus: "Not Assessed",
        scheduleRag: "Not Assessed",
        resourceRag: "Not Assessed",
        financialRag: "Not Assessed",
        scopeRag: "Not Assessed",
        benefitRag: "Not Assessed",
        riskRag: "Not Assessed",
        qualityRag: "Not Assessed",
        operationalReadinessRag: "Not Assessed",
        status: "Draft",
        version: 1
      }
    }
  };

  function field(key, label, type, width, required, options) {
    return { key, label, type, width, required: Boolean(required), options: options || [] };
  }

  const readJson = (key, fallback) => PPMCore.readJson(key, fallback);

  function flattenStore(store) {
    if (Array.isArray(store)) return store.filter(Boolean);
    if (!store || typeof store !== "object") return [];
    return Object.entries(store).flatMap(([storageGroup, rows]) =>
      Array.isArray(rows)
        ? rows.filter(Boolean).map((row) => ({
            ...row,
            projectCode:
              row.projectCode ||
              row.projectId ||
              (/^(programme:|__)/i.test(storageGroup) ? "" : storageGroup),
            programmeId:
              row.programmeId || (storageGroup.startsWith("programme:") ? storageGroup.slice(10) : "")
          }))
        : []
    );
  }

  function readRecords(type) {
    const schema = REGISTER_SCHEMAS[type];
    return schema
      ? flattenStore(readJson(schema.storageKey, {})).map((record) => prepareRecord(type, record))
      : [];
  }

  async function writeRecords(type, records) {
    const schema = REGISTER_SCHEMAS[type];
    const store = {};
    records.forEach((source) => {
      const record = prepareRecord(type, source);
      const projectCode = String(record.projectCode || "").trim();
      const programmeId = String(record.programmeId || "").trim();
      const storageGroup =
        projectCode || (type === "benefits" && programmeId ? `programme:${programmeId}` : "");
      if (!storageGroup) return;
      if (!Array.isArray(store[storageGroup])) store[storageGroup] = [];
      store[storageGroup].push(record);
    });
    /*
      Stage 16: the one write seam.

      The store this builds is keyed by project code - or by "programme:<id>" for a benefit that
      belongs to a programme rather than a project - and replaceAll writes it from the
      collection's own registered shape, so the grouping above stays the single definition of
      where a record belongs.
    */
    if (!window.PPMStore) {
      return {
        ok: false,
        reason: "failed",
        message: "The data layer is not loaded on this page, so nothing was saved.",
        queued: false
      };
    }
    const collection = window.PPMStore.collectionFor(schema.storageKey);
    if (!collection) {
      return {
        ok: false,
        reason: "invalid",
        message: `No collection is registered for "${schema.storageKey}".`,
        queued: false
      };
    }
    return window.PPMStore.replaceAll(collection, store);
  }

  function generateId(type, records) {
    const schema = REGISTER_SCHEMAS[type];
    const maximum = records.reduce((current, record) => {
      const match = String(record[schema.idField] || "").match(
        new RegExp(`^${schema.idPrefix}-(\\d+)$`, "i")
      );
      return match ? Math.max(current, Number(match[1])) : current;
    }, 0);
    return `${schema.idPrefix}-${String(maximum + 1).padStart(4, "0")}`;
  }

  const isoToday = PPMCore.todayIso;

  function monthLabel() {
    return new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }

  function reportingPeriodForProject(project) {
    if (!window.PPMAdmin) return null;
    const portfolio = PPMAdmin.findPortfolio(project?.portfolioId || project?.portfolio);
    const calendars = PPMAdmin.getReportingCalendars();
    const calendarId = project?.reportingCalendarId || portfolio?.reportingCalendarId;
    const calendar =
      calendars.find((row) => row.calendarId === calendarId) ||
      calendars.find((row) => row.isDefault && row.active !== false) ||
      calendars.find((row) => row.active !== false);
    if (!calendar) return null;
    const periods = PPMAdmin.ensureReportingPeriods(calendar, { count: 12, audit: false });
    const today = isoToday();
    return (
      periods.find((period) => period.startDate <= today && period.endDate >= today) ||
      periods.find((period) => period.endDate >= today) ||
      periods[periods.length - 1] ||
      null
    );
  }

  function newRecord(type, records, projectCode) {
    const schema = REGISTER_SCHEMAS[type];
    const now = new Date().toISOString();
    const base = {
      ...schema.defaults,
      [schema.idField]: generateId(type, records),
      projectCode: projectCode || "",
      createdAt: now,
      updatedAt: now
    };
    if (type === "actions") base.dateRaised = isoToday();
    if (type === "documents") base.linkedDate = isoToday();
    if (type === "financials") base.lastFinancialUpdateDate = isoToday();
    if (type === "statusReports") return buildStatusReport(projectCode, records, base);
    return prepareRecord(type, base);
  }

  function prepareRecord(type, source) {
    const record = { ...(source || {}) };
    if (type === "financials") {
      record.approvedBudget = numeric(record.approvedBudget ?? record.budget);
      record.forecastCost = numeric(record.forecastCost ?? record.forecast);
      record.actualCost = numeric(record.actualCost ?? record.actual);
      record.committedCost = numeric(record.committedCost);
      record.remainingForecast = numeric(record.remainingForecast);
      record.contingency = numeric(record.contingency);
      record.estimateAtCompletion = roundMoney(record.actualCost + record.remainingForecast);
      record.budgetVariance = roundMoney(record.approvedBudget - record.estimateAtCompletion);
      record.budgetVariancePercentage = record.approvedBudget
        ? roundNumber((record.budgetVariance / record.approvedBudget) * 100, 1)
        : 0;
      record.budget = record.approvedBudget;
      record.forecast = record.forecastCost;
      record.actual = record.actualCost;
      record.variance = record.budgetVariance;
      record.lastUpdated = record.lastFinancialUpdateDate || record.lastUpdated || "";
    }
    if (type === "benefits") {
      record.linkLevel =
        record.linkLevel || (record.projectCode || record.projectId ? "Project" : "Programme");
      record.benefitType = record.benefitType || record.type || "";
      record.targetValue = record.targetValue ?? record.target ?? "";
      record.target = record.targetValue;
      record.targetRealisationDate = record.targetRealisationDate || record.realisationDate || "";
      record.realisationDate = record.targetRealisationDate;
    }
    if (type === "documents") {
      record.documentType = record.documentType || record.type || "";
      record.title = record.title || record.name || "";
      record.link = record.link || record.url || "";
      record.type = record.documentType;
      record.name = record.title;
      record.url = record.link;
    }
    if (type === "statusReports") record.version = Math.max(1, Number(record.version) || 1);
    return record;
  }

  const numeric = PPMCore.numeric;

  function roundMoney(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
  function roundNumber(value, places) {
    const factor = 10 ** places;
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function projectStoreRows(key, projectCode) {
    return flattenStore(readJson(key, {})).filter(
      (row) =>
        String(row.projectCode || row.projectId || "").toLowerCase() ===
        String(projectCode || "").toLowerCase()
    );
  }

  function joinedTitles(rows, getter, emptyText) {
    const values = rows.map(getter).filter(Boolean);
    return values.length ? values.join("; ") : emptyText;
  }

  function taskBehind(task) {
    if (Number(task.percentageComplete) >= 100 || ["Complete", "Cancelled"].includes(task.status))
      return false;
    return Boolean(
      (task.baselineEndDate && task.forecastEndDate && task.forecastEndDate > task.baselineEndDate) ||
      (task.forecastEndDate && task.forecastEndDate < isoToday())
    );
  }

  function buildStatusReport(projectCode, records, base) {
    const projects = readJson("ppmProjects", []);
    const project = Array.isArray(projects)
      ? projects.find(
          (item) => String(item.projectCode).toLowerCase() === String(projectCode || "").toLowerCase()
        )
      : null;
    const planStore = readJson("ppmProjectPlans", {});
    const tasks = Array.isArray(planStore[projectCode]) ? planStore[projectCode] : [];
    const milestones = projectStoreRows("ppmProjectMilestones", projectCode);
    const raid = projectStoreRows("ppmProjectRaid", projectCode);
    const decisions = projectStoreRows("ppmProjectDecisions", projectCode).filter(
      (item) => !["Approved", "Rejected", "Closed"].includes(item.status)
    );
    const financial = projectStoreRows("ppmProjectFinancials", projectCode)[0];
    const benefits = readRecords("benefits").filter(
      (item) =>
        String(item.projectCode || "").toLowerCase() === String(projectCode || "").toLowerCase() ||
        (!item.projectCode && item.programmeId && item.programmeId === project?.programmeId)
    );
    const completedMilestones = milestones.filter(
      (item) => Number(item.percentageComplete) >= 100 || item.status === "Complete"
    );
    const upcomingMilestones = milestones.filter((item) => !completedMilestones.includes(item));
    const behindTasks = tasks.filter(taskBehind);
    const openRaid = raid.filter((item) => String(item.status || "").toLowerCase() !== "closed");
    const reportingPeriod = reportingPeriodForProject(project);
    const report = {
      ...base,
      reportingPeriodId: reportingPeriod?.periodId || "",
      reportingPeriod: reportingPeriod?.name || monthLabel(),
      dueDate: reportingPeriod?.submissionDueDate || base.dueDate || "",
      overallStatus: project?.overallRag || "Not Assessed",
      scheduleRag: project?.scheduleRag || "Not Assessed",
      resourceRag: project?.resourceRag || "Not Assessed",
      financialRag: project?.financialRag || financial?.financialRag || "Not Assessed",
      scopeRag: project?.scopeRag || "Not Assessed",
      benefitRag: project?.benefitRag || "Not Assessed",
      riskRag: project?.riskRag || "Not Assessed",
      qualityRag: project?.qualityRag || "Not Assessed",
      operationalReadinessRag: project?.operationalReadinessRag || "Not Assessed",
      executiveSummary: project?.currentPosition || project?.statusSummary || "",
      progressThisPeriod: project?.progressThisPeriod || "",
      plannedNextPeriod: project?.plannedNextPeriod || "",
      completedMilestones: joinedTitles(
        completedMilestones,
        (item) => item.milestoneName,
        "No milestones completed in this period."
      ),
      upcomingMilestones: joinedTitles(
        upcomingMilestones,
        (item) =>
          `${item.milestoneName || "Milestone"}${item.forecastFinishDate ? ` (${item.forecastFinishDate})` : ""}`,
        "No upcoming milestones recorded."
      ),
      tasksBehindPlan: joinedTitles(behindTasks, (item) => item.taskName, "No tasks behind plan."),
      risksAndIssues: joinedTitles(
        openRaid.filter((item) => ["Risk", "Issue"].includes(item.type)),
        (item) => `${item.raidId || "RAID"}: ${item.title || "Untitled"}`,
        "No open risks or issues."
      ),
      decisionsRequired: joinedTitles(
        decisions,
        (item) => item.decisionRequired || item.title,
        "No decisions currently required."
      ),
      dependencies: joinedTitles(
        openRaid.filter((item) => item.type === "Dependency"),
        (item) => item.title,
        "No open dependencies."
      ),
      resourcePosition:
        project?.resourcePosition ||
        project?.resourceCommentary ||
        "Review current assignments in Resource Management.",
      financialPosition: financial
        ? `${financial.financialRag || "Not Assessed"} - ${financial.financialCommentary || "No commentary supplied."}`
        : "No financial record has been supplied.",
      scopeChanges: project?.scopeChanges || "No scope changes recorded.",
      benefitsUpdate: benefits.length
        ? joinedTitles(
            benefits,
            (item) => `${item.description || "Benefit"}: ${item.status || "Not assessed"}`,
            ""
          )
        : "No benefit records have been supplied.",
      returnToGreenActions: project?.returnToGreenActions || "",
      sponsorComments: "",
      prepopulatedAt: new Date().toISOString(),
      reviewed: false
    };
    return prepareRecord("statusReports", report);
  }

  function reviseStatusReport(record, records) {
    const now = new Date().toISOString();
    return {
      ...record,
      reportId: generateId("statusReports", records),
      status: "Draft",
      version: Math.max(1, Number(record.version) || 1) + 1,
      submittedDate: "",
      approvedDate: "",
      revisedFromReportId: record.reportId,
      createdAt: now,
      updatedAt: now
    };
  }

  window.PPMRegisters = {
    schemas: REGISTER_SCHEMAS,
    readJson,
    flattenStore,
    readRecords,
    writeRecords,
    newRecord,
    prepareRecord,
    reviseStatusReport,
    isoToday
  };
})();
