/*
  STAGE 14A - demo people, portfolio and programmes.

  Access roles and scopes are drawn from the nine real roles in ppm-auth-utils.js.
  The spread is deliberate: permission testing needs subjects at every level,
  including the awkward ones (Team projects, Selected projects, an inactive
  leaver, and a placeholder with no login).

  None of these people has a login. auth_user_id stays null because
  private.guard_person_identity() refuses an attached login on insert, and
  because linking is an owner-only act through public.ppm_link_person_login().
  To make one of them a real tester, create the Supabase Auth user and link it.
*/

export const TEAMS = {
  pmo: "PMO",
  change: "Change Delivery",
  tech: "Technology",
  digital: "Digital",
  servicing: "Member Servicing",
  ops: "Operations",
  finance: "Finance",
  risk: "Risk & Compliance",
  data: "Data & MI"
};

/*
  RES-0101 upwards: clear of the RES-000N block the application has already
  issued, so the next identifier the app generates cannot collide with a demo
  person, and demo people are recognisable at a glance in the directory.
*/
export const PEOPLE = [
  {
    resourceId: "RES-0101",
    fullName: "Rachel Okonjo",
    email: "rachel.okonjo@example.com",
    accessRole: "Portfolio Manager / PMO Manager",
    accessScope: "Portfolio-wide",
    team: TEAMS.pmo,
    department: "Change and Transformation",
    jobTitle: "Head of PMO",
    role: "Portfolio Manager",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2021-03-01",
    accountStatus: "Not enabled"
  },
  {
    resourceId: "RES-0102",
    fullName: "Daniel Whitfield",
    email: "daniel.whitfield@example.com",
    accessRole: "Executive / Steering User",
    accessScope: "Portfolio-wide",
    team: TEAMS.ops,
    department: "Executive",
    jobTitle: "Chief Operating Officer",
    role: "Executive Sponsor",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2018-09-17",
    accountStatus: "Not enabled"
  },
  {
    resourceId: "RES-0103",
    fullName: "Priya Raghavan",
    email: "priya.raghavan@example.com",
    accessRole: "Project Manager",
    accessScope: "Assigned projects",
    team: TEAMS.change,
    department: "Change and Transformation",
    jobTitle: "Senior Project Manager",
    role: "Project Manager",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2022-01-10",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0101"
  },
  {
    resourceId: "RES-0104",
    fullName: "Tom Bradshaw",
    email: "tom.bradshaw@example.com",
    accessRole: "Project Manager",
    accessScope: "Assigned projects",
    team: TEAMS.change,
    department: "Change and Transformation",
    jobTitle: "Project Manager",
    role: "Project Manager",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2023-04-03",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0101"
  },
  {
    resourceId: "RES-0105",
    fullName: "Aisha Farouk",
    email: "aisha.farouk@example.com",
    accessRole: "Project Manager",
    accessScope: "Assigned projects",
    team: TEAMS.tech,
    department: "Technology",
    jobTitle: "Technical Project Manager",
    role: "Project Manager",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2020-11-02",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0109"
  },
  {
    /* Contractor on a fixed term, and the only person scoped to an explicit
       list. Use this one to prove Selected-projects scope really does hide
       everything not named. */
    resourceId: "RES-0106",
    fullName: "Greg Sanderson",
    email: "greg.sanderson@example.com",
    accessRole: "Project Manager",
    accessScope: "Selected projects",
    selectedProjectCodes: ["PRJ-00008", "PRJ-00012"],
    team: TEAMS.change,
    department: "Change and Transformation",
    jobTitle: "Interim Project Manager",
    role: "Project Manager",
    resourceKind: "Named person",
    resourceType: "Contractor",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2026-02-02",
    effectiveEndDate: "2026-12-18",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0101"
  },
  {
    resourceId: "RES-0107",
    fullName: "Marianne Doyle",
    email: "marianne.doyle@example.com",
    accessRole: "PMO Analyst",
    accessScope: "Portfolio-wide",
    team: TEAMS.pmo,
    department: "Change and Transformation",
    jobTitle: "PMO Analyst",
    role: "PMO Analyst",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2024-06-24",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0101"
  },
  {
    resourceId: "RES-0108",
    fullName: "Callum Reid",
    email: "callum.reid@example.com",
    accessRole: "PMO Analyst",
    accessScope: "Portfolio-wide",
    team: TEAMS.pmo,
    department: "Change and Transformation",
    jobTitle: "Planning and Reporting Analyst",
    role: "PMO Analyst",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Part time",
    standardWeeklyCapacity: 22.5,
    effectiveStartDate: "2025-01-13",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0101"
  },
  {
    /* Team-projects scope. Their visibility comes from Technology owning plan
       tasks and demand rows, not from being named on any project. */
    resourceId: "RES-0109",
    fullName: "Stephen Nkemelu",
    email: "stephen.nkemelu@example.com",
    accessRole: "Resource Manager / Team Manager",
    accessScope: "Team projects",
    team: TEAMS.tech,
    department: "Technology",
    jobTitle: "Head of Technology Delivery",
    role: "Resource Manager",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2019-07-08",
    accountStatus: "Not enabled"
  },
  {
    resourceId: "RES-0110",
    fullName: "Helen Marsh",
    email: "helen.marsh@example.com",
    accessRole: "Resource Manager / Team Manager",
    accessScope: "Team projects",
    team: TEAMS.servicing,
    department: "Member Servicing",
    jobTitle: "Member Servicing Manager",
    role: "Resource Manager",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2017-02-20",
    accountStatus: "Not enabled"
  },
  {
    resourceId: "RES-0111",
    fullName: "Owen Pritchard",
    email: "owen.pritchard@example.com",
    accessRole: "Project Sponsor / Project Lead",
    accessScope: "Assigned projects",
    team: TEAMS.servicing,
    department: "Member Servicing",
    jobTitle: "Director of Member Servicing",
    role: "Sponsor",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2016-05-09",
    accountStatus: "Not enabled"
  },
  {
    resourceId: "RES-0112",
    fullName: "Nadia Kaur",
    email: "nadia.kaur@example.com",
    accessRole: "Project Sponsor / Project Lead",
    accessScope: "Assigned projects",
    team: TEAMS.digital,
    department: "Propositions and Marketing",
    jobTitle: "Director of Propositions",
    role: "Sponsor",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2021-10-04",
    accountStatus: "Not enabled"
  },
  {
    resourceId: "RES-0113",
    fullName: "Joseph Adeyemi",
    email: "joseph.adeyemi@example.com",
    accessRole: "Project Team Member",
    accessScope: "Assigned projects",
    team: TEAMS.tech,
    department: "Technology",
    jobTitle: "Lead Business Analyst",
    role: "Business Analyst",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2022-08-15",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0109"
  },
  {
    resourceId: "RES-0114",
    fullName: "Ffion Davies",
    email: "ffion.davies@example.com",
    accessRole: "Project Team Member",
    accessScope: "Assigned projects",
    team: TEAMS.tech,
    department: "Technology",
    jobTitle: "Test Lead",
    role: "Test Lead",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2023-09-11",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0109"
  },
  {
    resourceId: "RES-0115",
    fullName: "Martin Cole",
    email: "martin.cole@example.com",
    accessRole: "Project Team Member",
    accessScope: "Assigned projects",
    team: TEAMS.finance,
    department: "Finance",
    jobTitle: "Finance Business Partner",
    role: "Finance Contact",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2020-01-06",
    accountStatus: "Not enabled"
  },
  {
    resourceId: "RES-0116",
    fullName: "Yvonne Baptiste",
    email: "yvonne.baptiste@example.com",
    accessRole: "Read-only / Auditor",
    accessScope: "Selected projects",
    selectedProjectCodes: ["PRJ-00007", "PRJ-00010", "PRJ-00013"],
    team: TEAMS.risk,
    department: "Risk and Compliance",
    jobTitle: "Internal Audit Manager",
    role: "Auditor",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2019-04-01",
    accountStatus: "Not enabled"
  },
  {
    /* A leaver, retained because history references them. Deactivated people
       must still resolve as task owners and in audit trails. */
    resourceId: "RES-0117",
    fullName: "Ian Gallagher",
    email: "ian.gallagher@example.com",
    accessRole: "",
    accessScope: "",
    team: TEAMS.change,
    department: "Change and Transformation",
    jobTitle: "Project Manager",
    role: "Project Manager",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2019-06-03",
    effectiveEndDate: "2026-05-29",
    active: false,
    accountStatus: "Disabled"
  },
  {
    /* Unnamed capacity. Placeholders are how a plan can be resourced before
       anyone is recruited, and they must never be able to hold a login. */
    resourceId: "RES-0118",
    fullName: "Developer (unallocated)",
    email: "",
    accessRole: "",
    accessScope: "",
    team: TEAMS.tech,
    department: "Technology",
    jobTitle: "Software Engineer",
    role: "Developer",
    resourceKind: "Generic role",
    resourceType: "Vacancy",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2026-04-01",
    placeholder: true,
    accountStatus: "Not enabled"
  },
  {
    resourceId: "RES-0119",
    fullName: "Sian Roberts",
    email: "sian.roberts@example.com",
    accessRole: "Project Team Member",
    accessScope: "Assigned projects",
    team: TEAMS.data,
    department: "Technology",
    jobTitle: "Data Migration Lead",
    role: "Data Lead",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Full time",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2024-02-05",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0109"
  },
  {
    resourceId: "RES-0120",
    fullName: "Dominic Fry",
    email: "dominic.fry@example.com",
    accessRole: "Project Team Member",
    accessScope: "Assigned projects",
    team: TEAMS.change,
    department: "Change and Transformation",
    jobTitle: "Change and Communications Lead",
    role: "Change Lead",
    resourceKind: "Named person",
    resourceType: "Permanent",
    workingPattern: "Compressed hours",
    standardWeeklyCapacity: 37.5,
    effectiveStartDate: "2025-07-21",
    accountStatus: "Not enabled",
    managerResourceId: "RES-0101"
  }
];

/* Quick lookup used when stamping names and emails onto project records, so a
   person's name is never typed twice and cannot disagree with the directory. */
export const BY_ID = new Map(PEOPLE.map((person) => [person.resourceId, person]));

/* RES-0001 is Alex's own linked administrator account, which already exists.
   It is referenced but never written by this seed. */
export const ADMIN = {
  resourceId: "RES-0001",
  fullName: "Alex Kain",
  email: "Alex.Townsend.kain@gmail.com"
};
BY_ID.set(ADMIN.resourceId, ADMIN);

export function person(resourceId) {
  const found = BY_ID.get(resourceId);
  if (!found) throw new Error(`Unknown demo person "${resourceId}"`);
  return found;
}

/* Stamp the three fields the project record keeps for every named role:
   display name, resource id and email. */
export function roleFields(prefix, resourceId) {
  if (!resourceId) return { [prefix]: "", [`${prefix}ResourceId`]: "", [`${prefix}Email`]: "" };
  const found = person(resourceId);
  return {
    [prefix]: found.fullName,
    [`${prefix}ResourceId`]: found.resourceId,
    [`${prefix}Email`]: found.email || ""
  };
}

/* ------------------------------------------------------------------ programmes

   These five already exist as near-empty shells. The seed fills them in rather
   than creating duplicates, so the programme page stops looking broken. Codes
   and names are left exactly as they are.
*/
export const PROGRAMMES = [
  {
    programmeCode: "PRG-00001",
    name: "Servicing",
    description:
      "Modernisation of member servicing: contact channels, self-service, and the operational processes behind them.",
    strategicObjective:
      "Reduce cost to serve and improve member satisfaction by moving routine servicing to self-service without losing the option to speak to a person.",
    startDate: "2026-01-05",
    endDate: "2027-09-30",
    budget: 3850000,
    overallStatus: "Active",
    overallRag: "Amber",
    benefits:
      "Target 35% of routine servicing transactions completed through self-service by the end of 2027, a 12% reduction in average handling time, and a measurable improvement in member NPS.",
    commentary:
      "Telephony and self-service are progressing. The servicing data migration is the constraint and is holding the programme at Amber; recovery depends on the extract quality work completing in September.",
    nextSteps:
      "Confirm the revised servicing data migration plan, complete telephony UAT, and take the self-service portal business case to the November board.",
    sponsorResourceId: "RES-0111",
    programmeManagerResourceId: "RES-0101",
    leadResourceId: "RES-0103"
  },
  {
    programmeCode: "PRG-00002",
    name: "Sales",
    description:
      "Growth of the adviser and direct channels, including quote and apply journeys and adviser support tooling.",
    strategicObjective:
      "Grow new business volumes through intermediated and direct channels while keeping acquisition cost per policy flat.",
    startDate: "2026-03-02",
    endDate: "2027-03-31",
    budget: 1420000,
    overallStatus: "Active",
    overallRag: "Green",
    benefits:
      "Target 18% uplift in completed online applications and a reduction in adviser onboarding time from 15 to 5 working days.",
    commentary:
      "Both live projects are on plan. The adviser portal pilot has positive early feedback from the two firms in the trial.",
    nextSteps: "Complete the adviser portal pilot review and confirm phase two scope and funding.",
    sponsorResourceId: "RES-0112",
    programmeManagerResourceId: "RES-0101",
    leadResourceId: "RES-0104"
  },
  {
    programmeCode: "PRG-00003",
    name: "Propositions",
    description:
      "Development and repricing of member products, including ISAs, junior ISAs and protection.",
    strategicObjective:
      "Keep the product range competitive and compliant, and simplify a back book that is expensive to administer.",
    startDate: "2026-02-02",
    endDate: "2027-06-30",
    budget: 2170000,
    overallStatus: "Active",
    overallRag: "Red",
    benefits:
      "Target £1.9m additional annual premium income from the repriced range, and withdrawal of four legacy products from active sale.",
    commentary:
      "Red. The Consumer Duty value assessment identified gaps in outcome monitoring for two legacy products, and the fix is on the critical path to the April launch.",
    nextSteps:
      "Agree the remediation approach with Risk and Compliance, and re-plan the launch with a realistic regulatory review window.",
    sponsorResourceId: "RES-0112",
    programmeManagerResourceId: "RES-0101",
    leadResourceId: "RES-0103"
  },
  {
    programmeCode: "PRG-00004",
    name: "Mergers & Acquisitions",
    description:
      "Transfers of engagement from smaller friendly societies, and the integration of transferred books.",
    strategicObjective:
      "Grow membership and funds under management through transfers of engagement, and integrate them without degrading service.",
    startDate: "2026-04-01",
    endDate: "2028-03-31",
    budget: 2650000,
    overallStatus: "Active",
    overallRag: "Amber",
    benefits:
      "Target 24,000 additional members and £310m funds under management, with integration cost held below £95 per transferred member.",
    commentary:
      "Amber on schedule. The Part VII transfer timetable depends on court dates that are outside our control, and the current indicative date is six weeks later than planned.",
    nextSteps: "Confirm the revised court timetable and re-sequence the integration plan around it.",
    sponsorResourceId: "RES-0102",
    programmeManagerResourceId: "RES-0101",
    leadResourceId: "RES-0106"
  },
  {
    programmeCode: "PRG-00005",
    name: "BAU",
    description:
      "Regulatory, security and infrastructure work that has to happen regardless of strategic priorities.",
    strategicObjective:
      "Stay compliant, secure and supported, and retire technology that is out of vendor support.",
    startDate: "2026-01-05",
    endDate: "2027-12-31",
    budget: 1980000,
    overallStatus: "Active",
    overallRag: "Green",
    benefits:
      "Regulatory deadlines met with no breaches, and removal of three unsupported platforms from the estate.",
    commentary:
      "On plan. Both mandatory items have firm dates and are tracking to them.",
    nextSteps: "Complete the identity platform rollout and begin decommissioning the legacy file estate.",
    sponsorResourceId: "RES-0102",
    programmeManagerResourceId: "RES-0101",
    leadResourceId: "RES-0105"
  }
];

/* The single existing portfolio, enriched rather than replaced. */
export const PORTFOLIO = {
  portfolioCode: "PORT-00001",
  description:
    "All change activity across the organisation, grouped into five programmes and governed through a single portfolio board.",
  status: "Active",
  budget: 12070000,
  currency: "GBP",
  financialYear: "2026/27",
  financialYearStartMonth: 4,
  defaultReportingFrequency: "Monthly",
  ownerResourceId: "RES-0101",
  executiveSponsorResourceId: "RES-0102"
};
