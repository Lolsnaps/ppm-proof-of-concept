/*
  STAGE 14A - actions, decisions, documents, status reports, stage gates,
  recorded RAG history and the global configuration tables.

  Stage gates are the interesting case. private.guard_stage_gate_workflow_write()
  refuses any insert that is not a clean Draft with no history, and that check runs
  before the workflow escape hatch, so a decided gate cannot be inserted at all -
  not even by the table owner. Gates therefore have two shapes here: the Draft that
  is inserted, and the final state that is applied afterwards as an update with
  ppm.stage_gate_workflow set. That is the same path the application takes, so the
  seed proves the guard works rather than going around it.
*/

import { person } from "./STAGE-14A-DEMO-PEOPLE.mjs";
import { plansFor, milestonesFor } from "./STAGE-14A-DEMO-DELIVERY.mjs";
import { raidFor } from "./STAGE-14A-DEMO-RAID.mjs";
import { financialsFor } from "./STAGE-14A-DEMO-FINANCE.mjs";
import { TODAY, addDays, addMonths, workday, at, monthLabel } from "./STAGE-14A-DEMO-DATES.mjs";

/* ------------------------------------------------------------------- actions */

const ACTION_CONTENT = {
  "PRJ-00006": [
    ["Confirm fund switch pricing feed rework completion date with the administrator", "Project board", "High", "In Progress"],
    ["Book twelve servicing colleagues for UAT at 50% for six weeks", "Resource review", "High", "Open"],
    ["Complete test environment refresh ahead of UAT entry", "Project board", "Critical", "In Progress"],
    ["Draft member communications plan for phased release", "Change board", "Medium", "Open"],
    ["Close nine of eleven outstanding accessibility findings", "Test report", "Medium", "Complete"]
  ],
  "PRJ-00007": [
    ["Obtain the fund administrator archive extract for 1999 onwards", "Issue RAID-00007-001", "Critical", "In Progress"],
    ["Prepare the reconciliation tolerance recommendation for the portfolio board", "Issue RAID-00007-001", "Critical", "In Progress"],
    ["Fill the vacant data engineer post or approve a contractor", "Risk RAID-00007-007", "High", "Blocked"],
    ["Complete duplicate member matching review for the 1,840 flagged records", "Issue RAID-00007-002", "High", "In Progress"],
    ["Schedule the second environment window for trial five", "Project board", "Medium", "Complete"],
    ["Re-brief PRJ-00014 and PRJ-00006 on the revised dependency dates", "Programme board", "High", "Complete"]
  ],
  "PRJ-00008": [
    ["Close the data processing schedule with Legal and the DPO", "Issue RAID-00008-001", "Critical", "In Progress"],
    ["Obtain the remaining 20% of requirements sign-off", "Design gate prep", "High", "In Progress"],
    ["Confirm the HR absence feed specification with people systems", "Dependency RAID-00008-003", "Medium", "Open"],
    ["Run the second staff forum listening session", "Change board", "Medium", "Complete"]
  ],
  "PRJ-00009": [
    ["Complete the final two pilot changes", "Pilot review", "High", "In Progress"],
    ["Deliver adviser onboarding webinars for waves one and two", "Change board", "High", "Open"],
    ["Arrange one-to-one onboarding for the eight smallest firms", "Risk RAID-00009-001", "Medium", "Open"],
    ["Confirm the support route with intermediary sales managers", "Readiness review", "Medium", "Complete"]
  ],
  "PRJ-00010": [
    ["Take the identity verification scope change to the change control board", "Issue RAID-00010-001", "Critical", "In Progress"],
    ["Re-plan remaining build against the change control outcome", "Project board", "High", "Open"],
    ["Confirm the marketing automation trigger specification", "Dependency RAID-00010-003", "Medium", "Open"],
    ["Complete accessibility testing to WCAG 2.2 AA", "Test strategy", "Medium", "In Progress"]
  ],
  "PRJ-00011": [
    ["Agree the legacy product remediation approach with Risk and Compliance", "Issue RAID-00011-001", "Critical", "In Progress"],
    ["Prepare the board options paper on descope versus deferral", "Issue RAID-00011-001", "Critical", "In Progress"],
    ["Book actuarial capacity for pricing sign-off against the transfer project", "Risk RAID-00011-004", "High", "Open"],
    ["Confirm the measure set dependency date with PRJ-00012", "Dependency RAID-00011-003", "High", "Open"]
  ],
  "PRJ-00012": [
    ["Escalate the data analyst resourcing conflict to the portfolio board", "Issue RAID-00012-001", "High", "In Progress"],
    ["Complete the data availability assessment", "Discovery deliverable", "High", "In Progress"],
    ["Agree the minimum viable measure set with Risk and Compliance", "Discovery deliverable", "High", "Open"],
    ["Confirm MI platform licensing with the vendor", "Assumption RAID-00012-004", "Medium", "Open"]
  ],
  "PRJ-00013": [
    ["Present the intake case at the October portfolio board", "Intake", "Medium", "Open"],
    ["Confirm supplier capability for under-16 identity verification", "Risk RAID-00013-001", "Medium", "Open"]
  ],
  "PRJ-00014": [
    ["Confirm the revised court timetable with legal counsel", "Risk RAID-00014-001", "Critical", "In Progress"],
    ["Complete the benefit-equivalence assessment for the two unmapped products", "Issue RAID-00014-002", "High", "In Progress"],
    ["Re-sequence the integration plan around the revised sanction date", "Project board", "High", "In Progress"],
    ["Complete the target operating model design", "Design gate prep", "High", "Open"],
    ["Agree the PRJ-00007 dependency date and escalate the residual risk", "Programme board", "Critical", "Complete"]
  ],
  "PRJ-00015": [
    ["Confirm Discovery mobilisation date once the court timetable is fixed", "Intake", "Medium", "Open"]
  ],
  "PRJ-00016": [
    ["Complete the closure report and lessons learned", "Closure", "High", "In Progress"],
    ["Hand over to application support", "Closure", "High", "Open"],
    ["Decommission the final legacy directory server", "Closure", "Medium", "Open"],
    ["Complete the annual access review using the new platform reporting", "Closure", "Medium", "Open"],
    ["Close all nine hypercare tickets", "Hypercare review", "Medium", "Complete"]
  ],
  "PRJ-00017": [
    ["Obtain sponsor approval of the closure report", "Closure", "High", "In Progress"],
    ["Complete the information asset register review", "Closure", "Medium", "Open"],
    ["Confirm the 90-day backup retention has expired before final disposal sign-off", "Closure", "Medium", "Complete"]
  ]
};

export function actionsFor(project) {
  const content = ACTION_CONTENT[project.projectCode] || [];
  const anchor = project.actualStartDate || project.forecastStartDate || project.dateLogged;
  const owner = person(project.projectManagerResourceId);

  return content.map((row, index) => {
    const [description, source, priority, status] = row;
    const raised = workday(addDays(anchor, 30 + index * 17));
    const complete = status === "Complete";
    const due = workday(addDays(raised, priority === "Critical" ? 21 : 42));
    /* Whoever owns the related discipline owns the action, so ownership spreads
       across the team rather than everything landing on the project manager. */
    const ownerId =
      index % 4 === 1 && project.businessAnalystResourceId
        ? project.businessAnalystResourceId
        : index % 4 === 2 && project.technicalLeadResourceId
          ? project.technicalLeadResourceId
          : index % 4 === 3 && project.changeLeadResourceId
            ? project.changeLeadResourceId
            : owner.resourceId;
    const actionOwner = person(ownerId);

    return {
      actionId: `ACT-${project.projectCode.slice(-5)}-${String(index + 1).padStart(3, "0")}`,
      projectCode: project.projectCode,
      description,
      source,
      owner: actionOwner.fullName,
      ownerResourceId: actionOwner.resourceId,
      ownerEmail: actionOwner.email || "",
      supportingOwners: "",
      dateRaised: raised,
      dueDate: due,
      priority,
      status,
      completionDate: complete ? workday(addDays(raised, 20)) : "",
      completionCommentary: complete
        ? "Completed and evidenced at the project board. No further action required."
        : "",
      evidence: complete ? "Project board minutes" : "",
      escalationStatus:
        status === "Blocked"
          ? "Escalation Required"
          : priority === "Critical" && !complete
            ? "Escalated"
            : "Not Escalated",
      relatedRecords: source.startsWith("Issue") || source.startsWith("Risk") || source.startsWith("Dependency") || source.startsWith("Assumption") ? source : "",
      createdAt: at(raised, 9, 0),
      updatedAt: at(complete ? workday(addDays(raised, 20)) : workday(addDays(TODAY, -5)), 16, 20)
    };
  });
}

/* ----------------------------------------------------------------- decisions */

const DECISION_CONTENT = {
  "PRJ-00006": [
    {
      required: "Should fund switching be dropped from release one if the pricing feed rework overruns?",
      background:
        "The fund administrator changed the pricing feed contract in July, requiring six days of rework. Release one scope freeze is 5 September.",
      options:
        "One, hold the date and drop fund switching to release two. Two, hold scope and move the release by two weeks. Three, hold both and compress UAT.",
      recommendation:
        "Option one. Fund switching is the least used of the eight transactions and dropping it protects the November date and full UAT.",
      status: "Under Review"
    },
    {
      required: "Confirm the phased release approach by product rather than a single launch.",
      background:
        "A single launch to all members carries more risk at first contact with real volume.",
      options: "Phased by product starting with ISA, or a single launch to all products at once.",
      recommendation: "Phase by product, ten percent of members in week one rising to full over four weeks.",
      status: "Approved",
      finalDecision:
        "Approved. Phased release by product, beginning with ISA, with feature flags per transaction.",
      rationale:
        "Limits exposure at first contact with real volume and allows each transaction to be disabled independently.",
      conditions: "Rollback to the existing member area must remain available throughout release one.",
      impact: "No change to cost or date. Reduces go-live risk."
    }
  ],
  "PRJ-00007": [
    {
      required:
        "Approve a documented reconciliation tolerance for pre-2004 unit-linked transactions that cannot be reconstructed.",
      background:
        "About 41,000 pre-2004 rows have no unit price. The fund administrator archive covers 1999 onwards, so 1998 cannot be reconstructed at all. Acceptance threshold is 99.95% and trial four reached 99.31%.",
      options:
        "One, accept a documented tolerance with a flag on affected transactions. Two, retain pre-2004 history in a read-only archive and migrate 2004 onwards. Three, delay until full reconstruction is possible, which may never be.",
      recommendation:
        "Option one if Risk and Finance accept the tolerance, otherwise option two. Option three is not viable because the platform is unsupported.",
      status: "Required",
      priority: "Critical"
    },
    {
      required: "Approve the revised implementation date of 11 December 2026.",
      background:
        "Data quality has added 15 weeks. The next available window outside the ISA season is December, then May 2027.",
      options: "Move to December 2026, or defer to May 2027 after the ISA season.",
      recommendation:
        "December 2026. May 2027 leaves an unsupported platform in production for a further five months.",
      status: "Under Review",
      priority: "Critical"
    },
    {
      required: "Approve automatic merge of duplicate member records above 95% match confidence.",
      background:
        "1,840 probable duplicates identified. Manual review of all of them is about 15 person-days.",
      options: "Merge automatically above 95%, review all manually, or merge above 90%.",
      recommendation:
        "Merge above 95% and review the remainder manually. Sampling showed no false positives above 95%.",
      status: "Approved",
      finalDecision: "Approved. Automatic merge above 95% confidence, manual review below.",
      rationale:
        "Sampling of 200 records above 95% found no false positives. Manual review of all 1,840 is not affordable within the plan.",
      conditions:
        "Every automatic merge must be logged and reversible, and a 10% sample reviewed after the run.",
      impact: "Saves about 11 person-days and removes a critical path item."
    }
  ],
  "PRJ-00008": [
    {
      required:
        "Proceed with the preferred vendor subject to amended data processing terms, or re-engage the second-placed vendor?",
      background:
        "The preferred vendor's standard terms permit sub-processing outside the UK without notice. The DPO will not accept this. Four weeks lost so far.",
      options:
        "One, hold for amended terms with a decision point of 2 October. Two, re-engage the second-placed vendor now. Three, accept the terms with additional contractual safeguards.",
      recommendation:
        "Option one to 2 October, then option two. Option three is not acceptable to the DPO.",
      status: "Under Review"
    },
    {
      required: "Confirm that adherence will be reported at team level for the first six months.",
      background: "The staff forum raised concerns about individual monitoring.",
      options: "Team-level reporting for six months, or individual reporting from the start.",
      recommendation: "Team level for six months, then review with the staff forum.",
      status: "Approved",
      finalDecision: "Approved. Adherence reported at team level for the first six months.",
      rationale: "Builds confidence and addresses the staff forum concern without losing the benefit.",
      conditions: "Reviewed jointly with the staff forum at six months before any change.",
      impact: "No cost or date impact. Reduces adoption risk."
    }
  ],
  "PRJ-00009": [
    {
      required: "Approve go-live and phased firm enablement from 28 September.",
      background:
        "Pilot completed with two firms, eleven minor changes raised, nine closed. Security test findings resolved.",
      options: "Approve go-live as planned, or defer until all eleven pilot changes are closed.",
      recommendation:
        "Approve. The two outstanding changes are cosmetic and do not affect submission or tracking.",
      status: "Approved",
      finalDecision: "Approved. Phased enablement in four weekly waves from 28 September.",
      rationale:
        "Pilot evidence is strong, both firms adopted willingly, and the outstanding changes are cosmetic.",
      conditions:
        "Paper submission remains available throughout, and the two outstanding changes close before wave three.",
      impact: "None. Delivery is one week ahead of the baseline date."
    },
    {
      required: "Should the eight smallest firms be enabled in phase one or deferred to phase two?",
      background:
        "Eight firms are one or two adviser practices with low digital maturity. Adoption risk is rated high for them.",
      options:
        "Enable all forty firms in phase one, or enable thirty-two and handle the smallest eight with one-to-one support in phase two.",
      recommendation:
        "Enable all forty but schedule the smallest eight in wave four with one-to-one onboarding.",
      status: "Approved",
      finalDecision: "Approved. All forty firms in phase one, smallest eight in wave four with support.",
      rationale: "Deferring them would leave two processes running with no committed end date.",
      conditions: "Intermediary sales managers provide one-to-one onboarding for those eight firms.",
      impact: "No change to cost or date."
    }
  ],
  "PRJ-00010": [
    {
      required:
        "Build the assisted identity verification route now, or release in December without it and follow with a second release?",
      background:
        "The automated pass rate is 79% against an 85% assumption, so about one applicant in five needs an assisted route that was not designed. Building it now adds about six weeks.",
      options:
        "One, build now and re-baseline to 15 January. Two, release in December without it, routing failures to the existing paper process, and add the assisted route in a second release. Three, descope digital identity verification entirely.",
      recommendation:
        "Option two. It delivers the abandonment benefit for four fifths of applicants in December, and the assisted route follows without holding the whole release.",
      status: "Required",
      priority: "Critical"
    },
    {
      required: "Confirm the A/B pilot at 20% of traffic before full release.",
      background:
        "There is real doubt about whether abandonment is driven by journey friction or by price comparison.",
      options: "A/B pilot at 20%, pilot at 50%, or release fully and measure after.",
      recommendation: "20%. Enough to measure, small enough to limit exposure if the new journey performs worse.",
      status: "Approved",
      finalDecision: "Approved. A/B pilot at 20% of traffic for three weeks before full release.",
      rationale: "Measures the effect rather than assuming it, at limited exposure.",
      conditions: "Full release is conditional on the pilot showing a statistically significant improvement.",
      impact: "Adds three weeks to the plan, already reflected in the forecast."
    }
  ],
  "PRJ-00011": [
    {
      required:
        "Descope the two legacy products from the April release, or defer the legacy withdrawal to July?",
      background:
        "Neither legacy product can evidence fair value because outcome monitoring data was never captured. Remediation adds twelve weeks against a mandatory 6 April tax year date.",
      options:
        "One, launch the repriced range in April and withdraw the two legacy products in July as phase two. Two, hold the whole release to July. Three, launch in April with a documented regulatory exception for the two products.",
      recommendation:
        "Option one. It protects the April tax year opportunity and the £1.9m premium income, and handles the legacy products properly rather than exceptionally.",
      status: "Required",
      priority: "Critical"
    },
    {
      required: "Approve external actuarial support for pricing validation.",
      background:
        "Internal actuarial capacity is shared with PRJ-00014, which has court-driven dates that will take priority.",
      options: "Buy external validation at £45,000, or accept the scheduling risk.",
      recommendation: "Buy it. The April date cannot absorb an actuarial delay.",
      status: "Under Review"
    }
  ],
  "PRJ-00012": [
    {
      required:
        "Backfill PRJ-00007 with a contractor, or accept a later date here and the consequence for PRJ-00011?",
      background:
        "The shared data analyst has been redirected to PRJ-00007. This project has 0.5 of the 1.5 analysts it needs, and PRJ-00011 depends on its output for a mandatory April date.",
      options:
        "One, backfill PRJ-00007 with a contractor at about £48,000 and return the analyst here. Two, accept a later date here and descope PRJ-00011's legacy products. Three, recruit permanently, which will not land in time.",
      recommendation:
        "Option one. It is the cheapest way to protect a mandatory regulatory date on PRJ-00011.",
      status: "Required",
      priority: "Critical"
    }
  ],
  "PRJ-00013": [
    {
      required: "Approve Discovery funding for junior ISA digital onboarding.",
      background:
        "Logged at intake in July. Indicative cost £340,000, indicative benefit 30% application uplift plus £400,000 of gifting contributions.",
      options: "Approve Discovery in January 2027, defer to the 2027/28 planning round, or reject.",
      recommendation:
        "Approve Discovery in January 2027, sequenced after PRJ-00010 so the identity integration is reused.",
      status: "Required"
    }
  ],
  "PRJ-00014": [
    {
      required: "Approve the benefit mapping approach for the two products with no in-house equivalent.",
      background:
        "A with-profits endowment and a legacy tax-exempt savings plan affect about 1,900 transferring members. The independent expert and the court will scrutinise the mapping.",
      options:
        "One, map to the nearest in-house equivalent with a documented benefit-equivalence assessment. Two, administer both as closed books at higher ongoing cost. Three, exclude both from the scheme, which is not viable.",
      recommendation:
        "Option one, with the actuarial assessment reviewed by the independent expert in November.",
      status: "Under Review",
      priority: "Critical"
    },
    {
      required: "Confirm the transfer effective date of 26 November 2027.",
      background:
        "The indicative directions hearing has moved six weeks. Integration float absorbs about three weeks.",
      options: "Hold 26 November 2027, or move to May 2028 after the ISA season.",
      recommendation:
        "Hold November subject to the court date being fixed rather than indicative in November 2026.",
      status: "Under Review",
      priority: "Critical"
    },
    {
      required: "Approve the appointment of the independent expert.",
      background: "A Part VII transfer requires an independent expert report for the directions hearing.",
      options: "Three firms were assessed on relevance, capacity and cost.",
      recommendation: "Appoint the firm with prior friendly society transfer experience.",
      status: "Approved",
      finalDecision: "Approved. Independent expert appointed with prior friendly society transfer experience.",
      rationale: "Relevant experience reduces the risk of the report being challenged at the hearing.",
      conditions: "Engagement letter to include a fixed reporting date of 29 January 2027.",
      impact: "Cost of £185,000 included in the approved budget."
    }
  ],
  "PRJ-00015": [
    {
      required: "Confirm Discovery mobilisation timing relative to the transfer project.",
      background:
        "The pattern should be derived from real experience, which means waiting for PRJ-00014 integration design.",
      options: "Mobilise January 2027, or wait until PRJ-00014 completes in late 2027.",
      recommendation:
        "January 2027, running alongside the transfer so learning is captured while it is fresh.",
      status: "Under Review"
    }
  ],
  "PRJ-00016": [
    {
      required: "Approve project closure and handover to application support.",
      background:
        "All three populations migrated, multi-factor authentication enforced, nine hypercare tickets all closed, and the 2024 audit finding closed. Final outturn £762,400 against £780,000 approved.",
      options: "Approve closure, or extend hypercare by four weeks.",
      recommendation:
        "Approve closure. Hypercare has been quiet and there is nothing an extension would find.",
      status: "Approved",
      finalDecision:
        "Approved. Project closes on 25 September 2026 with two actions transferring to Technology.",
      rationale:
        "All go-live criteria met, hypercare quiet, audit finding closed, and delivered under budget.",
      conditions:
        "The final legacy directory server decommission and the annual access review transfer to Technology with named owners.",
      impact: "Releases 1.2 FTE and returns a £17,600 underspend."
    },
    {
      required: "Approve the telephone fallback as a permanent supported route.",
      background:
        "About 4,200 members cannot use an authenticator app. The fallback was added late and is now in production.",
      options: "Keep it permanently, or set a sunset date and migrate those members.",
      recommendation: "Keep it permanently. Removing it would exclude members with no smartphone.",
      status: "Approved",
      finalDecision: "Approved. The telephone fallback is a permanent supported route.",
      rationale:
        "The member base skews older and removing the route would exclude several thousand members.",
      conditions: "Reviewed annually as part of the access review.",
      impact: "Adds about £6,000 a year of run cost, accepted by Technology."
    }
  ],
  "PRJ-00017": [
    {
      required: "Approve project closure.",
      background:
        "All four servers decommissioned, 11.2TB disposed of and 2.8TB migrated. Delivered five weeks early and £24,000 under budget. No recovery requests received.",
      options: "Approve closure, or hold until the information asset register review completes.",
      recommendation:
        "Approve closure with the register review transferring to Information Governance.",
      status: "Under Review"
    },
    {
      required:
        "Approve assessment of unowned content directly against the retention schedule without a business owner.",
      background:
        "About 4.2TB of content had no identifiable owner, so retention decisions could not be delegated.",
      options:
        "One, assess against the schedule with DPO approval. Two, retain everything unowned indefinitely. Three, continue hunting for owners.",
      recommendation:
        "Option one. Option two defeats the purpose of the project and option three had already consumed six weeks.",
      status: "Approved",
      finalDecision:
        "Approved. Information Governance assesses unowned content directly against the retention schedule, with DPO approval of the approach.",
      rationale:
        "Six weeks had already been spent trying to identify owners with little success, and indefinite retention would have failed the project's purpose.",
      conditions:
        "Each server read-only for four weeks before disposal, backups retained 90 days, and a 200-item verification sample reviewed.",
      impact: "Recovered about four weeks of the six-week overrun."
    }
  ]
};

export function decisionsFor(project) {
  const content = DECISION_CONTENT[project.projectCode] || [];
  const anchor = project.actualStartDate || project.forecastStartDate || project.dateLogged;
  const ownerId = project.sponsorResourceId || project.projectManagerResourceId;
  const owner = person(ownerId);

  return content.map((item, index) => {
    const raised = workday(addDays(anchor, 45 + index * 28));
    const decided = item.status === "Approved" || item.status === "Rejected";
    const requiredBy = workday(addDays(raised, item.priority === "Critical" ? 21 : 35));

    return {
      decisionId: `DEC-${project.projectCode.slice(-5)}-${String(index + 1).padStart(3, "0")}`,
      projectCode: project.projectCode,
      decisionRequired: item.required,
      background: item.background,
      optionsConsidered: item.options,
      recommendation: item.recommendation,
      decisionOwner: owner.fullName,
      decisionOwnerResourceId: owner.resourceId,
      decisionOwnerEmail: owner.email || "",
      requiredByDate: requiredBy,
      status: item.status,
      finalDecision: item.finalDecision || "",
      decisionDate: decided ? workday(addDays(raised, 14)) : "",
      rationale: item.rationale || "",
      conditions: item.conditions || "",
      impact: item.impact || "",
      relatedRecords: "",
      supportingEvidence: decided ? "Project board minutes and the decision paper" : "",
      createdAt: at(raised, 9, 20),
      updatedAt: at(decided ? workday(addDays(raised, 14)) : workday(addDays(TODAY, -6)), 15, 10)
    };
  });
}

/* ----------------------------------------------------------------- documents

   Which documents exist depends on how far a project has got, which is what
   makes the document register a useful readiness check rather than a list.
*/
const STAGE_DOCUMENTS = [
  ["Business Case", "Intake", "Approved"],
  ["Project Profile", "Intake", "Approved"],
  ["Requirements", "Requirements and Design", "Approved"],
  ["Solution Design", "Requirements and Design", "Approved"],
  ["Project Plan", "Requirements and Design", "Approved"],
  ["RAID Log", "Discovery", "Approved"],
  ["Stage-Gate Pack", "Requirements and Design", "Approved"],
  ["Status Report", "Discovery", "Approved"],
  ["Test Evidence", "Test", "In Review"],
  ["Operational Readiness", "Implementation", "Draft"],
  ["Implementation Plan", "Implementation", "Approved"],
  ["Closure Report", "Closure", "Draft"],
  ["Lessons Learned", "Closure", "Draft"]
];

const STAGE_SEQUENCE = [
  "Intake",
  "Discovery",
  "Requirements and Design",
  "Build",
  "Test",
  "Implementation",
  "Hypercare",
  "Closure"
];

export function documentsFor(project) {
  const reached = STAGE_SEQUENCE.indexOf(project.currentStage);
  const owner = person(project.projectManagerResourceId);
  const anchor = project.dateLogged || project.forecastStartDate;
  const rows = [];

  STAGE_DOCUMENTS.forEach(([documentType, requiredAt, status], index) => {
    const requiredIndex = STAGE_SEQUENCE.indexOf(requiredAt);
    /* A document exists once the project has reached the stage that produces it. */
    if (requiredIndex > reached) return;

    const linked = workday(addDays(anchor, 21 + index * 18));
    const slug = documentType.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    rows.push({
      documentId: `DOC-${project.projectCode.slice(-5)}-${String(rows.length + 1).padStart(3, "0")}`,
      projectCode: project.projectCode,
      documentType,
      type: documentType,
      title: `${project.projectCode} ${documentType}`,
      name: `${project.projectCode} ${documentType}`,
      version: status === "Approved" ? "2.0" : "0.4",
      owner: owner.fullName,
      ownerResourceId: owner.resourceId,
      ownerEmail: owner.email || "",
      status,
      link: `https://example.com/change/${project.projectCode.toLowerCase()}/${slug}`,
      url: `https://example.com/change/${project.projectCode.toLowerCase()}/${slug}`,
      linkedDate: linked,
      approvalStatus: status === "Approved" ? "Approved" : status === "In Review" ? "Pending" : "Not Required",
      approvedVersion: status === "Approved" ? "2.0" : "",
      reviewDate: workday(addDays(linked, 182)),
      classification: project.confidentialityClassification || "Internal",
      notes:
        status === "Draft"
          ? "In preparation. Not yet issued for review."
          : status === "In Review"
            ? "Issued for review; comments due at the next project board."
            : "",
      createdAt: at(linked, 11, 0),
      updatedAt: at(linked, 11, 0)
    });
  });

  return rows;
}

/* ------------------------------------------------------------ status reports

   Three months of monthly reports for projects in delivery, with the most recent
   still in Draft so the submit and approve workflow has something to act on. The
   report content is assembled from the project's own plan, milestones and RAID,
   which is how buildStatusReport() does it in the application.
*/
export function statusReportsFor(project) {
  const reached = STAGE_SEQUENCE.indexOf(project.currentStage);
  /* Nothing at Intake reports yet: there is no delivery to report on. */
  if (reached < 1) return [];

  const tasks = plansFor(project);
  const milestones = milestonesFor(project);
  const raid = raidFor(project);
  const financial = financialsFor(project)[0];
  const owner = person(project.projectManagerResourceId);
  const approver = person(project.sponsorResourceId || "RES-0101");

  const behind = tasks.filter(
    (task) => task.status !== "Complete" && task.forecastEndDate > task.baselineEndDate
  );
  const completedMilestones = milestones.filter((row) => row.status === "Complete");
  const upcoming = milestones.filter((row) => row.status !== "Complete");
  const openRisks = raid.filter((row) => row.type === "Risk" && row.status !== "Closed");
  const openIssues = raid.filter((row) => row.type === "Issue" && row.status !== "Closed");
  const openDependencies = raid.filter((row) => row.type === "Dependency" && row.status !== "Closed");
  const decisionsPending = (DECISION_CONTENT[project.projectCode] || []).filter(
    (row) => row.status === "Required" || row.status === "Under Review"
  );
  const demandGap = project.resourceRag === "Red" || project.resourceRag === "Amber";

  const rows = [];
  /* Reports for the three most recent complete months, oldest first. */
  [3, 2, 1].forEach((monthsAgo, index) => {
    const periodStart = `${addMonths(TODAY, -monthsAgo).slice(0, 7)}-01`;
    const periodKey = periodStart.slice(0, 7);
    const isLatest = monthsAgo === 1;
    const status = isLatest ? "Draft" : "Approved";
    const dueDate = workday(addDays(addMonths(periodStart, 1), 4));

    rows.push({
      reportId: `STS-${project.projectCode.slice(-5)}-${String(index + 1).padStart(3, "0")}`,
      projectCode: project.projectCode,
      reportingPeriodId: `RP-${periodKey}`,
      reportingPeriod: monthLabel(periodStart),
      overallStatus: project.overallRag,
      scheduleRag: project.scheduleRag,
      resourceRag: project.resourceRag,
      financialRag: project.financialRag,
      scopeRag: project.scopeRag,
      benefitRag: project.benefitRag,
      riskRag: project.riskRag,
      qualityRag: project.qualityRag,
      operationalReadinessRag: project.operationalReadinessRag,
      executiveSummary: `${project.projectName} is ${project.overallRag} at ${project.percentageComplete}% complete in the ${project.currentStage} stage. ${project.currentPosition}`,
      progressThisPeriod:
        completedMilestones.length
          ? `Completed: ${completedMilestones.map((row) => row.milestoneName).join("; ")}.`
          : "No milestones completed this period. Work continued against the current stage plan.",
      plannedNextPeriod: project.nextSteps,
      completedMilestones: completedMilestones.length
        ? completedMilestones
            .map((row) => `${row.milestoneName} (${row.forecastFinishDate})`)
            .join("; ")
        : "None this period.",
      upcomingMilestones: upcoming.length
        ? upcoming
            .slice(0, 4)
            .map((row) => `${row.milestoneName} - forecast ${row.forecastFinishDate}${row.status === "Overdue" ? " (overdue)" : ""}`)
            .join("; ")
        : "None outstanding.",
      tasksBehindPlan: behind.length
        ? `${behind.length} task${behind.length === 1 ? "" : "s"} forecast beyond baseline: ${behind
            .slice(0, 3)
            .map((task) => task.taskName)
            .join("; ")}.`
        : "No tasks are forecast beyond their baseline dates.",
      risksAndIssues: `${openRisks.length} open risk${openRisks.length === 1 ? "" : "s"} and ${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"}.${
        openIssues.length ? ` Principal issue: ${openIssues[0].title}.` : ""
      }${openRisks.length ? ` Principal risk: ${openRisks[0].title}.` : ""}`,
      decisionsRequired: decisionsPending.length
        ? decisionsPending.map((row) => row.required).join(" ")
        : "None outstanding.",
      dependencies: openDependencies.length
        ? openDependencies.map((row) => `${row.title} (required by ${row.requiredByDate}, confidence ${row.dependencyConfidence})`).join("; ")
        : "No open dependencies.",
      resourcePosition: demandGap
        ? `Resource is ${project.resourceRag}. ${project.resourceDemandSummary || "Demand exceeds confirmed supply."}`
        : `Resource is ${project.resourceRag}. ${project.resourceDemandSummary || "Demand is met."}`,
      financialPosition: financial
        ? `Approved budget £${financial.approvedBudget.toLocaleString("en-GB")}, forecast outturn £${financial.forecastCost.toLocaleString("en-GB")}, actual to date £${financial.actualCost.toLocaleString("en-GB")}. Variance ${financial.budgetVariancePercentage}%.`
        : "No approved budget.",
      scopeChanges:
        project.scopeRag === "Red"
          ? "A change request is with the change control board; see the decision register."
          : "No scope changes this period.",
      benefitsUpdate:
        "Benefit measures are on track against the approved measurement approach. No change to forecast benefit.",
      returnToGreenActions: project.returnToGreen || "Not applicable; the project is not off track.",
      sponsorComments: isLatest
        ? ""
        : "Reviewed and approved. Content is a fair reflection of the position discussed at the project board.",
      status,
      version: isLatest ? 1 : 2,
      dueDate,
      submittedDate: isLatest ? "" : workday(addDays(dueDate, -2)),
      approvedDate: isLatest ? "" : dueDate,
      preparedBy: owner.fullName,
      preparedByResourceId: owner.resourceId,
      approverName: approver.fullName,
      approverResourceId: approver.resourceId,
      createdAt: at(workday(addDays(dueDate, -5)), 9, 45),
      updatedAt: at(isLatest ? workday(addDays(TODAY, -2)) : dueDate, 14, 30)
    });
  });

  return rows;
}

/* ---------------------------------------------------------------- stage gates

   Two shapes per gate. `draft` is what can legally be inserted: a clean Draft with
   no history. `final` is the state the gate should end up in, applied afterwards
   as an update with ppm.stage_gate_workflow set.

   Gates already passed are Approved with a decision history. The gate a project is
   currently working towards is Draft, or Submitted where the pack has gone in.
*/
const GATE_NAMES = [
  ["Gate 0", "Intake", "Discovery"],
  ["Gate 1", "Discovery", "Requirements and Design"],
  ["Gate 2", "Requirements and Design", "Build"],
  ["Gate 3", "Build", "Test"],
  ["Gate 4", "Test", "Implementation"],
  ["Gate 5", "Implementation", "Hypercare"],
  ["Gate 6", "Hypercare", "Closure"],
  ["Gate 7", "Closure", ""]
];

export function stageGatesFor(project) {
  const reached = STAGE_SEQUENCE.indexOf(project.currentStage);
  if (reached < 0) return [];

  const submitter = person(project.projectManagerResourceId);
  const sponsor = person(project.sponsorResourceId || "RES-0101");
  const pmo = person("RES-0101");
  const anchor = project.actualStartDate || project.forecastStartDate || project.dateLogged;
  const rows = [];

  /* Every gate the project has passed, plus the one it is working towards. */
  for (let index = 0; index <= reached && index < GATE_NAMES.length; index += 1) {
    const [gateLabel, fromStage, toStage] = GATE_NAMES[index];
    const passed = index < reached;
    const gateId = `SG-${project.projectCode.slice(-5)}-${String(index).padStart(2, "0")}`;
    const meetingDate = workday(addDays(anchor, 30 + index * 55));
    const decisionDate = meetingDate;

    /* The current gate is Submitted only where the project is far enough into the
       stage to have produced a pack, otherwise it is still Draft. */
    const current = index === reached;
    const submitted = current && project.percentageComplete >= 40;
    const workflowStatus = passed ? "Approved" : submitted ? "Submitted" : "Draft";

    const base = {
      gateId,
      gateName: `${gateLabel} - ${fromStage} complete`,
      projectCode: project.projectCode,
      projectName: project.projectName,
      programmeId: project.programmeId,
      programmeName: project.programme,
      currentStage: fromStage,
      proposedNextStage: toStage,
      routeRequirement: "Required",
      routeReason: "",
      routeApprover: "",
      routeApproverResourceId: "",
      routeApproverEmail: "",
      routeApprovalDate: "",
      routeApprovalComments: "",
      routeRequestedBy: "",
      routeRequestedByResourceId: "",
      routeRequestedAt: "",
      submissionOwner: submitter.fullName,
      submissionOwnerResourceId: submitter.resourceId,
      submissionOwnerEmail: submitter.email || "",
      requiredApprovers: [
        { name: sponsor.fullName, resourceId: sponsor.resourceId, email: sponsor.email || "" },
        { name: pmo.fullName, resourceId: pmo.resourceId, email: pmo.email || "" }
      ],
      requiredApproverResourceIds: [sponsor.resourceId, pmo.resourceId],
      meetingDate: passed || submitted ? meetingDate : workday(addDays(TODAY, 21)),
      submissionComments: `Stage gate submission for ${gateLabel}. Deliverables for the ${fromStage} stage are complete and evidenced in the document register.`,
      conditions: "",
      supportingDocuments: [
        {
          title: `${project.projectCode} Stage-Gate Pack`,
          link: `https://example.com/change/${project.projectCode.toLowerCase()}/stage-gate-pack`
        }
      ],
      actionOwner: submitter.fullName,
      actionOwnerResourceId: submitter.resourceId,
      actionOwnerEmail: submitter.email || "",
      actionDueDate: "",
      createdAt: at(workday(addDays(meetingDate, -14)), 10, 30),
      createdBy: submitter.fullName,
      createdByResourceId: submitter.resourceId,
      updatedAt: at(passed || submitted ? decisionDate : workday(addDays(TODAY, -3)), 15, 0),
      updatedBy: passed ? sponsor.fullName : submitter.fullName,
      updatedByResourceId: passed ? sponsor.resourceId : submitter.resourceId
    };

    /* The insertable shape: Draft, no history, no links. Anything else is refused
       by the insert guard regardless of privilege. */
    const draft = {
      ...base,
      routeApprovalStatus: "Not Required",
      submissionDate: "",
      submittedBy: "",
      submittedByResourceId: "",
      submittedAt: "",
      decisionDate: "",
      workflowStatus: "Draft",
      status: "Draft",
      revision: 1,
      version: 1,
      approvalComments: "",
      rejectionDeferralReason: "",
      actionsArising: [],
      linkedActionIds: [],
      decisionSummary: "",
      linkedDecisionId: "",
      completionDate: "",
      decisionHistory: [],
      routeApprovalHistory: [],
      submissionHistory: []
    };

    if (workflowStatus === "Draft") {
      rows.push({ draft, final: null });
      continue;
    }

    const submissionAt = at(workday(addDays(meetingDate, -7)), 16, 45);
    const final = {
      ...base,
      routeApprovalStatus: "Not Required",
      submissionDate: workday(addDays(meetingDate, -7)),
      submittedBy: submitter.fullName,
      submittedByResourceId: submitter.resourceId,
      submittedAt: submissionAt,
      decisionDate: passed ? decisionDate : "",
      workflowStatus,
      status: workflowStatus,
      revision: 1,
      version: 1,
      approvalComments: passed
        ? `Approved. ${fromStage} deliverables reviewed and accepted. Proceed to ${toStage}.`
        : "",
      rejectionDeferralReason: "",
      actionsArising: passed
        ? [
            {
              description: `Confirm ${toStage} resourcing before the next reporting cycle.`,
              owner: submitter.fullName,
              ownerResourceId: submitter.resourceId,
              ownerEmail: submitter.email || "",
              dueDate: workday(addDays(decisionDate, 21))
            }
          ]
        : [],
      linkedActionIds: [],
      decisionSummary: passed ? `${gateLabel} approved; project moved to ${toStage}.` : "",
      linkedDecisionId: "",
      completionDate: passed ? decisionDate : "",
      decisionHistory: passed
        ? [
            {
              decidedAt: at(decisionDate, 15, 0),
              decision: "Approved",
              decidedBy: sponsor.fullName,
              decidedByResourceId: sponsor.resourceId,
              comments: `Approved at the ${gateLabel} review.`
            }
          ]
        : [],
      routeApprovalHistory: [],
      submissionHistory: [
        {
          submittedAt: submissionAt,
          submittedBy: submitter.fullName,
          submittedByResourceId: submitter.resourceId,
          revision: 1,
          comments: "Initial submission."
        }
      ]
    };

    rows.push({ draft, final });
  }

  return rows;
}

/* ------------------------------------------------------- recorded RAG history

   Append-only. Each snapshot records what the tool calculated against what was
   reported, plus a justification wherever a project manager overrode the
   calculation. The overrides are the point: they are what the audit trail is for.
*/
const RAG_DIMENSIONS = [
  "schedule",
  "scope",
  "financial",
  "resource",
  "risk",
  "benefit",
  "quality",
  "operationalReadiness"
];

const DIMENSION_FIELD = {
  schedule: "scheduleRag",
  scope: "scopeRag",
  financial: "financialRag",
  resource: "resourceRag",
  risk: "riskRag",
  benefit: "benefitRag",
  quality: "qualityRag",
  operationalReadiness: "operationalReadinessRag"
};

const WORST = ["Not Assessed", "Green", "Amber", "Red"];

function worst(values) {
  return values.reduce((current, value) => (WORST.indexOf(value) > WORST.indexOf(current) ? value : current), "Not Assessed");
}

/* Where a project manager reported better than the tool calculated, and why. This
   is the honest version of an override: it needs a reason. */
const OVERRIDES = {
  "PRJ-00008": {
    schedule: ["Amber", "The four-week slippage is absorbed in build float, so the calculated Red overstates the position."]
  },
  "PRJ-00010": {
    schedule: ["Amber", "Change control on 2 October determines the date. Reporting Amber pending that decision rather than Red."]
  },
  "PRJ-00014": {
    schedule: ["Amber", "Court dates are outside our control and three of the six weeks are absorbed in integration float."]
  },
  "PRJ-00006": {
    operationalReadiness: ["Amber", "Servicing training is not yet booked, which the calculation does not see."]
  }
};

export function ragHistoryFor(project) {
  const reached = STAGE_SEQUENCE.indexOf(project.currentStage);
  if (reached < 1) return [];

  const recorder = person(project.projectManagerResourceId);
  const overrides = OVERRIDES[project.projectCode] || {};
  const rows = [];

  /* One snapshot per monthly reporting cycle for the last three months, matching
     the status reports so the two tell the same story. */
  [3, 2, 1].forEach((monthsAgo, index) => {
    const recordedOn = workday(addDays(`${addMonths(TODAY, -monthsAgo).slice(0, 7)}-01`, 4));
    const dimensions = {};

    RAG_DIMENSIONS.forEach((key) => {
      const reported = project[DIMENSION_FIELD[key]] || "Not Assessed";
      const override = overrides[key];
      /* Without an override, calculated and reported agree. With one, the
         calculated value is a notch worse and the reason is recorded. */
      const calculated = override
        ? WORST[Math.min(3, WORST.indexOf(reported) + 1)]
        : reported;
      dimensions[key] = {
        calculated,
        reported: override ? override[0] : reported,
        override: Boolean(override),
        justification: override ? override[1] : ""
      };
    });

    dimensions.overall = {
      calculated: worst(RAG_DIMENSIONS.map((key) => dimensions[key].calculated)),
      reported: project.overallRag,
      override: worst(RAG_DIMENSIONS.map((key) => dimensions[key].calculated)) !== project.overallRag,
      justification:
        worst(RAG_DIMENSIONS.map((key) => dimensions[key].calculated)) !== project.overallRag
          ? "Overall reported at the project board's assessment, taking account of the recovery actions in progress."
          : ""
    };

    rows.push({
      statusId: `STATUS-${project.projectCode.slice(-5)}-${String(index + 1).padStart(3, "0")}`,
      projectCode: project.projectCode,
      recordedAt: at(recordedOn, 10, 0),
      recordedBy: recorder.fullName,
      recordedByResourceId: recorder.resourceId,
      reportingPeriod: monthLabel(recordedOn),
      dimensions
    });
  });

  return rows;
}

export { STAGE_SEQUENCE, DECISION_CONTENT };
