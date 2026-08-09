"use strict";
const parameters = new URLSearchParams(location.search);
const el = (id) => document.getElementById(id);
const escapeHtml = PPMCore.escapeHtml;
let rows = [];
let activeView = "activity";

/* ------------------------------------------------------------ event kinds */

const EVENT_KINDS = [
  ["create", "Created"],
  ["update", "Updated"],
  ["status", "Status changes"],
  ["approval", "Approvals and decisions"],
  ["delete", "Deleted"],
  ["archive", "Archive / reopen"],
  ["access", "User access and sign-in"]
];

/* --------------------------------------------------------- Stage 11F: sources

   This page used to read one source: PPMAudit.read(), which is browser
   localStorage. public.audit_log — the trail written by database triggers, which
   the browser has no privilege to insert, update or delete — went unread. So the
   screen called "Audit History" was showing the one source that is not evidence.

   It now leads with the verified trail and labels every row by where it came from,
   because for an audit screen the provenance is part of the record:

     Verified          public.audit_log. Database-written. Cannot be altered here.
     Legacy (imported) public.legacy_audit_history. Old browser history kept as
                       historical context. Immutable now, but never verifiable.
     Legacy (browser)  still only in this browser's localStorage.

   Blending them without saying which is which would be the actual failure, so
   there is a filter and a per-row tag rather than a single merged list.
--------------------------------------------------------------------------- */

const SOURCE_KINDS = [
  ["verified", "Verified (database)"],
  ["imported", "Legacy (imported)"],
  ["local", "Legacy (this browser)"]
];

const SOURCE_LABELS = {
  verified: { short: "Verified", title: "Written by the database from your authenticated identity. Cannot be edited or deleted from the browser." },
  imported: { short: "Legacy", title: "Pre-migration browser history, imported into the database as historical context. Immutable now, but it was never verifiable." },
  local: { short: "Unverified", title: "Recorded in this browser only. Compatibility history, not evidence." }
};

function sourceOf(row) {
  return row.provenance || (row.verified ? "verified" : "local");
}

function sourceTag(row) {
  const kind = sourceOf(row);
  const meta = SOURCE_LABELS[kind] || SOURCE_LABELS.local;
  return `<span class="source-tag ${kind}" title="${escapeHtml(meta.title)}">${escapeHtml(meta.short)}</span>`;
}

function actionKind(row) {
  const value = `${row.action} ${row.approvalStatusFrom} ${row.approvalStatusTo}`.toLowerCase();
  const statusMoved =
    String(row.statusFrom || "") !== String(row.statusTo || "") && Boolean(row.statusFrom || row.statusTo);
  if (row.entityType === "User access" || value.includes("signed in") || value.includes("signed out"))
    return "access";
  if (value.includes("approv") || value.includes("reject") || value.includes("defer") || row.approvalId)
    return "approval";
  if (value.includes("delet") || value.includes("remove")) return "delete";
  if (value.includes("archive") || value.includes("reopen")) return "archive";
  if (
    value.includes("creat") ||
    value.includes("rais") ||
    value.includes("duplicat") ||
    value.includes("added")
  )
    return "create";
  if (value.includes("status") || statusMoved) return "status";
  return "update";
}

/* ------------------------------------------------- reusable multi-select */

// Turns an empty <div class="multi"> into a checkbox dropdown.
// Read the current selection back with selectedValues(id).
function buildMultiSelect(id, options, preselected) {
  const host = el(id);
  const chosen = new Set(preselected || []);
  host.innerHTML = `<button type="button" class="multi-toggle" aria-expanded="false"><span class="multi-label"></span></button>
        <div class="multi-panel" role="group">
          ${options.map(([value, label]) => `<label class="multi-option"><input type="checkbox" value="${escapeHtml(value)}"${chosen.has(value) ? " checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("") || '<div class="multi-option">Nothing recorded yet</div>'}
          <div class="multi-actions"><button type="button" data-multi="all">Select all</button><button type="button" data-multi="none">Clear</button></div>
        </div>`;

  const toggle = host.querySelector(".multi-toggle");
  const label = host.querySelector(".multi-label");
  const boxes = [...host.querySelectorAll('input[type="checkbox"]')];

  function refreshLabel() {
    const picked = boxes.filter((box) => box.checked);
    const placeholder = host.dataset.placeholder || "All";
    label.textContent = !picked.length
      ? placeholder
      : picked.length === 1
        ? picked[0].parentElement.textContent.trim()
        : `${picked.length} selected`;
    toggle.classList.toggle("has-selection", picked.length > 0);
  }

  toggle.addEventListener("click", () => {
    const willOpen = !host.classList.contains("open");
    document.querySelectorAll(".multi.open").forEach((other) => other.classList.remove("open"));
    host.classList.toggle("open", willOpen);
    toggle.setAttribute("aria-expanded", String(willOpen));
  });
  boxes.forEach((box) =>
    box.addEventListener("change", () => {
      refreshLabel();
      render();
    })
  );
  host.querySelector('[data-multi="all"]').addEventListener("click", () => {
    boxes.forEach((box) => {
      box.checked = true;
    });
    refreshLabel();
    render();
  });
  host.querySelector('[data-multi="none"]').addEventListener("click", () => {
    boxes.forEach((box) => {
      box.checked = false;
    });
    refreshLabel();
    render();
  });
  refreshLabel();
}

function selectedValues(id) {
  return [...el(id).querySelectorAll('input[type="checkbox"]:checked')].map((box) => box.value);
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".multi"))
    document.querySelectorAll(".multi.open").forEach((host) => host.classList.remove("open"));
});

/* -------------------------------------------------------------- filtering */

function locationOf(row) {
  return PPMChangeLog.locationFor(row);
}

function filteredRows() {
  const search = el("searchInput").value.trim().toLowerCase();
  const project = el("projectFilter").value;
  const entities = new Set(selectedValues("entityFilter"));
  const kinds = new Set(selectedValues("actionFilter"));
  const places = new Set(selectedValues("locationFilter"));
  const sources = new Set(selectedValues("sourceFilter"));
  const from = el("dateFrom").value;
  const to = el("dateTo").value;

  return rows
    .filter((row) => {
      const place = locationOf(row);
      const haystack = [
        row.projectCode,
        row.entityType,
        row.entityId,
        row.action,
        row.summary,
        row.actorName,
        row.actorEmail,
        place.label,
        ...(row.changes || []).flatMap((change) => [change.label, change.before, change.after])
      ]
        .join(" ")
        .toLowerCase();
      const date = String(row.timestamp || "").slice(0, 10);
      return (
        (!search || haystack.includes(search)) &&
        (!project || row.projectCode === project) &&
        (!entities.size || entities.has(row.entityType)) &&
        (!kinds.size || kinds.has(actionKind(row))) &&
        (!places.size || places.has(place.label)) &&
        (!sources.size || sources.has(sourceOf(row))) &&
        (!from || date >= from) &&
        (!to || date <= to)
      );
    })
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

/* ------------------------------------------------------------- formatting */

function dateTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString("en-GB");
}

// A short preview of the cells that moved, so the table itself answers
// "what changed" without needing the detail panel opened.
function cellPreview(row) {
  const changes = Array.isArray(row.changes) ? row.changes : [];
  if (!changes.length) return '<span class="muted">No field-level changes recorded</span>';
  const shown = changes
    .slice(0, 3)
    .map(
      (change) =>
        `<div><b>${escapeHtml(change.label || change.field)}</b>: <span class="old-value">${escapeHtml(change.before || "Not set")}</span> &rarr; <span class="new-value">${escapeHtml(change.after || "Not set")}</span></div>`
    )
    .join("");
  const remaining = changes.length - 3;
  return `<div class="cell-preview">${shown}${remaining > 0 ? `<div class="muted">and ${remaining} more cell${remaining === 1 ? "" : "s"}</div>` : ""}</div>`;
}

function locationCell(row) {
  const place = locationOf(row);
  const text = escapeHtml(place.label);
  const link = place.href ? `<a href="${escapeHtml(place.href)}">${text}</a>` : text;
  return `${link}<span class="muted"><span class="area-tag">${escapeHtml(place.area)}</span></span>`;
}

/* ---------------------------------------------------------------- render */

function renderActivity(shown) {
  el("auditBody").innerHTML = shown
    .map(
      (row) => `<tr>
        <td><strong>${dateTime(row.timestamp)}</strong>${sourceTag(row)}<span class="muted">${escapeHtml(row.auditId)}</span></td>
        <td>${row.projectCode ? `<a href="project-details.html?code=${encodeURIComponent(row.projectCode)}"><strong>${escapeHtml(row.projectCode)}</strong></a>` : "Portfolio-wide"}</td>
        <td>${escapeHtml(row.entityType || "Record")}</td>
        <td>${escapeHtml(row.entityId || "—")}</td>
        <td><span class="badge ${actionKind(row)}">${escapeHtml(row.action)}</span>${String(row.statusFrom || "") !== String(row.statusTo || "") && (row.statusFrom || row.statusTo) ? `<span class="muted">${escapeHtml(row.statusFrom || "Not set")} &rarr; ${escapeHtml(row.statusTo || "Not set")}</span>` : ""}</td>
        <td>${escapeHtml(row.summary || "No summary recorded")}${cellPreview(row)}</td>
        <td><strong>${escapeHtml(row.actorName || "Unknown")}</strong><span class="muted">${escapeHtml(row.actorRole || row.actorEmail || "Identity not recorded")}</span></td>
        <td>${locationCell(row)}</td>
        <td><button class="button light detail-button" type="button" data-audit-id="${escapeHtml(row.auditId)}">View changes</button></td>
      </tr>`
    )
    .join("");
  document
    .querySelectorAll(".detail-button")
    .forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.auditId)));
}

// Groups the filtered events by the record they belong to, so a single row's
// whole life can be read at once instead of a stream of unrelated events.
function renderRecords(shown) {
  const groups = new Map();
  shown.forEach((row) => {
    const key = `${row.entityType}||${row.entityId}`;
    const group = groups.get(key) || {
      entityType: row.entityType,
      entityId: row.entityId,
      projectCode: row.projectCode,
      events: 0,
      cells: 0,
      last: row,
      name: ""
    };
    group.events += 1;
    group.cells += (row.changes || []).length;
    if (String(row.timestamp) > String(group.last.timestamp)) group.last = row;
    if (!group.projectCode && row.projectCode) group.projectCode = row.projectCode;
    if (!group.name) {
      const naming = (row.changes || []).find((change) =>
        /name|title|description|milestone|task|programme/i.test(change.label || "")
      );
      group.name = naming ? naming.after || naming.before || "" : "";
    }
    groups.set(key, group);
  });

  const list = [...groups.values()].sort((a, b) =>
    String(b.last.timestamp).localeCompare(String(a.last.timestamp))
  );
  el("recordsBody").innerHTML = list
    .map(
      (group) => `<tr>
        <td><strong>${escapeHtml(group.entityType || "Record")}</strong><span class="muted"><span class="area-tag">${escapeHtml(locationOf(group.last).area)}</span></span></td>
        <td>${escapeHtml(group.entityId || "—")}</td>
        <td>${escapeHtml(group.name || group.last.summary || "—")}</td>
        <td>${group.projectCode ? `<a href="project-details.html?code=${encodeURIComponent(group.projectCode)}">${escapeHtml(group.projectCode)}</a>` : "Portfolio-wide"}</td>
        <td><strong>${group.events}</strong></td>
        <td>${group.cells}</td>
        <td>${dateTime(group.last.timestamp)}</td>
        <td>${escapeHtml(group.last.actorName || "Unknown")}</td>
        <td>${PPMChangeLog.historyButton(group.entityType, group.entityId, group.name || group.entityId)}</td>
      </tr>`
    )
    .join("");
  return list.length;
}

function render() {
  const shown = filteredRows();
  const isActivity = activeView === "activity";
  el("activityTable").hidden = !isActivity;
  el("recordsTable").hidden = isActivity;

  if (isActivity) renderActivity(shown);
  else renderRecords(shown);

  el("emptyState").style.display = shown.length ? "none" : "block";
  el("eventCount").textContent = shown.length;
  el("recordCount").textContent = new Set(shown.map((row) => `${row.entityType}||${row.entityId}`)).size;
  el("cellCount").textContent = shown.reduce((total, row) => total + (row.changes || []).length, 0);
  el("actorCount").textContent = new Set(shown.map((row) => row.actorName).filter(Boolean)).size;
  el("latestEvent").textContent = shown.length ? dateTime(shown[0].timestamp) : "No events";

  // How much of what is on screen is actually evidence.
  const counts = PPMAudit.sourceCounts(shown);
  el("verifiedCount").textContent = counts.verified;
  el("verifiedNote").textContent = counts.total
    ? `of ${counts.total} shown · ${counts.imported + counts.local} legacy`
    : "no events shown";
}

/* --------------------------------------------------------------- filters */

function populateFilters() {
  const projects = [...new Set(rows.map((row) => row.projectCode).filter(Boolean))].sort();
  el("projectFilter").innerHTML =
    '<option value="">All projects</option>' +
    projects.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  const requestedProject = parameters.get("project") || "";
  if (projects.includes(requestedProject)) el("projectFilter").value = requestedProject;

  const entities = [...new Set(rows.map((row) => row.entityType).filter(Boolean))].sort();
  const requestedEntity = parameters.get("entity") || "";
  buildMultiSelect(
    "entityFilter",
    entities.map((value) => [value, value]),
    entities.includes(requestedEntity) ? [requestedEntity] : []
  );

  buildMultiSelect("actionFilter", EVENT_KINDS, []);

  const places = [...new Set(rows.map((row) => locationOf(row).label).filter(Boolean))].sort();
  buildMultiSelect(
    "locationFilter",
    places.map((value) => [value, value]),
    []
  );

  // Only offer the sources actually present, so the filter never lists an empty option.
  const present = new Set(rows.map(sourceOf));
  buildMultiSelect(
    "sourceFilter",
    SOURCE_KINDS.filter(([value]) => present.has(value)),
    []
  );

  el("searchInput").value = parameters.get("item") || "";
}

/* ---------------------------------------------------------------- detail */

function openDetail(id) {
  const row = rows.find((item) => item.auditId === id);
  if (!row) return;
  const place = locationOf(row);
  const changes = Array.isArray(row.changes) ? row.changes : [];
  const from = row.approvalStatusFrom || row.statusFrom || "";
  const to = row.approvalStatusTo || row.statusTo || "";
  const movement =
    from !== to && (from || to) ? `${from || "Not set"} → ${to || "Not set"}` : "No status movement";

  el("detailTitle").textContent = `${row.action} · ${row.entityId || row.entityType}`;
  el("detailSummary").textContent = row.summary || "Audit event details";
  el("detailBody").innerHTML = `<div class="detail-grid">
          <div class="detail-card"><span>Date and time</span><strong>${dateTime(row.timestamp)}</strong></div>
          <div class="detail-card"><span>Project</span><strong>${escapeHtml(row.projectCode || "Portfolio-wide")}</strong></div>
          <div class="detail-card"><span>Record</span><strong>${escapeHtml(row.entityType)} · ${escapeHtml(row.entityId || "No ID")}</strong></div>
          <div class="detail-card"><span>Actor</span><strong>${escapeHtml(row.actorName || "Unknown")}<br>${escapeHtml(row.actorEmail || "")}</strong></div>
          <div class="detail-card"><span>Status movement</span><strong>${escapeHtml(movement)}</strong></div>
          <div class="detail-card"><span>Changed in</span><strong>${escapeHtml(place.label)}</strong></div>
          <div class="detail-card"><span>Evidence</span><strong>${sourceTag(row)}<br><span class="muted regular">${escapeHtml((SOURCE_LABELS[sourceOf(row)] || SOURCE_LABELS.local).title)}</span></strong></div>
        </div>
        ${
          changes.length
            ? `<table class="change-table"><thead><tr><th>Cell</th>
<th>Previous value</th>
<th>New value</th></tr></thead><tbody>${changes
                .map(
                  (change) => `<tr><td><strong>${escapeHtml(change.label || change.field)}</strong></td>
<td class="old-value">${escapeHtml(change.before || "Not set")}</td>
<td class="new-value">${escapeHtml(change.after || "Not set")}</td></tr>`
                )
                .join("")}</tbody></table>`
            : '<div class="notice flush">This event records an action or approval without field-level changes.</div>'
        }
        ${row.metadata && Object.keys(row.metadata).length ? `<div class="metadata">Supporting details\n${escapeHtml(JSON.stringify(row.metadata, null, 2))}</div>` : ""}`;
  el("detailModal").classList.add("visible");
  document.body.style.overflow = "hidden";
}

function closeDetail() {
  el("detailModal").classList.remove("visible");
  document.body.style.overflow = "";
}

/* ---------------------------------------------------------------- export */

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportCsv() {
  const header = [
    "Audit ID",
    "Evidence",
    "Timestamp",
    "Project ID",
    "Record type",
    "Record ID",
    "Event",
    "Event category",
    "Summary",
    "Actor",
    "Actor email",
    "Actor role",
    "Status from",
    "Status to",
    "Approval from",
    "Approval to",
    "Changed in",
    "Area",
    "Cells changed"
  ];
  const lines = [header.map(csvCell).join(",")];
  filteredRows().forEach((row) => {
    const place = locationOf(row);
    lines.push(
      [
        row.auditId,
        (SOURCE_LABELS[sourceOf(row)] || SOURCE_LABELS.local).short,
        row.timestamp,
        row.projectCode,
        row.entityType,
        row.entityId,
        row.action,
        actionKind(row),
        row.summary,
        row.actorName,
        row.actorEmail,
        row.actorRole,
        row.statusFrom,
        row.statusTo,
        row.approvalStatusFrom,
        row.approvalStatusTo,
        place.label,
        place.area,
        (row.changes || [])
          .map((change) => `${change.label}: ${change.before || "Not set"} -> ${change.after || "Not set"}`)
          .join(" | ")
      ]
        .map(csvCell)
        .join(",")
    );
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ppm-audit-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ------------------------------------------------------------------ wire */

["searchInput", "projectFilter", "dateFrom", "dateTo"].forEach((id) =>
  el(id).addEventListener(id === "searchInput" ? "input" : "change", render)
);

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((other) => other.classList.toggle("active", other === tab));
    activeView = tab.dataset.view;
    render();
  })
);

el("clearFilters").addEventListener("click", () => {
  ["searchInput", "projectFilter", "dateFrom", "dateTo"].forEach((id) => {
    el(id).value = "";
  });
  ["entityFilter", "actionFilter", "locationFilter", "sourceFilter"].forEach((id) => {
    el(id)
      .querySelectorAll('input[type="checkbox"]')
      .forEach((box) => {
        box.checked = false;
      });
    const toggle = el(id).querySelector(".multi-toggle");
    toggle.classList.remove("has-selection");
    toggle.querySelector(".multi-label").textContent = el(id).dataset.placeholder || "All";
  });
  history.replaceState({}, "", location.pathname);
  render();
});

el("exportButton").addEventListener("click", exportCsv);
el("closeDetail").addEventListener("click", closeDetail);
el("detailModal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeDetail();
});
/* ------------------------------------------------------------------- load

   Reading the verified trail is a network call, and the page scripts are
   synchronous, so this paints twice on purpose: local history immediately so the
   screen is never blank, then the merged verified view when it arrives.

   If the server read fails the local view simply stays, with every row honestly
   tagged unverified. Failing to a blank audit screen would be worse than showing
   what is available and saying what it is.
*/
async function load() {
  rows = PPMAudit.readLocal();
  populateFilters();
  render();

  el("sourceNotice").hidden = false;
  el("sourceNotice").textContent = "Loading the verified server audit trail…";

  try {
    rows = await PPMAudit.readAll();
    populateFilters();
    render();

    const counts = PPMAudit.sourceCounts(rows);
    if (!counts.verified && !counts.imported) {
      el("sourceNotice").innerHTML =
        "<strong>No verified server audit entries are visible.</strong> Either nothing has been changed in the " +
        "database yet, or your role cannot see these records. Everything below is unverified browser history.";
    } else if (counts.local) {
      /*
        Nothing writes browser-side audit any more, so a non-zero local count is
        residue from before the cleanup: unverifiable by definition and superseded by
        the verified trail beside it. Offering the clear-down here rather than only in
        Administration is deliberate - this is the one screen where somebody is
        looking at the entries and can see what they would be removing.
      */
      el("sourceNotice").innerHTML =
        `<strong>${counts.verified} verified</strong> database entr${counts.verified === 1 ? "y" : "ies"}, ` +
        `${counts.imported} imported legacy record${counts.imported === 1 ? "" : "s"}, and ` +
        `<strong>${counts.local} unverified event${counts.local === 1 ? "" : "s"} still held only in this browser</strong>. ` +
        "Nothing writes browser-side audit any more, so these are left over from before the audit cleanup. " +
        "They are kept visible rather than dropped, but they are not evidence and can be cleared once saved. " +
        '<button id="clearLocalAudit" class="button light" type="button">Download and clear them</button>';
      wireLocalAuditClear();
    } else {
      el("sourceNotice").hidden = true;
    }
  } catch (error) {
    console.warn("Audit History: the verified trail could not be loaded.", error);
    el("sourceNotice").innerHTML =
      "<strong>The verified server audit trail could not be read.</strong> Showing this browser's unverified " +
      "history only. Check your connection and reload.";
  }
}

/*
  Downloads the residue as a file and empties the key, then reloads the view so the
  count and the notice both reflect reality immediately.

  The confirmation is worth having even though the events are unverifiable: they are
  still the only copy of what somebody's browser recorded, and a file that failed to
  download is not obvious. archiveAndClearLocalAudit() clears only after the download
  succeeds, so declining or blocking it loses nothing.
*/
function wireLocalAuditClear() {
  const button = el("clearLocalAudit");
  if (!button || button.dataset.wired === "true") return;
  button.dataset.wired = "true";

  button.addEventListener("click", () => {
    const held = PPMData.localAuditCount();
    const proceed = window.confirm(
      `Download ${held} unverified event${held === 1 ? "" : "s"} as a file and remove them from this browser?\n\n` +
        "The verified database audit trail is not affected. This only clears entries that were recorded in " +
        "this browser before the audit cleanup."
    );
    if (!proceed) return;

    const result = PPMData.archiveAndClearLocalAudit();
    if (!result.cleared) {
      window.alert(result.message);
      return;
    }
    load();
  });
}

addEventListener("ppm-audit-recorded", () => {
  load();
});

load();
