/*
  STAGE 14A - financials, cost entries, budget approvals, benefits, resource
  demand and plan baselines.

  Numbers are internally consistent on purpose. The financial record's
  approvedBudget equals the sum of the approved budget lines; forecast equals the
  sum of forecast lines; estimateAtCompletion is actual plus remaining forecast;
  and variance follows from those. A demo where the summary contradicts the detail
  teaches nothing about whether the financial pages are correct.

  Note on guards: approved-budget fields, approval requests and plan baselines can
  only be written with the corresponding workflow GUC set. The build script sets
  them, which is why this data can exist at all.
*/

import { person } from "./STAGE-14A-DEMO-PEOPLE.mjs";
import { plansFor } from "./STAGE-14A-DEMO-DELIVERY.mjs";
import {
  TODAY,
  addDays,
  addMonths,
  workday,
  at,
  monthLabel,
  financialPeriod
} from "./STAGE-14A-DEMO-DATES.mjs";

/* The seven system cost categories from ppm-financial-utils.js. Using the real
   identifiers means the financial pages group demo spend correctly. */
export const CATEGORIES = [
  { categoryId: "CAT-0001", name: "Internal resource", description: "Internal people and delivery effort" },
  { categoryId: "CAT-0002", name: "External resource", description: "Contractors and temporary resource" },
  { categoryId: "CAT-0003", name: "Supplier", description: "Third-party supplier costs" },
  { categoryId: "CAT-0004", name: "Software", description: "Licences, subscriptions and software services" },
  { categoryId: "CAT-0005", name: "Infrastructure", description: "Technology and physical infrastructure" },
  { categoryId: "CAT-0006", name: "Contingency", description: "Approved cost contingency" },
  { categoryId: "CAT-0007", name: "Other", description: "Other approved project expenditure" }
];

/*
  How each project's budget splits across categories, and how far through its
  spend it is. Percentages sum to 100. The spend profile reflects the stage: a
  project at Closure has spent nearly everything, one at Intake nothing.
*/
const COST_PROFILE = {
  "PRJ-00006": { mix: [46, 14, 8, 18, 6, 6, 2], spent: 0.57, overrun: 0 },
  "PRJ-00007": { mix: [38, 26, 14, 6, 8, 6, 2], spent: 0.74, overrun: 0.09 },
  "PRJ-00008": { mix: [30, 10, 26, 22, 4, 6, 2], spent: 0.21, overrun: 0 },
  "PRJ-00009": { mix: [52, 12, 6, 16, 6, 6, 2], spent: 0.86, overrun: -0.03 },
  "PRJ-00010": { mix: [44, 16, 12, 16, 4, 6, 2], spent: 0.44, overrun: 0.02 },
  "PRJ-00011": { mix: [40, 22, 12, 14, 4, 6, 2], spent: 0.29, overrun: 0.04 },
  "PRJ-00012": { mix: [48, 18, 8, 16, 4, 4, 2], spent: 0.1, overrun: 0 },
  "PRJ-00013": { mix: [50, 12, 10, 18, 4, 4, 2], spent: 0, overrun: 0 },
  "PRJ-00014": { mix: [26, 34, 24, 6, 4, 4, 2], spent: 0.27, overrun: 0.03 },
  "PRJ-00015": { mix: [56, 14, 10, 12, 2, 4, 2], spent: 0, overrun: 0 },
  "PRJ-00016": { mix: [34, 18, 10, 26, 6, 4, 2], spent: 0.98, overrun: -0.02 },
  "PRJ-00017": { mix: [42, 10, 8, 6, 28, 4, 2], spent: 1, overrun: -0.11 }
};

const round2 = (value) => Math.round(value * 100) / 100;
const round1 = (value) => Math.round(value * 10) / 10;

/* Projects still at Intake have no approved budget, only an indicative cost.
   That distinction is what the budget approval workflow exists to cross. */
function hasApprovedBudget(project) {
  return project.currentStage !== "Intake";
}

/* ----------------------------------------------------------- cost line detail

   One line per category per financial period, which is how the financial page
   expects to aggregate. Periods run from project start to the earlier of today
   and project end, so no project has actuals booked in the future.
*/
export function financialEntriesFor(project) {
  const profile = COST_PROFILE[project.projectCode];
  const start = project.actualStartDate || project.forecastStartDate;
  const end = project.forecastEndDate || project.baselineEndDate;
  if (!profile || !start || !end || !hasApprovedBudget(project)) return [];

  const approved = Math.round(project.costEstimate * (1 - profile.overrun * 0.5));
  const rows = [];
  let index = 0;

  /* Periods with actuals: from the start to whichever comes first, today or the
     end of the project. */
  const periods = [];
  let cursor = `${start.slice(0, 7)}-01`;
  const lastPeriod = (end < TODAY ? end : TODAY).slice(0, 7);
  while (cursor.slice(0, 7) <= lastPeriod) {
    periods.push(cursor.slice(0, 7));
    cursor = addMonths(cursor, 1);
  }
  if (!periods.length) periods.push(start.slice(0, 7));

  CATEGORIES.forEach((category, categoryIdx) => {
    const share = profile.mix[categoryIdx] / 100;
    const categoryBudget = round2(approved * share);
    /* Contingency is budgeted but deliberately not spent unless the project has
       overrun, which is what makes the contingency line meaningful. */
    const isContingency = category.categoryId === "CAT-0006";
    const spendRate = isContingency ? Math.max(0, profile.overrun) * 2 : profile.spent;

    const perPeriodBudget = round2(categoryBudget / periods.length);
    periods.forEach((periodKey, periodIdx) => {
      index += 1;
      /* Spend ramps rather than being flat, because real cost profiles ramp. */
      const ramp = periods.length === 1 ? 1 : 0.6 + (0.8 * periodIdx) / (periods.length - 1);
      const actual = round2(
        Math.min(perPeriodBudget * ramp * spendRate * (1 + profile.overrun), perPeriodBudget * 1.6)
      );
      const committed = round2(actual * 0.14);
      const forecastCost = round2(perPeriodBudget * (1 + profile.overrun));
      const remaining = round2(Math.max(0, forecastCost - actual - committed));
      const fp = financialPeriod(`${periodKey}-01`);

      rows.push({
        financialEntryId: `FE-${project.projectCode.slice(-5)}-${String(index).padStart(3, "0")}`,
        projectCode: project.projectCode,
        categoryId: category.categoryId,
        categoryName: category.name,
        description: `${category.name} - ${monthLabel(`${periodKey}-01`)}`,
        financialPeriod: periodKey,
        financialYear: fp.financialYear,
        budgetAmount: perPeriodBudget,
        forecastCost,
        actualCost: actual,
        committedCost: committed,
        remainingForecast: remaining,
        notes:
          isContingency && actual > 0
            ? "Contingency drawn against the overrun approved by the portfolio board."
            : ""
      });
    });
  });

  return rows;
}

/* ------------------------------------------------------- project financials

   Exactly one record per project, which the register enforces via uniqueProject.
   Every total is derived from the cost lines so the summary and the detail agree.
*/
export function financialsFor(project) {
  const profile = COST_PROFILE[project.projectCode];
  if (!profile) return [];

  const owner = person(project.financeContactResourceId || project.projectManagerResourceId);
  const entries = financialEntriesFor(project);
  const approvedFromLines = round2(entries.reduce((sum, row) => sum + row.budgetAmount, 0));
  const approved = hasApprovedBudget(project) ? approvedFromLines : 0;

  const actual = round2(entries.reduce((sum, row) => sum + row.actualCost, 0));
  const committed = round2(entries.reduce((sum, row) => sum + row.committedCost, 0));

  /* Remaining forecast covers the whole rest of the project, not just the periods
     that have lines, so forecast reaches the full expected outturn. */
  const forecast = hasApprovedBudget(project)
    ? round2(project.costEstimate * (1 + profile.overrun))
    : 0;
  const remaining = round2(Math.max(0, forecast - actual - committed));
  const estimateAtCompletion = round2(actual + remaining + committed);
  const contingency = round2(approved * (profile.mix[5] / 100));
  const variance = round2(approved - estimateAtCompletion);
  const variancePercentage = approved ? round1((variance / approved) * 100) : 0;

  const record = {
    financialId: `FIN-${project.projectCode.slice(-5)}`,
    projectCode: project.projectCode,
    proposedBudget: hasApprovedBudget(project) ? approved : project.indicativeCosts,
    approvedBudget: approved,
    forecastCost: forecast,
    actualCost: actual,
    committedCost: committed,
    remainingForecast: remaining,
    contingency,
    estimateAtCompletion,
    budgetVariance: variance,
    budgetVariancePercentage: variancePercentage,
    budgetVariancePercentageAvailable: Boolean(approved),
    currency: "GBP",
    fundingSource: project.fundingSource,
    financialOwner: owner.fullName,
    financialOwnerResourceId: owner.resourceId,
    financialOwnerEmail: owner.email || "",
    financialRag: project.financialRag,
    financialCommentary: financialCommentary(project, variance, variancePercentage),
    lastFinancialUpdateDate: workday(addDays(TODAY, -4)),

    /* Mirrors the register's own aliases, which several pages still read. */
    budget: approved,
    forecast,
    actual,
    variance,
    lastUpdated: workday(addDays(TODAY, -4))
  };

  if (hasApprovedBudget(project)) {
    record.budgetApprovalStatus = "Approved";
    record.approvedBudgetVersion = project.projectCode === "PRJ-00007" ? 2 : 1;
    record.approvedBudgetRequestId = `FAR-${project.projectCode.slice(-5)}-001`;
    record.approvedAt = at(workday(addDays(project.actualStartDate || project.forecastStartDate, -7)), 14, 5);
    record.approvedByResourceId = "RES-0101";
    record.approvedBy = "Rachel Okonjo";
    record.approvalDate = workday(addDays(project.actualStartDate || project.forecastStartDate, -7));
  } else {
    record.budgetApprovalStatus = "No approved budget";
    record.approvedBudgetVersion = 0;
    record.approvedBudgetRequestId = "";
    record.approvedAt = "";
    record.approvedByResourceId = "";
    record.approvedBy = "";
    record.approvalDate = "";
  }

  return [record];
}

function financialCommentary(project, variance, percentage) {
  if (!hasApprovedBudget(project))
    return `No approved budget. Indicative cost of £${project.indicativeCosts.toLocaleString("en-GB")} carried from intake, pending a Discovery funding decision.`;
  if (variance < 0)
    return `Forecast outturn is £${Math.abs(variance).toLocaleString("en-GB")} above the approved budget, a variance of ${Math.abs(percentage)}%. ${project.reasonForSlippage ? project.reasonForSlippage : "Driven by scope added since baseline."} A budget change request is with the portfolio board.`;
  if (variance > 0)
    return `Forecast outturn is £${variance.toLocaleString("en-GB")} below the approved budget, a variance of ${percentage}%. The underspend is expected to be released at closure.`;
  return "Forecast outturn is in line with the approved budget. No variance to report.";
}

/* ------------------------------------------------- budget approval requests

   A mix of decided and pending, because the approval page needs both. Each
   request carries the budget snapshot taken at the time it was raised, which is
   what makes the decision auditable after the numbers have moved on.
*/
export function financialApprovalsFor(project) {
  if (!hasApprovedBudget(project)) return [];
  const profile = COST_PROFILE[project.projectCode];
  const financial = financialsFor(project)[0];
  const start = project.actualStartDate || project.forecastStartDate;
  const requester = person(project.projectManagerResourceId);
  const approver = person("RES-0101");
  const rows = [];

  /* The original approval, always present and always approved - that is how the
     project came to have a budget at all. */
  const initialAt = at(workday(addDays(start, -21)), 10, 15);
  rows.push({
    approvalId: `FAR-${project.projectCode.slice(-5)}-001`,
    projectCode: project.projectCode,
    requestType: "Initial budget approval",
    currentApprovedBudget: 0,
    proposedBudget: financial.approvedBudget,
    changeAmount: financial.approvedBudget,
    changePercentage: 0,
    reason: `Initial budget approval for ${project.projectName}, based on the cost estimate in the approved business case.`,
    requesterResourceId: requester.resourceId,
    requesterName: requester.fullName,
    requesterEmail: requester.email || "",
    approverResourceId: approver.resourceId,
    approverName: approver.fullName,
    approverEmail: approver.email || "",
    status: "Approved",
    requestedAt: initialAt,
    decisionAt: at(workday(addDays(start, -7)), 14, 5),
    decisionByResourceId: approver.resourceId,
    decisionByName: approver.fullName,
    decisionComments:
      "Approved at the portfolio board against the business case. Benefit measurement to be confirmed before the design gate.",
    budgetSnapshot: {
      approvedBudget: 0,
      forecastCost: 0,
      actualCost: 0,
      committedCost: 0,
      capturedAt: initialAt
    }
  });

  /* An uplift, only where the project has actually overrun. PRJ-00007's was
     approved; the others are still awaiting a decision, which gives the approval
     queue something to show. */
  if (profile.overrun > 0.02) {
    const raisedOn = workday(addDays(TODAY, project.projectCode === "PRJ-00007" ? -63 : -18));
    const uplift = round2(financial.estimateAtCompletion - financial.approvedBudget);
    const decided = project.projectCode === "PRJ-00007";
    rows.push({
      approvalId: `FAR-${project.projectCode.slice(-5)}-002`,
      projectCode: project.projectCode,
      requestType: "Budget increase",
      currentApprovedBudget: financial.approvedBudget,
      proposedBudget: round2(financial.approvedBudget + uplift),
      changeAmount: uplift,
      changePercentage: round1((uplift / financial.approvedBudget) * 100),
      reason:
        project.reasonForSlippage ||
        "Scope added since baseline, agreed through change control and not covered by contingency.",
      requesterResourceId: requester.resourceId,
      requesterName: requester.fullName,
      requesterEmail: requester.email || "",
      approverResourceId: approver.resourceId,
      approverName: approver.fullName,
      approverEmail: approver.email || "",
      status: decided ? "Approved" : "Pending",
      requestedAt: at(raisedOn, 11, 40),
      decisionAt: decided ? at(workday(addDays(raisedOn, 11)), 15, 20) : "",
      decisionByResourceId: decided ? approver.resourceId : "",
      decisionByName: decided ? approver.fullName : "",
      decisionComments: decided
        ? "Approved. The increase is driven by legacy data quality that could not reasonably have been known at baseline. Contingency is exhausted."
        : "",
      budgetSnapshot: {
        approvedBudget: financial.approvedBudget,
        forecastCost: financial.forecastCost,
        actualCost: financial.actualCost,
        committedCost: financial.committedCost,
        capturedAt: at(raisedOn, 11, 40)
      }
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ benefits

   A mix of project-level and programme-level benefits, because the benefits page
   supports both and the programme route uses a different storage scope. Values
   are strings rather than numbers, matching the register schema, since benefits
   are often expressed in units that are not money.
*/
const BENEFIT_CONTENT = {
  "PRJ-00006": [
    ["Cashable", "Reduction in inbound call volume", "0 calls", "90,000 calls a year", "Calls a year", "Telephony platform reporting compared against the 2025 baseline", "In delivery", "Medium"],
    ["Non-cashable", "Reduction in average handling time", "7.4 minutes", "6.5 minutes", "Minutes", "Telephony platform average handling time report", "In delivery", "Medium"],
    ["Member outcome", "Self-service adoption", "0%", "35%", "Percent of routine transactions", "Portal analytics against the servicing transaction log", "Approved", "Medium"]
  ],
  "PRJ-00007": [
    ["Cashable", "Legacy support and hosting cost avoided", "£180,000 a year", "£0 a year", "Pounds a year", "Infrastructure cost centre reporting", "Approved", "High"],
    ["Non-cashable", "Manual history lookup effort removed", "40 hours a month", "0 hours a month", "Hours a month", "Servicing team manual lookup log", "Approved", "Medium"],
    ["Risk reduction", "Unsupported platform removed from the estate", "1 platform", "0 platforms", "Platforms", "Technology risk register and CMDB", "Approved", "High"]
  ],
  "PRJ-00008": [
    ["Non-cashable", "Team leader time returned to coaching", "0 days a year", "150 days a year", "Days a year", "Workforce management adherence and scheduling reports", "Approved", "Medium"],
    ["Cashable", "Overtime spend reduction", "£112,000 a year", "£64,000 a year", "Pounds a year", "Payroll overtime line", "Proposed", "Low"],
    ["Member outcome", "Service level at seasonal peak", "78%", "82%", "Percent answered in 20 seconds", "Telephony service level reporting", "Approved", "Medium"]
  ],
  "PRJ-00009": [
    ["Revenue", "Uplift in intermediated new business", "0%", "18%", "Percent uplift", "New business system channel reporting", "In delivery", "High"],
    ["Non-cashable", "Adviser firm onboarding time", "15 working days", "5 working days", "Working days", "Agency onboarding log", "Partially realised", "High"],
    ["Cashable", "Rekeyed applications removed", "6,000 a year", "600 a year", "Applications a year", "New business processing statistics", "In delivery", "High"]
  ],
  "PRJ-00010": [
    ["Revenue", "Additional completed applications", "0", "2,100 a year", "Applications a year", "Web analytics funnel and new business system", "In delivery", "Medium"],
    ["Non-cashable", "Online application abandonment", "63%", "45%", "Percent abandoned", "Web analytics funnel reporting by step", "In delivery", "Medium"],
    ["Cashable", "Manual identity checks removed", "4,000 a year", "800 a year", "Checks a year", "New business identity check log", "Approved", "Medium"]
  ],
  "PRJ-00011": [
    ["Revenue", "Additional annual premium income from the repriced range", "£0", "£1,900,000 a year", "Pounds a year", "New business and premium income reporting", "Approved", "Low"],
    ["Cashable", "Administration cost reduction from product simplification", "£0", "£310,000 a year", "Pounds a year", "Policy administration cost model", "Approved", "Low"],
    ["Compliance", "Products with an evidenced fair value assessment", "12 of 14", "14 of 14", "Products", "Consumer Duty assessment register", "In delivery", "Medium"]
  ],
  "PRJ-00012": [
    ["Compliance", "Products with a complete outcome measure set", "0%", "100%", "Percent of products", "Consumer Duty assessment register", "Proposed", "Not Assessed"],
    ["Non-cashable", "Manual assessment effort removed", "40 days a year", "8 days a year", "Days a year", "Reporting cycle effort log", "Proposed", "Low"]
  ],
  "PRJ-00013": [
    ["Revenue", "Uplift in completed junior ISA applications", "0%", "30%", "Percent uplift", "New business system reporting", "Proposed", "Not Assessed"],
    ["Revenue", "Additional annual contributions through gifting", "£0", "£400,000 a year", "Pounds a year", "Contribution reporting by source", "Proposed", "Not Assessed"],
    ["Member outcome", "Elapsed time to first contribution", "18 days", "2 days", "Days", "New business processing statistics", "Proposed", "Not Assessed"]
  ],
  "PRJ-00014": [
    ["Growth", "Additional members", "0", "24,000", "Members", "Membership reporting after the transfer date", "Approved", "Medium"],
    ["Growth", "Additional funds under management", "£0", "£310,000,000", "Pounds", "Funds under management reporting", "Approved", "Medium"],
    ["Cashable", "Integration cost per transferred member", "£0", "Below £95", "Pounds per member", "Integration cost tracker against member count", "In delivery", "Medium"]
  ],
  "PRJ-00015": [
    ["Cashable", "Integration cost per member on subsequent transfers", "£95", "£60", "Pounds per member", "Integration cost tracker on the next transaction", "Proposed", "Not Assessed"],
    ["Non-cashable", "Transfer elapsed time reduction", "0 months", "4 months", "Months", "Transfer project actuals compared with Northern Counties", "Proposed", "Not Assessed"]
  ],
  "PRJ-00016": [
    ["Risk reduction", "Accounts with multi-factor authentication enforced", "0%", "100%", "Percent of accounts", "Identity platform coverage report", "Realised", "High"],
    ["Cashable", "Password reset calls avoided", "120 a month", "20 a month", "Calls a month", "Service desk ticket reporting", "Realised", "High"],
    ["Compliance", "2024 audit finding on authentication controls closed", "Open", "Closed", "Finding status", "Internal audit tracker", "Realised", "High"]
  ],
  "PRJ-00017": [
    ["Cashable", "Hosting and support cost avoided", "£96,000 a year", "£0 a year", "Pounds a year", "Infrastructure cost centre reporting", "Realised", "High"],
    ["Compliance", "Over-retained data disposed of", "0 TB", "11.2 TB", "Terabytes", "Disposal certificate and information asset register", "Realised", "High"],
    ["Risk reduction", "Unsupported servers removed", "4 servers", "0 servers", "Servers", "CMDB and technology risk register", "Realised", "High"]
  ]
};

export function benefitsFor(project) {
  const content = BENEFIT_CONTENT[project.projectCode] || [];
  const owner = person(project.benefitOwnerResourceId || project.sponsorResourceId || project.projectManagerResourceId);
  const anchor = project.forecastStartDate || project.dateLogged;

  return content.map((row, index) => {
    const [benefitType, description, baselineValue, targetValue, unit, method, status, confidence] = row;
    const realised = status === "Realised";
    const inFlight = status === "In delivery" || status === "Partially realised";
    const lastReview = inFlight || realised ? workday(addDays(TODAY, -24)) : "";

    return {
      benefitId: `BEN-${project.projectCode.slice(-5)}-${String(index + 1).padStart(2, "0")}`,
      linkLevel: "Project",
      programmeId: "",
      projectCode: project.projectCode,
      description,
      benefitType,
      type: benefitType,
      owner: owner.fullName,
      ownerResourceId: owner.resourceId,
      ownerEmail: owner.email || "",
      baselineValue,
      targetValue,
      target: targetValue,
      measurementUnit: unit,
      measurementMethod: method,
      dataSource: method,
      targetRealisationDate: workday(addDays(project.targetImplementationDate || anchor, 180)),
      realisationDate: workday(addDays(project.targetImplementationDate || anchor, 180)),
      leadIndicators:
        inFlight || realised
          ? "Weekly volume trend reviewed at the project board alongside adoption reporting."
          : "",
      currentValue: realised ? targetValue : inFlight ? "Tracking to target" : "",
      status,
      realisationConfidence: confidence,
      reviewFrequency: "Quarterly",
      lastReviewDate: lastReview,
      nextReviewDate: lastReview ? workday(addDays(lastReview, 91)) : "",
      commentary: realised
        ? "Realised and evidenced. Measurement has transferred to the benefit owner for twelve months of confirmation reporting."
        : inFlight
          ? "Tracking to target. Measurement baseline captured before implementation."
          : "Not yet in delivery. Measurement approach agreed and baseline to be captured before implementation.",
      evidence: realised ? "Closure report benefit evidence pack" : ""
    };
  });
}

/* Programme-level benefits, which store under a programme scope rather than a
   project. Included because that path is easy to get wrong and worth testing. */
export function programmeBenefits() {
  return [
    {
      programmeCode: "PRG-00001",
      record: {
        benefitId: "BEN-PRG001-01",
        linkLevel: "Programme",
        programmeId: "PRG-00001",
        projectCode: "",
        description: "Overall reduction in cost to serve per member",
        benefitType: "Cashable",
        type: "Cashable",
        owner: "Owen Pritchard",
        ownerResourceId: "RES-0111",
        ownerEmail: "owen.pritchard@example.com",
        baselineValue: "£31.40 per member",
        targetValue: "£26.10 per member",
        target: "£26.10 per member",
        measurementUnit: "Pounds per member per year",
        measurementMethod:
          "Servicing cost centre total divided by member count, reported quarterly and compared against the 2025 baseline.",
        dataSource: "Finance cost centre reporting and membership statistics",
        targetRealisationDate: "2028-03-31",
        realisationDate: "2028-03-31",
        leadIndicators: "Self-service adoption, call volume and average handling time.",
        currentValue: "£30.20 per member",
        status: "In delivery",
        realisationConfidence: "Medium",
        reviewFrequency: "Quarterly",
        lastReviewDate: "2026-07-15",
        nextReviewDate: "2026-10-14",
        commentary:
          "Programme-level benefit aggregating the servicing projects. Movement so far comes from PRJ-00016 and early self-service adoption.",
        evidence: ""
      }
    },
    {
      programmeCode: "PRG-00004",
      record: {
        benefitId: "BEN-PRG004-01",
        linkLevel: "Programme",
        programmeId: "PRG-00004",
        projectCode: "",
        description: "Membership growth through transfers of engagement",
        benefitType: "Growth",
        type: "Growth",
        owner: "Daniel Whitfield",
        ownerResourceId: "RES-0102",
        ownerEmail: "daniel.whitfield@example.com",
        baselineValue: "0 transferred members",
        targetValue: "24,000 transferred members",
        target: "24,000 transferred members",
        measurementUnit: "Members",
        measurementMethod:
          "Membership reporting at the transfer effective date and at twelve months, net of attrition.",
        dataSource: "Membership reporting",
        targetRealisationDate: "2028-11-30",
        realisationDate: "2028-11-30",
        leadIndicators: "Court timetable progress and independent expert report status.",
        currentValue: "0",
        status: "Approved",
        realisationConfidence: "Medium",
        reviewFrequency: "Quarterly",
        lastReviewDate: "2026-07-15",
        nextReviewDate: "2026-10-14",
        commentary:
          "Dependent entirely on PRJ-00014 completing. No benefit accrues until the transfer is effective.",
        evidence: ""
      }
    }
  ];
}

/* ------------------------------------------------------------ resource demand

   Demand rows are what make Team-projects scope work, so team is always set. The
   mix of Confirmed, Provisional and Requested is what the capacity views need in
   order to show anything interesting.
*/
export function resourceDemandFor(project) {
  const tasks = plansFor(project);
  if (!tasks.length) return [];

  /* One demand row per distinct owner on the plan, sized from the effort those
     tasks carry, so demand and plan agree. */
  const byOwner = new Map();
  tasks.forEach((task) => {
    if (!task.taskOwnerResourceId) return;
    const existing = byOwner.get(task.taskOwnerResourceId) || {
      hours: 0,
      first: task.forecastStartDate,
      last: task.forecastEndDate,
      team: task.owningTeam,
      taskId: task.taskId,
      taskName: task.taskName,
      phase: task.phase
    };
    existing.hours += task.estimatedEffortHours;
    if (task.forecastStartDate < existing.first) existing.first = task.forecastStartDate;
    if (task.forecastEndDate > existing.last) existing.last = task.forecastEndDate;
    byOwner.set(task.taskOwnerResourceId, existing);
  });

  const requestor = person(project.projectManagerResourceId);
  const rows = [];
  let index = 0;

  byOwner.forEach((detail, resourceId) => {
    index += 1;
    const who = person(resourceId);
    const placeholder = resourceId === "RES-0118";
    /* Future demand is provisional, current demand is confirmed, and the
       unallocated engineer is a request rather than an allocation. */
    const status = placeholder
      ? "Requested"
      : detail.first > TODAY
        ? "Provisional"
        : "Confirmed";
    const approver = person("RES-0109");

    rows.push({
      demandId: `DEM-${project.projectCode.slice(-5)}-${String(index).padStart(2, "0")}`,
      projectCode: project.projectCode,
      phaseReference: detail.phase,
      linkedTaskId: detail.taskId,
      linkedTaskName: detail.taskName,
      roleSkill: who.role || who.jobTitle || "Delivery",
      resourceId: placeholder ? "" : who.resourceId,
      requestedResourceKind: placeholder ? "Generic role" : "Named person",
      resourceName: placeholder ? "Developer (unallocated)" : who.fullName,
      team: detail.team,
      owningTeam: detail.team,
      requiredTeam: detail.team,
      startDate: detail.first,
      endDate: detail.last,
      allocationMethod: "Hours",
      allocationPercentage: 0,
      hours: detail.hours,
      normalisedHours: detail.hours,
      status,
      confidence: status === "Confirmed" ? "High" : status === "Provisional" ? "Medium" : "Low",
      priority: project.priority,
      notes: placeholder
        ? "Unfilled engineering post. Held as a request until the vacancy is filled or a contractor is approved."
        : "",
      requestorResourceId: requestor.resourceId,
      approverResourceId: status === "Requested" ? "" : approver.resourceId,
      createdAt: at(workday(addDays(project.forecastStartDate, -14)), 10, 0),
      updatedAt: at(workday(addDays(TODAY, -9)), 16, 30),
      history: [
        {
          changedAt: at(workday(addDays(project.forecastStartDate, -14)), 10, 0),
          fromStatus: "",
          toStatus: status === "Confirmed" ? "Provisional" : status,
          changedBy: requestor.fullName
        }
      ].concat(
        status === "Confirmed"
          ? [
              {
                changedAt: at(workday(addDays(project.forecastStartDate, -3)), 11, 15),
                fromStatus: "Provisional",
                toStatus: "Confirmed",
                changedBy: approver.fullName
              }
            ]
          : []
      )
    });
  });

  return rows;
}

/* ---------------------------------------------------------- plan baselines

   Only projects past the design gate have an approved baseline, because that is
   when a baseline is set. PRJ-00007 also carries a pending rebaseline request,
   which is the record the baseline approval workflow acts on.
*/
export function baselinesFor(project) {
  const tasks = plansFor(project);
  const gated = ["Build", "Test", "Implementation", "Hypercare", "Closure"];
  if (!tasks.length || !gated.includes(project.currentStage)) return [];

  const approver = person("RES-0101");
  const approvedOn = workday(addDays(project.baselineStartDate, 45));

  return [
    {
      baselineId: `BL-${project.projectCode.slice(-5)}-001`,
      projectCode: project.projectCode,
      version: 1,
      status: "Approved",
      reason: "Initial plan baseline set at the design gate.",
      impact: "None. This is the first baseline and establishes the schedule the project reports against.",
      approvedBy: approver.fullName,
      approvedByResourceId: approver.resourceId,
      approvalDate: approvedOn,
      approvedAt: at(approvedOn, 15, 45),
      taskBaselines: tasks.map((task) => ({
        taskId: task.taskId,
        baselineStartDate: task.baselineStartDate,
        baselineEndDate: task.baselineEndDate
      }))
    }
  ];
}

export function baselineRequestsFor(project) {
  /* Only the Red migration project is asking to rebaseline, which is exactly the
     situation a rebaseline exists for. */
  if (project.projectCode !== "PRJ-00007") return [];
  const tasks = plansFor(project);
  const requester = person(project.projectManagerResourceId);
  const raisedOn = workday(addDays(TODAY, -12));

  return [
    {
      requestId: `BLR-${project.projectCode.slice(-5)}-001`,
      projectCode: project.projectCode,
      status: "Pending",
      requestedBy: requester.fullName,
      requestedByResourceId: requester.resourceId,
      requestedAt: at(raisedOn, 9, 50),
      reason:
        "Legacy data quality is materially worse than profiled at Discovery. Pre-2004 unit prices are missing in about 41,000 rows, which was not visible until full history was loaded in trial three.",
      impact:
        "Implementation moves from 28 August to 11 December 2026, a slip of 15 weeks. The dependency into PRJ-00014 moves with it, and the PRJ-00006 test data refresh moves by four weeks.",
      existingBaseline: tasks.map((task) => ({
        taskId: task.taskId,
        baselineStartDate: task.baselineStartDate,
        baselineEndDate: task.baselineEndDate
      })),
      proposedBaseline: tasks.map((task) => ({
        taskId: task.taskId,
        baselineStartDate: task.forecastStartDate,
        baselineEndDate: task.forecastEndDate
      }))
    }
  ];
}
