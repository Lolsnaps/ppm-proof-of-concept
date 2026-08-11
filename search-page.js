"use strict";
const RECENT_KEY = "ppmRecentSearches";
const columns = [
  { key: "type", label: "Record type" },
  { key: "recordId", label: "Record ID" },
  { key: "title", label: "Title" },
  { key: "programmeName", label: "Programme" },
  { key: "projectCode", label: "Project ID" },
  { key: "projectName", label: "Project" },
  { key: "description", label: "Details" },
  { key: "owner", label: "Owner" },
  { key: "status", label: "Status" },
  { key: "date", label: "Relevant date" },
  { key: "open", label: "Open record" }
];
const types = [
  "Project",
  "Portfolio",
  "Lifecycle template",
  "Stage gate",
  "Milestone",
  "RAID",
  "Action",
  "Decision",
  "Benefit",
  "Document",
  "Financial entry",
  "Budget approval"
];
let projects = [],
  programmes = [],
  indexRows = [],
  visibleColumns = new Set(columns.map((column) => column.key)),
  pendingDeleteViewId = "";
/*
  Stage 16: the search index is built from PPMStore rather than from the localStorage mirror.

  all() flattens the project-keyed collections and fills in a row's project code from the key it
  is filed under, which is what PPMRegisters.flattenStore used to do here.
*/
function rowsOf(collection) {
  return PPMStore ? PPMStore[collection].all() : [];
}
const escapeHtml = PPMCore.escapeHtml;
function projectByCode(code) {
  return projects.find(
    (project) => String(project.projectCode).toLowerCase() === String(code || "").toLowerCase()
  );
}
function archived(project) {
  return Boolean(project && (project.archived || project.isArchived || project.projectStatus === "Archived"));
}
function dateLabel(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function showMessage(text, type) {
  const message = document.getElementById("pageMessage");
  message.textContent = text;
  message.className = `message ${type}`;
}
function result(
  type,
  recordId,
  title,
  projectCode,
  description,
  owner,
  status,
  date,
  url,
  searchParts,
  updatedAt
) {
  const project = projectByCode(projectCode),
    programmeName = project?.programme || project?.workstream || "";
  return {
    type,
    recordId: recordId || "",
    title: title || "Untitled",
    programmeName,
    projectCode: projectCode || "",
    projectName: project?.projectName || "",
    description: description || "",
    owner: owner || "",
    status: status || "",
    date: date || "",
    url,
    archived: archived(project),
    updatedAt: updatedAt || "",
    searchText: [
      recordId,
      title,
      programmeName,
      projectCode,
      project?.projectName,
      description,
      owner,
      status,
      ...searchParts
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  };
}
function loadData() {
  const stored = rowsOf("projects"),
    storedProgrammes = rowsOf("programmes");
  projects = Array.isArray(stored) ? stored : [];
  programmes = Array.isArray(storedProgrammes) ? storedProgrammes : [];
  const rows = [];
  projects.forEach((project) =>
    rows.push(
      result(
        "Project",
        project.projectCode,
        project.projectName,
        project.projectCode,
        [
          project.alias,
          project.shortName,
          project.programme,
          project.workstream,
          project.portfolio,
          project.businessArea
        ]
          .filter(Boolean)
          .join(" · "),
        project.projectManager,
        project.projectStatus,
        project.forecastEndDate,
        `project-details.html?code=${encodeURIComponent(project.projectCode)}`,
        [
          project.alias,
          project.shortName,
          project.programme,
          project.workstream,
          project.sponsor,
          project.projectManager,
          project.projectLead,
          project.additionalStakeholders
        ],
        project.updatedAt
      )
    )
  );
  if (PPMAuth.can("portfolios.view"))
    (Array.isArray(rowsOf("portfolios")) ? rowsOf("portfolios") : []).forEach((item) =>
      rows.push(
        result(
          "Portfolio",
          item.portfolioId,
          item.name,
          "",
          [
            item.description,
            item.objectives,
            item.priorities,
            `Budget £${Number(item.budget || 0).toLocaleString("en-GB")}`
          ]
            .filter(Boolean)
            .join(" · "),
          item.owner,
          item.status,
          item.updatedAt?.slice(0, 10),
          `administration.html?tab=portfolios&item=${encodeURIComponent(item.portfolioId)}`,
          [item.executiveSponsor, item.currency, item.reportingCalendarId, item.lifecycleTemplateId],
          item.updatedAt
        )
      )
    );
  if (PPMAuth.can("administration.view"))
    (Array.isArray(rowsOf("lifecycleTemplates")) ? rowsOf("lifecycleTemplates") : []).forEach(
      (item) =>
        rows.push(
          result(
            "Lifecycle template",
            item.templateId,
            `${item.name} · v${Number(item.version || 1)}`,
            "",
            item.description,
            "",
            item.active === false ? "Retired" : item.isDefault ? "Default" : "Active",
            item.effectiveFrom,
            `administration.html?tab=lifecycles&item=${encodeURIComponent(item.templateId)}`,
            [
              ...(item.applicableProjectTypes || []),
              ...(item.stages || []).flatMap((stage) => [stage.name, stage.gateName, stage.description])
            ],
            item.updatedAt
          )
        )
    );
  rowsOf("stageGates").forEach((item) =>
    rows.push(
      result(
        "Stage gate",
        item.gateId,
        item.gateName,
        item.projectCode,
        [
          `${item.currentStage || ""} to ${item.proposedNextStage || "No progression"}`,
          item.submissionComments,
          item.approvalComments,
          item.conditions,
          item.rejectionDeferralReason,
          item.decisionSummary
        ]
          .filter(Boolean)
          .join(" · "),
        item.submissionOwner,
        item.workflowStatus,
        item.decisionDate || item.meetingDate || item.submissionDate,
        `stage-gates.html?code=${encodeURIComponent(item.projectCode || "")}&item=${encodeURIComponent(item.gateId || "")}`,
        [
          item.routeRequirement,
          item.routeReason,
          ...(item.requiredApprovers || []).flatMap((approver) => [
            approver.name,
            approver.email,
            approver.decision
          ]),
          ...(item.linkedActionIds || []),
          item.linkedDecisionId
        ],
        item.updatedAt
      )
    )
  );
  rowsOf("milestones").forEach((item) =>
    rows.push(
      result(
        "Milestone",
        item.milestoneId,
        item.milestoneName,
        item.projectCode || item.projectId,
        item.notes,
        "",
        item.status,
        item.forecastFinishDate || item.baselineFinishDate,
        `milestones.html?code=${encodeURIComponent(item.projectCode || item.projectId)}`,
        [item.milestoneType],
        item.updatedAt
      )
    )
  );
  rowsOf("raid").forEach((item) =>
    rows.push(
      result(
        "RAID",
        item.raidId,
        item.title,
        item.projectId || item.projectCode,
        item.description,
        item.owner,
        item.status,
        item.targetDate,
        `raid-log.html?code=${encodeURIComponent(item.projectId || item.projectCode)}&item=${encodeURIComponent(item.raidId || "")}`,
        [item.type, item.priority, item.comments, item.riskCause, item.riskEvent, item.riskEffect],
        item.updatedAt
      )
    )
  );
  rowsOf("actions").forEach((item) =>
    rows.push(
      result(
        "Action",
        item.actionId,
        item.description,
        item.projectCode || item.projectId,
        [item.source, item.completionCommentary, item.relatedRecords].filter(Boolean).join(" · "),
        item.owner,
        item.status,
        item.dueDate,
        `registers.html?tab=actions&item=${encodeURIComponent(item.actionId || "")}`,
        [item.supportingOwners, item.evidence],
        item.updatedAt
      )
    )
  );
  rowsOf("decisions").forEach((item) =>
    rows.push(
      result(
        "Decision",
        item.decisionId,
        item.decisionRequired,
        item.projectCode || item.projectId,
        [item.background, item.finalDecision, item.rationale].filter(Boolean).join(" · "),
        item.decisionOwner,
        item.status,
        item.requiredByDate || item.decisionDate,
        `registers.html?tab=decisions&item=${encodeURIComponent(item.decisionId || "")}`,
        [item.optionsConsidered, item.recommendation, item.impact],
        item.updatedAt
      )
    )
  );
  rowsOf("benefits").forEach((item) => {
    const row = result(
        "Benefit",
        item.benefitId,
        item.description,
        item.projectCode || item.projectId,
        [item.benefitType || item.type, item.targetValue || item.target, item.commentary]
          .filter(Boolean)
          .join(" · "),
        item.owner,
        item.status,
        item.targetRealisationDate || item.realisationDate,
        `benefits-management.html?item=${encodeURIComponent(item.benefitId || "")}`,
        [
          item.measurementMethod,
          item.dataSource,
          item.leadIndicators,
          item.evidence,
          item.programmeName,
          item.programmeId
        ],
        item.updatedAt
      ),
      programme = programmes.find((entry) => entry.programmeId === item.programmeId);
    row.programmeName = item.programmeName || programme?.name || row.programmeName;
    row.searchText = `${row.searchText} ${row.programmeName}`.trim().toLowerCase();
    rows.push(row);
  });
  rowsOf("documents").forEach((item) =>
    rows.push(
      result(
        "Document",
        item.documentId,
        item.title || item.name,
        item.projectCode || item.projectId,
        [item.documentType || item.type, item.version, item.notes].filter(Boolean).join(" · "),
        item.owner,
        item.status || item.approvalStatus,
        item.reviewDate || item.linkedDate,
        `registers.html?tab=documents&item=${encodeURIComponent(item.documentId || "")}`,
        [item.classification, item.link || item.url],
        item.updatedAt
      )
    )
  );
  rowsOf("financialEntries").forEach((item) =>
    rows.push(
      result(
        "Financial entry",
        item.financialEntryId,
        item.description,
        item.projectCode,
        [item.categoryName, item.financialPeriod, item.notes].filter(Boolean).join(" · "),
        "",
        `Forecast £${Number(item.forecastCost || 0).toLocaleString("en-GB")}`,
        item.financialPeriod ? `${item.financialPeriod}-01` : "",
        `financial-management.html?project=${encodeURIComponent(item.projectCode || "")}`,
        [item.budgetAmount, item.forecastCost, item.actualCost, item.committedCost],
        item.updatedAt
      )
    )
  );
  rowsOf("financialApprovals").forEach((item) =>
    rows.push(
      result(
        "Budget approval",
        item.approvalId,
        `${item.requestType || "Budget"} - £${Number(item.proposedBudget || 0).toLocaleString("en-GB")}`,
        item.projectCode,
        item.reason,
        item.approverName,
        item.status,
        String(item.requestedAt || "").slice(0, 10),
        `financial-management.html?project=${encodeURIComponent(item.projectCode || "")}`,
        [item.requesterName, item.decisionComments, item.currentApprovedBudget, item.changeAmount],
        item.updatedAt
      )
    )
  );
  indexRows = rows;
  populateFilters();
  renderResults();
}
function populateFilters() {
  const typeValue = document.getElementById("typeFilter").value,
    projectValue = document.getElementById("projectFilter").value;
  document.getElementById("typeFilter").innerHTML =
    '<option value="">All record types</option>' + types.map((type) => `<option>${type}</option>`).join("");
  document.getElementById("typeFilter").value = typeValue;
  document.getElementById("projectFilter").innerHTML =
    '<option value="">All projects</option>' +
    projects
      .slice()
      .sort((a, b) => String(a.projectCode).localeCompare(String(b.projectCode)))
      .map(
        (project) =>
          `<option value="${escapeHtml(project.projectCode)}">${escapeHtml(project.projectCode)} - ${escapeHtml(project.projectName || "Unnamed project")}</option>`
      )
      .join("");
  document.getElementById("projectFilter").value = projectValue;
}
function score(row, words) {
  return words.reduce(
    (score, word) =>
      score +
      (String(row.title).toLowerCase().includes(word) ? 4 : 0) +
      (String(row.recordId).toLowerCase().includes(word) ? 5 : 0) +
      (row.searchText.includes(word) ? 1 : 0),
    0
  );
}
function filteredRows() {
  const query = document.getElementById("searchQuery").value.trim().toLowerCase(),
    words = query.split(/\s+/).filter(Boolean),
    type = document.getElementById("typeFilter").value,
    project = document.getElementById("projectFilter").value,
    includeArchived = document.getElementById("includeArchived").value === "yes",
    sort = document.getElementById("sortBy").value;
  let rows = indexRows
    .filter(
      (row) =>
        (!words.length || words.every((word) => row.searchText.includes(word))) &&
        (!type || row.type === type) &&
        (!project || row.projectCode === project) &&
        (includeArchived || !row.archived)
    )
    .map((row) => ({ ...row, relevance: score(row, words) }));
  rows.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "type"
        ? a.type.localeCompare(b.type) || a.title.localeCompare(b.title)
        : sort === "updated"
          ? String(b.updatedAt).localeCompare(String(a.updatedAt))
          : b.relevance - a.relevance || a.title.localeCompare(b.title)
  );
  return rows;
}
function cell(row, key) {
  if (key === "type") return `<span class="badge">${escapeHtml(row.type)}</span>`;
  if (key === "title") return `<span class="result-title">${escapeHtml(row.title)}</span>`;
  if (key === "description")
    return `<div class="result-description">${escapeHtml(row.description || "No additional detail")}</div>`;
  if (key === "date") return escapeHtml(dateLabel(row.date));
  if (key === "open") return `<a class="result-link" href="${escapeHtml(row.url)}">Open</a>`;
  return escapeHtml(row[key] || "Not set");
}
function renderResults() {
  const rows = filteredRows(),
    group = document.getElementById("groupBy").value,
    cols = columns.filter((column) => visibleColumns.has(column.key));
  document.getElementById("resultHead").innerHTML =
    `<tr>${cols.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  let lastGroup = Symbol("none"),
    body = "";
  rows.forEach((row) => {
    const groupValue =
      group === "type"
        ? row.type
        : group === "programmeName"
          ? row.programmeName || "No programme"
          : group === "projectCode"
            ? row.projectCode || "No project"
            : "";
    if (group && groupValue !== lastGroup) {
      lastGroup = groupValue;
      body += `<tr class="group-row"><td colspan="${cols.length}">${escapeHtml(groupValue)}</td></tr>`;
    }
    body += `<tr>${cols.map((column) => `<td>${cell(row, column.key)}</td>`).join("")}</tr>`;
  });
  document.getElementById("resultBody").innerHTML = body;
  document.getElementById("emptyState").style.display = rows.length ? "none" : "block";
  const query = document.getElementById("searchQuery").value.trim();
  document.getElementById("resultSummary").textContent =
    `${rows.length} matching record${rows.length === 1 ? "" : "s"}${query ? ` for “${query}”` : " in the current filtered view"}.`;
}
function renderColumns() {
  document.getElementById("columnOptions").innerHTML = columns
    .map(
      (column) =>
        `<label class="column-option"><input type="checkbox" value="${escapeHtml(column.key)}" ${visibleColumns.has(column.key) ? "checked" : ""} ${column.key === "open" ? "disabled" : ""}>${escapeHtml(column.label)}</label>`
    )
    .join("");
  document.querySelectorAll("#columnOptions input").forEach((box) =>
    box.addEventListener("change", () => {
      if (box.checked) visibleColumns.add(box.value);
      else visibleColumns.delete(box.value);
      visibleColumns.add("open");
      renderResults();
    })
  );
}
/* Recent searches are per-person, per-browser scratch. No table, no collection - localStorage
   is the right home for them and they are read directly so it is obvious that it is. */
function recentSearches() {
  const values = PPMCore.readJson(RECENT_KEY, []);
  return Array.isArray(values) ? values : [];
}
function saveRecent(query) {
  if (!query) return;
  const values = [
    query,
    ...recentSearches().filter((value) => value.toLowerCase() !== query.toLowerCase())
  ].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(values));
  renderRecent();
}
function renderRecent() {
  const values = recentSearches();
  document.getElementById("recentSearches").innerHTML = values.length
    ? values
        .map(
          (value) => `<button type="button" data-query="${escapeHtml(value)}">${escapeHtml(value)}</button>`
        )
        .join("")
    : '<span class="result-summary">None yet</span>';
  document.querySelectorAll("[data-query]").forEach((button) =>
    button.addEventListener("click", () => {
      document.getElementById("searchQuery").value = button.dataset.query;
      renderResults();
    })
  );
}
/*
  Stage 16: saved search views are a database collection, not browser state.

  searchViews is one of the collections the child adapter owns and hydrates. This page wrote it
  with localStorage.setItem, which reached PostgreSQL only through the prototype patch; once that
  was removed the view was saved to the browser and nowhere else, and the next hydration replaced
  it with the database's copy - so saving or deleting a view appeared to work and did not last.
  The file was excused from the write-seam ratchet as "UI state only", which was true of its
  recent searches and its column choices, and not true of this.
*/
function views() {
  return PPMStore.searchViews.all();
}
function populateViews(selected = "") {
  document.getElementById("savedViewSelector").innerHTML =
    '<option value="">Current unsaved view</option>' +
    views()
      .sort(
        (a, b) =>
          (a.scope === "shared" ? -1 : 1) - (b.scope === "shared" ? -1 : 1) || a.name.localeCompare(b.name)
      )
      .map(
        (view) =>
          `<option value="${escapeHtml(view.viewId)}">${view.scope === "shared" ? "[Shared] " : ""}${escapeHtml(view.name)}</option>`
      )
      .join("");
  document.getElementById("savedViewSelector").value = selected;
  document.getElementById("deleteViewButton").disabled = !selected;
}
function currentView(id, name) {
  return {
    viewId: id || `SEARCH-VIEW-${Date.now()}`,
    name,
    scope: document.getElementById("viewScope").value,
    query: document.getElementById("searchQuery").value,
    recordType: document.getElementById("typeFilter").value,
    project: document.getElementById("projectFilter").value,
    includeArchived: document.getElementById("includeArchived").value,
    group: document.getElementById("groupBy").value,
    sort: document.getElementById("sortBy").value,
    columns: [...visibleColumns],
    publishedBy: document.getElementById("viewScope").value === "shared" ? "Current user" : "",
    publishedAt: document.getElementById("viewScope").value === "shared" ? new Date().toISOString() : "",
    updatedAt: new Date().toISOString()
  };
}
async function saveView() {
  const name = document.getElementById("viewName").value.trim();
  if (!name) {
    showMessage("Enter a name for this search view.", "error");
    return;
  }
  const items = views(),
    selected = document.getElementById("savedViewSelector").value,
    view = currentView(selected, name),
    index = items.findIndex((item) => item.viewId === view.viewId);
  if (index >= 0) items[index] = view;
  else items.push(view);
  const saved = await PPMStore.searchViews.replaceAll(items);
  if (!saved.ok) {
    showMessage(saved.message, saved.queued ? "warning" : "error");
    return;
  }
  populateViews(view.viewId);
  document.getElementById("viewMeta").textContent =
    view.scope === "shared"
      ? `Shared view published by ${view.publishedBy}. Filters, sorting, visible columns and grouping are retained.`
      : "Personal view. Filters, sorting, visible columns and grouping are retained.";
  showMessage(`${name} was ${view.scope === "shared" ? "published" : "saved"}.`, "success");
}
function loadView(id) {
  const view = views().find((item) => item.viewId === id);
  document.getElementById("deleteViewButton").disabled = !view;
  if (!view) {
    document.getElementById("viewMeta").textContent = "Current view is not saved.";
    return;
  }
  document.getElementById("viewName").value = view.name || "";
  document.getElementById("viewScope").value = view.scope || "personal";
  document.getElementById("searchQuery").value = view.query || "";
  document.getElementById("typeFilter").value = view.recordType || "";
  document.getElementById("projectFilter").value = view.project || "";
  document.getElementById("includeArchived").value = view.includeArchived || "no";
  document.getElementById("groupBy").value = view.group || "";
  document.getElementById("sortBy").value = view.sort || "relevance";
  visibleColumns = new Set(Array.isArray(view.columns) ? view.columns : columns.map((column) => column.key));
  visibleColumns.add("open");
  renderColumns();
  renderResults();
  document.getElementById("viewMeta").textContent =
    view.scope === "shared"
      ? `Shared view published by ${view.publishedBy || "an authorised user"}${view.publishedAt ? ` on ${new Date(view.publishedAt).toLocaleDateString("en-GB")}` : ""}.`
      : "Personal saved view.";
}
function askDelete() {
  const id = document.getElementById("savedViewSelector").value,
    view = views().find((item) => item.viewId === id);
  if (!view) return;
  pendingDeleteViewId = id;
  document.getElementById("deleteViewMessage").textContent =
    `Delete ${view.name}? This removes only the saved view and does not delete search results or source data.`;
  document.getElementById("deleteViewConfirmation").classList.add("visible");
}
function closeDelete() {
  pendingDeleteViewId = "";
  document.getElementById("deleteViewConfirmation").classList.remove("visible");
}
async function confirmDelete() {
  const id = pendingDeleteViewId,
    view = views().find((item) => item.viewId === id);
  if (!id) return;
  const saved = await PPMStore.searchViews.replaceAll(views().filter((item) => item.viewId !== id));
  if (!saved.ok) {
    showMessage(saved.message, saved.queued ? "warning" : "error");
    return;
  }
  closeDelete();
  populateViews();
  document.getElementById("viewName").value = "";
  document.getElementById("viewMeta").textContent = "Current view is not saved.";
  showMessage(`${view?.name || "View"} was deleted.`, "success");
}
document.getElementById("searchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveRecent(document.getElementById("searchQuery").value.trim());
  renderResults();
});
["searchQuery", "typeFilter", "projectFilter", "groupBy", "sortBy", "includeArchived"].forEach((id) =>
  document.getElementById(id).addEventListener(id === "searchQuery" ? "input" : "change", renderResults)
);
document.getElementById("refreshButton").addEventListener("click", () => {
  loadData();
  showMessage("Search data is up to date.", "success");
});
document.getElementById("saveViewButton").addEventListener("click", saveView);
document
  .getElementById("savedViewSelector")
  .addEventListener("change", (event) => loadView(event.target.value));
document.getElementById("deleteViewButton").addEventListener("click", askDelete);
document.getElementById("cancelDeleteView").addEventListener("click", closeDelete);
document.getElementById("confirmDeleteView").addEventListener("click", confirmDelete);
document.getElementById("deleteViewConfirmation").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDelete();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDelete();
});
renderColumns();
renderRecent();
populateViews();
loadData();
