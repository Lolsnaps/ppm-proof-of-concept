"use strict";
const parameters = new URLSearchParams(location.search);
let projects = [],
  resources = [],
  entries = [],
  originalEntries = new Map(),
  dirtyIds = new Set(),
  pendingDeleteId = "",
  activeDecisionId = "",
  pendingApprovalFocus = parameters.get("item") || "";
const el = (id) => document.getElementById(id);
const escapeHtml = PPMCore.escapeHtml;
/* Stage 16: from PPMStore, which holds what PostgreSQL confirmed. */
function readProjects() {
  return PPMStore.projects.all();
}
function selectedProject() {
  return projects.find((project) => project.projectCode === el("projectSelect").value) || null;
}
function projectCode() {
  return el("projectSelect").value;
}
function isArchived() {
  const project = selectedProject();
  return Boolean(project && (project.archived || project.isArchived || project.projectStatus === "Archived"));
}
function showMessage(text, type = "success") {
  el("pageMessage").textContent = text;
  el("pageMessage").className = `message ${type}`;
  scrollTo({ top: 0, behavior: "smooth" });
}
function clearMessage() {
  el("pageMessage").className = "message";
}
function openModal(id) {
  el(id).classList.add("visible");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  el(id).classList.remove("visible");
  document.body.style.overflow = "";
}
function setDirty(value = true) {
  el("saveButton").disabled = !value || isArchived();
  el("saveButton").textContent = value ? "Save changes" : "Saved";
  el("unsavedIndicator").textContent = value ? "Unsaved changes" : "All changes saved";
  el("unsavedIndicator").classList.toggle("dirty", value);
}
function rowId(row) {
  return row.financialEntryId;
}
function currentSummary() {
  return (
    PPMFinancial.getSummary(projectCode()) || {
      approvedBudget: 0,
      budgetApprovalStatus: "No approved budget",
      approvedBudgetVersion: 0
    }
  );
}
function selectProjectOptions() {
  const requested = parameters.get("project") || parameters.get("projectCode") || "";
  el("projectSelect").innerHTML = projects.length
    ? projects
        .slice()
        .sort((a, b) => String(a.projectCode).localeCompare(String(b.projectCode)))
        .map(
          (project) =>
            `<option value="${escapeHtml(project.projectCode)}">${escapeHtml(project.projectCode)} - ${escapeHtml(project.projectName || "Unnamed project")}${project.archived || project.isArchived || project.projectStatus === "Archived" ? " (Archived)" : ""}</option>`
        )
        .join("")
    : '<option value="">No projects available</option>';
  if (projects.some((project) => project.projectCode === requested)) el("projectSelect").value = requested;
}
function loadProject() {
  entries = PPMFinancial.getEntries(projectCode()).map((row) => ({ ...row }));
  originalEntries = new Map(entries.map((row) => [rowId(row), JSON.parse(JSON.stringify(row))]));
  dirtyIds = new Set();
  const summary = currentSummary();
  el("fundingSource").value = summary.fundingSource || "";
  el("financialRag").value = summary.financialRag || "Not Assessed";
  el("financialCommentary").value = summary.financialCommentary || "";
  PPMResources.populatePersonSelect(el("financialOwner"), {
    selectedResourceId: summary.financialOwnerResourceId || "",
    legacyName: summary.financialOwner || "",
    blankLabel: "Select financial owner",
    allowGeneric: true,
    allowCreate: true
  });
  setDirty(false);
  renderAll();
  clearMessage();
}
function categories() {
  return PPMFinancial.getCategories();
}
function categoryFor(id) {
  return categories().find((category) => category.categoryId === id);
}
function categoryOptions(selected) {
  return (
    '<option value="">Select category</option>' +
    categories()
      .filter((category) => category.active || category.categoryId === selected)
      .map(
        (category) =>
          `<option value="${escapeHtml(category.categoryId)}" ${category.categoryId === selected ? "selected" : ""}>${escapeHtml(category.name)}${category.active ? "" : " (Inactive)"}</option>`
      )
      .join("")
  );
}
function renderTable() {
  const readOnly = isArchived();
  el("financeBody").innerHTML = entries
    .map(
      (row) =>
        `<tr data-row-id="${escapeHtml(rowId(row))}" class="${dirtyIds.has(rowId(row)) ? "dirty-row" : ""}"><td><span class="row-id">${escapeHtml(rowId(row))}</span></td>
<td><select data-field="categoryId" ${readOnly ? "disabled" : ""}>${categoryOptions(row.categoryId)}</select></td>
<td><input class="description" data-field="description" value="${escapeHtml(row.description)}" placeholder="Cost item description" ${readOnly ? "disabled" : ""}></td>
<td><input data-field="financialPeriod" type="month" value="${escapeHtml(row.financialPeriod)}" ${readOnly ? "disabled" : ""}></td>${["budgetAmount", "forecastCost", "actualCost", "committedCost"].map((field) => `<td><input class="money-input" data-field="${field}" type="number" min="0" step="0.01" value="${Number(row[field] || 0)}" ${readOnly ? "disabled" : ""}></td>`).join("")}<td><span class="calculated">${PPMFinancial.money(Math.max(Number(row.forecastCost || 0) - Number(row.actualCost || 0), 0))}</span></td>
<td><input class="notes" data-field="notes" value="${escapeHtml(row.notes)}" placeholder="Supporting note" ${readOnly ? "disabled" : ""}></td>
<td><div class="row-actions">${PPMChangeLog.historyButton("Financial entry", rowId(row), row.description || rowId(row))}<button class="button danger small delete-row" data-permission="financials.edit" type="button" ${readOnly ? "disabled" : ""}>Delete</button></div></td></tr>`
    )
    .join("");
  el("emptyState").style.display = entries.length ? "none" : "block";
  el("addRowButton").disabled = readOnly;
  document
    .querySelectorAll("#financeBody [data-field]")
    .forEach((control) =>
      control.addEventListener(control.tagName === "SELECT" ? "change" : "input", handleRowChange)
    );
  document.querySelectorAll(".delete-row").forEach((button) =>
    button.addEventListener("click", () => {
      pendingDeleteId = button.closest("tr").dataset.rowId;
      el("deleteText").textContent =
        `${pendingDeleteId} will be removed when you save the cost plan. Its prior values will remain in Audit History.`;
      openModal("deleteModal");
    })
  );
}
function handleRowChange(event) {
  if (!PPMAuth.can("financials.edit", projectCode())) {
    PPMAuth.permissionToast();
    return;
  }
  const rowElement = event.currentTarget.closest("tr"),
    row = entries.find((item) => rowId(item) === rowElement.dataset.rowId),
    field = event.currentTarget.dataset.field;
  if (!row) return;
  row[field] = ["budgetAmount", "forecastCost", "actualCost", "committedCost"].includes(field)
    ? Number(event.currentTarget.value || 0)
    : event.currentTarget.value;
  if (field === "categoryId") row.categoryName = categoryFor(row.categoryId)?.name || "";
  row.remainingForecast = Math.max(Number(row.forecastCost || 0) - Number(row.actualCost || 0), 0);
  rowElement.classList.add("dirty-row");
  const remainingCell = rowElement.querySelector(".calculated");
  if (remainingCell) remainingCell.textContent = PPMFinancial.money(row.remainingForecast);
  dirtyIds.add(rowId(row));
  setDirty(true);
  renderSummary();
}
function metadataChanged() {
  if (!PPMAuth.can("financials.edit", projectCode())) {
    PPMAuth.permissionToast();
    return;
  }
  setDirty(true);
  clearMessage();
  renderSummary();
}
function totals() {
  return PPMFinancial.calculations(entries, currentSummary().approvedBudget);
}
function renderSummary() {
  const values = totals(),
    summary = currentSummary();
  [
    "proposedBudget",
    "approvedBudget",
    "forecastCost",
    "actualCost",
    "committedCost",
    "estimateAtCompletion",
    "budgetVariance"
  ].forEach((key) => (el(key).textContent = PPMFinancial.money(values[key])));
  el("budgetVersion").textContent = summary.approvedBudgetVersion
    ? `Approved version ${summary.approvedBudgetVersion}`
    : "No approved version";
  el("budgetVariancePercent").textContent = values.budgetVariancePercentageAvailable
    ? `${values.budgetVariancePercentage.toLocaleString("en-GB", { maximumFractionDigits: 1 })}% of approved budget remaining`
    : "Not available without approved budget";
  el("varianceCard").className =
    `summary-card ${!values.budgetVariancePercentageAvailable ? "" : values.budgetVariance < 0 ? "bad" : values.budgetVariancePercentage < 5 ? "warning" : "good"}`;
  const status = summary.budgetApprovalStatus || "No approved budget";
  el("approvalBadge").textContent = status;
  el("approvalBadge").className =
    `status-badge ${status === "Approved" ? "approved" : status === "Pending Approval" ? "pending" : status === "Rejected" ? "rejected" : ""}`;
}
function renderHistory() {
  const rows = PPMFinancial.getApprovals(projectCode()).sort((a, b) =>
      String(b.requestedAt).localeCompare(String(a.requestedAt))
    ),
    signedIn = PPMAuth.getCurrentUser();
  el("approvalHistory").innerHTML = rows.length
    ? `<table class="history-table"><thead><tr><th>Request</th>
<th>Type</th>
<th>Previous budget</th>
<th>Proposed budget</th>
<th>Requested by</th>
<th>Approver</th>
<th>Status</th>
<th>Decision</th>
<th>Action</th></tr></thead><tbody>${rows
        .map((row) => {
          const authorised =
            row.status === "Pending Approval" &&
            !isArchived() &&
            PPMAuth.can("financials.approve", projectCode()) &&
            row.approverResourceId === signedIn?.resourceId &&
            row.requesterResourceId !== signedIn?.resourceId;
          return `<tr data-approval-id="${escapeHtml(row.approvalId)}"><td><strong>${escapeHtml(row.approvalId)}</strong><br>${row.requestedAt ? new Date(row.requestedAt).toLocaleString("en-GB") : ""}</td>
<td>${escapeHtml(row.requestType)}<br><span class="muted-note">${escapeHtml(row.reason || "No reason recorded")}</span></td>
<td>${PPMFinancial.money(row.currentApprovedBudget)}</td>
<td><strong>${PPMFinancial.money(row.proposedBudget)}</strong></td>
<td>${escapeHtml(row.requesterName || row.requesterResourceId)}</td>
<td>${escapeHtml(row.approverName || row.approverResourceId)}</td>
<td><span class="status-badge ${row.status === "Approved" ? "approved" : row.status === "Pending Approval" ? "pending" : "rejected"}">${escapeHtml(row.status)}</span></td>
<td>${row.decisionComments ? `${escapeHtml(row.decisionComments)}<br><span class="muted-note">${row.decisionAt ? new Date(row.decisionAt).toLocaleString("en-GB") : ""}</span>` : "Awaiting decision"}</td>
<td>${authorised ? `<button class="button small decide-button" data-permission="financials.approve" data-approval-id="${escapeHtml(row.approvalId)}" type="button">Record decision</button>` : row.status === "Pending Approval" ? '<span class="muted-note">Assigned approver only</span>' : "—"}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : '<div class="empty visible">No budget approval requests have been raised for this project.</div>';
  document
    .querySelectorAll(".decide-button")
    .forEach((button) => button.addEventListener("click", () => openDecision(button.dataset.approvalId)));
  if (pendingApprovalFocus) {
    const row = document.querySelector(`[data-approval-id="${CSS.escape(pendingApprovalFocus)}"]`);
    if (row) {
      pendingApprovalFocus = "";
      row.classList.add("ppm-notification-target");
      requestAnimationFrame(() => row.scrollIntoView({ block: "center", inline: "center" }));
    }
  }
}
function renderAll() {
  const project = selectedProject(),
    archived = isArchived();
  el("readOnlyBanner").style.display = archived ? "block" : "none";
  el("projectDetailsLink").href = project
    ? `project-details.html?code=${encodeURIComponent(project.projectCode)}`
    : "index.html";
  el("projectAuditLink").href = project
    ? `audit-history.html?project=${encodeURIComponent(project.projectCode)}&entity=Financial%20entry`
    : "audit-history.html";
  [
    "categoryButton",
    "requestApprovalButton",
    "financialOwner",
    "fundingSource",
    "financialRag",
    "financialCommentary"
  ].forEach((id) => (el(id).disabled = archived || !project));
  renderTable();
  renderSummary();
  renderHistory();
}
function addRow() {
  if (!PPMAuth.can("financials.edit", projectCode())) {
    PPMAuth.permissionToast();
    return;
  }
  if (isArchived() || !projectCode()) return;
  const row = {
    financialEntryId: PPMFinancial.uid("FLE"),
    projectCode: projectCode(),
    categoryId: "",
    categoryName: "",
    description: "",
    financialPeriod: "",
    budgetAmount: 0,
    forecastCost: 0,
    actualCost: 0,
    committedCost: 0,
    remainingForecast: 0,
    notes: "",
    createdAt: new Date().toISOString()
  };
  entries.push(row);
  dirtyIds.add(rowId(row));
  setDirty(true);
  renderTable();
  renderSummary();
  requestAnimationFrame(() =>
    document.querySelector(`[data-row-id="${CSS.escape(rowId(row))}"] [data-field="categoryId"]`)?.focus()
  );
}
function validate() {
  if (!projectCode()) {
    showMessage("Select a project before adding financial data.", "error");
    return false;
  }
  const owner = PPMResources.getSelectedPerson(el("financialOwner"));
  if (!owner.resourceId || !owner.name) {
    showMessage("Select a financial owner before saving.", "error");
    return false;
  }
  if (!el("fundingSource").value.trim()) {
    showMessage("Enter the funding source before saving.", "error");
    return false;
  }
  for (const row of entries) {
    if (!row.categoryId || !row.description.trim()) {
      showMessage(`${rowId(row)} needs a category and description.`, "error");
      return false;
    }
    if (
      ["budgetAmount", "forecastCost", "actualCost", "committedCost"].some(
        (field) => Number(row[field] || 0) < 0
      )
    ) {
      showMessage(`${rowId(row)} cannot contain negative cost values.`, "error");
      return false;
    }
  }
  return true;
}
async function saveChanges() {
  if (!PPMAuth.can("financials.edit", projectCode())) {
    PPMAuth.permissionToast();
    return;
  }
  if (!validate()) return;
  const code = projectCode(),
    before = new Map(originalEntries),
    now = new Date().toISOString(),
    owner = PPMResources.getSelectedPerson(el("financialOwner"));
  /* Stage 16: awaited, and nothing below runs unless the database accepted the entries -
     including the summary, which is derived from them. */
  const entriesResult = await PPMFinancial.saveEntries(code, entries);
  if (entriesResult && entriesResult.ok === false) {
    showMessage(entriesResult.message, "error");
    return;
  }
  entries = entriesResult.value ?? entries;

  const summaryBefore = currentSummary();
  const summaryResult = await PPMFinancial.syncSummary(code, {
    financialOwner: owner.name,
    financialOwnerResourceId: owner.resourceId,
    financialOwnerEmail: owner.email,
    fundingSource: el("fundingSource").value,
    financialRag: el("financialRag").value,
    financialCommentary: el("financialCommentary").value
  });
  if (summaryResult && summaryResult.ok === false) {
    showMessage(summaryResult.message, "error");
    return;
  }
  const summary = summaryResult.value ?? summaryResult;
  /* Stage 14: the loops that used to walk changed and deleted entries here existed
     only to emit browser-side audit records. The database records every insert,
     update and soft delete from the authenticated identity, so they are gone. */

  originalEntries = new Map(entries.map((row) => [rowId(row), JSON.parse(JSON.stringify(row))]));
  dirtyIds.clear();
  setDirty(false);
  renderAll();
  showMessage(
    "Financial changes were saved and the project summary, reports and audit history were updated."
  );
}
function renderCategories() {
  el("categoryList").innerHTML = categories()
    .map(
      (category) =>
        `<div class="category-row" data-category-id="${escapeHtml(category.categoryId)}"><input data-category-field="name" value="${escapeHtml(category.name)}" aria-label="Category name"><input data-category-field="description" value="${escapeHtml(category.description)}" aria-label="Category description"><label class="category-active"><input data-category-field="active" type="checkbox" class="inline-checkbox" ${category.active ? "checked" : ""}> Active</label></div>`
    )
    .join("");
}
function addCategory() {
  if (!PPMAuth.can("financials.configure")) {
    PPMAuth.permissionToast();
    return;
  }
  const container = el("categoryList"),
    row = document.createElement("div");
  row.className = "category-row";
  row.dataset.categoryId = PPMFinancial.uid("CAT");
  row.innerHTML =
    '<input data-category-field="name" placeholder="Category name" aria-label="Category name"><input data-category-field="description" placeholder="Description" aria-label="Category description"><label class="category-active"><input data-category-field="active" type="checkbox" class="inline-checkbox" checked> Active</label>';
  container.appendChild(row);
  row.querySelector("input").focus();
}
async function saveCategories() {
  if (!PPMAuth.can("financials.configure")) {
    PPMAuth.permissionToast();
    return;
  }
  const before = categories(),
    rows = [...document.querySelectorAll(".category-row")].map((row) => ({
      categoryId: row.dataset.categoryId,
      name: row.querySelector('[data-category-field="name"]').value,
      description: row.querySelector('[data-category-field="description"]').value,
      active: row.querySelector('[data-category-field="active"]').checked,
      system: before.find((item) => item.categoryId === row.dataset.categoryId)?.system || false
    }));
  if (rows.some((row) => !row.name.trim())) {
    showMessage("Every financial category needs a name.", "error");
    return;
  }
  const names = rows.map((row) => row.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    showMessage("Financial category names must be unique.", "error");
    return;
  }
  const categoryResult = await PPMFinancial.saveCategories(rows);
  if (categoryResult && categoryResult.ok === false) {
    showMessage(categoryResult.message, "error");
    return;
  }

  closeModal("categoryModal");
  renderTable();
  showMessage("Financial categories were saved.");
}
function openApproval() {
  if (!PPMAuth.can("financials.edit", projectCode())) {
    PPMAuth.permissionToast();
    return;
  }
  if (dirtyIds.size || el("saveButton").disabled === false) {
    showMessage("Save the current cost plan before requesting budget approval.", "warning");
    return;
  }
  const values = totals(),
    signedIn = PPMAuth.getCurrentUser();
  el("approvalSummary").textContent =
    `Submit ${PPMFinancial.money(values.proposedBudget)} for approval. The current approved budget is ${PPMFinancial.money(values.approvedBudget)}.`;
  PPMResources.populatePersonSelect(el("approvalRequester"), {
    selectedResourceId: signedIn.resourceId,
    blankLabel: "Signed-in requester",
    allowGeneric: false,
    allowCreate: false
  });
  el("approvalRequester").disabled = true;
  PPMResources.populatePersonSelect(el("approvalApprover"), {
    blankLabel: "Select authorised approver",
    allowGeneric: false,
    allowCreate: false
  });
  el("approvalReason").value = "";
  openModal("approvalModal");
}
async function submitApproval(event) {
  event.preventDefault();
  const signedIn = PPMAuth.getCurrentUser(),
    requester = { resourceId: signedIn.resourceId, name: signedIn.fullName, email: signedIn.email },
    approver = PPMResources.getSelectedPerson(el("approvalApprover")),
    reason = el("approvalReason").value,
    databaseWorkflow = Boolean(window.PPMChildDatabase?.workflowReady?.("financial")),
    submitButton = event.currentTarget.querySelector('[type="submit"]'),
    originalLabel = submitButton?.textContent || "Submit for approval";
  if (!approver.resourceId) {
    showMessage("Select an authorised approver.", "error");
    return;
  }
  if (approver.resourceId === requester.resourceId) {
    showMessage("The requester and approver must be different people.", "error");
    return;
  }
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Saving…";
  }
  try {
    /*
      Stage 17: no fallback. The else-branch wrote rows the database refuses through
      private.guard_financial_approval_workflow_write, and the refusal was swallowed.
    */
    if (!databaseWorkflow) {
      showMessage(
        "The budget approval workflow is unavailable, so this cannot be recorded. Reload the " +
          "page; if it persists, the database connection or your sign-in has been lost.",
        "error"
      );
      return;
    }
    /*
      Stage 17: no fallback. The else-branch wrote rows the database refuses through
      private.guard_financial_approval_workflow_write, and the refusal was swallowed.
    */
    if (!databaseWorkflow) {
      showMessage(
        "The budget approval workflow is unavailable, so this cannot be recorded. Reload the " +
          "page; if it persists, the database connection or your sign-in has been lost.",
        "error"
      );
      return;
    }
    if (databaseWorkflow) {
      const result = await PPMChildDatabase.commitFinancialWorkflow({
        operation: "request",
        projectCode: projectCode(),
        approverResourceId: approver.resourceId,
        reason
      });
      const approval = PPMFinancial.getApprovals(projectCode()).find(
        (item) => item.approvalId === result?.approvalId
      );
      if (approval) {
        // Compatibility audit is emitted only after PostgreSQL commits.
        // public.audit_log remains the verified server-side audit trail.

      }
    } else {
      await PPMFinancial.requestApproval(projectCode(), {
        requesterResourceId: requester.resourceId,
        requesterName: requester.name,
        requesterEmail: requester.email,
        approverResourceId: approver.resourceId,
        approverName: approver.name,
        approverEmail: approver.email,
        reason
      });
    }
    closeModal("approvalModal");
    renderAll();
    showMessage("The budget request was submitted and added to approval history.");
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  }
}
function openDecision(id) {
  const approval = PPMFinancial.getApprovals(projectCode()).find((item) => item.approvalId === id),
    signedIn = PPMAuth.getCurrentUser();
  if (
    !approval ||
    !PPMAuth.can("financials.approve", projectCode()) ||
    approval.approverResourceId !== signedIn?.resourceId ||
    approval.requesterResourceId === signedIn?.resourceId
  ) {
    PPMAuth.permissionToast(
      "Only the assigned approver can decide this request, and a requester cannot approve their own submission."
    );
    return;
  }
  activeDecisionId = id;
  el("decisionSummary").textContent =
    `${approval.requestType} for ${PPMFinancial.money(approval.proposedBudget)}. The assigned approver is ${approval.approverName || approval.approverResourceId}.`;
  PPMResources.populatePersonSelect(el("decisionMaker"), {
    selectedResourceId: signedIn.resourceId,
    blankLabel: "Signed-in approver",
    allowGeneric: false,
    allowCreate: false
  });
  el("decisionMaker").disabled = true;
  el("decisionComments").value = "";
  openModal("decisionModal");
}
async function decide(status) {
  const signedIn = PPMAuth.getCurrentUser(),
    approval = PPMFinancial.getApprovals(projectCode()).find((item) => item.approvalId === activeDecisionId),
    databaseWorkflow = Boolean(window.PPMChildDatabase?.workflowReady?.("financial")),
    comments = el("decisionComments").value,
    approveButton = el("decisionForm").querySelector('[type="submit"]'),
    rejectButton = el("rejectButton");
  if (
    !approval ||
    !PPMAuth.can("financials.approve", projectCode()) ||
    approval.approverResourceId !== signedIn?.resourceId ||
    approval.requesterResourceId === signedIn?.resourceId
  ) {
    PPMAuth.permissionToast(
      "This decision would breach the assigned-approver or segregation-of-duties rule."
    );
    return;
  }
  const originalApproveLabel = approveButton?.textContent || "Approve",
    originalRejectLabel = rejectButton?.textContent || "Reject";
  if (approveButton) approveButton.disabled = true;
  if (rejectButton) rejectButton.disabled = true;
  if (status === "Approved" && approveButton) approveButton.textContent = "Saving…";
  if (status === "Rejected" && rejectButton) rejectButton.textContent = "Saving…";
  try {
    if (databaseWorkflow) {
      const before = { ...approval };
      await PPMChildDatabase.commitFinancialWorkflow({
        operation: status === "Approved" ? "approve" : "reject",
        projectCode: projectCode(),
        approval,
        decisionComments: comments
      });
      const decided = PPMFinancial.getApprovals(projectCode()).find(
        (item) => item.approvalId === before.approvalId
      );
      if (decided) {

      }
    } else {
      await PPMFinancial.decideApproval(activeDecisionId, {
        status,
        decisionByResourceId: signedIn.resourceId,
        decisionByName: signedIn.fullName,
        comments
      });
    }
    activeDecisionId = "";
    closeModal("decisionModal");
    renderAll();
    showMessage(
      `The budget request was ${status.toLowerCase()} and its decision is retained in approval history.`
    );
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    if (approveButton) {
      approveButton.disabled = false;
      approveButton.textContent = originalApproveLabel;
    }
    if (rejectButton) {
      rejectButton.disabled = false;
      rejectButton.textContent = originalRejectLabel;
    }
  }
}
function initialise() {
  projects = readProjects();
  resources = PPMResources.ensureLegacyResources();
  selectProjectOptions();
  if (projects.length) loadProject();
  else renderAll();
}
el("projectSelect").addEventListener("change", () => {
  parameters.set("project", projectCode());
  history.replaceState({}, "", `${location.pathname}?${parameters}`);
  loadProject();
});
el("addRowButton").addEventListener("click", addRow);
el("saveButton").addEventListener("click", saveChanges);
["fundingSource", "financialRag", "financialCommentary"].forEach((id) =>
  el(id).addEventListener("input", metadataChanged)
);
el("financialOwner").addEventListener("change", metadataChanged);
el("categoryButton").addEventListener("click", () => {
  renderCategories();
  openModal("categoryModal");
});
el("addCategoryButton").addEventListener("click", addCategory);
el("saveCategoriesButton").addEventListener("click", saveCategories);
el("requestApprovalButton").addEventListener("click", openApproval);
el("approvalForm").addEventListener("submit", submitApproval);
el("decisionForm").addEventListener("submit", (event) => {
  event.preventDefault();
  decide("Approved");
});
el("rejectButton").addEventListener("click", () => decide("Rejected"));
el("confirmDeleteButton").addEventListener("click", () => {
  entries = entries.filter((row) => rowId(row) !== pendingDeleteId);
  dirtyIds.add(pendingDeleteId);
  pendingDeleteId = "";
  closeModal("deleteModal");
  setDirty(true);
  renderTable();
  renderSummary();
});
document
  .querySelectorAll("[data-close]")
  .forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
document.querySelectorAll(".modal").forEach((modal) =>
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal(modal.id);
  })
);
addEventListener("beforeunload", (event) => {
  if (el("saveButton").disabled) return;
  event.preventDefault();
  event.returnValue = "";
});
initialise();

/*
  Stage 16: the default financial categories are now persisted here, once, rather than as a side
  effect of every getCategories() call. Failure is reported instead of swallowed - previously the
  write happened silently on whichever page read categories first, so nobody could have known if
  it had not worked.
*/
PPMFinancial.backfillCategories()
  .then((result) => {
    if (result.nothingToDo || result.ok) return;
    showMessage(`Default financial categories could not be saved: ${result.message}`, "error");
  })
  .catch((error) => console.error("The financial category backfill failed.", error));
