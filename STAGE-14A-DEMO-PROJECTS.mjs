/*
  STAGE 14A - demo projects.

  Twelve projects spread deliberately across lifecycle stages and RAG states,
  because a portfolio where everything is Green in Delivery tests almost nothing.
  Two are Red with a stated cause and a return-to-green plan, two are unassessed
  at Intake, and one is at Closure.

  Codes run PRJ-00006 upwards, continuing the sequence the application has already
  issued so the next code it generates follows on naturally.

  Every named role is stamped from the resource directory through roleFields(), so
  a person's name, id and email can never disagree across records.
*/

import { roleFields } from "./STAGE-14A-DEMO-PEOPLE.mjs";

/* The live default template, confirmed against public.lifecycle_templates rather
   than assumed. A wrong identifier here would leave every project unable to
   resolve its lifecycle stages. */
const LIFECYCLE_TEMPLATE_ID = "LIFE-00001";
const REPORTING_CALENDAR_ID = "CAL-00001";

/*
  Fields the form always writes. Spelling them out keeps "properly filled out"
  honest: a project record the application would produce has these keys present
  even when empty, and code that reads them does not have to guess.
*/
function baseProject() {
  return {
    shortName: "",
    formerName: "",
    projectClassification: "Change",
    confidentialityClassification: "Internal",
    portfolioId: "PORT-00001",
    portfolio: "Portfolio Manager",
    lifecycleTemplateId: LIFECYCLE_TEMPLATE_ID,
    lifecycleTemplateVersion: 1,
    reportingCalendarId: REPORTING_CALENDAR_ID,
    approvalStatus: "Approved",
    sponsorConfirmationStatus: "Confirmed",
    requirementsApprovalStatus: "Not started",
    baselineApprovalStatus: "Not started",
    goLiveApprovalStatus: "Not started",
    closureApprovalStatus: "Not started",
    operationalReadinessStatus: "Not started",
    trainingStatus: "Not started",
    communicationsStatus: "Not started",
    testDatesStatus: "Not started",
    reportingFrequency: "Monthly",
    archived: false,
    archivedAt: "",
    archiveReason: "",
    preArchiveStatus: "",
    stageOverrideReason: "",
    reasonForSlippage: "",
    returnToGreen: "",
    actualStartDate: "",
    actualEndDate: "",
    closureDate: "",
    approvedImplementationDate: "",
    indicativeCosts: 0,
    costEstimate: 0,
    benefitRag: "Not Assessed",
    qualityRag: "Not Assessed",
    operationalReadinessRag: "Not Assessed",
    calculatedRags: {},
    ragOverrideJustifications: {},
    defectsBlockers: "",
    deploymentDependencies: "",
    goLiveCriteria: "",
    supportModel: "",
    hypercarePlan: "",
    rollbackPlan: "",
    outstandingRisksIssues: "",
    closureSummary: "",
    finalFinancialPosition: "",
    outstandingActions: "",
    benefitsHandover: "",
    lessonsLearned: "",
    archiveLocation: "",
    solutionOptions: "",
    operationalReadinessRequirements: "",
    testApproach: "",
    implementationApproach: "",
    discoveryDeliverables: "",
    deliveryPlanSummary: "",
    detailedResourceDemand: "",
    resourceDemandSummary: "",
    initialResourceRequirements: "",
    initialRaidSummary: "",
    assumptionsConstraints: "",
    strategicDependencies: "",
    deliveryDependencies: "",
    successMeasures: "",
    benefitMeasures: "",
    expectedBenefits: "",
    customerOutcome: "",
    regulatoryDriver: "",
    mandatoryDeliveryDate: "",
    nextStageGateDate: "",
    currentStageGate: ""
  };
}

/*
  Compose one project: shared defaults, then the named roles, then the specifics.
  Roles not supplied are still written as empty strings by roleFields(), which is
  what the form does.
*/
function project(specifics, roles) {
  const people = Object.assign(
    {},
    ...[
      "requestor",
      "projectManager",
      "sponsor",
      "projectLead",
      "deputyProjectManager",
      "businessOwner",
      "technicalLead",
      "businessAnalyst",
      "testLead",
      "changeLead",
      "financeContact",
      "complianceContact",
      "benefitOwner"
    ].map((prefix) => roleFields(prefix, roles[prefix] || ""))
  );
  return { ...baseProject(), ...people, ...specifics };
}

export const PROJECTS = [
  project(
    {
      projectCode: "PRJ-00006",
      projectName: "Member Self-Service Portal",
      shortName: "Self-Service",
      description:
        "A secure member portal for the servicing transactions that currently require a phone call: address and bank detail changes, valuations, statements, beneficiary updates and fund switches.",
      programmeId: "PRG-00001",
      programme: "Servicing",
      workstream: "Servicing",
      businessArea: "Servicing",
      projectType: "Technology",
      priority: "High",
      projectStatus: "Active",
      currentStage: "Build",
      nextStage: "Test",
      overallRag: "Green",
      scheduleRag: "Green",
      scopeRag: "Green",
      financialRag: "Green",
      resourceRag: "Amber",
      riskRag: "Green",
      benefitRag: "Green",
      qualityRag: "Green",
      operationalReadinessRag: "Amber",
      deliveryConfidence: "High",
      baselineStartDate: "2026-01-12",
      baselineEndDate: "2026-12-18",
      forecastStartDate: "2026-01-12",
      forecastEndDate: "2026-12-18",
      targetImplementationDate: "2026-11-30",
      actualStartDate: "2026-01-12",
      percentageComplete: 58,
      dateLogged: "2025-10-14",
      proposedStartDate: "2026-01-12",
      currentStageGate: "Gate 3 - Design approved",
      nextStageGateDate: "2026-09-18",
      currentPosition:
        "All eleven build sprints are complete for release one. Authentication, valuations and statements are working end to end in the integration environment. Fund switches are behind by one sprint because the pricing feed contract changed.",
      nextSteps:
        "Close the fund switch build, freeze release one scope, and complete the test environment refresh before UAT entry on 5 October.",
      highLevelScope:
        "Registration and authentication with multi-factor; view policies, valuations and transaction history; download statements; update address, contact details and bank details; nominate and amend beneficiaries; fund switching for eligible products; secure messaging into the servicing queue.",
      outOfScope:
        "New business applications, adviser access, withdrawals and surrenders, and anything requiring a wet signature. Group products are excluded from release one.",
      inScope: "Individual ISA, junior ISA and investment bond products only in release one.",
      businessProblem:
        "About 62% of inbound calls are routine servicing that a member could complete themselves. Average handling time is 7.4 minutes and the servicing team is at capacity during the ISA season peak.",
      desiredOutcome:
        "Members can complete routine servicing at any time without calling, and the servicing team recovers capacity to handle complex enquiries and vulnerable member support.",
      businessPriority: "High",
      strategicDriver: "Reduce cost to serve while improving member experience",
      strategicObjective: "Digital-first servicing",
      customerOutcome:
        "Members get immediate confirmation of routine changes instead of waiting on hold or for a letter.",
      expectedBenefits:
        "35% of routine servicing transactions self-served by December 2027; 12% reduction in average handling time; reduction in inbound call volume of 90,000 calls a year at steady state.",
      successMeasures:
        "Self-service adoption rate, inbound call volume, average handling time, portal task completion rate, and member satisfaction for digital journeys.",
      benefitMeasures:
        "Monthly self-service transaction counts from portal analytics against the servicing platform transaction log.",
      additionalStakeholders:
        "Information Security, Data Protection Officer, Member Servicing team leaders, Digital Marketing, and the Member Panel.",
      assumptionsConstraints:
        "Assumes the servicing platform API remains on version 4 through 2026. Constrained by the ISA season change freeze from 1 February to 15 April.",
      strategicDependencies:
        "Depends on the identity and access platform (PRJ-00016) providing member-facing multi-factor authentication.",
      deliveryDependencies:
        "Servicing platform API v4 sandbox availability; pricing feed contract from the fund administrator; test data refresh from PRJ-00007.",
      discoveryDeliverables:
        "Journey maps for eight servicing transactions, technical options paper, security threat model, and an indicative cost range.",
      solutionOptions:
        "Three options were assessed: extend the existing member area, buy a packaged portal, or build on the current web platform. Building on the current platform was chosen on cost and control of the roadmap.",
      deliveryPlanSummary:
        "Two releases. Release one covers view and routine change transactions for individual products by November 2026. Release two adds group products and secure document exchange in 2027.",
      detailedResourceDemand:
        "Four developers, one test lead, two testers, one business analyst and a part-time change lead through to November, reducing to two developers in hypercare.",
      resourceDemandSummary: "Peak demand 9.4 FTE in September 2026.",
      testApproach:
        "Component and integration tests automated in the build pipeline. Six weeks of UAT with twelve servicing colleagues and a member panel of thirty. Penetration test by an external firm before go-live.",
      operationalReadinessRequirements:
        "Servicing team training, updated knowledge base articles, a revised complaints handling route for digital journeys, and a supported rollback to the current member area.",
      implementationApproach:
        "Phased release by product, starting with ISA. Ten percent of members enabled in week one, rising to full availability over four weeks.",
      goLiveCriteria:
        "Zero open critical or high defects, penetration test findings closed or accepted, servicing team trained above 90%, and rollback rehearsed.",
      supportModel:
        "Business hours support from the digital team for four weeks after each release, then into standard application support.",
      hypercarePlan: "Four weeks of daily triage with the servicing floor, then weekly for a month.",
      rollbackPlan:
        "Feature flags allow each transaction to be disabled independently, and the existing member area is kept live throughout release one.",
      fundingSource: "Change budget 2026/27",
      costEstimate: 1240000,
      indicativeCosts: 1150000,
      initialRaidSummary:
        "Key risks at intake were authentication complexity, servicing platform API stability, and adoption below forecast.",
      initialResourceRequirements: "Estimated 8 to 10 FTE at peak, mostly internal.",
      confidentialityClassification: "Internal"
    },
    {
      requestor: "RES-0111",
      projectManager: "RES-0103",
      sponsor: "RES-0111",
      projectLead: "RES-0110",
      businessOwner: "RES-0111",
      technicalLead: "RES-0109",
      businessAnalyst: "RES-0113",
      testLead: "RES-0114",
      changeLead: "RES-0120",
      financeContact: "RES-0115",
      benefitOwner: "RES-0111"
    }
  ),

  project(
    {
      projectCode: "PRJ-00007",
      projectName: "Servicing Data Migration",
      shortName: "Servicing Migration",
      description:
        "Migration of member, policy and transaction history from the legacy servicing database onto the current platform, retiring the 1998 system that still holds twenty-two years of history.",
      programmeId: "PRG-00001",
      programme: "Servicing",
      workstream: "Servicing",
      businessArea: "Servicing",
      projectType: "Technology",
      priority: "Critical",
      projectStatus: "Active",
      currentStage: "Test",
      nextStage: "Implementation",
      overallRag: "Red",
      scheduleRag: "Red",
      scopeRag: "Amber",
      financialRag: "Amber",
      resourceRag: "Red",
      riskRag: "Red",
      benefitRag: "Amber",
      qualityRag: "Red",
      operationalReadinessRag: "Amber",
      deliveryConfidence: "Low",
      baselineStartDate: "2025-09-01",
      baselineEndDate: "2026-08-28",
      forecastStartDate: "2025-09-01",
      forecastEndDate: "2026-12-11",
      targetImplementationDate: "2026-11-27",
      actualStartDate: "2025-09-01",
      percentageComplete: 71,
      dateLogged: "2025-06-02",
      proposedStartDate: "2025-09-01",
      currentStageGate: "Gate 4 - Build complete",
      nextStageGateDate: "2026-09-25",
      currentPosition:
        "Migration code is complete and four full trial loads have run. Trial four reconciled 99.31% of transaction history against a 99.95% acceptance threshold. The gap is concentrated in pre-2004 unit-linked transactions where the legacy system stored partial unit prices.",
      nextSteps:
        "Complete the pre-2004 pricing reconstruction, run trial five in the first week of October, and take a revised plan and a scope recommendation to the portfolio board on 14 October.",
      reasonForSlippage:
        "Data quality in the legacy system is materially worse than the profiling in Discovery indicated. Pre-2004 unit-linked transactions are missing unit prices in roughly 41,000 rows, which was not visible until trial three loaded full history rather than a sample.",
      returnToGreen:
        "Three actions: reconstruct pre-2004 unit prices from the fund administrator's archive, agree with Risk and Finance a documented tolerance for records that cannot be reconstructed, and re-baseline to a December implementation. Trial five on 5 October is the decision point. If reconciliation reaches 99.9% the project returns to Amber; Green is not realistic before implementation.",
      highLevelScope:
        "Member records, policy records, full transaction history, correspondence index, and standing instructions. Includes reconciliation reporting, a documented cutover with rollback, and decommissioning of the legacy database.",
      outOfScope:
        "Scanned document images, which remain in the existing archive with an index link. Group scheme history before 1996 is excluded and retained read-only.",
      inScope: "All individual and group products administered on the legacy servicing database.",
      businessProblem:
        "The legacy servicing database runs on an operating system out of vendor support since 2023, cannot be patched, and is the single largest technology risk on the register. Two people in the organisation understand it.",
      desiredOutcome:
        "One servicing platform holding complete history, the unsupported platform decommissioned, and the key person dependency removed.",
      businessPriority: "Critical",
      strategicDriver: "Remove unsupported technology and the associated operational risk",
      strategicObjective: "Simplify the technology estate",
      regulatoryDriver:
        "Record-keeping obligations under FCA SYSC 9 require complete and accessible transaction history for the retention period.",
      customerOutcome:
        "Members keep complete history and stop being told that older transactions have to be requested in writing.",
      expectedBenefits:
        "Removal of an unsupported platform, £180,000 a year of avoided legacy support and hosting cost, and elimination of manual history lookups that currently take the servicing team about 40 hours a month.",
      successMeasures:
        "Reconciliation percentage at cutover, defects raised in the first month, legacy platform decommissioned, and manual history lookup hours.",
      benefitMeasures: "Support and hosting cost lines, and the servicing team's manual lookup log.",
      additionalStakeholders:
        "Internal Audit, Risk and Compliance, the fund administrator, Information Security, and the legacy platform vendor.",
      assumptionsConstraints:
        "Assumes the fund administrator can supply archived unit prices back to 1998; that is now known to be partial. Constrained by a mandatory cutover window outside the ISA season.",
      strategicDependencies:
        "PRJ-00006 depends on this project's test data refresh, so slippage here moves self-service UAT.",
      deliveryDependencies:
        "Fund administrator archive extract; two weekend environment windows from Technology; sign-off from Finance on the reconciliation tolerance.",
      discoveryDeliverables:
        "Data profiling report, target data model mapping, migration strategy, and a reconciliation and acceptance approach.",
      solutionOptions:
        "Full migration, migration of a defined recent period with the remainder read-only in an archive, or replatforming the legacy system. Full migration was chosen; the read-only archive option is now being revisited as a fallback for pre-2004 history.",
      deliveryPlanSummary:
        "Five trial loads, then a rehearsed cutover over one weekend, four weeks of parallel reconciliation, then decommissioning.",
      detailedResourceDemand:
        "Two data engineers, one data migration lead, one business analyst and two reconciliation testers from Finance, plus fund administrator support.",
      resourceDemandSummary: "Peak demand 6.8 FTE, currently short one data engineer.",
      testApproach:
        "Automated row and balance reconciliation on every trial load, sample-based manual verification of 500 records per product, and a full dress rehearsal of cutover including rollback.",
      operationalReadinessRequirements:
        "Servicing team briefed on the new history screens, a documented process for records inside the agreed tolerance, and an audit trail of every reconciliation exception.",
      implementationApproach:
        "Single big-bang cutover over a weekend with the legacy system left available read-only for four weeks.",
      goLiveCriteria:
        "Reconciliation at or above the agreed threshold, rollback rehearsed successfully, Finance sign-off on tolerance, and zero open critical defects.",
      supportModel: "Daily reconciliation review for four weeks, jointly with Finance.",
      hypercarePlan:
        "Four weeks of parallel running with daily exception reporting, then a formal decommissioning decision.",
      rollbackPlan:
        "Legacy system remains available and writable until cutover is confirmed. Rollback is a documented restore plus replay of the weekend's transactions, rehearsed in trial four.",
      defectsBlockers:
        "Nineteen open defects, two critical: pre-2004 unit price reconstruction, and duplicate member matching where the legacy system allowed the same member twice.",
      outstandingRisksIssues:
        "Reconciliation may not reach threshold for pre-2004 history. Fund administrator archive is confirmed partial. One data engineer vacancy unfilled since June.",
      fundingSource: "Change budget 2026/27 with a regulatory allocation",
      costEstimate: 1480000,
      indicativeCosts: 1100000,
      initialRaidSummary:
        "Data quality, key person dependency on the legacy platform, and cutover risk were the three issues raised at intake. Data quality has materialised.",
      initialResourceRequirements: "Estimated 5 to 7 FTE with specialist data migration skills.",
      confidentialityClassification: "Confidential"
    },
    {
      requestor: "RES-0109",
      projectManager: "RES-0105",
      sponsor: "RES-0111",
      projectLead: "RES-0119",
      deputyProjectManager: "RES-0104",
      businessOwner: "RES-0111",
      technicalLead: "RES-0109",
      businessAnalyst: "RES-0113",
      testLead: "RES-0114",
      changeLead: "RES-0120",
      financeContact: "RES-0115",
      complianceContact: "RES-0116",
      benefitOwner: "RES-0111"
    }
  ),

  project(
    {
      projectCode: "PRJ-00008",
      projectName: "Contact Centre Workforce Management",
      shortName: "WFM",
      description:
        "Introduction of a workforce management tool for the servicing contact centre, covering forecasting, scheduling, intraday management and adherence reporting.",
      programmeId: "PRG-00001",
      programme: "Servicing",
      workstream: "Servicing",
      businessArea: "Servicing",
      projectType: "Change project",
      priority: "Medium",
      projectStatus: "Active",
      currentStage: "Requirements and Design",
      nextStage: "Build",
      overallRag: "Amber",
      scheduleRag: "Amber",
      scopeRag: "Amber",
      financialRag: "Green",
      resourceRag: "Amber",
      riskRag: "Green",
      benefitRag: "Green",
      qualityRag: "Not Assessed",
      operationalReadinessRag: "Not Assessed",
      deliveryConfidence: "Medium",
      baselineStartDate: "2026-04-06",
      baselineEndDate: "2027-01-29",
      forecastStartDate: "2026-04-20",
      forecastEndDate: "2027-02-26",
      targetImplementationDate: "2027-01-25",
      actualStartDate: "2026-04-20",
      percentageComplete: 24,
      dateLogged: "2026-01-19",
      proposedStartDate: "2026-04-06",
      currentStageGate: "Gate 2 - Requirements in progress",
      nextStageGateDate: "2026-10-16",
      currentPosition:
        "Requirements are 80% signed off. Vendor selection is complete with a preferred supplier, but contract negotiation is taking longer than planned over data processing terms.",
      nextSteps:
        "Close the data processing schedule with Legal and the DPO, complete the remaining requirements sign-off, and hold the design gate on 16 October.",
      reasonForSlippage:
        "Start was two weeks late waiting for the vendor shortlist, and contract negotiation on data processing terms has added a further four weeks.",
      returnToGreen:
        "Legal has committed to a final position by 2 October. If contract signature lands in October the four-week slippage is absorbed in the build phase float and the project returns to Green at the design gate.",
      highLevelScope:
        "Demand forecasting, shift scheduling, intraday reforecasting, adherence and shrinkage reporting, holiday and absence integration with the HR system, and agent self-service shift swaps.",
      outOfScope:
        "Payroll integration, performance management, quality monitoring, and any team outside the servicing contact centre.",
      inScope: "The 94 FTE servicing contact centre across two sites and homeworkers.",
      businessProblem:
        "Scheduling is done in spreadsheets by two team leaders, takes about three days a fortnight, and cannot reforecast intraday. Adherence is not measured, and the ISA season peak is staffed on judgement rather than forecast.",
      desiredOutcome:
        "Forecast-driven scheduling with measured adherence, team leader time returned to coaching, and service levels held through the seasonal peak.",
      businessPriority: "Medium",
      strategicDriver: "Improve operational efficiency and service level consistency",
      strategicObjective: "Reduce cost to serve",
      customerOutcome: "More consistent call answering times, particularly at peak.",
      expectedBenefits:
        "Recovery of about 150 team leader days a year, a 4 point improvement in service level at peak, and reduction in overtime spend of around £48,000 a year.",
      successMeasures:
        "Forecast accuracy, schedule adherence, service level at peak, team leader time on scheduling, and overtime spend.",
      benefitMeasures: "Workforce management tool reporting alongside the payroll overtime line.",
      additionalStakeholders:
        "HR, Legal, Data Protection Officer, the two contact centre site managers, and the staff forum.",
      assumptionsConstraints:
        "Assumes the HR system can provide an absence feed. Constrained by the ISA season freeze and by a commitment to the staff forum that no scheduling change lands before April.",
      strategicDependencies: "None outside the programme.",
      deliveryDependencies:
        "Vendor contract signature; HR system absence API; telephony platform historical call data extract.",
      discoveryDeliverables:
        "Current-state scheduling assessment, requirements catalogue, vendor long list and evaluation criteria, and a benefits case.",
      solutionOptions:
        "Packaged workforce management software, a module from the telephony vendor, or improving the spreadsheet process. Packaged software was chosen for forecasting capability the telephony module lacks.",
      deliveryPlanSummary:
        "Configure and integrate through the autumn, parallel run one team from November, phased rollout by team through January, live for the 2027 ISA season.",
      detailedResourceDemand:
        "One business analyst, one integration developer, a part-time change lead, and two team leaders at 50% through configuration and parallel running.",
      resourceDemandSummary: "Peak demand 3.6 FTE in November 2026.",
      testApproach:
        "Vendor-supported configuration testing, an integration test of the HR absence feed, and a four-week parallel run against the current spreadsheets before any team relies on it.",
      operationalReadinessRequirements:
        "Team leader training on forecasting, agent training on shift self-service, staff forum consultation complete, and a documented fallback to spreadsheet scheduling.",
      implementationApproach: "Team by team over four weeks, with the spreadsheet kept as fallback.",
      fundingSource: "Change budget 2026/27",
      costEstimate: 385000,
      indicativeCosts: 350000,
      initialRaidSummary:
        "Staff engagement with scheduling change, HR integration feasibility, and vendor lock-in were raised at intake.",
      initialResourceRequirements: "Estimated 3 to 4 FTE plus vendor professional services.",
      confidentialityClassification: "Internal"
    },
    {
      requestor: "RES-0110",
      projectManager: "RES-0106",
      sponsor: "RES-0111",
      projectLead: "RES-0110",
      businessOwner: "RES-0110",
      technicalLead: "RES-0109",
      businessAnalyst: "RES-0113",
      changeLead: "RES-0120",
      financeContact: "RES-0115",
      benefitOwner: "RES-0110"
    }
  ),

  project(
    {
      projectCode: "PRJ-00009",
      projectName: "Adviser Portal Phase 1",
      shortName: "Adviser Portal",
      description:
        "An online portal for intermediary firms to submit and track new business, view client valuations, and manage their own firm and adviser records.",
      programmeId: "PRG-00002",
      programme: "Sales",
      workstream: "Sales",
      businessArea: "Sales",
      projectType: "Technology",
      priority: "High",
      projectStatus: "Active",
      currentStage: "Implementation",
      nextStage: "Hypercare",
      overallRag: "Green",
      scheduleRag: "Green",
      scopeRag: "Green",
      financialRag: "Green",
      resourceRag: "Green",
      riskRag: "Amber",
      benefitRag: "Green",
      qualityRag: "Green",
      operationalReadinessRag: "Green",
      deliveryConfidence: "High",
      baselineStartDate: "2026-03-02",
      baselineEndDate: "2026-10-30",
      forecastStartDate: "2026-03-02",
      forecastEndDate: "2026-10-23",
      targetImplementationDate: "2026-09-28",
      approvedImplementationDate: "2026-09-28",
      actualStartDate: "2026-03-02",
      percentageComplete: 88,
      dateLogged: "2025-11-24",
      proposedStartDate: "2026-03-02",
      currentStageGate: "Gate 5 - Go-live approved",
      nextStageGateDate: "2026-10-30",
      currentPosition:
        "Pilot with two adviser firms completed with positive feedback and eleven minor changes, nine of which are done. Go-live approved at the September governance meeting. Rollout to the remaining 38 firms starts 28 September.",
      nextSteps:
        "Complete the final two pilot changes, run the adviser onboarding webinars, and begin phased firm enablement from 28 September.",
      highLevelScope:
        "Firm and adviser registration, new business submission for ISA and investment bond, application tracking, client valuation views, commission statements, and document download.",
      outOfScope:
        "Protection products, illustrations and quotations, bulk client data upload, and any direct member access.",
      inScope: "All 40 intermediary firms currently on the agency register.",
      businessProblem:
        "Advisers submit business by email and post, and chase progress by phone. Onboarding a new firm takes 15 working days of manual checks, and advisers have no visibility of application status.",
      desiredOutcome:
        "Advisers self-serve submission and tracking, onboarding falls to five days, and the new business team stops rekeying applications from paper.",
      businessPriority: "High",
      strategicDriver: "Grow intermediated new business without adding operational headcount",
      strategicObjective: "Channel growth",
      customerOutcome:
        "Faster application turnaround for members whose adviser submits through the portal.",
      expectedBenefits:
        "18% uplift in completed applications through the intermediated channel, onboarding time from 15 to 5 days, and removal of about 6,000 rekeyed applications a year.",
      successMeasures:
        "Portal submission share of intermediated new business, firm onboarding elapsed time, rekeying volume, and adviser satisfaction.",
      benefitMeasures: "New business system channel reporting and the agency onboarding log.",
      additionalStakeholders:
        "New Business team, Compliance, the two pilot firms, and the intermediary sales managers.",
      assumptionsConstraints:
        "Assumes firms will adopt without financial incentive, which the pilot supports. Constrained by the requirement that paper submission remains available throughout phase one.",
      strategicDependencies: "Depends on PRJ-00016 for adviser multi-factor authentication.",
      deliveryDependencies:
        "New business system API; agency register data cleanse; commission calculation engine access.",
      discoveryDeliverables:
        "Adviser research findings, journey designs, technical approach, and a phased scope recommendation.",
      solutionOptions:
        "Build on the existing web platform, buy an adviser extranet product, or extend the new business system's own portal. Build was chosen because the commission views required are specific to the society.",
      deliveryPlanSummary:
        "Build March to July, pilot with two firms August to September, phased rollout of the remaining firms through October.",
      detailedResourceDemand:
        "Three developers, one business analyst, one tester and a part-time change lead, reducing to one developer in hypercare.",
      resourceDemandSummary: "Peak demand 6.2 FTE in June 2026, now tapering.",
      testApproach:
        "Automated regression on submission journeys, an eight-week live pilot with two firms, and an external security test before firm enablement.",
      operationalReadinessRequirements:
        "New business team trained, adviser onboarding pack and webinars ready, support route agreed with the intermediary sales team, and paper fallback retained.",
      implementationApproach:
        "Enable firms in four weekly waves, largest firms last, with paper submission available throughout.",
      goLiveCriteria:
        "Pilot changes closed, security findings resolved, new business team trained, and support route live.",
      supportModel:
        "Intermediary sales managers are first line; digital team second line for eight weeks after each wave.",
      hypercarePlan: "Weekly adviser feedback calls through November, then into standard support.",
      rollbackPlan: "Firms can be reverted to paper submission individually at any point.",
      outstandingRisksIssues:
        "Adoption risk remains for the eight smallest firms, which have low digital maturity. Risk RAG is Amber for that reason.",
      fundingSource: "Change budget 2026/27",
      costEstimate: 620000,
      indicativeCosts: 600000,
      initialRaidSummary:
        "Adviser adoption, commission calculation accuracy, and security of firm-level data access were raised at intake.",
      initialResourceRequirements: "Estimated 5 to 6 FTE.",
      confidentialityClassification: "Internal"
    },
    {
      requestor: "RES-0112",
      projectManager: "RES-0104",
      sponsor: "RES-0112",
      projectLead: "RES-0112",
      businessOwner: "RES-0112",
      technicalLead: "RES-0109",
      businessAnalyst: "RES-0113",
      testLead: "RES-0114",
      changeLead: "RES-0120",
      financeContact: "RES-0115",
      benefitOwner: "RES-0112"
    }
  ),

  project(
    {
      projectCode: "PRJ-00010",
      projectName: "Online Quote and Apply Uplift",
      shortName: "Quote and Apply",
      description:
        "Rework of the direct online application journey to reduce abandonment, including a shorter form, save and resume, and digital identity verification.",
      programmeId: "PRG-00002",
      programme: "Sales",
      workstream: "Sales",
      businessArea: "Sales",
      projectType: "Change project",
      priority: "High",
      projectStatus: "Active",
      currentStage: "Build",
      nextStage: "Test",
      overallRag: "Amber",
      scheduleRag: "Amber",
      scopeRag: "Red",
      financialRag: "Green",
      resourceRag: "Amber",
      riskRag: "Amber",
      benefitRag: "Green",
      qualityRag: "Green",
      operationalReadinessRag: "Not Assessed",
      deliveryConfidence: "Medium",
      baselineStartDate: "2026-02-16",
      baselineEndDate: "2026-11-27",
      forecastStartDate: "2026-02-16",
      forecastEndDate: "2027-01-15",
      targetImplementationDate: "2026-12-11",
      actualStartDate: "2026-02-16",
      percentageComplete: 46,
      dateLogged: "2025-12-08",
      proposedStartDate: "2026-02-16",
      currentStageGate: "Gate 3 - Design approved",
      nextStageGateDate: "2026-10-09",
      currentPosition:
        "The shortened form and save-and-resume are built and in internal testing. Digital identity verification has expanded well beyond the original scope after the DPO required a documented fallback for members who fail automated checks.",
      nextSteps:
        "Take the identity verification scope change to the change control board on 2 October, then re-plan the remaining build.",
      reasonForSlippage:
        "Digital identity verification scope grew: an assisted route for members failing automated checks was not in the original design and adds about six weeks.",
      returnToGreen:
        "A scope change request is with the change control board. If the assisted route is deferred to a second release the project returns to the original December date and to Green; if it is approved in scope the plan re-baselines to mid-January and holds at Amber.",
      highLevelScope:
        "Shortened application form, save and resume, digital identity verification, real-time eligibility checks, improved mobile layout, and abandonment follow-up emails.",
      outOfScope:
        "Adviser journeys, protection products, and any change to underwriting rules.",
      inScope: "Direct online ISA and junior ISA applications.",
      businessProblem:
        "Online application abandonment is 63%, concentrated at the identity and bank detail steps. The form has 47 fields, and members cannot save and return.",
      desiredOutcome:
        "A materially shorter journey members can complete on a phone in one sitting, with abandonment closer to industry norms.",
      businessPriority: "High",
      strategicDriver: "Grow direct new business volumes",
      strategicObjective: "Channel growth",
      customerOutcome:
        "A member can open an ISA on a phone in under ten minutes without posting identity documents.",
      expectedBenefits:
        "Abandonment from 63% to 45%, an estimated 2,100 additional completed applications a year, and removal of about 4,000 manual identity checks.",
      successMeasures:
        "Abandonment rate by step, completion time, mobile completion share, and manual identity check volume.",
      benefitMeasures: "Web analytics funnel reporting and the new business identity check log.",
      additionalStakeholders:
        "Data Protection Officer, Financial Crime, Digital Marketing, New Business, and Compliance.",
      assumptionsConstraints:
        "Assumes the identity verification supplier achieves an 85% automated pass rate; current testing shows 79%, which is what drove the assisted route.",
      strategicDependencies: "None outside the programme.",
      deliveryDependencies:
        "Identity verification supplier integration; bank account validation service; marketing automation platform for abandonment emails.",
      discoveryDeliverables:
        "Funnel analysis, user research with fourteen prospective members, journey redesign, and supplier evaluation.",
      solutionOptions:
        "Incremental improvement of the current form, full rebuild, or a packaged onboarding product. Full rebuild of the journey on the existing platform was chosen.",
      deliveryPlanSummary:
        "Build February to October, six weeks of testing including an A/B pilot on 20% of traffic, full release in December.",
      detailedResourceDemand:
        "Two developers, one designer at 50%, one business analyst, one tester, and marketing support for the follow-up emails.",
      resourceDemandSummary: "Peak demand 4.5 FTE in September 2026.",
      testApproach:
        "Automated journey regression, accessibility testing to WCAG 2.2 AA, an A/B pilot against the current form, and financial crime sign-off on identity verification.",
      operationalReadinessRequirements:
        "New business team trained on the assisted identity route, financial crime procedures updated, and abandonment email content approved by Compliance.",
      implementationApproach:
        "A/B pilot at 20% of traffic for three weeks, then full switch with the old journey retained for two weeks.",
      defectsBlockers:
        "Seven open defects, none critical. The identity verification pass rate is tracked as an issue rather than a defect.",
      outstandingRisksIssues:
        "Scope of the assisted identity route is unresolved and is the reason Scope RAG is Red.",
      fundingSource: "Change budget 2026/27",
      costEstimate: 445000,
      indicativeCosts: 400000,
      initialRaidSummary:
        "Identity verification pass rates, regulatory expectations on vulnerable members, and A/B testing capability were raised at intake.",
      initialResourceRequirements: "Estimated 4 to 5 FTE.",
      confidentialityClassification: "Internal"
    },
    {
      requestor: "RES-0112",
      projectManager: "RES-0104",
      sponsor: "RES-0112",
      projectLead: "RES-0113",
      businessOwner: "RES-0112",
      technicalLead: "RES-0109",
      businessAnalyst: "RES-0113",
      testLead: "RES-0114",
      changeLead: "RES-0120",
      financeContact: "RES-0115",
      complianceContact: "RES-0116",
      benefitOwner: "RES-0112"
    }
  ),

  project(
    {
      projectCode: "PRJ-00011",
      projectName: "ISA Range Repricing 2027",
      shortName: "ISA Repricing",
      description:
        "Repricing and simplification of the ISA and junior ISA range, including withdrawal of four legacy products from active sale and a Consumer Duty value assessment across the range.",
      programmeId: "PRG-00003",
      programme: "Propositions",
      workstream: "Propositions",
      businessArea: "Propositions",
      projectType: "Product",
      priority: "Critical",
      projectStatus: "Active",
      currentStage: "Requirements and Design",
      nextStage: "Build",
      overallRag: "Red",
      scheduleRag: "Red",
      scopeRag: "Amber",
      financialRag: "Green",
      resourceRag: "Amber",
      riskRag: "Red",
      benefitRag: "Amber",
      qualityRag: "Not Assessed",
      operationalReadinessRag: "Not Assessed",
      deliveryConfidence: "Low",
      baselineStartDate: "2026-02-02",
      baselineEndDate: "2027-04-02",
      forecastStartDate: "2026-02-02",
      forecastEndDate: "2027-06-25",
      targetImplementationDate: "2027-04-01",
      mandatoryDeliveryDate: "2027-04-05",
      actualStartDate: "2026-02-02",
      percentageComplete: 31,
      dateLogged: "2025-09-15",
      proposedStartDate: "2026-02-02",
      currentStageGate: "Gate 2 - Requirements in progress",
      nextStageGateDate: "2026-10-23",
      currentPosition:
        "Pricing analysis and the target range design are complete. The Consumer Duty value assessment has identified that two legacy products cannot evidence fair value because outcome monitoring data was never captured, and remediation of that is now on the critical path.",
      nextSteps:
        "Agree the remediation approach with Risk and Compliance by 9 October, then re-plan against the April tax year deadline and escalate the date risk to the board.",
      reasonForSlippage:
        "The Consumer Duty value assessment found no outcome monitoring data for two legacy products dating from 2009 and 2011. Establishing fair value retrospectively requires data reconstruction and a documented assessment that was not in the plan, adding about twelve weeks.",
      returnToGreen:
        "There is no route back to Green while the April tax year deadline stands, because the mandatory date and the remediation cannot both be met on the current plan. The recovery options are to descope the two legacy products from this release and handle them separately, or to accept an April launch of the new range with the legacy withdrawal deferred to July. A recommendation goes to the board on 14 October.",
      highLevelScope:
        "New pricing for six ISA and two junior ISA products, withdrawal of four legacy products from active sale, Consumer Duty value assessments across the range, member and adviser communications, and system configuration.",
      outOfScope:
        "Investment bond and protection pricing, changes to fund ranges, and any change to existing members' terms other than those required by the withdrawal.",
      inScope: "The full ISA and junior ISA range, active and legacy.",
      businessProblem:
        "The range has grown to fourteen products, four of which are closed to new business but still administered, and pricing has not been reviewed since 2023. Administration cost per policy on legacy products is roughly triple the current range.",
      desiredOutcome:
        "A competitive eight-product range with evidenced fair value, and four legacy products withdrawn from sale with a clear path for existing holders.",
      businessPriority: "Critical",
      strategicDriver: "Keep the range competitive and simplify an expensive back book",
      strategicObjective: "Product simplification and margin",
      regulatoryDriver:
        "FCA Consumer Duty requires a fair value assessment for every product, including closed products, with outcome monitoring evidence.",
      customerOutcome:
        "Members on legacy products get a clear comparison and a supported route to a current product where that is better for them.",
      expectedBenefits:
        "£1.9m additional annual premium income from the repriced range, four legacy products withdrawn, and a reduction in administration cost of around £310,000 a year once migration completes.",
      successMeasures:
        "New business volumes by product, legacy product policy counts, administration cost per policy, and completion of fair value assessments.",
      benefitMeasures:
        "New business reporting, the policy administration cost model, and the Consumer Duty assessment register.",
      additionalStakeholders:
        "Risk and Compliance, Internal Audit, the Actuarial function, Finance, Member Servicing, and the Board Product Committee.",
      assumptionsConstraints:
        "Assumes the April tax year start is a hard deadline for the new range. Constrained by a Board commitment that no existing member is worse off as a result of withdrawal.",
      strategicDependencies:
        "Depends on PRJ-00012 delivering the outcome monitoring framework the value assessments rely on.",
      deliveryDependencies:
        "Actuarial pricing sign-off; PRJ-00012 outcome monitoring data model; servicing platform product configuration window.",
      discoveryDeliverables:
        "Competitor pricing analysis, back book profitability review, target range design, and an initial Consumer Duty gap assessment.",
      solutionOptions:
        "Reprice only, reprice and simplify, or full range redesign. Reprice and simplify was chosen as the balance of benefit against delivery risk.",
      deliveryPlanSummary:
        "Design and assessment through 2026, configuration and communications in the first quarter of 2027, launch at the start of the 2027/28 tax year.",
      detailedResourceDemand:
        "One product manager, actuarial support at 50%, one business analyst, compliance support at 40%, a change lead for communications, and configuration effort from Technology.",
      resourceDemandSummary: "Peak demand 5.1 FTE in February 2027.",
      testApproach:
        "Pricing model validation by the actuarial function, configuration testing in a copy of the production product set, and a communications review by Compliance before issue.",
      operationalReadinessRequirements:
        "Servicing and sales teams trained on the new range, legacy product holder queries scripted, fair value assessments approved, and member communications issued.",
      implementationApproach:
        "Single launch at the tax year start, with legacy products closed to new business on the same date.",
      outstandingRisksIssues:
        "The mandatory April date and the remediation timeline are in direct conflict. Two legacy products cannot currently evidence fair value.",
      fundingSource: "Change budget 2026/27 with a regulatory allocation",
      costEstimate: 690000,
      indicativeCosts: 520000,
      initialRaidSummary:
        "Consumer Duty evidence, actuarial capacity, and the immovable tax year deadline were all raised at intake. Two have materialised.",
      initialResourceRequirements: "Estimated 4 to 5 FTE with actuarial and compliance input.",
      confidentialityClassification: "Confidential"
    },
    {
      requestor: "RES-0112",
      projectManager: "RES-0103",
      sponsor: "RES-0112",
      projectLead: "RES-0112",
      businessOwner: "RES-0112",
      businessAnalyst: "RES-0113",
      changeLead: "RES-0120",
      financeContact: "RES-0115",
      complianceContact: "RES-0116",
      benefitOwner: "RES-0112"
    }
  ),

  project(
    {
      projectCode: "PRJ-00012",
      projectName: "Consumer Duty Outcome Monitoring",
      shortName: "Outcome Monitoring",
      description:
        "A repeatable framework and data set for monitoring member outcomes across every product, to evidence fair value on an ongoing basis rather than as a one-off assessment.",
      programmeId: "PRG-00003",
      programme: "Propositions",
      workstream: "Propositions",
      businessArea: "Risk & Compliance",
      projectType: "Regulatory",
      priority: "Critical",
      projectStatus: "Active",
      currentStage: "Discovery",
      nextStage: "Requirements and Design",
      overallRag: "Amber",
      scheduleRag: "Amber",
      scopeRag: "Amber",
      financialRag: "Green",
      resourceRag: "Red",
      riskRag: "Amber",
      benefitRag: "Not Assessed",
      qualityRag: "Not Assessed",
      operationalReadinessRag: "Not Assessed",
      deliveryConfidence: "Medium",
      baselineStartDate: "2026-06-01",
      baselineEndDate: "2027-05-28",
      forecastStartDate: "2026-06-15",
      forecastEndDate: "2027-06-25",
      targetImplementationDate: "2027-05-28",
      actualStartDate: "2026-06-15",
      percentageComplete: 12,
      dateLogged: "2026-03-30",
      proposedStartDate: "2026-06-01",
      currentStageGate: "Gate 1 - Discovery in progress",
      nextStageGateDate: "2026-11-06",
      currentPosition:
        "Discovery is establishing which outcome measures can be produced from existing data and which need new capture. Early finding is that roughly a third of the measures the framework needs are not collected anywhere today.",
      nextSteps:
        "Complete the data availability assessment, agree the minimum viable measure set with Risk and Compliance, and take an options paper to the design gate in November.",
      reasonForSlippage:
        "Start was two weeks late because the data analyst was held on PRJ-00007 reconciliation work, and that resource conflict is unresolved.",
      returnToGreen:
        "Resource RAG is Red because the project needs 1.5 data analysts and has 0.5. The recovery action is a resourcing decision at the portfolio board on 14 October, either backfilling PRJ-00007 or accepting a later date here.",
      highLevelScope:
        "Outcome measure definitions for all products, a data model and reporting layer, an assessment workflow with evidence retention, and a quarterly monitoring cycle.",
      outOfScope:
        "Remediation of individual products, which is handled by the owning product project, and any change to product terms.",
      inScope: "All products, open and closed, across ISA, junior ISA, bond and protection.",
      businessProblem:
        "Fair value assessments are produced manually once a year from data assembled by hand. There is no ongoing monitoring, and for older products the underlying data was never captured, which has already blocked PRJ-00011.",
      desiredOutcome:
        "A quarterly monitoring cycle producing evidenced outcome measures for every product, with assessment history retained.",
      businessPriority: "Critical",
      strategicDriver: "Meet Consumer Duty obligations sustainably rather than through annual effort",
      strategicObjective: "Regulatory compliance and good member outcomes",
      regulatoryDriver:
        "FCA Consumer Duty requires firms to monitor and evidence member outcomes on an ongoing basis, including for closed products.",
      customerOutcome:
        "Poor outcomes are identified and acted on within a quarter rather than discovered in an annual review.",
      expectedBenefits:
        "Evidenced compliance with Consumer Duty monitoring expectations, removal of about 40 person-days a year of manual assessment effort, and earlier identification of products where members are not getting fair value.",
      successMeasures:
        "Proportion of products with a complete measure set, cycle time to produce a quarterly assessment, and manual effort per cycle.",
      benefitMeasures: "The Consumer Duty assessment register and the reporting cycle log.",
      additionalStakeholders:
        "Risk and Compliance, Internal Audit, Data and MI, the Actuarial function, and the Board Risk Committee.",
      assumptionsConstraints:
        "Assumes existing data can supply two thirds of the measures. Constrained by the availability of one data analyst shared with PRJ-00007.",
      strategicDependencies:
        "PRJ-00011 depends on this project for the outcome monitoring framework, so any slippage here moves the ISA repricing plan.",
      deliveryDependencies:
        "Servicing platform data access; the fund administrator's charging data; PRJ-00007 completing so the shared data analyst is released.",
      discoveryDeliverables:
        "Outcome measure catalogue, data availability assessment, options paper for measures that need new capture, and an indicative cost range.",
      solutionOptions:
        "Extend the existing MI platform, build a dedicated assessment tool, or buy a regulatory reporting product. Discovery is expected to recommend extending the MI platform.",
      deliveryPlanSummary:
        "Discovery to November 2026, design and build through the first half of 2027, first full monitoring cycle in the second quarter of 2027.",
      detailedResourceDemand:
        "1.5 data analysts, one business analyst, compliance support at 30%, and reporting development effort from Data and MI.",
      resourceDemandSummary: "Current demand 2.8 FTE against 1.8 FTE supplied.",
      testApproach:
        "Measure calculations validated against manual assessment for two products, and a full dry run of one quarterly cycle before handover.",
      operationalReadinessRequirements:
        "Risk and Compliance trained on the assessment workflow, quarterly cycle added to the governance calendar, and evidence retention agreed with Internal Audit.",
      implementationApproach:
        "Framework goes live one product family at a time, starting with ISA, so the first cycle is not attempted across the whole range at once.",
      outstandingRisksIssues:
        "Resource conflict with PRJ-00007 is live and unresolved. About a third of required measures have no current data source.",
      fundingSource: "Regulatory change allocation 2026/27",
      costEstimate: 410000,
      indicativeCosts: 380000,
      initialRaidSummary:
        "Data availability, analyst capacity, and the dependency from PRJ-00011 were raised at intake. Two are live.",
      initialResourceRequirements: "Estimated 3 FTE with data and compliance skills.",
      confidentialityClassification: "Confidential"
    },
    {
      requestor: "RES-0116",
      projectManager: "RES-0106",
      sponsor: "RES-0112",
      projectLead: "RES-0119",
      businessOwner: "RES-0116",
      businessAnalyst: "RES-0113",
      financeContact: "RES-0115",
      complianceContact: "RES-0116",
      benefitOwner: "RES-0116"
    }
  ),

  project(
    {
      projectCode: "PRJ-00013",
      projectName: "Junior ISA Digital Onboarding",
      shortName: "JISA Onboarding",
      description:
        "A digital route for opening a junior ISA, including parental identity verification and gifting by family members, currently a paper-only process.",
      programmeId: "PRG-00003",
      programme: "Propositions",
      workstream: "Propositions",
      businessArea: "Propositions",
      projectType: "Product",
      priority: "Medium",
      projectStatus: "Proposed",
      currentStage: "Intake",
      nextStage: "Discovery",
      overallRag: "Not Assessed",
      scheduleRag: "Not Assessed",
      scopeRag: "Not Assessed",
      financialRag: "Not Assessed",
      resourceRag: "Not Assessed",
      riskRag: "Not Assessed",
      deliveryConfidence: "Not Assessed",
      baselineStartDate: "",
      baselineEndDate: "",
      forecastStartDate: "2027-01-11",
      forecastEndDate: "2027-10-29",
      targetImplementationDate: "2027-10-01",
      percentageComplete: 0,
      dateLogged: "2026-07-27",
      proposedStartDate: "2027-01-11",
      approvalStatus: "Awaiting approval",
      sponsorConfirmationStatus: "Confirmed",
      currentStageGate: "Gate 0 - Intake",
      nextStageGateDate: "2026-10-30",
      currentPosition:
        "Logged at intake in July and awaiting a Discovery funding decision at the October portfolio board. Nothing has started and no resource is committed.",
      nextSteps:
        "Present the intake case at the portfolio board on 30 October and, if approved, mobilise Discovery in January 2027.",
      highLevelScope:
        "Indicative scope only at intake: digital junior ISA application, parental and child identity verification, family gifting by link or code, and a parental view of the account.",
      outOfScope: "Indicative: transfers in from another provider, and any adviser-submitted route.",
      inScope: "Junior ISA only.",
      businessProblem:
        "Junior ISA can only be opened on paper. About 40% of started applications are never returned, and the process takes an average of 18 days from enquiry to first contribution.",
      desiredOutcome:
        "A parent can open a junior ISA online in one sitting, and grandparents can contribute without a paper mandate.",
      businessPriority: "Medium",
      strategicDriver: "Grow junior ISA new business and reach younger member families",
      strategicObjective: "Channel growth and membership growth",
      customerOutcome:
        "Families can open and fund a junior ISA the same day instead of waiting for forms in the post.",
      expectedBenefits:
        "Indicative: 30% uplift in completed junior ISA applications, elapsed time from 18 days to under 2, and a new gifting route estimated at £400,000 of additional annual contributions.",
      successMeasures:
        "Indicative: completed application volume, application abandonment, elapsed time to first contribution, and gifting contribution value.",
      additionalStakeholders:
        "Financial Crime, Data Protection Officer, New Business, Digital Marketing, and Compliance.",
      assumptionsConstraints:
        "Assumes child identity verification is achievable without a passport, which needs confirming in Discovery. Constrained by dependency on the identity verification approach chosen by PRJ-00010.",
      strategicDependencies:
        "Should follow PRJ-00010 so the identity verification integration is reused rather than rebuilt.",
      deliveryDependencies: "Identity verification supplier capability for under-16s.",
      resourceDemandSummary:
        "Not yet estimated. Indicative 4 FTE for nine months based on PRJ-00010 actuals.",
      initialRaidSummary:
        "Child identity verification feasibility, financial crime requirements for gifting, and the dependency on PRJ-00010 are the three items on the intake risk list.",
      initialResourceRequirements:
        "Indicative 4 FTE. No resource committed pending the Discovery decision.",
      fundingSource: "Not yet allocated",
      indicativeCosts: 340000,
      confidentialityClassification: "Internal"
    },
    {
      requestor: "RES-0112",
      projectManager: "RES-0104",
      sponsor: "RES-0112",
      businessOwner: "RES-0112",
      benefitOwner: "RES-0112"
    }
  ),

  project(
    {
      projectCode: "PRJ-00014",
      projectName: "Society Transfer - Northern Counties Friendly",
      shortName: "NCF Transfer",
      description:
        "Transfer of engagements from Northern Counties Friendly Society under Part VII of FSMA, bringing approximately 24,000 members and £310m of funds under management.",
      programmeId: "PRG-00004",
      programme: "Mergers & Acquisitions",
      workstream: "Mergers & Acquisitions",
      businessArea: "Mergers & Acquisitions",
      projectType: "M&A",
      priority: "Critical",
      projectStatus: "Active",
      currentStage: "Requirements and Design",
      nextStage: "Build",
      overallRag: "Amber",
      scheduleRag: "Amber",
      scopeRag: "Green",
      financialRag: "Amber",
      resourceRag: "Amber",
      riskRag: "Amber",
      benefitRag: "Green",
      qualityRag: "Not Assessed",
      operationalReadinessRag: "Not Assessed",
      deliveryConfidence: "Medium",
      baselineStartDate: "2026-04-13",
      baselineEndDate: "2027-10-29",
      forecastStartDate: "2026-04-13",
      forecastEndDate: "2027-12-10",
      targetImplementationDate: "2027-11-26",
      actualStartDate: "2026-04-13",
      percentageComplete: 28,
      dateLogged: "2025-11-03",
      proposedStartDate: "2026-04-13",
      currentStageGate: "Gate 2 - Requirements approved",
      nextStageGateDate: "2026-12-04",
      currentPosition:
        "Due diligence is complete and the scheme document is drafted. The independent expert has been appointed. The indicative court date for the directions hearing has moved from March to late April 2027, which pushes the whole downstream plan.",
      nextSteps:
        "Confirm the court timetable with legal counsel, re-sequence the integration plan around the revised sanction hearing date, and complete the target operating model design by December.",
      reasonForSlippage:
        "The court timetable is outside the society's control. The indicative directions hearing moved six weeks, and every subsequent milestone is dependent on it.",
      returnToGreen:
        "Schedule cannot return to Green until the court date is fixed rather than indicative, expected in November. The plan holds float in the integration phase which absorbs about three of the six weeks, so the November 2027 implementation remains achievable.",
      highLevelScope:
        "Part VII scheme documentation and court process, member and regulator communications, actuarial and financial due diligence, data migration of member and policy records, target operating model design, and integration of the transferred book onto the servicing platform.",
      outOfScope:
        "Northern Counties' own staff transfer, which is handled as a separate TUPE workstream by HR, and their property leases.",
      inScope: "All Northern Counties members, policies and assets in scope of the scheme.",
      businessProblem:
        "Northern Counties has approached the society seeking a transfer, having concluded it cannot meet capital requirements independently. Without a transfer their members face a poorer outcome.",
      desiredOutcome:
        "Northern Counties members become members with no loss of benefits, administered on one platform, at an integration cost that keeps the transaction value-accretive.",
      businessPriority: "Critical",
      strategicDriver: "Grow membership and funds under management through transfers of engagement",
      strategicObjective: "Scale through consolidation",
      regulatoryDriver:
        "Part VII of the Financial Services and Markets Act 2000 requires court sanction and an independent expert report, with PRA and FCA engagement throughout.",
      customerOutcome:
        "Transferring members keep their existing policy benefits and gain access to a wider product range and digital servicing.",
      expectedBenefits:
        "24,000 additional members, £310m funds under management, and integration cost held below £95 per transferred member.",
      successMeasures:
        "Court sanction achieved, members transferred, integration cost per member, member attrition in the twelve months after transfer, and service levels maintained through cutover.",
      benefitMeasures:
        "Membership and funds under management reporting, the integration cost tracker, and post-transfer attrition analysis.",
      additionalStakeholders:
        "PRA, FCA, the independent expert, legal counsel, the Northern Counties board, Internal Audit, the Actuarial function, and the the board.",
      assumptionsConstraints:
        "Assumes court sanction is granted at the first hearing. Constrained by a statutory notice period for member communications and by the requirement that transfer completes outside the ISA season.",
      strategicDependencies:
        "Depends on PRJ-00007 completing, because transferred records cannot be loaded onto the legacy servicing database.",
      deliveryDependencies:
        "Court timetable; independent expert report; PRA and FCA non-objection; Northern Counties data extract; PRJ-00007 migration completion.",
      discoveryDeliverables:
        "Due diligence report, transaction case, indicative integration cost, and a Part VII process plan.",
      solutionOptions:
        "Full integration onto the internal platform, run Northern Counties as a separate administered book, or outsource administration of the transferred book. Full integration was chosen as the only option that delivers the cost benefit.",
      deliveryPlanSummary:
        "Scheme documentation and court process through 2026 and early 2027, member communications after directions, data migration and integration through the second half of 2027, transfer effective November 2027.",
      detailedResourceDemand:
        "One programme-level project manager, actuarial support at 60%, legal counsel, two data engineers from the second quarter of 2027, one business analyst, and a change lead for communications.",
      resourceDemandSummary: "Peak demand 8.9 FTE in the third quarter of 2027.",
      testApproach:
        "Data migration trial loads with full reconciliation as for PRJ-00007, a rehearsed cutover, and independent verification of member benefit mapping by the actuarial function.",
      operationalReadinessRequirements:
        "Servicing team trained on transferred products, member communications issued within statutory notice periods, contact centre capacity uplifted for the transfer period, and a documented position for every policy type that does not map cleanly.",
      implementationApproach:
        "Single transfer date set by the court order, with data migration over the preceding weekend and four weeks of heightened support.",
      outstandingRisksIssues:
        "Court timetable is indicative rather than fixed. Two Northern Counties policy types have no direct equivalent in the product range and need a documented benefit mapping.",
      fundingSource: "Corporate development budget with board approval",
      costEstimate: 2280000,
      indicativeCosts: 2100000,
      initialRaidSummary:
        "Court timetable risk, benefit mapping for non-equivalent products, and the dependency on PRJ-00007 were raised at intake. All three remain live.",
      initialResourceRequirements: "Estimated 7 to 9 FTE at peak with actuarial and legal input.",
      confidentialityClassification: "Highly Confidential"
    },
    {
      requestor: "RES-0102",
      projectManager: "RES-0105",
      sponsor: "RES-0102",
      projectLead: "RES-0101",
      deputyProjectManager: "RES-0103",
      businessOwner: "RES-0102",
      technicalLead: "RES-0109",
      businessAnalyst: "RES-0113",
      changeLead: "RES-0120",
      financeContact: "RES-0115",
      complianceContact: "RES-0116",
      benefitOwner: "RES-0102"
    }
  ),

  project(
    {
      projectCode: "PRJ-00015",
      projectName: "Transferred Book Integration Readiness",
      shortName: "Integration Readiness",
      description:
        "Preparatory work to make the servicing platform and operating model able to absorb a transferred book of any size, rather than solving it once per transaction.",
      programmeId: "PRG-00004",
      programme: "Mergers & Acquisitions",
      workstream: "Mergers & Acquisitions",
      businessArea: "Operations",
      projectType: "Change project",
      priority: "Medium",
      projectStatus: "Planned",
      currentStage: "Intake",
      nextStage: "Discovery",
      overallRag: "Not Assessed",
      scheduleRag: "Not Assessed",
      scopeRag: "Not Assessed",
      financialRag: "Not Assessed",
      resourceRag: "Not Assessed",
      riskRag: "Not Assessed",
      deliveryConfidence: "Not Assessed",
      baselineStartDate: "",
      baselineEndDate: "",
      forecastStartDate: "2027-01-04",
      forecastEndDate: "2027-09-24",
      targetImplementationDate: "2027-09-01",
      percentageComplete: 0,
      dateLogged: "2026-06-15",
      proposedStartDate: "2027-01-04",
      approvalStatus: "Approved for Discovery",
      currentStageGate: "Gate 0 - Intake",
      nextStageGateDate: "2026-11-27",
      currentPosition:
        "Approved for Discovery funding but not yet started; mobilisation is planned for January 2027 once the Northern Counties court timetable is fixed.",
      nextSteps:
        "Mobilise Discovery in January 2027 and use Northern Counties as the reference case for a repeatable integration pattern.",
      highLevelScope:
        "Indicative: a reusable product mapping method, a standard data migration toolkit, a scalable member communication process, and a capacity model for absorbing transferred servicing volume.",
      outOfScope: "Any specific transaction, which is delivered by its own project.",
      inScope: "Servicing platform, operating model and migration tooling.",
      businessProblem:
        "Each transfer of engagement is currently treated as a one-off. Northern Counties has shown that product mapping, migration tooling and communications are all being built from scratch, which is slow and expensive.",
      desiredOutcome:
        "A second or third transfer costs materially less and takes less elapsed time than the first, because the pattern already exists.",
      businessPriority: "Medium",
      strategicDriver: "Make consolidation repeatable rather than heroic",
      strategicObjective: "Scale through consolidation",
      customerOutcome:
        "Transferring members experience a shorter, better-rehearsed transition.",
      expectedBenefits:
        "Indicative: reduce integration cost per transferred member from £95 to £60, and reduce transfer elapsed time by about four months on subsequent transactions.",
      successMeasures:
        "Indicative: integration cost per member and elapsed time on the next transfer compared with Northern Counties.",
      additionalStakeholders:
        "Operations, Technology, the Actuarial function, Corporate Development, and Member Servicing.",
      assumptionsConstraints:
        "Assumes at least one further transfer is likely within three years. Constrained by learning from Northern Counties, which is not complete until late 2027.",
      strategicDependencies:
        "Deliberately sequenced behind PRJ-00014 so the reference case is real rather than theoretical.",
      deliveryDependencies: "PRJ-00014 reaching integration design, and PRJ-00007 completing.",
      resourceDemandSummary: "Not yet estimated. Indicative 3 FTE for nine months.",
      initialRaidSummary:
        "Risk that the pattern is over-fitted to Northern Counties, and dependency on PRJ-00014 progress, are the two items on the intake list.",
      initialResourceRequirements: "Indicative 3 FTE, none committed.",
      fundingSource: "Corporate development budget",
      indicativeCosts: 295000,
      confidentialityClassification: "Confidential"
    },
    {
      requestor: "RES-0102",
      projectManager: "RES-0103",
      sponsor: "RES-0102",
      businessOwner: "RES-0102",
      technicalLead: "RES-0109",
      benefitOwner: "RES-0102"
    }
  ),

  project(
    {
      projectCode: "PRJ-00016",
      projectName: "Identity and Access Platform",
      shortName: "Identity Platform",
      description:
        "Replacement of three separate authentication mechanisms with a single identity platform covering colleagues, members and advisers, including multi-factor authentication throughout.",
      programmeId: "PRG-00005",
      programme: "BAU",
      workstream: "BAU",
      businessArea: "Technology",
      projectType: "Technology",
      priority: "Critical",
      projectStatus: "Active",
      currentStage: "Hypercare",
      nextStage: "Closure",
      overallRag: "Green",
      scheduleRag: "Green",
      scopeRag: "Green",
      financialRag: "Green",
      resourceRag: "Green",
      riskRag: "Green",
      benefitRag: "Green",
      qualityRag: "Green",
      operationalReadinessRag: "Green",
      deliveryConfidence: "High",
      baselineStartDate: "2025-07-07",
      baselineEndDate: "2026-09-25",
      forecastStartDate: "2025-07-07",
      forecastEndDate: "2026-09-25",
      targetImplementationDate: "2026-07-31",
      approvedImplementationDate: "2026-07-31",
      actualStartDate: "2025-07-07",
      percentageComplete: 96,
      dateLogged: "2025-04-14",
      proposedStartDate: "2025-07-07",
      currentStageGate: "Gate 6 - In hypercare",
      nextStageGateDate: "2026-09-25",
      currentPosition:
        "All three populations are migrated and multi-factor authentication is enforced. Hypercare has been quiet: nine tickets in four weeks, all resolved, none critical. Closure documentation is being assembled.",
      nextSteps:
        "Complete the closure report and lessons learned, hand over to application support on 25 September, and close the project at the September governance meeting.",
      highLevelScope:
        "Single identity platform for colleague, member and adviser authentication; multi-factor authentication for all three; single sign-on across internal applications; self-service password reset; and decommissioning of the three legacy authentication mechanisms.",
      outOfScope:
        "Privileged access management and device management, both handled by separate security workstreams.",
      inScope: "All internal applications, the member area, and the adviser portal.",
      businessProblem:
        "Three separate authentication mechanisms, none with enforced multi-factor authentication, and password resets consuming about 120 service desk calls a month. Flagged as a high finding in the 2024 penetration test and by Internal Audit.",
      desiredOutcome:
        "One identity platform with multi-factor authentication enforced everywhere, self-service resets, and the audit finding closed.",
      businessPriority: "Critical",
      strategicDriver: "Close a known security gap and reduce service desk load",
      strategicObjective: "Secure and supportable technology estate",
      regulatoryDriver:
        "FCA operational resilience expectations and the 2024 internal audit finding on authentication controls.",
      customerOutcome:
        "Members get a modern sign-in with multi-factor protection and can reset their own password.",
      expectedBenefits:
        "Audit finding closed, multi-factor authentication on 100% of accounts, about 100 service desk calls a month avoided worth roughly £42,000 a year, and three legacy platforms decommissioned.",
      successMeasures:
        "Multi-factor coverage, password reset call volume, legacy platforms decommissioned, and audit finding status.",
      benefitMeasures: "Service desk reporting, identity platform coverage reports, and the audit tracker.",
      additionalStakeholders:
        "Information Security, Internal Audit, the service desk, and every application owner.",
      assumptionsConstraints:
        "Assumed member adoption of multi-factor would need a supported route for members without smartphones, which was built. Constrained by a requirement that no member is locked out during migration.",
      strategicDependencies:
        "PRJ-00006 and PRJ-00009 both depend on this platform for their multi-factor authentication, and both are now unblocked.",
      deliveryDependencies: "None outstanding. All application integrations are complete.",
      discoveryDeliverables:
        "Current-state authentication assessment, vendor evaluation, migration approach, and a cost case.",
      solutionOptions:
        "Extend the existing directory, adopt a cloud identity platform, or build a bespoke service. A cloud identity platform was chosen on security capability and total cost.",
      deliveryPlanSummary:
        "Colleagues migrated first in the first quarter of 2026, advisers in the second, members in the third, with legacy decommissioning following each.",
      detailedResourceDemand:
        "Two identity engineers, one security architect at 50%, one tester, and a change lead for member communications. Now one engineer in hypercare.",
      resourceDemandSummary: "Peak demand 5.5 FTE, now 1.2 FTE in hypercare.",
      testApproach:
        "Integration testing per application, a full penetration test after member migration, and an accessibility review of the member multi-factor journey.",
      operationalReadinessRequirements:
        "Service desk trained on the new reset process, member help content published, telephone route for members unable to use an authenticator app, and rollback per population.",
      implementationApproach:
        "Population by population, with each legacy mechanism kept live until the population was fully migrated.",
      goLiveCriteria: "Met at each population migration; all criteria were satisfied.",
      supportModel: "Application support with the identity vendor as third line from 25 September.",
      hypercarePlan:
        "Eight weeks of daily monitoring reducing to weekly, completing 25 September. Nine tickets raised, all closed.",
      rollbackPlan:
        "Each population could revert to its legacy mechanism; not required for any population.",
      closureSummary:
        "Delivered on the baseline date and within the approved budget. All three legacy authentication mechanisms are decommissioned and the 2024 audit finding is closed.",
      finalFinancialPosition:
        "Approved budget £780,000, final outturn £762,400, an underspend of £17,600 driven by lower than forecast vendor professional services.",
      outstandingActions:
        "Two actions remain: decommission the final legacy directory server, and complete the annual access review with the new platform's reporting. Both are transferring to Technology.",
      benefitsHandover:
        "Benefit measurement transfers to the Head of Technology Delivery, reporting quarterly for twelve months.",
      lessonsLearned:
        "Migrating colleagues first was the right call and built confidence. The member telephone fallback should have been designed earlier; it was added late under time pressure and would have been cheaper up front. Vendor professional services were over-estimated by about 20%.",
      operationalReadinessStatus: "Complete",
      trainingStatus: "Complete",
      communicationsStatus: "Complete",
      testDatesStatus: "Complete",
      requirementsApprovalStatus: "Approved",
      baselineApprovalStatus: "Approved",
      goLiveApprovalStatus: "Approved",
      fundingSource: "Technology and security budget",
      costEstimate: 780000,
      indicativeCosts: 800000,
      initialRaidSummary:
        "Member adoption of multi-factor authentication, application integration effort, and lockout risk during migration were raised at intake. All were managed and closed.",
      initialResourceRequirements: "Estimated 5 to 6 FTE with identity specialism.",
      confidentialityClassification: "Confidential"
    },
    {
      requestor: "RES-0109",
      projectManager: "RES-0105",
      sponsor: "RES-0102",
      projectLead: "RES-0109",
      businessOwner: "RES-0109",
      technicalLead: "RES-0109",
      businessAnalyst: "RES-0113",
      testLead: "RES-0114",
      changeLead: "RES-0120",
      financeContact: "RES-0115",
      complianceContact: "RES-0116",
      benefitOwner: "RES-0109"
    }
  ),

  project(
    {
      projectCode: "PRJ-00017",
      projectName: "Legacy File Estate Decommission",
      shortName: "File Estate",
      description:
        "Removal of four unsupported file servers and roughly 14TB of unmanaged shared drive content, with retention-compliant disposal and migration of what is still needed.",
      programmeId: "PRG-00005",
      programme: "BAU",
      workstream: "BAU",
      businessArea: "Technology",
      projectType: "Technology",
      priority: "Medium",
      projectStatus: "Active",
      currentStage: "Closure",
      nextStage: "",
      overallRag: "Green",
      scheduleRag: "Green",
      scopeRag: "Green",
      financialRag: "Green",
      resourceRag: "Green",
      riskRag: "Green",
      benefitRag: "Green",
      qualityRag: "Green",
      operationalReadinessRag: "Green",
      deliveryConfidence: "High",
      baselineStartDate: "2025-10-06",
      baselineEndDate: "2026-08-28",
      forecastStartDate: "2025-10-06",
      forecastEndDate: "2026-08-21",
      targetImplementationDate: "2026-07-24",
      approvedImplementationDate: "2026-07-24",
      actualStartDate: "2025-10-06",
      actualEndDate: "2026-07-24",
      percentageComplete: 100,
      dateLogged: "2025-08-11",
      proposedStartDate: "2025-10-06",
      currentStageGate: "Gate 7 - Closure",
      nextStageGateDate: "2026-08-21",
      currentPosition:
        "Delivery is complete. All four servers are decommissioned, 11.2TB was disposed of under the retention schedule and 2.8TB migrated to managed storage. The closure report is with the sponsor for approval.",
      nextSteps:
        "Obtain sponsor approval of the closure report and close the project at the August governance meeting.",
      highLevelScope:
        "Content discovery and classification across four file servers, retention-based disposal with a documented audit trail, migration of retained content to managed storage, and physical decommissioning.",
      outOfScope:
        "Email archives and the document management system, both retained and out of scope.",
      inScope: "Four file servers and all attached shared drives.",
      businessProblem:
        "Four file servers out of vendor support since 2022, holding 14TB of content with no owner, no retention management and no reliable backup. Raised by Internal Audit and on the technology risk register.",
      desiredOutcome:
        "Unsupported servers gone, retained content on managed storage with retention applied, and the audit finding closed.",
      businessPriority: "Medium",
      strategicDriver: "Retire unsupported infrastructure and manage information properly",
      strategicObjective: "Secure and supportable technology estate",
      regulatoryDriver:
        "UK GDPR storage limitation, and record retention obligations under FCA rules.",
      customerOutcome:
        "No direct member-facing change. Member personal data held beyond its retention period has been disposed of.",
      expectedBenefits:
        "Four unsupported servers removed, £96,000 a year of hosting and support cost avoided, 11.2TB of over-retained data disposed of, and the audit finding closed.",
      successMeasures:
        "Servers decommissioned, storage volume reduced, cost lines removed, and audit finding status.",
      benefitMeasures: "Infrastructure cost reporting and the information asset register.",
      additionalStakeholders:
        "Data Protection Officer, Internal Audit, Information Security, and every departmental content owner.",
      assumptionsConstraints:
        "Assumed content owners could be identified for most shared drives; in practice about 30% had no identifiable owner and were assessed against the retention schedule directly. Constrained by a requirement for a documented disposal trail for every deleted item.",
      strategicDependencies: "None.",
      deliveryDependencies: "None outstanding.",
      discoveryDeliverables:
        "Content discovery report, classification approach, retention mapping, and a disposal governance process.",
      solutionOptions:
        "Lift and shift everything to managed storage, classify and dispose then migrate, or archive wholesale. Classify and dispose was chosen; lift and shift would have carried the retention problem forward.",
      deliveryPlanSummary:
        "Discovery and classification to March 2026, disposal and migration April to July, physical decommissioning in July, closure in August.",
      detailedResourceDemand:
        "One infrastructure engineer, one information governance analyst, and departmental content owners at low intensity.",
      resourceDemandSummary: "Peak demand 2.4 FTE in May 2026. Now zero.",
      testApproach:
        "Restore testing of migrated content, verification sampling of 200 disposed items against the retention schedule, and Data Protection Officer sign-off of the disposal trail.",
      operationalReadinessRequirements:
        "Departments notified of new locations, mapped drives updated, and retention applied on the managed storage platform.",
      implementationApproach:
        "Server by server, each set read-only for four weeks before disposal so anything missed could be recovered.",
      goLiveCriteria: "Met for each server. No recovery requests were received after disposal.",
      supportModel: "Standard infrastructure support for the managed storage platform.",
      hypercarePlan:
        "Four weeks read-only per server before disposal, completed with no recovery requests.",
      rollbackPlan: "Read-only retention period per server, plus backups held for 90 days after disposal.",
      closureSummary:
        "Completed five weeks ahead of the baseline end date and £24,000 under the approved budget. All four servers are decommissioned and the audit finding is closed. 11.2TB disposed of, 2.8TB migrated.",
      finalFinancialPosition:
        "Approved budget £215,000, final outturn £191,000, an underspend of £24,000 because less content required migration than forecast.",
      outstandingActions:
        "One action remains: complete the annual information asset register review reflecting the new storage locations. Transferring to Information Governance.",
      benefitsHandover:
        "Cost avoidance is confirmed in the infrastructure budget from September. No ongoing measurement required.",
      lessonsLearned:
        "Content ownership was far weaker than assumed and consumed about six weeks of unplanned effort. Assessing unowned content directly against the retention schedule, rather than hunting for owners, was the change that recovered the plan and should be the default next time. The four-week read-only period gave the business confidence and cost nothing.",
      operationalReadinessStatus: "Complete",
      trainingStatus: "Not required",
      communicationsStatus: "Complete",
      testDatesStatus: "Complete",
      requirementsApprovalStatus: "Approved",
      baselineApprovalStatus: "Approved",
      goLiveApprovalStatus: "Approved",
      closureApprovalStatus: "Awaiting approval",
      archiveLocation: "Managed storage: /change/closed-projects/PRJ-00017",
      fundingSource: "Technology and security budget",
      costEstimate: 215000,
      indicativeCosts: 240000,
      initialRaidSummary:
        "Content ownership, retention decisions without an owner, and accidental disposal of needed content were raised at intake. All were managed and closed.",
      initialResourceRequirements: "Estimated 2 to 3 FTE.",
      confidentialityClassification: "Internal"
    },
    {
      requestor: "RES-0109",
      projectManager: "RES-0104",
      sponsor: "RES-0102",
      projectLead: "RES-0109",
      businessOwner: "RES-0109",
      technicalLead: "RES-0109",
      changeLead: "RES-0120",
      financeContact: "RES-0115",
      complianceContact: "RES-0116",
      benefitOwner: "RES-0109"
    }
  )
];
