/*
  PPM Data Safety
  ---------------
  STAGE 12F REWROTE WHAT THIS MODULE IS FOR.

  It was written when localStorage WAS the database. Its original opening line —
  "everything in this tool lives in the browser's local storage ... there is no
  server copy" — was true then and is false now, and leaving it there would have
  been the most misleading sentence in the codebase: every business collection now
  lives in PostgreSQL, and localStorage holds a hydrated mirror of it.

  So the two jobs have changed:

  1. THE BROWSER EXPORT IS NO LONGER THE BACKUP.
     PostgreSQL is. exportAll() produces a useful point-in-time snapshot you can
     read, diff or archive — it is NOT a disaster-recovery artefact, and restoring
     it is no longer a recovery. See STAGE-12F-BACKUP-RESTORE.md for what actually
     protects the data.

  2. RESTORE HAD BECOME DANGEROUS.
     Restore writes past every write-through seam, so for a database-backed
     collection it loads stale records the database knows nothing about. The next
     page load hydrates over them, so it looks like nothing happened — but until
     then the screen shows old data, and any edit made against it IS written
     through. A restore could therefore overwrite newer database state indirectly,
     through the user, one record at a time.

     Restoring database-backed collections is now refused, with a comparison
     report offered instead. Genuinely local keys still restore directly.

  Storage pressure is also much less of a concern than it was: the collections that
  used to fill the quota are in PostgreSQL now, and Stage 17 deleted the localStorage
  mirror entirely - hydration fills PPMStore in memory instead, so portfolio data no
  longer touches localStorage at all. What is left is preferences, saved views and
  historical local audit events. The quota guard stays because a full store still
  breaks saving, and a silent failure is still the worst outcome.

  This module therefore provides:
    - exportAll()                  a point-in-time snapshot file
    - compareBackup()              what a file would change, against live data
    - restoreLocalOnly()           restore the browser-only keys, always safe
    - restoreAll()                 full replace; refuses database-backed data
    - usage()                      what is stored and how close to full it is
    - archiveAuditHistory()        download old local audit events, then trim them
    - a guard on every write that turns a silent failure into a clear warning

  Load this BEFORE ppm-auth-utils.js, so the write guard sits underneath the
  permission-scoping layer and catches every write in the tool. That ordering is
  also what makes the captured native getItem/setItem genuinely native.
*/
(function () {
  "use strict";

  /*
    Format 2 adds provenance: which collections were database-backed when the
    snapshot was taken, and which Supabase project it mirrored. A format-1 file has
    no way to say that, so it cannot be told apart from a genuine full backup — and
    that is precisely the distinction a restore now turns on. Format 1 is still
    readable, and treated as "assume nothing".
  */
  const BACKUP_FORMAT = 2;
  const READABLE_FORMATS = new Set([1, 2]);
  const PREFIX = "ppm";

  // Browsers do not agree on a quota and none report it reliably, so treat 5 MB
  // as the working ceiling. Being conservative here is the safe direction.
  const ASSUMED_QUOTA_BYTES = 5 * 1024 * 1024;
  const WARN_AT = 0.7;
  const URGENT_AT = 0.85;

  const AUDIT_KEY = "ppmAuditHistory";

  // Keys that are per-person or per-session rather than portfolio data. They are
  // excluded from backups so restoring on another machine cannot overwrite
  // someone's own sign-in state, saved views or panel preferences.
  const PERSONAL_KEYS = new Set([
    "ppmAuthSession",
    "ppmCurrentUser",
    "ppmNotificationState",
    "ppmProjectDetailSections",
    "ppmProjectPlanColumnWidths",
    "ppmRecentSearches",
    "ppmReportSessionState",
    "ppmSuccessMessage",
    // Edits that have not reached the database from this browser. Restoring
    // somebody else's unsaved changes would be actively harmful.
    "ppmDatabasePending",
    /*
      Retired migration keys, still excluded on purpose.

      Stage 14 removed the code that wrote these: the per-collection source flags,
      the shadow-mode divergence log, and the copy the fast cutover kept of
      collections it discarded. They are kept in this list because an older backup
      taken before that cleanup may still contain them, and restoring one must not
      resurrect a source flag that the current code would not understand.
    */
    "ppmDatabaseSources",
    "ppmChildDatabaseSources",
    "ppmDatabaseDivergence",
    "ppmStage12Discarded"
  ]);

  // Saved report, search and resource views are portfolio content rather than
  // personal preference — they can be published to the whole team — so they are
  // deliberately NOT in the list above and are included in backups.

  /*
    Stage 3E: the application no longer stores passwords. Sign-in is handled by
    Supabase Auth with TOTP multi-factor authentication, so there is nothing
    credential-shaped left to export.

    These keys are retired rather than deleted from the code. Backups taken
    before Stage 3E can still contain ppmAuthCredentials, so both the export and
    the restore path must keep filtering the key out: exporting would put
    password hashes back into a file, and restoring would put a dead credential
    store back into the browser. Neither can be used to sign in any more, but
    neither should be carried forward either.
  */
  const RETIRED_CREDENTIAL_KEYS = new Set(["ppmAuthCredentials"]);

  /*
    Captured before any other module patches Storage. This file loads third, ahead
    of ppm-auth-utils.js, ppm-database.js and ppm-child-database.js, so these are
    genuinely the browser's own functions.

    Stage 12F: nativeGetItem is new, and its absence was a data-destruction bug.
    sizeOf() and buildBackup() called localStorage.getItem(), which ppm-auth-utils
    replaces with the project-scoping filter. So a user whose access was limited to
    some projects took a backup containing only those projects — and restoreAll()
    writes with the unfiltered nativeSetItem, which would then replace the whole
    store with that partial copy and destroy every record they could not see.

    The old code documented the right intent ("read past the permission filter") in
    a helper whose two branches were identical and both filtered. Intent in a
    comment is not a safeguard.
  */
  const nativeGetItem = Storage.prototype.getItem;
  const nativeSetItem = Storage.prototype.setItem;

  /* ------------------------------------------------------------------ usage */

  function read(key) {
    return nativeGetItem.call(localStorage, key);
  }

  function storedKeys() {
    return Object.keys(localStorage).filter((key) => key.startsWith(PREFIX));
  }

  /* ------------------------------------------------- Stage 12F: what is where

     Every business collection now lives in PostgreSQL. That changes what a browser
     backup is: it used to be the only copy of the portfolio, and it is now a
     convenience snapshot of a hydrated mirror.

     The distinction is asked of the adapters rather than hardcoded, so it cannot
     drift as collections move. A key is database-backed if its module currently
     reads from the database — which is also exactly the condition under which
     restoring it would be wrong.
  */
  /*
    Stage 14 changed how this is answered, and getting it wrong is a data-loss bug
    rather than a cosmetic one.

    It used to ask each adapter for the per-collection source flag. Those flags are
    gone, and a missing function would have made this return an empty set — which
    reads as "nothing is database-backed", which would have let restoreAll() replace
    live database-mirrored collections with a stale file without even warning. The
    safety check would have failed open.

    So the question is now the simpler true one: every collection either adapter
    knows about is database-backed, except those explicitly declared read-only
    historical data. It is still asked of the adapters rather than hardcoded here,
    so a new collection is covered the moment it is registered.

    If an adapter is not loaded at all, its keys are treated as database-backed
    rather than local. That is the safe direction: refusing a restore that might
    have been fine is recoverable, silently overwriting the database is not.
  */
  function databaseBackedKeys() {
    const keys = new Set();

    const foundation = window.PPMDatabase;
    if (foundation?.MODULES) {
      Object.keys(foundation.MODULES).forEach((name) => {
        const key = foundation.MODULES[name]?.localKey;
        if (key) keys.add(key);
      });
    }

    const child = window.PPMChildDatabase;
    if (child?.MODULES) {
      const readOnly = new Set(child.READ_ONLY_MODULES || []);
      Object.keys(child.MODULES).forEach((name) => {
        if (readOnly.has(name)) return;
        const key = child.MODULES[name]?.localKey;
        if (key) keys.add(key);
      });
    }

    /*
      Belt and braces: if neither adapter answered, fall back to the known mirror
      keys rather than declaring everything safe to overwrite. This list only has to
      be right about the big collections, because it is a floor and not the answer.
    */
    if (!keys.size) {
      [
        "ppmProjects",
        "ppmProgrammes",
        "ppmPortfolios",
        "ppmResources",
        "ppmProjectPlans",
        "ppmProjectMilestones",
        "ppmProjectRaid",
        "ppmProjectFinancials"
      ].forEach((key) => keys.add(key));
      console.warn(
        "PPMData: neither database adapter is loaded, so database-backed collections " +
          "were assumed rather than confirmed. Restore is deliberately being cautious."
      );
    }

    return keys;
  }

  function isDatabaseBacked(key) {
    return databaseBackedKeys().has(key);
  }

  function backupKeys() {
    return storedKeys().filter((key) => !PERSONAL_KEYS.has(key) && !RETIRED_CREDENTIAL_KEYS.has(key));
  }

  // A UTF-16 code unit is 2 bytes in most browsers' accounting, and the key
  // name counts too. This deliberately over-estimates rather than under.
  function sizeOf(key) {
    const value = read(key);
    return ((value ? value.length : 0) + key.length) * 2;
  }

  function usage() {
    const keys = storedKeys();
    const byKey = keys.map((key) => ({ key, bytes: sizeOf(key) })).sort((a, b) => b.bytes - a.bytes);
    const bytes = byKey.reduce((total, row) => total + row.bytes, 0);
    return {
      bytes,
      quota: ASSUMED_QUOTA_BYTES,
      percent: Math.min(100, Math.round((bytes / ASSUMED_QUOTA_BYTES) * 1000) / 10),
      byKey,
      level:
        bytes / ASSUMED_QUOTA_BYTES >= URGENT_AT
          ? "urgent"
          : bytes / ASSUMED_QUOTA_BYTES >= WARN_AT
            ? "warn"
            : "ok"
    };
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
    return `${Math.round(bytes / 104857.6) / 10} MB`;
  }

  /* ----------------------------------------------------------------- backup */

  function currentActorName() {
    const user = window.PPMAuth && window.PPMAuth.getCurrentUser ? window.PPMAuth.getCurrentUser() : null;
    return user ? user.fullName || user.email || user.resourceId : "Unknown user";
  }

  function countRecords(key, parsed) {
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed).reduce(
        (total, value) => total + (Array.isArray(value) ? value.length : 1),
        0
      );
    }
    return parsed === null || parsed === undefined ? 0 : 1;
  }

  /*
    Builds the backup object. Values are kept as their parsed form rather than
    as strings, so the file is readable and can be inspected or migrated into a
    database later without a second round of unescaping.
  */
  function buildBackup() {
    const data = {};
    const summary = [];
    backupKeys().forEach((key) => {
      const raw = read(key);
      const parsed = window.PPMCore ? PPMCore.parseJson(raw, raw) : safeParse(raw);
      data[key] = parsed;
      summary.push({ key, records: countRecords(key, parsed), bytes: sizeOf(key) });
    });

    const backed = databaseBackedKeys();

    /*
      Stage 16: the portfolio itself is exported here, separately and explicitly.

      Until the mirror was deleted, `data` above happened to contain every collection, because
      hydration left a copy of each one in localStorage under its legacy key. That made a backup
      look like a full export while being a snapshot of a cache - which is what snapshotOnly and
      the note below exist to admit.

      With the mirror gone, `data` is the seven browser-only keys and nothing else, so a backup
      would silently stop containing the portfolio at all. Reading it from PPMStore keeps the
      export as useful as it ever was and makes its status unambiguous: `data` is what a restore
      writes back, `collections` is a point-in-time copy for reference, and PostgreSQL remains
      the only place either of them can be restored to.
    */
    const collections = {};
    if (window.PPMStore) {
      window.PPMStore.collections().forEach((name) => {
        try {
          collections[name] = window.PPMStore[name].read();
        } catch (error) {
          console.error(`PPMData: "${name}" could not be included in the backup.`, error);
        }
      });
    }

    return {
      format: BACKUP_FORMAT,
      application: "Foresters Portfolio",
      createdAt: new Date().toISOString(),
      createdBy: currentActorName(),
      keyCount: Object.keys(data).length,
      summary: summary.sort((a, b) => b.bytes - a.bytes),

      /*
        Stage 12F provenance. Without this a reader cannot tell a snapshot of a
        database-backed mirror from a real full backup, which is the whole question
        a restore has to answer.
      */
      snapshotOnly: backed.size > 0,
      databaseBackedKeys: [...backed].sort(),
      databaseProject: (() => {
        try {
          return String(window.PPMSupabase?.supabaseUrl || "").replace(/^https?:\/\//, "");
        } catch (error) {
          return "";
        }
      })(),
      /* A read-only copy of the portfolio as this browser had loaded it. Restore never writes
         these back; they are here so the file is worth keeping. */
      collections,
      collectionCount: Object.keys(collections).length,
      note:
        backed.size > 0
          ? "Snapshot of a database-backed application. PostgreSQL is the authoritative copy. " +
            "`data` holds the browser-only settings a restore will write back; `collections` is a " +
            "point-in-time copy of the portfolio for reference and cannot be restored from this file."
          : "No collection was database-backed when this snapshot was taken.",
      // Kept in the file for format-1 compatibility with existing readers, but
      // now always false: backups no longer carry password material of any kind.
      containsCredentials: false,
      data
    };
  }

  function safeParse(value) {
    if (!value) return value;
    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }

  function download(text, fileName, type) {
    const blob = new Blob([text], { type: type || "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
  }

  function backupFileName() {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return `foresters-portfolio-backup-${stamp}.json`;
  }

  function exportAll() {
    const backup = buildBackup();
    download(JSON.stringify(backup, null, 2), backupFileName());
    return backup;
  }

  /* ---------------------------------------------------------------- restore */

  /*
    Checks a parsed file really is one of our backups before anything is written.
    Returns { valid, problems[], backup } so the caller can show the user what
    they are about to restore rather than asking them to trust a filename.
  */
  function inspectBackup(parsed) {
    const problems = [];
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { valid: false, problems: ["The file is not a Foresters Portfolio backup."], backup: null };
    }
    if (parsed.application !== "Foresters Portfolio") {
      problems.push("The file does not identify itself as a Foresters Portfolio backup.");
    }
    if (!READABLE_FORMATS.has(Number(parsed.format))) {
      problems.push(
        `The file uses backup format ${parsed.format}, and this version reads ` +
          `${[...READABLE_FORMATS].join(" or ")}.`
      );
    }
    if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
      problems.push("The file contains no data section.");
    } else {
      const foreign = Object.keys(parsed.data).filter((key) => !key.startsWith(PREFIX));
      if (foreign.length)
        problems.push(`The file contains ${foreign.length} unrecognised entries, which will be ignored.`);
      if (!Object.keys(parsed.data).length) problems.push("The file's data section is empty.");
    }
    return { valid: problems.length === 0, problems, backup: parsed };
  }

  function describeBackup(parsed) {
    const data = (parsed && parsed.data) || {};
    return Object.keys(data)
      .filter((key) => !RETIRED_CREDENTIAL_KEYS.has(key))
      .map((key) => ({ key, records: countRecords(key, data[key]) }))
      .sort((a, b) => b.records - a.records);
  }

  /* ------------------------------------------- Stage 12F: what restore now means

     When this module was written, localStorage WAS the database, so replacing it
     from a file was a complete and correct recovery. That is no longer true, and
     the same operation is now wrong in a way that is easy to miss.

     restoreAll() writes with nativeSetItem, captured before any adapter patched
     Storage. So a restore bypasses the write-through seams entirely: for a
     database-backed collection it puts stale records into localStorage that
     PostgreSQL knows nothing about. Nothing is pushed up, so it looks harmless —
     and then the next page load hydrates over it and the restore silently
     evaporates.

     The dangerous window is in between. Until that reload the screen shows stale
     data, and any edit made against it IS written through, so a restore can end up
     overwriting newer database state indirectly, through the user, one record at a
     time. That is worse than a loud failure.

     So a restore of database-backed collections is refused, and the user is offered
     what they actually need instead: a comparison against the live data. Keys that
     are genuinely local still restore directly, because for those a file really is
     the only copy.
  */
  function partitionBackup(parsed) {
    const data = (parsed && parsed.data) || {};
    const backed = databaseBackedKeys();
    const restorable = [];
    const databaseBacked = [];

    Object.keys(data).forEach((key) => {
      if (!key.startsWith(PREFIX) || PERSONAL_KEYS.has(key) || RETIRED_CREDENTIAL_KEYS.has(key)) return;
      if (backed.has(key)) databaseBacked.push(key);
      else restorable.push(key);
    });

    /*
      Named for what these keys ARE, not for what happened to them. An earlier
      version called the second list `refused`, which collided with the boolean
      `refused` flag that restoreAll returns alongside it — the spread overwrote the
      flag with an array, so a caller testing `result.refused === true` silently got
      a truthy array instead. Two different meanings on one name in one object.
    */
    return { restorable: restorable.sort(), databaseBacked: databaseBacked.sort() };
  }

  /*
    What a backup would change if it were applied, per database-backed collection.
    Record-count level rather than field level on purpose: this exists to answer
    "is this file older or newer than what we have", and a field-by-field diff of a
    whole portfolio is not something anyone reads.
  */
  function compareBackup(parsed) {
    const check = inspectBackup(parsed);
    if (!check.valid) throw new Error(check.problems.join(" "));

    const data = parsed.data || {};
    const rows = Object.keys(data)
      .filter((key) => key.startsWith(PREFIX) && !PERSONAL_KEYS.has(key) && !RETIRED_CREDENTIAL_KEYS.has(key))
      .map((key) => {
        const current = window.PPMCore ? PPMCore.parseJson(read(key), null) : safeParse(read(key));
        return {
          key,
          databaseBacked: isDatabaseBacked(key),
          inBackup: countRecords(key, data[key]),
          inBrowserNow: countRecords(key, current),
          identical: stableish(data[key]) === stableish(current)
        };
      })
      .sort((a, b) => Number(b.databaseBacked) - Number(a.databaseBacked) || a.key.localeCompare(b.key));

    console.group(`PPMData: backup taken ${parsed.createdAt || "at an unknown time"} compared with this browser`);
    console.table(rows);
    console.log(
      "Collections marked databaseBacked live in PostgreSQL. Restoring those from a file is refused — if the " +
        "file is right and the database is wrong, correct it in the application so the change is versioned and audited."
    );
    console.groupEnd();
    return rows;
  }

  function stableish(value) {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  /*
    Replaces the stored portfolio with the contents of a backup.

    A restore is destructive, so it takes a safety copy of the current data
    first and rolls back if anything fails part way through. Personal keys are
    never touched, so the person doing the restore stays signed in.

    Database-backed collections are refused unless { force: true } is passed, which
    is for one specific situation: you have deliberately reverted those collections
    to local first and want the file to become the local truth again.
  */
  function restoreAll(parsed, options) {
    const check = inspectBackup(parsed);
    if (!check.valid) throw new Error(check.problems.join(" "));

    const split = partitionBackup(parsed);
    if (split.databaseBacked.length && !options?.force) {
      const message =
        `This backup contains ${split.databaseBacked.length} collection(s) that now live in the database: ` +
        `${split.databaseBacked.join(", ")}.\n\n` +
        `Restoring them from a file would put stale records into this browser while PostgreSQL holds the ` +
        `current data. The next page load would discard them — but until then the screen would show old data, ` +
        `and any edit made against it would be written through and overwrite newer database state.\n\n` +
        `What to do instead:\n` +
        `  - see what actually differs:   PPMData.compareBackup(backup)\n` +
        `  - restore only the local keys: PPMData.restoreLocalOnly(backup)\n` +
        `  - if the file is right and the database is wrong, correct it in the application, so the change is ` +
        `versioned and audited like any other.\n\n` +
        `If you have deliberately reverted these collections to local first, pass { force: true }.`;
      console.error(`PPMData: REFUSING to restore.\n\n${message}`);
      return { refused: true, restored: 0, ...split, message };
    }

    const rollback = {};
    backupKeys().forEach((key) => {
      rollback[key] = read(key);
    });

    let restored = 0;
    try {
      Object.keys(rollback).forEach((key) => localStorage.removeItem(key));
      Object.entries(parsed.data).forEach(([key, value]) => {
        if (!key.startsWith(PREFIX) || PERSONAL_KEYS.has(key)) return;
        // A pre-Stage-3E backup can still contain ppmAuthCredentials. Dropping it
        // here is what stops a restore from putting a local password store back.
        if (RETIRED_CREDENTIAL_KEYS.has(key)) return;
        const text = typeof value === "string" ? value : JSON.stringify(value);
        nativeSetItem.call(localStorage, key, text);
        restored += 1;
      });
      RETIRED_CREDENTIAL_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      Object.entries(rollback).forEach(([key, value]) => {
        if (value !== null) nativeSetItem.call(localStorage, key, value);
      });
      throw new Error(
        `The restore failed and the previous data has been put back. ${error.message || "Unknown error."}`
      );
    }

    if (options?.force && split.databaseBacked.length)
      console.warn(
        `PPMData: ${split.databaseBacked.length} database-backed collection(s) were restored under force. ` +
          `Reload before editing, and check parity against the database — this browser and PostgreSQL now disagree.`
      );

    return { restored, refused: false, ...split };
  }

  /*
    Restores only the collections that genuinely live in this browser. Safe at any
    time, because for these keys the file really is the only copy.
  */
  function restoreLocalOnly(parsed) {
    const check = inspectBackup(parsed);
    if (!check.valid) throw new Error(check.problems.join(" "));

    const split = partitionBackup(parsed);
    const data = parsed.data || {};
    let restored = 0;

    split.restorable.forEach((key) => {
      const value = data[key];
      const text = typeof value === "string" ? value : JSON.stringify(value);
      nativeSetItem.call(localStorage, key, text);
      restored += 1;
    });

    console.info(
      `PPMData: restored ${restored} local collection(s). ` +
        (split.databaseBacked.length
          ? `${split.databaseBacked.length} database-backed collection(s) were left alone: ${split.databaseBacked.join(", ")}.`
          : "Nothing in this backup was database-backed.")
    );

    return { restored, skipped: split.databaseBacked };
  }

  /* -------------------------------------------------------- audit archiving */

  function auditEntries() {
    const raw = read(AUDIT_KEY);
    const rows = window.PPMCore ? PPMCore.parseJson(raw, []) : safeParse(raw) || [];
    return Array.isArray(rows) ? rows : [];
  }

  /*
    Audit history is append-only and is usually the largest thing stored. This
    downloads the oldest entries as their own file and then removes them, so
    nothing is lost but the tool keeps working.

    It never trims without producing the archive file first.
  */
  function archiveAuditHistory(keepMostRecent) {
    const keep = Math.max(0, Number(keepMostRecent) || 500);
    const rows = auditEntries();
    if (rows.length <= keep) {
      return { archived: 0, kept: rows.length, message: "There is nothing old enough to archive yet." };
    }

    const sorted = rows.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const toArchive = sorted.slice(0, sorted.length - keep);
    const toKeep = sorted.slice(sorted.length - keep);

    const archive = {
      format: BACKUP_FORMAT,
      application: "Foresters Portfolio",
      archiveOf: AUDIT_KEY,
      createdAt: new Date().toISOString(),
      createdBy: currentActorName(),
      entryCount: toArchive.length,
      coversFrom: toArchive[0] ? toArchive[0].timestamp : "",
      coversTo: toArchive[toArchive.length - 1] ? toArchive[toArchive.length - 1].timestamp : "",
      entries: toArchive
    };

    const stamp = new Date().toISOString().slice(0, 10);
    download(JSON.stringify(archive, null, 2), `foresters-portfolio-audit-archive-${stamp}.json`);

    nativeSetItem.call(localStorage, AUDIT_KEY, JSON.stringify(toKeep));

    return {
      archived: toArchive.length,
      kept: toKeep.length,
      message: `${toArchive.length} event(s) archived to a file and removed. ${toKeep.length} most recent event(s) kept.`
    };
  }

  /*
    Archive every remaining local audit event and clear the key.

    archiveAuditHistory() above exists for storage pressure, so it keeps the most
    recent 500 by design. This is a different job. Since Stage 14 nothing writes
    browser-side audit at all: every event is recorded by a database trigger into an
    append-only table. So anything still in ppmAuditHistory is residue from before
    that change - unverifiable by definition, superseded by the verified trail, and
    shown on the Audit History page labelled "Unverified" purely so it is not
    silently dropped.

    Once the file is downloaded there is no reason to keep it in the browser. The
    download happens first and the key is only cleared if it succeeded, so a blocked
    download cannot lose the events.
  */
  function archiveAndClearLocalAudit() {
    const rows = auditEntries();
    if (!rows.length) {
      return { archived: 0, cleared: false, message: "This browser holds no unverified audit events." };
    }

    const sorted = rows
      .slice()
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

    const archive = {
      format: BACKUP_FORMAT,
      application: "Foresters Portfolio",
      archiveOf: AUDIT_KEY,
      createdAt: new Date().toISOString(),
      createdBy: currentActorName(),
      entryCount: sorted.length,
      coversFrom: sorted[0]?.timestamp || "",
      coversTo: sorted[sorted.length - 1]?.timestamp || "",
      note:
        "Unverified audit events recorded in a browser before the audit cleanup. " +
        "Kept as historical context only: they were never independently verifiable. " +
        "The verified trail is public.audit_log in the database.",
      entries: sorted
    };

    const stamp = new Date().toISOString().slice(0, 10);
    try {
      download(JSON.stringify(archive, null, 2), `foresters-portfolio-unverified-audit-${stamp}.json`);
    } catch (error) {
      return {
        archived: 0,
        cleared: false,
        message: `The archive file could not be downloaded, so nothing was cleared: ${error?.message || error}`
      };
    }

    nativeSetItem.call(localStorage, AUDIT_KEY, JSON.stringify([]));

    return {
      archived: sorted.length,
      cleared: true,
      message:
        `${sorted.length} unverified event(s) downloaded and removed from this browser. ` +
        "The verified database trail is unaffected."
    };
  }

  /* How many unverified events this browser is still carrying. Used to decide
     whether to offer the clear-down at all. */
  function localAuditCount() {
    return auditEntries().length;
  }

  /* ------------------------------------------------------------ write guard */

  let quotaWarningShown = false;

  function isQuotaError(error) {
    if (!error) return false;
    return (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014
    );
  }

  /*
    A failed write used to disappear. Now it puts an unmissable message on the
    screen explaining what happened and offering the two things that fix it,
    then rethrows so no caller can mistake a failure for a successful save.
  */
  function showStorageFull() {
    if (quotaWarningShown || !document.body) return;
    quotaWarningShown = true;

    const panel = document.createElement("div");
    panel.className = "ppm-storage-full";
    panel.setAttribute("role", "alertdialog");
    panel.innerHTML = `
      <div class="ppm-storage-full-card">
        <h2>Your last change was not saved</h2>
        <p>
          Browser storage for this tool is full, so nothing more can be written. Nothing already saved has
          been lost, but any edit you have just made needs to be re-entered once space has been freed.
        </p>
        <p><strong>Do this now, in order:</strong></p>
        <ol>
          <li>Download a full backup and keep it somewhere safe.</li>
          <li>Archive the audit history — that frees the most space and keeps the events in a file.</li>
          <li>Re-enter the change you just made.</li>
        </ol>
        <div class="ppm-storage-full-actions">
          <button type="button" data-permission="none" id="ppmStorageFullBackup">Download backup</button>
          <button type="button" data-permission="none" id="ppmStorageFullArchive">Archive audit history</button>
          <button type="button" data-permission="none" id="ppmStorageFullClose" class="secondary">Close</button>
        </div>
      </div>`;
    document.body.appendChild(panel);

    panel.querySelector("#ppmStorageFullBackup").addEventListener("click", () => exportAll());
    panel.querySelector("#ppmStorageFullArchive").addEventListener("click", (event) => {
      const result = archiveAuditHistory(500);
      event.currentTarget.textContent = result.message;
    });
    panel.querySelector("#ppmStorageFullClose").addEventListener("click", () => {
      panel.remove();
      quotaWarningShown = false;
    });
  }

  Storage.prototype.setItem = function (key, value) {
    try {
      return nativeSetItem.call(this, key, value);
    } catch (error) {
      if (this === localStorage && isQuotaError(error)) showStorageFull();
      throw error;
    }
  };

  /* -------------------------------------------------------------- reporting */


  /* --------------------------------------------------------- warning banner */

  /*
    There used to be a styles() function here that injected a <style> element for the
    storage banner and the quota dialog. Those rules now live in ppm-shared.css,
    which every page loads, so there is nothing left to inject - and removing the
    empty function is better than leaving a no-op that reads like it still does
    something.
  */

  // Shows a quiet banner once storage passes the warning threshold, so the
  // problem is noticed long before a save is refused.
  function showBannerIfNeeded() {
    const state = usage();
    if (state.level === "ok") return;
    const main = document.querySelector("main");
    if (!main || document.querySelector(".ppm-storage-banner")) return;
    const banner = document.createElement("div");
    banner.className = `ppm-storage-banner${state.level === "urgent" ? " urgent" : ""}`;
    banner.innerHTML =
      `<span>Browser storage is <b>${state.percent}% full</b> (${formatBytes(state.bytes)} of about ${formatBytes(state.quota)}). ` +
      `${
        state.level === "urgent"
          ? "Saving will stop working soon. Take a backup and archive the audit history now."
          : "Take a backup soon, and archive the audit history to free space."
      }</span>` +
      `<a href="administration.html#data">Open data and backup</a>`;
    main.prepend(banner);
  }

  function initialise() {
    showBannerIfNeeded();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise);
  else initialise();

  window.PPMData = {
    BACKUP_FORMAT,
    PERSONAL_KEYS,
    RETIRED_CREDENTIAL_KEYS,
    usage,
    formatBytes,
    storedKeys,
    backupKeys,
    buildBackup,
    exportAll,
    inspectBackup,
    describeBackup,
    restoreAll,
    // Stage 12F
    READABLE_FORMATS,
    databaseBackedKeys,
    isDatabaseBacked,
    partitionBackup,
    compareBackup,
    restoreLocalOnly,
    auditEntries,
    archiveAuditHistory,
    // Stage 15: clear down pre-cleanup unverified audit residue
    localAuditCount,
    archiveAndClearLocalAudit,
    isQuotaError,
    showStorageFull
  };
})();
