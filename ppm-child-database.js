/*
  Foresters Portfolio — Stage 11E
  Child collection adapter plus transactional stage-gate, baseline, financial and resource-scenario workflow cutovers, and append-only recorded status history

  NON-DISRUPTIVE BY DESIGN:
    - no collection is cut over automatically;
    - localStorage is never hydrated on load;
    - no Storage prototype is patched here;
    - no database call is made until a PPMChildDatabase method is called.

  The 18 Stage 9 tables share one generic read/map/compare/seed layer. Stage 10B proved the cutover path with milestones and Stage 10C extended it
  to low-risk child collections. Stage 11A adds Actions, Decisions and Stage Gates
  plus an RPC-backed atomic governance workflow commit. Stage 11B adds approved
  plan baselines and rebaseline requests behind a second transactional RPC.
  Stage 11C adds project financial summaries, cost-plan entries and budget
  approval requests behind a third transaction boundary. Stage 11D adds resource
  demand and cross-project resource scenarios, with scenario publication/rejection
  committed atomically in PostgreSQL.

  Stage 11E adds recorded project status history, which is the first collection
  here that is NOT editable business data. It is append-only: the generic
  write-through path below would issue an UPDATE for a changed payload and a
  soft delete for a vanished key, so recorded status routes through
  appendOnlySync() instead, which inserts new snapshots and refuses anything that
  would rewrite history. See APPEND_ONLY_MODULES.

  Load immediately after ppm-database.js, without defer/async/type=module.
*/
(function () {
  "use strict";

  const DATABASE = "database";
  // Reuse the Stage 6 pending-write log so one diagnostic shows every database write that failed.
  const PENDING_KEY = "ppmDatabasePending";
  const MAX_PENDING = 100;

  /*
    Collections a single workflow transaction spans.

    These were the migration batches, and they are kept because the grouping is
    still real: committing a stage gate touches actions, decisions and stage gates
    together, so all three have to be flushed before the transaction runs. The
    names now say what the group is for rather than which stage moved it.
  */
  const STAGE_GATE_WORKFLOW_MODULES = Object.freeze(["actions", "decisions", "stageGates"]);
  const BASELINE_WORKFLOW_MODULES = Object.freeze(["planBaselines", "baselineRequests"]);
  const FINANCIAL_WORKFLOW_MODULES = Object.freeze([
    "financials",
    "financialEntries",
    "financialApprovals"
  ]);
  const RESOURCE_WORKFLOW_MODULES = Object.freeze(["resourceDemand", "resourceScenarios"]);

  /*
    Recorded project status history. Its database posture forbids UPDATE and
    DELETE, so it takes the append-only write path rather than the generic one.
  */
  const APPEND_ONLY_MODULES = new Set(["ragHistory"]);

  /*
    Every collection the database owns - which, after the Stage 14 cleanup, is every
    collection except legacyAudit. legacyAudit is read-only historical data from
    before the migration and has no write path at all.
  */
  const DATABASE_MODULES = new Set([
    "milestones",
    "plans",
    "raid",
    "benefits",
    "documents",
    "statusReports",
    ...STAGE_GATE_WORKFLOW_MODULES,
    ...BASELINE_WORKFLOW_MODULES,
    ...FINANCIAL_WORKFLOW_MODULES,
    ...RESOURCE_WORKFLOW_MODULES,
    "ragHistory",
    "programmeMilestones",
    "programmeRaid",
    "lifecycleTemplates",
    "lifecycleRules",
    "referenceData",
    "reportingCalendars",
    "reportingPeriods",
    "ragConfig",
    "financialCategories",
    "resourceAbsence",
    "resourceConfig",
    "resourceGanttViews",
    "reportViews",
    "searchViews"
  ]);
  const SINGLETON_KEY = "GLOBAL";
  /* Read-only historical audit rows recorded before the migration. */
  const READ_ONLY_MODULES = Object.freeze(["legacyAudit"]);
  const baseline = new Map();
  let writeThroughInstalled = false;
  let hydrated = false;
  const ADAPTER_FIELDS = new Set([
    "databaseId",
    "databaseVersion",
    "recordSource",
    "__storageGroup",
    "__projectCode",
    "__programmeCode"
  ]);

  const MODULES = {
  "plans": {
    "localKey": "ppmProjectPlans",
    "table": "project_plans",
    "shape": "object",
    "idField": "taskId",
    "projectField": "",
    "readOnly": false,
    "fields": [
      {
        "column": "phase",
        "type": "text",
        "field": "phase"
      },
      {
        "column": "task_name",
        "type": "text",
        "field": "taskName"
      },
      {
        "column": "task_owner",
        "type": "text",
        "field": "taskOwner"
      },
      {
        "column": "task_owner_resource_id",
        "type": "text",
        "field": "taskOwnerResourceId"
      },
      {
        "column": "task_owner_email",
        "type": "text",
        "field": "taskOwnerEmail"
      },
      {
        "column": "duration_days",
        "type": "numeric",
        "field": "durationDays"
      },
      {
        "column": "allocation_percentage",
        "type": "numeric",
        "field": "allocationPercentage"
      },
      {
        "column": "baseline_start_date",
        "type": "date",
        "field": "baselineStartDate"
      },
      {
        "column": "baseline_end_date",
        "type": "date",
        "field": "baselineEndDate"
      },
      {
        "column": "forecast_start_date",
        "type": "date",
        "field": "forecastStartDate"
      },
      {
        "column": "forecast_end_date",
        "type": "date",
        "field": "forecastEndDate"
      },
      {
        "column": "status",
        "type": "text",
        "field": "status"
      },
      {
        "column": "percentage_complete",
        "type": "numeric",
        "field": "percentageComplete"
      },
      {
        "column": "reason_for_slippage",
        "type": "text",
        "field": "reasonForSlippage"
      },
      {
        "column": "return_to_green",
        "type": "text",
        "field": "returnToGreen"
      },
      {
        "column": "notes",
        "type": "text",
        "field": "notes"
      },
      {
        "column": "task_type",
        "type": "text",
        "field": "taskType"
      },
      {
        "column": "parent_task_id",
        "type": "text",
        "field": "parentTaskId"
      },
      {
        "column": "deliverable",
        "type": "text",
        "field": "deliverable"
      },
      {
        "column": "supporting_contributor_ids",
        "type": "jsonb",
        "field": "supportingContributorIds"
      },
      {
        "column": "priority",
        "type": "text",
        "field": "priority"
      },
      {
        "column": "actual_start_date",
        "type": "text",
        "field": "actualStartDate"
      },
      {
        "column": "actual_end_date",
        "type": "text",
        "field": "actualEndDate"
      },
      {
        "column": "estimated_effort_hours",
        "type": "numeric",
        "field": "estimatedEffortHours"
      },
      {
        "column": "remaining_effort_hours",
        "type": "numeric",
        "field": "remainingEffortHours"
      },
      {
        "column": "dependencies",
        "type": "jsonb",
        "field": "dependencies"
      },
      {
        "column": "critical_path",
        "type": "boolean",
        "field": "criticalPath"
      },
      {
        "column": "slippage_impact",
        "type": "text",
        "field": "slippageImpact"
      },
      {
        "column": "recovery_not_possible",
        "type": "boolean",
        "field": "recoveryNotPossible"
      },
      {
        "column": "mandatory",
        "type": "boolean",
        "field": "mandatory"
      }
    ]
  },
  "milestones": {
    "localKey": "ppmProjectMilestones",
    "table": "project_milestones",
    "shape": "object",
    "idField": "milestoneId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": [
      {
        "column": "milestone_name",
        "type": "text",
        "field": "milestoneName"
      },
      {
        "column": "milestone_type",
        "type": "text",
        "field": "milestoneType"
      },
      {
        "column": "percentage_complete",
        "type": "numeric",
        "field": "percentageComplete"
      },
      {
        "column": "baseline_start_date",
        "type": "date",
        "field": "baselineStartDate"
      },
      {
        "column": "baseline_finish_date",
        "type": "date",
        "field": "baselineFinishDate"
      },
      {
        "column": "forecast_start_date",
        "type": "date",
        "field": "forecastStartDate"
      },
      {
        "column": "forecast_finish_date",
        "type": "date",
        "field": "forecastFinishDate"
      },
      {
        "column": "notes",
        "type": "text",
        "field": "notes"
      },
      {
        "column": "status",
        "type": "text",
        "field": "status"
      },
      {
        "column": "status_updated_at",
        "type": "timestamptz",
        "field": "statusUpdatedAt"
      }
    ]
  },
  "raid": {
    "localKey": "ppmProjectRaid",
    "table": "project_raid",
    "shape": "object",
    "idField": "raidId",
    "projectField": "projectId",
    "readOnly": false,
    "fields": [
      {
        "column": "type",
        "type": "text",
        "field": "type"
      },
      {
        "column": "title",
        "type": "text",
        "field": "title"
      },
      {
        "column": "status",
        "type": "text",
        "field": "status"
      },
      {
        "column": "description",
        "type": "text",
        "field": "description"
      },
      {
        "column": "owner",
        "type": "text",
        "field": "owner"
      },
      {
        "column": "raised_by",
        "type": "text",
        "field": "raisedBy"
      },
      {
        "column": "date_raised",
        "type": "date",
        "field": "dateRaised"
      },
      {
        "column": "target_date",
        "type": "date",
        "field": "targetDate"
      },
      {
        "column": "priority",
        "type": "text",
        "field": "priority"
      },
      {
        "column": "escalation_status",
        "type": "text",
        "field": "escalationStatus"
      },
      {
        "column": "last_reviewed_date",
        "type": "date",
        "field": "lastReviewedDate"
      },
      {
        "column": "related_tasks",
        "type": "text",
        "field": "relatedTasks"
      },
      {
        "column": "related_actions",
        "type": "text",
        "field": "relatedActions"
      },
      {
        "column": "attachments",
        "type": "text",
        "field": "attachments"
      },
      {
        "column": "comments",
        "type": "text",
        "field": "comments"
      },
      {
        "column": "date_closed",
        "type": "text",
        "field": "dateClosed"
      },
      {
        "column": "closure_evidence",
        "type": "text",
        "field": "closureEvidence"
      },
      {
        "column": "risk_cause",
        "type": "text",
        "field": "riskCause"
      },
      {
        "column": "risk_event",
        "type": "text",
        "field": "riskEvent"
      },
      {
        "column": "risk_effect",
        "type": "text",
        "field": "riskEffect"
      },
      {
        "column": "inherent_probability",
        "type": "text",
        "field": "inherentProbability"
      },
      {
        "column": "inherent_impact",
        "type": "text",
        "field": "inherentImpact"
      },
      {
        "column": "inherent_score",
        "type": "text",
        "field": "inherentScore"
      },
      {
        "column": "mitigation",
        "type": "text",
        "field": "mitigation"
      },
      {
        "column": "contingency",
        "type": "text",
        "field": "contingency"
      },
      {
        "column": "residual_probability",
        "type": "text",
        "field": "residualProbability"
      },
      {
        "column": "residual_impact",
        "type": "text",
        "field": "residualImpact"
      },
      {
        "column": "residual_score",
        "type": "text",
        "field": "residualScore"
      },
      {
        "column": "risk_appetite_position",
        "type": "text",
        "field": "riskAppetitePosition"
      },
      {
        "column": "escalation_threshold",
        "type": "text",
        "field": "escalationThreshold"
      },
      {
        "column": "risk_trend",
        "type": "text",
        "field": "riskTrend"
      },
      {
        "column": "review_frequency",
        "type": "text",
        "field": "reviewFrequency"
      },
      {
        "column": "date_identified",
        "type": "text",
        "field": "dateIdentified"
      },
      {
        "column": "business_impact",
        "type": "text",
        "field": "businessImpact"
      },
      {
        "column": "delivery_impact",
        "type": "text",
        "field": "deliveryImpact"
      },
      {
        "column": "root_cause",
        "type": "text",
        "field": "rootCause"
      },
      {
        "column": "resolution_plan",
        "type": "text",
        "field": "resolutionPlan"
      },
      {
        "column": "resolution_owner",
        "type": "text",
        "field": "resolutionOwner"
      },
      {
        "column": "expected_resolution_date",
        "type": "text",
        "field": "expectedResolutionDate"
      },
      {
        "column": "actual_resolution_date",
        "type": "text",
        "field": "actualResolutionDate"
      },
      {
        "column": "workaround",
        "type": "text",
        "field": "workaround"
      },
      {
        "column": "decision_required",
        "type": "text",
        "field": "decisionRequired"
      },
      {
        "column": "dependency_scope",
        "type": "text",
        "field": "dependencyScope"
      },
      {
        "column": "dependency_direction",
        "type": "text",
        "field": "dependencyDirection"
      },
      {
        "column": "provider",
        "type": "text",
        "field": "provider"
      },
      {
        "column": "recipient",
        "type": "text",
        "field": "recipient"
      },
      {
        "column": "required_by_date",
        "type": "text",
        "field": "requiredByDate"
      },
      {
        "column": "dependency_confidence",
        "type": "text",
        "field": "dependencyConfidence"
      },
      {
        "column": "impact_if_missed",
        "type": "text",
        "field": "impactIfMissed"
      },
      {
        "column": "related_project",
        "type": "text",
        "field": "relatedProject"
      },
      {
        "column": "related_milestone",
        "type": "text",
        "field": "relatedMilestone"
      },
      {
        "column": "acceptance_criteria",
        "type": "text",
        "field": "acceptanceCriteria"
      },
      {
        "column": "audit_history",
        "type": "jsonb",
        "field": "auditHistory"
      }
    ]
  },
  "actions": {
    "localKey": "ppmProjectActions",
    "table": "project_actions",
    "shape": "object",
    "idField": "actionId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": []
  },
  "decisions": {
    "localKey": "ppmProjectDecisions",
    "table": "project_decisions",
    "shape": "object",
    "idField": "decisionId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": [
      {
        "column": "status",
        "type": "text",
        "field": "status"
      },
      {
        "column": "decision_owner",
        "type": "text",
        "field": "decisionOwner"
      },
      {
        "column": "decision_owner_resource_id",
        "type": "text",
        "field": "decisionOwnerResourceId"
      },
      {
        "column": "decision_owner_email",
        "type": "text",
        "field": "decisionOwnerEmail"
      },
      {
        "column": "recommendation",
        "type": "text",
        "field": "recommendation"
      },
      {
        "column": "options_considered",
        "type": "text",
        "field": "optionsConsidered"
      },
      {
        "column": "background",
        "type": "text",
        "field": "background"
      },
      {
        "column": "decision_required",
        "type": "text",
        "field": "decisionRequired"
      },
      {
        "column": "required_by_date",
        "type": "date",
        "field": "requiredByDate"
      }
    ]
  },
  "financials": {
    "localKey": "ppmProjectFinancials",
    "table": "project_financials",
    "shape": "object",
    "idField": "financialId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": [
      {
        "column": "proposed_budget",
        "type": "numeric",
        "field": "proposedBudget"
      },
      {
        "column": "approved_budget",
        "type": "numeric",
        "field": "approvedBudget"
      },
      {
        "column": "forecast_cost",
        "type": "numeric",
        "field": "forecastCost"
      },
      {
        "column": "actual_cost",
        "type": "numeric",
        "field": "actualCost"
      },
      {
        "column": "committed_cost",
        "type": "numeric",
        "field": "committedCost"
      },
      {
        "column": "remaining_forecast",
        "type": "numeric",
        "field": "remainingForecast"
      },
      {
        "column": "contingency",
        "type": "numeric",
        "field": "contingency"
      },
      {
        "column": "estimate_at_completion",
        "type": "numeric",
        "field": "estimateAtCompletion"
      },
      {
        "column": "budget_variance",
        "type": "numeric",
        "field": "budgetVariance"
      },
      {
        "column": "budget_variance_percentage",
        "type": "numeric",
        "field": "budgetVariancePercentage"
      },
      {
        "column": "budget_variance_percentage_available",
        "type": "boolean",
        "field": "budgetVariancePercentageAvailable"
      },
      {
        "column": "currency",
        "type": "text",
        "field": "currency"
      },
      {
        "column": "funding_source",
        "type": "text",
        "field": "fundingSource"
      },
      {
        "column": "financial_owner",
        "type": "text",
        "field": "financialOwner"
      },
      {
        "column": "financial_owner_resource_id",
        "type": "text",
        "field": "financialOwnerResourceId"
      },
      {
        "column": "financial_owner_email",
        "type": "text",
        "field": "financialOwnerEmail"
      },
      {
        "column": "financial_commentary",
        "type": "text",
        "field": "financialCommentary"
      },
      {
        "column": "financial_rag",
        "type": "text",
        "field": "financialRag"
      },
      {
        "column": "budget_approval_status",
        "type": "text",
        "field": "budgetApprovalStatus"
      },
      {
        "column": "approved_budget_version",
        "type": "numeric",
        "field": "approvedBudgetVersion"
      },
      {
        "column": "last_financial_update_date",
        "type": "date",
        "field": "lastFinancialUpdateDate"
      },
      {
        "column": "approved_budget_request_id",
        "type": "text",
        "field": "approvedBudgetRequestId"
      },
      {
        "column": "approved_at",
        "type": "timestamptz",
        "field": "approvedAt"
      },
      {
        "column": "approved_by_resource_id",
        "type": "text",
        "field": "approvedByResourceId"
      },
      {
        "column": "approved_by",
        "type": "text",
        "field": "approvedBy"
      }
    ]
  },
  "benefits": {
    "localKey": "ppmProjectBenefits",
    "table": "project_benefits",
    "shape": "object",
    "idField": "benefitId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": []
  },
  "documents": {
    "localKey": "ppmProjectDocuments",
    "table": "project_documents",
    "shape": "object",
    "idField": "documentId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": []
  },
  "statusReports": {
    "localKey": "ppmStatusReports",
    "table": "status_reports",
    "shape": "object",
    "idField": "reportId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": []
  },
  "stageGates": {
    "localKey": "ppmStageGates",
    "table": "stage_gates",
    "shape": "object",
    "idField": "gateId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": []
  },
  "planBaselines": {
    "localKey": "ppmPlanBaselines",
    "table": "plan_baselines",
    "shape": "object",
    "idField": "baselineId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": [
      {
        "column": "record_version",
        "type": "numeric",
        "field": "version"
      },
      {
        "column": "status",
        "type": "text",
        "field": "status"
      },
      {
        "column": "reason",
        "type": "text",
        "field": "reason"
      },
      {
        "column": "impact",
        "type": "text",
        "field": "impact"
      },
      {
        "column": "approved_by",
        "type": "text",
        "field": "approvedBy"
      },
      {
        "column": "approved_by_resource_id",
        "type": "text",
        "field": "approvedByResourceId"
      },
      {
        "column": "approval_date",
        "type": "date",
        "field": "approvalDate"
      },
      {
        "column": "approved_at",
        "type": "timestamptz",
        "field": "approvedAt"
      },
      {
        "column": "task_baselines",
        "type": "jsonb",
        "field": "taskBaselines"
      }
    ]
  },
  "baselineRequests": {
    "localKey": "ppmPlanBaselineRequests",
    "table": "plan_baseline_requests",
    "shape": "object",
    "idField": "requestId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": [
      {
        "column": "status",
        "type": "text",
        "field": "status"
      },
      {
        "column": "existing_baseline",
        "type": "jsonb",
        "field": "existingBaseline"
      },
      {
        "column": "proposed_baseline",
        "type": "jsonb",
        "field": "proposedBaseline"
      },
      {
        "column": "reason",
        "type": "text",
        "field": "reason"
      },
      {
        "column": "impact",
        "type": "text",
        "field": "impact"
      },
      {
        "column": "requested_by",
        "type": "text",
        "field": "requestedBy"
      },
      {
        "column": "requested_by_resource_id",
        "type": "text",
        "field": "requestedByResourceId"
      }
    ]
  },
  /*
    Stage 11E. appendOnly routes writes through appendOnlySync() instead of the
    generic diff, and sortBy restores chronology after hydration: PostgREST makes
    no ordering promise, but recorded status history is read as a sequence.
  */
  "ragHistory": {
    "localKey": "ppmRagHistory",
    "table": "rag_history",
    "shape": "object",
    "idField": "statusId",
    "projectField": "projectCode",
    "readOnly": false,
    "appendOnly": true,
    "sortBy": "recordedAt",
    "sortColumn": "recorded_at",
    "fields": [
      {
        "column": "recorded_at",
        "type": "timestamptz",
        "field": "recordedAt"
      },
      {
        "column": "recorded_by",
        "type": "text",
        "field": "recordedBy"
      },
      {
        "column": "dimensions",
        "type": "jsonb",
        "field": "dimensions"
      }
    ]
  },
  "financialEntries": {
    "localKey": "ppmFinancialEntries",
    "table": "financial_entries",
    "shape": "object",
    "idField": "financialEntryId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": [
      {
        "column": "category_id",
        "type": "text",
        "field": "categoryId"
      },
      {
        "column": "category_name",
        "type": "text",
        "field": "categoryName"
      },
      {
        "column": "description",
        "type": "text",
        "field": "description"
      },
      {
        "column": "financial_period",
        "type": "text",
        "field": "financialPeriod"
      },
      {
        "column": "budget_amount",
        "type": "numeric",
        "field": "budgetAmount"
      },
      {
        "column": "forecast_cost",
        "type": "numeric",
        "field": "forecastCost"
      },
      {
        "column": "actual_cost",
        "type": "numeric",
        "field": "actualCost"
      },
      {
        "column": "committed_cost",
        "type": "numeric",
        "field": "committedCost"
      },
      {
        "column": "remaining_forecast",
        "type": "numeric",
        "field": "remainingForecast"
      },
      {
        "column": "notes",
        "type": "text",
        "field": "notes"
      }
    ]
  },
  "financialApprovals": {
    "localKey": "ppmFinancialApprovalRequests",
    "table": "financial_approval_requests",
    "shape": "object",
    "idField": "approvalId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": [
      {
        "column": "request_type",
        "type": "text",
        "field": "requestType"
      },
      {
        "column": "current_approved_budget",
        "type": "numeric",
        "field": "currentApprovedBudget"
      },
      {
        "column": "proposed_budget",
        "type": "numeric",
        "field": "proposedBudget"
      },
      {
        "column": "change_amount",
        "type": "numeric",
        "field": "changeAmount"
      },
      {
        "column": "change_percentage",
        "type": "numeric",
        "field": "changePercentage"
      },
      {
        "column": "reason",
        "type": "text",
        "field": "reason"
      },
      {
        "column": "requester_resource_id",
        "type": "text",
        "field": "requesterResourceId"
      },
      {
        "column": "requester_name",
        "type": "text",
        "field": "requesterName"
      },
      {
        "column": "requester_email",
        "type": "text",
        "field": "requesterEmail"
      },
      {
        "column": "approver_resource_id",
        "type": "text",
        "field": "approverResourceId"
      },
      {
        "column": "approver_name",
        "type": "text",
        "field": "approverName"
      },
      {
        "column": "approver_email",
        "type": "text",
        "field": "approverEmail"
      },
      {
        "column": "status",
        "type": "text",
        "field": "status"
      },
      {
        "column": "requested_at",
        "type": "timestamptz",
        "field": "requestedAt"
      },
      {
        "column": "decision_at",
        "type": "timestamptz",
        "field": "decisionAt"
      },
      {
        "column": "decision_by_resource_id",
        "type": "text",
        "field": "decisionByResourceId"
      },
      {
        "column": "decision_by_name",
        "type": "text",
        "field": "decisionByName"
      },
      {
        "column": "decision_comments",
        "type": "text",
        "field": "decisionComments"
      },
      {
        "column": "budget_snapshot",
        "type": "jsonb",
        "field": "budgetSnapshot"
      }
    ]
  },
  "resourceDemand": {
    "localKey": "ppmResourceDemand",
    "table": "resource_demand",
    "shape": "array",
    "idField": "demandId",
    "projectField": "projectCode",
    "readOnly": false,
    "fields": []
  },
  "resourceScenarios": {
    "localKey": "ppmResourceScenarios",
    "table": "resource_scenarios",
    "shape": "array",
    "idField": "scenarioId",
    "projectField": "",
    "readOnly": false,
    "fields": []
  },
  "legacyAudit": {
    "localKey": "ppmAuditHistory",
    "table": "legacy_audit_history",
    "shape": "array",
    "idField": "auditId",
    "projectField": "projectCode",
    "readOnly": true,
    "fields": [
      {
        "column": "timestamp_value",
        "type": "timestamptz",
        "field": "timestamp"
      },
      {
        "column": "entity_type",
        "type": "text",
        "field": "entityType"
      },
      {
        "column": "entity_id",
        "type": "text",
        "field": "entityId"
      },
      {
        "column": "action",
        "type": "text",
        "field": "action"
      },
      {
        "column": "summary",
        "type": "text",
        "field": "summary"
      },
      {
        "column": "source_page",
        "type": "text",
        "field": "sourcePage"
      },
      {
        "column": "actor_name",
        "type": "text",
        "field": "actorName"
      },
      {
        "column": "actor_resource_id",
        "type": "text",
        "field": "actorResourceId"
      },
      {
        "column": "actor_email",
        "type": "text",
        "field": "actorEmail"
      },
      {
        "column": "actor_role",
        "type": "text",
        "field": "actorRole"
      },
      {
        "column": "status_from",
        "type": "text",
        "field": "statusFrom"
      },
      {
        "column": "status_to",
        "type": "text",
        "field": "statusTo"
      },
      {
        "column": "approval_status_from",
        "type": "text",
        "field": "approvalStatusFrom"
      },
      {
        "column": "approval_status_to",
        "type": "text",
        "field": "approvalStatusTo"
      },
      {
        "column": "approval_id",
        "type": "text",
        "field": "approvalId"
      },
      {
        "column": "changes",
        "type": "jsonb",
        "field": "changes"
      },
      {
        "column": "metadata",
        "type": "jsonb",
        "field": "metadata"
      },
      {
        "column": "location",
        "type": "text",
        "field": "location"
      }
    ]
  },

  /* ======================================================== Stage 12 stores

     Everything below was still browser-local after Stage 11E: programme-level
     business data, global administration configuration, resource-planning
     configuration and saved views.

     They differ from the Stage 9 child tables in one structural way. A Stage 9
     table is identified by (project_code, record_key) and scoped by
     private.can_access_project(). None of these are project data, so they use a
     single uniform `scope_key` column instead, and each table's RLS decides what
     that key means:

       scopeKind "programme"  scope_key is a programme code, checked with
                              private.can_access_programme_code()
       scopeKind "global"     scope_key is 'GLOBAL', or a configuration category
                              for reference data. Permission alone decides access;
                              there is nothing project-shaped to scope by.
       scopeKind "owner"      scope_key is 'GLOBAL' and the row also carries
                              owner_auth_user_id. You always see your own rows;
                              shared rows are visible to everyone with the read
                              permission and publishing one needs views.publish.

     One uniform column rather than four scope-specific ones is what keeps the
     generic mapper/hydrate/write-through path reusable instead of forking it per
     table. `scopeColumn` defaults to "project_code" everywhere above, so nothing
     already migrated changes behaviour.

     shape "singleton" is also new: rag config and resource config are single
     objects, not collections, so the whole store maps to one row keyed 'GLOBAL'.
  ========================================================================= */

  "programmeMilestones": {
    "localKey": "ppmProgrammeMilestones",
    "table": "programme_milestones",
    "shape": "object",
    "idField": "recordId",
    "projectField": "",
    "scopeKind": "programme",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  "programmeRaid": {
    "localKey": "ppmProgrammeRaid",
    "table": "programme_raid",
    "shape": "object",
    "idField": "recordId",
    "projectField": "",
    "scopeKind": "programme",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  "lifecycleTemplates": {
    "localKey": "ppmLifecycleTemplates",
    "table": "lifecycle_templates",
    "shape": "array",
    "idField": "templateId",
    "projectField": "",
    "scopeKind": "global",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  "lifecycleRules": {
    "localKey": "ppmLifecycleMandatoryRules",
    "table": "lifecycle_mandatory_rules",
    "shape": "array",
    "idField": "ruleId",
    "projectField": "",
    "scopeKind": "global",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  /* Object keyed by configuration category, so scope_key is the category name. */
  "referenceData": {
    "localKey": "ppmReferenceData",
    "table": "reference_data",
    "shape": "object",
    "idField": "referenceId",
    "projectField": "",
    "scopeKind": "global",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  "reportingCalendars": {
    "localKey": "ppmReportingCalendars",
    "table": "reporting_calendars",
    "shape": "array",
    "idField": "calendarId",
    "projectField": "",
    "scopeKind": "global",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  "reportingPeriods": {
    "localKey": "ppmReportingPeriods",
    "table": "reporting_periods",
    "shape": "array",
    "idField": "periodId",
    "projectField": "",
    "scopeKind": "global",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  "ragConfig": {
    "localKey": "ppmRagConfig",
    "table": "rag_config",
    "shape": "singleton",
    "idField": "",
    "projectField": "",
    "scopeKind": "global",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  "financialCategories": {
    "localKey": "ppmFinancialCategories",
    "table": "financial_categories",
    "shape": "array",
    "idField": "categoryId",
    "projectField": "",
    "scopeKind": "global",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  /*
    Absence is real business data about a person, not configuration. Ideally it
    would be scoped to the person and their team, but the resource directory is
    still browser-local, so there is no server-side person link to scope by yet.
    Until Stage 12A migrates public.people writes, resourceManagement.view/edit
    is the gate — the same gate the UI already applies. Tighten to person/team
    scope in 12A rather than inventing a half-link now.
  */
  "resourceAbsence": {
    "localKey": "ppmResourceAbsence",
    "table": "resource_absence",
    "shape": "array",
    "idField": "absenceId",
    "projectField": "",
    "scopeKind": "global",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  "resourceConfig": {
    "localKey": "ppmResourceConfig",
    "table": "resource_config",
    "shape": "singleton",
    "idField": "",
    "projectField": "",
    "scopeKind": "global",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": []
  },
  /*
    Saved views carry scope: "personal" | "shared". The application already tells
    the user a shared view was "published", and the permission model has always
    contained views.publish, so these cannot stay browser-only. ownerField marks
    them as owner-scoped: your own rows are always yours, shared rows are
    everyone's to read.
  */
  "resourceGanttViews": {
    "localKey": "ppmResourceGanttViews",
    "table": "resource_gantt_views",
    "shape": "array",
    "idField": "viewId",
    "projectField": "",
    "scopeKind": "owner",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": [
      {
        "column": "view_scope",
        "type": "text",
        "field": "scope"
      }
    ]
  },
  "reportViews": {
    "localKey": "ppmReportViews",
    "table": "report_views",
    "shape": "array",
    "idField": "viewId",
    "projectField": "",
    "scopeKind": "owner",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": [
      {
        "column": "view_scope",
        "type": "text",
        "field": "scope"
      }
    ]
  },
  "searchViews": {
    "localKey": "ppmSearchViews",
    "table": "search_views",
    "shape": "array",
    "idField": "viewId",
    "projectField": "",
    "scopeKind": "owner",
    "scopeColumn": "scope_key",
    "readOnly": false,
    "fields": [
      {
        "column": "view_scope",
        "type": "text",
        "field": "scope"
      }
    ]
  }
};

  function client() {
    return window.PPMSupabase || null;
  }

  function parseJson(value, fallback) {
    if (window.PPMCore && typeof PPMCore.parseJson === "function")
      return PPMCore.parseJson(value, fallback);
    try {
      const parsed = JSON.parse(value);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  /*
    Hands a hydrated collection to PPMStore, which is the only place it goes.

    These were rawRead and rawSet: a pair that reached localStorage past the project-scoping
    filter, so that hydration could fill the mirror without the filter merging back rows
    row-level security had already excluded. There is no mirror and no filter now.

    ppm-data.js loads after this file, so PPMStore does not exist while this module is being
    defined - but hydration is asynchronous and yields before it fetches anything, so it is
    there by the time there is a collection to hand over.
  */
  function adopt(moduleName, store) {
    if (window.PPMStore && typeof PPMStore.adopt === "function") return PPMStore.adopt(moduleName, store);
    console.error(
      `PPMChildDatabase: ppm-data.js is not loaded, so "${moduleName}" was fetched from the database ` +
        `and had nowhere to go. This page will show nothing.`
    );
    return false;
  }

  function held(moduleName) {
    return window.PPMStore && MODULES[moduleName] ? PPMStore[moduleName].read() : emptyStoreFor(moduleDefinition(moduleName));
  }

  function activeModules() {
    return [...DATABASE_MODULES];
  }

  function payloadOf(record) {
    const copy = { ...(record || {}) };
    ADAPTER_FIELDS.forEach((field) => delete copy[field]);
    return copy;
  }

  function stableStringify(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value))
      return "[" + value.map((item) => stableStringify(item) ?? "null").join(",") + "]";
    const parts = [];
    Object.keys(value)
      .sort()
      .forEach((key) => {
        const rendered = stableStringify(value[key]);
        if (rendered !== undefined) parts.push(JSON.stringify(key) + ":" + rendered);
      });
    return "{" + parts.join(",") + "}";
  }

  function sameValue(left, right) {
    if (left === right) return true;
    const absent = (v) => v === null || v === undefined;
    if (absent(left) && absent(right)) return true;
    if ((absent(left) || left === "") && (absent(right) || right === "")) return true;
    if (typeof left === "object" || typeof right === "object")
      return stableStringify(left) === stableStringify(right);
    if (
      typeof left === "string" &&
      typeof right === "string" &&
      /\d{4}-\d{2}-\d{2}T/.test(left) &&
      /\d{4}-\d{2}-\d{2}T/.test(right)
    ) {
      const a = new Date(left).getTime();
      const b = new Date(right).getTime();
      if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b;
    }
    return String(left) === String(right);
  }

  function toIsoZ(value) {
    if (typeof value !== "string" || !/\d{4}-\d{2}-\d{2}T/.test(value)) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  function typedValue(value, type) {
    if (value === undefined || value === null || value === "") return null;
    if (type === "numeric" || type.startsWith("numeric(")) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    if (type === "boolean") {
      if (typeof value === "boolean") return value;
      if (String(value).toLowerCase() === "true") return true;
      if (String(value).toLowerCase() === "false") return false;
      return null;
    }
    if (type === "jsonb") return value;
    if (type === "date" || type === "timestamptz") return value || null;
    return value;
  }

  function mappedValue(value, type, legacyValue) {
    if (value === null || value === undefined) return legacyValue;
    return type === "timestamptz" ? toIsoZ(value) : value;
  }

  function moduleDefinition(moduleName) {
    const definition = MODULES[moduleName];
    if (!definition)
      throw new Error(
        `Unknown child collection "${moduleName}". Expected one of: ${Object.keys(MODULES).join(", ")}.`
      );
    return definition;
  }

  function storageGroupFor(definition, record, fallbackGroup) {
    if (definition.localKey === "ppmProjectBenefits") {
      const linkLevel = String(record?.linkLevel || "").toLowerCase();
      const programmeId = String(record?.programmeId || "").trim();
      if ((linkLevel === "programme" || (!record?.projectCode && programmeId)) && programmeId)
        return `programme:${programmeId}`;
    }
    const explicit = String(
      record?.projectCode ||
        record?.projectId ||
        record?.__projectCode ||
        fallbackGroup ||
        ""
    ).trim();
    return explicit || (definition.shape === "object" ? "__UNSCOPED__" : "");
  }

  function projectCodeFor(definition, record, storageGroup) {
    if (definition.localKey === "ppmProjectBenefits") {
      const group = String(storageGroup || "");
      if (group.startsWith("programme:")) return "";
    }
    if (definition.localKey === "ppmResourceScenarios") return "";
    const explicit = definition.projectField
      ? String(record?.[definition.projectField] || "").trim()
      : "";
    if (explicit) return explicit;
    const group = String(storageGroup || "").trim();
    if (group && !group.startsWith("programme:") && !group.startsWith("__")) return group;
    return String(record?.projectCode || record?.projectId || "").trim();
  }

  function programmeCodeFor(definition, record, storageGroup) {
    if (definition.localKey !== "ppmProjectBenefits") return "";
    const group = String(storageGroup || "");
    if (group.startsWith("programme:")) return group.slice("programme:".length);
    const linkLevel = String(record?.linkLevel || "").toLowerCase();
    return linkLevel === "programme" ? String(record?.programmeId || "").trim() : "";
  }

  function recordKeyFor(definition, record) {
    if (definition.shape === "singleton") return SINGLETON_KEY;
    return String(record?.[definition.idField] || "").trim();
  }

  /* ------------------------------------------------------ Stage 12: scope_key

     Stage 9 tables are identified by (project_code, record_key). Stage 12 tables
     are identified by (scope_key, record_key), where scope_key means whatever that
     table's RLS says it means — a programme code, a configuration category, or the
     literal 'GLOBAL'.

     The value is already sitting in the flattened item's storageGroup, which is the
     localStorage container key. So this is a rename with intent rather than new
     bookkeeping: for a programme store the container key IS the programme code, and
     for reference data it IS the configuration category.
  --------------------------------------------------------------------------- */
  function usesScopeKey(definition) {
    return definition.scopeColumn === "scope_key";
  }

  /*
    The value to match on when updating or soft-deleting an existing row. Stage 9
    rows are found by project_code; Stage 12 rows by scope_key. Taken from the
    baseline snapshot, which holds what the database actually had, not from the
    edited record.
  */
  function scopeValueOf(definition, prior) {
    return usesScopeKey(definition) ? prior.scopeKey || SINGLETON_KEY : prior.projectCode;
  }

  function scopeKeyFor(definition, storageGroup) {
    if (!usesScopeKey(definition)) return "";
    if (definition.scopeKind === "programme" || definition.scopeKind === "global") {
      const group = String(storageGroup || "").trim();
      // An array or singleton store has no container key, so it is simply global.
      if (!group || group.startsWith("__")) return SINGLETON_KEY;
      return group;
    }
    // Owner-scoped views are not divided by anything; the owner column carries identity.
    return SINGLETON_KEY;
  }

  function flattenStore(moduleName, raw) {
    const definition = moduleDefinition(moduleName);
    const out = [];

    /*
      A singleton store is one configuration object, not a collection of records.
      It flattens to exactly one item so the whole generic diff/insert/update path
      applies unchanged — the record just happens to be the entire store.
      An empty object is treated as "no record yet" rather than as a blank row, so
      an untouched configuration key does not create a row that says nothing.
    */
    if (definition.shape === "singleton") {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Object.keys(raw).length) return out;
      out.push({
        record: raw,
        storageGroup: "",
        projectCode: "",
        programmeCode: "",
        scopeKey: SINGLETON_KEY,
        recordKey: SINGLETON_KEY
      });
      return out;
    }

    if (definition.shape === "array") {
      const rows = Array.isArray(raw) ? raw : [];
      rows.forEach((row) => {
        if (!row || typeof row !== "object") return;
        out.push({
          record: row,
          storageGroup: "",
          projectCode: projectCodeFor(definition, row, ""),
          programmeCode: programmeCodeFor(definition, row, ""),
          scopeKey: scopeKeyFor(definition, ""),
          recordKey: recordKeyFor(definition, row)
        });
      });
      return out;
    }

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.entries(raw).forEach(([group, rows]) => {
      if (!Array.isArray(rows)) return;
      rows.forEach((row) => {
        if (!row || typeof row !== "object") return;
        out.push({
          record: row,
          storageGroup: group,
          projectCode: projectCodeFor(definition, row, group),
          programmeCode: programmeCodeFor(definition, row, group),
          scopeKey: scopeKeyFor(definition, group),
          recordKey: recordKeyFor(definition, row)
        });
      });
    });
    return out;
  }

  function flattenLocal(moduleName) {
    return flattenStore(moduleName, held(moduleName));
  }

  function validateLocal(moduleName) {
    const definition = moduleDefinition(moduleName);
    const rows = flattenLocal(moduleName);
    const invalid = [];
    const seen = new Set();

    rows.forEach((item, index) => {
      const problems = [];
      if (!item.recordKey) problems.push(`missing ${definition.idField}`);

      const isProgrammeBenefit =
        definition.localKey === "ppmProjectBenefits" && Boolean(item.programmeCode);
      const isGlobalScenario = definition.localKey === "ppmResourceScenarios";
      const isLegacyAudit = definition.localKey === "ppmAuditHistory";

      /*
        Stage 12 tables are not project data, so demanding a project code would
        reject every valid row. What matters instead is that a scope key resolved:
        a programme store with no programme code has lost its container and would
        land in the wrong place.
      */
      if (usesScopeKey(definition)) {
        if (!item.scopeKey) problems.push("no scope key can be resolved");
        else if (definition.scopeKind === "programme" && item.scopeKey === SINGLETON_KEY)
          problems.push("programme record is not filed under a programme");
      } else if (!item.projectCode && !isProgrammeBenefit && !isGlobalScenario && !isLegacyAudit) {
        problems.push("no project code can be resolved");
      }

      if (isProgrammeBenefit && item.projectCode)
        problems.push("benefit resolved to both project and programme scope");

      const composite = `${compositeScope(item)}|${item.recordKey}`;
      if (item.recordKey && seen.has(composite)) problems.push("duplicate record key in the same scope");
      seen.add(composite);

      if (problems.length)
        invalid.push({
          index,
          key: item.recordKey,
          storageGroup: item.storageGroup,
          projectCode: item.projectCode,
          programmeCode: item.programmeCode,
          problems
        });
    });

    return { module: moduleName, localRecords: rows.length, invalid, valid: invalid.length === 0 };
  }

  function legacyOf(row) {
    return row &&
      row.legacy_payload &&
      typeof row.legacy_payload === "object" &&
      !Array.isArray(row.legacy_payload)
      ? row.legacy_payload
      : {};
  }

  function mapRow(moduleName, row) {
    const definition = moduleDefinition(moduleName);
    const legacy = legacyOf(row);
    const record = { ...legacy };

    definition.fields.forEach((field) => {
      record[field.field] = mappedValue(row[field.column], field.type, legacy[field.field]);
    });

    if (
      definition.localKey === "ppmPlanBaselines" &&
      row.record_version !== null &&
      row.record_version !== undefined
    )
      record.version = row.record_version;

    record.databaseId = row.id || "";
    record.databaseVersion = row.version;
    record.recordSource = DATABASE;

    /*
      Stage 12 rows carry scope_key instead of project_code. For an object-shaped
      store the scope key IS the container key it must be filed back under — the
      programme code, or the configuration category. For an array or singleton store
      there is no container, so the group is dropped.
    */
    if (usesScopeKey(definition)) {
      const scopeKey = String(row.scope_key || "");
      record.__projectCode = "";
      record.__programmeCode = definition.scopeKind === "programme" ? scopeKey : "";
      record.__storageGroup = definition.shape === "object" ? scopeKey : "";
      return record;
    }

    const projectCode = String(row.project_code || "");
    const programmeCode = String(row.programme_code || "");
    record.__projectCode = projectCode;
    record.__programmeCode = programmeCode;

    if (definition.projectField && projectCode && !record[definition.projectField])
      record[definition.projectField] = projectCode;

    record.__storageGroup = storageGroupFor(
      definition,
      record,
      programmeCode ? `programme:${programmeCode}` : projectCode
    );
    return record;
  }

  /*
    Restores the order a sequential collection is read in. Recorded status history
    is rendered newest-first by reversing the array, and reports walk it in order,
    so scrambled rows would misrepresent when a status was reported. Sorted on the
    business timestamp rather than on any database column: seeded history all
    arrives within the same second, so created_at cannot separate it. Falls back to
    the record key so the result is stable when timestamps tie or are absent.
  */
  function sortSequential(definition, records) {
    const field = definition.sortBy;
    if (!field) return records;
    const rank = (record) => {
      const raw = record?.[field];
      const time = raw ? new Date(raw).getTime() : Number.NaN;
      return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
    };
    return records.slice().sort((left, right) => {
      const difference = rank(left) - rank(right);
      if (difference) return difference;
      return String(left?.[definition.idField] || "").localeCompare(
        String(right?.[definition.idField] || "")
      );
    });
  }

  function stripAdapterGrouping(record) {
    const copy = { ...record };
    delete copy.__storageGroup;
    delete copy.__projectCode;
    delete copy.__programmeCode;
    return copy;
  }

  function regroup(moduleName, rows) {
    const definition = moduleDefinition(moduleName);
    const mapped = sortSequential(definition, (rows || []).map((row) => mapRow(moduleName, row)));

    /*
      A singleton store is the object itself, not a list containing it. An empty
      table maps back to {} so the application's own "no configuration stored yet"
      branch runs and writes its defaults, which then flow to the database through
      write-through. That is how the config tables self-populate after cutover.
    */
    if (definition.shape === "singleton")
      return mapped.length ? stripAdapterGrouping(mapped[0]) : {};

    if (definition.shape === "array")
      return mapped.map((record) => {
        const copy = { ...record };
        delete copy.__storageGroup;
        delete copy.__projectCode;
        delete copy.__programmeCode;
        return copy;
      });

    const store = {};
    mapped.forEach((record) => {
      const group = record.__storageGroup || "__UNSCOPED__";
      if (!Array.isArray(store[group])) store[group] = [];
      const copy = { ...record };
      delete copy.__storageGroup;
      delete copy.__projectCode;
      delete copy.__programmeCode;
      store[group].push(copy);
    });
    return store;
  }

  async function session() {
    const supabase = client();
    if (!supabase?.auth) return null;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) return null;
      return data?.session || null;
    } catch (error) {
      return null;
    }
  }

  async function assuranceLevel() {
    const supabase = client();
    if (!supabase?.auth?.mfa) return null;
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      return data?.currentLevel || null;
    } catch (error) {
      return null;
    }
  }

  async function queryRows(moduleName, options) {
    const definition = moduleDefinition(moduleName);
    const supabase = client();
    if (!supabase)
      return { ok: false, rows: [], error: new Error("Supabase is not loaded on this page.") };
    if (!(await session()))
      return { ok: false, rows: [], error: new Error("There is no active Supabase session.") };
    /*
      Below aal2 the restrictive policy on every table filters every row out and
      PostgREST calls that success. Treating it as success meant hydration replaced all
      32 child collections with empty stores. See the same guard, and the longer note
      about why, in ppm-database.js query().
    */
    if ((await assuranceLevel()) !== "aal2")
      return {
        ok: false,
        rows: [],
        error: new Error(
          "Multi-factor verification is not complete, so the database returns no rows and nothing can be loaded."
        )
      };

    try {
      let request = supabase.from(definition.table).select("*");
      if (!options?.includeDeleted && !definition.readOnly) request = request.is("deleted_at", null);
      /*
        PostgREST returns rows in whatever order the planner produced unless asked.
        Collections whose meaning is a sequence rather than a set say so, and get a
        deterministic read. regroup() sorts again on the business field, because a
        bulk seed gives every historical row nearly the same created_at.
      */
      if (definition.sortColumn)
        request = request
          .order(definition.sortColumn, { ascending: true, nullsFirst: true })
          .order("record_key", { ascending: true });
      const { data, error } = await request;
      if (error) return { ok: false, rows: [], error };
      return { ok: true, rows: data || [], error: null };
    } catch (error) {
      return { ok: false, rows: [], error };
    }
  }

  async function get(moduleName, options) {
    const result = await queryRows(moduleName, options);
    if (!result.ok) return { ...result, store: null };
    return { ...result, store: regroup(moduleName, result.rows) };
  }

  async function projectUuid(projectCode) {
    const code = String(projectCode || "").trim();
    if (!code) return null;

    const localProjects = window.PPMStore ? PPMStore.projects.all() : [];
    const match = localProjects.find((row) => String(row?.projectCode || "").trim() === code);
    if (match?.databaseId) return match.databaseId;

    const supabase = client();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq("project_code", code)
      .maybeSingle();
    return error ? null : data?.id || null;
  }

  function toColumns(moduleName, item, options) {
    const definition = moduleDefinition(moduleName);
    const record = item.record;
    const columns = usesScopeKey(definition)
      ? {
          scope_key: item.scopeKey || SINGLETON_KEY,
          record_key: item.recordKey,
          legacy_payload: payloadOf(record)
        }
      : {
          project_code: item.projectCode || "",
          record_key: item.recordKey,
          legacy_payload: payloadOf(record)
        };

    /*
      Ownership is established server-side from auth.uid() by a trigger, not sent
      by the browser. A client-supplied owner would let one user file a view as
      another user's personal view.
    */

    if (definition.localKey === "ppmProjectBenefits")
      columns.programme_code = item.programmeCode || null;

    definition.fields.forEach((field) => {
      columns[field.column] = typedValue(record?.[field.field], field.type);
    });

    if (definition.localKey === "ppmPlanBaselines")
      columns.record_version = typedValue(record?.version, "numeric");

    if (options?.initialSeed) columns.import_payload = payloadOf(record);
    return columns;
  }

  function compositeScope(item) {
    if (item.scopeKey) return `scope:${item.scopeKey}`;
    if (item.programmeCode) return `programme:${item.programmeCode}`;
    return item.projectCode || "global";
  }

  function compositeKey(item) {
    return `${compositeScope(item)}|${item.recordKey}`;
  }

  function databaseComposite(moduleName, row) {
    const definition = moduleDefinition(moduleName);
    if (usesScopeKey(definition))
      return `scope:${String(row.scope_key || "")}|${String(row.record_key || "")}`;
    const programme =
      definition.localKey === "ppmProjectBenefits" ? String(row.programme_code || "") : "";
    const scope = programme
      ? `programme:${programme}`
      : String(row.project_code || "") || "global";
    return `${scope}|${String(row.record_key || "")}`;
  }

  function normaliseForCompare(record) {
    const copy = payloadOf(record);
    delete copy.databaseVersion;
    delete copy.databaseId;
    delete copy.recordSource;
    return copy;
  }

  async function compare(moduleName) {
    const validation = validateLocal(moduleName);
    if (!validation.valid) {
      console.error(`PPMChildDatabase: "${moduleName}" has invalid local records.`, validation.invalid);
      return { module: moduleName, ok: false, invalid: validation.invalid, verdict: "INVALID LOCAL DATA" };
    }

    const result = await queryRows(moduleName);
    if (!result.ok) {
      console.error(`PPMChildDatabase.compare("${moduleName}"): database read failed.`, result.error);
      return { module: moduleName, ok: false, error: String(result.error?.message || result.error) };
    }

    const local = flattenLocal(moduleName);
    const dbByKey = new Map(result.rows.map((row) => [databaseComposite(moduleName, row), row]));
    const localByKey = new Map(local.map((item) => [compositeKey(item), item]));
    const onlyInDatabase = [...dbByKey.keys()].filter((key) => !localByKey.has(key));
    const onlyInLocal = [...localByKey.keys()].filter((key) => !dbByKey.has(key));
    const differences = [];

    dbByKey.forEach((row, key) => {
      const localItem = localByKey.get(key);
      if (!localItem) return;
      const mapped = normaliseForCompare(mapRow(moduleName, row));
      const expected = normaliseForCompare(localItem.record);
      const fields = new Set([...Object.keys(mapped), ...Object.keys(expected)]);
      fields.forEach((field) => {
        if (field.startsWith("__") || ADAPTER_FIELDS.has(field)) return;
        if (!sameValue(mapped[field], expected[field]))
          differences.push({
            record: key,
            field,
            database: mapped[field],
            localStorage: expected[field]
          });
      });
    });

    const report = {
      module: moduleName,
      ok: true,
      localRecords: local.length,
      databaseRecords: result.rows.length,
      onlyInDatabase,
      onlyInLocal,
      fieldDifferences: differences,
      identical: !onlyInDatabase.length && !onlyInLocal.length && !differences.length
    };
    report.verdict = report.identical
      ? "IDENTICAL"
      : "DIFFERENCES FOUND — do not cut this collection over";

    console.group(`PPMChildDatabase parity: ${moduleName}`);
    console.log(`localStorage ${local.length} record(s), database ${result.rows.length} record(s)`);
    if (onlyInDatabase.length) console.warn("Only in database:", onlyInDatabase);
    if (onlyInLocal.length) console.warn("Only in localStorage:", onlyInLocal);
    if (differences.length) {
      console.warn(`${differences.length} field difference(s)`);
      console.table(differences);
    }
    console.log(report.verdict);
    console.groupEnd();
    return report;
  }

  async function compareAll() {
    const reports = {};
    for (const name of Object.keys(MODULES)) {
      if (MODULES[name].readOnly && name === "legacyAudit") continue;
      reports[name] = await compare(name);
    }
    return reports;
  }

  /* ------------------------------------------------------- Stage 10C: cutover

     Milestones proved the generic path in Stage 10B. Stage 10C reuses the same
     hydration/write-through mechanism for a limited low-risk batch. The page
     still reads/writes the legacy localStorage shapes synchronously; this layer
     hydrates them from PostgreSQL before page scripts execute and pushes row-level
     changes back through the existing Storage.setItem seam.

     Deletes are soft deletes (deleted_at), never SQL DELETE. Optimistic locking
     uses the version loaded by this browser, held in the in-memory baseline.
  ------------------------------------------------------------------------- */

  function readPending() {
    const rows = parseJson(localStorage.getItem(PENDING_KEY), []);
    return Array.isArray(rows) ? rows : [];
  }

  function writePending(rows) {
    localStorage.setItem(PENDING_KEY, JSON.stringify((rows || []).slice(-MAX_PENDING)));
  }

  function pendingFor(moduleName) {
    return readPending().filter((row) => row?.child === true && row.module === moduleName);
  }

  function recordPending(entry) {
    const rows = readPending().filter(
      (row) =>
        !(
          row?.child === true &&
          row.module === entry.module &&
          row.key === entry.key &&
          row.operation === entry.operation
        )
    );
    rows.push({ ...entry, child: true });
    writePending(rows);
  }

  function clearPendingEntry(moduleName, key, operation) {
    const rows = readPending().filter(
      (row) =>
        !(
          row?.child === true &&
          row.module === moduleName &&
          row.key === key &&
          (!operation || row.operation === operation)
        )
    );
    writePending(rows);
  }

  function clearPending(moduleName) {
    const rows = readPending().filter(
      (row) => !(row?.child === true && (!moduleName || row.module === moduleName))
    );
    writePending(rows);
    console.info(
      moduleName
        ? `PPMChildDatabase: pending writes cleared for "${moduleName}".`
        : "PPMChildDatabase: all child pending writes cleared."
    );
  }

  function pendingWrites(moduleName) {
    const rows = readPending().filter(
      (row) => row?.child === true && (!moduleName || row.module === moduleName)
    );
    if (!rows.length) {
      console.info("PPMChildDatabase: no unsaved child changes. Everything reached the database.");
      return rows;
    }
    console.warn(`PPMChildDatabase: ${rows.length} child change(s) did NOT reach the database.`);
    console.table(
      rows.map((row) => ({
        at: row.at,
        module: row.module,
        record: row.key,
        operation: row.operation,
        problem: row.kind,
        detail: row.message
      }))
    );
    return rows;
  }

  function classifyError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || error || "");
    if (code === "40001" || code === "23505" || /changed by someone else|duplicate key/i.test(message))
      return "conflict";
    if (
      code === "42501" ||
      code === "PGRST301" ||
      /permission denied|row-level security|does not allow/i.test(message)
    )
      return "refused";
    return "failed";
  }

  /*
    Human labels for messages the user reads.

    Previously derived with moduleName.replace(/s$/, ""), which produced
    "financialEntrie", "statusReport" and "ragHistory" - camelCase leaking straight
    into a message shown to somebody who has just lost an edit. Written out instead,
    because there is no rule that turns these identifiers into English.
  */
  const SINGULAR = Object.freeze({
    plans: "Plan task",
    milestones: "Milestone",
    raid: "RAID entry",
    actions: "Action",
    decisions: "Decision",
    financials: "Financial record",
    benefits: "Benefit",
    documents: "Document link",
    statusReports: "Status report",
    stageGates: "Stage gate",
    planBaselines: "Plan baseline",
    baselineRequests: "Rebaseline request",
    ragHistory: "Recorded status",
    financialEntries: "Cost line",
    financialApprovals: "Budget request",
    resourceDemand: "Resource demand",
    resourceScenarios: "Resource scenario",
    legacyAudit: "Historical audit entry",
    programmeMilestones: "Programme milestone",
    programmeRaid: "Programme RAID entry",
    lifecycleTemplates: "Lifecycle template",
    lifecycleRules: "Mandatory rule",
    referenceData: "Reference data entry",
    reportingCalendars: "Reporting calendar",
    reportingPeriods: "Reporting period",
    ragConfig: "RAG configuration",
    financialCategories: "Cost category",
    resourceAbsence: "Absence record",
    resourceConfig: "Resource configuration",
    resourceGanttViews: "Saved resource view",
    reportViews: "Saved report view",
    searchViews: "Saved search view"
  });

  function recordLabel(moduleName, key) {
    const noun = SINGULAR[moduleName] || moduleName;
    /* A singleton has no meaningful key - "RAG configuration GLOBAL" reads as a bug. */
    if (!key || key === SINGLETON_KEY) return noun;
    return `${noun} ${key}`;
  }

  function friendlyError(kind, moduleName, key, error) {
    const label = recordLabel(moduleName, key);
    if (kind === "conflict")
      return `${label} was changed by someone else while you were editing it. Reload the page and reapply your change.`;
    if (kind === "refused") return `You do not have permission to save ${label}.`;
    return `${label} could not be saved to the database: ${error?.message || error}`;
  }

  function snapshotRows(moduleName, rows) {
    const map = new Map();
    (rows || []).forEach((row) => {
      const key = databaseComposite(moduleName, row);
      const mapped = normaliseForCompare(mapRow(moduleName, row));
      map.set(key, {
        key,
        databaseId: row.id || "",
        version: Number(row.version),
        deleted: Boolean(row.deleted_at),
        projectCode: String(row.project_code || ""),
        programmeCode: String(row.programme_code || ""),
        scopeKey: String(row.scope_key || ""),
        recordKey: String(row.record_key || ""),
        payload: stableStringify(mapped)
      });
    });

    // A failed write must keep using the version the edit was originally based on.
    // Re-reading a newer version here would silently defeat optimistic locking.
    pendingFor(moduleName).forEach((pending) => {
      const entry = map.get(pending.key);
      const expected = Number(pending.expectedVersion);
      if (entry && Number.isFinite(expected)) entry.version = expected;
    });

    baseline.set(moduleName, map);
    return map;
  }

  async function ensureBaseline(moduleName) {
    if (baseline.has(moduleName)) return baseline.get(moduleName);
    const result = await queryRows(moduleName, { includeDeleted: true });
    if (!result.ok) throw result.error || new Error(`Could not load ${moduleName} from the database.`);
    return snapshotRows(moduleName, result.rows);
  }

  async function hydrateModule(moduleName, options) {
    if (!DATABASE_MODULES.has(moduleName))
      throw new Error(`This build has no approved cutover implementation for "${moduleName}".`);

    const result = await queryRows(moduleName, { includeDeleted: true });
    if (!result.ok)
      return { module: moduleName, ok: false, error: String(result.error?.message || result.error) };

    const pending = pendingFor(moduleName);
    const blockingPending = pending.filter((row) => row.kind !== "conflict");

    // A conflict is resolved by reloading the authoritative database row and
    // reapplying the user's edit. Network/refusal failures are different: the
    // local copy may be the only copy of the unsaved change, so do not overwrite it.
    if (pending.length && !blockingPending.length) {
      const remaining = readPending().filter(
        (row) => !(row?.child === true && row.module === moduleName && row.kind === "conflict")
      );
      writePending(remaining);
      console.warn(
        `PPMChildDatabase: a previous "${moduleName}" conflict was cleared by reloading the database version. ` +
          `Reapply the edit if it is still needed.`
      );
    }

    const base = snapshotRows(moduleName, result.rows);

    // A dropped network response can make a successful write look failed. Before
    // protecting the local copy, check whether PostgreSQL already contains exactly
    // what the pending operation wanted. If so, the pending marker is stale.
    if (blockingPending.length) {
      const currentByKey = new Map(
        flattenLocal(moduleName).map((item) => [compositeKey(item), item])
      );
      const resolved = new Set();
      blockingPending.forEach((pending) => {
        const dbEntry = base.get(pending.key);
        const localItem = currentByKey.get(pending.key);
        if (pending.operation === "soft-delete") {
          if (dbEntry?.deleted && !localItem) resolved.add(pending.key);
          return;
        }
        if (dbEntry && !dbEntry.deleted && localItem && dbEntry.payload === baselinePayload(localItem))
          resolved.add(pending.key);
      });
      if (resolved.size) {
        const remaining = readPending().filter(
          (row) => !(row?.child === true && row.module === moduleName && resolved.has(row.key))
        );
        writePending(remaining);
        console.info(
          `PPMChildDatabase: cleared ${resolved.size} pending "${moduleName}" write(s) already present in the database.`
        );
      }
    }

    /*
      A pending write no longer stops the refresh. Any of them.

      This blocked hydration whenever a change had not been saved, because the browser mirror
      held that change and refreshing would have overwritten it. That reasoning went with the
      mirror. A failed save updates nothing - PPMStore only changes the store once PostgreSQL
      confirms - so there is no local copy left to protect, and refusing to refresh now buys
      nothing and costs everything: with no mirror to fall back on, a skipped collection is an
      empty one, and the page shows nothing at all.

      It was already the wrong trade. Two rounds of this shipped: a refused plan baseline from 9
      August still blocking every refresh two days later, and before that a conflict doing the
      same. Each time the fix was to excuse one more kind. The honest version is that the
      database copy is the only copy, so it always wins.

      The ledger stays, and is reported rather than acted on: pendingWrites() still shows what
      failed and why, which is the part that was ever any use.
    */
    const unsaved = pendingFor(moduleName);
    if (unsaved.length) {
      const kinds = [...new Set(unsaved.map((row) => row.kind))].join(", ");
      console.warn(
        `PPMChildDatabase: ${unsaved.length} "${moduleName}" change(s) did not save (${kinds}). Refreshing from the ` +
          `database anyway - it holds the only copy. Run PPMChildDatabase.pendingWrites("${moduleName}") to see them, ` +
          `then PPMChildDatabase.clearPending("${moduleName}") once you have.`
      );
    }

    const activeRows = result.rows.filter((row) => !row.deleted_at);
    const store = regroup(moduleName, activeRows);
    adopt(moduleName, store);
    hydrated = true;
    return { module: moduleName, ok: true, records: activeRows.length, deleted: result.rows.length - activeRows.length };
  }

  async function hydrate() {
    const report = { hydrated: [], skipped: [], failed: [] };

    /*
      Signed out is a state, not a fault.

      Every page loads the adapters, including the sign-in page and whatever page is showing at
      the moment somebody signs out. Without this, each of the 32 collections was queried, each
      was refused for want of a session, and each logged its own warning - 32 of them, plus four
      from the parent adapter, describing the entirely correct outcome of pressing "sign out".

      It is reported at info rather than warn for the same reason: nothing has gone wrong. Once,
      because saying it 32 times does not make it more true.
    */
    if (!(await session())) {
      activeModules().forEach((moduleName) =>
        report.skipped.push({ module: moduleName, reason: "nobody is signed in" })
      );
      console.info("PPMChildDatabase: nobody is signed in, so there is nothing to load.");
      return report;
    }

    /* One warning for all 32 collections rather than 32 saying the same thing.
       See the note in queryRows(). */
    if ((await assuranceLevel()) !== "aal2") {
      activeModules().forEach((moduleName) =>
        report.skipped.push({ module: moduleName, reason: "multi-factor verification is not complete" })
      );
      console.warn(
        "PPMChildDatabase: not refreshing any collection - multi-factor verification is not complete, so the " +
          "database would return no rows and empty all of them. Nothing is loaded until it is."
      );
      return report;
    }

    for (const moduleName of activeModules()) {
      const result = await hydrateModule(moduleName);
      if (!result.ok) {
        report.failed.push(result);
        console.warn(
          /* There is no local copy. The mirror went in Stage 17 - this collection is empty. */
          `PPMChildDatabase: could not load "${moduleName}" from the database, so it is empty and ` +
            `the page will show nothing for it. Reload once the connection is back.`,
          result.error
        );
      } else if (result.skipped) report.skipped.push(result);
      else report.hydrated.push(result);
    }
    if (report.hydrated.length)
      console.info(
        "PPMChildDatabase: loaded from the database - " +
          report.hydrated.map((row) => `${row.module} (${row.records})`).join(", ")
      );
    return report;
  }

  function baselinePayload(item) {
    return stableStringify(normaliseForCompare(item.record));
  }

  async function saveChildRecord(moduleName, operation) {
    const definition = moduleDefinition(moduleName);
    const supabase = client();
    const { key, item, prior, payload } = operation;
    const baseResult = {
      module: moduleName,
      key,
      operation: prior?.deleted ? "restore" : prior ? "update" : "insert",
      at: new Date().toISOString()
    };

    if (!supabase) return { ...baseResult, status: "failed", message: "Supabase is not loaded on this page." };
    if (!(await session())) return { ...baseResult, status: "failed", message: "There is no active Supabase session." };
    if ((await assuranceLevel()) !== "aal2")
      return { ...baseResult, status: "refused", message: "MFA assurance level AAL2 is required before saving." };

    /*
      Append-only collections should never reach the update branch below;
      appendOnlySync() filters those operations out before they get here. This is
      the second line of defence, so a future caller that reaches saveChildRecord
      directly cannot quietly attempt to rewrite recorded history. The database
      would refuse it anyway — there is no UPDATE grant — but failing here gives a
      message that explains why instead of a bare permission error.
    */
    if (definition.appendOnly && prior)
      return {
        ...baseResult,
        status: "refused",
        message: `${moduleName} is append-only recorded history; ${key} cannot be changed once recorded.`
      };

    const columns = toColumns(moduleName, item);
    try {
      if (!prior) {
        if (!usesScopeKey(definition) && item.projectCode)
          columns.project_id = await projectUuid(item.projectCode);
        columns.deleted_at = null;
        const { data, error } = await supabase
          .from(definition.table)
          .insert(columns)
          .select("id, version, deleted_at")
          .single();
        if (error) {
          const kind = classifyError(error);
          return { ...baseResult, status: kind, message: friendlyError(kind, moduleName, key, error) };
        }
        baseline.get(moduleName).set(key, {
          key,
          databaseId: data?.id || "",
          version: Number(data?.version ?? 1),
          deleted: false,
          projectCode: item.projectCode,
          programmeCode: item.programmeCode,
          recordKey: item.recordKey,
          payload
        });
        return {
          ...baseResult,
          status: "saved",
          version: Number(data?.version ?? 1),
          databaseId: data?.id || ""
        };
      }

      const expectedVersion = Number(prior.version);
      if (!Number.isFinite(expectedVersion)) {
        const error = { code: "40001", message: "The record has no loaded database version." };
        return {
          ...baseResult,
          status: "conflict",
          expectedVersion,
          message: friendlyError("conflict", moduleName, key, error)
        };
      }

      const { data, error } = await supabase
        .from(definition.table)
        .update({ ...columns, deleted_at: null, version: expectedVersion })
        .eq(definition.scopeColumn || "project_code", scopeValueOf(definition, prior))
        .eq("record_key", prior.recordKey)
        .select("id, version, deleted_at")
        .maybeSingle();

      if (error) {
        const kind = classifyError(error);
        return {
          ...baseResult,
          status: kind,
          expectedVersion,
          message: friendlyError(kind, moduleName, key, error)
        };
      }
      if (!data) {
        const error = { code: "42501", message: "The database did not permit this row to be updated." };
        return {
          ...baseResult,
          status: "refused",
          expectedVersion,
          message: friendlyError("refused", moduleName, key, error)
        };
      }

      Object.assign(prior, {
        databaseId: data.id || prior.databaseId || "",
        version: Number(data.version),
        deleted: false,
        payload
      });
      return {
        ...baseResult,
        status: "saved",
        expectedVersion,
        version: Number(data.version),
        databaseId: data.id || ""
      };
    } catch (error) {
      const kind = classifyError(error);
      return {
        ...baseResult,
        status: kind,
        expectedVersion: prior?.version,
        message: friendlyError(kind, moduleName, key, error)
      };
    }
  }

  async function softDeleteChildRecord(moduleName, operation) {
    const definition = moduleDefinition(moduleName);
    const supabase = client();
    const { key, prior } = operation;
    const baseResult = { module: moduleName, key, operation: "soft-delete", at: new Date().toISOString() };
    const expectedVersion = Number(prior?.version);

    if (!supabase)
      return { ...baseResult, status: "failed", expectedVersion, message: "Supabase is not loaded on this page." };
    if (!(await session()))
      return { ...baseResult, status: "failed", expectedVersion, message: "There is no active Supabase session." };
    if ((await assuranceLevel()) !== "aal2")
      return {
        ...baseResult,
        status: "refused",
        expectedVersion,
        message: "MFA assurance level AAL2 is required before saving."
      };
    if (!Number.isFinite(expectedVersion)) {
      const error = { code: "40001", message: "The record has no loaded database version." };
      return {
        ...baseResult,
        status: "conflict",
        expectedVersion,
        message: friendlyError("conflict", moduleName, key, error)
      };
    }

    try {
      const { data, error } = await supabase
        .from(definition.table)
        .update({ deleted_at: new Date().toISOString(), version: expectedVersion })
        .eq(definition.scopeColumn || "project_code", scopeValueOf(definition, prior))
        .eq("record_key", prior.recordKey)
        .select("id, version, deleted_at")
        .maybeSingle();

      if (error) {
        const kind = classifyError(error);
        return {
          ...baseResult,
          status: kind,
          expectedVersion,
          message: friendlyError(kind, moduleName, key, error)
        };
      }
      if (!data) {
        const error = { code: "42501", message: "The database did not permit this row to be updated." };
        return {
          ...baseResult,
          status: "refused",
          expectedVersion,
          message: friendlyError("refused", moduleName, key, error)
        };
      }

      prior.version = Number(data.version);
      prior.deleted = true;
      return {
        ...baseResult,
        status: "saved",
        expectedVersion,
        version: Number(data.version),
        databaseId: data.id || prior.databaseId || ""
      };
    } catch (error) {
      const kind = classifyError(error);
      return {
        ...baseResult,
        status: kind,
        expectedVersion,
        message: friendlyError(kind, moduleName, key, error)
      };
    }
  }

  function recordProblem(result) {
    recordPending({
      at: result.at,
      module: result.module,
      key: result.key,
      operation: result.operation,
      kind: result.status,
      message: result.message,
      expectedVersion: result.expectedVersion
    });
  }

  /* ------------------------------------------------- Stage 11E: append-only

     Recorded project status history is not editable business data. The generic
     diff below is built for collections where a changed payload means "the user
     edited this record" and a missing key means "the user deleted it". Applied to
     recorded history those readings are both wrong, and acting on them would issue
     exactly the two statements the database now refuses.

     So this path takes the same diff and treats it differently:

       new key          insert it, which is the only legitimate change;
       changed payload  refuse, and restore the record from the database;
       vanished key     refuse, and restore the record from the database.

     Restoring matters as much as refusing. Without it the browser would keep
     showing a version of history that PostgreSQL does not hold, and the next
     reader would trust it.

     A refusal is logged to the pending-write diagnostic rather than swallowed,
     because an attempt to rewrite reported status is worth someone seeing. It
     clears itself on the next hydration once local and database agree again.
  --------------------------------------------------------------------------- */
  /* ==================================================== Stage 16: row-level writes

     saveOne() and removeOne() are the primitives ppm-data.js is built on, and the reason
     Stage 16 can delete the write-through patches at all.

     Everything below this comment already existed; what was missing was a way to say "save
     this one record" without going through localStorage. Without it the only route to the
     database was to rewrite an entire collection and let diffStore work out what changed -
     which is why the application rewrites every project to edit one, and why two people
     editing different projects overwrite each other.

     WHY THESE BUILD A ONE-RECORD STORE RATHER THAN CONSTRUCTING THE ITEM DIRECTLY

     The flattened item shape - record, storageGroup, projectCode, programmeCode, scopeKey,
     recordKey - is derived differently for each of the three store shapes, and those rules
     live in flattenStore(). Duplicating them here would create two definitions of what a
     record's identity is, and they would drift the first time a collection changed shape.
     So a single record is wrapped in the smallest valid store for its shape and put through
     the same function a full sync uses. One definition, exercised by both paths.

     The result is the same structure saveChildRecord() already returns - status of saved,
     conflict, refused or failed, with a message written for a person - so callers of the
     row-level API and readers of a sync outcome see one vocabulary.
  */

  function singleRecordStore(definition, record, storageGroup) {
    if (definition.shape === "singleton") return record;
    if (definition.shape === "array") return [record];
    return { [storageGroup]: [record] };
  }

  function storageGroupFor(definition, record, options) {
    const explicit = options?.storageGroup ?? options?.projectCode ?? options?.programmeCode;
    if (explicit !== undefined && explicit !== null && String(explicit).trim()) return String(explicit).trim();
    /* Fall back to the record's own project field, which is where the group comes from for
       every project-scoped collection. A programme-scoped record carries programmeCode. */
    const fromRecord =
      (definition.projectField && record?.[definition.projectField]) ||
      record?.projectCode ||
      record?.programmeCode ||
      "";
    return String(fromRecord).trim();
  }

  /* Locates a record the way a save would, so a caller can be told what the database
     currently holds without having to know about baselines or composite keys. */
  function identify(moduleName, record, options) {
    const definition = moduleDefinition(moduleName);
    const group = storageGroupFor(definition, record, options);
    const items = flattenStore(moduleName, singleRecordStore(definition, record, group));
    if (!items.length) return null;
    const item = items[0];

    /*
      flattenStore does not require a record key - a full sync tolerates a malformed row by
      producing an item with an empty one. That is survivable when diffing a whole store and
      fatal for a single save: the first test written against saveOne inserted a row keyed
      "PRJ-001|", a phantom record with no identity that nothing could ever find or update
      again. baselineRecord() has always guarded this; the row-level path must too.
    */
    if (definition.shape !== "singleton" && !String(item.recordKey || "").trim()) return null;

    return { definition, item, key: compositeKey(item), payload: baselinePayload(item) };
  }

  /*
    Read-only collections are deliberately absent from DATABASE_MODULES, so an existence check
    against that set alone reports legacyAudit as "not a database-backed collection" - which
    is both wrong and unhelpful, since it exists and is simply not writable from here. Known
    but unwritable and genuinely unknown are different answers and get different messages.
  */
  function writableModule(moduleName) {
    if (!MODULES[moduleName]) return { ok: false, status: "failed", message: `"${moduleName}" is not a collection in this application.` };
    /* READ_ONLY_MODULES is a frozen array, not a Set - the two collection types are mixed in
       this file and .has() on the wrong one throws rather than returning false. */
    if (MODULES[moduleName].readOnly || READ_ONLY_MODULES.includes(moduleName))
      return { ok: false, status: "refused", message: `${moduleName} is read-only in this application.` };
    if (!DATABASE_MODULES.has(moduleName))
      return { ok: false, status: "failed", message: `"${moduleName}" is not a database-backed collection.` };
    return { ok: true };
  }

  function rowFailure(moduleName, key, status, message) {
    return { module: moduleName, key, operation: "save", status, at: new Date().toISOString(), message };
  }

  async function saveOne(moduleName, record, options) {
    const writable = writableModule(moduleName);
    if (!writable.ok) return rowFailure(moduleName, "(unwritable)", writable.status, writable.message);

    const found = identify(moduleName, record, options);
    if (!found)
      return rowFailure(
        moduleName,
        "(unidentified)",
        "invalid",
        `The record has no ${moduleDefinition(moduleName).idField || "identifier"}, so there is nothing to save it as.`
      );

    let base;
    try {
      base = await ensureBaseline(moduleName);
    } catch (error) {
      return rowFailure(
        moduleName,
        found.key,
        "failed",
        `Could not load the database baseline: ${error?.message || error}`
      );
    }

    const prior = base.get(found.key) || null;

    /*
      Nothing to do if the record is byte-for-byte what the database already holds.

      diffStore() has always skipped unchanged records; saveOne() did not, and the harness
      caught it - re-saving an untouched task issued an UPDATE. That is not merely wasteful: it
      bumps the row version, so somebody else editing the same record gets a conflict caused by
      a save that changed nothing, and it writes an audit row describing no change at all.

      The comparison is on the canonical payload, not the object, so a record whose keys arrive
      in a different order still counts as unchanged.
    */
    if (prior && !prior.deleted && prior.payload === found.payload) {
      return {
        module: moduleName,
        key: found.key,
        operation: "unchanged",
        status: "saved",
        at: new Date().toISOString(),
        message: "No change; the database already holds this record."
      };
    }

    return recordOutcome(
      await saveChildRecord(moduleName, {
        key: found.key,
        item: found.item,
        prior,
        payload: found.payload
      })
    );
  }

  /*
    Puts the outcome of a row-level write in the pending ledger, or takes it out again.

    This was missing, and had been since Stage 16. recordProblem() was only ever called from
    syncStore() and appendOnlySync() - the collection-level path the write-through used - so once
    that path stopped being reached, no failed write was recorded anywhere durable. pendingWrites()
    returned an empty list however much had gone wrong, which is worse than not having it: it is a
    diagnostic that answers "nothing failed" when things have.

    The offline queue in ppm-data.js was unaffected and kept the amber banner honest, but a
    refusal or a conflict left no trace at all once the message had been dismissed.
  */
  function recordOutcome(result) {
    if (!result) return result;
    if (result.status === "saved") clearPendingEntry(result.module, result.key, result.operation);
    else recordProblem(result);
    return result;
  }

  async function removeOne(moduleName, record, options) {
    const writable = writableModule(moduleName);
    if (!writable.ok) return rowFailure(moduleName, "(unwritable)", writable.status, writable.message);

    const found = identify(moduleName, record, options);
    if (!found) return rowFailure(moduleName, "(unidentified)", "invalid", "The record has no identifier.");

    /* Recorded history is not deletable, and saying so here gives a reason rather than the
       bare permission error the database would return. The database refuses it regardless -
       there is no DELETE grant - so this is a message, not a control. */
    if (found.definition.appendOnly)
      return rowFailure(
        moduleName,
        found.key,
        "refused",
        `${moduleName} is append-only recorded history; ${found.key} cannot be removed.`
      );

    let base;
    try {
      base = await ensureBaseline(moduleName);
    } catch (error) {
      return rowFailure(moduleName, found.key, "failed", `Could not load the database baseline: ${error?.message || error}`);
    }

    const prior = base.get(found.key);
    if (!prior || prior.deleted)
      return { module: moduleName, key: found.key, operation: "delete", status: "saved", at: new Date().toISOString(), message: "Already absent from the database." };

    return recordOutcome(await softDeleteChildRecord(moduleName, { key: found.key, prior }));
  }

  function emptyStoreFor(definition) {
    if (definition.shape === "array") return [];
    return {};
  }

  /* =================================== Stage 16: the collection-level sync is gone too

     WHAT WAS HERE

     diffStore(), syncStore(), appendOnlySync(), enqueueSync(), syncFromRawValue() and flush() -
     around two hundred lines that took a whole collection, diffed it against the database
     baseline and wrote every row that had changed. It was the engine behind the write-through:
     the patched Storage.prototype.setItem handed the new value to syncFromRawValue(), which
     queued a sync, and flush() awaited it.

     Deleting the patch left every one of them unreachable. Nothing called syncFromRawValue, so
     nothing populated the queue, so flush() returned an empty outcome to anyone who awaited it -
     including two workflow commits and the scenario publisher, where `await flush(...)` read as
     "make sure pending writes have landed" and did nothing whatsoever.

     That is the same defect as the unreachable governance workflows in Stage 17, and dead code
     that reads as a safeguard is worse than dead code that reads as dead. Row-level writes -
     saveOne() and removeOne() - do this work now, one record at a time, each returning what
     happened.

  */

  /* ============================================ Stage 16: the write-through is gone

     installWriteThrough() replaced Storage.prototype.setItem for the whole page, and separately
     wrapped PPMAuth.writeGlobal because the first patch could not see writes that deliberately
     bypassed it. Between them they turned ordinary browser storage writes into database writes -
     invisibly, and without any way for the caller to learn the result.

     Stage 12's bug is the argument against it: the child adapter hooked only the prototype, so
     every configuration store written through writeGlobal saved locally and never reached
     PostgreSQL, with no error anywhere. A design needing two interceptions to stay in step will
     eventually have one of them missing.

     ppm-data.js replaced all of it. See the matching note in ppm-database.js.
  */




  function baselineRecord(moduleName, record) {
    if (!record || typeof record !== "object") return null;
    const definition = moduleDefinition(moduleName);
    const item = {
      projectCode: String(record?.[definition.projectField] || record?.projectCode || "").trim(),
      programmeCode: String(record?.programmeCode || "").trim(),
      recordKey: String(record?.[definition.idField] || "").trim()
    };
    if (!item.recordKey) return null;
    return baseline.get(moduleName)?.get(compositeKey(item)) || null;
  }

  /* ================================================ Stage 17: workflow readiness

     THE QUESTION FOUR MODULES ASK BEFORE USING A WORKFLOW

     They used to ask stage11AReady(), stage11BReady(), stage11CReady() and stage11DReady().
     Stage 14 retired all four and nothing updated the callers. Because they were written as
     optional calls - PPMChildDatabase?.stage11AReady?.() - a missing method produced undefined
     rather than an error, Boolean(undefined) is false, and every workflow quietly reported
     itself unavailable. Stage gates, plan baselines, budget approvals and scenario publishing
     all fell back to writing rows directly, which the database refuses. For months.

     So this reports something that is actually true and cannot rot in the same way: a workflow
     is ready when the function that commits it exists and there is a Supabase client to call it
     with. If either is missing, the answer is honestly no.

     Named by workflow rather than by migration stage on purpose. "stage11AReady" told a reader
     nothing about what it gated, and dated badly the moment Stage 11A stopped being recent.
  */
  const WORKFLOW_COMMITS = Object.freeze({
    stageGate: "commitStageGateWorkflow",
    baseline: "commitBaselineWorkflow",
    financial: "commitFinancialWorkflow",
    resourceScenario: "commitResourceScenarioWorkflow"
  });

  function workflowReady(name) {
    const commit = WORKFLOW_COMMITS[name];
    if (!commit) {
      console.warn(`PPMChildDatabase: "${name}" is not a known workflow.`);
      return false;
    }
    /* The exported object is what a caller would reach, so that is what is checked - not the
       local function, which exists whether or not it was ever exported. */
    return Boolean(client()) && typeof window.PPMChildDatabase?.[commit] === "function";
  }

  /* Every workflow and whether it can currently run. For the console, and for the harness. */
  function workflowStatus() {
    return Object.keys(WORKFLOW_COMMITS).map((name) => ({
      workflow: name,
      commits: WORKFLOW_COMMITS[name],
      ready: workflowReady(name)
    }));
  }

  async function commitStageGateWorkflow(payload) {

    const request = payload && typeof payload === "object" ? payload : {};
    const gate = request.gate || {};
    const gateId = String(gate.gateId || "").trim();
    if (!gateId) throw new Error("The stage-gate workflow has no gate identifier.");

    /*
      A Draft may have been saved milliseconds before Submit, so the version to send is the one
      the adapter's baseline holds rather than the one on the caller's already-serialised object.
      baselineRecord() answers that.

      Five `await flush(...)` calls used to sit here and in the other three workflows, waiting for
      the write-through queue to drain. The queue and flush() were deleted with the write-through;
      this call was missed, and threw "flush is not defined" the first time somebody approved a
      gate. Every write is awaited by its own caller now, so there is nothing left to wait for -
      the record has already reached the database or already failed.
    */
    const gatePrior = baselineRecord("stageGates", gate);
    const expectedGateVersion = Number(gatePrior?.version ?? request.expectedGateVersion ?? gate.databaseVersion);
    if (!Number.isFinite(expectedGateVersion))
      throw new Error(`${gateId} has no loaded database version. Reload before recording the workflow decision.`);

    const pending = STAGE_GATE_WORKFLOW_MODULES.flatMap((name) => pendingFor(name));
    if (pending.length)
      throw new Error(
        `The governance workflow cannot continue while ${pending.length} Stage 11A write(s) are pending. ` +
          "Resolve or reload those writes first."
      );

    const supabase = client();
    if (!supabase) throw new Error("Supabase is not loaded on this page.");
    if (!(await session())) throw new Error("There is no active Supabase session.");
    if ((await assuranceLevel()) !== "aal2") throw new Error("MFA verification is required for governance workflow decisions.");

    const cleanPayload = (value) => {
      if (!value || typeof value !== "object") return value ?? null;
      if (Array.isArray(value)) return value.map(cleanPayload);
      const out = { ...value };
      ADAPTER_FIELDS.forEach((field) => delete out[field]);
      return out;
    };

    const decisionPrior = request.decision ? baselineRecord("decisions", request.decision) : null;

    const args = {
      p_operation: String(request.operation || "transition"),
      p_requested_status: String(request.requestedStatus || gate.workflowStatus || gate.status || ""),
      p_gate: cleanPayload(gate),
      p_expected_gate_version: expectedGateVersion,
      p_actions: cleanPayload(Array.isArray(request.actions) ? request.actions : []),
      p_decision: cleanPayload(request.decision || null),
      p_expected_decision_version:
        request.decision && Number.isFinite(Number(decisionPrior?.version ?? request.decision.databaseVersion))
          ? Number(decisionPrior?.version ?? request.decision.databaseVersion)
          : null,
      p_project: cleanPayload(request.project || null),
      p_expected_project_version:
        request.project && Number.isFinite(Number(request.expectedProjectVersion ?? request.project.databaseVersion))
          ? Number(request.expectedProjectVersion ?? request.project.databaseVersion)
          : null
    };

    const { data, error } = await supabase.rpc("ppm_commit_stage_gate_workflow", args);
    if (error) {
      const kind = classifyError(error);
      const message =
        kind === "conflict"
          ? `${gateId} or its project changed while you were deciding it. Reload and reapply the decision.`
          : kind === "refused"
            ? `The database refused the ${gateId} governance workflow decision: ${error.message || error}`
            : `${gateId} governance workflow could not be committed: ${error.message || error}`;
      throw Object.assign(new Error(message), { code: error.code, kind, cause: error });
    }

    // The RPC committed all related rows together. Refresh every participant so
    // local compatibility stores carry the versions returned by PostgreSQL.
    STAGE_GATE_WORKFLOW_MODULES.forEach((name) => baseline.delete(name));
    for (const name of STAGE_GATE_WORKFLOW_MODULES) {
      const loaded = await hydrateModule(name, { force: true });
      if (!loaded.ok || loaded.skipped)
        throw new Error(`The workflow committed, but ${name} could not be refreshed from the database. Reload the page.`);
    }
    if (window.PPMDatabase?.hydrate) await window.PPMDatabase.hydrate();
    return data || { ok: true, gateId };
  }


  async function versionSnapshot(moduleName, projectCode) {
    const map = await ensureBaseline(moduleName);
    const code = String(projectCode || "").trim().toLowerCase();
    const versions = {};
    map.forEach((entry) => {
      if (entry.deleted) return;
      if (String(entry.projectCode || "").trim().toLowerCase() !== code) return;
      if (!entry.recordKey || !Number.isFinite(Number(entry.version))) return;
      versions[entry.recordKey] = Number(entry.version);
    });
    return versions;
  }

  async function commitBaselineWorkflow(payload) {

    const request = payload && typeof payload === "object" ? payload : {};
    const operation = String(request.operation || "").trim().toLowerCase();
    const projectCode = String(request.projectCode || request.request?.projectCode || "").trim();
    if (!projectCode) throw new Error("The baseline workflow has no project identifier.");
    if (!["request", "approve_initial", "approve_request", "reject_request"].includes(operation))
      throw new Error(`Unknown baseline workflow operation: ${operation || "(blank)"}.`);

    /*
      Five `await flush(...)` calls used to sit above the pending checks in this file, one per
      workflow, described as finishing any queued write-through so that PostgreSQL approved
      exactly what the user had just saved. They stopped doing anything when the write-through
      was deleted, and nothing noticed, because the check underneath them is what was ever load
      bearing: every write is now awaited by its own caller and has already finished or already
      failed by the time a workflow runs, and anything that failed is sitting in the ledger these
      lines read.
    */
    const pending = ["plans", ...BASELINE_WORKFLOW_MODULES].flatMap((name) => pendingFor(name));
    if (pending.length)
      throw new Error(
        `The baseline workflow cannot continue while ${pending.length} plan/baseline write(s) are pending. ` +
          "Resolve or reload those writes first."
      );

    const supabase = client();
    if (!supabase) throw new Error("Supabase is not loaded on this page.");
    if (!(await session())) throw new Error("There is no active Supabase session.");
    if ((await assuranceLevel()) !== "aal2") throw new Error("MFA verification is required for baseline workflow decisions.");

    const cleanPayload = (value) => {
      if (!value || typeof value !== "object") return value ?? null;
      if (Array.isArray(value)) return value.map(cleanPayload);
      const out = { ...value };
      ADAPTER_FIELDS.forEach((field) => delete out[field]);
      return out;
    };

    const baselineRequest = request.request && typeof request.request === "object" ? request.request : null;
    const requestPrior = baselineRequest ? baselineRecord("baselineRequests", baselineRequest) : null;
    if (["approve_request", "reject_request"].includes(operation) && !requestPrior)
      throw new Error(
        `${baselineRequest?.requestId || "The rebaseline request"} has no loaded database version. Reload before recording the decision.`
      );

    const args = {
      p_operation: operation,
      p_project_code: projectCode,
      p_request: cleanPayload(baselineRequest),
      p_expected_request_version:
        requestPrior && Number.isFinite(Number(requestPrior.version)) ? Number(requestPrior.version) : null,
      p_approval_date: request.approvalDate || null,
      p_decision_notes: String(request.decisionNotes || ""),
      p_expected_plan_versions: await versionSnapshot("plans", projectCode)
    };

    const { data, error } = await supabase.rpc("ppm_commit_baseline_workflow", args);
    if (error) {
      const kind = classifyError(error);
      const subject = baselineRequest?.requestId || projectCode;
      const message =
        kind === "conflict"
          ? `${subject} or its project plan changed while the baseline workflow was open. Reload and reapply the action.`
          : kind === "refused"
            ? `The database refused the baseline workflow action: ${error.message || error}`
            : `The baseline workflow could not be committed: ${error.message || error}`;
      throw Object.assign(new Error(message), { code: error.code, kind, cause: error });
    }

    // PostgreSQL committed the baseline/request/plan changes together. Refresh
    // all participating compatibility stores and their optimistic-lock baselines.
    ["plans", ...BASELINE_WORKFLOW_MODULES].forEach((name) => baseline.delete(name));
    for (const name of ["plans", ...BASELINE_WORKFLOW_MODULES]) {
      const loaded = await hydrateModule(name, { force: true });
      if (!loaded.ok || loaded.skipped)
        throw new Error(`The workflow committed, but ${name} could not be refreshed from the database. Reload the page.`);
    }
    return data || { ok: true, projectCode, operation };
  }


  async function commitFinancialWorkflow(payload) {

    const request = payload && typeof payload === "object" ? payload : {};
    const operation = String(request.operation || "").trim().toLowerCase();
    const approval = request.approval && typeof request.approval === "object" ? request.approval : null;
    const projectCode = String(request.projectCode || approval?.projectCode || "").trim();
    if (!projectCode) throw new Error("The financial workflow has no project identifier.");
    if (!["request", "approve", "reject"].includes(operation))
      throw new Error(`Unknown financial workflow operation: ${operation || "(blank)"}.`);

    const pending = FINANCIAL_WORKFLOW_MODULES.flatMap((name) => pendingFor(name));
    if (pending.length)
      throw new Error(
        `The financial workflow cannot continue while ${pending.length} financial write(s) are pending. ` +
          "Resolve or reload those writes first."
      );

    const supabase = client();
    if (!supabase) throw new Error("Supabase is not loaded on this page.");
    if (!(await session())) throw new Error("There is no active Supabase session.");
    if ((await assuranceLevel()) !== "aal2")
      throw new Error("MFA verification is required for financial workflow decisions.");

    const summaries = flattenLocal("financials")
      .filter((item) => String(item.projectCode || "").trim().toLowerCase() === projectCode.toLowerCase())
      .map((item) => item.record);
    if (summaries.length !== 1)
      throw new Error(
        summaries.length
          ? `Project ${projectCode} has more than one active financial summary. Resolve the data issue before approval.`
          : `Project ${projectCode} has no saved financial summary. Save the cost plan before requesting approval.`
      );

    const financialPrior = baselineRecord("financials", summaries[0]);
    if (!financialPrior || !Number.isFinite(Number(financialPrior.version)))
      throw new Error(`Project ${projectCode} has no loaded financial-summary version. Reload before continuing.`);

    const approvalPrior = approval ? baselineRecord("financialApprovals", approval) : null;
    if (["approve", "reject"].includes(operation) && !approvalPrior)
      throw new Error(
        `${approval?.approvalId || "The financial approval request"} has no loaded database version. Reload before recording the decision.`
      );

    const cleanPayload = (value) => {
      if (!value || typeof value !== "object") return value ?? null;
      if (Array.isArray(value)) return value.map(cleanPayload);
      const out = { ...value };
      ADAPTER_FIELDS.forEach((field) => delete out[field]);
      return out;
    };

    const args = {
      p_operation: operation,
      p_project_code: projectCode,
      p_request:
        operation === "request"
          ? cleanPayload({
              approverResourceId: request.approverResourceId || request.request?.approverResourceId || "",
              reason: request.reason ?? request.request?.reason ?? ""
            })
          : cleanPayload(approval),
      p_expected_request_version:
        approvalPrior && Number.isFinite(Number(approvalPrior.version)) ? Number(approvalPrior.version) : null,
      p_expected_financial_version: Number(financialPrior.version),
      p_decision_comments: String(request.decisionComments || ""),
      p_expected_entry_versions: operation === "request" ? await versionSnapshot("financialEntries", projectCode) : {}
    };

    const { data, error } = await supabase.rpc("ppm_commit_financial_workflow", args);
    if (error) {
      const kind = classifyError(error);
      const subject = approval?.approvalId || projectCode;
      const message =
        kind === "conflict"
          ? `${subject} or its cost plan changed while the financial workflow was open. Reload and reapply the action.`
          : kind === "refused"
            ? `The database refused the financial workflow action: ${error.message || error}`
            : `The financial workflow could not be committed: ${error.message || error}`;
      throw Object.assign(new Error(message), { code: error.code, kind, cause: error });
    }

    // The RPC owns approval state and the summary fields affected by approval.
    // Refresh every participating compatibility store so subsequent synchronous
    // legacy reads see PostgreSQL's committed versions immediately.
    FINANCIAL_WORKFLOW_MODULES.forEach((name) => baseline.delete(name));
    for (const name of FINANCIAL_WORKFLOW_MODULES) {
      const loaded = await hydrateModule(name, { force: true });
      if (!loaded.ok || loaded.skipped)
        throw new Error(`The financial workflow committed, but ${name} could not be refreshed from the database. Reload the page.`);
    }
    return data || { ok: true, projectCode, operation };
  }



  async function resourceDemandVersionSnapshot() {

    const pending = pendingFor("resourceDemand");
    if (pending.length)
      throw new Error(
        `A resource scenario cannot be snapshotted while ${pending.length} resource-demand write(s) are pending. ` +
          "Resolve or reload those writes first."
      );

    const map = await ensureBaseline("resourceDemand");
    const versions = {};
    for (const item of flattenLocal("resourceDemand")) {
      const key = compositeKey(item);
      const prior = map.get(key);
      if (!prior || prior.deleted || !Number.isFinite(Number(prior.version)))
        throw new Error(
          `${item.recordKey || "A resource demand"} has no current database version. Reload before creating the scenario.`
        );
      versions[`${item.projectCode}|${item.recordKey}`] = Number(prior.version);
    }
    return versions;
  }

  async function commitResourceScenarioWorkflow(payload) {

    const request = payload && typeof payload === "object" ? payload : {};
    const operation = String(request.operation || "").trim().toLowerCase();
    const scenario = request.scenario && typeof request.scenario === "object" ? request.scenario : null;
    const scenarioId = String(request.scenarioId || scenario?.scenarioId || "").trim();
    if (!scenarioId) throw new Error("The resource-scenario workflow has no scenario identifier.");
    if (!["publish", "reject"].includes(operation))
      throw new Error(`Unknown resource-scenario workflow operation: ${operation || "(blank)"}.`);

    const pending = RESOURCE_WORKFLOW_MODULES.flatMap((name) => pendingFor(name));
    if (pending.length)
      throw new Error(
        `The resource-scenario workflow cannot continue while ${pending.length} Stage 11D write(s) are pending. ` +
          "Resolve or reload those writes first."
      );

    const scenarioPrior = scenario ? baselineRecord("resourceScenarios", scenario) : null;
    const expectedScenarioVersion = Number(
      scenarioPrior?.version ?? request.expectedScenarioVersion ?? scenario?.databaseVersion
    );
    if (!Number.isFinite(expectedScenarioVersion))
      throw new Error(`${scenarioId} has no loaded database version. Reload before continuing.`);

    const supabase = client();
    if (!supabase) throw new Error("Supabase is not loaded on this page.");
    if (!(await session())) throw new Error("There is no active Supabase session.");
    if ((await assuranceLevel()) !== "aal2")
      throw new Error("MFA verification is required for resource-scenario decisions.");

    const { data, error } = await supabase.rpc("ppm_commit_resource_scenario_workflow", {
      p_operation: operation,
      p_scenario_id: scenarioId,
      p_expected_scenario_version: expectedScenarioVersion
    });

    if (error) {
      const kind = classifyError(error);
      const message =
        kind === "conflict"
          ? `${scenarioId} or one of its snapshotted demand records changed. Reload and create/review the scenario again.`
          : kind === "refused"
            ? `The database refused the ${scenarioId} resource-scenario action: ${error.message || error}`
            : `${scenarioId} resource-scenario action could not be committed: ${error.message || error}`;
      throw Object.assign(new Error(message), { code: error.code, kind, cause: error });
    }

    RESOURCE_WORKFLOW_MODULES.forEach((name) => baseline.delete(name));
    for (const name of RESOURCE_WORKFLOW_MODULES) {
      const loaded = await hydrateModule(name, { force: true });
      if (!loaded.ok || loaded.skipped)
        throw new Error(
          `The resource-scenario workflow committed, but ${name} could not be refreshed from the database. Reload the page.`
        );
    }
    return data || { ok: true, scenarioId, operation };
  }


  /* ========================================= configuration self-population

     The configuration collections - lifecycle templates, reference data, reporting
     calendars, mandatory rules, RAG and resource thresholds - populate themselves.

     The application has always written its own defaults on first read:
     getLifecycleTemplates(), getReferenceData(), getReportingCalendars() and
     getMandatoryRules() all write when they find nothing stored. With the
     writeGlobal seam installed those default writes flow into PostgreSQL, so an
     empty table plus one page load equals a properly populated table.

     That is why there is no seeding function here any more. There used to be one,
     and it existed only because the migration needed the tables filled before the
     pages that fill them had ever run.
  ============================================================================ */


  /* ------------------------------------------------------------- self test

     Replaces the long manual console script. Checks, for every requested module:
     the source is the database, the collection hydrates, localStorage and
     PostgreSQL agree, and nothing is stuck in the pending log.

     { write: true } additionally exercises a real insert and soft delete against
     every non-singleton collection, then cleans up after itself. Off by default
     because it writes probe rows into live tables and leaves audit entries;
     singletons are always skipped because a probe would overwrite configuration.
  --------------------------------------------------------------------------- */
  async function selfTest(moduleNames, options) {
    const requested =
      Array.isArray(moduleNames) && moduleNames.length ? moduleNames : [...DATABASE_MODULES];
    const names = requested.map((name) => {
      moduleDefinition(name);
      return name;
    });
    const rows = [];

    for (const name of names) {
      const definition = moduleDefinition(name);
      const row = { module: name, table: definition.table, checks: "", verdict: "" };
      const problems = [];

      /* legacyAudit is historical and has no write path, so there is nothing to
         hydrate, compare or probe. */
      if (!DATABASE_MODULES.has(name)) {
        row.verdict = "SKIPPED (read-only historical data)";
        rows.push(row);
        continue;
      }

      const loaded = await hydrateModule(name, { force: true });
      if (!loaded.ok) problems.push(`hydration failed: ${loaded.error}`);

      const parity = await compare(name);
      if (!parity.ok) problems.push(`parity read failed: ${parity.error}`);
      else if (!parity.identical) problems.push(parity.verdict);

      const stuck = pendingFor(name);
      if (stuck.length) problems.push(`${stuck.length} pending write(s)`);

      if (options?.write && definition.shape !== "singleton" && !definition.readOnly && !APPEND_ONLY_MODULES.has(name)) {
        const probe = await writeProbe(name);
        if (!probe.ok) problems.push(`write probe: ${probe.reason}`);
        row.checks = "read, parity, pending, write probe";
      } else {
        row.checks = "read, parity, pending";
      }

      row.records = parity.ok ? parity.databaseRecords : "?";
      row.verdict = problems.length ? `FAIL — ${problems.join("; ")}` : "PASS";
      rows.push(row);
    }

    const failed = rows.filter((row) => row.verdict.startsWith("FAIL"));
    console.table(rows);
    console.log(
      failed.length
        ? `PPMChildDatabase.selfTest: ${failed.length} collection(s) need attention.`
        : `PPMChildDatabase.selfTest: all ${rows.filter((r) => r.verdict === "PASS").length} database-authoritative collection(s) passed.`
    );
    return { ok: failed.length === 0, rows };
  }

  /*
    Inserts a throwaway record, checks the database accepted it, then removes it again.

    It used to write the probe into localStorage and call flush(), because that is how a write
    reached PostgreSQL when Storage.prototype.setItem was patched. That patch went in Stage 16 and
    flush() became a no-op, so the probe had been silently reporting "insert did not save" for
    every collection ever since - a self test that could only fail. Nobody ran it, which is the
    only reason it went unnoticed, and is its own lesson about diagnostics.

    It now does what it claims: a real save and a real remove through the one write seam, checking
    what each returns.
  */
  async function writeProbe(moduleName) {
    const definition = moduleDefinition(moduleName);
    if (!window.PPMStore) return { ok: false, reason: "ppm-data.js is not loaded" };

    const probeKey = `SELFTEST-${Date.now()}`;
    const record = { [definition.idField]: probeKey, name: "Self test probe", selfTest: true };

    /* Programme-scoped collections are filed under a programme id, so the probe needs a real one
       to sit under. With no programmes loaded there is nothing to probe and saying so beats
       inventing a programme. */
    const options = {};
    if (definition.scopeKind === "programme") {
      const groups = Object.keys(held(moduleName) || {});
      if (!groups.length) return { ok: true, reason: "no programme available to probe" };
      options.storageGroup = groups[0];
    }

    try {
      const inserted = await PPMStore.save(moduleName, record, options);
      if (!inserted.ok) return { ok: false, reason: `insert did not save: ${inserted.reason} - ${inserted.message}` };

      const removed = await PPMStore.remove(moduleName, record, options);
      if (!removed.ok) {
        return {
          ok: false,
          reason: `the probe record was inserted but could not be removed (${removed.reason} - ${removed.message}). ` +
            `Delete ${probeKey} by hand.`
        };
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  async function boot() {
    if (!activeModules().length) return { hydrated: [], skipped: [], failed: [] };
    return hydrate().catch((error) => {
      /* There is no local child data to fall back on - Stage 17 deleted the mirror. Nothing
         loaded, so every register on this page will be empty. */
      console.error(
        "PPMChildDatabase: hydration failed, so no project records loaded and the page will be empty. " +
          "Reload once the connection is back.",
        error
      );
      return { hydrated: [], skipped: [], failed: [{ module: "all", error: String(error) }] };
    });
  }

  const ready = boot();

  /*
    One row per collection describing where it lives and whether the browser
    mirror is currently valid. This is the first thing to look at when a page
    shows nothing: an invalid mirror points at the data, a missing table points at
    the migration, and everything valid points at row-level security instead.
  */
  function status() {
    return Object.fromEntries(
      Object.keys(MODULES).map((name) => {
        const p = validateLocal(name);
        return [
          name,
          {
            browserMirrorKey: MODULES[name].localKey,
            table: MODULES[name].table,
            shape: MODULES[name].shape,
            scope: MODULES[name].scopeKind || "project",
            mirroredRecords: p.localRecords,
            mirrorValid: p.valid,
            databaseOwned: DATABASE_MODULES.has(name),
            appendOnly: APPEND_ONLY_MODULES.has(name),
            readOnly: Boolean(MODULES[name].readOnly)
          }
        ];
      })
    );
  }

  function explain() {
    const rows = Object.entries(status()).map(([module, value]) => ({ module, ...value }));
    console.table(rows);
    console.log(
      "The database owns every collection. There is no switch back to browser storage.\n\n" +
        "Diagnose a collection:\n" +
        '  PPMChildDatabase.status()["plans"]        // where it lives, is the mirror valid\n' +
        '  PPMChildDatabase.validateLocal("plans")  // why the mirror is invalid\n' +
        '  await PPMChildDatabase.compare("plans")  // does the mirror match the database\n' +
        "  await PPMChildDatabase.compareAll()      // the same, for everything\n\n" +
        "Unsaved or failed writes:\n" +
        "  PPMChildDatabase.pendingWrites()         // every write that did not land\n" +
        '  PPMChildDatabase.clearPending("plans")   // give up on them\n\n' +
        "End-to-end check (hydrate, compare, pending; add { write: true } to probe a real write):\n" +
        "  await PPMChildDatabase.selfTest()\n\n" +
        "Reload one collection from the database:\n" +
        '  await PPMChildDatabase.hydrateModule("plans", { force: true })'
    );
    return rows;
  }

  window.PPMChildDatabase = {
    MODULES,
    DATABASE_MODULES,
    APPEND_ONLY_MODULES,
    READ_ONLY_MODULES,

    /* Collections a workflow transaction spans. Exported because the workflow
       commits below flush them as a group, and a caller adding a new workflow
       needs to know the grouping exists. */
    STAGE_GATE_WORKFLOW_MODULES,
    BASELINE_WORKFLOW_MODULES,
    FINANCIAL_WORKFLOW_MODULES,
    RESOURCE_WORKFLOW_MODULES,

    // reads
    get,
    queryRows,

    // lifecycle
    hydrate,
    hydrateModule,
    ready,
    isHydrated: () => hydrated,

    /*
      Transactional workflows. Each one is a SECURITY DEFINER function in the
      database that commits several collections together, so a stage gate cannot be
      approved without its actions, and a budget cannot be approved without its
      request. These are the only way those state changes are permitted: the
      matching tables have trigger guards that refuse a direct write.
    */
    commitStageGateWorkflow,
    workflowReady,
    workflowStatus,
    commitBaselineWorkflow,
    commitFinancialWorkflow,
    commitResourceScenarioWorkflow,
    versionSnapshot,
    resourceDemandVersionSnapshot,

    // pending writes
    pendingWrites,
    clearPending,

    /*
      Diagnostics. Kept after the Stage 14 cleanup because they are how a failed
      write gets diagnosed. All of them read only - none can change where the
      application gets its data.
    */
    status,
    explain,
    validateLocal,
    flattenLocal,
    /* Stage 16: the row-level write path. ppm-data.js is the only intended caller. */
    saveOne,
    removeOne,
    compare,
    compareAll,
    selfTest,
    assuranceLevel
  };
})();
