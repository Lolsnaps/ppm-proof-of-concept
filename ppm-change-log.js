/*
  PPM Change Log
  --------------
  One shared layer for cell-level change history across every table in the tool.

  It does three jobs:

  1. LOCATIONS   Turns a record type into a plain-English "where was this changed"
                 label plus a link back to the screen that owns it, so the audit
                 trail never has to show a raw .html filename.

  2. TRACKING    trackCollection() / recordRow() diff a table's rows before and
                 after a save and write one audit event per changed record, with
                 the individual cells that moved.

  3. HISTORY UI  historyButton() renders a small clock icon for a table row, and
                 clicking it opens a shared timeline modal showing who changed
                 which cell, from what, to what, and when.

  Load this after ppm-audit-utils.js on any page with an editable table.
*/
(function () {
  "use strict";

  /* ---------------------------------------------------------------- locations */

  // area is used to group the "Changed in" filter on the Audit History page.
  const LOCATIONS = {
    Project: { label: "Project record", area: "Delivery", page: "project-details.html", param: "code" },
    "Project lifecycle": {
      label: "Project lifecycle",
      area: "Governance",
      page: "project-details.html",
      param: "code"
    },
    "Project plan item": {
      label: "Project plan",
      area: "Delivery",
      page: "project-plan.html",
      param: "code"
    },
    "Plan baseline approval": {
      label: "Project plan · baseline governance",
      area: "Governance",
      page: "project-plan.html",
      param: "code"
    },
    Milestone: { label: "Milestones", area: "Delivery", page: "milestones.html", param: "code" },
    "RAID item": { label: "RAID log", area: "Delivery", page: "raid-log.html", param: "code" },
    Action: { label: "Registers · actions", area: "Delivery", page: "registers.html", param: "project" },
    Decision: { label: "Registers · decisions", area: "Delivery", page: "registers.html", param: "project" },
    "Status report": {
      label: "Registers · status reports",
      area: "Delivery",
      page: "registers.html",
      param: "project"
    },
    Benefit: { label: "Benefits", area: "Delivery", page: "benefits-management.html", param: "project" },
    "Project document": {
      label: "Project details · documents",
      area: "Delivery",
      page: "project-details.html",
      param: "code"
    },
    "Stage gate": { label: "Stage gates", area: "Governance", page: "stage-gates.html", param: "code" },
    Programme: { label: "Programmes", area: "Governance", page: "programme.html", param: "" },
    "Programme milestone": {
      label: "Programmes · milestones",
      area: "Governance",
      page: "programme.html",
      param: ""
    },
    "Programme RAID": { label: "Programmes · RAID", area: "Governance", page: "programme.html", param: "" },
    "Financial entry": {
      label: "Financials · cost entries",
      area: "Finance",
      page: "financial-management.html",
      param: "project"
    },
    "Financial summary": {
      label: "Financials · project summary",
      area: "Finance",
      page: "financial-management.html",
      param: "project"
    },
    "Financial category": {
      label: "Financials · categories",
      area: "Finance",
      page: "financial-management.html",
      param: ""
    },
    "Financial approval": {
      label: "Financials · approvals",
      area: "Finance",
      page: "financial-management.html",
      param: "project"
    },
    Resource: { label: "Resource directory", area: "Resources", page: "resource-directory.html", param: "" },
    "Resource demand": {
      label: "Resource management · demand",
      area: "Resources",
      page: "resource-management.html",
      param: ""
    },
    "Resource absence": {
      label: "Resource management · availability",
      area: "Resources",
      page: "resource-management.html",
      param: ""
    },
    "Resource capacity": {
      label: "Resource management · capacity",
      area: "Resources",
      page: "resource-management.html",
      param: ""
    },
    "Resource scenario": {
      label: "Resource management · scenarios",
      area: "Resources",
      page: "resource-management.html",
      param: ""
    },
    Portfolio: {
      label: "Administration · portfolios",
      area: "Configuration",
      page: "administration.html",
      param: ""
    },
    "Lifecycle template": {
      label: "Administration · lifecycle templates",
      area: "Configuration",
      page: "administration.html",
      param: ""
    },
    "Lifecycle mandatory rule": {
      label: "Administration · mandatory information",
      area: "Configuration",
      page: "administration.html",
      param: ""
    },
    "Reference data": {
      label: "Administration · reference lists",
      area: "Configuration",
      page: "administration.html",
      param: ""
    },
    "RAG threshold": {
      label: "Administration · RAG thresholds",
      area: "Configuration",
      page: "administration.html",
      param: ""
    },
    "Reporting calendar": {
      label: "Administration · reporting calendars",
      area: "Configuration",
      page: "administration.html",
      param: ""
    },
    "Reporting period": {
      label: "Administration · reporting periods",
      area: "Configuration",
      page: "administration.html",
      param: ""
    },
    "User access": {
      label: "User access and permissions",
      area: "Access",
      page: "resource-directory.html",
      param: ""
    },
    /*
      Stage 11F. The server audit trail names records by database table, and those
      tables need somewhere to point. Added rather than approximated with an
      existing entry, so the label a reader sees is honest about what changed.
    */
    "Project status": {
      label: "Project status history",
      area: "Governance",
      page: "project-details.html",
      param: "code"
    },
    "Saved view": { label: "Saved views", area: "Other", page: "", param: "" },
    "Audit history": { label: "Audit history", area: "Governance", page: "audit-history.html", param: "" }
  };

  // Older audit rows only recorded a filename. Map those forward so history
  // written before this module existed still shows a sensible location.
  const PAGE_FALLBACK = {
    "project-plan.html": "Project plan",
    "milestones.html": "Milestones",
    "raid-log.html": "RAID log",
    "registers.html": "Registers",
    "benefits-management.html": "Benefits",
    "stage-gates.html": "Stage gates",
    "financial-management.html": "Financials",
    "resource-management.html": "Resource management",
    "resource-directory.html": "Resource directory",
    "programme.html": "Programmes",
    "administration.html": "Administration",
    "project-details.html": "Project details",
    "add-project.html": "Project record",
    "index.html": "Projects list",
    "reports.html": "Reports"
  };

  const ALLOWED_PAGES = new Set(Object.keys(PAGE_FALLBACK));

  function locationFor(entry) {
    const row = entry || {};
    const known = LOCATIONS[String(row.entityType || "")];
    if (known) {
      return {
        label: String(row.location || known.label),
        area: known.area,
        href: linkFor(known, row)
      };
    }
    const page = String(row.sourcePage || "")
      .split("?")[0]
      .split("/")
      .pop();
    return {
      label: String(row.location || PAGE_FALLBACK[page] || row.entityType || "Not recorded"),
      area: "Other",
      href: ALLOWED_PAGES.has(page) ? page : ""
    };
  }

  function linkFor(known, row) {
    if (!known.page) return "";
    const code = String(row.projectCode || "").trim();
    if (!known.param || !code) return known.page;
    return `${known.page}?${known.param}=${encodeURIComponent(code)}`;
  }

  function areas() {
    return [...new Set(Object.values(LOCATIONS).map((item) => item.area))].sort();
  }

  function locationLabels() {
    return [...new Set(Object.values(LOCATIONS).map((item) => item.label))].sort();
  }

  /* ----------------------------------------------------------------- tracking */

  function audit() {
    return window.PPMAudit || null;
  }

  function serialise(value) {
    return audit() ? audit().serialise(value) : String(value ?? "");
  }

  function asMap(source, idField) {
    if (source instanceof Map) return source;
    const map = new Map();
    (Array.isArray(source) ? source : []).forEach((row) => {
      if (row && row[idField]) map.set(String(row[idField]), row);
    });
    return map;
  }

  function resolve(value, row) {
    return typeof value === "function" ? value(row) : value;
  }

  function fieldKeys(fields) {
    return (fields || []).map((item) => (typeof item === "string" ? item : item && item.key)).filter(Boolean);
  }

  /*
    Diff a whole table in one call.

    trackCollection({
      before:      Map or Array of the rows as they were when the page loaded
      after:       Array of the rows as they are now
      idField:     "taskId"
      only:        optional Set of ids to consider (e.g. your dirty-row set)
      entityType:  "Project plan item"   (must match a LOCATIONS key)
      projectCode: "PRJ-001" or a function of the row
      fields:      ["taskName", {key:"status", label:"Status"}, ...]
      name:        function of the row returning its display name
      statusField: "status"  (optional, drives the status-movement columns)
      labels:      { created, updated, deleted } action-label overrides
    })
  */
  function trackCollection(options) {
    const settings = options || {};
    const log = audit();
    if (!log) return 0;

    const idField = settings.idField || "id";
    const before = asMap(settings.before, idField);
    const after = Array.isArray(settings.after) ? settings.after : [];
    const only = settings.only instanceof Set ? settings.only : null;
    const entityType = settings.entityType || "Record";
    const known = LOCATIONS[entityType] || {};
    const location = settings.location || known.label || entityType;
    const statusField = settings.statusField || "";
    const labels = settings.labels || {};
    const nameOf =
      settings.name || ((row) => String((row && (row.name || row.title)) || row?.[idField] || "Record"));
    let recorded = 0;

    const seen = new Set();

    after.forEach((row) => {
      const id = String(row?.[idField] || "");
      if (!id) return;
      seen.add(id);
      if (only && !only.has(id) && !only.has(row[idField])) return;
      const previous = before.get(id) || null;
      const label = nameOf(row);
      const created = !previous;
      const entry = log.compareAndRecord(previous, row, {
        projectCode: resolve(settings.projectCode, row) || "",
        entityType,
        entityId: id,
        location,
        action: created
          ? labels.created || `${entityType} created`
          : labels.updated || `${entityType} updated`,
        summary: created ? `${label} was added in ${location}.` : `${label} was updated in ${location}.`,
        fields: settings.fields,
        statusFrom: statusField ? serialise(previous?.[statusField]) : "",
        statusTo: statusField ? serialise(row[statusField]) : "",
        metadata: resolve(settings.metadata, row) || {},
        always: created
      });
      if (entry) recorded += 1;
    });

    before.forEach((row, id) => {
      if (seen.has(id)) return;
      if (only && !only.has(id)) return;
      const label = nameOf(row);
      log.record({
        projectCode: resolve(settings.projectCode, row) || "",
        entityType,
        entityId: id,
        location,
        action: labels.deleted || `${entityType} deleted`,
        summary: `${label} was deleted from ${location}.`,
        changes: log.diff(row, {}, settings.fields),
        statusFrom: statusField ? serialise(row[statusField]) : "",
        statusTo: statusField ? "Deleted" : "",
        metadata: resolve(settings.metadata, row) || {}
      });
      recorded += 1;
    });

    return recorded;
  }

  // Single-record version, for modal saves rather than grid saves.
  function recordRow(options) {
    const settings = options || {};
    const log = audit();
    if (!log) return null;
    const entityType = settings.entityType || "Record";
    const known = LOCATIONS[entityType] || {};
    const location = settings.location || known.label || entityType;
    const created = !settings.before;
    const label = settings.name || settings.entityId || "Record";
    const statusField = settings.statusField || "";
    return log.compareAndRecord(settings.before, settings.after, {
      projectCode: settings.projectCode || "",
      entityType,
      entityId: settings.entityId || "",
      location,
      action: settings.action || (created ? `${entityType} created` : `${entityType} updated`),
      summary:
        settings.summary ||
        (created ? `${label} was added in ${location}.` : `${label} was updated in ${location}.`),
      fields: settings.fields,
      statusFrom: statusField ? serialise(settings.before?.[statusField]) : "",
      statusTo: statusField ? serialise(settings.after?.[statusField]) : "",
      metadata: settings.metadata || {},
      always: created || Boolean(settings.always)
    });
  }

  function recordDeletion(options) {
    const settings = options || {};
    const log = audit();
    if (!log) return null;
    const entityType = settings.entityType || "Record";
    const known = LOCATIONS[entityType] || {};
    const location = settings.location || known.label || entityType;
    const label = settings.name || settings.entityId || "Record";
    return log.record({
      projectCode: settings.projectCode || "",
      entityType,
      entityId: settings.entityId || "",
      location,
      action: settings.action || `${entityType} deleted`,
      summary: settings.summary || `${label} was deleted from ${location}.`,
      changes: log.diff(settings.before, {}, settings.fields),
      statusFrom: settings.statusField ? serialise(settings.before?.[settings.statusField]) : "",
      statusTo: settings.statusField ? "Deleted" : "",
      metadata: settings.metadata || {}
    });
  }

  /* --------------------------------------------------------------- history UI */

  function historyFor(entityType, entityId) {
    const log = audit();
    if (!log) return [];
    const type = String(entityType || "").toLowerCase();
    const id = String(entityId || "").toLowerCase();
    return log
      .read()
      .filter(
        (row) =>
          String(row.entityType || "").toLowerCase() === type &&
          String(row.entityId || "").toLowerCase() === id
      )
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }

  const escapeHtml = PPMCore.escapeHtml;

  function dateTime(value) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? escapeHtml(value)
      : date.toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
  }

  /*
    Returns the markup for a per-row history button. Drop it into a table cell:

      `<td>${PPMChangeLog.historyButton("Milestone", milestone.milestoneId, milestone.milestoneName)}</td>`
  */
  function historyButton(entityType, entityId, name) {
    if (!entityId) return "";
    return `<button type="button" class="ppm-history-button" title="View change history"
      aria-label="View change history"
      data-history-type="${escapeHtml(entityType)}"
      data-history-id="${escapeHtml(entityId)}"
      data-history-name="${escapeHtml(name || "")}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path></svg></button>`;
  }

  function ensureShell() {
    if (document.getElementById("ppmHistoryModal")) return;

    /* Styles live in ppm-shared.css. They used to be injected as a <style>
       element here, which a browser treats as an inline style - and that is
       what forced style-src 'unsafe-inline' in the Content Security Policy. */

    const modal = document.createElement("div");
    modal.id = "ppmHistoryModal";
    modal.className = "ppm-history-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "ppmHistoryTitle");
    modal.innerHTML = `<div class="ppm-history-card">
      <div class="ppm-history-head"><h3 id="ppmHistoryTitle">Change history</h3><p id="ppmHistorySubtitle"></p></div>
      <div class="ppm-history-body" id="ppmHistoryBody"></div>
      <div class="ppm-history-foot"><a id="ppmHistoryFullLink" href="audit-history.html">Open the full audit trail</a><button type="button" class="ppm-history-close" id="ppmHistoryClose">Close</button></div>
    </div>`;
    document.body.appendChild(modal);

    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeHistory();
    });
    document.getElementById("ppmHistoryClose").addEventListener("click", closeHistory);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("visible")) closeHistory();
    });
  }

  function changeTable(entry) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    if (!changes.length) return "";
    return `<table class="ppm-history-cells"><tbody>${changes
      .map(
        (change) => `<tr>
      <th>${escapeHtml(change.label || change.field)}</th>
      <td><span class="ppm-history-old">${escapeHtml(change.before || "Not set")}</span>
      &nbsp;→&nbsp;<span class="ppm-history-new">${escapeHtml(change.after || "Not set")}</span></td>
    </tr>`
      )
      .join("")}</tbody></table>`;
  }

  function openHistory(entityType, entityId, name) {
    ensureShell();
    const entries = historyFor(entityType, entityId);
    const known = LOCATIONS[entityType] || {};
    document.getElementById("ppmHistoryTitle").textContent = name || entityId || "Change history";
    document.getElementById("ppmHistorySubtitle").textContent =
      `${entityType} · ${entityId} · ${entries.length} recorded change${entries.length === 1 ? "" : "s"} in ${known.label || entityType}`;
    document.getElementById("ppmHistoryFullLink").href =
      `audit-history.html?entity=${encodeURIComponent(entityType)}&item=${encodeURIComponent(entityId)}`;

    document.getElementById("ppmHistoryBody").innerHTML = entries.length
      ? entries
          .map(
            (entry) => `<article class="ppm-history-event">
          <div class="ppm-history-meta">
            <span class="ppm-history-action">${escapeHtml(entry.action || "Updated")}</span>
            <span class="ppm-history-when">${dateTime(entry.timestamp)}</span>
            <span class="ppm-history-who">by ${escapeHtml(entry.actorName || "Unknown user")}${entry.actorRole ? ` · ${escapeHtml(entry.actorRole)}` : ""}</span>
          </div>
          ${entry.summary ? `<p class="ppm-history-summary">${escapeHtml(entry.summary)}</p>` : ""}
          ${changeTable(entry)}
        </article>`
          )
          .join("")
      : '<div class="ppm-history-empty">No changes have been recorded against this record yet. History starts from the first edit saved after change tracking was enabled.</div>';

    document.getElementById("ppmHistoryModal").classList.add("visible");
    document.body.style.overflow = "hidden";
  }

  function closeHistory() {
    const modal = document.getElementById("ppmHistoryModal");
    if (!modal) return;
    modal.classList.remove("visible");
    document.body.style.overflow = "";
  }

  // One delegated listener covers every history button on the page, including
  // buttons added later when a table re-renders.
  function bindHistoryButtons() {
    if (document.body.dataset.ppmHistoryBound === "true") return;
    document.body.dataset.ppmHistoryBound = "true";
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-history-id]");
      if (!button) return;
      event.preventDefault();
      ensureShell();
      openHistory(button.dataset.historyType, button.dataset.historyId, button.dataset.historyName);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ensureShell();
      bindHistoryButtons();
    });
  } else {
    ensureShell();
    bindHistoryButtons();
  }

  window.PPMChangeLog = {
    LOCATIONS,
    locationFor,
    areas,
    locationLabels,
    trackCollection,
    recordRow,
    recordDeletion,
    historyFor,
    historyButton,
    openHistory,
    closeHistory
  };
})();
