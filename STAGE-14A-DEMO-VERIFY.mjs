/*
  STAGE 14A - offline verification of the generated demo data.

    node STAGE-14A-DEMO-VERIFY.mjs

  Grammar parsing proves the SQL is well formed. It cannot prove the data is
  valid, and those are different failures: a malformed date, an undefined slipping
  into a payload, a record with no key, or a stage gate that carries history and
  will be refused by its insert guard all parse perfectly and then fail on apply.

  This checks the things that actually go wrong, so a problem is found here rather
  than half way through applying to the database.
*/

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { MODULES } from "./STAGE-14A-DEMO-DATA-GENERATOR.mjs";
import { PEOPLE, PROGRAMMES, BY_ID } from "./STAGE-14A-DEMO-PEOPLE.mjs";
import { PROJECTS } from "./STAGE-14A-DEMO-PROJECTS.mjs";
import { plansFor, milestonesFor } from "./STAGE-14A-DEMO-DELIVERY.mjs";
import { raidFor } from "./STAGE-14A-DEMO-RAID.mjs";
import {
  financialsFor,
  financialEntriesFor,
  financialApprovalsFor,
  benefitsFor,
  resourceDemandFor,
  baselinesFor,
  baselineRequestsFor,
  CATEGORIES
} from "./STAGE-14A-DEMO-FINANCE.mjs";
import {
  actionsFor,
  decisionsFor,
  documentsFor,
  statusReportsFor,
  stageGatesFor,
  ragHistoryFor
} from "./STAGE-14A-DEMO-GOVERNANCE.mjs";
import { referenceData, reportingPeriods, resourceAbsence } from "./STAGE-14A-DEMO-CONFIG.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let checks = 0;
const failures = [];

function check(label, condition, detail) {
  checks += 1;
  if (!condition) failures.push(`${label}${detail ? ` - ${detail}` : ""}`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/* A date field is either empty or a real calendar date. "2026-02-30" matches the
   pattern but is not a date, so it is round-tripped through Date to be sure. */
function validDate(value) {
  if (value === "" || value === null || value === undefined) return true;
  if (!ISO_DATE.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === value;
}

function walk(value, path, onLeaf) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, onLeaf));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => walk(item, `${path}.${key}`, onLeaf));
    return;
  }
  onLeaf(value, path);
}

/* ------------------------------------------------------- collect every record */

const ALL = [];
const CHILD_BUILDERS = {
  plans: plansFor,
  milestones: milestonesFor,
  raid: raidFor,
  actions: actionsFor,
  decisions: decisionsFor,
  documents: documentsFor,
  financials: financialsFor,
  financialEntries: financialEntriesFor,
  financialApprovals: financialApprovalsFor,
  benefits: benefitsFor,
  statusReports: statusReportsFor,
  ragHistory: ragHistoryFor,
  resourceDemand: resourceDemandFor,
  planBaselines: baselinesFor,
  baselineRequests: baselineRequestsFor
};

PROJECTS.forEach((project) => {
  Object.entries(CHILD_BUILDERS).forEach(([moduleName, builder]) => {
    builder(project).forEach((record) =>
      ALL.push({ moduleName, projectCode: project.projectCode, record })
    );
  });
  stageGatesFor(project).forEach(({ draft, final }) => {
    ALL.push({ moduleName: "stageGates", projectCode: project.projectCode, record: draft });
    if (final) ALL.push({ moduleName: "stageGates:final", projectCode: project.projectCode, record: final });
  });
});

/* ------------------------------------------------------------------- 1. leaves */

const projectRecords = PROJECTS.map((project) => ({ moduleName: "projects", projectCode: project.projectCode, record: project }));
const peopleRecords = PEOPLE.map((row) => ({ moduleName: "people", projectCode: "", record: row }));

[...peopleRecords, ...projectRecords, ...ALL].forEach(({ moduleName, projectCode, record }) => {
  walk(record, `${moduleName}${projectCode ? `/${projectCode}` : ""}`, (value, path) => {
    check("no undefined value", value !== undefined, path);
    check(
      "no NaN or Infinity",
      typeof value !== "number" || Number.isFinite(value),
      `${path} = ${value}`
    );
    /* Anything that looks like a date must be one. Catches an off-by-one month
       or a rolled-over day produced by arithmetic. */
    if (typeof value === "string" && /Date$|^date|At$/.test(path.split(".").pop() || "")) {
      const key = path.split(".").pop();
      if (/At$/.test(key) && value) {
        check("timestamp is ISO with milliseconds", ISO_INSTANT.test(value) || ISO_DATE.test(value), `${path} = ${value}`);
      } else {
        check("date is a real calendar date", validDate(value), `${path} = ${value}`);
      }
    }
  });
});

/* --------------------------------------------------------- 2. keys and modules */

const seen = new Map();
ALL.forEach(({ moduleName, projectCode, record }) => {
  const realModule = moduleName.replace(":final", "");
  const definition = MODULES[realModule];
  check(`module ${realModule} exists in the adapter map`, Boolean(definition));
  if (!definition) return;

  const key = String(record[definition.idField] || "").trim();
  check(`${realModule} record has a ${definition.idField}`, key.length > 0, `${projectCode}`);

  if (moduleName.endsWith(":final")) return;
  const composite = `${realModule}|${projectCode}|${key}`;
  check(`no duplicate key ${composite}`, !seen.has(composite));
  seen.set(composite, true);
});

/* ----------------------------------------------- 3. referential integrity */

const PROGRAMME_CODES = new Set(PROGRAMMES.map((row) => row.programmeCode));
const PROJECT_CODES = new Set(PROJECTS.map((row) => row.projectCode));

PROJECTS.forEach((project) => {
  check("project names an existing programme", PROGRAMME_CODES.has(project.programmeId), project.projectCode);
  check("project has a name", Boolean(project.projectName), project.projectCode);
  check("project has a code", /^PRJ-\d{5}$/.test(project.projectCode), project.projectCode);
  check(
    "project manager exists in the directory",
    BY_ID.has(project.projectManagerResourceId),
    `${project.projectCode} -> ${project.projectManagerResourceId}`
  );
  check(
    "project sponsor exists in the directory",
    BY_ID.has(project.sponsorResourceId),
    `${project.projectCode} -> ${project.sponsorResourceId}`
  );
  /* Forecast end must not precede forecast start, or every duration in the tool
     goes negative. */
  if (project.forecastStartDate && project.forecastEndDate)
    check(
      "forecast end is after forecast start",
      project.forecastEndDate > project.forecastStartDate,
      project.projectCode
    );
  check(
    "percentage complete is 0-100",
    project.percentageComplete >= 0 && project.percentageComplete <= 100,
    project.projectCode
  );
});

PEOPLE.forEach((row) => {
  check("person has a resource id", /^RES-\d{4}$/.test(row.resourceId), row.resourceId);
  check("person has a name", Boolean(row.fullName), row.resourceId);
  if (row.managerResourceId)
    check("manager exists in the directory", BY_ID.has(row.managerResourceId), `${row.resourceId} -> ${row.managerResourceId}`);
  (row.selectedProjectCodes || []).forEach((code) =>
    check("selected project code exists", PROJECT_CODES.has(code), `${row.resourceId} -> ${code}`)
  );
  /* A person holding an access role but no login is fine. A person with neither a
     role nor a name would be meaningless. */
  if (row.accessScope === "Selected projects")
    check(
      "selected-projects scope names at least one project",
      (row.selectedProjectCodes || []).length > 0,
      row.resourceId
    );
});

/* ------------------------------------------------- 4. guard preconditions */

/*
  The stage-gate insert guard refuses anything that is not a clean Draft. If this
  check fails the apply will fail, so it is worth asserting exactly what the
  trigger asserts.
*/
ALL.filter((row) => row.moduleName === "stageGates").forEach(({ projectCode, record }) => {
  check("draft gate workflowStatus is Draft", record.workflowStatus === "Draft", `${projectCode}/${record.gateId}`);
  check(
    "draft gate route status is not pending or decided",
    !["Pending", "Approved", "Rejected"].includes(record.routeApprovalStatus),
    `${projectCode}/${record.gateId}`
  );
  ["submissionHistory", "decisionHistory", "routeApprovalHistory", "linkedActionIds"].forEach((field) =>
    check(`draft gate ${field} is empty`, (record[field] || []).length === 0, `${projectCode}/${record.gateId}`)
  );
  check("draft gate has no linked decision", !record.linkedDecisionId, `${projectCode}/${record.gateId}`);
});

/* rag_history is append-only and its guard requires a project and a key, and a
   dimensions object it can derive the reporting columns from. */
ALL.filter((row) => row.moduleName === "ragHistory").forEach(({ projectCode, record }) => {
  check("rag snapshot names a project", Boolean(projectCode), record.statusId);
  check(
    "rag snapshot has a dimensions object",
    record.dimensions && typeof record.dimensions === "object" && !Array.isArray(record.dimensions),
    record.statusId
  );
  check("rag snapshot has an overall dimension", Boolean(record.dimensions.overall), record.statusId);
  Object.entries(record.dimensions).forEach(([key, dim]) => {
    check(`rag dimension ${key} has calculated and reported`, Boolean(dim.calculated && dim.reported), record.statusId);
    /* An override without a justification is exactly what the audit trail is
       meant to make impossible to hide. */
    if (dim.override) check(`rag override ${key} has a justification`, Boolean(dim.justification), record.statusId);
  });
});

/* ------------------------------------------------ 5. internal consistency */

PROJECTS.forEach((project) => {
  const financial = financialsFor(project)[0];
  const entries = financialEntriesFor(project);
  if (!financial) return;

  if (entries.length) {
    const summed = Math.round(entries.reduce((total, row) => total + row.budgetAmount, 0) * 100) / 100;
    check(
      "approved budget equals the sum of the budget lines",
      Math.abs(summed - financial.approvedBudget) < 0.02,
      `${project.projectCode}: lines ${summed} vs record ${financial.approvedBudget}`
    );
    const actual = Math.round(entries.reduce((total, row) => total + row.actualCost, 0) * 100) / 100;
    check(
      "actual cost equals the sum of the actual lines",
      Math.abs(actual - financial.actualCost) < 0.02,
      `${project.projectCode}: lines ${actual} vs record ${financial.actualCost}`
    );
    entries.forEach((row) =>
      check(
        "cost line uses a real category",
        CATEGORIES.some((category) => category.categoryId === row.categoryId),
        `${project.projectCode}/${row.financialEntryId}`
      )
    );
    /* Nothing should be booked as actual spend in the future. */
    entries.forEach((row) =>
      check("cost line period is not in the future", row.financialPeriod <= "2026-08", `${project.projectCode}/${row.financialEntryId}`)
    );
  }

  check(
    "estimate at completion equals actual plus committed plus remaining",
    Math.abs(financial.estimateAtCompletion - (financial.actualCost + financial.committedCost + financial.remainingForecast)) < 0.02,
    project.projectCode
  );
  check(
    "budget variance equals approved minus estimate at completion",
    Math.abs(financial.budgetVariance - (financial.approvedBudget - financial.estimateAtCompletion)) < 0.02,
    project.projectCode
  );

  /* A project at Intake must not have an approved budget: that is the whole point
     of the approval gate, and the trigger enforces it too. */
  if (project.currentStage === "Intake")
    check("intake project has no approved budget", financial.approvedBudget === 0, project.projectCode);

  /* Plan and milestones must agree, since milestones are derived from the plan. */
  const tasks = plansFor(project);
  const milestones = milestonesFor(project);
  if (tasks.length) check("a project with a plan has milestones", milestones.length > 0, project.projectCode);
  else check("a project with no plan has no milestones", milestones.length === 0, project.projectCode);

  tasks.forEach((task) => {
    check(
      "task forecast end is not before forecast start",
      task.forecastEndDate >= task.forecastStartDate,
      `${project.projectCode}/${task.taskId}`
    );
    check(
      "task owner is in the directory",
      BY_ID.has(task.taskOwnerResourceId),
      `${project.projectCode}/${task.taskId} -> ${task.taskOwnerResourceId}`
    );
    check(
      "completed task is 100 percent",
      task.status !== "Complete" || task.percentageComplete === 100,
      `${project.projectCode}/${task.taskId}`
    );
    task.dependencies.forEach((dependency) =>
      check(
        "task dependency points at a task in the same plan",
        tasks.some((row) => row.taskId === dependency),
        `${project.projectCode}/${task.taskId} -> ${dependency}`
      )
    );
  });

  /* Demand must carry a team, or Team-projects scope resolves to nothing. */
  resourceDemandFor(project).forEach((row) =>
    check("demand row has a team", Boolean(row.team), `${project.projectCode}/${row.demandId}`)
  );

  /* An off-track project must say why and what is being done, otherwise the RAG
     is just a colour. */
  if (["Red", "Amber"].includes(project.overallRag)) {
    check("off-track project states a reason for slippage", Boolean(project.reasonForSlippage), project.projectCode);
    check("off-track project states a return-to-green plan", Boolean(project.returnToGreen), project.projectCode);
  }

  /* Every RAID dependency naming another project must name one that exists. */
  raidFor(project)
    .filter((row) => row.relatedProject)
    .forEach((row) =>
      check(
        "RAID dependency names a project that exists",
        PROJECT_CODES.has(row.relatedProject) || row.relatedProject.startsWith("PRJ-000"),
        `${project.projectCode}/${row.raidId} -> ${row.relatedProject}`
      )
    );
});

/* --------------------------------------------------------- 6. config tables */

const periods = reportingPeriods();
check("twelve reporting periods", periods.length === 12);
periods.forEach((period) => {
  check("period end is after period start", period.endDate > period.startDate, period.periodId);
  check("period has a due date", validDate(period.dueDate), period.periodId);
});

referenceData().forEach((entry) => {
  check("reference row has a scope", Boolean(entry.scopeKey), entry.record.referenceId);
  check("reference row has an id", Boolean(entry.record.referenceId), entry.scopeKey);
});

resourceAbsence().forEach((row) => {
  check("absence names a person in the directory", BY_ID.has(row.resourceId), row.absenceId);
  check("absence end is on or after start", row.endDate >= row.startDate, row.absenceId);
});

/* --------------------------------------------- 7. the emitted SQL itself */

const sql = readFileSync(join(HERE, "STAGE-14A-DEMO-DATA.sql"), "utf8");
check("emitted SQL contains no undefined", !sql.includes("undefined"));
check("emitted SQL contains no NaN", !/\bNaN\b/.test(sql));
check("emitted SQL contains no [object Object]", !sql.includes("[object Object]"));
check("emitted SQL opens a transaction", sql.includes("begin;"));
check("emitted SQL commits", sql.trimEnd().endsWith("commit;"));
check("workflow settings are transaction-local", !/^set (?!local)/m.test(sql));
/* A stray secret in a file that ends up in a public repository is the one
   mistake with no recovery, so it is asserted rather than assumed. */
check("no service role key", !/sb_secret|service_role/i.test(sql));
check("no JWT-looking string", !/eyJ[A-Za-z0-9_-]{20,}/.test(sql));

const removeSql = readFileSync(join(HERE, "STAGE-14A-DEMO-DATA-REMOVE.sql"), "utf8");
const deletes = removeSql.match(/^delete from [^\n]*$/gm) || [];
check("every delete is filtered by the seed marker", deletes.every((line) => line.includes("demoDataSet")), `${deletes.length} deletes`);
check("remove script restores the append-only trigger", removeSql.includes("enable trigger trg_rag_history_immutable"));

/* Comments are stripped first: the header deliberately names PRJ-00001 to
   PRJ-00005 to say they are left alone, and matching that prose would be a false
   alarm. What matters is that no statement references them. */
const removeStatements = removeSql
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/--[^\n]*/g, "");
check(
  "no statement in the remove script references PRJ-00001 to PRJ-00005",
  !/PRJ-0000[1-5]/.test(removeStatements)
);
check(
  "no statement in the remove script references the four existing people",
  !/RES-000[1-4]/.test(removeStatements)
);

/* -------------------------------------------------------------------- report */

console.log(`STAGE 14A demo data verification: ${checks} checks`);
if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`);
  failures.slice(0, 40).forEach((line) => console.log(`  x ${line}`));
  if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
  process.exitCode = 1;
} else {
  console.log("\nAll checks passed.");
}
