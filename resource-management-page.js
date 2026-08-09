"use strict";

const VIEW_STORAGE_KEY = "ppmResourceGanttViews";
const DAY_MS = 24 * 60 * 60 * 1000;
const RESOURCE_NAME_WIDTH = 234;
const RESOURCE_METRIC_WIDTH = 82;
const ZOOM_CONFIG = {
  week: { width: 105, label: "Week", minimumBuckets: 26 },
  month: { width: 118, label: "Month", minimumBuckets: 18 },
  quarter: { width: 142, label: "Quarter", minimumBuckets: 12 },
  year: { width: 165, label: "Year", minimumBuckets: 10 }
};

let resources = [];
let assignments = [];
let zoom = "week";
let selectedResourceIds = new Set();
let timelineBuckets = [];
let visibleResourceColumns = new Set(["current", "peak", "over"]);
let ganttExpanded = false;

const parseStoredJson = (key, fallback) => PPMCore.readJson(key, fallback);

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

function startOfUnit(date, unit) {
  if (unit === "week") return startOfWeek(date);
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
  if (unit === "quarter") return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
  return new Date(date.getFullYear(), 0, 1);
}

function nextUnit(date, unit) {
  if (unit === "week") return addDays(date, 7);
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  if (unit === "quarter") return new Date(date.getFullYear(), date.getMonth() + 3, 1);
  return new Date(date.getFullYear() + 1, 0, 1);
}

function previousUnit(date, unit) {
  if (unit === "week") return addDays(date, -7);
  if (unit === "month") return new Date(date.getFullYear(), date.getMonth() - 1, 1);
  if (unit === "quarter") return new Date(date.getFullYear(), date.getMonth() - 3, 1);
  return new Date(date.getFullYear() - 1, 0, 1);
}

function bucketLabel(date, unit) {
  if (unit === "week") {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const week = Math.ceil(((date - firstDay) / DAY_MS + firstDay.getDay() + 1) / 7);
    return `W${week} · ${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
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

  const projects = parseStoredJson("ppmProjects", []);
  const projectPlans = parseStoredJson("ppmProjectPlans", {});
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
      return `<div class="timeline-cell ${includesToday ? "today" : ""}">${contentFunction ? contentFunction(bucket, index) : ""}</div>`;
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

function resourceRow(resource, resourceAssignments, absenceRows) {
  const allocations = allocationsForResource(resource.resourceId, resourceAssignments);
  const current = currentAllocation(resourceAssignments);
  const peak = allocations.length ? Math.max(...allocations) : 0;
  const over = Math.max(0, peak - PPMPlanning.getResourceConfig().warningThreshold);
  const ownAbsences = absenceRows.filter((absence) => absence.resourceId === resource.resourceId);
  return `
        <div class="gantt-row resource-row ${over ? "overallocated" : ""}">
          <div class="row-details">
            <div><div class="resource-name">${escapeHtml(resource.fullName || resource.resourceId)}</div><div class="resource-meta">${escapeHtml(resourceTeam(resource))} · ${escapeHtml(resourceRole(resource))}</div></div>
            ${metricMarkup("current", `${current}%`)}
            ${metricMarkup("peak", `${peak}%`)}
            ${metricMarkup("over", `${over}%`, over ? "over-threshold" : "within-threshold")}
          </div>
          <div class="timeline-row"${styleAttr(timelineStyle())}>${timelineCells((bucket, index) => `<span class="allocation-cell ${allocationClass(allocations[index])}">${allocations[index] ? `${allocations[index]}%` : ""}</span>`)}${ownAbsences.map(absenceBand).join("")}</div>
        </div>
      `;
}

function taskRow(assignment, absenceRows) {
  let bar = "";
  const conflicts = assignmentAbsences(assignment, absenceRows);
  if (assignment.startDate && assignment.finishDate) {
    const left = positionForDate(assignment.startDate);
    const right = positionForDate(addDays(assignment.finishDate, 1));
    const width = Math.max(12, right - left);
    const barClass =
      assignment.allocation > PPMPlanning.getResourceConfig().overAllocationThreshold
        ? "over"
        : assignment.taskStatus === "Complete"
          ? "complete"
          : "";
    bar = `<div class="task-bar ${barClass}"${styleAttr(`left:${left}px;width:${width}px`)} title="${escapeHtml(assignment.taskName)} · ${assignment.allocation}%${conflicts.length ? ` · Unavailable: ${conflicts.map(absenceReason).join("; ")}` : ""}">${escapeHtml(assignment.allocation)}%</div>`;
  }
  const planUrl = `project-plan.html?code=${encodeURIComponent(assignment.projectCode)}`;
  const conflictLabel = conflicts.length
    ? `<div class="absence-warning">Unavailable: ${escapeHtml(conflicts.map(absenceReason).join("; "))}</div>`
    : "";
  return `
        <div class="gantt-row task-row ${conflicts.length ? "has-absence-conflict" : ""}">
          <div class="row-details">
            <div><div class="task-name">${escapeHtml(assignment.taskName)}</div><div class="project-name"><a class="task-link" href="${planUrl}">${escapeHtml(assignment.projectName)}</a> · ${escapeHtml(assignment.projectCode)}</div>${conflictLabel}</div>
            ${metricMarkup("current", `${assignment.allocation}%`)}
            ${metricMarkup("peak", `${assignment.percentageComplete}% done`)}
            ${metricMarkup("over", assignment.startDate && assignment.finishDate ? "" : '<span class="unscheduled">Dates required</span>')}
          </div>
          <div class="timeline-row"${styleAttr(timelineStyle())}>${timelineCells()}${bar}${conflicts.map((absence) => absenceConflictSegment(assignment, absence)).join("")}</div>
        </div>
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
      html += resourceRow(resource, resourceAssignments, absenceRows);
      resourceAssignments.forEach((assignment) => {
        html += taskRow(assignment, absenceRows);
      });
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

function getSavedViews() {
  const views = parseStoredJson(VIEW_STORAGE_KEY, []);
  return Array.isArray(views) ? views : [];
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

function saveView() {
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
  localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(views));
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

function completeDeleteView(viewId, view) {
  const views = getSavedViews();
  localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(views.filter((item) => item.viewId !== viewId)));
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
