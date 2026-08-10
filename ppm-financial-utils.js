(function () {
  "use strict";

  const KEYS = {
    summaries: "ppmProjectFinancials",
    entries: "ppmFinancialEntries",
    categories: "ppmFinancialCategories",
    approvals: "ppmFinancialApprovalRequests"
  };

  const DEFAULT_CATEGORIES = [
    ["CAT-0001", "Internal resource", "Internal people and delivery effort"],
    ["CAT-0002", "External resource", "Contractors and temporary resource"],
    ["CAT-0003", "Supplier", "Third-party supplier costs"],
    ["CAT-0004", "Software", "Licences, subscriptions and software services"],
    ["CAT-0005", "Infrastructure", "Technology and physical infrastructure"],
    ["CAT-0006", "Contingency", "Approved cost contingency"],
    ["CAT-0007", "Other", "Other approved project expenditure"]
  ].map(([categoryId, name, description]) => ({ categoryId, name, description, active: true, system: true }));

  const readJson = (key, fallback) => PPMCore.readJson(key, fallback);

  /*
    Stage 16: the one write seam. Was localStorage.setItem, which reached PostgreSQL only via the
    patched prototype and returned before the database had been asked anything.

    Financial entries and approval requests are objects keyed by project code rather than arrays.
    replaceAll works from the collection's own registered shape, so this does not need to know
    that, and cannot get it wrong.
  */
  async function writeJson(key, value) {
    if (!window.PPMStore) {
      return {
        ok: false,
        reason: "failed",
        message: "The data layer is not loaded on this page, so nothing was saved.",
        queued: false,
        value
      };
    }
    const collection = window.PPMStore.collectionFor(key);
    if (!collection) {
      return { ok: false, reason: "invalid", message: `No collection is registered for "${key}".`, queued: false, value };
    }
    const result = await window.PPMStore.replaceAll(collection, value);
    return { ...result, value };
  }
  const numeric = PPMCore.numeric;
  function round(value) {
    return Math.round((numeric(value) + Number.EPSILON) * 100) / 100;
  }
  const isoToday = PPMCore.todayIso;
  function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  function flatten(store) {
    if (Array.isArray(store)) return store.filter(Boolean);
    if (!store || typeof store !== "object") return [];
    return Object.entries(store).flatMap(([projectCode, rows]) =>
      Array.isArray(rows) ? rows.map((row) => ({ ...row, projectCode: row.projectCode || projectCode })) : []
    );
  }

  function group(rows) {
    return (Array.isArray(rows) ? rows : []).reduce((store, row) => {
      const projectCode = String(row.projectCode || "").trim();
      if (!projectCode) return store;
      if (!store[projectCode]) store[projectCode] = [];
      store[projectCode].push(row);
      return store;
    }, {});
  }

  /*
    Stage 16: derives, never writes.

    It used to persist the default categories on first read and again whenever a default was
    missing - a getter that writes, and one that would have had to become asynchronous, taking
    its callers with it. backfillCategories() below is the write half, called once.
  */
  function getCategories() {
    const stored = readJson(KEYS.categories, []);
    if (!Array.isArray(stored) || !stored.length) return DEFAULT_CATEGORIES.map((item) => ({ ...item }));
    const names = new Set(stored.map((item) => String(item.name || "").toLowerCase()));
    return [...stored, ...DEFAULT_CATEGORIES.filter((item) => !names.has(item.name.toLowerCase()))];
  }

  /* The write half: make the derived defaults permanent. Call it once, where it matters. */
  async function backfillCategories() {
    const stored = readJson(KEYS.categories, []);
    const derived = getCategories();
    if (Array.isArray(stored) && stored.length === derived.length) {
      return { ok: true, saved: 0, nothingToDo: true };
    }
    return writeJson(KEYS.categories, derived);
  }

  async function saveCategories(categories) {
    const rows = (Array.isArray(categories) ? categories : [])
      .map((category) => ({
        categoryId: category.categoryId || uid("CAT"),
        name: String(category.name || "").trim(),
        description: String(category.description || "").trim(),
        active: category.active !== false,
        system: Boolean(category.system)
      }))
      .filter((category) => category.name);
    return writeJson(KEYS.categories, rows);
    return rows;
  }

  function getEntries(projectCode) {
    return flatten(readJson(KEYS.entries, {})).filter(
      (row) => !projectCode || row.projectCode === projectCode
    );
  }

  async function saveEntries(projectCode, entries) {
    const all = flatten(readJson(KEYS.entries, {})).filter((row) => row.projectCode !== projectCode);
    const now = new Date().toISOString();
    const rows = (Array.isArray(entries) ? entries : []).map((row) => ({
      ...row,
      financialEntryId: row.financialEntryId || uid("FLE"),
      projectCode,
      categoryId: String(row.categoryId || ""),
      categoryName: String(row.categoryName || ""),
      description: String(row.description || ""),
      financialPeriod: String(row.financialPeriod || ""),
      budgetAmount: round(row.budgetAmount),
      forecastCost: round(row.forecastCost),
      actualCost: round(row.actualCost),
      committedCost: round(row.committedCost),
      remainingForecast: round(Math.max(numeric(row.forecastCost) - numeric(row.actualCost), 0)),
      notes: String(row.notes || ""),
      createdAt: row.createdAt || now,
      updatedAt: now
    }));
    return writeJson(KEYS.entries, group([...all, ...rows]));
    return rows;
  }

  function calculations(entries, approvedBudget) {
    const rows = Array.isArray(entries) ? entries : [];
    const proposedBudget = round(rows.reduce((sum, row) => sum + numeric(row.budgetAmount), 0));
    const forecastCost = round(rows.reduce((sum, row) => sum + numeric(row.forecastCost), 0));
    const actualCost = round(rows.reduce((sum, row) => sum + numeric(row.actualCost), 0));
    const committedCost = round(rows.reduce((sum, row) => sum + numeric(row.committedCost), 0));
    const remainingForecast = round(
      rows.reduce((sum, row) => sum + Math.max(numeric(row.forecastCost) - numeric(row.actualCost), 0), 0)
    );
    const estimateAtCompletion = round(actualCost + remainingForecast);
    const approved = round(approvedBudget);
    const budgetVariance = round(approved - estimateAtCompletion);
    const budgetVariancePercentage = approved === 0 ? 0 : round((budgetVariance / approved) * 100);
    const contingency = round(
      rows
        .filter((row) => String(row.categoryName || "").toLowerCase() === "contingency")
        .reduce((sum, row) => sum + numeric(row.forecastCost), 0)
    );
    return {
      proposedBudget,
      approvedBudget: approved,
      forecastCost,
      actualCost,
      committedCost,
      remainingForecast,
      contingency,
      estimateAtCompletion,
      budgetVariance,
      budgetVariancePercentage,
      budgetVariancePercentageAvailable: approved !== 0
    };
  }

  function getSummaries() {
    return flatten(readJson(KEYS.summaries, {}));
  }
  function getSummary(projectCode) {
    return getSummaries().find((row) => row.projectCode === projectCode) || null;
  }

  async function saveSummary(summary) {
    const rows = getSummaries().filter((row) => row.projectCode !== summary.projectCode);
    rows.push(summary);
    return writeJson(KEYS.summaries, group(rows));
    return summary;
  }

  function financialRag(calculated, currentRag) {
    if (!calculated.approvedBudget)
      return currentRag && currentRag !== "Not Assessed" ? currentRag : "Not Assessed";
    if (calculated.budgetVariance < 0) return "Red";
    if (calculated.budgetVariancePercentage < 5) return "Amber";
    return "Green";
  }

  async function syncSummary(projectCode, metadata) {
    const existing = getSummary(projectCode) || {};
    const totals = calculations(getEntries(projectCode), existing.approvedBudget);
    const now = new Date().toISOString();
    const summary = {
      ...existing,
      ...totals,
      financialId: existing.financialId || uid("FIN"),
      projectCode,
      currency: "GBP",
      fundingSource: metadata?.fundingSource ?? existing.fundingSource ?? "",
      financialOwner: metadata?.financialOwner ?? existing.financialOwner ?? "",
      financialOwnerResourceId: metadata?.financialOwnerResourceId ?? existing.financialOwnerResourceId ?? "",
      financialOwnerEmail: metadata?.financialOwnerEmail ?? existing.financialOwnerEmail ?? "",
      financialCommentary: metadata?.financialCommentary ?? existing.financialCommentary ?? "",
      financialRag: metadata?.financialRag || financialRag(totals, existing.financialRag),
      budgetApprovalStatus:
        existing.budgetApprovalStatus || (existing.approvedBudget ? "Approved" : "No approved budget"),
      approvedBudgetVersion: numeric(existing.approvedBudgetVersion),
      lastFinancialUpdateDate: isoToday(),
      createdAt: existing.createdAt || now,
      updatedAt: now,
      budget: totals.approvedBudget,
      forecast: totals.forecastCost,
      actual: totals.actualCost,
      commitments: totals.committedCost,
      variance: totals.budgetVariance,
      lastUpdated: isoToday()
    };
    return saveSummary(summary);
  }

  function getApprovals(projectCode) {
    return flatten(readJson(KEYS.approvals, {})).filter(
      (row) => !projectCode || row.projectCode === projectCode
    );
  }

  async function saveApprovals(rows) {
    return writeJson(KEYS.approvals, group(rows));
  }

  function databaseFinancialWorkflowEnabled() {
    /* Stage 17: was stage11CReady(), retired in Stage 14 and silently false ever since. */
    return Boolean(window.PPMChildDatabase?.workflowReady?.("financial"));
  }

  async function requestApproval(projectCode, request) {
    if (databaseFinancialWorkflowEnabled())
      throw new Error("Budget approval requests must be submitted through the Stage 11C database workflow.");
    const approvals = getApprovals();
    if (approvals.some((item) => item.projectCode === projectCode && item.status === "Pending Approval"))
      throw new Error("This project already has a budget request awaiting a decision.");
    if (!request.requesterResourceId || !request.approverResourceId)
      throw new Error("Select both a requester and an approver.");
    if (request.requesterResourceId === request.approverResourceId)
      throw new Error("The budget approver must be different from the requester.");
    const summary = getSummary(projectCode) || syncSummary(projectCode, {});
    const proposedBudget = calculations(getEntries(projectCode), summary.approvedBudget).proposedBudget;
    if (!getEntries(projectCode).length || proposedBudget <= 0)
      throw new Error("Add and save at least one positive budget line before requesting approval.");
    if (!String(request.reason || "").trim())
      throw new Error("Record the reason and impact for the budget request.");
    const now = new Date().toISOString();
    const approval = {
      approvalId: uid("FAP"),
      projectCode,
      requestType: summary.approvedBudgetVersion ? "Budget Change" : "Initial Budget",
      currentApprovedBudget: numeric(summary.approvedBudget),
      proposedBudget,
      changeAmount: round(proposedBudget - numeric(summary.approvedBudget)),
      changePercentage:
        numeric(summary.approvedBudget) === 0
          ? 0
          : round(
              ((proposedBudget - numeric(summary.approvedBudget)) / numeric(summary.approvedBudget)) * 100
            ),
      reason: String(request.reason || "").trim(),
      requesterResourceId: request.requesterResourceId,
      requesterName: request.requesterName || "",
      requesterEmail: request.requesterEmail || "",
      approverResourceId: request.approverResourceId,
      approverName: request.approverName || "",
      approverEmail: request.approverEmail || "",
      status: "Pending Approval",
      requestedAt: now,
      decisionAt: "",
      decisionByResourceId: "",
      decisionByName: "",
      decisionComments: "",
      budgetSnapshot: getEntries(projectCode).map((row) => ({
        financialEntryId: row.financialEntryId,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        description: row.description,
        budgetAmount: numeric(row.budgetAmount)
      })),
      createdAt: now,
      updatedAt: now
    };
    approvals.push(approval);
    saveApprovals(approvals);
    saveSummary({
      ...summary,
      budgetApprovalStatus: "Pending Approval",
      approvedBudgetRequestId: approval.approvalId,
      updatedAt: now
    });

    return approval;
  }

  async function decideApproval(approvalId, decision) {
    if (databaseFinancialWorkflowEnabled())
      throw new Error("Budget approval decisions must be recorded through the Stage 11C database workflow.");
    const approvals = getApprovals();
    const approval = approvals.find((item) => item.approvalId === approvalId);
    if (!approval) throw new Error("The budget approval request could not be found.");
    if (approval.status !== "Pending Approval")
      throw new Error("Only pending budget requests can be decided.");
    if (!decision.decisionByResourceId || decision.decisionByResourceId !== approval.approverResourceId)
      throw new Error("The decision must be recorded by the assigned approver.");
    if (!decision.comments || !String(decision.comments).trim())
      throw new Error("Record the approval or rejection comments.");
    const status = decision.status === "Approved" ? "Approved" : "Rejected";
    const now = new Date().toISOString();
    approval.status = status;
    approval.decisionAt = now;
    approval.decisionByResourceId = decision.decisionByResourceId;
    approval.decisionByName = decision.decisionByName || approval.approverName;
    approval.decisionComments = String(decision.comments).trim();
    approval.updatedAt = now;
    saveApprovals(approvals);
    const current = getSummary(approval.projectCode) || syncSummary(approval.projectCode, {});
    const next =
      status === "Approved"
        ? {
            ...current,
            approvedBudget: numeric(approval.proposedBudget),
            budgetApprovalStatus: "Approved",
            approvedBudgetVersion: numeric(current.approvedBudgetVersion) + 1,
            approvedBudgetRequestId: approval.approvalId,
            approvedAt: now,
            approvedByResourceId: decision.decisionByResourceId,
            approvedBy: approval.decisionByName,
            updatedAt: now
          }
        : {
            ...current,
            budgetApprovalStatus: "Rejected",
            approvedBudgetRequestId: approval.approvalId,
            updatedAt: now
          };
    saveSummary(next);
    syncSummary(approval.projectCode, {});

    return approval;
  }

  function money(value) {
    return numeric(value).toLocaleString("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  window.PPMFinancial = {
    keys: KEYS,
    defaultCategories: DEFAULT_CATEGORIES,
    readJson,
    getCategories,
    saveCategories,
    backfillCategories,
    getEntries,
    saveEntries,
    calculations,
    getSummaries,
    getSummary,
    syncSummary,
    getApprovals,
    databaseFinancialWorkflowEnabled,
    requestApproval,
    decideApproval,
    numeric,
    money,
    isoToday,
    uid
  };
})();
