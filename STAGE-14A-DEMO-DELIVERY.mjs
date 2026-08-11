/*
  STAGE 14A - plans, milestones, RAID, actions, decisions and documents.

  These are generated from each project's own dates and stage rather than typed
  out, so the plan is internally consistent: a project at Test has completed build
  tasks, a project at Intake has no plan at all, and slipping tasks are the ones
  that explain the project's Amber or Red schedule.

  Every record carries the full field set the corresponding page writes, including
  the fields that are usually blank, because a record missing a key reads as
  "never filled in" rather than "deliberately empty".
*/

import { person, TEAMS } from "./STAGE-14A-DEMO-PEOPLE.mjs";
import {
  TODAY,
  addDays,
  addWorkingDays,
  workday,
  daysBetween,
  isPast,
  at
} from "./STAGE-14A-DEMO-DATES.mjs";

/* --------------------------------------------------------------- plan phases

   The eight default lifecycle stage names from ppm-admin-utils.js, with the tasks
   a real plan carries in each. Percentages are how far through the project each
   phase sits, used to spread tasks across the project's actual dates.
*/
const PHASE_PLAN = [
  {
    phase: "Intake",
    from: 0,
    to: 0.06,
    tasks: [
      ["Complete intake request and business problem statement", "Business Analyst", true],
      ["Sponsor confirmation and initial funding decision", "Sponsor", true]
    ]
  },
  {
    phase: "Discovery",
    from: 0.06,
    to: 0.22,
    tasks: [
      ["Current-state assessment and process mapping", "Business Analyst", false],
      ["Stakeholder interviews and requirements gathering", "Business Analyst", false],
      ["Technical options assessment", "Technical Lead", false],
      ["Outline benefits case and cost range", "Finance Contact", true]
    ]
  },
  {
    phase: "Requirements and Design",
    from: 0.22,
    to: 0.4,
    tasks: [
      ["Detailed requirements catalogue and sign-off", "Business Analyst", true],
      ["Solution design and architecture review", "Technical Lead", true],
      ["Security threat model and data protection assessment", "Technical Lead", true],
      ["Test strategy and acceptance criteria", "Test Lead", false],
      ["Design gate submission pack", "Project Manager", true]
    ]
  },
  {
    phase: "Build",
    from: 0.4,
    to: 0.66,
    tasks: [
      ["Environment setup and pipeline configuration", "Developer", false],
      ["Core build - first increment", "Developer", false],
      ["Core build - second increment", "Developer", false],
      ["Integration build and interface development", "Developer", false],
      ["Internal build verification", "Test Lead", false]
    ]
  },
  {
    phase: "Test",
    from: 0.66,
    to: 0.82,
    tasks: [
      ["System and integration testing", "Test Lead", true],
      ["User acceptance testing", "Test Lead", true],
      ["Security and penetration testing", "Technical Lead", true],
      ["Defect resolution and regression", "Developer", false]
    ]
  },
  {
    phase: "Implementation",
    from: 0.82,
    to: 0.92,
    tasks: [
      ["Operational readiness assessment", "Change Lead", true],
      ["Training delivery", "Change Lead", false],
      ["Cutover rehearsal and rollback test", "Technical Lead", true],
      ["Go-live approval and deployment", "Project Manager", true]
    ]
  },
  {
    phase: "Hypercare",
    from: 0.92,
    to: 0.97,
    tasks: [
      ["Hypercare monitoring and daily triage", "Technical Lead", false],
      ["Benefit measurement baseline capture", "Finance Contact", false]
    ]
  },
  {
    phase: "Closure",
    from: 0.97,
    to: 1,
    tasks: [
      ["Closure report and lessons learned", "Project Manager", true],
      ["Handover to support and benefit owner", "Project Manager", true]
    ]
  }
];

/* Which role on the project a plan task belongs to, and therefore which team
   owns it. Team ownership is what makes Team-projects scope testable. */
const ROLE_TO_FIELD = {
  "Business Analyst": "businessAnalyst",
  "Technical Lead": "technicalLead",
  "Test Lead": "testLead",
  "Change Lead": "changeLead",
  "Finance Contact": "financeContact",
  "Project Manager": "projectManager",
  Sponsor: "sponsor",
  Developer: "technicalLead"
};

/* The stage a project has reached decides which phases are done, which is in
   flight, and which have not started. */
const STAGE_ORDER = PHASE_PLAN.map((entry) => entry.phase);

function stageIndex(project) {
  const index = STAGE_ORDER.indexOf(project.currentStage);
  return index === -1 ? 0 : index;
}

function ownerFor(project, roleName) {
  const field = ROLE_TO_FIELD[roleName] || "projectManager";
  const resourceId = project[`${field}ResourceId`] || project.projectManagerResourceId;
  /* Developer work is deliberately filed to the unallocated engineer where the
     project has no named developer, which is how a real plan shows a gap. */
  if (roleName === "Developer" && !project.technicalLeadResourceId) return person("RES-0118");
  return person(resourceId);
}

function teamOf(resourceId) {
  const found = person(resourceId);
  return found.team || TEAMS.change;
}

/* --------------------------------------------------------------------- plans */

export function plansFor(project) {
  const start = project.forecastStartDate || project.baselineStartDate;
  const end = project.forecastEndDate || project.baselineEndDate;
  if (!start || !end) return [];
  if (project.currentStage === "Intake" && project.percentageComplete === 0) return [];

  const totalDays = Math.max(20, daysBetween(start, end));
  const reached = stageIndex(project);
  const rows = [];
  let sequence = 0;

  PHASE_PLAN.forEach((phase, phaseIdx) => {
    /* Nothing beyond the next stage is planned in detail. A real plan does not
       carry task-level detail for a phase two gates away. */
    if (phaseIdx > reached + 1) return;

    const phaseStart = workday(addDays(start, Math.round(totalDays * phase.from)));
    const phaseEnd = workday(addDays(start, Math.round(totalDays * phase.to)));
    const perTask = Math.max(3, Math.floor((totalDays * (phase.to - phase.from)) / phase.tasks.length));

    phase.tasks.forEach(([taskName, roleName, mandatory], taskIdx) => {
      sequence += 1;
      const owner = ownerFor(project, roleName);
      const baselineStart = workday(addDays(phaseStart, perTask * taskIdx));
      const baselineEnd = workday(addWorkingDays(baselineStart, Math.max(2, Math.round(perTask * 0.7))));

      /* Phases before the current stage are complete; the current phase is part
         done; anything later has not started. */
      const complete = phaseIdx < reached;
      const current = phaseIdx === reached;

      /* Slippage is applied only to projects whose schedule RAG says they are
         late, and only in the phase they are actually in - so the plan explains
         the RAG rather than contradicting it. */
      const slipDays =
        current && project.scheduleRag === "Red"
          ? 15
          : current && project.scheduleRag === "Amber"
            ? 6
            : 0;
      const forecastStart = baselineStart;
      const forecastEnd = slipDays ? workday(addWorkingDays(baselineEnd, slipDays)) : baselineEnd;

      let status = "Not Started";
      let percent = 0;
      if (complete) {
        status = "Complete";
        percent = 100;
      } else if (current) {
        if (taskIdx === 0) {
          status = "Complete";
          percent = 100;
        } else if (taskIdx <= 2) {
          status = project.overallRag === "Red" && taskIdx === 2 ? "Blocked" : "In Progress";
          percent = status === "Blocked" ? 35 : 60;
        }
      }

      const effort = Math.max(8, Math.round(perTask * 6));
      rows.push({
        taskId: `TSK-${project.projectCode.slice(-5)}-${String(sequence).padStart(3, "0")}`,
        projectCode: project.projectCode,
        phase: phase.phase,
        taskName,
        taskType: taskIdx === phase.tasks.length - 1 ? "Deliverable" : "Task",
        deliverable: mandatory ? `${phase.phase} - ${taskName}` : "",
        taskOwner: owner.fullName,
        taskOwnerResourceId: owner.resourceId,
        taskOwnerEmail: owner.email || "",
        owningTeam: teamOf(owner.resourceId),
        supportingContributorIds: [],
        parentTaskId: "",
        durationDays: Math.max(2, Math.round(perTask * 0.7)),
        estimatedEffortHours: effort,
        remainingEffortHours: complete ? 0 : Math.round(effort * (1 - percent / 100)),
        allocationPercentage: 0,
        baselineStartDate: baselineStart,
        baselineEndDate: baselineEnd,
        forecastStartDate: forecastStart,
        forecastEndDate: forecastEnd,
        actualStartDate: complete || percent > 0 ? forecastStart : "",
        actualEndDate: complete ? forecastEnd : "",
        status,
        percentageComplete: percent,
        priority: mandatory ? "High" : "Medium",
        mandatory: Boolean(mandatory),
        criticalPath: phaseIdx === reached && taskIdx <= 1,
        dependencies:
          sequence > 1
            ? [`TSK-${project.projectCode.slice(-5)}-${String(sequence - 1).padStart(3, "0")}`]
            : [],
        reasonForSlippage: slipDays ? project.reasonForSlippage : "",
        returnToGreen: slipDays ? project.returnToGreen : "",
        slippageImpact: slipDays ? (slipDays > 10 ? "Milestone at risk" : "Absorbed in float") : "",
        recoveryNotPossible: false,
        notes:
          status === "Blocked"
            ? "Blocked pending the decision recorded against this project in the decision register."
            : ""
      });
    });
  });

  return rows;
}

/* ---------------------------------------------------------------- milestones */

export function milestonesFor(project) {
  const tasks = plansFor(project);
  if (!tasks.length) return [];

  /* Milestones sit at phase boundaries, which is where governance actually
     wants them, and are derived from the plan so the two cannot disagree. */
  const byPhase = new Map();
  tasks.forEach((task) => {
    const existing = byPhase.get(task.phase) || [];
    existing.push(task);
    byPhase.set(task.phase, existing);
  });

  const rows = [];
  let index = 0;
  byPhase.forEach((phaseTasks, phase) => {
    index += 1;
    const first = phaseTasks[0];
    const last = phaseTasks[phaseTasks.length - 1];
    const allComplete = phaseTasks.every((task) => task.status === "Complete");
    const anyStarted = phaseTasks.some((task) => task.percentageComplete > 0);
    const percent = Math.round(
      phaseTasks.reduce((sum, task) => sum + task.percentageComplete, 0) / phaseTasks.length
    );
    const overdue = !allComplete && isPast(last.forecastEndDate);

    rows.push({
      milestoneId: `MST-${project.projectCode.slice(-5)}-${String(index).padStart(2, "0")}`,
      projectCode: project.projectCode,
      milestoneName: `${phase} complete`,
      milestoneType: index === byPhase.size ? "Key milestone" : "Stage milestone",
      status: allComplete ? "Complete" : overdue ? "Overdue" : anyStarted ? "In Progress" : "Not Started",
      percentageComplete: percent,
      baselineStartDate: first.baselineStartDate,
      baselineFinishDate: last.baselineEndDate,
      forecastStartDate: first.forecastStartDate,
      forecastFinishDate: last.forecastEndDate,
      statusUpdatedAt: `${TODAY}T09:15:00.000Z`,
      owner: project.projectManager,
      ownerResourceId: project.projectManagerResourceId,
      notes: overdue
        ? `Forecast finish has passed. ${project.reasonForSlippage || "Under review with the sponsor."}`
        : allComplete
          ? "Completed and evidenced in the stage gate pack."
          : ""
    });
  });

  return rows;
}
