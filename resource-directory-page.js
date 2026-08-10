"use strict";

let resources = PPMResources.ensureLegacyResources();
let editingResourceId = null;

const escapeHtml = PPMCore.escapeHtml;

function showMessage(text, type) {
  const message = document.getElementById("pageMessage");
  message.textContent = text;
  message.className = `message ${type}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearMessage() {
  const message = document.getElementById("pageMessage");
  message.textContent = "";
  message.className = "message";
}

function getResource(resourceId) {
  return resources.find((resource) => resource.resourceId === resourceId) || null;
}

function managerName(resource) {
  const manager = getResource(resource.managerResourceId);
  return manager ? manager.fullName : "Not assigned";
}

function populateTeamFilter() {
  const current = document.getElementById("teamFilter").value;
  const filter = document.getElementById("teamFilter");
  filter.innerHTML = '<option value="">All teams</option>';
  [...new Set(resources.map((resource) => resource.team).filter(Boolean))].sort().forEach((team) => {
    const option = document.createElement("option");
    option.value = team;
    option.textContent = team;
    filter.appendChild(option);
  });
  if ([...filter.options].some((option) => option.value === current)) filter.value = current;
}

function filteredResources() {
  const search = document.getElementById("searchFilter").value.trim().toLowerCase();
  const team = document.getElementById("teamFilter").value;
  const status = document.getElementById("statusFilter").value;
  const accountStatus = document.getElementById("accountFilter").value;

  return resources
    .filter((resource) => {
      const searchable = [
        resource.resourceId,
        resource.fullName,
        resource.email,
        resource.team,
        resource.department,
        resource.jobTitle,
        resource.role,
        resource.skills,
        resource.accessRole,
        resource.accountStatus
      ]
        .join(" ")
        .toLowerCase();
      const resourceStatus =
        resource.active === false ? "Inactive" : resource.needsReview ? "Needs review" : "Active";
      const loginStatus = resource.accountStatus || "Not enabled";
      return (
        (!search || searchable.includes(search)) &&
        (!team || resource.team === team) &&
        (!status || resourceStatus === status || (status === "Active" && resource.active !== false)) &&
        (!accountStatus || loginStatus === accountStatus)
      );
    })
    .sort((first, second) => String(first.fullName || "").localeCompare(String(second.fullName || "")));
}

function renderSummary() {
  document.getElementById("totalResources").textContent = resources.length;
  document.getElementById("activeResources").textContent = resources.filter(
    (resource) => resource.active !== false
  ).length;
  document.getElementById("totalTeams").textContent = new Set(
    resources.map((resource) => resource.team).filter(Boolean)
  ).size;
  document.getElementById("reviewResources").textContent = resources.filter(
    (resource) => resource.needsReview
  ).length;
  // Counts Resources enabled for login in this application. The password itself
  // now lives in Supabase Auth, so there is no local credential to check.
  document.getElementById("activeAccounts").textContent = resources.filter(
    (resource) =>
      resource.accountStatus === "Active" && resource.active !== false && resource.accessRole
  ).length;
}

function renderResources() {
  const items = filteredResources();
  const body = document.getElementById("resourceTableBody");
  body.innerHTML = "";

  items.forEach((resource) => {
    const row = document.createElement("tr");
    const active = resource.active !== false;
    const emailContent = resource.email
      ? `<a class="resource-email" href="mailto:${escapeHtml(resource.email)}">${escapeHtml(resource.email)}</a>`
      : '<span class="resource-email missing">Email required</span>';
    const loginStatus = resource.accountStatus || "Not enabled";
    const loginClass = loginStatus === "Active" ? "active" : loginStatus === "Suspended" ? "suspended" : "";

    row.innerHTML = `
          <td>${escapeHtml(resource.resourceId)}</td>
          <td><span class="resource-name">${escapeHtml(resource.fullName || "Unnamed resource")}</span>${emailContent}${resource.resourceKind === "Generic placeholder" ? '<span class="badge placeholder">Placeholder</span>' : ""}</td>
          <td>${escapeHtml(resource.team || "Not set")}<span class="subtext">${escapeHtml(resource.department || "")}</span></td>
          <td>${escapeHtml(resource.jobTitle || "Not set")}<span class="subtext">${escapeHtml(resource.role || "")}</span></td>
          <td>${escapeHtml(managerName(resource))}</td>
          <td>${escapeHtml(resource.standardWeeklyCapacity ?? "Not set")} contracted hours<span class="subtext">${Math.max(0, Number(resource.standardWeeklyCapacity || 0) - Number(resource.nonWorkingHoursPerWeek || 0) - Number(resource.fixedOperationalHoursPerWeek || 0) - Number(resource.otherUnavailableHoursPerWeek || 0))} available before absence</span></td>
          <td><span class="badge ${active ? "active" : "inactive"}">${active ? "Active" : "Inactive"}</span>${resource.needsReview ? '<span class="badge review">Details required</span>' : ""}</td>
          <td>${escapeHtml(resource.accessRole || "No login role")}<br><span class="login-badge ${loginClass}">${escapeHtml(loginStatus)}</span><span class="subtext">${escapeHtml(resource.accessScope || "No project scope")}</span></td>
          <td><div class="action-group">${PPMChangeLog.historyButton("Resource", resource.resourceId, resource.fullName || resource.resourceId)}<button type="button" class="button small edit-resource-button" data-permission="resources.edit" data-resource-id="${escapeHtml(resource.resourceId)}">Edit resource</button>${PPMAuth.can("users.manage") ? `<button type="button" class="button small light access-resource-button" data-resource-id="${escapeHtml(resource.resourceId)}">Login &amp; permissions</button>` : ""}<button type="button" class="button small light toggle-resource-button" data-permission="resources.edit" data-resource-id="${escapeHtml(resource.resourceId)}">${active ? "Deactivate" : "Reactivate"}</button></div></td>
        `;
    body.appendChild(row);
  });

  document.getElementById("emptyMessage").style.display = items.length ? "none" : "block";
  renderSummary();
  attachTableEvents();
}

function attachTableEvents() {
  document
    .querySelectorAll(".edit-resource-button")
    .forEach((button) => button.addEventListener("click", () => openEditResource(button.dataset.resourceId)));
  document.querySelectorAll(".access-resource-button").forEach((button) =>
    button.addEventListener("click", () => {
      openEditResource(button.dataset.resourceId);
      requestAnimationFrame(() =>
        document.getElementById("accessSection").scrollIntoView({ block: "start" })
      );
    })
  );
  document
    .querySelectorAll(".toggle-resource-button")
    .forEach((button) => button.addEventListener("click", () => toggleResource(button.dataset.resourceId)));
}

function populateManagerSelect(selectedManagerId) {
  PPMResources.populatePersonSelect("managerResourceId", {
    selectedResourceId: selectedManagerId,
    blankLabel: "Select a manager"
  });
  const select = document.getElementById("managerResourceId");
  [...select.options].forEach((option) => {
    if (option.value && option.value === editingResourceId) option.remove();
  });
}

function updateResourceKind() {
  const isNamed = document.getElementById("resourceKind").value === "Named person";
  document.getElementById("nameLabel").textContent = isNamed ? "Full name" : "Placeholder name";
  document.getElementById("email").required = isNamed;
  document.getElementById("emailRequired").style.display = isNamed ? "inline" : "none";
  document.getElementById("emailHelp").textContent = isNamed
    ? "Required for named people and used alongside picklist selections."
    : "Optional for a generic role, team or supplier placeholder.";
  if (!isNamed) {
    document.getElementById("accessRole").value = "";
    document.getElementById("accountStatus").value = "Not enabled";
  }
  document.querySelectorAll("#accessSection input, #accessSection select").forEach((control) => {
    control.disabled = !isNamed || !PPMAuth.can("users.manage");
  });
  updateAccessFields();
}

function populateAccessRoles() {
  const select = document.getElementById("accessRole");
  const selected = select.value;
  select.innerHTML =
    '<option value="">No login role</option>' +
    PPMAuth.roleNames()
      .map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`)
      .join("");
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

/*
  The roles a person may hold on top of their permission level. The primary role is excluded
  from the list, because holding it twice means nothing and reads as a mistake - the database
  strips it for the same reason.
*/
function populateAdditionalRoles(selectedRoles) {
  const select = document.getElementById("additionalRoles");
  if (!select) return;
  const primary = document.getElementById("accessRole").value;
  const chosen = new Set(Array.isArray(selectedRoles) ? selectedRoles : readAdditionalRoles());
  select.innerHTML = PPMAuth.roleNames()
    .filter((role) => role !== primary)
    .map(
      (role) =>
        `<option value="${escapeHtml(role)}" ${chosen.has(role) ? "selected" : ""}>${escapeHtml(role)}</option>`
    )
    .join("");
}

function readAdditionalRoles() {
  const select = document.getElementById("additionalRoles");
  if (!select) return [];
  return [...select.selectedOptions].map((option) => option.value).filter(Boolean);
}

function populateProjectAccess(selectedCodes) {
  const select = document.getElementById("selectedProjectCodes");
  const projects = PPMAuth.readGlobal(
    "ppmProjects",
    [],
    "the project-access picker must list every project so an administrator can grant access to one the user cannot yet see"
  );
  const selected = new Set(Array.isArray(selectedCodes) ? selectedCodes : []);
  select.innerHTML = (Array.isArray(projects) ? projects : [])
    .sort((a, b) => String(a.projectCode || "").localeCompare(String(b.projectCode || "")))
    .map(
      (project) =>
        `<option value="${escapeHtml(project.projectCode)}" ${selected.has(project.projectCode) ? "selected" : ""}>${escapeHtml(project.projectCode)} - ${escapeHtml(project.projectName || "Unnamed project")}</option>`
    )
    .join("");
}

function updateAccessFields() {
  const role = document.getElementById("accessRole").value;
  const definition = PPMAuth.roleDefinition(role);
  document.getElementById("accessRoleDescription").textContent = definition
    ? `${definition.description} Default scope: ${definition.defaultScope}.`
    : "No login role is selected, so this Resource cannot sign in.";

  /* The primary role must not also appear as an additional one. */
  populateAdditionalRoles();

  /* What the combination actually grants, since that is the question being answered. */
  const summary = document.getElementById("additionalRolesDescription");
  if (summary) {
    const held = PPMAuth.rolesOf({ accessRole: role, additionalRoles: readAdditionalRoles() });
    const granted = PPMAuth.ALL_PERMISSIONS.filter((permission) =>
      PPMAuth.holdsPermission({ accessRole: role, additionalRoles: readAdditionalRoles() }, permission)
    ).length;
    summary.textContent = held.length
      ? `${held.length} role${held.length === 1 ? "" : "s"} held, granting ${granted} of ${PPMAuth.ALL_PERMISSIONS.length} permissions. Hold Ctrl (or Cmd) to choose more than one.`
      : "Optional. Hold Ctrl (or Cmd) to choose more than one.";
  }
  if (role && document.getElementById("accountStatus").value === "Not enabled")
    document.getElementById("accountStatus").value = "Active";
  if (definition && (!editingResourceId || !getResource(editingResourceId)?.accessScope))
    document.getElementById("accessScope").value = definition.defaultScope;
  document.getElementById("selectedProjectField").style.display =
    document.getElementById("accessScope").value === "Portfolio-wide" ? "none" : "block";
}

function selectedValues(fieldId) {
  return [...document.getElementById(fieldId).selectedOptions].map((option) => option.value).filter(Boolean);
}

function readPermissionOverrides() {
  const overrides = {};
  const add = (fieldId, permissions) => {
    const value = readValue(fieldId);
    permissions.forEach((permission) => {
      if (value !== "inherit") overrides[permission] = value;
    });
  };
  add("overrideFinancialDetail", ["financials.viewDetail"]);
  add("overrideFinancialEdit", ["financials.edit"]);
  add("overrideApprovals", [
    "financials.approve",
    "plan.approveBaseline",
    "programmes.approve",
    "stageGates.approve"
  ]);
  add("overrideGovernanceAdmin", [
    "administration.view",
    "administration.edit",
    "portfolios.view",
    "portfolios.edit"
  ]);
  add("overrideGovernanceOverride", ["stageGates.override"]);
  add("overrideAudit", ["audit.view"]);
  add("overrideExport", ["reports.export"]);
  add("overrideUsers", ["users.manage"]);
  return overrides;
}

function setPermissionOverrides(overrides) {
  const valueFor = (permission) => overrides?.[permission] || "inherit";
  setValue("overrideFinancialDetail", valueFor("financials.viewDetail"));
  setValue("overrideFinancialEdit", valueFor("financials.edit"));
  setValue("overrideApprovals", valueFor("financials.approve"));
  setValue("overrideGovernanceAdmin", valueFor("administration.edit"));
  setValue("overrideGovernanceOverride", valueFor("stageGates.override"));
  setValue("overrideAudit", valueFor("audit.view"));
  setValue("overrideExport", valueFor("reports.export"));
  setValue("overrideUsers", valueFor("users.manage"));
}

function showModal() {
  document.getElementById("resourceModal").classList.add("visible");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.getElementById("resourceModal").classList.remove("visible");
  document.body.style.overflow = "";
  editingResourceId = null;
}

function openAddResource() {
  clearMessage();
  editingResourceId = null;
  document.getElementById("resourceForm").reset();
  document.getElementById("resourceModalTitle").textContent = "Add resource";
  document.getElementById("saveResourceButton").textContent = "Save resource";
  document.getElementById("standardWeeklyCapacity").value = "37.5";
  document.getElementById("nonWorkingHoursPerWeek").value = "0";
  document.getElementById("fixedOperationalHoursPerWeek").value = "0";
  document.getElementById("otherUnavailableHoursPerWeek").value = "0";
  document.getElementById("resourceKind").value = "Named person";
  document.getElementById("resourceStatus").value = "Active";
  populateAccessRoles();
  setValue("accessRole", "");
  populateAdditionalRoles([]);
  setValue("accountStatus", "Not enabled");
  setValue("accessScope", "Selected projects");
  populateProjectAccess([]);
  setPermissionOverrides({});
  populateManagerSelect("");
  updateResourceKind();
  showModal();
  document.getElementById("fullName").focus();
}

function setValue(fieldId, value) {
  document.getElementById(fieldId).value = value ?? "";
}

function openEditResource(resourceId) {
  const resource = getResource(resourceId);
  if (!resource) return;
  clearMessage();
  editingResourceId = resourceId;
  document.getElementById("resourceModalTitle").textContent = `Edit ${resource.fullName || resourceId}`;
  document.getElementById("saveResourceButton").textContent = "Save changes";
  setValue("resourceId", resource.resourceId);
  setValue("resourceKind", resource.resourceKind || "Named person");
  setValue("resourceStatus", resource.active === false ? "Inactive" : "Active");
  setValue("fullName", resource.fullName);
  setValue("email", resource.email);
  setValue("team", resource.team);
  setValue("department", resource.department);
  setValue("location", resource.location);
  setValue("jobTitle", resource.jobTitle);
  setValue("role", resource.role);
  setValue("skills", resource.skills);
  setValue("resourceType", resource.resourceType || "Employee");
  setValue("workingPattern", resource.workingPattern || "Full time");
  setValue("standardWeeklyCapacity", resource.standardWeeklyCapacity ?? 37.5);
  setValue("nonWorkingHoursPerWeek", resource.nonWorkingHoursPerWeek ?? 0);
  setValue("fixedOperationalHoursPerWeek", resource.fixedOperationalHoursPerWeek ?? 0);
  setValue("otherUnavailableHoursPerWeek", resource.otherUnavailableHoursPerWeek ?? 0);
  setValue("effectiveStartDate", resource.effectiveStartDate);
  setValue("effectiveEndDate", resource.effectiveEndDate);
  populateAccessRoles();
  setValue("accessRole", resource.accessRole || "");
  populateAdditionalRoles(resource.additionalRoles || []);
  setValue("accountStatus", resource.accountStatus || "Not enabled");
  setValue(
    "accessScope",
    resource.accessScope || PPMAuth.roleDefinition(resource.accessRole)?.defaultScope || "Selected projects"
  );
  populateProjectAccess(resource.selectedProjectCodes || []);
  setPermissionOverrides(resource.permissionOverrides || {});
  populateManagerSelect(resource.managerResourceId);
  updateResourceKind();
  updateAccessFields();
  showModal();
}

function readValue(fieldId) {
  return document.getElementById(fieldId).value.trim();
}

/*
  Stage 16: one unwrapper for the writes on this page, so each call site stays readable and
  none of them can quietly skip the check.
*/
async function savedReference(promise) {
  const result = await promise;
  if (!result || result.ok !== false) return true;
  showMessage(
    result.queued ? `${result.message} It is saved on this computer and will be retried.` : result.message,
    result.queued ? "warning" : "error"
  );
  return false;
}

async function syncResourceReferences(resource) {
  const projectFields = ["projectManager", "sponsor", "projectLead"];
  const projects = JSON.parse(localStorage.getItem("ppmProjects") || "[]");
  let projectsChanged = false;
  if (Array.isArray(projects)) {
    projects.forEach((project) =>
      projectFields.forEach((field) => {
        if (project[`${field}ResourceId`] === resource.resourceId) {
          project[field] = resource.fullName;
          project[`${field}Email`] = resource.email || "";
          projectsChanged = true;
        }
      })
    );
    if (projectsChanged && !(await savedReference(window.PPMStore.projects.replaceAll(projects)))) return false;
  }

  const plans = JSON.parse(localStorage.getItem("ppmProjectPlans") || "{}");
  let plansChanged = false;
  if (plans && typeof plans === "object" && !Array.isArray(plans)) {
    Object.values(plans)
      .filter(Array.isArray)
      .flat()
      .forEach((task) => {
        if (task.taskOwnerResourceId === resource.resourceId) {
          task.taskOwner = resource.fullName;
          task.taskOwnerEmail = resource.email || "";
          plansChanged = true;
        }
      });
    if (plansChanged && !(await savedReference(window.PPMStore.plans.replaceAll(plans)))) return false;
  }

  const raid = JSON.parse(localStorage.getItem("ppmProjectRaid") || "{}");
  const raidItems = Array.isArray(raid)
    ? raid
    : raid && typeof raid === "object"
      ? Object.values(raid).filter(Array.isArray).flat()
      : [];
  let raidChanged = false;
  raidItems.forEach((item) => {
    [
      ["owner", "ownerResourceId", "ownerEmail"],
      ["raisedBy", "raisedByResourceId", "raisedByEmail"],
      ["resolutionOwner", "resolutionOwnerResourceId", "resolutionOwnerEmail"]
    ].forEach(([nameField, idField, emailField]) => {
      if (item[idField] === resource.resourceId) {
        item[nameField] = resource.fullName;
        item[emailField] = resource.email || "";
        raidChanged = true;
      }
    });
  });
  if (raidChanged && !(await savedReference(window.PPMStore.raid.replaceAll(raid)))) return false;
  return true;
}

// Cells tracked in the resource change history.
const RESOURCE_AUDIT_FIELDS = [
  { key: "fullName", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "jobTitle", label: "Job title" },
  { key: "team", label: "Team" },
  { key: "resourceKind", label: "Resource type" },
  { key: "capacityHoursPerWeek", label: "Weekly capacity" },
  { key: "skills", label: "Skills" },
  { key: "effectiveStartDate", label: "Effective start" },
  { key: "effectiveEndDate", label: "Effective end" },
  { key: "active", label: "Active" },
  { key: "accessRole", label: "Permission level" },
  { key: "accountStatus", label: "Login status" },
  { key: "accessScope", label: "Project data scope" }
];

async function saveResource(event) {
  event.preventDefault();
  const form = document.getElementById("resourceForm");
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const email = readValue("email").toLowerCase();
  const duplicateEmail =
    email &&
    resources.some(
      (resource) =>
        resource.resourceId !== editingResourceId && String(resource.email || "").toLowerCase() === email
    );
  if (duplicateEmail) {
    alert("Another resource already uses this email address.");
    return;
  }

  const startDate = readValue("effectiveStartDate");
  const endDate = readValue("effectiveEndDate");
  if (startDate && endDate && endDate < startDate) {
    alert("Effective end date cannot be before the start date.");
    return;
  }

  const existing = editingResourceId ? getResource(editingResourceId) : null;
  const accessRole = PPMAuth.can("users.manage") ? readValue("accessRole") : existing?.accessRole || "";
  /* Access-control fields, so the same permission gate as the primary role. The database
     guard refuses the change regardless; this keeps the interface honest about it. */
  const additionalRoles = PPMAuth.can("users.manage")
    ? readAdditionalRoles().filter((role) => role !== accessRole)
    : existing?.additionalRoles || [];
  const accountStatus = accessRole
    ? PPMAuth.can("users.manage")
      ? readValue("accountStatus")
      : existing?.accountStatus || "Not enabled"
    : "Not enabled";
  if (readValue("resourceKind") === "Generic placeholder" && accessRole) {
    showMessage("Generic placeholders cannot be enabled for login.", "error");
    return;
  }
  if (accessRole && !email) {
    showMessage("A login account needs an email address.", "error");
    return;
  }
  const signedInUser = PPMAuth.getCurrentUser();
  if (
    existing?.resourceId === signedInUser?.resourceId &&
    (accountStatus !== "Active" || accessRole !== "System Administrator")
  ) {
    showMessage("You cannot suspend your own login or remove your own System Administrator role.", "error");
    return;
  }
  const now = new Date().toISOString();
  const resource = {
    resourceId: existing ? existing.resourceId : PPMResources.nextResourceId(resources),
    resourceKind: readValue("resourceKind"),
    fullName: readValue("fullName"),
    email,
    team: readValue("team"),
    department: readValue("department"),
    location: readValue("location"),
    jobTitle: readValue("jobTitle"),
    role: readValue("role"),
    skills: readValue("skills"),
    managerResourceId: readValue("managerResourceId"),
    resourceType: readValue("resourceType"),
    workingPattern: readValue("workingPattern"),
    standardWeeklyCapacity: Number(readValue("standardWeeklyCapacity")),
    nonWorkingHoursPerWeek: Number(readValue("nonWorkingHoursPerWeek") || 0),
    fixedOperationalHoursPerWeek: Number(readValue("fixedOperationalHoursPerWeek") || 0),
    otherUnavailableHoursPerWeek: Number(readValue("otherUnavailableHoursPerWeek") || 0),
    effectiveStartDate: startDate,
    effectiveEndDate: endDate,
    active: readValue("resourceStatus") === "Active",
    accessRole,
    /* Emptied along with the role: additional roles without a primary one are refused by
       the database guard, because nothing else in the system would treat the row as an
       account. */
    additionalRoles: accessRole ? additionalRoles : [],
    accountStatus,
    accessScope: accessRole
      ? PPMAuth.can("users.manage")
        ? readValue("accessScope")
        : existing?.accessScope || "Selected projects"
      : "",
    selectedProjectCodes:
      accessRole && PPMAuth.can("users.manage")
        ? selectedValues("selectedProjectCodes")
        : existing?.selectedProjectCodes || [],
    permissionOverrides:
      accessRole && PPMAuth.can("users.manage")
        ? readPermissionOverrides()
        : existing?.permissionOverrides || {},
    needsReview:
      readValue("resourceKind") === "Named person" &&
      (!email || !readValue("team") || !(readValue("jobTitle") || readValue("role"))),
    placeholder: false,
    createdAt: existing ? existing.createdAt || now : now,
    updatedAt: now
  };

  if (existing)
    resources[resources.findIndex((item) => item.resourceId === editingResourceId)] = {
      ...existing,
      ...resource
    };
  else resources.push(resource);

  /*
    Stage 16: awaited, and nothing after it happens unless the database accepted the record.
    The access-change record below and the audit entry that follows it both describe a change
    that has been made - writing them after a refused save would record something that did not
    happen, on the one screen where that matters most.
  */
  const saveResult = await PPMResources.saveResources(resources);
  if (!saveResult.ok) {
    showMessage(saveResult.message, "error");
    return;
  }

  if (
    PPMAuth.can("users.manage") &&
    (existing?.accessRole !== resource.accessRole ||
      existing?.accountStatus !== resource.accountStatus ||
      existing?.accessScope !== resource.accessScope ||
      /* A second role changes what somebody can do as surely as their first one, so it
         belongs in the access-change record. */
      JSON.stringify(existing?.additionalRoles || []) !== JSON.stringify(resource.additionalRoles || []) ||
      JSON.stringify(existing?.permissionOverrides || {}) !== JSON.stringify(resource.permissionOverrides))
  ) {
    PPMAuth.audit(
      "User access changed",
      resource,
      `${resource.fullName}'s login and permissions were updated.`,
      [
        {
          field: "accessRole",
          label: "Permission level",
          before: existing?.accessRole || "No login role",
          after: resource.accessRole || "No login role"
        },
        {
          field: "accountStatus",
          label: "Login status",
          before: existing?.accountStatus || "Not enabled",
          after: resource.accountStatus || "Not enabled"
        },
        {
          field: "accessScope",
          label: "Project data scope",
          before: existing?.accessScope || "",
          after: resource.accessScope || ""
        }
      ]
    );
  }
  PPMChangeLog.recordRow({
    before: existing,
    after: existing ? { ...existing, ...resource } : resource,
    entityType: "Resource",
    entityId: resource.resourceId,
    fields: RESOURCE_AUDIT_FIELDS,
    statusField: "accountStatus",
    name: resource.fullName
  });
  await syncResourceReferences(resource);
  closeModal();
  populateTeamFilter();
  renderResources();
  showMessage(`${resource.fullName} was ${existing ? "updated" : "added"}.`, "success");
}

async function toggleResource(resourceId) {
  const resource = getResource(resourceId);
  if (!resource) return;
  if (resourceId === PPMAuth.getCurrentUser()?.resourceId && resource.active !== false) {
    showMessage("You cannot deactivate your own signed-in Resource account.", "error");
    return;
  }
  const willActivate = resource.active === false;
  if (
    !confirm(
      `${willActivate ? "Reactivate" : "Deactivate"} ${resource.fullName}? Existing assignments will be retained.`
    )
  )
    return;
  const beforeToggle = JSON.parse(JSON.stringify(resource));
  resource.active = willActivate;
  resource.updatedAt = new Date().toISOString();

  /* If the database refuses, the in-memory record is put back as it was. Without this the row
     would keep showing as deactivated until the next reload, which is the screen disagreeing
     with the database - exactly what this stage exists to stop. */
  const toggleResult = await PPMResources.saveResources(resources);
  if (!toggleResult.ok) {
    Object.assign(resource, beforeToggle);
    showMessage(toggleResult.message, "error");
    renderResources();
    return;
  }

  PPMChangeLog.recordRow({
    before: beforeToggle,
    after: resource,
    entityType: "Resource",
    entityId: resource.resourceId,
    fields: RESOURCE_AUDIT_FIELDS,
    action: willActivate ? "Resource reactivated" : "Resource deactivated",
    name: resource.fullName
  });
  renderResources();
  showMessage(`${resource.fullName} was ${willActivate ? "reactivated" : "deactivated"}.`, "success");
}

["searchFilter", "teamFilter", "statusFilter", "accountFilter"].forEach((fieldId) =>
  document
    .getElementById(fieldId)
    .addEventListener(fieldId === "searchFilter" ? "input" : "change", renderResources)
);
document.getElementById("addResourceButton").addEventListener("click", openAddResource);
document.getElementById("closeModalButton").addEventListener("click", closeModal);
document.getElementById("cancelButton").addEventListener("click", closeModal);
document.getElementById("resourceKind").addEventListener("change", updateResourceKind);
document.getElementById("accessRole").addEventListener("change", updateAccessFields);
document.getElementById("accessScope").addEventListener("change", updateAccessFields);
document.getElementById("resourceForm").addEventListener("submit", saveResource);
document.getElementById("resourceModal").addEventListener("click", function (event) {
  if (event.target === this) closeModal();
});
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" && document.getElementById("resourceModal").classList.contains("visible"))
    closeModal();
});

populateTeamFilter();
renderResources();

/*
  Stage 16: the legacy backfill is now an explicit write rather than a side effect of reading.

  ensureLegacyResources() above derives anybody who exists only in a legacy name field and
  returns them, but no longer persists them - it is called from eleven places including the
  top of this file, and a getter cannot save now that saving is awaited. This is the one place
  that persists it, and it is here because this is the page that owns people.

  Failure is reported rather than swallowed: previously the write happened silently on
  whichever page called the getter first, so nobody could have known if it had not worked.
*/
PPMResources.backfillLegacyResources()
  .then((result) => {
    if (result.nothingToDo || result.ok) return;
    showMessage(
      `Some people derived from older records could not be saved: ${result.message}`,
      "error"
    );
  })
  .catch((error) => console.error("The legacy resource backfill failed.", error));
