/*
  STAGE 14A - RAID log content.

  Written per project rather than generated, because a RAID log of filler is the
  single clearest tell that data is fake, and RAID is where most of the testing
  value sits: escalation, scoring, appetite, closure evidence and cross-project
  dependencies all live here.

  Risks state cause, event and effect separately. That is the discipline the RAID
  page is built around, and it is what makes a risk reviewable rather than a
  vague worry.

  The dependencies are deliberately real: PRJ-00007 blocks PRJ-00014, PRJ-00012
  blocks PRJ-00011, and PRJ-00016 unblocked PRJ-00006 and PRJ-00009. That gives
  the cross-project dependency views something true to show.
*/

import { person } from "./STAGE-14A-DEMO-PEOPLE.mjs";
import { addDays, workday, TODAY } from "./STAGE-14A-DEMO-DATES.mjs";

export const RAID_CONTENT = {
  "PRJ-00006": [
    {
      type: "Risk",
      title: "Self-service adoption below forecast",
      cause: "members are habituated to calling and the portal is promoted only at launch",
      event: "adoption stalls well below the 35% target",
      effect: "the call reduction benefit is not realised and the business case is not met",
      probability: 3,
      impact: 4,
      mitigation:
        "Staged communications across statements, email and the contact centre. Agents prompt members to register at the end of every routine call.",
      contingency:
        "Extend the promotion period and add a registration incentive, funded from the contingency line.",
      residualProbability: 2,
      residualImpact: 4,
      status: "Open"
    },
    {
      type: "Risk",
      title: "Servicing platform API version withdrawal",
      cause: "the vendor has signalled that API v4 will be deprecated during 2027",
      event: "the portal has to be reworked onto v5 within a year of launch",
      effect: "unplanned rework of roughly 40 development days",
      probability: 3,
      impact: 3,
      mitigation:
        "An interface layer isolates every platform call behind an internal contract, so a version change is contained to one component.",
      contingency: "Include v5 migration in the 2027 change plan as a known item.",
      residualProbability: 3,
      residualImpact: 2,
      status: "Open"
    },
    {
      type: "Dependency",
      title: "Member multi-factor authentication from the identity platform",
      direction: "Inbound",
      provider: "PRJ-00016 Identity and Access Platform",
      recipient: "PRJ-00006 Member Self-Service Portal",
      status: "Closed",
      confidence: "High",
      requiredBy: "2026-06-30",
      impactIfMissed:
        "Registration and sign-in could not be built, blocking the whole release. Delivered on time in June.",
      description:
        "Member-facing multi-factor authentication had to exist before portal registration could be built.",
      closureEvidence: "Confirmed delivered by PRJ-00016 on 26 June and integrated in sprint 8."
    },
    {
      type: "Assumption",
      title: "Six weeks of UAT with twelve servicing colleagues is sufficient",
      status: "Open",
      description:
        "The test plan assumes twelve servicing colleagues can be released at 50% for six weeks. If the ISA peak extends, that release is at risk.",
      businessImpact: "Compressed UAT would reduce defect detection before launch."
    },
    {
      type: "Issue",
      title: "Fund switch pricing feed contract changed mid-build",
      status: "In Progress",
      description:
        "The fund administrator changed the pricing feed contract in July, requiring rework of fund switch valuation logic.",
      rootCause:
        "The feed contract was not covered by a change notification agreement, so the change arrived without notice.",
      businessImpact: "Fund switch build is one sprint behind; other transactions are unaffected.",
      deliveryImpact: "Six development days of rework, absorbed within release one float.",
      resolutionPlan:
        "Rework completes by 5 September. A change notification clause has been requested at the next contract renewal.",
      workaround: "Fund switches can be dropped from release one if the rework overruns."
    }
  ],

  "PRJ-00007": [
    {
      type: "Issue",
      title: "Pre-2004 unit-linked transactions have no unit price",
      status: "In Progress",
      priority: "Critical",
      escalation: "Escalated",
      description:
        "About 41,000 unit-linked transaction rows dated before 2004 hold a null or zero unit price in the legacy system, so migrated transaction values cannot be reconciled.",
      rootCause:
        "The legacy system did not store unit prices against transactions before a 2004 upgrade. It recalculated them at display time from a price table that was later purged.",
      businessImpact:
        "Transaction history for affected members would show values that cannot be evidenced, which fails the record-keeping obligation the project exists to satisfy.",
      deliveryImpact:
        "Implementation moved from August to December. This is the single cause of the project being Red.",
      resolutionPlan:
        "Reconstruct prices from the fund administrator archive where available, and agree a documented tolerance with Risk and Finance for the remainder. Board decision 14 October.",
      workaround:
        "Affected transactions can migrate with a flag marking the value as reconstructed, subject to Finance and Risk acceptance."
    },
    {
      type: "Issue",
      title: "Duplicate member records in the legacy system",
      status: "In Progress",
      priority: "High",
      description:
        "The legacy system permitted the same member to exist more than once. Matching has identified 1,840 probable duplicates needing a merge decision.",
      rootCause: "No unique member constraint existed in the 1998 data model.",
      businessImpact: "Duplicate members would receive duplicate correspondence and hold split history.",
      deliveryImpact: "Adds a manual review step of roughly 15 person-days before cutover.",
      resolutionPlan:
        "Automated matching produces a confidence score. Above 95% merges automatically; the remainder is reviewed by two servicing colleagues.",
      workaround: "None. Duplicates must be resolved before cutover."
    },
    {
      type: "Risk",
      title: "Reconciliation does not reach the acceptance threshold",
      cause: "legacy data quality is worse than profiled and price reconstruction is only partly possible",
      event: "trial five reconciles below 99.9% and cutover cannot be approved",
      effect:
        "implementation slips past December into the ISA season freeze, delaying the project by five months",
      probability: 3,
      impact: 5,
      priority: "Critical",
      escalation: "Escalated",
      mitigation:
        "Reconstruct prices from the administrator archive and prepare a tolerance recommendation in parallel, so the board gets a decision rather than a problem.",
      contingency:
        "Migrate post-2004 history in full and hold pre-2004 history in a read-only archive with an index link. This was option two at Discovery and remains viable.",
      residualProbability: 2,
      residualImpact: 5,
      status: "Open"
    },
    {
      type: "Risk",
      title: "Key person dependency on the legacy platform",
      cause: "only two people understand the legacy servicing database",
      event: "one or both are unavailable during cutover",
      effect: "cutover cannot proceed safely and would be aborted",
      probability: 2,
      impact: 5,
      mitigation:
        "Cutover runbook documented to a standard a third party can follow, and a third engineer shadowed both trial loads.",
      contingency: "Cutover defers to the following month rather than proceeding without cover.",
      residualProbability: 1,
      residualImpact: 5,
      status: "Open"
    },
    {
      type: "Dependency",
      title: "Fund administrator archive extract",
      direction: "Inbound",
      provider: "External fund administrator",
      recipient: "PRJ-00007 Servicing Data Migration",
      status: "Open",
      confidence: "Low",
      priority: "Critical",
      escalation: "Escalated",
      requiredBy: "2026-09-18",
      impactIfMissed: "Unit prices cannot be reconstructed and the tolerance route becomes the only option.",
      description:
        "Archived unit prices back to 1998 are needed to reconstruct pre-2004 transaction values. The administrator has confirmed the archive is partial, covering 1999 onwards."
    },
    {
      type: "Assumption",
      title: "One cutover weekend is sufficient",
      status: "Open",
      description:
        "Trial four completed the full load in 31 hours against a 48-hour window. The assumption holds provided data volume does not grow more than 10% before cutover.",
      businessImpact: "An overrun would extend the servicing outage into a working day."
    },
    {
      type: "Risk",
      title: "Data engineer vacancy remains unfilled",
      cause: "the second data engineer post has been vacant since June and the market is tight",
      event: "reconstruction and reconciliation run at two thirds of planned capacity",
      effect: "trial five slips and the December date is lost",
      probability: 4,
      impact: 4,
      priority: "High",
      mitigation:
        "Contractor sourcing under way, and the shared analyst from PRJ-00012 has been redirected here as an interim measure.",
      contingency: "Administrator professional services can supply two weeks of reconciliation effort.",
      residualProbability: 3,
      residualImpact: 3,
      status: "Open"
    }
  ],

  "PRJ-00008": [
    {
      type: "Issue",
      title: "Data processing terms unresolved with the preferred vendor",
      status: "In Progress",
      priority: "High",
      description:
        "The vendor's standard data processing schedule permits sub-processing outside the UK without prior notice, which the Data Protection Officer will not accept.",
      rootCause: "Vendor standard terms were not reviewed by the DPO before shortlisting.",
      businessImpact: "The contract cannot be signed, so configuration cannot start.",
      deliveryImpact: "Four weeks of delay so far, and the design gate has moved to 16 October.",
      resolutionPlan:
        "Legal has a final position with the vendor for 2 October. If unresolved, the second-placed vendor is re-engaged.",
      workaround: "None. Contract signature is a precondition."
    },
    {
      type: "Risk",
      title: "Staff resistance to measured adherence",
      cause: "adherence has never been measured and the staff forum has raised monitoring concerns",
      event: "adoption is passive and schedules are worked around rather than followed",
      effect: "forecast accuracy and service level benefits are not realised",
      probability: 3,
      impact: 4,
      mitigation:
        "Staff forum engaged from Discovery, adherence reported at team level rather than individual level for the first six months, and listening sessions run by the change lead.",
      contingency: "Extend the parallel run and delay adherence reporting until confidence is built.",
      residualProbability: 2,
      residualImpact: 3,
      status: "Open"
    },
    {
      type: "Dependency",
      title: "HR system absence feed",
      direction: "Inbound",
      provider: "HR - people systems team",
      recipient: "PRJ-00008 Contact Centre Workforce Management",
      status: "Open",
      confidence: "Medium",
      requiredBy: "2026-11-13",
      impactIfMissed: "Holiday and absence would be maintained twice, removing much of the benefit.",
      description:
        "A daily absence extract from the HR system is required for scheduling to reflect real availability."
    },
    {
      type: "Assumption",
      title: "Telephony historical data is sufficient for forecasting",
      status: "Closed",
      description:
        "Forecasting needs at least 24 months of interval-level call history. Confirmed available and extracted in July.",
      closureEvidence: "Extract validated by the vendor as suitable for forecast model training."
    }
  ],

  "PRJ-00009": [
    {
      type: "Risk",
      title: "Low adoption among the smallest adviser firms",
      cause: "eight of the forty firms are one or two adviser practices with low digital maturity",
      event: "those firms keep submitting on paper after enablement",
      effect: "the rekeying benefit is partly unrealised and two processes run in parallel indefinitely",
      probability: 4,
      impact: 3,
      mitigation:
        "Intermediary sales managers give one-to-one onboarding to the eight firms, and webinars are recorded for later viewing.",
      contingency: "Accept paper submission for those firms through 2027 and revisit at the phase two case.",
      residualProbability: 3,
      residualImpact: 2,
      status: "Open"
    },
    {
      type: "Issue",
      title: "Commission statement rounding differences",
      status: "Closed",
      description:
        "Portal commission statements differed from existing statements by up to two pence per policy because of a rounding difference.",
      rootCause: "The portal rounded per policy; the existing engine rounded per statement.",
      businessImpact: "Advisers would have queried every statement, undermining confidence at launch.",
      deliveryImpact: "Three development days, resolved during the pilot.",
      resolutionPlan: "The portal now calls the commission engine directly rather than recalculating.",
      actualResolution: "2026-07-31",
      closureEvidence: "Verified across 200 statements from both pilot firms with zero variance."
    },
    {
      type: "Dependency",
      title: "Adviser multi-factor authentication from the identity platform",
      direction: "Inbound",
      provider: "PRJ-00016 Identity and Access Platform",
      recipient: "PRJ-00009 Adviser Portal Phase 1",
      status: "Closed",
      confidence: "High",
      requiredBy: "2026-05-29",
      impactIfMissed: "Firm-level access control could not be delivered. Delivered in May.",
      description: "Adviser authentication depends on the identity platform's adviser population.",
      closureEvidence: "Adviser population migrated by PRJ-00016 on 22 May and integrated the same month."
    },
    {
      type: "Assumption",
      title: "Firms will adopt without financial incentive",
      status: "Closed",
      description:
        "The business case assumed no incentive payment. The pilot confirmed both firms adopted willingly on the strength of application tracking alone.",
      closureEvidence: "Pilot feedback from both firms recorded in the pilot review pack."
    }
  ],

  "PRJ-00010": [
    {
      type: "Issue",
      title: "Identity verification automated pass rate below assumption",
      status: "In Progress",
      priority: "High",
      escalation: "Escalation Required",
      description:
        "The business case assumed an 85% automated identity pass rate. Testing across 1,200 sample applications shows 79%, so about one applicant in five needs an assisted route that was never designed.",
      rootCause:
        "The supplier's quoted rate was based on a broader population than the society's, which skews older and has more members sharing an address.",
      businessImpact:
        "Without an assisted route, one in five applicants abandons at the identity step, which is the problem the project exists to fix.",
      deliveryImpact: "Adds about six weeks. This is why schedule is Amber and scope is Red.",
      resolutionPlan:
        "Change request to the change control board on 2 October with two options: build the assisted route now and re-baseline to January, or release without it in December and follow with a second release.",
      workaround:
        "Applicants failing automated checks can route to the existing paper identity process, which is poor but functional."
    },
    {
      type: "Risk",
      title: "Abandonment does not improve as forecast",
      cause: "abandonment may be driven by price and product comparison rather than journey friction",
      event: "the shortened journey does not move the abandonment rate materially",
      effect: "the 2,100 additional applications a year benefit is not realised",
      probability: 3,
      impact: 4,
      mitigation: "A/B pilot on 20% of traffic before full release, so the effect is measured not assumed.",
      contingency:
        "If the A/B test shows no improvement, hold the release and reopen Discovery on pricing and product presentation.",
      residualProbability: 2,
      residualImpact: 4,
      status: "Open"
    },
    {
      type: "Dependency",
      title: "Marketing automation platform for abandonment follow-up",
      direction: "Inbound",
      provider: "Digital Marketing",
      recipient: "PRJ-00010 Online Quote and Apply Uplift",
      status: "Open",
      confidence: "High",
      requiredBy: "2026-10-30",
      impactIfMissed: "Follow-up emails cannot be sent, removing part of the benefit.",
      description:
        "Emails to members who abandon part way require a trigger from the marketing automation platform."
    },
    {
      type: "Assumption",
      title: "Underwriting rules are unchanged",
      status: "Open",
      description:
        "The redesign assumes no change to eligibility or underwriting rules. A change during build would mean rework of the eligibility step.",
      businessImpact: "Roughly ten development days of rework if rules change."
    }
  ],

  "PRJ-00011": [
    {
      type: "Issue",
      title: "No outcome monitoring data for two legacy products",
      status: "In Progress",
      priority: "Critical",
      escalation: "Escalated",
      description:
        "The Consumer Duty value assessment cannot evidence fair value for the 2009 and 2011 legacy ISA products because outcome monitoring data was never captured for them.",
      rootCause:
        "Outcome monitoring was introduced in 2023 and applied prospectively to products then on sale. Closed products were never brought into scope.",
      businessImpact:
        "The society cannot demonstrate fair value for two products still held by about 8,600 members, which is a regulatory exposure independent of this project.",
      deliveryImpact:
        "Adds about twelve weeks and puts the mandatory April tax year date at risk. This is why the project is Red.",
      resolutionPlan:
        "Agree remediation with Risk and Compliance by 9 October, then present two options to the board on 14 October: descope the two products, or defer the legacy withdrawal to July.",
      workaround:
        "The new range can launch in April with the legacy withdrawal handled separately, preserving most of the benefit."
    },
    {
      type: "Risk",
      title: "April tax year deadline cannot be met",
      cause: "remediation of the two legacy products sits on the critical path to launch",
      event: "the new range is not configured and communicated in time for 6 April",
      effect: "launch slips a full year to the 2028/29 tax year, deferring £1.9m of premium income",
      probability: 3,
      impact: 5,
      priority: "Critical",
      escalation: "Escalated",
      mitigation:
        "Separate the range launch from the legacy withdrawal so the two are not bound to one date, and start configuration in parallel with remediation.",
      contingency: "Launch the repriced range in April and withdraw legacy products in July as phase two.",
      residualProbability: 2,
      residualImpact: 5,
      status: "Open"
    },
    {
      type: "Dependency",
      title: "Outcome monitoring framework from PRJ-00012",
      direction: "Inbound",
      provider: "PRJ-00012 Consumer Duty Outcome Monitoring",
      recipient: "PRJ-00011 ISA Range Repricing 2027",
      status: "Open",
      confidence: "Low",
      priority: "Critical",
      escalation: "Escalated",
      requiredBy: "2026-12-18",
      impactIfMissed:
        "Fair value assessments have to be produced manually again, which is the position that created this issue.",
      description:
        "The value assessments here rely on measure definitions and a data model from PRJ-00012, which is itself Amber on resource."
    },
    {
      type: "Risk",
      title: "Actuarial capacity is shared with the transfer project",
      cause: "the same actuarial resource supports PRJ-00014, which has court-driven dates",
      event: "pricing sign-off is deprioritised when transfer deadlines bite",
      effect: "configuration cannot start and the April date is lost",
      probability: 3,
      impact: 4,
      mitigation:
        "Actuarial commitments for both projects are booked in the resource plan and reviewed monthly at the portfolio board.",
      contingency: "External actuarial support for pricing validation, costed at £45,000.",
      residualProbability: 2,
      residualImpact: 4,
      status: "Open"
    },
    {
      type: "Assumption",
      title: "No existing member is worse off through withdrawal",
      status: "Open",
      description:
        "The Board's commitment is that withdrawal from sale does not change existing holders' terms. The design assumes this holds and no member migration is needed.",
      businessImpact:
        "If member migration were required the project would roughly double in size and need separate approval."
    }
  ],

  "PRJ-00012": [
    {
      type: "Issue",
      title: "Data analyst capacity held on another project",
      status: "In Progress",
      priority: "High",
      escalation: "Escalation Required",
      description:
        "The project needs 1.5 data analysts and has 0.5, because the shared analyst has been redirected to PRJ-00007 reconciliation work.",
      rootCause:
        "Both projects were resourced from the same small data team without a prioritisation decision at the portfolio board.",
      businessImpact:
        "Delay here delays PRJ-00011, which has a mandatory April regulatory date, so the impact is not confined to this project.",
      deliveryImpact: "Discovery started two weeks late and runs at about a third of planned pace.",
      resolutionPlan:
        "Resourcing decision requested at the portfolio board on 14 October: backfill PRJ-00007 with a contractor, or formally accept a later date here and the consequence for PRJ-00011.",
      workaround: "The business analyst is covering data profiling at reduced depth."
    },
    {
      type: "Risk",
      title: "A third of required measures have no data source",
      cause: "early profiling suggests about a third of outcome measures are captured nowhere",
      event: "new data capture is needed across servicing and the fund administrator",
      effect: "scope and cost grow materially beyond the £410,000 estimate",
      probability: 4,
      impact: 4,
      mitigation:
        "Discovery is explicitly tasked with agreeing a minimum viable measure set with Risk and Compliance rather than an ideal set.",
      contingency: "Deliver against available data first and add new capture as a second phase.",
      residualProbability: 3,
      residualImpact: 3,
      status: "Open"
    },
    {
      type: "Dependency",
      title: "PRJ-00007 completion releases the shared data analyst",
      direction: "Inbound",
      provider: "PRJ-00007 Servicing Data Migration",
      recipient: "PRJ-00012 Consumer Duty Outcome Monitoring",
      status: "Open",
      confidence: "Low",
      requiredBy: "2026-12-11",
      impactIfMissed: "This project stays under-resourced and PRJ-00011 slips with it.",
      description:
        "The 1.0 FTE shortfall resolves when PRJ-00007 finishes reconciliation, currently forecast December."
    },
    {
      type: "Assumption",
      title: "The existing MI platform can host the reporting layer",
      status: "Open",
      description:
        "Discovery assumes the existing MI platform can support quarterly outcome reporting without a licence uplift. Not yet confirmed with the vendor.",
      businessImpact: "A licence uplift would add an estimated £30,000 a year of run cost."
    }
  ],

  "PRJ-00013": [
    {
      type: "Risk",
      title: "Child identity verification may not be possible without a passport",
      cause: "identity verification suppliers have limited coverage for under-16s",
      event: "no automated route exists and every application needs manual document review",
      effect: "the digital journey delivers little benefit over the current paper process",
      probability: 3,
      impact: 4,
      mitigation: "Confirm supplier capability for under-16s as the first activity in Discovery.",
      contingency:
        "Verify the parent digitally and accept a single document for the child, subject to financial crime approval.",
      residualProbability: 2,
      residualImpact: 3,
      status: "Open"
    },
    {
      type: "Dependency",
      title: "Reuse of the identity verification integration from PRJ-00010",
      direction: "Inbound",
      provider: "PRJ-00010 Online Quote and Apply Uplift",
      recipient: "PRJ-00013 Junior ISA Digital Onboarding",
      status: "Open",
      confidence: "Medium",
      requiredBy: "2027-01-11",
      impactIfMissed: "The integration would be built twice, adding an estimated £60,000.",
      description:
        "This project is deliberately sequenced after PRJ-00010 so the identity verification integration is reused."
    },
    {
      type: "Assumption",
      title: "Gifting can be delivered without a paper mandate",
      status: "Open",
      description:
        "The benefit case assumes family members can contribute digitally without a signed mandate. Financial crime requirements are unconfirmed.",
      businessImpact: "A mandate requirement would remove most of the gifting benefit."
    }
  ],

  "PRJ-00014": [
    {
      type: "Risk",
      title: "Court timetable moves again",
      cause: "hearing dates are allocated by the court and are outside the society's control",
      event: "the directions or sanction hearing moves further, as it already has once",
      effect: "the November 2027 transfer date is lost and the plan moves into the ISA season freeze",
      probability: 3,
      impact: 5,
      priority: "Critical",
      escalation: "Escalated",
      mitigation:
        "Legal counsel engaged early with the court, and float held in the integration phase to absorb up to six weeks.",
      contingency: "The transfer date moves to the first window after the ISA season, which is May 2028.",
      residualProbability: 3,
      residualImpact: 4,
      status: "Open"
    },
    {
      type: "Issue",
      title: "Two Northern Counties policy types have no in-house equivalent",
      status: "In Progress",
      priority: "High",
      description:
        "A with-profits endowment and a legacy tax-exempt savings plan have no direct equivalent in the product range, so benefits cannot be mapped one to one.",
      rootCause: "Northern Counties retained product designs the society discontinued in the 1990s.",
      businessImpact:
        "About 1,900 transferring members need a documented benefit mapping that the independent expert and the court will scrutinise.",
      deliveryImpact: "Adds actuarial work and extends the scheme documentation timeline.",
      resolutionPlan:
        "The actuarial function is producing a benefit-equivalence assessment for both products, for review by the independent expert in November.",
      workaround:
        "Both products can be administered as closed books on the internal platform without full mapping, at higher ongoing cost."
    },
    {
      type: "Dependency",
      title: "PRJ-00007 must complete before transferred records can be loaded",
      direction: "Inbound",
      provider: "PRJ-00007 Servicing Data Migration",
      recipient: "PRJ-00014 Society Transfer - Northern Counties Friendly",
      status: "Open",
      confidence: "Medium",
      priority: "Critical",
      escalation: "Escalated",
      requiredBy: "2027-03-31",
      impactIfMissed:
        "Transferred records cannot be loaded onto the legacy database, so the transfer cannot complete.",
      description:
        "The transferred book must land on the migrated servicing platform. PRJ-00007 is Red, which makes this the programme's largest interdependency risk."
    },
    {
      type: "Risk",
      title: "Member attrition after transfer",
      cause: "transferring members did not choose the organisation and may not identify with the society",
      event: "attrition in the twelve months after transfer exceeds the 6% assumption",
      effect: "the funds under management benefit erodes and the transaction case weakens",
      probability: 3,
      impact: 3,
      mitigation:
        "Communications from directions onwards, a dedicated transfer contact team for six months, and no change to member benefits.",
      contingency: "Retention activity funded from the integration contingency line.",
      residualProbability: 2,
      residualImpact: 3,
      status: "Open"
    },
    {
      type: "Assumption",
      title: "Court sanction is granted at the first hearing",
      status: "Open",
      description:
        "The plan assumes sanction at the first hearing. A contested or adjourned hearing would add at least three months.",
      businessImpact: "An adjournment would push the transfer beyond the November window."
    },
    {
      type: "Dependency",
      title: "Independent expert report",
      direction: "Inbound",
      provider: "Appointed independent expert",
      recipient: "PRJ-00014 Society Transfer - Northern Counties Friendly",
      status: "Open",
      confidence: "High",
      requiredBy: "2027-01-29",
      impactIfMissed: "The scheme cannot be presented to the court.",
      description:
        "The independent expert's report on the effect of the scheme on both memberships is a statutory requirement for the directions hearing."
    }
  ],

  "PRJ-00015": [
    {
      type: "Risk",
      title: "Integration pattern over-fitted to Northern Counties",
      cause: "the reference case is a single transaction with its own peculiarities",
      event: "the pattern encodes assumptions that do not hold for the next transfer",
      effect: "rework on the next transaction and no cost benefit realised",
      probability: 3,
      impact: 3,
      mitigation:
        "Discovery will test the emerging pattern against two hypothetical transfer profiles of different size and product mix.",
      contingency: "Treat the output as a checklist rather than a toolkit.",
      residualProbability: 2,
      residualImpact: 2,
      status: "Open"
    },
    {
      type: "Dependency",
      title: "Learning from PRJ-00014 integration design",
      direction: "Inbound",
      provider: "PRJ-00014 Society Transfer - Northern Counties Friendly",
      recipient: "PRJ-00015 Transferred Book Integration Readiness",
      status: "Open",
      confidence: "Medium",
      requiredBy: "2027-01-04",
      impactIfMissed: "Discovery would be theoretical rather than grounded in a real transaction.",
      description:
        "This project is sequenced behind the transfer so the pattern derives from real experience."
    }
  ],

  "PRJ-00016": [
    {
      type: "Issue",
      title: "Member telephone fallback designed late",
      status: "Closed",
      description:
        "Members without a smartphone had no route to multi-factor authentication until a telephone fallback was added during member migration.",
      rootCause:
        "Discovery assumed smartphone availability across the member base, which skews older than assumed.",
      businessImpact: "Around 4,200 members would have been locked out of the member area.",
      deliveryImpact: "Twelve development days added under time pressure in the third quarter.",
      resolutionPlan: "Telephone fallback built and tested before member migration began.",
      actualResolution: "2026-06-26",
      closureEvidence:
        "Fallback tested with 40 members from the member panel; all authenticated successfully."
    },
    {
      type: "Risk",
      title: "Member lockout during migration",
      cause: "authentication is being replaced for a live member population",
      event: "members cannot sign in during or after their migration window",
      effect: "service desk volume spikes and trust in the digital channel is damaged",
      probability: 3,
      impact: 4,
      mitigation:
        "Population-by-population migration with the legacy mechanism kept live, and a rehearsed rollback per population.",
      contingency: "Revert the affected population to its legacy mechanism within one hour.",
      residualProbability: 1,
      residualImpact: 3,
      status: "Closed",
      closureEvidence:
        "All three populations migrated with no rollback required. Nine hypercare tickets, none relating to lockout."
    },
    {
      type: "Assumption",
      title: "All internal applications support modern authentication",
      status: "Closed",
      description:
        "Assumed every internal application could integrate with the identity platform. One reporting tool could not and was placed behind an authenticating proxy.",
      closureEvidence:
        "All applications integrated or proxied. No application was left on legacy authentication."
    }
  ],

  "PRJ-00017": [
    {
      type: "Issue",
      title: "Around 30% of shared drive content has no identifiable owner",
      status: "Closed",
      description:
        "Content discovery found roughly 4.2TB with no identifiable owner, so retention decisions could not be delegated.",
      rootCause: "Departmental reorganisations since 2015 left content behind with no ownership record.",
      businessImpact: "Retention decisions risked either over-retention or unlawful disposal.",
      deliveryImpact: "Six weeks of unplanned effort.",
      resolutionPlan:
        "Unowned content was assessed directly against the retention schedule by Information Governance, with the DPO approving the approach.",
      actualResolution: "2026-04-24",
      closureEvidence:
        "DPO-approved disposal approach documented, and a 200-item verification sample confirmed correct application of the schedule."
    },
    {
      type: "Risk",
      title: "Accidental disposal of content still needed",
      cause: "retention decisions on unowned content are made without business input",
      event: "content that is still required is disposed of",
      effect: "operational disruption and a possible record-keeping breach",
      probability: 2,
      impact: 4,
      mitigation:
        "Each server was left read-only for four weeks before disposal, and backups were kept for 90 days after.",
      contingency: "Restore from the 90-day backup.",
      residualProbability: 1,
      residualImpact: 2,
      status: "Closed",
      closureEvidence:
        "No recovery request was received during any read-only period or in the 90 days after disposal."
    },
    {
      type: "Assumption",
      title: "Content owners could be identified for most drives",
      status: "Closed",
      description:
        "The plan assumed owners would be identifiable for most content. They were not, which became the project's main issue.",
      closureEvidence: "Recorded in lessons learned as the principal planning miss."
    }
  ]
};

const band = (score) => (score >= 15 ? "Critical" : score >= 9 ? "High" : score >= 4 ? "Medium" : "Low");

export function raidFor(project) {
  const content = RAID_CONTENT[project.projectCode] || [];
  const anchor = project.actualStartDate || project.forecastStartDate || project.dateLogged;

  return content.map((item, index) => {
    const owner = person(project.projectManagerResourceId);
    const dateRaised = workday(addDays(anchor, 14 + index * 19));
    const inherentScore = (item.probability || 0) * (item.impact || 0);
    const residualScore = (item.residualProbability || 0) * (item.residualImpact || 0);
    const closed = item.status === "Closed";
    const isRisk = item.type === "Risk";

    return {
      raidId: `RAID-${project.projectCode.slice(-5)}-${String(index + 1).padStart(3, "0")}`,
      projectId: project.projectCode,
      projectCode: project.projectCode,
      type: item.type,
      title: item.title,
      status: item.status,
      description:
        item.description ||
        `Because ${item.cause}, there is a risk that ${item.event}, which would mean ${item.effect}.`,
      owner: owner.fullName,
      ownerResourceId: owner.resourceId,
      ownerEmail: owner.email || "",
      raisedBy: project.projectManager,
      raisedByResourceId: project.projectManagerResourceId,
      dateRaised,
      dateIdentified: dateRaised,
      targetDate: item.requiredBy || workday(addDays(dateRaised, 60)),
      priority: item.priority || (inherentScore >= 12 ? "High" : inherentScore >= 6 ? "Medium" : "Low"),
      escalationStatus: item.escalation || "Not Escalated",
      escalationThreshold: isRisk ? "Residual score of 12 or above, or any impact of 5" : "",
      lastReviewedDate: workday(addDays(TODAY, -6)),
      reviewFrequency: isRisk ? "Fortnightly" : "Monthly",
      relatedTasks: [],
      relatedActions: [],
      attachments: [],
      comments: [],
      dateClosed: closed ? item.actualResolution || workday(addDays(dateRaised, 45)) : "",
      closureEvidence: item.closureEvidence || "",

      riskCause: item.cause || "",
      riskEvent: item.event || "",
      riskEffect: item.effect || "",
      inherentProbability: item.probability || "",
      inherentImpact: item.impact || "",
      inherentScore: inherentScore || "",
      mitigation: item.mitigation || "",
      contingency: item.contingency || "",
      residualProbability: item.residualProbability || "",
      residualImpact: item.residualImpact || "",
      residualScore: residualScore || "",
      riskAppetitePosition: isRisk ? (residualScore >= 12 ? "Outside appetite" : "Within appetite") : "",
      riskTrend: isRisk ? (closed ? "Decreasing" : residualScore >= 12 ? "Increasing" : "Stable") : "",
      riskBand: isRisk ? band(residualScore || inherentScore) : "",

      businessImpact: item.businessImpact || "",
      deliveryImpact: item.deliveryImpact || "",
      rootCause: item.rootCause || "",
      resolutionPlan: item.resolutionPlan || "",
      resolutionOwner: item.resolutionPlan ? owner.fullName : "",
      expectedResolutionDate: item.resolutionPlan && !closed ? workday(addDays(TODAY, 35)) : "",
      actualResolutionDate: item.actualResolution || "",
      workaround: item.workaround || "",
      decisionRequired: "",

      dependencyScope: item.type === "Dependency" ? "Inter-project" : "",
      dependencyDirection: item.direction || "",
      provider: item.provider || "",
      recipient: item.recipient || "",
      requiredByDate: item.requiredBy || "",
      dependencyConfidence: item.confidence || "",
      impactIfMissed: item.impactIfMissed || "",
      relatedProject: /^PRJ-\d{5}/.test(item.provider || "") ? item.provider.slice(0, 9) : "",
      relatedMilestone: "",
      acceptanceCriteria:
        item.type === "Dependency" ? "Confirmed delivered by the provider in writing." : "",
      auditHistory: []
    };
  });
}
