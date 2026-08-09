(function () {
  "use strict";

  const STORAGE_KEY = "ppmAuditHistory";

  const readJson = (key, fallback) => PPMCore.readJson(key, fallback);

  function read() {
    const rows = readJson(STORAGE_KEY, []);
    return Array.isArray(rows) ? rows.filter(Boolean) : [];
  }

  function currentActor(explicitActor) {
    if (explicitActor && typeof explicitActor === "object") return normaliseActor(explicitActor);
    const sessionActor =
      readJsonFromStorage(sessionStorage, "ppmCurrentUser") ||
      readJsonFromStorage(localStorage, "ppmCurrentUser");
    return normaliseActor(sessionActor || { name: "Prototype user", role: "Prototype editor" });
  }

  function readJsonFromStorage(storage, key) {
    try {
      const value = storage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      return null;
    }
  }

  function normaliseActor(actor) {
    return {
      actorName: String(actor.name || actor.displayName || actor.resourceName || "Prototype user"),
      actorResourceId: String(actor.resourceId || actor.id || ""),
      actorEmail: String(actor.email || ""),
      actorRole: String(actor.role || actor.jobTitle || "")
    };
  }

  function serialise(value) {
    if (value === undefined || value === null) return "";
    if (Array.isArray(value)) return value.map(serialise).join(", ");
    if (typeof value === "object") {
      if (value.name) return String(value.name);
      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }
    return String(value);
  }

  function humanise(value) {
    const text = String(value || "")
      .replace(/([A-Z])/g, " $1")
      .replace(/[_-]+/g, " ")
      .trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Field";
  }

  function forProject(projectCode) {
    return read().filter(
      (entry) => String(entry.projectCode).toLowerCase() === String(projectCode || "").toLowerCase()
    );
  }

  /* ====================================================== Stage 11F: sources

     Until now this module was the Audit History page's only source, which meant
     the screen showed browser-local history while public.audit_log — the trail the
     browser has no privilege to insert, update or delete — went unread.

     There are three sources, and the difference between them is the point:

       verified    public.audit_log. Written by database triggers from the
                   authenticated identity. The browser cannot alter it. This is
                   evidence.
       imported    public.legacy_audit_history. Old browser history, deliberately
                   loaded into the database as historical context. Immutable now,
                   but it was never trustworthy, so it stays marked unverified.
       local       ppmAuditHistory in this browser. Compatibility only, kept while
                   modules still record here. Not evidence.

     readAll() merges them newest-first and tags every row, so the page can show
     the distinction rather than quietly blending them.
  ============================================================================ */
  const VERIFIED = "verified";
  const IMPORTED = "imported";
  const LOCAL = "local";

  function tag(entry, provenance) {
    return {
      ...entry,
      provenance,
      verified: provenance === VERIFIED
    };
  }

  async function readVerified(options) {
    if (!window.PPMDatabase || typeof PPMDatabase.getAuditTrail !== "function") return [];
    try {
      const rows = await PPMDatabase.getAuditTrail({ limit: Number(options?.limit) || 2000 });
      return rows.map((row) => tag(row, VERIFIED));
    } catch (error) {
      console.warn("PPMAudit: the verified server audit trail could not be read.", error);
      return [];
    }
  }

  /*
    Imported legacy rows come back through the generic child adapter, which already
    knows how to map legacy_audit_history back to this module's record shape — the
    Stage 9 table has a typed column per field, so the round trip is exact.
  */
  async function readImported() {
    if (!window.PPMChildDatabase || typeof PPMChildDatabase.get !== "function") return [];
    try {
      const result = await PPMChildDatabase.get("legacyAudit");
      if (!result?.ok) return [];
      const store = result.store;
      const rows = Array.isArray(store) ? store : [];
      return rows.map((row) => tag(row, IMPORTED));
    } catch (error) {
      console.warn("PPMAudit: imported legacy audit history could not be read.", error);
      return [];
    }
  }

  function readLocal() {
    return read().map((row) => tag(row, LOCAL));
  }

  async function readAll(options) {
    const [verified, imported] = await Promise.all([readVerified(options), readImported()]);
    const local = readLocal();

    /*
      A local row that has already been imported is the same event twice. Keyed on
      auditId, which survives the import, and the database copy wins because it can
      no longer be edited.
    */
    const seen = new Set([...verified, ...imported].map((row) => String(row.auditId)));
    const merged = [
      ...verified,
      ...imported,
      ...local.filter((row) => !seen.has(String(row.auditId)))
    ];

    merged.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
    return merged;
  }

  function sourceCounts(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return {
      verified: list.filter((row) => row.provenance === VERIFIED).length,
      imported: list.filter((row) => row.provenance === IMPORTED).length,
      local: list.filter((row) => row.provenance === LOCAL).length,
      total: list.length
    };
  }

  /*
    Stage 14: this module reads. It no longer writes.

    record(), recordMany() and compareAndRecord() were removed along with their 31
    call sites, and so was importLegacyToDatabase(), which existed to move
    pre-migration browser events into the database once.

    Everything is recorded by database triggers now, from the authenticated
    identity, into public.audit_log - which has no UPDATE or DELETE grant, so the
    application cannot alter or erase an entry. A browser-written copy could not
    make that claim, and having both meant the Audit History page had to explain
    which entries could be trusted.

    readLocal() and the LOCAL provenance tag are deliberately kept. A browser that
    was in use before this cleanup may still hold unverified events, and the honest
    thing is to keep showing them, clearly labelled, rather than quietly drop them.
  */
  window.PPMAudit = {
    storageKey: STORAGE_KEY,

    // reads
    read,
    readVerified,
    readImported,
    readLocal,
    readAll,
    forProject,
    sourceCounts,

    // provenance tags used by the Audit History page
    VERIFIED,
    IMPORTED,
    LOCAL,

    // formatting helpers
    currentActor,
    humanise,
    serialise
  };
})();
