"use strict";
const parameters = new URLSearchParams(window.location.search);
const requestedProject = parameters.get("project") || parameters.get("code") || "";
let pendingFocus = parameters.get("gate") || parameters.get("item") || "";
let projects = [];
let resources = [];
let gates = [];
let dirtyIds = new Set();
let activeGateId = "";
let pendingWorkflow = null;
let pendingDeleteId = "";

const escapeHtml = PPMCore.escapeHtml;
function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}
function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function projectFor(code) {
  return (
    projects.find(
      (project) => String(project.projectCode).toLowerCase() === String(code || "").toLowerCase()
    ) || null
  );
}
function gateFor(id) {
  return gates.find((gate) => gate.gateId === id) || null;
}
function isArchived(project) {
  return Boolean(project && (project.archived || project.isArchived || project.projectStatus === "Archived"));
}
function isEditable(gate) {
  const routePending =
    gate.routeRequirement === "Not Applicable" &&
    gate.routeApprovalStatus === "Pending" &&
    Boolean(gate.routeRequestedAt);
  return (
    ["Draft", "Deferred", "Rejected"].includes(gate.workflowStatus) &&
    !routePending &&
    PPMStageGates.canEdit(gate.projectCode) &&
    !isArchived(projectFor(gate.projectCode))
  );
}
function setMessage(text, type) {
  const message = document.getElementById("pageMessage");
  message.textContent = text;
  message.className = `message ${type}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function clearMessage() {
  document.getElementById("pageMessage").className = "message";
}
function setDirty(id) {
  if (id) dirtyIds.add(id);
  const dirty = dirtyIds.size > 0;
  const button = document.getElementById("saveChangesButton"),
    indicator = document.getElementById("unsavedIndicator");
  button.disabled = !dirty;
  button.textContent = dirty ? `Save changes (${dirtyIds.size})` : "Saved";
  indicator.textContent = dirty
    ? `${dirtyIds.size} unsaved stage gate${dirtyIds.size === 1 ? "" : "s"}`
    : "All changes saved";
  indicator.classList.toggle("dirty", dirty);
}
function statusClass(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll(" ", "-");
}
function badge(value, extra) {
  return `<span class="badge ${extra || statusClass(value)}">${escapeHtml(value || "Not set")}</span>`;
}
function personName(resourceId, fallback) {
  return PPMResources.findResource(resourceId, fallback)?.fullName || fallback || "Not assigned";
}
function projectOptions(selected, editable) {
  return (
    '<option value="">Select project</option>' +
    projects
      .slice()
      .sort((a, b) => String(a.projectCode).localeCompare(String(b.projectCode)))
      .map(
        (project) =>
          `<option value="${escapeHtml(project.projectCode)}" ${project.projectCode === selected ? "selected" : ""} ${(!PPMStageGates.canEdit(project.projectCode) || isArchived(project)) && project.projectCode !== selected ? "disabled" : ""}>${escapeHtml(project.projectCode)} - ${escapeHtml(project.projectName || "Unnamed project")}${isArchived(project) ? " (Archived)" : ""}</option>`
      )
      .join("")
  );
}
function stageOptions(selected, projectCode) {
  const stages = PPMStageGates.getStageOrder(projectCode);
  if (selected && !stages.includes(selected)) stages.push(selected);
  return [
    '<option value="">Select stage</option>',
    ...stages.map((stage) => `<option ${stage === selected ? "selected" : ""}>${escapeHtml(stage)}</option>`)
  ].join("");
}
function routeOptions(selected) {
  return PPMStageGates.ROUTE_REQUIREMENTS.map(
    (route) => `<option ${route === selected ? "selected" : ""}>${escapeHtml(route)}</option>`
  ).join("");
}
function approverMarkup(gate) {
  if (!gate.requiredApprovers.length) return '<span class="row-note">No required approvers selected.</span>';
  return `<div class="approver-list">${gate.requiredApprovers.map((person) => `<strong>${escapeHtml(person.name || person.resourceId)}</strong><span>${person.decision ? `${escapeHtml(person.decision)}${person.decidedAt ? ` · ${new Date(person.decidedAt).toLocaleDateString("en-GB")}` : ""}` : "Awaiting decision"}</span>`).join("")}</div>`;
}
function loadData() {
  /* Stage 16: from PPMStore. filterProjects stays - it applies this person's own project-access
     list, which is narrower than what RLS already returned. */
  projects = PPMAuth.filterProjects(PPMStore.projects.all(), PPMAuth.getCurrentUser());
  resources = PPMResources.ensureLegacyResources().filter(
    (item) => item.active !== false && item.resourceKind !== "Generic placeholder"
  );
  gates = PPMStageGates.getAll();
  dirtyIds.clear();
  setDirty();
}
function filteredGates() {
  const search = document.getElementById("gateSearch").value.trim().toLowerCase(),
    project = document.getElementById("projectFilter").value,
    status = document.getElementById("statusFilter").value,
    route = document.getElementById("routeFilter").value;
  return gates.filter((gate) => {
    const text = [
      gate.gateId,
      gate.gateName,
      gate.projectCode,
      gate.projectName,
      gate.submissionOwner,
      ...gate.requiredApprovers.map((item) => `${item.name} ${item.email}`),
      gate.workflowStatus,
      gate.routeReason
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!search || text.includes(search)) &&
      (!project || gate.projectCode === project) &&
      (!status || gate.workflowStatus === status) &&
      (!route || gate.routeRequirement === route)
    );
  });
}
function renderFilters() {
  const projectSelect = document.getElementById("projectFilter"),
    currentProject = projectSelect.value || requestedProject;
  projectSelect.innerHTML =
    '<option value="">All projects</option>' +
    projects
      .map(
        (project) =>
          `<option value="${escapeHtml(project.projectCode)}">${escapeHtml(project.projectCode)} - ${escapeHtml(project.projectName || "Unnamed project")}</option>`
      )
      .join("");
  projectSelect.value = projects.some((item) => item.projectCode === currentProject) ? currentProject : "";
  const statusSelect = document.getElementById("statusFilter"),
    currentStatus = statusSelect.value;
  statusSelect.innerHTML =
    '<option value="">All workflow statuses</option>' +
    PPMStageGates.STATUSES.map((status) => `<option>${escapeHtml(status)}</option>`).join("");
  statusSelect.value = currentStatus;
}
function renderTable() {
  const rows = filteredGates();
  document.getElementById("gateBody").innerHTML =
    rows
      .map((gate) => {
        const editable = isEditable(gate),
          routeMeta =
            gate.routeRequirement === "Not Applicable"
              ? badge(
                  gate.routeApprovalStatus,
                  gate.routeApprovalStatus === "Approved"
                    ? "route-approved"
                    : statusClass(gate.routeApprovalStatus)
                )
              : "";
        return `<tr data-gate-id="${escapeHtml(gate.gateId)}" class="${dirtyIds.has(gate.gateId) ? "dirty-row" : ""} ${editable ? "" : "locked-row"}">
      <td class="gate-id-cell"><input value="${escapeHtml(gate.gateId)}" readonly aria-label="Gate ID"><span class="row-note">${escapeHtml(gate.programmeName || "No programme")} · v${Number(gate.revision || gate.version || 1)}</span></td>
      <td><select class="inline-field" data-field="projectCode" data-id="${escapeHtml(gate.gateId)}" ${editable ? "" : "disabled"}>${projectOptions(gate.projectCode, editable)}</select><span class="row-note">${escapeHtml(gate.projectName || "")}</span></td>
      <td><input class="inline-field" data-field="gateName" data-id="${escapeHtml(gate.gateId)}" value="${escapeHtml(gate.gateName)}" maxlength="180" ${editable ? "" : "disabled"}></td>
      <td><select class="inline-field" data-field="routeRequirement" data-id="${escapeHtml(gate.gateId)}" ${editable ? "" : "disabled"}>${routeOptions(gate.routeRequirement)}</select>${routeMeta}</td>
      <td><select class="inline-field" data-field="currentStage" data-id="${escapeHtml(gate.gateId)}" ${editable ? "" : "disabled"}>${stageOptions(gate.currentStage, gate.projectCode)}</select></td>
      <td><select class="inline-field" data-field="proposedNextStage" data-id="${escapeHtml(gate.gateId)}" ${editable && gate.routeRequirement !== "Not Applicable" ? "" : "disabled"}>${stageOptions(gate.proposedNextStage, gate.projectCode)}</select></td>
      <td><select class="person-field" data-person-field="submissionOwner" data-id="${escapeHtml(gate.gateId)}" ${editable ? "" : "disabled"}></select></td>
      <td>${approverMarkup(gate)}<button type="button" class="button light small detail-row" data-id="${escapeHtml(gate.gateId)}">View reviewers</button></td>
      <td><input class="inline-field" data-field="submissionDate" data-id="${escapeHtml(gate.gateId)}" type="date" value="${escapeHtml(gate.submissionDate)}" ${editable ? "" : "disabled"}></td>
      <td><input class="inline-field" data-field="meetingDate" data-id="${escapeHtml(gate.gateId)}" type="date" value="${escapeHtml(gate.meetingDate)}" ${editable ? "" : "disabled"}></td>
      <td>${badge(gate.workflowStatus)}<span class="row-note">${gate.completionDate ? `Completed ${escapeHtml(gate.completionDate)}` : gate.decisionDate ? `Decision ${escapeHtml(gate.decisionDate)}` : "No decision recorded"}</span></td>
      <td class="actions-cell"><div class="button-row"><button type="button" class="button light small detail-row" data-id="${escapeHtml(gate.gateId)}">Gate details</button><button type="button" class="button danger small delete-row" data-permission="stageGates.submit" data-id="${escapeHtml(gate.gateId)}" ${isEditable(gate) ? "" : "disabled"}>Delete</button></div><span class="row-note">Workflow actions are available in Gate details.</span></td>
    </tr>`;
      })
      .join("") +
    `<tr class="add-row"><td colspan="12"><button type="button" class="add-row-button" data-permission="stageGates.submit">+ Add stage-gate row</button></td></tr>`;
  document.getElementById("emptyState").style.display = rows.length ? "none" : "block";
  populateTablePeople();
  attachTableEvents();
  renderSummary();
  focusRequested();
}
function populateTablePeople() {
  document.querySelectorAll(".person-field").forEach((select) => {
    const gate = gateFor(select.dataset.id),
      field = select.dataset.personField;
    PPMResources.populatePersonSelect(select, {
      selectedResourceId: gate[`${field}ResourceId`],
      legacyName: gate[field],
      blankLabel: "Select submission owner",
      allowCreate: true
    });
    if (!isEditable(gate)) select.disabled = true;
  });
}
function attachTableEvents() {
  document.querySelectorAll(".inline-field").forEach((field) => {
    if (field.disabled || field.readOnly) return;
    field.addEventListener(
      field.tagName === "SELECT" || field.type === "date" ? "change" : "input",
      handleInlineChange
    );
  });
  document.querySelectorAll(".person-field").forEach((field) => {
    if (!field.disabled) field.addEventListener("change", handlePersonChange);
  });
  document
    .querySelectorAll(".detail-row")
    .forEach((button) => button.addEventListener("click", () => openDetails(button.dataset.id)));
  document
    .querySelectorAll(".delete-row")
    .forEach((button) => button.addEventListener("click", () => openDelete(button.dataset.id)));
  document.querySelectorAll(".add-row-button").forEach((button) => button.addEventListener("click", addGate));
}
function handleInlineChange(event) {
  const field = event.currentTarget,
    gate = gateFor(field.dataset.id);
  if (!gate) return;
  const key = field.dataset.field;
  gate[key] = field.value;
  if (key === "projectCode") {
    const project = projectFor(field.value);
    if (project) {
      gate.projectName = project.projectName || "";
      gate.programmeId = project.programmeId || "";
      gate.programmeName = project.programme || project.workstream || "";
      gate.currentStage = project.currentStage || PPMStageGates.getStageOrder(project)[0];
      gate.proposedNextStage = PPMStageGates.nextStage(gate.currentStage, project);
      if (!gate.submissionOwnerResourceId) {
        gate.submissionOwner = project.projectManager || "";
        gate.submissionOwnerResourceId = project.projectManagerResourceId || "";
        gate.submissionOwnerEmail = project.projectManagerEmail || "";
      }
    }
  }
  if (key === "routeRequirement") {
    if (field.value !== "Not Applicable") {
      gate.routeApprovalStatus = "Not Required";
      gate.routeApprover = "";
      gate.routeApproverResourceId = "";
      gate.routeApproverEmail = "";
    } else gate.routeApprovalStatus = "Not Requested";
  }
  gate.updatedAt = new Date().toISOString();
  setDirty(gate.gateId);
  clearMessage();
  if (key === "projectCode" || key === "routeRequirement") renderTable();
}
function handlePersonChange(event) {
  const select = event.currentTarget;
  if (select.value === "__ppm_create_person__") return;
  const gate = gateFor(select.dataset.id),
    field = select.dataset.personField,
    person = PPMResources.getSelectedPerson(select);
  gate[field] = person.name;
  gate[`${field}ResourceId`] = person.resourceId;
  gate[`${field}Email`] = person.email;
  setDirty(gate.gateId);
  clearMessage();
}
function uniqueGateId(id) {
  const match = String(id).match(/^(.*?)(\d+)$/);
  if (!match) return `${id}-${Date.now()}`;
  let number = Number(match[2]),
    candidate = id;
  const width = match[2].length;
  while (gates.some((gate) => gate.gateId === candidate)) {
    number += 1;
    candidate = `${match[1]}${String(number).padStart(width, "0")}`;
  }
  return candidate;
}
function addGate() {
  const filteredProject = document.getElementById("projectFilter").value || requestedProject;
  const project =
    projectFor(filteredProject) &&
    PPMStageGates.canEdit(filteredProject) &&
    !isArchived(projectFor(filteredProject))
      ? projectFor(filteredProject)
      : projects.find((item) => PPMStageGates.canEdit(item.projectCode) && !isArchived(item));
  if (!project) {
    setMessage("No editable active project is available for a new stage gate.", "error");
    return;
  }
  try {
    const gate = PPMStageGates.newGate(project.projectCode);
    gate.gateId = uniqueGateId(gate.gateId);
    gates.push(gate);
    setDirty(gate.gateId);
    document.getElementById("gateSearch").value = "";
    renderFilters();
    renderTable();
    requestAnimationFrame(() => {
      const row = document.querySelector(`[data-gate-id="${CSS.escape(gate.gateId)}"]`);
      row?.scrollIntoView({ block: "center", inline: "start" });
      row?.querySelector('[data-field="gateName"]')?.focus();
    });
  } catch (error) {
    setMessage(error.message, "error");
  }
}
async function saveOne(id) {
  const gate = gateFor(id);
  if (!gate) return null;
  /* Stage 16: awaited. Nothing below runs unless the database accepted the gate. */
  const saved = await PPMStageGates.save(gate);
  const index = gates.findIndex((item) => item.gateId === id);
  gates[index] = saved;
  dirtyIds.delete(id);
  setDirty();
  return saved;
}
function saveChanges() {
  if (!dirtyIds.size) return;
  const ids = [...dirtyIds];
  try {
    ids.forEach(saveOne);
    loadData();
    renderFilters();
    renderTable();
    setMessage(`${ids.length} stage gate${ids.length === 1 ? "" : "s"} saved.`, "success");
  } catch (error) {
    setMessage(error.message, "error");
    renderTable();
  }
}
async function persistActiveDetails() {
  if (!activeGateId) return null;
  applyDetails(false);
  return dirtyIds.has(activeGateId) ? await saveOne(activeGateId) : gateFor(activeGateId);
}
function renderSummary() {
  const rows = filteredGates(),
    pending = PPMStageGates.getPendingForUser(),
    awaiting = rows.filter(
      (gate) =>
        ["Submitted", "Conditionally Approved"].includes(gate.workflowStatus) ||
        (gate.routeRequirement === "Not Applicable" &&
          gate.routeApprovalStatus === "Pending" &&
          gate.routeRequestedAt)
    );
  document.getElementById("totalGates").textContent = rows.length;
  document.getElementById("myApprovals").textContent = pending.length;
  document.getElementById("submittedGates").textContent = awaiting.length;
  document.getElementById("approvedGates").textContent = rows.filter(
    (gate) => gate.workflowStatus === "Approved"
  ).length;
  document.getElementById("overdueGates").textContent = awaiting.filter(
    (gate) => gate.meetingDate && gate.meetingDate < today()
  ).length;
}
function focusRequested() {
  if (!pendingFocus) return;
  const row = document.querySelector(`[data-gate-id="${CSS.escape(pendingFocus)}"]`);
  if (!row) return;
  pendingFocus = "";
  row.classList.add("target-row");
  requestAnimationFrame(() => row.scrollIntoView({ block: "center", inline: "start" }));
}

function documentsText(gate) {
  return gate.supportingDocuments
    .map((item) => (item.url ? `${item.title || item.url} | ${item.url}` : item.title))
    .join("\n");
}
function actionsText(gate) {
  return gate.actionsArising.map((item) => item.description).join("\n");
}
function populatePerson(selectId, resourceId, name, label, allowCreate = true) {
  PPMResources.populatePersonSelect(selectId, {
    selectedResourceId: resourceId,
    legacyName: name,
    blankLabel: label,
    allowCreate
  });
}
function resourceCan(resource, permission) {
  const override = resource?.permissionOverrides?.[permission];
  if (override === "allow") return true;
  if (override === "deny") return false;
  return Boolean(PPMAuth.roleDefinition(resource?.accessRole)?.permissions?.includes(permission));
}
function restrictRouteApprovers(selectedId) {
  const select = document.getElementById("detailRouteApprover");
  [...select.options].forEach((option) => {
    if (!option.value || option.value === "__ppm_create_person__") return;
    const resource = resources.find((item) => item.resourceId === option.value);
    option.disabled =
      option.value !== selectedId &&
      (!resource || resource.accountStatus !== "Active" || !resourceCan(resource, "stageGates.override"));
    if (option.disabled)
      option.textContent += option.textContent.includes("[No override access]")
        ? ""
        : " [No override access]";
  });
}
function renderApproverChecks(gate) {
  const selectedIds = new Set(gate.requiredApprovers.map((item) => item.resourceId));
  const eligible = resources.filter(
    (resource) =>
      selectedIds.has(resource.resourceId) ||
      (resource.accountStatus === "Active" && resourceCan(resource, "stageGates.approve"))
  );
  document.getElementById("approverChecks").innerHTML =
    eligible
      .slice()
      .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)))
      .map((resource) => {
        const selected = selectedIds.has(resource.resourceId),
          authorised = resource.accountStatus === "Active" && resourceCan(resource, "stageGates.approve");
        return `<label class="person-check"><input type="checkbox" value="${escapeHtml(resource.resourceId)}" ${selected ? "checked" : ""} ${authorised ? "" : "disabled"}><div><strong>${escapeHtml(resource.fullName || resource.resourceId)}</strong><br><span>${escapeHtml([resource.jobTitle || resource.role, resource.team, resource.email, !authorised ? "No active approval access" : ""].filter(Boolean).join(" · "))}</span></div></label>`;
      })
      .join("") ||
    '<div class="row-note">No active users with stage-gate approval permission are available.</div>';
}
function renderHistory(gate) {
  const entries = [
    ...(gate.submissionHistory || []).map((item) => ({
      title: `${item.submissionType || "Stage gate"} submitted · v${item.revision || item.version || 1}`,
      person: item.submittedBy,
      date: item.submittedAt,
      text:
        item.submissionComments ||
        `${item.currentStage || "Not set"} → ${item.proposedNextStage || "No progression"}`
    })),
    ...gate.decisionHistory.map((item) => {
      /* A decision taken with readiness items outstanding says so, permanently. That is the
         governance record the old behaviour destroyed by refusing instead. */
      const outstanding = Array.isArray(item.readinessOutstanding) ? item.readinessOutstanding : [];
      const note = outstanding.length
        ? `${outstanding.length} readiness item${outstanding.length === 1 ? "" : "s"} outstanding at the time: ${outstanding.join(", ")}.`
        : "";
      const said = item.comments || item.conditions || item.reason || "";
      return {
        title: `${item.decision}${item.revision ? ` · v${item.revision}` : ""}`,
        person: item.actorName,
        date: item.decidedAt,
        text: [said, note].filter(Boolean).join(" ")
      };
    }),
    ...gate.routeApprovalHistory.map((item) => ({
      title: `Route ${item.decision}`,
      person: item.actorName,
      date: item.decidedAt,
      text: item.comments
    }))
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  document.getElementById("approvalHistory").innerHTML = entries.length
    ? entries
        .map(
          (item) =>
            `<div class="history-item"><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.person || "Unknown user")} · ${item.date ? escapeHtml(new Date(item.date).toLocaleString("en-GB")) : "No date"}<br>${escapeHtml(item.text || "No comments supplied.")}</div>`
        )
        .join("")
    : '<div class="row-note">No submissions or approval decisions have been recorded.</div>';
}
function renderWorkflow(gate) {
  const actions = PPMStageGates.allowedTransitions(gate);
  const labels = {
    Draft: "Return to Draft",
    Submitted: "Submit gate",
    "Conditionally Approved": "Approve with conditions",
    Approved: "Approve",
    Deferred: "Defer",
    Rejected: "Reject",
    Cancelled: "Cancel gate"
  };
  const classes = {
    Approved: "success",
    "Conditionally Approved": "warning",
    Rejected: "danger",
    Deferred: "warning",
    Cancelled: "danger"
  };
  const approvalOutcomes = new Set(["Approved", "Conditionally Approved", "Deferred", "Rejected"]);
  /*
    Stage 18: a named approver's decision buttons carry no permission requirement.

    PPMAuth disables any control whose permission the person lacks, so tagging these
    stageGates.approve meant a named approver without that role saw four buttons and could press
    none of them. The greyed-out button was the reported symptom.

    Removing the tag loses nothing, because allowedTransitions() has already decided: a button
    only exists here if this person may take that action on this gate. The database re-checks
    every one of those rules anyway, which is what actually enforces them.
  */
  const namedApprover = PPMStageGates.isAssignedApprover(gate);
  let buttons = actions
    .map((status) => {
      const permission = approvalOutcomes.has(status)
        ? namedApprover
          ? "none"
          : "stageGates.approve"
        : "stageGates.submit";
      return `<button type="button" class="button small ${classes[status] || ""}" data-permission="${permission}" data-transition="${escapeHtml(status)}">${escapeHtml(labels[status])}</button>`;
    })
    .join("");
  if (gate.routeRequirement === "Not Applicable" && gate.workflowStatus === "Draft") {
    if (gate.routeApprovalStatus !== "Pending" || !gate.routeRequestedAt)
      buttons += `<button type="button" class="button small" data-permission="stageGates.submit" data-route-action="request">Request N/A approval</button>`;
    const actor = PPMAuth.getCurrentUser();
    if (
      gate.routeApprovalStatus === "Pending" &&
      gate.routeRequestedAt &&
      actor?.resourceId === gate.routeApproverResourceId &&
      PPMStageGates.canOverride(gate.projectCode)
    ) {
      buttons += `<button type="button" class="button success small" data-permission="stageGates.override" data-route-action="Approved">Approve N/A</button><button type="button" class="button danger small" data-permission="stageGates.override" data-route-action="Rejected">Reject N/A</button>`;
    }
  }
  /*
    Why there is nothing to do, rather than "your account cannot".

    The single message this replaced - "No workflow actions are available to your account for
    this record" - reads as a permission problem whatever the actual reason. On a Draft gate it
    sent somebody looking for the missing permission for half a day, when the honest answer was
    that nobody can approve a gate that has not been submitted yet.
  */
  const noActionReason = (() => {
    if (gate.workflowStatus === "Draft")
      return PPMStageGates.isAssignedApprover(gate)
        ? "You are a required approver on this gate, but it has not been submitted yet. " +
          "Nothing can be approved until the gate owner submits it."
        : "This gate is still a draft. It has to be submitted before anyone can decide it.";
    if (gate.workflowStatus === "Approved" || gate.workflowStatus === "Cancelled")
      return `This gate is ${String(gate.workflowStatus).toLowerCase()} and is now read-only.`;
    if (["Submitted", "Conditionally Approved"].includes(gate.workflowStatus)) {
      if (!PPMStageGates.isAssignedApprover(gate))
        return "Only the people named as required approvers on this gate can decide it. " +
          "You are not one of them.";
      return "You submitted or own this gate, so you cannot also decide it. " +
        "Another required approver has to.";
    }
    return "There is nothing to do on this gate from its current status.";
  })();

  document.getElementById("workflowActions").innerHTML =
    buttons || `<span class="row-note">${escapeHtml(noActionReason)}</span>`;
  document.getElementById("workflowGuidance").textContent =
    gate.workflowStatus === "Approved"
      ? `This gate advanced ${gate.projectCode} to ${gate.proposedNextStage}. The approved record is read-only.`
      : gate.workflowStatus === "Cancelled"
        ? "This gate is closed. A not-applicable approval or cancellation never changes the project stage."
        : gate.workflowStatus === "Submitted"
          ? "The submission is locked for editing while named approvers make their decisions."
          : gate.workflowStatus === "Conditionally Approved"
            ? "Conditions remain outstanding. The project stays at its current stage until all required approvers give final approval."
            : "Apply and save the details before using a workflow action.";
  document
    .querySelectorAll("[data-transition]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openWorkflow({ type: "transition", value: button.dataset.transition })
      )
    );
  document
    .querySelectorAll("[data-route-action]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openWorkflow({ type: "route", value: button.dataset.routeAction })
      )
    );
}
function openDetails(id) {
  const gate = gateFor(id);
  if (!gate) return;
  activeGateId = id;
  document.getElementById("detailTitle").textContent =
    `${gate.gateId} · v${gate.revision || gate.version || 1} · ${gate.gateName}`;
  document.getElementById("detailSubtitle").textContent =
    `${gate.projectCode} · ${gate.projectName || "Unnamed project"} · ${gate.currentStage} → ${gate.proposedNextStage || "No progression"}`;
  document.getElementById("detailSubmissionComments").value = gate.submissionComments;
  document.getElementById("detailDecisionDate").value = gate.decisionDate;
  document.getElementById("detailMeetingDate").value = gate.meetingDate;
  document.getElementById("detailDocuments").value = documentsText(gate);
  document.getElementById("detailRouteReason").value = gate.routeReason;
  document.getElementById("detailRouteComments").value = gate.routeApprovalComments;
  document.getElementById("detailApprovalComments").value = gate.approvalComments;
  document.getElementById("detailConditions").value = gate.conditions;
  document.getElementById("detailOutcomeReason").value = gate.rejectionDeferralReason;
  document.getElementById("detailDecisionSummary").value = gate.decisionSummary;
  document.getElementById("detailActions").value = actionsText(gate);
  document.getElementById("detailActionDueDate").value = gate.actionDueDate;
  populatePerson(
    "detailRouteApprover",
    gate.routeApproverResourceId,
    gate.routeApprover,
    "Select route approver"
  );
  restrictRouteApprovers(gate.routeApproverResourceId);
  populatePerson("detailActionOwner", gate.actionOwnerResourceId, gate.actionOwner, "Select action owner");
  renderApproverChecks(gate);
  document.getElementById("detailRouteStatus").innerHTML = badge(
    gate.routeApprovalStatus,
    gate.routeApprovalStatus === "Approved" ? "route-approved" : statusClass(gate.routeApprovalStatus)
  );
  document.getElementById("routeApprovalMeta").textContent = gate.routeApprovalDate
    ? `Decided ${gate.routeApprovalDate} by ${gate.routeApprover || "assigned approver"}`
    : gate.routeRequestedAt
      ? `Requested ${new Date(gate.routeRequestedAt).toLocaleDateString("en-GB")}`
      : "No route decision recorded.";
  document.getElementById("linkedRecords").innerHTML =
    `Decision: ${gate.linkedDecisionId ? `<a href="registers.html?tab=decisions&item=${encodeURIComponent(gate.linkedDecisionId)}">${escapeHtml(gate.linkedDecisionId)}</a>` : "Not created"} · Actions: ${gate.linkedActionIds.length ? gate.linkedActionIds.map((id) => `<a href="registers.html?tab=actions&item=${encodeURIComponent(id)}">${escapeHtml(id)}</a>`).join(", ") : "None created"}`;
  renderHistory(gate);
  renderWorkflow(gate);
  const editable = isEditable(gate);
  [
    "detailSubmissionComments",
    "detailDecisionDate",
    "detailMeetingDate",
    "detailDocuments",
    "detailRouteReason",
    "detailRouteApprover",
    "detailDecisionSummary",
    "detailActions",
    "detailActionOwner",
    "detailActionDueDate"
  ].forEach((id) => (document.getElementById(id).disabled = !editable));
  document.querySelectorAll("#approverChecks input").forEach((input) => (input.disabled = !editable));
  document.getElementById("applyDetailButton").style.display = editable ? "inline-flex" : "none";
  document.getElementById("detailReadOnlyNote").textContent = editable
    ? "Changes remain unsaved until you select Save changes."
    : `${gate.workflowStatus} records are read-only; assigned workflow actions remain available.`;
  document.getElementById("detailModal").classList.add("visible");
  document.body.style.overflow = "hidden";
}
function closeDetails() {
  activeGateId = "";
  document.getElementById("detailModal").classList.remove("visible");
  document.body.style.overflow = "";
}
function selectedPerson(selectId) {
  return PPMResources.getSelectedPerson(selectId);
}
function applyDetails(close = true) {
  const gate = gateFor(activeGateId);
  if (!gate || !isEditable(gate)) {
    if (close) closeDetails();
    return;
  }
  gate.submissionComments = document.getElementById("detailSubmissionComments").value.trim();
  gate.decisionDate = document.getElementById("detailDecisionDate").value;
  gate.meetingDate = document.getElementById("detailMeetingDate").value;
  gate.supportingDocuments = document.getElementById("detailDocuments").value.split(/\r?\n/).filter(Boolean);
  gate.routeReason = document.getElementById("detailRouteReason").value.trim();
  const routeApprover = selectedPerson("detailRouteApprover");
  gate.routeApprover = routeApprover.name;
  gate.routeApproverResourceId = routeApprover.resourceId;
  gate.routeApproverEmail = routeApprover.email;
  gate.decisionSummary = document.getElementById("detailDecisionSummary").value.trim();
  const actionOwner = selectedPerson("detailActionOwner");
  gate.actionOwner = actionOwner.name;
  gate.actionOwnerResourceId = actionOwner.resourceId;
  gate.actionOwnerEmail = actionOwner.email;
  gate.actionDueDate = document.getElementById("detailActionDueDate").value;
  const previousActions = new Map(gate.actionsArising.map((item) => [item.description, item]));
  gate.actionsArising = document
    .getElementById("detailActions")
    .value.split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map(
      (description) =>
        previousActions.get(description) || {
          description,
          owner: actionOwner.name,
          ownerResourceId: actionOwner.resourceId,
          ownerEmail: actionOwner.email,
          dueDate: gate.actionDueDate,
          actionId: ""
        }
    );
  const selectedIds = [...document.querySelectorAll("#approverChecks input:checked")].map(
    (input) => input.value
  );
  const previousApprovers = new Map(gate.requiredApprovers.map((item) => [item.resourceId, item]));
  gate.requiredApprovers = selectedIds.map(
    (id) =>
      previousApprovers.get(id) ||
      (() => {
        const resource = resources.find((item) => item.resourceId === id);
        return {
          resourceId: id,
          name: resource?.fullName || id,
          email: resource?.email || "",
          role: resource?.jobTitle || resource?.role || "",
          decision: "",
          decisionComments: "",
          decidedAt: ""
        };
      })()
  );
  gate.requiredApproverResourceIds = selectedIds;
  setDirty(gate.gateId);
  if (close) {
    closeDetails();
    renderTable();
    setMessage(`${gate.gateId} details were applied. Select Save changes to retain them.`, "warning");
  }
}

function workflowNeedsReason(item) {
  return (
    item.value === "Rejected" ||
    item.value === "Deferred" ||
    item.value === "Cancelled" ||
    (item.type === "route" && item.value === "Rejected")
  );
}
async function openWorkflow(item) {
  try {
    /* Awaited: a gate with unsaved detail changes must reach the database before the workflow
       is opened against it, or the transaction would be built from a state the database has
       not accepted. */
    await persistActiveDetails();
  } catch (error) {
    setMessage(error.message, "error");
    return;
  }
  pendingWorkflow = { ...item, gateId: activeGateId };
  const names = {
    Submitted: "Submit stage gate",
    Approved: item.type === "route" ? "Approve not-applicable route" : "Approve stage gate",
    "Conditionally Approved": "Approve with conditions",
    Deferred: "Defer stage gate",
    Rejected: item.type === "route" ? "Reject not-applicable route" : "Reject stage gate",
    Cancelled: "Cancel stage gate",
    Draft: "Return stage gate to Draft",
    request: "Request not-applicable approval"
  };
  document.getElementById("workflowDialogTitle").textContent = names[item.value] || "Confirm workflow action";
  document.getElementById("workflowDialogText").textContent =
    item.type === "route" && item.value === "request"
      ? "This sends the not-applicable reason to the assigned independent route approver. The project stage will not change."
      : item.value === "Approved" && item.type !== "route"
        ? "Your approval is retained against your account. The project moves stage only after every required approver gives final approval."
        : `Confirm the ${String(item.value).toLowerCase()} outcome. The project stage will not change unless final approval is complete.`;
  /*
    What the readiness rules say is outstanding, shown before the person commits.

    This used to be a refusal: submission and approval both threw when readiness was incomplete.
    The decision belongs to whoever is making it, so the tool now says what it knows and lets
    them proceed - and records what was outstanding on the decision itself.
  */
  const readinessNote = document.getElementById("workflowReadiness");
  if (readinessNote) {
    const gateNow = PPMStageGates.getAll().find((row) => row.gateId === activeGateId);
    const readiness = gateNow && item.type !== "route" ? PPMStageGates.readinessFor(gateNow) : { outstanding: [] };
    if (readiness.outstanding.length) {
      readinessNote.innerHTML =
        `<b>${readiness.outstanding.length} readiness item${readiness.outstanding.length === 1 ? " is" : "s are"} outstanding.</b> ` +
        `${escapeHtml(readiness.outstanding.join(", "))}.<br />` +
        `This does not prevent the action. It will be recorded against your decision.`;
      readinessNote.hidden = false;
    } else {
      readinessNote.textContent = "";
      readinessNote.hidden = true;
    }
  }
  document.getElementById("workflowComments").value = "";
  document.getElementById("workflowConditions").value = "";
  document.getElementById("workflowReason").value = "";
  document.getElementById("workflowDecisionDate").value = today();
  document.getElementById("workflowConditionsField").style.display =
    item.value === "Conditionally Approved" ? "block" : "none";
  document.getElementById("workflowReasonField").style.display = workflowNeedsReason(item) ? "block" : "none";
  document.getElementById("workflowCommentsField").style.display = item.value === "Draft" ? "none" : "block";
  document.getElementById("workflowDialog").classList.add("visible");
  document.getElementById("confirmWorkflowButton").focus();
}
function closeWorkflow() {
  pendingWorkflow = null;
  document.getElementById("workflowDialog").classList.remove("visible");
}
async function confirmWorkflow() {
  if (!pendingWorkflow) return;
  const item = pendingWorkflow,
    details = {
      comments: document.getElementById("workflowComments").value.trim(),
      conditions: document.getElementById("workflowConditions").value.trim(),
      reason: document.getElementById("workflowReason").value.trim(),
      decisionDate: document.getElementById("workflowDecisionDate").value
    };
  if (item.value === "Conditionally Approved" && !details.conditions) {
    document.getElementById("workflowConditions").focus();
    return;
  }
  if (workflowNeedsReason(item) && !details.reason) {
    document.getElementById("workflowReason").focus();
    return;
  }
  const confirmButton = document.getElementById("confirmWorkflowButton");
  confirmButton.disabled = true;
  const originalLabel = confirmButton.textContent;
  confirmButton.textContent = "Saving…";
  try {
    let gate;
    if (item.type === "route" && item.value === "request")
      gate = await PPMStageGates.requestRouteException(item.gateId);
    else if (item.type === "route")
      gate = await PPMStageGates.decideRouteException(item.gateId, item.value, details);
    else gate = await PPMStageGates.transition(item.gateId, item.value, details);
    closeWorkflow();
    closeDetails();
    loadData();
    renderFilters();
    renderTable();
    setMessage(
      `${gate.gateId} is now ${gate.workflowStatus}${gate.workflowStatus !== item.value && item.value === "Approved" ? `; it remains ${gate.workflowStatus.toLowerCase()} until the other required approvers give final approval` : ""}.`,
      "success"
    );
  } catch (error) {
    setMessage(error.message, "error");
    closeWorkflow();
    openDetails(item.gateId);
  } finally {
    confirmButton.disabled = false;
    confirmButton.textContent = originalLabel;
  }
}

function openDelete(id) {
  const gate = gateFor(id);
  if (!gate) return;
  pendingDeleteId = id;
  document.getElementById("deleteText").textContent =
    `Delete ${gate.gateId} (${gate.gateName})? The gate record will be removed and an audit event retained. Linked actions, decisions and any project-stage change will not be reversed.`;
  document.getElementById("deleteDialog").classList.add("visible");
  document.getElementById("cancelDeleteButton").focus();
}
function closeDelete() {
  pendingDeleteId = "";
  document.getElementById("deleteDialog").classList.remove("visible");
}
async function confirmDelete() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId,
    gate = gateFor(id);
  try {
    if (PPMStageGates.find(id)) await PPMStageGates.delete(id, gate.projectCode);
    gates = gates.filter((item) => item.gateId !== id);
    dirtyIds.delete(id);
    closeDelete();
    setDirty();
    renderFilters();
    renderTable();
    setMessage(`${id} was deleted. Linked records and project stage were not reversed.`, "success");
  } catch (error) {
    closeDelete();
    setMessage(error.message, "error");
  }
}

document.getElementById("gateSearch").addEventListener("input", renderTable);
document.getElementById("projectFilter").addEventListener("change", renderTable);
document.getElementById("statusFilter").addEventListener("change", renderTable);
document.getElementById("routeFilter").addEventListener("change", renderTable);
document.getElementById("addGateButton").addEventListener("click", addGate);
document.getElementById("saveChangesButton").addEventListener("click", saveChanges);
document.getElementById("closeDetailButton").addEventListener("click", closeDetails);
document.getElementById("cancelDetailButton").addEventListener("click", closeDetails);
document.getElementById("applyDetailButton").addEventListener("click", () => applyDetails(true));
document.getElementById("cancelWorkflowButton").addEventListener("click", closeWorkflow);
document.getElementById("confirmWorkflowButton").addEventListener("click", confirmWorkflow);
document.getElementById("cancelDeleteButton").addEventListener("click", closeDelete);
document.getElementById("confirmDeleteButton").addEventListener("click", confirmDelete);
document.getElementById("detailModal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDetails();
});
document.getElementById("workflowDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeWorkflow();
});
document.getElementById("deleteDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDelete();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.getElementById("workflowDialog").classList.contains("visible")) closeWorkflow();
  else if (document.getElementById("deleteDialog").classList.contains("visible")) closeDelete();
  else if (document.getElementById("detailModal").classList.contains("visible")) closeDetails();
});
window.addEventListener("beforeunload", (event) => {
  if (!dirtyIds.size) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("ppm-resource-created", () => {
  resources = PPMResources.getResources().filter(
    (item) => item.active !== false && item.resourceKind !== "Generic placeholder"
  );
  if (activeGateId) renderApproverChecks(gateFor(activeGateId));
});
loadData();
renderFilters();
renderTable();
