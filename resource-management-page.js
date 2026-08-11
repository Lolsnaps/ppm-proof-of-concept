"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;
const RESOURCE_NAME_WIDTH = 234;
const RESOURCE_METRIC_WIDTH = 82;
/*
  The zoom levels.

  `day` is the one this view was missing, and it is the one people ask for: a fortnight of real
  dates, one column each, is how somebody actually reads "who is free on Thursday". The others
  remain for looking further out.

  Widths are the column width in pixels. minimumBuckets keeps a short timeline from collapsing to
  three columns and looking broken.
*/
const ZOOM_CONFIG = {
  day: { width: 154, label: "Day", minimumBuckets: 14 },
  week: { width: 105, label: "Week", minimumBuckets: 26 },
  month: { width: 118, label: "Month", minimumBuckets: 18 },
  quarter: { width: 142, label: "Quarter", minimumBuckets: 12 },
  year: { width: 165, label: "Year", minimumBuckets: 10 }
};

/*
  Saturday and Sunday.

  They are not working days: they are excluded from every "for N work days" count and from the
  capacity arithmetic, and their columns are shaded so a bar crossing a weekend visibly costs
  nothing. They are still real columns, because work does land on them - a release weekend, a
  data migration - and a view that hid them would make that work impossible to see or plan.
*/
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/*
  Working days in a range, inclusive of both ends.

  Delegated to PPMPlanning, which is where every piece of capacity and duration arithmetic in this
  application lives. A local copy was written here first and deleted immediately: the capacity
  tab, the heatmap, the runway projection and the demand form all call the shared one, and two
  implementations of "how long is this in working days" is exactly how a Gantt starts disagreeing
  with the report built from the same data.
*/
function workingDaysBetween(start, finish) {
  if (!start || !finish) return 0;
  return PPMPlanning.workingDaysBetween(isoDate(start), isoDate(finish));
}

let resources = [];
let assignments = [];
let zoom = "week";
let selectedResourceIds = new Set();
let timelineBuckets = [];
let visibleResourceColumns = new Set(["current", "peak", "over"]);
let ganttExpanded = false;

const escapeHtml = PPMCore.escapeHtml;

/* Every bar, band and column width on this page is computed from dates and zoom, so
   none of it can live in a class. style-src 'self' blocks style attributes, so the
   declarations travel as data and PPMCore applies them through CSSOM. */
const styleAttr = PPMCore.styleAttribute;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfUnit(date, unit) {
  if (unit === "day") return startOfDay(date);
  if (unit === "week") return startOfWeek(date);
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
  if (unit === "quarter") return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
  return new Date(date.getFullYear(), 0, 1);
}

function nextUnit(date, unit) {
  if (unit === "day") return addDays(date, 1);
  if (unit === "week") return addDays(date, 7);
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  if (unit === "quarter") return new Date(date.getFullYear(), date.getMonth() + 3, 1);
  return new Date(date.getFullYear() + 1, 0, 1);
}

function previousUnit(date, unit) {
  if (unit === "day") return addDays(date, -1);
  if (unit === "week") return addDays(date, -7);
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth() - 1, 1);
  if (unit === "quarter") return new Date(date.getFullYear(), date.getMonth() - 3, 1);
  return new Date(date.getFullYear() - 1, 0, 1);
}

/*
  What a column is called.

  Week columns used to read "W32 · 10 Aug". The week number is a calendar fact almost nobody
  holds in their head, and it was the first thing in the label - so the date, which is what people
  actually navigate by, came second and was easy to miss. Dates only now, at every zoom.
*/
function bucketLabel(date, unit) {
  if (unit === "day") {
    return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }
  if (unit === "week") {
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  }
  if (unit === "month") return date.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  if (unit === "quarter") return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
  return String(date.getFullYear());
}

function loadData() {
  resources = PPMResources.ensureLegacyResources()
    .filter((resource) => resource.active !== false)
    .sort((first, second) => String(first.fullName || "").localeCompare(String(second.fullName || "")));

  if (!selectedResourceIds.size) {
    resources.forEach((resource) => selectedResourceIds.add(resource.resourceId));
  }

  const projects = PPMStore.projects.all();
  const projectPlans = PPMStore.plans.read();
  const projectMap = new Map(
    (Array.isArray(projects) ? projects : []).map((project) => [project.projectCode, project])
  );
  assignments = [];

  if (projectPlans && typeof projectPlans === "object" && !Array.isArray(projectPlans)) {
    Object.entries(projectPlans).forEach(([projectCode, tasks]) => {
      if (!Array.isArray(tasks)) return;
      const project = projectMap.get(projectCode) || { projectCode, projectName: projectCode };
      if (project.archived === true || project.projectStatus === "Archived") return;
      tasks.forEach((task) => {
        if (task.status === "Cancelled") return;

        const resource = PPMResources.findResource(task.taskOwnerResourceId, task.taskOwner);
        const startValue = task.forecastStartDate || task.baselineStartDate || "";
        const finishValue = task.forecastEndDate || task.baselineEndDate || "";
        const startDate = parseDate(startValue);
        const finishDate = parseDate(finishValue);
        assignments.push({
          taskId: task.taskId,
          taskName: task.taskName || "Unnamed task",
          taskStatus: task.status || "Not Started",
          projectCode,
          projectName: project.projectName || projectCode,
          workstream: project.workstream || "No workstream",
          resourceId: resource ? resource.resourceId : "UNASSIGNED",
          resourceName: resource ? resource.fullName : task.taskOwner || "Unassigned",
          startDate,
          finishDate,
          startValue,
          finishValue,
          allocation: Math.min(999, Math.max(0, Number(task.allocationPercentage) || 100)),
          percentageComplete: Math.min(100, Math.max(0, Number(task.percentageComplete) || 0))
        });
      });
    });
  }
}

function resourceRole(resource) {
  return resource.jobTitle || resource.role || "No role / job title";
}

function resourceTeam(resource) {
  return resource.team || "No team";
}

function populateFilters() {
  const teams = [...new Set(resources.map(resourceTeam))].sort();
  const roles = [...new Set(resources.map(resourceRole))].sort();
  const teamFilter = document.getElementById("teamFilter");
  const roleFilter = document.getElementById("roleFilter");
  teamFilter.innerHTML =
    '<option value="">All teams</option>' +
    teams.map((team) => `<option value="${escapeHtml(team)}">${escapeHtml(team)}</option>`).join("");
  roleFilter.innerHTML =
    '<option value="">All roles</option>' +
    roles.map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`).join("");
  renderResourceOptions();
  populateSavedViews();
}

function renderResourceOptions() {
  document.getElementById("resourceOptions").innerHTML = resources
    .map(
      (resource) => `
        <label class="resource-option">
          <input type="checkbox" value="${escapeHtml(resource.resourceId)}" ${selectedResourceIds.has(resource.resourceId) ? "checked" : ""}>
          <span><strong>${escapeHtml(resource.fullName || resource.resourceId)}</strong><span>${escapeHtml(resourceTeam(resource))} · ${escapeHtml(resourceRole(resource))}</span></span>
        </label>
      `
    )
    .join("");

  document.querySelectorAll('#resourceOptions input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedResourceIds.add(checkbox.value);
      else selectedResourceIds.delete(checkbox.value);
      updateResourcePickerSummary();
      renderGantt();
    });
  });
  updateResourcePickerSummary();
}

function updateResourcePickerSummary() {
  const count = resources.filter((resource) => selectedResourceIds.has(resource.resourceId)).length;
  document.getElementById("resourcePickerSummary").textContent = `Choose resources · ${count} selected`;
}

function selectedResources() {
  const team = document.getElementById("teamFilter").value;
  const role = document.getElementById("roleFilter").value;
  return resources.filter((resource) => {
    return (
      selectedResourceIds.has(resource.resourceId) &&
      (!team || resourceTeam(resource) === team) &&
      (!role || resourceRole(resource) === role)
    );
  });
}

function visibleAssignments(resourceIds) {
  const search = document.getElementById("taskSearch").value.trim().toLowerCase();
  return assignments.filter((assignment) => {
    const searchable =
      `${assignment.taskName} ${assignment.projectName} ${assignment.projectCode}`.toLowerCase();
    return resourceIds.has(assignment.resourceId) && (!search || searchable.includes(search));
  });
}

function approvedAbsences(resourceIds) {
  return PPMPlanning.getAbsences()
    .filter((absence) => {
      return (
        resourceIds.has(absence.resourceId) &&
        absence.status === "Approved" &&
        parseDate(absence.startDate) &&
        parseDate(absence.endDate)
      );
    })
    .map((absence) => ({
      ...absence,
      startDateValue: parseDate(absence.startDate),
      endDateValue: parseDate(absence.endDate)
    }));
}

function absenceReason(absence) {
  return [absence.type || "Unavailable", String(absence.notes || "").trim()].filter(Boolean).join(" — ");
}

function assignmentAbsences(assignment, absenceRows) {
  if (!assignment.startDate || !assignment.finishDate) return [];
  return absenceRows.filter(
    (absence) =>
      absence.resourceId === assignment.resourceId &&
      absence.startDateValue <= assignment.finishDate &&
      absence.endDateValue >= assignment.startDate
  );
}

function buildTimeline(taskAssignments, absenceRows = []) {
  const scheduled = taskAssignments.filter((assignment) => assignment.startDate && assignment.finishDate);
  const datedAbsences = absenceRows.filter((absence) => absence.startDateValue && absence.endDateValue);
  const today = new Date();
  const startDates = [
    ...scheduled.map((item) => item.startDate.getTime()),
    ...datedAbsences.map((item) => item.startDateValue.getTime())
  ];
  const endDates = [
    ...scheduled.map((item) => item.finishDate.getTime()),
    ...datedAbsences.map((item) => item.endDateValue.getTime())
  ];
  let minimum = startDates.length ? new Date(Math.min(today.getTime(), ...startDates)) : today;
  let maximum = endDates.length ? new Date(Math.max(today.getTime(), ...endDates)) : today;
  minimum = previousUnit(startOfUnit(minimum, zoom), zoom);
  maximum = nextUnit(nextUnit(startOfUnit(maximum, zoom), zoom), zoom);

  timelineBuckets = [];
  let cursor = new Date(minimum);
  let safety = 0;
  while (cursor < maximum && safety < 520) {
    const end = nextUnit(cursor, zoom);
    timelineBuckets.push({ start: new Date(cursor), end, label: bucketLabel(cursor, zoom) });
    cursor = end;
    safety += 1;
  }

  const config = ZOOM_CONFIG[zoom];
  const viewportBuckets = Math.ceil(Math.max(0, window.innerWidth - detailWidth() - 80) / config.width) + 1;
  const minimumBucketCount = Math.max(config.minimumBuckets, viewportBuckets);

  while (timelineBuckets.length < minimumBucketCount && safety < 520) {
    const end = nextUnit(cursor, zoom);
    timelineBuckets.push({ start: new Date(cursor), end, label: bucketLabel(cursor, zoom) });
    cursor = end;
    safety += 1;
  }

  return { minimum, maximum: cursor };
}


/* ---------------------------------------------------------------- day series

   The rebuilt timeline works a day at a time regardless of zoom, because the questions it
   answers - is this person over-committed, and for how long - are daily questions. The columns
   are only how the answer is drawn.
*/

/* Every day the timeline covers, as a flat list. Cheap enough at these ranges, and it makes the
   run-merging below trivial to read. */
function timelineDays() {
  const days = [];
  if (!timelineBuckets.length) return days;
  const cursor = startOfDay(timelineBuckets[0].start);
  const end = startOfDay(timelineBuckets[timelineBuckets.length - 1].end);
  let safety = 0;
  while (cursor < end && safety < 4000) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    safety += 1;
  }
  return days;
}

function coversDay(assignment, day) {
  if (!assignment.startDate || !assignment.finishDate) return false;
  const value = day.getTime();
  return startOfDay(assignment.startDate).getTime() <= value && startOfDay(assignment.finishDate).getTime() >= value;
}

/* Total allocation on one day, across everything this person is on. */
function allocationOnDay(resourceAssignments, day) {
  return resourceAssignments
    .filter((assignment) => coversDay(assignment, day))
    .reduce((total, assignment) => total + assignment.allocation, 0);
}

/*
  Consecutive days at the same over-allocation, merged into one span.

  One bar per day was the alternative, and at day zoom across a month it becomes a row of small
  blocks that says "there is a problem somewhere here". Merged runs say "130% for four days,
  starting Monday", which is the sentence somebody needs in order to do something about it.

  Weekends are skipped: nobody is over-committed on a day they are not working, and drawing it
  would make every fortnight look like a crisis.
*/
function overAllocationRuns(resourceAssignments) {
  const threshold = PPMPlanning.getResourceConfig().overAllocationThreshold;
  const runs = [];
  let open = null;

  timelineDays().forEach((day) => {
    const total = isWeekend(day) ? 0 : allocationOnDay(resourceAssignments, day);
    const over = total > threshold;
    if (open && over && total === open.percent) {
      open.finish = day;
      return;
    }
    if (open) {
      runs.push(open);
      open = null;
    }
    if (over) open = { start: day, finish: day, percent: total };
  });
  if (open) runs.push(open);
  return runs;
}

/*
  The gaps in somebody's schedule, and how much of them is free.

  This is the half of the picture the coloured bars do not show. A view that only draws work
  answers "who is busy"; the question a resource manager is usually asking is "who can take
  this", and that needs the spare hours stated rather than inferred from white space.

  A gap is a run of consecutive working days below the warning threshold. The hours per day come
  from PPMPlanning.availableCapacity, which is the one place capacity arithmetic lives - a local
  copy here would drift from the capacity tab within a month.
*/
function availabilityRuns(resource, resourceAssignments) {
  const threshold = PPMPlanning.getResourceConfig().warningThreshold;
  const runs = [];
  let open = null;

  timelineDays().forEach((day) => {
    const free = !isWeekend(day) && allocationOnDay(resourceAssignments, day) < threshold;
    if (free) {
      if (!open) open = { start: day, finish: day, days: 1 };
      else {
        open.finish = day;
        open.days += 1;
      }
      return;
    }
    if (open) {
      runs.push(open);
      open = null;
    }
  });
  if (open) runs.push(open);

  return runs.map((run) => {
    const startIso = isoDate(run.start);
    const finishIso = isoDate(run.finish);
    const capacity = PPMPlanning.availableCapacity(resource, startIso, finishIso);
    const committed = timelineDays()
      .filter((day) => !isWeekend(day) && day >= run.start && day <= run.finish)
      .reduce((total, day) => total + allocationOnDay(resourceAssignments, day), 0);
    /* Spare hours per working day, after what is already committed across the run. */
    const perDay = run.days ? Math.max(0, (capacity.available * (1 - committed / (100 * run.days))) / run.days) : 0;
    return { ...run, perDay: Math.round(perDay * 100) / 100 };
  });
}

/* A bar spanning two dates, positioned in pixels. Shared by every span the timeline draws. */
function spanGeometry(start, finish) {
  const left = positionForDate(start);
  const right = positionForDate(addDays(finish, 1));
  return { left, width: Math.max(10, right - left) };
}

function overlapsBucket(assignment, bucket) {
  if (!assignment.startDate || !assignment.finishDate) return false;
  const finishExclusive = addDays(assignment.finishDate, 1);
  return assignment.startDate < bucket.end && finishExclusive > bucket.start;
}

function allocationsForResource(resourceId, resourceAssignments) {
  const relevantAssignments = resourceAssignments.filter(
    (assignment) => assignment.resourceId === resourceId && assignment.startDate && assignment.finishDate
  );

  return timelineBuckets.map((bucket) => {
    const overlapping = relevantAssignments.filter((assignment) => overlapsBucket(assignment, bucket));

    const candidateDates = [
      bucket.start.getTime(),
      ...overlapping.map((assignment) => Math.max(bucket.start.getTime(), assignment.startDate.getTime()))
    ];

    return candidateDates.reduce((peak, candidateTime) => {
      const allocation = overlapping
        .filter((assignment) => {
          const finishExclusive = addDays(assignment.finishDate, 1);

          return assignment.startDate.getTime() <= candidateTime && finishExclusive.getTime() > candidateTime;
        })
        .reduce((total, assignment) => total + assignment.allocation, 0);

      return Math.max(peak, allocation);
    }, 0);
  });
}

function currentAllocation(resourceAssignments) {
  const today = parseDate(isoDate(new Date()));
  return resourceAssignments
    .filter((assignment) => {
      return (
        assignment.startDate &&
        assignment.finishDate &&
        assignment.startDate <= today &&
        assignment.finishDate >= today
      );
    })
    .reduce((total, assignment) => total + assignment.allocation, 0);
}

function allocationClass(value) {
  const thresholds = PPMPlanning.getResourceConfig();
  if (value > thresholds.overAllocationThreshold) return "over";
  if (value >= thresholds.warningThreshold) return "full";
  if (value > 0) return "allocated";
  return "";
}

function timelineStyle() {
  const width = ZOOM_CONFIG[zoom].width;
  return `width:${timelineBuckets.length * width}px;grid-template-columns:repeat(${timelineBuckets.length},${width}px)`;
}

function detailWidth() {
  return RESOURCE_NAME_WIDTH + visibleResourceColumns.size * RESOURCE_METRIC_WIDTH;
}

function detailGridColumns() {
  const metrics = [...visibleResourceColumns].map(() => `${RESOURCE_METRIC_WIDTH}px`).join(" ");
  return `minmax(225px,1fr) ${metrics}`.trim();
}

/*
  `tone` is a class rather than a colour. It was a style attribute carrying one of two
  fixed colours, which the policy blocked - and a fixed colour was never geometry, so
  it belongs in the stylesheet where the rest of the palette lives.
*/
function metricMarkup(key, value, tone = "") {
  return visibleResourceColumns.has(key)
    ? `<div class="metric-cell${tone ? ` ${tone}` : ""}">${value}</div>`
    : "";
}

function positionForDate(date) {
  const width = ZOOM_CONFIG[zoom].width;
  for (let index = 0; index < timelineBuckets.length; index += 1) {
    const bucket = timelineBuckets[index];
    if (date < bucket.end) {
      const fraction = Math.max(0, Math.min(1, (date - bucket.start) / (bucket.end - bucket.start)));
      return (index + fraction) * width;
    }
  }
  return timelineBuckets.length * width;
}

function timelineCells(contentFunction) {
  const today = isoDate(new Date());
  return timelineBuckets
    .map((bucket, index) => {
      const includesToday = isoDate(bucket.start) <= today && isoDate(addDays(bucket.end, -1)) >= today;
      /* Only meaningful at day zoom: a week column contains both kinds. */
      const weekend = zoom === "day" && isWeekend(bucket.start);
      return `<div class="timeline-cell${includesToday ? " today" : ""}${weekend ? " weekend" : ""}">${
        contentFunction ? contentFunction(bucket, index) : ""
      }</div>`;
    })
    .join("");
}

function absenceBand(absence) {
  const left = positionForDate(absence.startDateValue);
  const right = positionForDate(addDays(absence.endDateValue, 1));
  const width = Math.max(12, right - left);
  const label = `Unavailable: ${absenceReason(absence)}`;
  return `<div class="absence-band"${styleAttr(`left:${left}px;width:${width}px`)} title="${escapeHtml(label)}">${escapeHtml(label)}</div>`;
}

function absenceConflictSegment(assignment, absence) {
  const overlapStart =
    absence.startDateValue > assignment.startDate ? absence.startDateValue : assignment.startDate;
  const overlapEnd =
    absence.endDateValue < assignment.finishDate ? absence.endDateValue : assignment.finishDate;
  const left = positionForDate(overlapStart);
  const right = positionForDate(addDays(overlapEnd, 1));
  const label = `Unavailable: ${absenceReason(absence)}`;
  return `<div class="absence-conflict-segment"${styleAttr(`left:${left}px;width:${Math.max(5, right - left)}px`)} title="${escapeHtml(label)}"></div>`;
}

function headerRow() {
  return `
        <div class="gantt-row gantt-header">
          <div class="row-details"><div>Resource / assignment</div>${metricMarkup("current", "Current")}${metricMarkup("peak", "Peak")}${metricMarkup("over", "Over")}</div>
          <div class="timeline-row"${styleAttr(timelineStyle())}>${timelineCells((bucket) => escapeHtml(bucket.label))}</div>
        </div>
      `;
}

function groupRow(groupName) {
  return `
        <div class="gantt-row group-row">
          <div class="row-details"><div>${escapeHtml(groupName)}</div></div>
          <div class="timeline-row"${styleAttr(timelineStyle())}>${timelineCells()}</div>
        </div>
      `;
}

/*
  One person, as a single block.

  THE LEFT PANE IS ONE CELL, NOT ONE PER LINE

  Every line used to carry its own details cell, so a person on eight assignments produced eight
  left-hand cells - the name once, then the same task name repeated beside a bar that already
  said it. It read as eight separate records rather than one person's week, and it spent the
  widest column in the view on a duplicate of the label six inches to its right.

  Now the details cell is written once and the lines stack beside it. The task name, its project,
  its allocation, its duration and its progress all live on the bar, which is where somebody
  reading along a row is already looking.
*/
function resourceBlock(resource, resourceAssignments, absenceRows) {
  const allocations = allocationsForResource(resource.resourceId, resourceAssignments);
  const current = currentAllocation(resourceAssignments);
  const peak = allocations.length ? Math.max(...allocations) : 0;
  const over = Math.max(0, peak - PPMPlanning.getResourceConfig().warningThreshold);
  const ownAbsences = absenceRows.filter((absence) => absence.resourceId === resource.resourceId);
  const availability = availabilityRuns(resource, resourceAssignments);

  const summaryLine = `<div class="timeline-row summary-line"${styleAttr(timelineStyle())}>${timelineCells(
    (bucket, index) =>
      `<span class="allocation-cell ${allocationClass(allocations[index])}">${allocations[index] ? `${allocations[index]}%` : ""}</span>`
  )}${overAllocationRuns(resourceAssignments).map(overAllocationBar).join("")}${ownAbsences.map(absenceBand).join("")}</div>`;

  const taskLines = resourceAssignments.map((assignment) => taskLine(assignment, absenceRows)).join("");

  const availabilityLine = availability.length
    ? `<div class="timeline-row availability-line"${styleAttr(timelineStyle())}>${timelineCells()}${availability
        .map(availabilityBar)
        .join("")}</div>`
    : "";

  const unscheduled = resourceAssignments.filter((item) => !item.startDate || !item.finishDate).length;

  return `
        <div class="resource-block ${over ? "overallocated" : ""}">
          <div class="row-details resource-details">
            <div>
              <div class="resource-name">${escapeHtml(resource.fullName || resource.resourceId)}</div>
              <div class="resource-meta">${escapeHtml(resourceRole(resource))}</div>
              <div class="resource-meta">${escapeHtml(resourceTeam(resource))}</div>
              ${unscheduled ? `<div class="resource-unscheduled">${unscheduled} without dates</div>` : ""}
            </div>
            ${metricMarkup("current", `${current}%`)}
            ${metricMarkup("peak", `${peak}%`)}
            ${metricMarkup("over", `${over}%`, over ? "over-threshold" : "within-threshold")}
          </div>
          <div class="resource-lines">${summaryLine}${taskLines}${availabilityLine}</div>
        </div>
      `;
}

/*
  One red bar per run of over-allocated days, labelled once with the percentage.

  Drawn on the resource row rather than on any one task, because over-allocation is a property of
  the person on that day - it is the sum of everything they are on, and no single bar is at fault.
*/
function overAllocationBar(run) {
  const { left, width } = spanGeometry(run.start, run.finish);
  const days = workingDaysBetween(run.start, run.finish);
  const label = `${run.percent}% allocated · ${days} work day${days === 1 ? "" : "s"} · ${run.start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${run.finish.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  return `<div class="overallocation-bar"${styleAttr(`left:${left}px;width:${width}px`)} title="${escapeHtml(label)}">${run.percent}%</div>`;
}

/*
  A grey bar across a run of days where this person has room, saying how much and for how long.

  "Available: 6.4h/d for 5 work days" is a sentence somebody can act on. An empty stretch of
  timeline is not.
*/
function availabilityBar(run) {
  const { left, width } = spanGeometry(run.start, run.finish);
  const label = `Available: ${run.perDay}h/d for ${run.days} work day${run.days === 1 ? "" : "s"}`;
  const range = `${run.start.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to ${run.finish.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  return `<div class="availability-bar"${styleAttr(`left:${left}px;width:${width}px`)} title="${escapeHtml(`${label} · ${range}`)}"><b>Available:</b> ${escapeHtml(`${run.perDay}h/d for ${run.days} work day${run.days === 1 ? "" : "s"}`)}</div>`;
}

/*
  One assignment, on its own line under the person.

  THE LABEL LIVES ON THE BAR

  It used to sit in the left pane, with the bar carrying only "30%". That works when a person has
  two assignments and stops working at five, which is the normal case here - the left pane cannot
  show ten task names without becoming taller than the timeline. Putting the whole sentence on the
  bar - plan, task, allocation, duration - means one line per assignment however many there are,
  and the reading order matches how somebody scans it: along the row, in time.

  Truncation is the browser's, by overflow. A short bar shows what fits and the rest is in the
  hover card, which is the only thing that can hold a full sentence at day zoom.
*/
function taskLine(assignment, absenceRows) {
  const conflicts = assignmentAbsences(assignment, absenceRows);
  let bar = "";

  if (assignment.startDate && assignment.finishDate) {
    const { left, width } = spanGeometry(assignment.startDate, assignment.finishDate);
    const days = workingDaysBetween(assignment.startDate, assignment.finishDate);
    const barClass =
      assignment.allocation > PPMPlanning.getResourceConfig().overAllocationThreshold
        ? "over"
        : assignment.taskStatus === "Complete"
          ? "complete"
          : "";
    /* Progress moved onto the bar with everything else. It was a metric cell in the left pane,
       which is the column this change exists to give back to the timeline. */
    const progress = Number(assignment.percentageComplete) || 0;
    const label =
      `${assignment.projectName} | ${assignment.taskName} – ${assignment.allocation}% for ${days} work day${days === 1 ? "" : "s"}` +
      (progress ? ` · ${progress}% done` : "");

    bar =
      `<div class="task-bar ${barClass}" tabindex="0"${styleAttr(`left:${left}px;width:${width}px`)}` +
      ` data-card-resource="${escapeHtml(assignment.resourceName)}"` +
      ` data-card-plan="${escapeHtml(assignment.projectName)}"` +
      ` data-card-task="${escapeHtml(assignment.taskName)}"` +
      ` data-card-status="${escapeHtml(assignment.taskStatus || "Scheduled")}"` +
      ` data-card-from="${escapeHtml(assignment.startDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}"` +
      ` data-card-to="${escapeHtml(assignment.finishDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }))}"` +
      ` data-card-allocation="${escapeHtml(`${assignment.allocation}% for ${days} work day${days === 1 ? "" : "s"}`)}"` +
      ` data-card-progress="${escapeHtml(`${progress}% complete`)}"` +
      ` data-card-project="${escapeHtml(assignment.projectCode)}"` +
      `${conflicts.length ? ` data-card-conflict="${escapeHtml(conflicts.map(absenceReason).join("; "))}"` : ""}` +
      `><span class="task-bar-label">${escapeHtml(label)}</span></div>`;
  } else {
    /*
      An assignment with an owner and no dates. It cannot be drawn anywhere on a timeline, and
      before this it vanished silently - the person carried the work and the view showed nothing.
      Said plainly, pinned to the left of the row.
    */
    bar = `<div class="task-bar unscheduled-bar"${styleAttr("left:0px;width:340px")} title="${escapeHtml(
      `${assignment.projectName} · ${assignment.taskName}`
    )}"><span class="task-bar-label">${escapeHtml(
      `${assignment.projectName} | ${assignment.taskName} – no dates, so not scheduled`
    )}</span></div>`;
  }

  return `
        <div class="timeline-row task-line ${conflicts.length ? "has-absence-conflict" : ""}"${styleAttr(timelineStyle())}>${timelineCells()}${bar}${conflicts
          .map((absence) => absenceConflictSegment(assignment, absence))
          .join("")}</div>
      `;
}

function groupedResources(resourceList) {
  const groupBy = document.getElementById("groupBy").value;
  const groups = new Map();
  resourceList.forEach((resource) => {
    const group =
      groupBy === "team" ? resourceTeam(resource) : groupBy === "role" ? resourceRole(resource) : "Resources";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(resource);
  });
  return [...groups.entries()].sort((first, second) => first[0].localeCompare(second[0]));
}


/* ------------------------------------------------------------------ hover card

   The full sentence for one assignment: who, which plan, which task, its status, the dates, the
   allocation and the project it belongs to.

   A title attribute cannot do this - it is one line of unstyled text, it takes a second to
   appear, and it cannot be read by touch or keyboard. So the card is a real element, positioned
   next to the bar, populated from the data attributes taskLine() writes.

   One element for the whole page, moved around, rather than one per bar: there can be several
   hundred bars at day zoom and building a card into each would be that many nodes doing nothing.

   Position is geometry, so it travels through PPMCore.applyComputedStyles like every other
   computed value here - style attributes are blocked by the policy.
*/
let hoverCard = null;

function ensureHoverCard() {
  if (hoverCard && hoverCard.isConnected) return hoverCard;
  hoverCard = document.createElement("div");
  hoverCard.className = "assignment-card";
  hoverCard.setAttribute("role", "tooltip");
  hoverCard.hidden = true;
  document.body.appendChild(hoverCard);
  return hoverCard;
}

function rowMarkup(label, value) {
  return `<div class="assignment-card-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`;
}

function showAssignmentCard(bar) {
  const card = ensureHoverCard();
  const data = bar.dataset;
  card.innerHTML =
    `<div class="assignment-card-head">${escapeHtml(data.cardResource || "")}<br /><b>${escapeHtml(data.cardPlan || "")}</b></div>` +
    `<div class="assignment-card-task">${escapeHtml(data.cardTask || "")}</div>` +
    `<span class="assignment-card-status">${escapeHtml(data.cardStatus || "Scheduled")}</span>` +
    rowMarkup("From", data.cardFrom || "") +
    rowMarkup("To", data.cardTo || "") +
    rowMarkup("Allocation", data.cardAllocation || "") +
    (data.cardProgress ? rowMarkup("Progress", data.cardProgress) : "") +
    rowMarkup("Project", data.cardProject || "") +
    (data.cardConflict ? `<div class="assignment-card-conflict">Unavailable: ${escapeHtml(data.cardConflict)}</div>` : "");

  card.hidden = false;

  /* Measured after it is populated, so a long task name does not push the card off-screen. */
  const bounds = bar.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const margin = 12;
  let left = bounds.left + window.scrollX + 24;
  let top = bounds.bottom + window.scrollY + 8;
  if (left + width + margin > window.scrollX + document.documentElement.clientWidth) {
    left = Math.max(window.scrollX + margin, window.scrollX + document.documentElement.clientWidth - width - margin);
  }
  /* Flip above the bar when there is no room below, rather than hanging off the fold. */
  if (bounds.bottom + height + margin > document.documentElement.clientHeight) {
    top = bounds.top + window.scrollY - height - 8;
  }
  /* Through the same data attribute every computed value on this page uses: style attributes are
     blocked by the policy, and PPMCore applies these through CSSOM. */
  card.setAttribute("data-ppm-style", `left:${Math.round(left)}px;top:${Math.round(top)}px`);
  PPMCore.applyComputedStyles(card);
}

function hideAssignmentCard() {
  if (hoverCard) hoverCard.hidden = true;
}

/* Delegated, so it keeps working across every re-render without rebinding hundreds of bars. */
function bindAssignmentCard() {
  const content = document.getElementById("ganttContent");
  if (!content || content.dataset.cardBound === "true") return;
  content.dataset.cardBound = "true";
  content.addEventListener("pointerover", (event) => {
    const bar = event.target.closest(".task-bar[data-card-task]");
    if (bar) showAssignmentCard(bar);
  });
  content.addEventListener("pointerout", (event) => {
    const bar = event.target.closest(".task-bar[data-card-task]");
    const goingTo = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest(".task-bar");
    if (bar && goingTo !== bar) hideAssignmentCard();
  });
  /* Keyboard and touch reach it too: the bars are focusable, and scrolling dismisses it. */
  content.addEventListener("focusin", (event) => {
    const bar = event.target.closest(".task-bar[data-card-task]");
    if (bar) showAssignmentCard(bar);
  });
  content.addEventListener("focusout", hideAssignmentCard);
  content.addEventListener("scroll", hideAssignmentCard, { passive: true });
}

function renderGantt() {
  const resourceList = selectedResources();
  const ids = new Set(resourceList.map((resource) => resource.resourceId));
  const taskAssignments = visibleAssignments(ids);
  const absenceRows = approvedAbsences(ids);
  const range = buildTimeline(taskAssignments, absenceRows);
  let html = headerRow();

  groupedResources(resourceList).forEach(([groupName, groupResources]) => {
    html += groupRow(groupName);
    groupResources.forEach((resource) => {
      const resourceAssignments = taskAssignments
        .filter((assignment) => assignment.resourceId === resource.resourceId)
        .sort((first, second) => (first.startValue || "9999").localeCompare(second.startValue || "9999"));
      html += resourceBlock(resource, resourceAssignments, absenceRows);
    });
  });

  if (!resourceList.length) {
    html +=
      '<div class="empty-state">No resources match the selected view. Choose resources or clear the team and role filters.</div>';
  }

  const ganttContent = document.getElementById("ganttContent");
  ganttContent.style.setProperty("--detail-width", `${detailWidth()}px`);
  ganttContent.style.setProperty("--detail-grid-columns", detailGridColumns());
  ganttContent.innerHTML = html;
  /* Applied here rather than left to PPMCore's observer, which runs a turn later and
     would show one frame of a gantt with no column widths. */
  PPMCore.applyComputedStyles(ganttContent);
  bindAssignmentCard();
  hideAssignmentCard();
  document.getElementById("timelineRange").textContent =
    `${range.minimum.toLocaleDateString("en-GB", { month: "short", year: "numeric" })} to ${range.maximum.toLocaleDateString("en-GB", { month: "short", year: "numeric" })} · ${ZOOM_CONFIG[zoom].label} zoom`;

  const overallocatedCount = resourceList.filter((resource) => {
    const values = allocationsForResource(resource.resourceId, taskAssignments);
    return values.some((value) => value > PPMPlanning.getResourceConfig().overAllocationThreshold);
  }).length;
  document.getElementById("displayedResources").textContent = resourceList.length;
  document.getElementById("scheduledTasks").textContent = taskAssignments.filter(
    (item) => item.startDate && item.finishDate
  ).length;
  document.getElementById("overallocatedResources").textContent = overallocatedCount;
  document.getElementById("absenceConflicts").textContent = taskAssignments.filter(
    (assignment) => assignmentAbsences(assignment, absenceRows).length
  ).length;
  document.getElementById("unassignedTasks").textContent = assignments.filter(
    (item) => item.resourceId === "UNASSIGNED" || !item.startDate || !item.finishDate
  ).length;
}

/*
  Stage 16: saved resource views are a database collection, not browser state.

  resourceGanttViews is one of the collections the child adapter owns and hydrates. This page wrote it with
  localStorage.setItem, which reached PostgreSQL only through the prototype patch; once that was
  removed the view was saved to this browser and nowhere else, and the next hydration replaced it
  with the database's copy - so saving or deleting a view appeared to work and did not last.
*/
function getSavedViews() {
  return PPMStore.resourceGanttViews.all();
}

function renderColumnOptions() {
  const definitions = [
    ["current", "Current allocation"],
    ["peak", "Peak allocation / completion"],
    ["over", "Overallocation / schedule warning"]
  ];
  document.getElementById("resourceColumnOptions").innerHTML = definitions
    .map(
      ([key, label]) => `
        <label class="column-option"><input type="checkbox" value="${key}" ${visibleResourceColumns.has(key) ? "checked" : ""}>${label}</label>
      `
    )
    .join("");
  document.querySelectorAll("#resourceColumnOptions input").forEach((box) =>
    box.addEventListener("change", () => {
      if (box.checked) visibleResourceColumns.add(box.value);
      else visibleResourceColumns.delete(box.value);
      renderGantt();
    })
  );
}

function populateSavedViews(selectedId) {
  const selector = document.getElementById("savedViewSelector");
  selector.innerHTML =
    '<option value="">Current unsaved view</option>' +
    getSavedViews()
      .sort(
        (first, second) =>
          (first.scope === "shared" ? -1 : 1) - (second.scope === "shared" ? -1 : 1) ||
          String(first.name).localeCompare(String(second.name))
      )
      .map(
        (view) =>
          `<option value="${escapeHtml(view.viewId)}">${view.scope === "shared" ? "[Shared] " : ""}${escapeHtml(view.name)}</option>`
      )
      .join("");
  selector.value = selectedId || "";
  document.getElementById("deleteViewButton").disabled = !selector.value;
}

function currentView(name, existingId) {
  return {
    viewId: existingId || `VIEW-${Date.now()}`,
    name,
    zoom,
    groupBy: document.getElementById("groupBy").value,
    team: document.getElementById("teamFilter").value,
    role: document.getElementById("roleFilter").value,
    search: document.getElementById("taskSearch").value,
    resourceIds: [...selectedResourceIds],
    scope: document.getElementById("viewScope").value,
    columns: [...visibleResourceColumns],
    publishedBy: document.getElementById("viewScope").value === "shared" ? "Current user" : "",
    publishedAt: document.getElementById("viewScope").value === "shared" ? new Date().toISOString() : "",
    updatedAt: new Date().toISOString()
  };
}

function showMessage(text, type) {
  const message = document.getElementById("pageMessage");
  message.textContent = text;
  message.className = `message ${type}`;
}

async function saveView() {
  const name = document.getElementById("viewName").value.trim();
  if (!name) {
    showMessage("Enter a name for this resource view.", "error");
    return;
  }
  const views = getSavedViews();
  const selectedId = document.getElementById("savedViewSelector").value;
  const existingIndex = selectedId ? views.findIndex((view) => view.viewId === selectedId) : -1;
  const view = currentView(name, selectedId || undefined);
  if (existingIndex >= 0) views[existingIndex] = view;
  else views.push(view);
  const saved = await PPMStore.resourceGanttViews.replaceAll(views);
  if (!saved.ok) {
    showMessage(saved.message, saved.queued ? "warning" : "error");
    return;
  }
  populateSavedViews(view.viewId);
  showMessage(
    `${name} was ${view.scope === "shared" ? "published as a shared view" : "saved as a personal view"}. Grouping, selected resources and visible columns were retained.`,
    "success"
  );
}

function loadView(viewId) {
  const view = getSavedViews().find((item) => item.viewId === viewId);
  document.getElementById("deleteViewButton").disabled = !view;
  if (!view) return;
  zoom = view.zoom && ZOOM_CONFIG[view.zoom] ? view.zoom : "week";
  document.getElementById("groupBy").value = view.groupBy || "team";
  document.getElementById("teamFilter").value = view.team || "";
  document.getElementById("roleFilter").value = view.role || "";
  document.getElementById("taskSearch").value = view.search || "";
  document.getElementById("viewName").value = view.name || "";
  document.getElementById("viewScope").value = view.scope || "personal";
  visibleResourceColumns = new Set(
    Array.isArray(view.columns) && view.columns.length ? view.columns : ["current", "peak", "over"]
  );
  selectedResourceIds = new Set(
    Array.isArray(view.resourceIds) ? view.resourceIds : resources.map((resource) => resource.resourceId)
  );
  document.querySelectorAll(".zoom-button").forEach((button) => {
    const isActive = button.dataset.zoom === zoom;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  renderResourceOptions();
  renderColumnOptions();
  renderGantt();
}

function deleteView() {
  const viewId = document.getElementById("savedViewSelector").value;
  if (!viewId) return;
  const views = getSavedViews();
  const view = views.find((item) => item.viewId === viewId);
  if (!view) return;
  if (window.PPMResourceFeatureConfirm) {
    window.PPMResourceFeatureConfirm(
      "Delete saved view",
      `Delete ${view.name}? This removes only the saved view and does not change resource data.`,
      () => completeDeleteView(viewId, view)
    );
    return;
  }
  completeDeleteView(viewId, view);
}

async function completeDeleteView(viewId, view) {
  const views = getSavedViews();
  const saved = await PPMStore.resourceGanttViews.replaceAll(views.filter((item) => item.viewId !== viewId));
  if (!saved.ok) {
    showMessage(saved.message, saved.queued ? "warning" : "error");
    return;
  }
  document.getElementById("viewName").value = "";
  populateSavedViews();
  showMessage(`${view.name} was deleted.`, "success");
}

function goToToday() {
  const position = positionForDate(new Date());
  document.getElementById("ganttScroll").scrollLeft = Math.max(0, detailWidth() + position - 600);
}

function setGanttExpanded(expanded) {
  ganttExpanded = Boolean(expanded);
  const panel = document.querySelector(".gantt-panel");
  const button = document.getElementById("expandGanttButton");
  panel.classList.toggle("expanded", ganttExpanded);
  document.body.classList.toggle("gantt-expanded", ganttExpanded);
  button.setAttribute("aria-pressed", String(ganttExpanded));
  button.textContent = ganttExpanded ? "⛶ Exit expanded view" : "⛶ Expand Gantt";
  button.title = ganttExpanded
    ? "Return the allocation Gantt to the page"
    : "Expand the allocation Gantt to fill the browser window";
  requestAnimationFrame(renderGantt);
}

window.PPMExitResourceGanttExpansion = () => setGanttExpanded(false);

document.querySelectorAll(".zoom-button").forEach((button) =>
  button.addEventListener("click", () => {
    zoom = button.dataset.zoom;
    document.querySelectorAll(".zoom-button").forEach((item) => {
      const isActive = item === button;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
    });
    renderGantt();
  })
);
["groupBy", "teamFilter", "roleFilter"].forEach((id) =>
  document.getElementById(id).addEventListener("change", renderGantt)
);
document.getElementById("taskSearch").addEventListener("input", renderGantt);
document.getElementById("selectAllResources").addEventListener("click", () => {
  selectedResourceIds = new Set(resources.map((resource) => resource.resourceId));
  renderResourceOptions();
  renderGantt();
});
document.getElementById("clearResources").addEventListener("click", () => {
  selectedResourceIds = new Set();
  renderResourceOptions();
  renderGantt();
});
document.getElementById("saveViewButton").addEventListener("click", saveView);
document.getElementById("deleteViewButton").addEventListener("click", deleteView);
document.getElementById("savedViewSelector").addEventListener("change", function () {
  loadView(this.value);
});
document.getElementById("todayButton").addEventListener("click", goToToday);
document
  .getElementById("expandGanttButton")
  .addEventListener("click", () => setGanttExpanded(!ganttExpanded));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ganttExpanded) setGanttExpanded(false);
});
window.addEventListener("ppm-resource-absence-changed", renderGantt);

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderGantt, 120);
});

loadData();
populateFilters();
renderColumnOptions();
renderGantt();
setTimeout(goToToday, 0);
