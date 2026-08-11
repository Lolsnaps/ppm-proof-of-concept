(function () {
  "use strict";

  const DEMAND_STATUSES = [
    "Draft",
    "Proposed",
    "Requested",
    "Provisionally assigned",
    "Confirmed",
    "Rejected",
    "Cancelled",
    "Completed"
  ];
  const OPEN_DEMAND_STATUSES = ["Draft", "Proposed", "Requested", "Provisionally assigned", "Confirmed"];
  const ASSIGNED_STATUSES = ["Provisionally assigned", "Confirmed"];
  const DAY_MS = 86400000;
  let activeTab = "gantt";
  let editingDemandId = "";
  let editingAbsenceId = "";
  let activeScenarioId = "";
  let confirmationAction = null;

  // Per-row change-history icon, if the shared change-log module is present.
  function history(entityType, entityId, name) {
    return window.PPMChangeLog ? window.PPMChangeLog.historyButton(entityType, entityId, name) : "";
  }

  function databaseResourceWorkflowEnabled() {
    /* Stage 17: was stage11DReady(), retired in Stage 14 and silently false ever since. */
    return Boolean(window.PPMChildDatabase?.workflowReady?.("resourceScenario"));
  }

  function cleanScenarioDemand(item) {
    const copy = { ...(item || {}) };
    [
      "databaseId",
      "databaseVersion",
      "recordSource",
      "__storageGroup",
      "__projectCode",
      "__programmeCode"
    ].forEach((field) => delete copy[field]);
    return copy;
  }

  const escapeHtml = PPMCore.escapeHtml;

  function resources() {
    return PPMResources.getResources().filter((resource) => resource.active !== false);
  }
  /* Stage 16: from PPMStore, which holds what PostgreSQL confirmed. */
  function projects() {
    return window.PPMStore ? PPMStore.projects.all() : [];
  }
  function plans() {
    return window.PPMStore ? PPMStore.plans.read() : {};
  }
  function iso(value) {
    return PPMPlanning.isoDate(value);
  }
  function date(value) {
    return PPMPlanning.parseDate(value);
  }
  function addDays(value, count) {
    return PPMPlanning.addDays(value, count);
  }
  function monday(value) {
    const result = date(value) || new Date();
    const day = result.getDay();
    result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
    return result;
  }
  function resourceById(id) {
    return resources().find((item) => item.resourceId === id) || null;
  }
  function projectByCode(code) {
    return projects().find((item) => item.projectCode === code) || null;
  }
  function nameForResource(id) {
    const item = resourceById(id);
    return item ? item.fullName || item.resourceId : id ? "Unknown resource" : "Unfilled";
  }
  function statusClass(status) {
    if (status === "Confirmed" || status === "Completed" || status === "Published") return "confirmed";
    if (status === "Provisionally assigned" || status === "Proposed" || status === "Draft")
      return "provisional";
    if (status === "Rejected" || status === "Cancelled") return "rejected";
    return "requested";
  }
  function fmtHours(value) {
    return `${Number(value || 0).toLocaleString("en-GB", { maximumFractionDigits: 1 })}h`;
  }
  function fmtDate(value) {
    return value
      ? new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        })
      : "Not set";
  }
  function weeks(count, startValue) {
    const start = monday(startValue || new Date());
    return Array.from({ length: count }, (_, index) => {
      const from = date(addDays(start, index * 7));
      const to = date(addDays(from, 6));
      return {
        start: from,
        end: to,
        startIso: iso(from),
        endIso: iso(to),
        label: from.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
      };
    });
  }

  function allTasks() {
    const projectMap = new Map(projects().map((project) => [project.projectCode, project]));
    const rows = [];
    Object.entries(plans()).forEach(([projectCode, tasks]) => {
      if (!Array.isArray(tasks)) return;
      tasks.forEach((task) =>
        rows.push({
          ...task,
          projectCode,
          projectName: projectMap.get(projectCode)?.projectName || projectCode
        })
      );
    });
    return rows;
  }

  function taskAssignments() {
    const linkedDemand = new Set(
      PPMPlanning.getDemand()
        .filter((item) => ASSIGNED_STATUSES.includes(item.status) && item.linkedTaskId && item.resourceId)
        .map((item) => `${item.projectCode}|${item.linkedTaskId}|${item.resourceId}`)
    );
    const rows = [];
    allTasks().forEach((task) => {
      const resourceId =
        task.taskOwnerResourceId || PPMResources.findResource("", task.taskOwner)?.resourceId || "";
      if (!resourceId || linkedDemand.has(`${task.projectCode}|${task.taskId}|${resourceId}`)) return;
      rows.push({
        assignmentId: `TASK|${task.projectCode}|${task.taskId}`,
        source: "Project plan",
        resourceId,
        projectCode: task.projectCode,
        projectName: task.projectName,
        taskId: task.taskId,
        taskName: task.taskName || "Unnamed task",
        startDate: task.forecastStartDate || task.baselineStartDate || "",
        endDate: task.forecastEndDate || task.baselineEndDate || "",
        allocationPercentage: Number(task.allocationPercentage || 0),
        status: task.taskStatus || "Not Started"
      });
    });
    return rows;
  }

  function proratedDemandHours(demand, resource, startIso, endIso) {
    const overlapStart = demand.startDate > startIso ? demand.startDate : startIso;
    const overlapEnd = demand.endDate < endIso ? demand.endDate : endIso;
    if (!overlapStart || !overlapEnd || overlapEnd < overlapStart) return 0;
    if (demand.allocationMethod === "Hours") {
      const totalDays = Math.max(1, PPMPlanning.workingDaysBetween(demand.startDate, demand.endDate));
      const overlapDays = PPMPlanning.workingDaysBetween(overlapStart, overlapEnd);
      return (Number(demand.hours || demand.normalisedHours || 0) * overlapDays) / totalDays;
    }
    const capacity = PPMPlanning.availableCapacity(resource || {}, overlapStart, overlapEnd).available;
    return (capacity * Number(demand.allocationPercentage || 0)) / 100;
  }

  function periodStats(resource, period, demandRows) {
    const capacity = PPMPlanning.availableCapacity(resource, period.startIso, period.endIso);
    const taskRows = taskAssignments().filter(
      (item) =>
        item.resourceId === resource.resourceId &&
        PPMPlanning.overlap(item.startDate, item.endDate, period.startIso, period.endIso)
    );
    const taskHours = taskRows.reduce(
      (sum, item) => sum + (capacity.available * Number(item.allocationPercentage || 0)) / 100,
      0
    );
    const liveDemand = (demandRows || PPMPlanning.getDemand()).filter(
      (item) =>
        item.resourceId === resource.resourceId &&
        ASSIGNED_STATUSES.includes(item.status) &&
        PPMPlanning.overlap(item.startDate, item.endDate, period.startIso, period.endIso)
    );
    const confirmedHours =
      liveDemand
        .filter((item) => item.status === "Confirmed")
        .reduce((sum, item) => sum + proratedDemandHours(item, resource, period.startIso, period.endIso), 0) +
      taskHours;
    const provisionalHours = liveDemand
      .filter((item) => item.status === "Provisionally assigned")
      .reduce((sum, item) => sum + proratedDemandHours(item, resource, period.startIso, period.endIso), 0);
    const config = PPMPlanning.getResourceConfig();
    const allocated = confirmedHours + (config.includeProvisionalInCapacity ? provisionalHours : 0);
    const utilisation = capacity.available ? (allocated / capacity.available) * 100 : allocated ? 999 : 0;
    return {
      ...capacity,
      confirmedHours,
      provisionalHours,
      allocated,
      utilisation,
      assignments: [...taskRows, ...liveDemand]
    };
  }

  function injectInterface() {
    const gantt = document.querySelector(".gantt-panel");
    const tabs = document.createElement("div");
    tabs.className = "rm-feature-tabs";
    tabs.innerHTML = [
      ["gantt", "Allocation Gantt"],
      ["heatmap", "Heatmap"],
      ["capacity", "Demand vs capacity"],
      ["utilisation", "Utilisation & conflicts"],
      ["skills", "Skills demand"],
      ["runway", "Runway"],
      ["demand", "Demand requests"],
      ["scenarios", "Scenarios"],
      ["availability", "Absence & availability"]
    ]
      .map(
        ([key, label]) =>
          `<button type="button" class="rm-feature-tab ${key === "gantt" ? "active" : ""}" data-rm-tab="${key}">${label}</button>`
      )
      .join("");
    gantt.parentElement.insertBefore(tabs, gantt);
    const host = document.createElement("div");
    host.id = "rmFeatureHost";
    host.innerHTML = panelMarkup();
    gantt.insertAdjacentElement("afterend", host);
    document.body.insertAdjacentHTML("beforeend", modalMarkup());
  }

  function panelMarkup() {
    return `
      <section id="rmPanelHeatmap" class="rm-panel" data-panel="heatmap"><div class="rm-panel-heading"><div><h3>Allocation heatmap</h3><p>Weekly utilisation after contracted non-working time, approved absence and operational commitments.</p></div><div class="rm-actions"><button id="rmConfigureCapacity" class="button light small" type="button">Capacity thresholds</button></div></div><div id="rmHeatmapBody" class="rm-panel-body"></div></section>
      <section id="rmPanelCapacity" class="rm-panel" data-panel="capacity"><div class="rm-panel-heading"><div><h3>Demand versus capacity</h3><p>Available hours compared with confirmed, provisional and unfilled demand by team and month.</p></div></div><div id="rmCapacityBody" class="rm-panel-body"></div></section>
      <section id="rmPanelUtilisation" class="rm-panel" data-panel="utilisation"><div class="rm-panel-heading"><div><h3>Utilisation and allocation conflicts</h3><p>Under-utilisation, over-allocation and the assignments contributing to each exception.</p></div></div><div id="rmUtilisationBody" class="rm-panel-body"></div></section>
      <section id="rmPanelSkills" class="rm-panel" data-panel="skills"><div class="rm-panel-heading"><div><h3>Skills demand</h3><p>Open demand grouped by requested role or skill, including gaps that are not yet filled.</p></div></div><div id="rmSkillsBody" class="rm-panel-body"></div></section>
      <section id="rmPanelRunway" class="rm-panel" data-panel="runway"><div class="rm-panel-heading"><div><h3>Resource runway</h3><p>How far current work extends and the first week each person is expected to become available.</p></div></div><div id="rmRunwayBody" class="rm-panel-body"></div></section>
      <section id="rmPanelDemand" class="rm-panel" data-panel="demand"><div class="rm-panel-heading"><div><h3>Resource demand requests</h3><p>Raise generic or named demand, progress it through approval and retain its original allocation method with normalised hours.</p></div><div class="rm-actions"><button id="rmAddDemand" data-permission="resourceManagement.edit" class="button" type="button">Raise demand</button></div></div><div id="rmDemandBody" class="rm-panel-body"></div></section>
      <section id="rmPanelScenarios" class="rm-panel" data-panel="scenarios"><div class="rm-panel-heading"><div><h3>Resource scenarios</h3><p>Move dates, assignments or allocation levels without changing live data until an approved scenario is published.</p></div><div class="rm-actions"><button id="rmAddScenario" data-permission="resourceManagement.edit" class="button" type="button">Create scenario</button></div></div><div id="rmScenariosBody" class="rm-panel-body"></div></section>
      <section id="rmPanelAvailability" class="rm-panel" data-panel="availability"><div class="rm-panel-heading"><div><h3>Absence and non-working time</h3><p>Approved absence reduces available capacity; weekly non-working and operational time is maintained in the Resource directory.</p></div><div class="rm-actions"><button id="rmAddAbsence" data-permission="resourceManagement.edit" class="button" type="button">Add absence</button></div></div><div id="rmAvailabilityBody" class="rm-panel-body"></div></section>`;
  }

  function modalMarkup() {
    const statusOptions = DEMAND_STATUSES.map((value) => `<option>${value}</option>`).join("");
    return `
      <div id="rmDemandModal" class="rm-modal-backdrop"><div class="rm-modal"><form id="rmDemandForm"><div class="rm-modal-header"><div><h3 id="rmDemandTitle">Raise resource demand</h3><p>All allocation is stored in its original form and as normalised hours.</p></div><button type="button" class="rm-modal-close" data-rm-close="rmDemandModal">&times;</button></div><div class="rm-modal-body"><div id="rmDemandAlert" class="rm-alert"></div><div class="rm-form-grid">
        <div class="rm-field"><label for="rmDemandProject">Project *</label><select id="rmDemandProject" required></select></div>
        <div class="rm-field"><label for="rmDemandPhase">Phase / deliverable</label><input id="rmDemandPhase" maxlength="150"></div>
        <div class="rm-field"><label for="rmDemandTask">Linked milestone / task</label><select id="rmDemandTask"><option value="">Not linked</option></select></div>
        <div class="rm-field"><label for="rmDemandRole">Role or skill *</label><input id="rmDemandRole" maxlength="120" required></div>
        <div class="rm-field"><label for="rmDemandTeam">Team</label><input id="rmDemandTeam" maxlength="120"></div>
        <div class="rm-field"><label for="rmDemandResource">Named resource or placeholder</label><select id="rmDemandResource"><option value="">Generic / unfilled demand</option></select><div class="rm-hint">Leave unfilled when requesting capacity by role or skill.</div></div>
        <div class="rm-field"><label for="rmDemandStart">Start date *</label><input id="rmDemandStart" type="date" required></div>
        <div class="rm-field"><label for="rmDemandEnd">End date *</label><input id="rmDemandEnd" type="date" required></div>
        <div class="rm-field"><label for="rmDemandMethod">Allocation method *</label><select id="rmDemandMethod"><option>Percentage</option>
<option>Hours</option></select></div>
        <div class="rm-field"><label for="rmDemandPercent">Allocation percentage</label><input id="rmDemandPercent" type="number" min="0" max="999" step="1" value="100"></div>
        <div class="rm-field"><label for="rmDemandHours">Total requested hours</label><input id="rmDemandHours" type="number" min="0" step="0.5"></div>
        <div class="rm-field"><label for="rmDemandStatus">Approval status *</label><select id="rmDemandStatus">${statusOptions}</select></div>
        <div class="rm-field"><label for="rmDemandConfidence">Confidence</label><select id="rmDemandConfidence"><option>High</option>
<option selected>Medium</option>
<option>Low</option></select></div>
        <div class="rm-field"><label for="rmDemandPriority">Priority</label><select id="rmDemandPriority"><option>Critical</option>
<option>High</option>
<option selected>Medium</option>
<option>Low</option></select></div>
        <div class="rm-field"><label for="rmDemandRequestor">Requestor</label><select id="rmDemandRequestor"></select></div>
        <div class="rm-field"><label for="rmDemandApprover">Approver</label><select id="rmDemandApprover"></select></div>
        <div class="rm-field full"><label for="rmDemandNotes">Notes / justification</label><textarea id="rmDemandNotes" maxlength="1500"></textarea></div>
      </div></div><div class="rm-modal-footer"><button type="button" class="button light" data-rm-close="rmDemandModal">Cancel</button><button type="submit" class="button" data-permission="resourceManagement.edit">Save demand</button></div></form></div></div>

      <div id="rmAbsenceModal" class="rm-modal-backdrop"><div class="rm-modal narrow"><form id="rmAbsenceForm"><div class="rm-modal-header"><div><h3 id="rmAbsenceTitle">Add absence</h3><p>Approved records reduce the person’s available capacity.</p></div><button type="button" class="rm-modal-close" data-rm-close="rmAbsenceModal">&times;</button></div><div class="rm-modal-body"><div id="rmAbsenceAlert" class="rm-alert"></div><div class="rm-form-grid">
        <div class="rm-field full"><label for="rmAbsenceResource">Resource *</label><select id="rmAbsenceResource" required></select></div>
        <div class="rm-field"><label for="rmAbsenceType">Type</label><select id="rmAbsenceType"><option>Annual leave</option>
<option>Sickness</option>
<option>Training</option>
<option>Public holiday</option>
<option>Other</option></select></div>
        <div class="rm-field"><label for="rmAbsenceStatus">Status</label><select id="rmAbsenceStatus"><option>Proposed</option>
<option>Approved</option>
<option>Rejected</option>
<option>Cancelled</option></select></div>
        <div class="rm-field"><label for="rmAbsenceStart">Start *</label><input id="rmAbsenceStart" type="date" required></div>
        <div class="rm-field"><label for="rmAbsenceEnd">End *</label><input id="rmAbsenceEnd" type="date" required></div>
        <div class="rm-field"><label for="rmAbsenceHours">Hours per day</label><input id="rmAbsenceHours" type="number" min="0" max="24" step="0.5" value="7.5"></div>
        <div class="rm-field full"><label for="rmAbsenceNotes">Notes</label><textarea id="rmAbsenceNotes" maxlength="800"></textarea></div>
      </div></div><div class="rm-modal-footer"><button type="button" class="button light" data-rm-close="rmAbsenceModal">Cancel</button><button type="submit" class="button" data-permission="resourceManagement.edit">Save absence</button></div></form></div></div>

      <div id="rmCapacityModal" class="rm-modal-backdrop"><div class="rm-modal narrow"><form id="rmCapacityForm"><div class="rm-modal-header"><div><h3>Capacity thresholds</h3><p>These boundaries drive heatmap colours and exception reporting.</p></div><button type="button" class="rm-modal-close" data-rm-close="rmCapacityModal">&times;</button></div><div class="rm-modal-body"><div id="rmCapacityAlert" class="rm-alert"></div><div class="rm-form-grid">
        <div class="rm-field"><label for="rmUnderThreshold">Under-utilisation below (%)</label><input id="rmUnderThreshold" type="number" min="0" max="100" required></div>
        <div class="rm-field"><label for="rmWarningThreshold">Warning above (%)</label><input id="rmWarningThreshold" type="number" min="1" required></div>
        <div class="rm-field"><label for="rmOverThreshold">Over-allocation above (%)</label><input id="rmOverThreshold" type="number" min="1" required></div>
        <div class="rm-field full"><label><input id="rmIncludeProvisional" type="checkbox" class="rm-checkbox"> Include provisional assignments in capacity utilisation</label></div>
      </div></div><div class="rm-modal-footer"><button type="button" class="button light" data-rm-close="rmCapacityModal">Cancel</button><button type="submit" class="button" data-permission="resourceManagement.edit">Save thresholds</button></div></form></div></div>

      <div id="rmScenarioModal" class="rm-modal-backdrop"><div class="rm-modal narrow"><form id="rmScenarioForm"><div class="rm-modal-header"><div><h3>Create resource scenario</h3><p>A separate working copy of live demand will be created.</p></div><button type="button" class="rm-modal-close" data-rm-close="rmScenarioModal">&times;</button></div><div class="rm-modal-body"><div class="rm-form-grid"><div class="rm-field full"><label for="rmScenarioName">Scenario name *</label><input id="rmScenarioName" maxlength="120" required></div><div class="rm-field"><label for="rmScenarioVisibility">Visibility</label><select id="rmScenarioVisibility"><option>Private</option>
<option>Shared</option></select></div><div class="rm-field full"><label for="rmScenarioNotes">Purpose / notes</label><textarea id="rmScenarioNotes" maxlength="1000"></textarea></div></div></div><div class="rm-modal-footer"><button type="button" class="button light" data-rm-close="rmScenarioModal">Cancel</button><button type="submit" class="button" data-permission="resourceManagement.edit">Create scenario</button></div></form></div></div>

      <div id="rmScenarioAdjustModal" class="rm-modal-backdrop"><div class="rm-modal"><form id="rmScenarioAdjustForm"><div class="rm-modal-header"><div><h3>Adjust scenario demand</h3><p>Changes stay inside the scenario until it is published.</p></div><button type="button" class="rm-modal-close" data-rm-close="rmScenarioAdjustModal">&times;</button></div><div class="rm-modal-body"><div class="rm-form-grid"><div class="rm-field full"><label for="rmScenarioDemand">Demand item *</label><select id="rmScenarioDemand" required></select></div><div class="rm-field"><label for="rmScenarioResource">Resource</label><select id="rmScenarioResource"></select></div><div class="rm-field"><label for="rmScenarioStart">Start date *</label><input id="rmScenarioStart" type="date" required></div><div class="rm-field"><label for="rmScenarioEnd">End date *</label><input id="rmScenarioEnd" type="date" required></div><div class="rm-field"><label for="rmScenarioAllocation">Allocation percentage</label><input id="rmScenarioAllocation" type="number" min="0" max="999"></div><div class="rm-field"><label for="rmScenarioHours">Requested hours</label><input id="rmScenarioHours" type="number" min="0" step="0.5"></div></div></div><div class="rm-modal-footer"><button type="button" class="button light" data-rm-close="rmScenarioAdjustModal">Cancel</button><button type="submit" class="button" data-permission="resourceManagement.edit">Save scenario adjustment</button></div></form></div></div>

      <div id="rmConfirmModal" class="rm-modal-backdrop"><div class="rm-modal narrow"><div class="rm-modal-header"><div><h3 id="rmConfirmTitle">Confirm action</h3></div><button type="button" class="rm-modal-close" data-rm-close="rmConfirmModal">&times;</button></div><div class="rm-modal-body"><p id="rmConfirmText" class="rm-confirm-text"></p></div><div class="rm-modal-footer"><button type="button" class="button light" data-rm-close="rmConfirmModal">Cancel</button><button id="rmConfirmAction" type="button" class="button danger">Confirm</button></div></div></div>`;
  }

  function openModal(id) {
    document.getElementById(id).classList.add("visible");
    document.body.style.overflow = "hidden";
  }
  function closeModal(id) {
    document.getElementById(id).classList.remove("visible");
    if (!document.querySelector(".rm-modal-backdrop.visible")) document.body.style.overflow = "";
  }
  function showAlert(id, message) {
    const element = document.getElementById(id);
    element.textContent = message || "";
    element.classList.toggle("visible", Boolean(message));
  }
  function field(id) {
    return document.getElementById(id);
  }
  function value(id) {
    return field(id).value.trim();
  }
  function setValue(id, val) {
    field(id).value = val === null || val === undefined ? "" : val;
  }
  function option(value, label, selected) {
    return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }
  function resourceOptions(selected, blankLabel) {
    return (
      option("", blankLabel || "Select a resource", !selected) +
      resources()
        .map((item) => option(item.resourceId, PPMResources.optionLabel(item), item.resourceId === selected))
        .join("")
    );
  }
  function projectOptions(selected) {
    return (
      option("", "Select a project", !selected) +
      projects()
        .filter((item) => !item.archived)
        .map((item) =>
          option(item.projectCode, `${item.projectCode} — ${item.projectName}`, item.projectCode === selected)
        )
        .join("")
    );
  }

  function switchTab(tab) {
    if (tab !== "gantt" && window.PPMExitResourceGanttExpansion) window.PPMExitResourceGanttExpansion();
    activeTab = tab;
    document
      .querySelectorAll(".rm-feature-tab")
      .forEach((button) => button.classList.toggle("active", button.dataset.rmTab === tab));
    document.querySelector(".gantt-panel").classList.toggle("rm-hidden", tab !== "gantt");
    document
      .querySelectorAll(".rm-panel")
      .forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
    renderActivePanel();
  }

  function renderActivePanel() {
    if (activeTab === "heatmap") renderHeatmap();
    if (activeTab === "capacity") renderCapacity();
    if (activeTab === "utilisation") renderUtilisation();
    if (activeTab === "skills") renderSkills();
    if (activeTab === "runway") renderRunway();
    if (activeTab === "demand") renderDemand();
    if (activeTab === "scenarios") renderScenarios();
    if (activeTab === "availability") renderAvailability();
  }

  function utilisationClass(percent) {
    const config = PPMPlanning.getResourceConfig();
    if (percent > config.overAllocationThreshold) return "util-over";
    if (percent > config.warningThreshold) return "util-warning";
    if (percent > 0 && percent < config.underUtilisationThreshold) return "util-under";
    if (percent > 0) return "util-good";
    return "util-none";
  }

  function renderHeatmap() {
    const periods = weeks(13);
    const rows = resources();
    if (!rows.length) {
      field("rmHeatmapBody").innerHTML =
        '<div class="rm-empty">No active resources are available for the allocation heatmap.</div>';
      return;
    }
    const body = rows
      .map(
        (resource) =>
          `<tr><td>${escapeHtml(resource.fullName || resource.resourceId)}<div class="rm-muted">${escapeHtml(resource.team || "No team")} · ${escapeHtml(resource.jobTitle || resource.role || "No role")}</div></td>${periods
            .map((period) => {
              const stats = periodStats(resource, period);
              const pct = Math.round(stats.utilisation);
              const explanation = `${fmtHours(stats.allocated)} allocated / ${fmtHours(stats.available)} available; ${fmtHours(stats.absence)} approved absence`;
              return `<td class="${utilisationClass(pct)}" title="${escapeHtml(explanation)}">${pct ? `${pct}%` : "—"}</td>`;
            })
            .join("")}</tr>`
      )
      .join("");
    field("rmHeatmapBody").innerHTML =
      `<div class="rm-table-wrap"><table class="rm-heatmap"><thead><tr><th>Resource</th>${periods.map((period) => `<th>${period.label}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function monthPeriods(count) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return Array.from({ length: count }, (_, index) => {
      const from = new Date(start.getFullYear(), start.getMonth() + index, 1);
      const to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
      return {
        startIso: iso(from),
        endIso: iso(to),
        label: from.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
      };
    });
  }

  function renderCapacity() {
    const periods = monthPeriods(6);
    const teams = [...new Set(resources().map((item) => item.team || "Unassigned team"))].sort();
    const demands = PPMPlanning.getDemand();
    const rows = teams.flatMap((team) =>
      periods.map((period) => {
        const teamResources = resources().filter((item) => (item.team || "Unassigned team") === team);
        const capacity = teamResources.reduce(
          (sum, item) => sum + PPMPlanning.availableCapacity(item, period.startIso, period.endIso).available,
          0
        );
        const teamDemand = demands.filter(
          (item) =>
            (item.team || resourceById(item.resourceId)?.team || "Unassigned team") === team &&
            OPEN_DEMAND_STATUSES.includes(item.status) &&
            PPMPlanning.overlap(item.startDate, item.endDate, period.startIso, period.endIso)
        );
        const confirmed = teamDemand
          .filter((item) => item.status === "Confirmed")
          .reduce(
            (sum, item) =>
              sum +
              proratedDemandHours(item, resourceById(item.resourceId) || {}, period.startIso, period.endIso),
            0
          );
        const provisional = teamDemand
          .filter((item) => item.status === "Provisionally assigned")
          .reduce(
            (sum, item) =>
              sum +
              proratedDemandHours(item, resourceById(item.resourceId) || {}, period.startIso, period.endIso),
            0
          );
        const unfilled = teamDemand
          .filter((item) => !item.resourceId)
          .reduce((sum, item) => sum + proratedDemandHours(item, {}, period.startIso, period.endIso), 0);
        const percent = capacity
          ? ((confirmed + provisional) / capacity) * 100
          : confirmed + provisional
            ? 999
            : 0;
        return { team, period, capacity, confirmed, provisional, unfilled, percent };
      })
    );
    field("rmCapacityBody").innerHTML =
      `<div class="rm-table-wrap"><table class="rm-table"><thead><tr><th>Team</th>
<th>Period</th>
<th>Available capacity</th>
<th>Confirmed demand</th>
<th>Provisional demand</th>
<th>Unfilled demand</th>
<th>Demand / capacity</th></tr></thead><tbody>${rows
        .map(
          (row) => `<tr><td class="rm-strong">${escapeHtml(row.team)}</td>
<td>${row.period.label}</td>
<td>${fmtHours(row.capacity)}</td>
<td>${fmtHours(row.confirmed)}</td>
<td>${fmtHours(row.provisional)}</td>
<td>${fmtHours(row.unfilled)}</td>
<td><div class="rm-bar-track" title="${Math.round(row.percent)}%"><div class="rm-bar ${row.percent > PPMPlanning.getResourceConfig().overAllocationThreshold ? "over" : row.percent > PPMPlanning.getResourceConfig().warningThreshold ? "warning" : ""}" ${PPMCore.styleAttribute(`width:${Math.min(100, row.percent)}%`)}></div></div><div class="rm-muted">${Math.round(row.percent)}%</div></td></tr>`
        )
        .join("")}</tbody></table></div>`;
  }

  function renderUtilisation() {
    const period = { startIso: iso(monday(new Date())), endIso: iso(addDays(monday(new Date()), 27)) };
    const config = PPMPlanning.getResourceConfig();
    const rows = resources()
      .map((resource) => {
        const stats = periodStats(resource, period);
        return { resource, stats, pct: Math.round(stats.utilisation) };
      })
      .filter((row) => row.pct < config.underUtilisationThreshold || row.pct > config.warningThreshold);
    const under = rows.filter((row) => row.pct < config.underUtilisationThreshold).length;
    const over = rows.filter((row) => row.pct > config.overAllocationThreshold).length;
    field("rmUtilisationBody").innerHTML =
      `<div class="rm-metric-grid"><div class="rm-metric"><div class="rm-metric-label">Under-utilised people</div><div class="rm-metric-value">${under}</div></div><div class="rm-metric"><div class="rm-metric-label">Overallocated people</div><div class="rm-metric-value">${over}</div></div><div class="rm-metric"><div class="rm-metric-label">Warning threshold</div><div class="rm-metric-value">${config.warningThreshold}%</div></div><div class="rm-metric"><div class="rm-metric-label">Over-allocation threshold</div><div class="rm-metric-value">${config.overAllocationThreshold}%</div></div></div>${
        rows.length
          ? `<div class="rm-table-wrap"><table class="rm-table"><thead><tr><th>Resource</th>
<th>Team / role</th>
<th>Available</th>
<th>Allocated</th>
<th>Utilisation</th>
<th>Contributing assignments</th></tr></thead><tbody>${rows
              .map(
                ({ resource, stats, pct }) => `<tr><td class="rm-strong">${escapeHtml(resource.fullName)}</td>
<td>${escapeHtml(resource.team || "No team")}<div class="rm-muted">${escapeHtml(resource.jobTitle || resource.role || "No role")}</div></td>
<td>${fmtHours(stats.available)}</td>
<td>${fmtHours(stats.allocated)}</td>
<td><span class="rm-badge ${pct > config.overAllocationThreshold ? "over" : pct < config.underUtilisationThreshold ? "requested" : "warning"}">${pct}%</span></td>
<td>${stats.assignments.length ? stats.assignments.map((item) => `<div><strong>${escapeHtml(item.taskName || item.roleSkill || item.role || "Demand")}</strong> — ${escapeHtml(item.projectCode || "No project")} (${item.allocationPercentage || 0}%)</div>`).join("") : '<span class="rm-muted">No project demand in this period</span>'}</td></tr>`
              )
              .join("")}</tbody></table></div>`
          : '<div class="rm-empty">No under-utilisation or allocation conflicts were identified for the next four weeks.</div>'
      }`;
  }

  function renderSkills() {
    const grouped = new Map();
    PPMPlanning.getDemand()
      .filter((item) => OPEN_DEMAND_STATUSES.includes(item.status))
      .forEach((item) => {
        const key = item.roleSkill || item.role || "Unspecified role / skill";
        const current = grouped.get(key) || {
          count: 0,
          hours: 0,
          unfilled: 0,
          projects: new Set(),
          earliest: ""
        };
        current.count += 1;
        current.hours += Number(
          item.normalisedHours || PPMPlanning.normalisedDemandHours(item, resourceById(item.resourceId) || {})
        );
        if (!item.resourceId) current.unfilled += 1;
        if (item.projectCode) current.projects.add(item.projectCode);
        if (!current.earliest || item.startDate < current.earliest) current.earliest = item.startDate;
        grouped.set(key, current);
      });
    const rows = [...grouped.entries()].sort((a, b) => b[1].hours - a[1].hours);
    field("rmSkillsBody").innerHTML = rows.length
      ? `<div class="rm-table-wrap"><table class="rm-table"><thead><tr><th>Role / skill</th>
<th>Open requests</th>
<th>Normalised demand</th>
<th>Unfilled</th>
<th>Projects</th>
<th>Earliest need</th></tr></thead><tbody>${rows
          .map(
            ([skill, row]) => `<tr><td class="rm-strong">${escapeHtml(skill)}</td>
<td>${row.count}</td>
<td>${fmtHours(row.hours)}</td>
<td><span class="rm-badge ${row.unfilled ? "warning" : "good"}">${row.unfilled}</span></td>
<td>${escapeHtml([...row.projects].join(", ") || "No project")}</td>
<td>${fmtDate(row.earliest)}</td></tr>`
          )
          .join("")}</tbody></table></div>`
      : '<div class="rm-empty">No open role or skills demand has been raised.</div>';
  }

  function renderRunway() {
    const periods = weeks(26);
    const threshold = PPMPlanning.getResourceConfig().underUtilisationThreshold;
    const rows = resources().map((resource) => {
      const stats = periods.map((period) => periodStats(resource, period));
      let activeThrough = -1;
      stats.forEach((item, index) => {
        if (item.utilisation >= threshold) activeThrough = index;
      });
      const nextAvailable = periods[Math.min(periods.length - 1, activeThrough + 1)];
      return {
        resource,
        activeThrough,
        nextAvailable,
        peak: Math.round(Math.max(0, ...stats.map((item) => item.utilisation))),
        average: Math.round(stats.reduce((sum, item) => sum + item.utilisation, 0) / stats.length)
      };
    });
    field("rmRunwayBody").innerHTML =
      `<div class="rm-table-wrap"><table class="rm-table"><thead><tr><th>Resource</th>
<th>Team / role</th>
<th>Current work runway</th>
<th>Expected availability</th>
<th>26-week average</th>
<th>Peak</th></tr></thead><tbody>${rows
        .map(
          (row) => `<tr><td class="rm-strong">${escapeHtml(row.resource.fullName)}</td>
<td>${escapeHtml(row.resource.team || "No team")}<div class="rm-muted">${escapeHtml(row.resource.jobTitle || row.resource.role || "No role")}</div></td>
<td>${row.activeThrough < 0 ? "Available now" : `${row.activeThrough + 1} week${row.activeThrough ? "s" : ""}`}</td>
<td>${row.activeThrough >= periods.length - 1 ? "Beyond 26-week horizon" : fmtDate(row.nextAvailable.startIso)}</td>
<td>${row.average}%</td>
<td><span class="rm-badge ${row.peak > 100 ? "over" : row.peak > 90 ? "warning" : "good"}">${row.peak}%</span></td></tr>`
        )
        .join("")}</tbody></table></div>`;
  }

  function renderDemand() {
    const rows = PPMPlanning.getDemand()
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    const duplicates = new Set(PPMPlanning.likelyDuplicateDemand(rows).flat());
    const requested = rows.filter((item) => item.status === "Requested").length;
    const unfilled = rows.filter(
      (item) => OPEN_DEMAND_STATUSES.includes(item.status) && !item.resourceId
    ).length;
    const confirmedHours = rows
      .filter((item) => item.status === "Confirmed")
      .reduce((sum, item) => sum + Number(item.normalisedHours || 0), 0);
    field("rmDemandBody").innerHTML =
      `<div class="rm-metric-grid"><div class="rm-metric"><div class="rm-metric-label">Awaiting approval</div><div class="rm-metric-value">${requested}</div></div><div class="rm-metric"><div class="rm-metric-label">Unfilled requests</div><div class="rm-metric-value">${unfilled}</div></div><div class="rm-metric"><div class="rm-metric-label">Confirmed normalised hours</div><div class="rm-metric-value">${Math.round(confirmedHours).toLocaleString("en-GB")}</div></div><div class="rm-metric"><div class="rm-metric-label">Potential duplicates</div><div class="rm-metric-value">${duplicates.size}</div></div></div>${
        rows.length
          ? `<div class="rm-table-wrap"><table class="rm-table"><thead><tr><th>Demand ID</th>
<th>Project / work</th>
<th>Role / skill</th>
<th>Resource / team</th>
<th>Dates</th>
<th>Original request</th>
<th>Normalised</th>
<th>Status</th>
<th>Approval</th>
<th>Actions</th></tr></thead><tbody>${rows
              .map(
                (
                  item
                ) => `<tr data-demand-id="${escapeHtml(item.demandId)}"><td class="rm-strong">${escapeHtml(item.demandId)}${duplicates.has(item.demandId) ? '<div><span class="rm-badge warning">Check duplicate</span></div>' : ""}</td>
<td>${escapeHtml(item.projectCode || "No project")}<div class="rm-muted">${escapeHtml(item.phaseReference || item.linkedTaskName || "No work reference")}</div></td>
<td>${escapeHtml(item.roleSkill || "Not set")}<div class="rm-muted">${escapeHtml(item.priority || "Medium")} priority · ${escapeHtml(item.confidence || "Medium")} confidence</div></td>
<td>${escapeHtml(nameForResource(item.resourceId))}<div class="rm-muted">${escapeHtml(item.team || resourceById(item.resourceId)?.team || "No team")}</div></td>
<td>${fmtDate(item.startDate)}<div class="rm-muted">to ${fmtDate(item.endDate)}</div></td>
<td>${item.allocationMethod === "Hours" ? fmtHours(item.hours) : `${Number(item.allocationPercentage || 0)}%`}</td>
<td>${fmtHours(item.normalisedHours)}</td>
<td><span class="rm-badge ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
<td>${escapeHtml(nameForResource(item.approverResourceId) || "Not assigned")}<div class="rm-muted">${escapeHtml(item.lastDecision || "")}</div></td>
<td>${history("Resource demand", item.demandId, item.roleSkill || item.demandId)}<button type="button" class="button light small rm-edit-demand" data-permission="resourceManagement.edit" data-demand-id="${escapeHtml(item.demandId)}">Edit</button></td></tr>`
              )
              .join("")}</tbody></table></div>`
          : '<div class="rm-empty">No resource demand has been raised. Use <strong>Raise demand</strong> to create the first request.</div>'
      }`;
    document
      .querySelectorAll(".rm-edit-demand")
      .forEach((button) => button.addEventListener("click", () => openDemand(button.dataset.demandId)));
  }

  function populateDemandTasks(selectedTaskId) {
    const code = value("rmDemandProject");
    const items = Array.isArray(plans()[code]) ? plans()[code] : [];
    field("rmDemandTask").innerHTML =
      option("", "Not linked", !selectedTaskId) +
      items
        .map((task) =>
          option(
            task.taskId,
            `${task.taskType || "Task"}: ${task.taskName || task.taskId}`,
            task.taskId === selectedTaskId
          )
        )
        .join("");
  }

  function openDemand(demandId) {
    editingDemandId = demandId || "";
    const item = PPMPlanning.getDemand().find((row) => row.demandId === demandId) || {};
    field("rmDemandTitle").textContent = demandId ? `Edit ${demandId}` : "Raise resource demand";
    field("rmDemandProject").innerHTML = projectOptions(item.projectCode);
    field("rmDemandResource").innerHTML = resourceOptions(item.resourceId, "Generic / unfilled demand");
    field("rmDemandRequestor").innerHTML = resourceOptions(item.requestorResourceId, "Select requestor");
    field("rmDemandApprover").innerHTML = resourceOptions(item.approverResourceId, "Select approver");
    setValue("rmDemandProject", item.projectCode || "");
    populateDemandTasks(item.linkedTaskId);
    setValue("rmDemandPhase", item.phaseReference || "");
    setValue("rmDemandRole", item.roleSkill || "");
    setValue("rmDemandTeam", item.team || "");
    setValue("rmDemandResource", item.resourceId || "");
    setValue("rmDemandStart", item.startDate || "");
    setValue("rmDemandEnd", item.endDate || "");
    setValue("rmDemandMethod", item.allocationMethod || "Percentage");
    setValue("rmDemandPercent", item.allocationPercentage ?? 100);
    setValue("rmDemandHours", item.hours ?? "");
    setValue("rmDemandStatus", item.status || "Draft");
    setValue("rmDemandConfidence", item.confidence || "Medium");
    setValue("rmDemandPriority", item.priority || "Medium");
    setValue("rmDemandRequestor", item.requestorResourceId || "");
    setValue("rmDemandApprover", item.approverResourceId || "");
    setValue("rmDemandNotes", item.notes || "");
    updateDemandMethod();
    showAlert("rmDemandAlert", "");
    openModal("rmDemandModal");
  }

  function updateDemandMethod() {
    const percentage = value("rmDemandMethod") === "Percentage";
    field("rmDemandPercent").disabled = !percentage;
    field("rmDemandHours").disabled = percentage;
    field("rmDemandPercent").required = percentage;
    field("rmDemandHours").required = !percentage;
  }

  function selectedDemandTask() {
    const code = value("rmDemandProject");
    const taskId = value("rmDemandTask");
    return (Array.isArray(plans()[code]) ? plans()[code] : []).find((item) => item.taskId === taskId) || null;
  }

  async function saveDemandForm(event) {
    event.preventDefault();
    showAlert("rmDemandAlert", "");
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const startDate = value("rmDemandStart");
    const endDate = value("rmDemandEnd");
    if (endDate < startDate) {
      showAlert("rmDemandAlert", "End date cannot be before the start date.");
      return;
    }
    const task = selectedDemandTask();
    if (task) {
      const taskStart = task.forecastStartDate || task.baselineStartDate;
      const taskEnd = task.forecastEndDate || task.baselineEndDate;
      if ((taskStart && startDate < taskStart) || (taskEnd && endDate > taskEnd)) {
        showAlert(
          "rmDemandAlert",
          `This assignment falls outside the linked task dates (${fmtDate(taskStart)} to ${fmtDate(taskEnd)}). Align the dates or remove the task link before saving.`
        );
        return;
      }
    }
    const rows = PPMPlanning.getDemand();
    const index = rows.findIndex((item) => item.demandId === editingDemandId);
    const existing = index >= 0 ? rows[index] : {};
    const resource = resourceById(value("rmDemandResource"));
    const method = value("rmDemandMethod");
    const status = value("rmDemandStatus");
    const now = new Date().toISOString();
    const candidate = {
      ...existing,
      demandId: existing.demandId || PPMPlanning.uid("DEM"),
      projectCode: value("rmDemandProject"),
      phaseReference: value("rmDemandPhase"),
      linkedTaskId: value("rmDemandTask"),
      linkedTaskName: task?.taskName || "",
      roleSkill: value("rmDemandRole"),
      resourceId: value("rmDemandResource"),
      requestedResourceKind: resource ? resource.resourceKind || "Named person" : "Generic role",
      team: value("rmDemandTeam") || resource?.team || "",
      startDate,
      endDate,
      allocationMethod: method,
      allocationPercentage: method === "Percentage" ? Number(value("rmDemandPercent")) : 0,
      hours: method === "Hours" ? Number(value("rmDemandHours")) : 0,
      status,
      confidence: value("rmDemandConfidence"),
      priority: value("rmDemandPriority"),
      notes: value("rmDemandNotes"),
      requestorResourceId: value("rmDemandRequestor"),
      approverResourceId: value("rmDemandApprover"),
      createdAt: existing.createdAt || now,
      updatedAt: now,
      history: [
        ...(Array.isArray(existing.history) ? existing.history : []),
        {
          changedAt: now,
          fromStatus: existing.status || "",
          toStatus: status,
          changedBy: nameForResource(value("rmDemandRequestor")) || "Resource team"
        }
      ]
    };
    candidate.normalisedHours =
      Math.round(PPMPlanning.normalisedDemandHours(candidate, resource || {}) * 10) / 10;
    if (
      ["Requested", "Provisionally assigned", "Confirmed", "Rejected"].includes(status) &&
      !candidate.approverResourceId
    ) {
      showAlert("rmDemandAlert", "Select an approver before progressing this demand through approval.");
      return;
    }
    if (status === "Rejected" && !candidate.notes) {
      showAlert("rmDemandAlert", "Record the rejection reason in Notes / justification.");
      return;
    }
    const duplicateRows = [...rows.filter((item) => item.demandId !== candidate.demandId), candidate];
    const duplicates = PPMPlanning.likelyDuplicateDemand(duplicateRows).filter((pair) =>
      pair.includes(candidate.demandId)
    );
    if (duplicates.length && !candidate.notes.toLowerCase().includes("duplicate reviewed")) {
      showAlert(
        "rmDemandAlert",
        "A likely duplicate exists for this resource, project and period. Review it and add ‘duplicate reviewed’ to the notes if both requests are intentional."
      );
      return;
    }
    if (index >= 0) rows[index] = candidate;
    else rows.push(candidate);
    if (!(await saved(PPMPlanning.saveDemand(rows)))) return;

    closeModal("rmDemandModal");
    renderDemand();
  }

  function renderAvailability() {
    const rows = PPMPlanning.getAbsences()
      .slice()
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    field("rmAvailabilityBody").innerHTML = rows.length
      ? `<div class="rm-table-wrap"><table class="rm-table"><thead><tr><th>Resource</th>
<th>Type</th>
<th>Dates</th>
<th>Hours/day</th>
<th>Status</th>
<th>Notes</th>
<th>Actions</th></tr></thead><tbody>${rows
          .map(
            (
              item
            ) => `<tr data-absence-id="${escapeHtml(item.absenceId)}"><td class="rm-strong">${escapeHtml(nameForResource(item.resourceId))}</td>
<td>${escapeHtml(item.type || "Other")}</td>
<td>${fmtDate(item.startDate)} to ${fmtDate(item.endDate)}</td>
<td>${Number(item.hoursPerDay || 0)}</td>
<td><span class="rm-badge ${item.status === "Approved" ? "good" : item.status === "Rejected" || item.status === "Cancelled" ? "rejected" : "warning"}">${escapeHtml(item.status)}</span></td>
<td>${escapeHtml(item.notes || "—")}</td>
<td>${history("Resource absence", item.absenceId, nameForResource(item.resourceId))}<button class="button light small rm-edit-absence" data-permission="resourceManagement.edit" type="button" data-absence-id="${escapeHtml(item.absenceId)}">Edit</button></td></tr>`
          )
          .join("")}</tbody></table></div>`
      : '<div class="rm-empty">No absence records have been created. Weekly non-working time can still be maintained in the Resource directory.</div>';
    document
      .querySelectorAll(".rm-edit-absence")
      .forEach((button) => button.addEventListener("click", () => openAbsence(button.dataset.absenceId)));
  }

  function openAbsence(absenceId) {
    editingAbsenceId = absenceId || "";
    const item = PPMPlanning.getAbsences().find((row) => row.absenceId === absenceId) || {};
    field("rmAbsenceTitle").textContent = absenceId ? "Edit absence" : "Add absence";
    field("rmAbsenceResource").innerHTML = resourceOptions(item.resourceId, "Select a resource");
    setValue("rmAbsenceResource", item.resourceId || "");
    setValue("rmAbsenceType", item.type || "Annual leave");
    setValue("rmAbsenceStatus", item.status || "Proposed");
    setValue("rmAbsenceStart", item.startDate || "");
    setValue("rmAbsenceEnd", item.endDate || "");
    setValue("rmAbsenceHours", item.hoursPerDay ?? PPMPlanning.getResourceConfig().standardDayHours);
    setValue("rmAbsenceNotes", item.notes || "");
    showAlert("rmAbsenceAlert", "");
    openModal("rmAbsenceModal");
  }

  async function saveAbsenceForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    if (value("rmAbsenceEnd") < value("rmAbsenceStart")) {
      showAlert("rmAbsenceAlert", "End date cannot be before the start date.");
      return;
    }
    const rows = PPMPlanning.getAbsences();
    const index = rows.findIndex((item) => item.absenceId === editingAbsenceId);
    const existing = index >= 0 ? rows[index] : {};
    const now = new Date().toISOString();
    const item = {
      ...existing,
      absenceId: existing.absenceId || PPMPlanning.uid("ABS"),
      resourceId: value("rmAbsenceResource"),
      type: value("rmAbsenceType"),
      status: value("rmAbsenceStatus"),
      startDate: value("rmAbsenceStart"),
      endDate: value("rmAbsenceEnd"),
      hoursPerDay: Number(value("rmAbsenceHours")),
      notes: value("rmAbsenceNotes"),
      approvedAt: value("rmAbsenceStatus") === "Approved" ? existing.approvedAt || now : "",
      updatedAt: now,
      createdAt: existing.createdAt || now
    };
    if (index >= 0) rows[index] = item;
    else rows.push(item);
    if (!(await saved(PPMPlanning.saveAbsences(rows)))) return;

    closeModal("rmAbsenceModal");
    renderAvailability();
    window.dispatchEvent(new CustomEvent("ppm-resource-absence-changed"));
  }

  function openCapacity() {
    const config = PPMPlanning.getResourceConfig();
    setValue("rmUnderThreshold", config.underUtilisationThreshold);
    setValue("rmWarningThreshold", config.warningThreshold);
    setValue("rmOverThreshold", config.overAllocationThreshold);
    field("rmIncludeProvisional").checked = Boolean(config.includeProvisionalInCapacity);
    showAlert("rmCapacityAlert", "");
    openModal("rmCapacityModal");
  }

  async function saveCapacityForm(event) {
    event.preventDefault();
    const under = Number(value("rmUnderThreshold"));
    const warning = Number(value("rmWarningThreshold"));
    const over = Number(value("rmOverThreshold"));
    if (!(under < warning && warning <= over)) {
      showAlert(
        "rmCapacityAlert",
        "Thresholds must increase from under-utilisation to warning and then over-allocation."
      );
      return;
    }
    if (!(await saved(PPMPlanning.saveResourceConfig({
      ...PPMPlanning.getResourceConfig(),
      underUtilisationThreshold: under,
      warningThreshold: warning,
      overAllocationThreshold: over,
      includeProvisionalInCapacity: field("rmIncludeProvisional").checked
    })))
    )
      return;
    closeModal("rmCapacityModal");
    renderActivePanel();
  }

  function renderScenarios() {
    const rows = PPMPlanning.getScenarios()
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    field("rmScenariosBody").innerHTML = rows.length
      ? `<div class="rm-table-wrap"><table class="rm-table"><thead><tr><th>Scenario</th>
<th>Visibility</th>
<th>Status</th>
<th>Demand items</th>
<th>Changes from live</th>
<th>Updated</th>
<th>Actions</th></tr></thead><tbody>${rows
          .map((scenario) => {
            const changes = scenarioChanges(scenario);
            const editable = scenario.status === "Draft";
            return `<tr><td class="rm-strong">${escapeHtml(scenario.name)}<div class="rm-muted">${escapeHtml(scenario.notes || "No notes")}</div></td>
<td>${escapeHtml(scenario.visibility)}</td>
<td><span class="rm-badge ${statusClass(scenario.status)}">${escapeHtml(scenario.status)}</span></td>
<td>${(scenario.demands || []).length}</td>
<td>${changes.length}</td>
<td>${scenario.updatedAt ? new Date(scenario.updatedAt).toLocaleString("en-GB") : "Not recorded"}</td>
<td><div class="rm-actions"><button type="button" class="button light small rm-compare-scenario" data-scenario-id="${scenario.scenarioId}">Compare</button>${editable ? `<button type="button" class="button light small rm-adjust-scenario" data-scenario-id="${scenario.scenarioId}">Adjust</button><button type="button" class="button small rm-publish-scenario" data-permission="resourceManagement.publishScenario" data-scenario-id="${scenario.scenarioId}">Publish</button><button type="button" class="button danger small rm-reject-scenario" data-permission="resourceManagement.publishScenario" data-scenario-id="${scenario.scenarioId}">Reject</button>` : ""}</div></td></tr>`;
          })
          .join("")}</tbody></table></div><div id="rmScenarioComparison"></div>`
      : '<div class="rm-empty">No resource scenarios have been created. A scenario is isolated from live demand until it is published.</div>';
    document
      .querySelectorAll(".rm-compare-scenario")
      .forEach((button) =>
        button.addEventListener("click", () => compareScenario(button.dataset.scenarioId))
      );
    document
      .querySelectorAll(".rm-adjust-scenario")
      .forEach((button) =>
        button.addEventListener("click", () => openScenarioAdjust(button.dataset.scenarioId))
      );
    document
      .querySelectorAll(".rm-publish-scenario")
      .forEach((button) =>
        button.addEventListener("click", () =>
          confirmAction(
            "Publish scenario",
            "Publishing will atomically apply this scenario to the demand records it snapshotted. Demand created later is left untouched. Continue?",
            () => publishScenario(button.dataset.scenarioId)
          )
        )
      );
    document
      .querySelectorAll(".rm-reject-scenario")
      .forEach((button) =>
        button.addEventListener("click", () =>
          confirmAction(
            "Reject scenario",
            "The scenario will remain in history as Rejected and will not affect live demand. Continue?",
            () => rejectScenario(button.dataset.scenarioId)
          )
        )
      );
  }

  function scenarioChanges(scenario) {
    const live = new Map(PPMPlanning.getDemand().map((item) => [item.demandId, item]));
    return (scenario.demands || []).filter((item) => {
      const original = live.get(item.demandId);
      return (
        !original ||
        ["resourceId", "startDate", "endDate", "allocationPercentage", "hours", "status"].some(
          (key) => String(original[key] ?? "") !== String(item[key] ?? "")
        )
      );
    });
  }

  function compareScenario(id) {
    const scenario = PPMPlanning.getScenarios().find((item) => item.scenarioId === id);
    if (!scenario) return;
    const changes = scenarioChanges(scenario);
    const container = field("rmScenarioComparison");
    container.innerHTML = `<div class="rm-compare"><h4>Live versus ${escapeHtml(scenario.name)}</h4>${
      changes.length
        ? `<div class="rm-table-wrap"><table class="rm-table"><thead><tr><th>Demand</th>
<th>Live dates</th>
<th>Scenario dates</th>
<th>Live resource / allocation</th>
<th>Scenario resource / allocation</th></tr></thead><tbody>${changes
            .map((item) => {
              const live = PPMPlanning.getDemand().find((row) => row.demandId === item.demandId) || {};
              return `<tr><td>${escapeHtml(item.demandId)}<div class="rm-muted">${escapeHtml(item.projectCode)} · ${escapeHtml(item.roleSkill)}</div></td>
<td>${fmtDate(live.startDate)} to ${fmtDate(live.endDate)}</td>
<td>${fmtDate(item.startDate)} to ${fmtDate(item.endDate)}</td>
<td>${escapeHtml(nameForResource(live.resourceId))} · ${live.allocationMethod === "Hours" ? fmtHours(live.hours) : `${Number(live.allocationPercentage || 0)}%`}</td>
<td>${escapeHtml(nameForResource(item.resourceId))} · ${item.allocationMethod === "Hours" ? fmtHours(item.hours) : `${Number(item.allocationPercentage || 0)}%`}</td></tr>`;
            })
            .join("")}</tbody></table></div>`
        : '<div class="rm-empty">This scenario currently matches live demand.</div>'
    }</div>`;
    container.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function saveScenarioForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('[type="submit"]');
    const originalLabel = submitButton?.textContent || "Create scenario";
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Saving…";
    }
    try {
      const databaseWorkflow = databaseResourceWorkflowEnabled();
      const liveDemand = PPMPlanning.getDemand().map(cleanScenarioDemand);
      const sourceDemandVersions = databaseWorkflow
        ? await PPMChildDatabase.resourceDemandVersionSnapshot()
        : {};
      const rows = PPMPlanning.getScenarios();
      const now = new Date().toISOString();
      const scenario = {
        scenarioId: PPMPlanning.uid("SCN"),
        name: value("rmScenarioName"),
        visibility: value("rmScenarioVisibility"),
        notes: value("rmScenarioNotes"),
        status: "Draft",
        demands: liveDemand,
        sourceDemandVersions,
        snapshotCreatedAt: now,
        createdAt: now,
        updatedAt: now,
        audit: [{ action: "Created", at: now, by: "Resource planning team" }]
      };
      rows.push(scenario);
      /*
        Awaited, and the answer looked at.

        This was `PPMPlanning.saveScenarios(rows);` with no await and no check - a write whose
        failure went nowhere. The guard below made it look handled: it called flush() and then
        asked whether anything was pending. flush() had been a no-op since the write-through was
        deleted, and even before that the save had not been awaited, so "pending" was read before
        the write had had a chance to finish or fail. Two mechanisms, neither working, reading as
        a safeguard.
      */
      const savedScenario = await PPMPlanning.saveScenarios(rows);
      if (!savedScenario.ok) {
        throw new Error(savedScenario.message || "The scenario could not be saved.");
      }

      closeModal("rmScenarioModal");
      renderScenarios();

    } catch (error) {
      showMessage(error?.message || String(error), "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    }
  }

  function openScenarioAdjust(id) {
    activeScenarioId = id;
    const scenario = PPMPlanning.getScenarios().find((item) => item.scenarioId === id);
    if (!scenario) return;
    field("rmScenarioDemand").innerHTML =
      option("", "Select demand", true) +
      (scenario.demands || [])
        .map((item) =>
          option(
            item.demandId,
            `${item.demandId} — ${item.projectCode || "No project"} — ${item.roleSkill || "Demand"}`,
            false
          )
        )
        .join("");
    field("rmScenarioResource").innerHTML = resourceOptions("", "Generic / unfilled demand");
    setValue("rmScenarioStart", "");
    setValue("rmScenarioEnd", "");
    setValue("rmScenarioAllocation", "");
    setValue("rmScenarioHours", "");
    openModal("rmScenarioAdjustModal");
  }

  function loadScenarioDemand() {
    const scenario = PPMPlanning.getScenarios().find((item) => item.scenarioId === activeScenarioId);
    const item = scenario?.demands?.find((row) => row.demandId === value("rmScenarioDemand"));
    if (!item) return;
    field("rmScenarioResource").innerHTML = resourceOptions(item.resourceId, "Generic / unfilled demand");
    setValue("rmScenarioResource", item.resourceId || "");
    setValue("rmScenarioStart", item.startDate);
    setValue("rmScenarioEnd", item.endDate);
    setValue("rmScenarioAllocation", item.allocationPercentage || 0);
    setValue("rmScenarioHours", item.hours || 0);
  }

  async function saveScenarioAdjustment(event) {
    event.preventDefault();
    const scenarios = PPMPlanning.getScenarios();
    const scenario = scenarios.find((item) => item.scenarioId === activeScenarioId);
    const item = scenario?.demands?.find((row) => row.demandId === value("rmScenarioDemand"));
    if (!item) return;
    item.resourceId = value("rmScenarioResource");
    item.startDate = value("rmScenarioStart");
    item.endDate = value("rmScenarioEnd");
    item.allocationPercentage = Number(value("rmScenarioAllocation"));
    item.hours = Number(value("rmScenarioHours"));
    item.normalisedHours =
      Math.round(PPMPlanning.normalisedDemandHours(item, resourceById(item.resourceId) || {}) * 10) / 10;
    scenario.updatedAt = new Date().toISOString();
    scenario.audit = [
      ...(scenario.audit || []),
      { action: `Adjusted ${item.demandId}`, at: scenario.updatedAt, by: "Resource planning team" }
    ];
    if (!(await saved(PPMPlanning.saveScenarios(scenarios)))) return;
    closeModal("rmScenarioAdjustModal");
    renderScenarios();
    compareScenario(activeScenarioId);
  }

  /*
    Stage 16: every planning write returns { ok, reason, message } instead of the value. This
    unwraps it in one place - showing the reason and answering false - so the eight call sites
    below stay readable and none of them can quietly skip the check.
  */
  async function saved(promise) {
    const result = await promise;
    if (!result || result.ok !== false) return true;
    showMessage(
      result.queued ? `${result.message} It is saved on this computer and will be retried.` : result.message,
      result.queued ? "warning" : "error"
    );
    return false;
  }

  /*
    Publishing turns a scenario's demand into live demand, in one transaction.

    WHAT THIS LOOKED LIKE BEFORE, AND WHY IT WAS WRONG

    The Stage 17 note that used to sit here said "no fallback: the else-branch wrote rows the
    database refuses through private.guard_resource_scenario_workflow_write, and the refusal was
    swallowed by the write seam - so a scenario appeared published and was not". The note was
    correct and the else-branch was still there, three copies of the guard above it, and the
    result of the workflow call assigned to a variable nobody read.

    Unreachable rather than harmful - the guard returns before it - but a comment claiming a
    deletion that had not happened is worse than either, because the next person reads the comment.

    The workflow function throws on every failure it can detect, which is why there is no result
    to check: the catch below is the whole error path.
  */
  async function publishScenario(id) {
    const scenario = PPMPlanning.getScenarios().find((item) => item.scenarioId === id);
    if (!scenario) return;

    if (!databaseResourceWorkflowEnabled()) {
      showMessage(
        "The resource scenario workflow is unavailable, so this cannot be recorded. Reload " +
          "the page; if it persists, the database connection or your sign-in has been lost.",
        "error"
      );
      return;
    }

    try {
      await PPMChildDatabase.commitResourceScenarioWorkflow({ operation: "publish", scenario });
      renderScenarios();
      renderDemand();
      showMessage("The resource scenario was published successfully.", "success");
    } catch (error) {
      showMessage(error?.message || String(error), "error");
    }
  }

  /* Rejecting is the same shape: one transactional call, no local fallback. */
  async function rejectScenario(id) {
    const scenario = PPMPlanning.getScenarios().find((item) => item.scenarioId === id);
    if (!scenario) return;

    if (!databaseResourceWorkflowEnabled()) {
      showMessage(
        "The resource scenario workflow is unavailable, so this cannot be recorded. Reload " +
          "the page; if it persists, the database connection or your sign-in has been lost.",
        "error"
      );
      return;
    }

    try {
      await PPMChildDatabase.commitResourceScenarioWorkflow({ operation: "reject", scenario });
      renderScenarios();
      showMessage("The resource scenario was rejected.", "success");
    } catch (error) {
      showMessage(error?.message || String(error), "error");
    }
  }

  function confirmAction(title, message, action) {
    field("rmConfirmTitle").textContent = title;
    field("rmConfirmText").textContent = message;
    confirmationAction = action;
    openModal("rmConfirmModal");
  }

  function bindEvents() {
    document
      .querySelectorAll(".rm-feature-tab")
      .forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.rmTab)));
    document
      .querySelectorAll("[data-rm-close]")
      .forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.rmClose)));
    document.querySelectorAll(".rm-modal-backdrop").forEach((modal) =>
      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal(modal.id);
      })
    );
    field("rmAddDemand").addEventListener("click", () => openDemand(""));
    field("rmDemandProject").addEventListener("change", () => populateDemandTasks(""));
    field("rmDemandMethod").addEventListener("change", updateDemandMethod);
    field("rmDemandForm").addEventListener("submit", saveDemandForm);
    field("rmAddAbsence").addEventListener("click", () => openAbsence(""));
    field("rmAbsenceForm").addEventListener("submit", saveAbsenceForm);
    field("rmConfigureCapacity").addEventListener("click", openCapacity);
    field("rmCapacityForm").addEventListener("submit", saveCapacityForm);
    field("rmAddScenario").addEventListener("click", () => {
      field("rmScenarioForm").reset();
      openModal("rmScenarioModal");
    });
    field("rmScenarioForm").addEventListener("submit", saveScenarioForm);
    field("rmScenarioDemand").addEventListener("change", loadScenarioDemand);
    field("rmScenarioAdjustForm").addEventListener("submit", saveScenarioAdjustment);
    field("rmConfirmAction").addEventListener("click", () => {
      const action = confirmationAction;
      confirmationAction = null;
      closeModal("rmConfirmModal");
      if (action) action();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const modal = [...document.querySelectorAll(".rm-modal-backdrop.visible")].pop();
        if (modal) closeModal(modal.id);
      }
    });
  }

  window.PPMResourceFeatureConfirm = confirmAction;
  injectInterface();
  bindEvents();
  const notificationParameters = new URLSearchParams(window.location.search);
  const requestedView = notificationParameters.get("view") || "";
  const requestedItem = notificationParameters.get("item") || "";
  if (
    [
      "heatmap",
      "capacity",
      "utilisation",
      "skills",
      "runway",
      "demand",
      "scenarios",
      "availability"
    ].includes(requestedView)
  ) {
    requestAnimationFrame(() => {
      switchTab(requestedView);
      if (
        requestedView === "demand" &&
        requestedItem &&
        PPMPlanning.getDemand().some((item) => item.demandId === requestedItem)
      )
        openDemand(requestedItem);
      if (
        requestedView === "availability" &&
        requestedItem &&
        PPMPlanning.getAbsences().some((item) => item.absenceId === requestedItem)
      )
        openAbsence(requestedItem);
    });
  }
})();
