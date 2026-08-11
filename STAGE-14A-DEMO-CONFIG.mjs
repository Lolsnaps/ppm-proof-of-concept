/*
  STAGE 14A - global configuration.

  These tables are scope_key based rather than project based, and several of them
  were still empty. That matters more than it sounds: with no reporting periods a
  status report has no period to belong to, and with no financial categories the
  cost lines cannot be grouped. Seeding them is part of "properly filled out".

  Values are taken from the application's own defaults in ppm-admin-utils.js,
  ppm-financial-utils.js and ppm-resource-utils.js, so the database now holds what
  the browser would have written for itself.
*/

import { CATEGORIES } from "./STAGE-14A-DEMO-FINANCE.mjs";
import { PEOPLE } from "./STAGE-14A-DEMO-PEOPLE.mjs";
import { addMonths, monthLabel, workday, addDays, at } from "./STAGE-14A-DEMO-DATES.mjs";

/* Reference data, keyed by category. The child adapter files these under
   scope_key = the category name, so each category is its own scope. */
const REFERENCE_DEFINITIONS = {
  projectTypes: ["Change project", "Regulatory", "Technology", "Product", "Operational", "M&A", "BAU"],
  businessAreas: [
    "Servicing",
    "Sales",
    "Propositions",
    "Mergers & Acquisitions",
    "Operations",
    "Technology",
    "Finance",
    "People",
    "Risk & Compliance"
  ],
  confidentialityLevels: ["Internal", "Confidential", "Highly Confidential", "Restricted"],
  priorities: ["Critical", "High", "Medium", "Low"],
  projectStatuses: ["Proposed", "Planned", "Active", "On Hold", "Completed", "Cancelled", "Archived"],
  reportingFrequencies: ["Weekly", "Fortnightly", "Monthly", "Quarterly"],
  ragStatuses: ["Not Assessed", "Green", "Amber", "Red"],
  raidTypes: ["Risk", "Assumption", "Issue", "Dependency"],
  taskStatuses: ["Not Started", "In Progress", "Blocked", "Complete", "Cancelled"],
  milestoneStatuses: ["Not Started", "In Progress", "Complete", "Overdue", "Cancelled"]
};

/* Mirrors referenceRow() in ppm-admin-utils.js exactly, including the identifier
   format, so the application recognises these as its own rows. */
function referenceRow(category, value, index) {
  const categoryCode = String(category)
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

/* Returned as [{ scopeKey, record }] because reference data is scoped per
   category, not globally. */
export function referenceData() {
  const rows = [];
  Object.entries(REFERENCE_DEFINITIONS).forEach(([category, values]) => {
    values.forEach((value, index) => {
      rows.push({ scopeKey: category, record: referenceRow(category, value, index) });
    });
  });
  return rows;
}

export function financialCategories() {
  return CATEGORIES.map((category) => ({
    ...category,
    active: true,
    system: true
  }));
}

/* Twelve monthly reporting periods against the existing default calendar, spanning
   the current financial year so every status report has a real period to sit in. */
export function reportingPeriods() {
  const rows = [];
  let cursor = "2026-04-01";
  for (let index = 0; index < 12; index += 1) {
    const start = cursor;
    const nextStart = addMonths(start, 1);
    const end = addDays(nextStart, -1);
    rows.push({
      periodId: `RP-${start.slice(0, 7)}`,
      calendarId: "CAL-00001",
      name: monthLabel(start),
      periodLabel: monthLabel(start),
      startDate: start,
      endDate: end,
      dueDate: workday(addDays(end, 5)),
      financialYear: "2026/27",
      sequence: index + 1,
      status: end < "2026-08-08" ? "Closed" : start <= "2026-08-08" ? "Open" : "Future",
      active: true
    });
    cursor = nextStart;
  }
  return rows;
}

/* Singleton stores. The whole record is the store, and record_key is GLOBAL. */
export function ragConfig() {
  return {
    scheduleAmberToleranceDays: 5,
    scheduleRedToleranceDays: 20,
    resourceAmberUtilisation: 100,
    resourceRedUtilisation: 115,
    financialAmberVariance: 5,
    financialRedVariance: 10,
    underUtilisationThreshold: 70,
    updatedAt: at("2026-08-08", 16, 37)
  };
}

export function resourceConfig() {
  return {
    overAllocationWarningPercent: 100,
    overAllocationCriticalPercent: 115,
    underUtilisationPercent: 70,
    includeProvisionalByDefault: true,
    warningThreshold: 100,
    overAllocationThreshold: 115,
    underUtilisationThreshold: 70,
    includeProvisionalInCapacity: true,
    standardDayHours: 7.5,
    maximumHierarchyDepth: 8,
    updatedAt: at("2026-08-08", 16, 37)
  };
}

/*
  Absence, which is what makes capacity reporting tell the truth. Deliberately
  includes a long-term absence and a contractor's end date, because both change
  available capacity in ways a simple holiday booking does not.
*/
export function resourceAbsence() {
  const entries = [
    ["RES-0103", "Annual leave", "2026-08-24", "2026-09-04", "Approved", "Two weeks booked before UAT entry."],
    ["RES-0104", "Annual leave", "2026-08-17", "2026-08-21", "Approved", ""],
    ["RES-0105", "Annual leave", "2026-09-14", "2026-09-25", "Approved", ""],
    [
      "RES-0113",
      "Long-term absence",
      "2026-07-06",
      "2026-10-02",
      "Approved",
      "Phased return planned from October. Business analysis cover arranged through the change team."
    ],
    ["RES-0114", "Annual leave", "2026-10-19", "2026-10-30", "Requested", ""],
    ["RES-0119", "Training", "2026-09-07", "2026-09-11", "Approved", "Data migration certification."],
    ["RES-0120", "Annual leave", "2026-12-21", "2027-01-01", "Approved", ""],
    ["RES-0107", "Annual leave", "2026-08-10", "2026-08-14", "Approved", ""],
    [
      "RES-0106",
      "Contract end",
      "2026-12-21",
      "2026-12-31",
      "Approved",
      "Interim contract ends 18 December. Capacity must not be planned beyond that date without an extension."
    ]
  ];

  return entries.map(([resourceId, type, start, end, status, notes], index) => {
    const found = PEOPLE.find((row) => row.resourceId === resourceId);
    return {
      absenceId: `ABS-${String(index + 1).padStart(4, "0")}`,
      resourceId,
      resourceName: found ? found.fullName : "",
      team: found ? found.team : "",
      absenceType: type,
      type,
      startDate: start,
      endDate: end,
      status,
      workingDays: 0,
      allDay: true,
      notes,
      recordedBy: "Rachel Okonjo",
      recordedByResourceId: "RES-0101",
      createdAt: at("2026-07-01", 9, 0),
      updatedAt: at("2026-07-01", 9, 0)
    };
  });
}
