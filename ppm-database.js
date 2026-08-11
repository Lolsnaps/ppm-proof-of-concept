/*
  PPM Database Adapter  (Stage 4)
  -------------------------------
  A read-only async layer over Supabase that returns records in the SAME shape
  the rest of the application already expects.

  WHY THIS EXISTS

  Every module currently reads localStorage synchronously:

      const projects = PPMAuth.readScoped("ppmProjects", []);

  The database is asynchronous and returns snake_case columns. Rewriting every
  module at once would be a rewrite, which the specification forbids. So this
  adapter sits in between and hands back legacy camelCase records:

      const projects = await PPMDatabase.getProjects();

  Stage 5 can then move one module at a time, and each move is a small edit
  rather than a redesign.

  HOW A RECORD IS BUILT

  Every imported row kept its complete original object in legacy_payload. The
  Stage 2B import normalised only some fields into real columns. So a record is
  assembled as:

      { ...legacy_payload, ...normalised columns that are not null }

  The columns win where they exist because they are what the database enforces
  and what RLS filters on. legacy_payload supplies everything that was never
  normalised - workstream, lifecycleTemplateId, the *Email and *ResourceId
  variants, and anything else this file has not been told about. That last point
  matters: fields nobody remembered still survive the round trip.

  SOURCE SWITCHING

  Nothing here changes behaviour on its own. Every module starts on "local" and
  keeps reading localStorage exactly as before. Stage 5 flips one module at a
  time:

      PPMDatabase.useDatabaseFor("projects", true)

  and can flip it straight back if anything looks wrong. The setting persists so
  it survives a page reload.

  FALLBACK

  If a module is set to "database" and the query FAILS - offline, signed out,
  session expired - the adapter falls back to localStorage and warns loudly in
  the console. The page keeps working; you are told it happened.

  A query that SUCCEEDS but returns no rows is not a failure. Row-level security
  legitimately returns nothing to a user with no project scope, and quietly
  substituting local data would hide exactly the thing Stage 5 needs to verify.
  The adapter returns the empty result and, if localStorage disagrees, says so.

  LOAD ORDER

  Load AFTER ppm-auth-utils.js and never with defer/async/module. This file only
  defines things - it makes no network call until something calls it - so it
  cannot interfere with the synchronous requireAuth() bootstrap.

  NOT IN THIS STAGE

  Writes. The browser has SELECT only; INSERT/UPDATE/DELETE are revoked at the
  database. Writes arrive in Stage 6 with optimistic locking via projects.version.
*/
(function () {
  "use strict";

  const SOURCE_KEY = "ppmDatabaseSources";
  const LOCAL = "local";
  const DATABASE = "database";

  /*
    Stage 5 mode.

    Reads and writes for a collection cannot be split. Projects are written in
    six places that still save to localStorage, so pointing reads at the database
    before writes move would make an edit disappear from view the moment the page
    re-read it - and any hydration of localStorage from the database would
    overwrite that edit permanently.

    Shadow mode gets the verification without the danger. The page keeps reading
    localStorage and renders exactly as before, while the same collection is
    fetched from the database in the background and compared. Divergence is
    recorded as it happens, during real use, across real pages.

    It is a measurement, not a switch. Nothing it does can change what the user
    sees, and no failure inside it can reach page code.
  */

  // One shadow check per collection per page load, however many times a page reads.

  /*
    The four collections this adapter can serve, and the localStorage key each
    one shadows. Only foundation tables are listed because only those have been
    migrated; the rest of the application is still localStorage-only.
  */
  const MODULES = {
    projects: { table: "projects", localKey: "ppmProjects", businessKey: "projectCode" },
    programmes: { table: "programmes", localKey: "ppmProgrammes", businessKey: "programmeId" },
    portfolios: { table: "portfolios", localKey: "ppmPortfolios", businessKey: "portfolioId" },
    people: { table: "people", localKey: "ppmResources", businessKey: "resourceId" }
  };

  // Cache lives for the page, not beyond it. Cleared explicitly or on reload.
  const cache = new Map();

  /* ------------------------------------------------------------- utilities */

  function client() {
    return window.PPMSupabase || null;
  }

  function parseJson(value, fallback) {
    if (window.PPMCore && typeof PPMCore.parseJson === "function") return PPMCore.parseJson(value, fallback);
    try {
      const parsed = JSON.parse(value);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  /*
    What this browser currently holds for a collection.

    It used to mean "what is in localStorage under the legacy key". It now means "what is in
    PPMStore", which is the same question with one fewer copy of the answer: whatever the last
    successful hydration loaded, or nothing if there has not been one.
  */
  function localRecords(moduleName) {
    if (!MODULES[moduleName] || !window.PPMStore) return [];
    return PPMStore[moduleName].all();
  }

  /*
    A null column means "this was never normalised", not "this is empty", so it
    must not overwrite the value the legacy record already holds. An empty string
    IS a real value and is allowed through.
  */
  function pick(columnValue, legacyValue) {
    return columnValue === null || columnValue === undefined ? legacyValue : columnValue;
  }

  /*
    PostgreSQL returns timestamptz as "2026-08-06T14:10:59.789+00:00". The
    application writes timestamps with Date.toISOString(), which produces
    "2026-08-06T14:10:59.789Z". Same instant, different text - and anything
    comparing or displaying the raw string would see a difference that is not
    really there. Normalise to the form the application already uses.

    Date-only columns come back as "YYYY-MM-DD" and are deliberately left alone.
  */
  function toIsoZ(value) {
    if (typeof value !== "string" || !/\d{4}-\d{2}-\d{2}T/.test(value)) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  function legacyOf(row) {
    return row && typeof row.legacy_payload === "object" && row.legacy_payload !== null && !Array.isArray(row.legacy_payload)
      ? row.legacy_payload
      : {};
  }

  /* -------------------------------------------------------------- mapping */

  /*
    Person references are a known limitation. public.people is protected by
    "people can read own record", so the browser genuinely cannot resolve another
    person's UUID to their name. Display names therefore keep coming from
    legacy_payload. The UUIDs are still exposed as *Uuid fields so a later stage
    can use them once people access is widened.
  */
  function mapProject(row) {
    const legacy = legacyOf(row);
    return {
      ...legacy,
      projectCode: pick(row.project_code, legacy.projectCode),
      projectName: pick(row.name, legacy.projectName),
      description: pick(row.description, legacy.description),

      priority: pick(row.priority, legacy.priority),
      projectStatus: pick(row.project_status, legacy.projectStatus),
      currentStage: pick(row.current_stage, legacy.currentStage),
      nextStage: pick(row.next_stage, legacy.nextStage),
      overallRag: pick(row.overall_rag, legacy.overallRag),
      deliveryConfidence: pick(row.delivery_confidence, legacy.deliveryConfidence),

      baselineStartDate: pick(row.baseline_start_date, legacy.baselineStartDate),
      baselineEndDate: pick(row.baseline_end_date, legacy.baselineEndDate),
      forecastStartDate: pick(row.forecast_start_date, legacy.forecastStartDate),
      forecastEndDate: pick(row.forecast_end_date, legacy.forecastEndDate),
      targetImplementationDate: pick(row.target_implementation_date, legacy.targetImplementationDate),
      percentageComplete: pick(row.percentage_complete, legacy.percentageComplete),

      currentPosition: pick(row.current_position, legacy.currentPosition),
      nextSteps: pick(row.next_steps, legacy.nextSteps),
      highLevelScope: pick(row.high_level_scope, legacy.highLevelScope),
      outOfScope: pick(row.out_of_scope, legacy.outOfScope),
      reasonForSlippage: pick(row.reason_for_slippage, legacy.reasonForSlippage),
      returnToGreen: pick(row.return_to_green, legacy.returnToGreen),

      scheduleRag: pick(row.schedule_rag, legacy.scheduleRag),
      scopeRag: pick(row.scope_rag, legacy.scopeRag),
      financialRag: pick(row.financial_rag, legacy.financialRag),
      resourceRag: pick(row.resource_rag, legacy.resourceRag),
      riskRag: pick(row.risk_rag, legacy.riskRag),

      archived: pick(row.archived, legacy.archived),
      archivedAt: toIsoZ(pick(row.archived_at, legacy.archivedAt)),
      archiveReason: pick(row.archive_reason, legacy.archiveReason),
      preArchiveStatus: pick(row.pre_archive_status, legacy.preArchiveStatus),

      // Database identity, carried for Stage 6 writes and optimistic locking.
      databaseId: row.id,
      version: pick(row.version, legacy.version),
      databaseVersion: row.version,
      programmeUuid: row.programme_id || "",
      projectManagerUuid: row.project_manager_id || "",
      sponsorUuid: row.sponsor_id || "",
      projectLeadUuid: row.project_lead_id || "",
      recordSource: DATABASE
    };
  }

  function mapProgramme(row) {
    const legacy = legacyOf(row);
    return {
      ...legacy,
      programmeId: pick(row.programme_code, legacy.programmeId),
      name: pick(row.name, legacy.name),
      description: pick(row.description, legacy.description),
      startDate: pick(row.start_date, legacy.startDate),
      endDate: pick(row.end_date, legacy.endDate),
      overallStatus: pick(row.overall_status, legacy.overallStatus),
      overallRag: pick(row.overall_rag, legacy.overallRag),
      strategicObjective: pick(row.strategic_objective, legacy.strategicObjective),
      budget: pick(row.budget, legacy.budget),
      benefits: pick(row.benefits, legacy.benefits),
      commentary: pick(row.commentary, legacy.commentary),
      nextSteps: pick(row.next_steps, legacy.nextSteps),
      active: pick(row.active, legacy.active),

      databaseId: row.id,
      databaseVersion: row.version,
      portfolioUuid: row.portfolio_id || "",
      sponsorUuid: row.sponsor_id || "",
      leadUuid: row.lead_id || "",
      programmeManagerUuid: row.programme_manager_id || "",
      recordSource: DATABASE
    };
  }

  function mapPortfolio(row) {
    const legacy = legacyOf(row);
    return {
      ...legacy,
      portfolioId: pick(row.portfolio_code, legacy.portfolioId),
      name: pick(row.name, legacy.name),
      description: pick(row.description, legacy.description),
      status: pick(row.status, legacy.status),
      active: pick(row.active, legacy.active),
      financialYearStartMonth: pick(row.financial_year_start_month, legacy.financialYearStartMonth),
      financialYear: pick(row.financial_year, legacy.financialYear),
      defaultReportingFrequency: pick(row.default_reporting_frequency, legacy.defaultReportingFrequency),
      budget: pick(row.budget, legacy.budget),
      currency: pick(row.currency, legacy.currency),

      databaseId: row.id,
      databaseVersion: row.version,
      ownerUuid: row.owner_id || "",
      executiveSponsorUuid: row.executive_sponsor_id || "",
      recordSource: DATABASE
    };
  }

  function mapPerson(row) {
    const legacy = legacyOf(row);
    return {
      ...legacy,
      resourceId: pick(row.legacy_resource_id, legacy.resourceId),
      fullName: pick(row.full_name, legacy.fullName),
      email: pick(row.email, legacy.email),
      accessRole: pick(row.access_role, legacy.accessRole),
      additionalRoles: Array.isArray(row.additional_roles)
        ? row.additional_roles
        : Array.isArray(legacy.additionalRoles)
          ? legacy.additionalRoles
          : [],
      accessScope: pick(row.access_scope, legacy.accessScope),
      resourceKind: pick(row.resource_kind, legacy.resourceKind),
      team: pick(row.team, legacy.team),
      department: pick(row.department, legacy.department),
      jobTitle: pick(row.job_title, legacy.jobTitle),
      role: pick(row.delivery_role, legacy.role),
      resourceType: pick(row.resource_type, legacy.resourceType),
      workingPattern: pick(row.working_pattern, legacy.workingPattern),
      standardWeeklyCapacity: pick(row.standard_weekly_capacity, legacy.standardWeeklyCapacity),
      effectiveStartDate: pick(row.effective_start_date, legacy.effectiveStartDate),
      effectiveEndDate: pick(row.effective_end_date, legacy.effectiveEndDate),
      active: pick(row.active, legacy.active),
      needsReview: pick(row.needs_review, legacy.needsReview),
      accountStatus: pick(row.account_status, legacy.accountStatus),
      selectedProjectCodes: pick(row.selected_project_codes, legacy.selectedProjectCodes) || [],
      permissionOverrides: pick(row.permission_overrides, legacy.permissionOverrides) || {},

      databaseId: row.id,
      // Stage 12A: people are writable now, so the loaded version has to travel
      // with the record — it is what the optimistic lock compares against.
      databaseVersion: row.version,
      supabaseUserId: row.auth_user_id || "",
      managerUuid: row.manager_id || "",
      recordSource: DATABASE
    };
  }

  const MAPPERS = {
    projects: mapProject,
    programmes: mapProgramme,
    portfolios: mapPortfolio,
    people: mapPerson
  };

  /* ------------------------------------------------- mapping back to columns

     Stage 6. The reverse of the mappers above: a legacy record in, database
     columns out.

     legacy_payload is written back in full on every save. That is deliberate and
     necessary - the application edits fields that were never normalised into
     columns (workstream, lifecycleTemplateId, archiveHistory and others), and if
     legacy_payload were left frozen those edits would be silently discarded the
     next time the record was loaded. The untouched Stage 2B import is preserved
     separately in import_payload, which the browser cannot write.

     Only fields the database owns are sent as columns. Everything else rides
     along inside legacy_payload.
  */

  // Empty string is meaningful in the legacy records but invalid for date and
  // numeric columns, so it has to become null on the way in.
  function nullIfBlank(value) {
    return value === "" || value === undefined ? null : value;
  }
  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // Strip the adapter's own bookkeeping so it never lands in legacy_payload.
  const ADAPTER_FIELDS = [
    "recordSource",
    "databaseId",
    "databaseVersion",
    "programmeUuid",
    "projectManagerUuid",
    "sponsorUuid",
    "projectLeadUuid",
    "portfolioUuid",
    "leadUuid",
    "programmeManagerUuid",
    "ownerUuid",
    "executiveSponsorUuid",
    "managerUuid",
    /*
      Stage 12A. mapPerson derives this from auth_user_id, so it is adapter
      metadata, not part of the record. It was already excluded from the parity
      comparison but not from payloadOf, which meant that once people became
      writable it would have been persisted into legacy_payload — putting a copy of
      the identity link inside a JSON blob, next to the one column the database
      guards most carefully. It is re-derived on every read, so nothing needs it
      stored.
    */
    "supabaseUserId"
  ];
  function payloadOf(record) {
    const copy = { ...record };
    ADAPTER_FIELDS.forEach((f) => delete copy[f]);
    return copy;
  }

  function projectToColumns(record) {
    return {
      project_code: record.projectCode,
      name: record.projectName || record.name || record.projectCode,
      description: nullIfBlank(record.description),
      priority: nullIfBlank(record.priority),
      project_status: nullIfBlank(record.projectStatus),
      current_stage: nullIfBlank(record.currentStage),
      next_stage: nullIfBlank(record.nextStage),
      overall_rag: nullIfBlank(record.overallRag),
      delivery_confidence: nullIfBlank(record.deliveryConfidence),
      baseline_start_date: nullIfBlank(record.baselineStartDate),
      baseline_end_date: nullIfBlank(record.baselineEndDate),
      forecast_start_date: nullIfBlank(record.forecastStartDate),
      forecast_end_date: nullIfBlank(record.forecastEndDate),
      target_implementation_date: nullIfBlank(record.targetImplementationDate),
      percentage_complete: numberOrNull(record.percentageComplete),
      current_position: nullIfBlank(record.currentPosition),
      next_steps: nullIfBlank(record.nextSteps),
      high_level_scope: nullIfBlank(record.highLevelScope),
      out_of_scope: nullIfBlank(record.outOfScope),
      reason_for_slippage: nullIfBlank(record.reasonForSlippage),
      return_to_green: nullIfBlank(record.returnToGreen),
      schedule_rag: nullIfBlank(record.scheduleRag),
      scope_rag: nullIfBlank(record.scopeRag),
      financial_rag: nullIfBlank(record.financialRag),
      resource_rag: nullIfBlank(record.resourceRag),
      risk_rag: nullIfBlank(record.riskRag),
      archived: Boolean(record.archived),
      archived_at: nullIfBlank(record.archivedAt),
      archive_reason: nullIfBlank(record.archiveReason || record.archivedReason),
      pre_archive_status: nullIfBlank(record.preArchiveStatus),
      legacy_payload: payloadOf(record)
    };
  }

  function programmeToColumns(record) {
    return {
      programme_code: record.programmeId,
      name: record.name || record.programmeId,
      description: nullIfBlank(record.description),
      start_date: nullIfBlank(record.startDate),
      end_date: nullIfBlank(record.endDate),
      overall_status: nullIfBlank(record.overallStatus),
      overall_rag: nullIfBlank(record.overallRag),
      strategic_objective: nullIfBlank(record.strategicObjective),
      budget: numberOrNull(record.budget),
      benefits: nullIfBlank(record.benefits),
      commentary: nullIfBlank(record.commentary),
      next_steps: nullIfBlank(record.nextSteps),
      active: record.active === undefined ? true : Boolean(record.active),
      legacy_payload: payloadOf(record)
    };
  }

  function portfolioToColumns(record) {
    return {
      portfolio_code: record.portfolioId,
      name: record.name || record.portfolioId,
      description: nullIfBlank(record.description),
      status: nullIfBlank(record.status),
      active: record.active === undefined ? true : Boolean(record.active),
      financial_year_start_month: numberOrNull(record.financialYearStartMonth),
      financial_year: nullIfBlank(record.financialYear),
      default_reporting_frequency: nullIfBlank(record.defaultReportingFrequency),
      budget: numberOrNull(record.budget),
      currency: nullIfBlank(record.currency),
      legacy_payload: payloadOf(record)
    };
  }

  /*
    Stage 12A. The inverse of mapPerson, with two deliberate omissions.

    auth_user_id is not here, and must never be. It decides which login a person
    IS, and the database refuses any attempt to set or change it from the browser —
    at every permission level, including System Administrator. Linking an account
    is an administrative act performed outside the application.

    manager_id is not here either. The application stores the manager as a RES-
    code inside legacy_payload, and the database resolves that to the foreign key
    itself, so the browser never has to know UUIDs.

    Everything else is sent, including the access-control fields. Sending them is
    not the same as being allowed to change them: private.guard_person_identity()
    compares old against new and requires users.manage for any access change,
    refusing it outright on your own row. The browser being able to name a column
    and the database being willing to move it are separate questions.
  */
  function peopleToColumns(record) {
    return {
      legacy_resource_id: record.resourceId,
      full_name: record.fullName || record.resourceId,
      email: nullIfBlank(record.email),
      resource_kind: nullIfBlank(record.resourceKind),
      team: nullIfBlank(record.team),
      department: nullIfBlank(record.department),
      job_title: nullIfBlank(record.jobTitle),
      delivery_role: nullIfBlank(record.role),
      resource_type: nullIfBlank(record.resourceType),
      working_pattern: nullIfBlank(record.workingPattern),
      standard_weekly_capacity: numberOrNull(record.standardWeeklyCapacity),
      effective_start_date: nullIfBlank(record.effectiveStartDate),
      effective_end_date: nullIfBlank(record.effectiveEndDate),
      active: record.active === undefined ? true : Boolean(record.active),
      needs_review: Boolean(record.needsReview),
      placeholder: Boolean(record.placeholder),
      access_role: nullIfBlank(record.accessRole),
      additional_roles: Array.isArray(record.additionalRoles) ? record.additionalRoles : [],
      access_scope: nullIfBlank(record.accessScope),
      account_status: nullIfBlank(record.accountStatus),
      selected_project_codes: Array.isArray(record.selectedProjectCodes)
        ? record.selectedProjectCodes
        : [],
      permission_overrides:
        record.permissionOverrides && typeof record.permissionOverrides === "object"
          ? record.permissionOverrides
          : {},
      legacy_payload: payloadOf(record)
    };
  }

  const WRITERS = {
    projects: { toColumns: projectToColumns, keyColumn: "project_code" },
    programmes: { toColumns: programmeToColumns, keyColumn: "programme_code" },
    portfolios: { toColumns: portfolioToColumns, keyColumn: "portfolio_code" },
    people: { toColumns: peopleToColumns, keyColumn: "legacy_resource_id" }
  };

  /* ------------------------------------------------------- source control */

  /* ------------------------------------------------------------- fetching */

  async function session() {
    const supabase = client();
    if (!supabase?.auth) return null;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) return null;
      return data?.session || null;
    } catch (error) {
      return null;
    }
  }

  async function assuranceLevel() {
    const supabase = client();
    if (!supabase?.auth?.mfa) return null;
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      return data?.currentLevel || null;
    } catch (error) {
      return null;
    }
  }

  /*
    Returns { ok, rows, error }. Never throws, so a caller can decide between
    falling back and surfacing the problem.
  */
  async function query(moduleName) {
    const definition = MODULES[moduleName];
    if (!definition) return { ok: false, rows: [], error: new Error(`Unknown module "${moduleName}".`) };

    const supabase = client();
    if (!supabase) {
      return { ok: false, rows: [], error: new Error("Supabase client is not loaded on this page.") };
    }
    if (!(await session())) {
      return { ok: false, rows: [], error: new Error("There is no active Supabase session.") };
    }
    /*
      Below aal2 every table's restrictive policy filters every row out, and PostgREST
      reports that as a perfectly successful empty result. Every WRITE path already
      refuses below aal2; the read path only checked that a session existed, so an
      empty result was indistinguishable from "this account genuinely has no records"
      and hydration emptied every collection.

      That was worse than it sounds while a localStorage mirror existed. The Supabase session
      lives in sessionStorage, which is per tab, while the mirror lived in localStorage, which is
      per profile - so one tab sitting between password and authenticator emptied the data every
      other tab was showing. It looked exactly like total data loss and self-corrected on the next
      hydration, which is why it read as "nothing shows until I go and do something".

      "A successful zero-row query is security truth" holds at aal2. Below it the query
      is not a statement about the data at all, so it must not be treated as one.
    */
    if ((await assuranceLevel()) !== "aal2") {
      return {
        ok: false,
        rows: [],
        error: new Error(
          "Multi-factor verification is not complete, so the database returns no rows. Keeping the last known local data."
        )
      };
    }

    try {
      const { data, error } = await supabase.from(definition.table).select("*");
      if (error) return { ok: false, rows: [], error };
      const mapper = MAPPERS[moduleName];
      return { ok: true, rows: (data || []).map(mapper), error: null };
    } catch (error) {
      return { ok: false, rows: [], error };
    }
  }

  /*
    The single path every read goes through.

      source = local     -> localStorage, unchanged behaviour
      source = database  -> database; on FAILURE fall back and warn
                            on SUCCESS use the result even if it is empty
  */
  /*
    Stage 14: the database is the only source.

    This used to branch on a per-module source flag that could be LOCAL, SHADOW or
    DATABASE. That flag existed so collections could be migrated one at a time, and
    it was removed once every collection had moved: a switch that can point a page
    back at browser storage is a way to silently run on stale data, and there is no
    longer any reason to offer it.

    localStorage is still read, but only on the failure path below. That is
    resilience, not a mode - if the query fails the page keeps working from the last
    hydrated copy rather than going blank.
  */
  async function read(moduleName) {
    if (!MODULES[moduleName]) throw new Error(`Unknown module "${moduleName}".`);

    if (cache.has(moduleName)) return cache.get(moduleName);

    const result = await query(moduleName);

    if (!result.ok) {
      console.warn(
        `PPMDatabase: the "${moduleName}" query failed - falling back to whatever this page has ` +
          `already loaded so it keeps working. The data may be stale.`,
        result.error
      );
      return localRecords(moduleName);
    }

    if (!result.rows.length) {
      const local = localRecords(moduleName);
      if (local.length) {
        console.warn(
          `PPMDatabase: the database returned no "${moduleName}" rows, but this page is holding ${local.length}. ` +
            `This is a real answer, not an error - row-level security may be filtering everything out. ` +
            `Local data was NOT substituted. Run PPMDatabase.explain() to see the current session.`
        );
      }
    }

    cache.set(moduleName, result.rows);
    return result.rows;
  }

  /* ---------------------------------------------------------------- reads */

  async function getProjects() {
    return read("projects");
  }
  async function getProject(projectCode) {
    const code = String(projectCode || "");
    return (await getProjects()).find((row) => String(row.projectCode) === code) || null;
  }
  async function getProgrammes() {
    return read("programmes");
  }
  async function getProgramme(programmeId) {
    const id = String(programmeId || "");
    return (await getProgrammes()).find((row) => String(row.programmeId) === id) || null;
  }
  async function getPortfolios() {
    return read("portfolios");
  }
  async function getPortfolio(portfolioId) {
    const id = String(portfolioId || "");
    return (await getPortfolios()).find((row) => String(row.portfolioId) === id) || null;
  }

  /*
    Only ever returns the signed-in person from the database. "people can read
    own record" means the browser cannot see anybody else, so getPeople() would
    be misleading and is deliberately not offered. Use PPMAuth.getResources()
    for the directory until people access is widened in a later stage.
  */
  async function getCurrentPerson() {
    const rows = await read("people");
    return rows[0] || null;
  }

  function clearCache(moduleName) {
    if (moduleName) cache.delete(moduleName);
    else cache.clear();
  }

  /* ---------------------------------------------- Stage 8: server-side audit

     The application's own audit trail lives in localStorage, which means it
     records what happened but cannot prove it - anyone with developer tools can
     rewrite it. Stage 8 added a parallel trail written by the database itself on
     every change, attributed to the authenticated user rather than to whatever
     the page claimed, and which nothing can insert into, edit or delete through
     the API.

     Entries are mapped into the same shape the Audit History page already
     understands, so the two trails can be shown side by side. Anything from here
     carries verified: true - it is the half that cannot be forged.
  */

  /*
    Stage 11F: every audited table, named the way the Audit History page names
    records.

    These are not cosmetic labels. PPMChangeLog.LOCATIONS is keyed on exactly
    these strings, so the mapping is what gives a server audit row its "Changed
    in" location, its area, and its link back to the screen where the change was
    made. Before this, anything outside the three foundation tables surfaced as a
    raw table name like "project_plans", matched no location, and was unfilterable.
  */
  const AUDIT_ENTITY = {
    projects: "Project",
    programmes: "Programme",
    portfolios: "Portfolio",
    people: "Resource",
    audit_log: "Audit history",
    legacy_audit_history: "Audit history",

    project_plans: "Project plan item",
    project_milestones: "Milestone",
    project_raid: "RAID item",
    project_actions: "Action",
    project_decisions: "Decision",
    project_financials: "Financial summary",
    project_benefits: "Benefit",
    project_documents: "Project document",
    status_reports: "Status report",
    stage_gates: "Stage gate",
    plan_baselines: "Plan baseline approval",
    plan_baseline_requests: "Plan baseline approval",
    rag_history: "Project status",
    financial_entries: "Financial entry",
    financial_approval_requests: "Financial approval",
    resource_demand: "Resource demand",
    resource_scenarios: "Resource scenario",

    programme_milestones: "Programme milestone",
    programme_raid: "Programme RAID",
    lifecycle_templates: "Lifecycle template",
    lifecycle_mandatory_rules: "Lifecycle mandatory rule",
    reference_data: "Reference data",
    reporting_calendars: "Reporting calendar",
    reporting_periods: "Reporting period",
    rag_config: "RAG threshold",
    financial_categories: "Financial category",
    resource_absence: "Resource absence",
    resource_config: "Resource capacity",
    resource_gantt_views: "Saved view",
    report_views: "Saved view",
    search_views: "Saved view"
  };
  const AUDIT_ACTION = { INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted" };

  /*
    Child and Stage 12 rows carry a compound business key — "PRJ-00001 / TSK-0003",
    "PROG-001 / PM-00001", "GLOBAL / LIFE-00001". Splitting it matters twice over:
    the reader wants the record's own id in the Record ID column, not the whole
    compound string, and the project filter only works if a project code is
    recognised as one.

    A scope that is not a project code — a programme, a configuration category, or
    GLOBAL — deliberately yields no project, so those entries read as
    portfolio-wide rather than being filed under a project that does not exist.
  */
  const NON_PROJECT_SCOPES = new Set(["GLOBAL", "resource-scenario", "programme"]);

  /*
    "task_owner_email" -> "Task owner email". The audit functions record real column
    names, which is right for the trail and wrong for a screen. Bracketed markers the
    audit writes itself, like "(record created)", are passed through untouched.
  */
  function auditFieldLabel(field) {
    const name = String(field || "");
    if (!name || name.startsWith("(")) return name || "Field";
    const words = name.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Field";
  }

  function splitAuditKey(row) {
    const key = String(row.record_key || "");
    if (!key.includes(" / ")) {
      // Foundation tables are keyed by their own business code.
      return {
        scope: row.table_name === "projects" ? key : "",
        recordId: key
      };
    }
    const scope = key.slice(0, key.indexOf(" / "));
    const recordId = key.slice(key.indexOf(" / ") + 3);
    const programmeScoped =
      scope.startsWith("programme:") ||
      row.table_name === "programme_milestones" ||
      row.table_name === "programme_raid";
    const isProject = !programmeScoped && !NON_PROJECT_SCOPES.has(scope);
    return { scope: isProject ? scope : "", recordId };
  }

  function mapAuditEntry(row) {
    const entity = AUDIT_ENTITY[row.table_name] || row.table_name;
    const action = AUDIT_ACTION[row.operation] || row.operation;
    const changes = Array.isArray(row.changes) ? row.changes : [];
    const who = row.actor_name || row.actor_email || "Unknown user";
    const { scope, recordId } = splitAuditKey(row);

    return {
      auditId: `DB-${row.id}`,
      timestamp: toIsoZ(row.occurred_at),
      projectCode: scope,
      entityType: entity,
      entityId: recordId,
      action: `${entity} ${action.toLowerCase()}`,
      summary:
        changes.length && changes[0].field && !String(changes[0].field).startsWith("(")
          ? `${who} changed ${changes.map((c) => c.field).join(", ")} on ${recordId}.`
          : `${who} ${action.toLowerCase()} ${recordId}.`,
      actorName: who,
      actorResourceId: "",
      actorEmail: row.actor_email || "",
      actorRole: row.actor_role || "",
      changes: changes.map((c) => ({
        field: c.field,
        // Database columns are snake_case; the page shows these to people.
        label: auditFieldLabel(c.field),
        before: c.before === null || c.before === undefined ? "" : c.before,
        after: c.after === null || c.after === undefined ? "" : c.after
      })),
      sourcePage: "Database",
      rowVersion: row.row_version,
      // Marks this entry as coming from the trail the browser cannot alter.
      verified: true,
      recordSource: DATABASE
    };
  }

  /*
    Reads the server-side trail. Row-level security decides what comes back:
    audit.view sees everything, everyone else sees only entries for records they
    could already read.
  */
  async function getAuditTrail(options) {
    const supabase = client();
    if (!supabase) return [];
    if (!(await session())) return [];

    try {
      let request = supabase
        .from("audit_log")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(Number(options?.limit) || 500);

      if (options?.recordKey) request = request.eq("record_key", options.recordKey);
      /*
        The audit key is composite - "PRJ-00011 / DEC-00011-001" - because a record id is only
        unique within its project. A caller that has the record id and not the project, which is
        every per-record History button, matches on the tail instead.
      */
      if (options?.recordEndsWith) request = request.like("record_key", `%${options.recordEndsWith}`);
      if (options?.table) request = request.eq("table_name", options.table);

      const { data, error } = await request;
      if (error) {
        console.warn("PPMDatabase: the server-side audit trail could not be read.", error);
        return [];
      }
      return (data || []).map(mapAuditEntry);
    } catch (error) {
      console.warn("PPMDatabase: the server-side audit trail could not be read.", error);
      return [];
    }
  }

  /* Prints the trail, newest first - the quick way to answer "who changed this?". */
  async function auditReport(options) {
    const rows = await getAuditTrail(options);
    if (!rows.length) {
      console.info(
        "PPMDatabase: no server-side audit entries are visible. Either nothing has been changed in the " +
          "database yet, or your role cannot see these records."
      );
      return rows;
    }
    console.group(`PPMDatabase: ${rows.length} server-recorded change(s), newest first`);
    console.table(
      rows.map((r) => ({
        when: r.timestamp,
        who: r.actorName,
        role: r.actorRole,
        record: r.entityId,
        action: r.action,
        fields: r.changes.map((c) => c.field).join(", ")
      }))
    );
    console.log("These entries are written by the database and cannot be edited or deleted from the browser.");
    console.groupEnd();
    return rows;
  }

  /* ------------------------------------------------------------ Stage 6: writes

     Records are saved one row at a time rather than as a whole collection, so a
     single bad record cannot take the rest down with it, and so the version
     check applies per record.

     Every outcome is classified, because they need different responses:

       saved      it worked
       conflict   somebody else changed the row first (40001) - reload, redo
       refused    the role or scope does not allow it (42501/PGRST) - a UI bug
                  or an attempt that should not have been offered
       failed     anything else, usually the network

     Nothing is thrown at the caller. A save that cannot reach the database is
     recorded as pending so the edit is visible rather than silently lost.
  */

  const PENDING_KEY = "ppmDatabasePending";
  const MAX_PENDING = 100;

  function classifyError(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || error || "");
    if (code === "40001" || /changed by someone else/i.test(message)) return "conflict";
    if (code === "42501" || code === "PGRST301" || /permission denied|row-level security|does not allow/i.test(message))
      return "refused";
    return "failed";
  }

  /*
    Human labels for messages the user reads.

    These used to be derived with moduleName.replace(/s$/, ""), which is fine for
    "projects" and wrong for "people" - producing "This people was changed by someone
    else". A conflict message is read at the exact moment somebody has lost work, so
    it is the worst place in the tool to look unfinished.
  */
  const SINGULAR = {
    projects: "Project",
    programmes: "Programme",
    portfolios: "Portfolio",
    people: "Person"
  };

  function recordLabel(moduleName, key) {
    const noun = SINGULAR[moduleName] || moduleName;
    return key ? `${noun} ${key}` : noun;
  }

  function friendlyError(kind, moduleName, key, error) {
    const what = recordLabel(moduleName, key);
    if (kind === "conflict")
      return `${what} was changed by someone else while you were editing it. Reload the page and reapply your change.`;
    if (kind === "refused") return `You do not have permission to save ${what}.`;
    return `${what} could not be saved to the database: ${error?.message || error}`;
  }

  function readPending() {
    const stored = parseJson(localStorage.getItem(PENDING_KEY), []);
    return Array.isArray(stored) ? stored : [];
  }

  function recordPending(entry) {
    try {
      const pending = readPending();
      pending.push(entry);
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-MAX_PENDING)));
    } catch (error) {
      /* Storage full. The console warning below is still the user's signal. */
    }
  }

  /*
    Stage 12A. This took no arguments and cleared everything, so
    clearPending("people") silently discarded other modules' entries too — the
    argument looked meaningful and was ignored, which is worse than not accepting
    one. It now filters, and clears everything only when asked to.
  */
  function clearPending(moduleName) {
    if (!moduleName) {
      localStorage.removeItem(PENDING_KEY);
      console.info("PPMDatabase: pending-write log cleared.");
      return;
    }
    const kept = readPending().filter((entry) => entry?.module !== moduleName);
    localStorage.setItem(PENDING_KEY, JSON.stringify(kept));
    console.info(`PPMDatabase: pending-write log cleared for "${moduleName}".`);
  }

  /* Used by hydrate() to drop only the entries that reloading actually resolves. */
  /* One record's entry, by key. clearPendingFor() takes a whole collection, which is right for
     "I have noted these and want them gone" and wrong for "this one just saved". */
  function clearPendingEntry(moduleName, key) {
    const kept = readPending().filter((entry) => !(entry?.module === moduleName && entry?.key === key));
    localStorage.setItem(PENDING_KEY, JSON.stringify(kept));
  }

  function clearPendingFor(moduleName, kind) {
    const kept = readPending().filter(
      (entry) => !(entry?.module === moduleName && (!kind || entry?.kind === kind))
    );
    localStorage.setItem(PENDING_KEY, JSON.stringify(kept));
  }

  function pendingWrites() {
    const pending = readPending();
    if (!pending.length) {
      console.info("PPMDatabase: no unsaved changes. Everything reached the database.");
      return pending;
    }
    console.warn(`PPMDatabase: ${pending.length} change(s) did NOT reach the database.`);
    console.table(
      pending.map((p) => ({ at: p.at, module: p.module, record: p.key, problem: p.kind, detail: p.message }))
    );
    return pending;
  }

  /*
    Saves one record. Existing rows are matched on their business key, not on a
    database id, because the legacy code paths that produce these records have
    never heard of UUIDs.

    The outcome goes in the pending ledger, which it did not until now. saveRecords() recorded
    the failures it collected, but PPMStore calls saveRecord() directly, one row at a time - so
    since Stage 16 every conflict, refusal and failure on a foundation collection went unrecorded
    and pendingWrites() answered "nothing outstanding" however much had gone wrong.
  */
  async function saveRecord(moduleName, record, options) {
    return recordOutcome(await attemptSave(moduleName, record, options));
  }

  /* Adds the outcome to the ledger, or takes it out again once it succeeds. A ledger that only
     grows stops meaning "what is outstanding". */
  function recordOutcome(result) {
    if (!result) return result;
    if (result.status === "saved") clearPendingEntry(result.module, result.key);
    else recordPending({ ...result, kind: result.status });
    return result;
  }

  async function attemptSave(moduleName, record, options) {
    const writer = WRITERS[moduleName];
    if (!writer) throw new Error(`"${moduleName}" cannot be written to the database.`);

    const supabase = client();
    const key = String(record?.[MODULES[moduleName].businessKey] || "");
    const base = { module: moduleName, key, at: new Date().toISOString() };

    if (!key) return { ...base, status: "failed", message: "The record has no identifier." };
    if (!supabase) return { ...base, status: "failed", message: "Supabase is not loaded on this page." };
    if (!(await session())) return { ...base, status: "failed", message: "There is no active Supabase session." };

    const columns = writer.toColumns(record);

    try {
      /*
        The lookup is only to distinguish INSERT from UPDATE. It is NOT used as
        the optimistic-lock version.

        The expected version must be the one this browser actually loaded. Using
        a fresh database version here would turn optimistic locking into a tiny
        lookup/update race and would allow a stale page to overwrite somebody
        else's work.
      */
      const { data: existing, error: lookupError } = await supabase
        .from(MODULES[moduleName].table)
        .select("id, version")
        .eq(writer.keyColumn, key)
        .maybeSingle();

      if (lookupError) {
        const kind = classifyError(lookupError);
        return { ...base, status: kind, message: friendlyError(kind, moduleName, key, lookupError) };
      }

      if (!existing) {
        const { data, error } = await supabase
          .from(MODULES[moduleName].table)
          .insert(columns)
          .select("id, version")
          .single();

        if (error) {
          const kind = classifyError(error);
          return { ...base, status: kind, message: friendlyError(kind, moduleName, key, error) };
        }

        record.databaseId = data?.id || record.databaseId || "";
        record.databaseVersion = data?.version ?? 1;
        if (moduleName === "projects") record.version = data?.version ?? record.version ?? 1;

        return {
          ...base,
          status: "saved",
          action: "inserted",
          databaseId: data?.id || "",
          version: data?.version ?? 1
        };
      }

      let expectedVersion =
        record?.databaseVersion !== undefined && record?.databaseVersion !== null
          ? Number(record.databaseVersion)
          : moduleName === "projects" && record?.version !== undefined && record?.version !== null
            ? Number(record.version)
            : NaN;

      /*
        Stage 12A. A record with no databaseVersion has never been loaded from the
        database, which is a different situation from a stale one and needs saying
        differently — reporting it as "changed by someone else" sends the reader off
        to reload and reapply, which cannot help.

        { seed: true } is the deliberate one-time reconciliation for exactly this
        case: local records that predate the database and therefore have no version
        to send. It adopts the version the row currently has.

        This is not a loophole in the optimistic locking. That rule exists to stop
        one editor silently overwriting another's concurrent change, and it works by
        refusing a version the browser did not load. A record that was never loaded
        has no such version, so there is nothing to compare — and pretending
        otherwise just makes seeding impossible. It stays opt-in, per call, so a
        routine save can never take this path by accident.
      */
      if (!Number.isFinite(expectedVersion)) {
        if (!options?.seed) {
          return {
            ...base,
            status: "conflict",
            message:
              `${recordLabel(moduleName, key)} has never been loaded from the database, so it carries no ` +
              `version to check against. Reload the page so the record is loaded, or reconcile deliberately ` +
              `with PPMDatabase.saveRecords("${moduleName}", records, { seed: true }).`
          };
        }
        expectedVersion = Number(existing.version);
        if (!Number.isFinite(expectedVersion)) {
          return {
            ...base,
            status: "failed",
            message: `${recordLabel(moduleName, key)} could not be seeded: the database row has no version.`
          };
        }
      }

      /*
        Do not add `.eq("version", expectedVersion)`: when a stale version matches
        zero rows PostgREST can return an empty success, so the database trigger
        never gets a chance to raise 40001. Send the loaded version in NEW.version
        and let private.enforce_optimistic_lock compare it with OLD.version.
      */
      const { data, error } = await supabase
        .from(MODULES[moduleName].table)
        .update({ ...columns, version: expectedVersion })
        .eq(writer.keyColumn, key)
        .select("id, version")
        .maybeSingle();

      if (error) {
        const kind = classifyError(error);
        return { ...base, status: kind, message: friendlyError(kind, moduleName, key, error) };
      }

      if (!data) {
        const error = { code: "42501", message: "The database did not permit this row to be updated." };
        return {
          ...base,
          status: "refused",
          message: friendlyError("refused", moduleName, key, error)
        };
      }

      record.databaseId = data.id || record.databaseId || existing.id || "";
      record.databaseVersion = data.version;
      if (moduleName === "projects") record.version = data.version;

      return {
        ...base,
        status: "saved",
        action: "updated",
        fromVersion: expectedVersion,
        version: data.version,
        databaseId: data.id || ""
      };
    } catch (error) {
      const kind = classifyError(error);
      return { ...base, status: kind, message: friendlyError(kind, moduleName, key, error) };
    }
  }

  /* Saves many records and reports what happened to each. Never throws. */
  async function saveRecords(moduleName, records, options) {
    const list = Array.isArray(records) ? records.filter(Boolean) : [records].filter(Boolean);
    const outcome = { module: moduleName, saved: [], conflicts: [], refused: [], failed: [] };

    if (options?.seed)
      console.warn(
        `PPMDatabase: seeding "${moduleName}" — records that have never been loaded from the database will ` +
          `adopt the version the row currently has. Use this for one-time reconciliation only.`
      );

    for (const record of list) {
      const result = await saveRecord(moduleName, record, options);
      if (result.status === "saved") outcome.saved.push(result);
      else {
        const bucket = result.status === "conflict" ? "conflicts" : result.status === "refused" ? "refused" : "failed";
        outcome[bucket].push(result);
        /* saveRecord() has already put it in the ledger. */
      }
    }

    cache.delete(moduleName);

    const problems = outcome.conflicts.length + outcome.refused.length + outcome.failed.length;
    if (problems) {
      console.group(`PPMDatabase: ${problems} of ${list.length} ${moduleName} record(s) did not save`);
      [...outcome.conflicts, ...outcome.refused, ...outcome.failed].forEach((p) => console.warn(p.key, "-", p.message));
      console.log("Run PPMDatabase.pendingWrites() to see everything still unsaved.");
      console.groupEnd();
    } else if (outcome.saved.length) {
      console.info(`PPMDatabase: ${outcome.saved.length} ${moduleName} record(s) saved to the database.`);
    }

    return outcome;
  }

  const saveProjects = (records) => saveRecords("projects", records);
  const saveProgrammes = (records) => saveRecords("programmes", records);
  const savePortfolios = (records) => saveRecords("portfolios", records);

  /* ---------------------------------------------------- parity diagnostics */

  const IGNORED_FIELDS = new Set([
    "updatedAt",
    "createdAt",
    "recordSource",
    "databaseId",
    "version",
    "programmeUuid",
    "projectManagerUuid",
    "sponsorUuid",
    "projectLeadUuid",
    "portfolioUuid",
    "leadUuid",
    "programmeManagerUuid",
    "ownerUuid",
    "executiveSponsorUuid",
    "managerUuid",
    "supabaseUserId",
    /*
      Stage 12A. The loaded row version is adapter bookkeeping, not data. It was
      missing from this list, so a local record that had never been hydrated —
      and therefore had no databaseVersion — was reported as differing from the
      database on a field the user cannot see or set. That is noise in the one
      report someone reads before deciding whether it is safe to cut over, which
      is the worst possible place for it.
    */
    "databaseVersion"
  ]);

  function sameValue(a, b) {
    if (a === b) return true;

    /*
      A boolean column defaults to false, but the legacy record simply omits the
      key when it is not set - `archived` is the obvious case. The application
      treats an absent flag as false, so an absent value and false mean the same
      thing and must not be reported as a difference. Only booleans get this
      treatment; "" versus false stays a genuine difference.
    */
    const absent = (v) => v === null || v === undefined;
    if (absent(a) && b === false) return true;
    if (absent(b) && a === false) return true;

    if (absent(a) || a === "") return absent(b) || b === "";
    if (absent(b) || b === "") return false;
    if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);

    // Two timestamps for the same instant written in different formats.
    const looksLikeTimestamp = (v) => typeof v === "string" && /\d{4}-\d{2}-\d{2}T/.test(v);
    if (looksLikeTimestamp(a) && looksLikeTimestamp(b)) {
      const ta = new Date(a).getTime();
      const tb = new Date(b).getTime();
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta === tb;
    }

    return String(a) === String(b);
  }

  /*
    Compares what the database holds against what localStorage holds, so a Stage 5
    switch can be justified with evidence rather than hope. Reads the database
    directly regardless of the module's current source setting.
  */
  async function compare(moduleName) {
    const definition = MODULES[moduleName];
    if (!definition) throw new Error(`Unknown module "${moduleName}".`);

    const result = await query(moduleName);
    if (!result.ok) {
      console.error(`PPMDatabase.compare("${moduleName}"): the database could not be read.`, result.error);
      return { module: moduleName, ok: false, error: String(result.error?.message || result.error) };
    }

    const key = definition.businessKey;
    const dbRows = result.rows;
    const localRows = localRecords(moduleName);
    const dbByKey = new Map(dbRows.map((row) => [String(row[key]), row]));
    const localByKey = new Map(localRows.map((row) => [String(row[key]), row]));

    const onlyInDatabase = [...dbByKey.keys()].filter((k) => !localByKey.has(k));
    const onlyInLocal = [...localByKey.keys()].filter((k) => !dbByKey.has(k));

    const differences = [];
    dbByKey.forEach((dbRow, k) => {
      const localRow = localByKey.get(k);
      if (!localRow) return;
      new Set([...Object.keys(dbRow), ...Object.keys(localRow)]).forEach((field) => {
        if (IGNORED_FIELDS.has(field)) return;
        if (!sameValue(dbRow[field], localRow[field]))
          differences.push({
            record: k,
            field,
            database: dbRow[field],
            localStorage: localRow[field]
          });
      });
    });

    const report = {
      module: moduleName,
      ok: true,
      databaseRecords: dbRows.length,
      localRecords: localRows.length,
      matched: dbRows.length - onlyInDatabase.length,
      onlyInDatabase,
      onlyInLocal,
      fieldDifferences: differences,
      verdict:
        !onlyInDatabase.length && !onlyInLocal.length && !differences.length
          ? "IDENTICAL - safe to switch this module to the database"
          : "DIFFERENCES FOUND - review before switching"
    };

    console.group(`PPMDatabase parity: ${moduleName}`);
    console.log(
      `database ${report.databaseRecords} record(s), localStorage ${report.localRecords} record(s), ` +
        `${report.matched} matched by ${key}`
    );
    if (onlyInDatabase.length) console.warn("Only in the database:", onlyInDatabase);
    if (onlyInLocal.length) console.warn("Only in localStorage:", onlyInLocal);
    if (differences.length) {
      console.warn(`${differences.length} field difference(s):`);
      console.table(differences);
    }
    console.log(report.verdict);
    console.groupEnd();

    return report;
  }

  async function compareAll() {
    const reports = {};
    for (const name of Object.keys(MODULES)) reports[name] = await compare(name);
    return reports;
  }

  /* Prints the current state - the first thing to run when something looks odd. */
  /*
    First thing to run in the console when something looks wrong. Almost every
    "the page is empty" report comes down to one of the first three lines: no
    client, not signed in, or signed in but not yet at aal2 - below which
    row-level security returns nothing at all, which looks identical to having no
    data.
  */
  async function explain() {
    const active = await session();
    const aal = await assuranceLevel();

    console.group("PPMDatabase status");
    console.log("Supabase client loaded :", Boolean(client()));
    console.log("Signed in              :", Boolean(active));
    console.log(
      "Assurance level        :",
      aal || "unknown",
      aal === "aal2" ? "(MFA complete)" : "(reads return nothing until aal2)"
    );
    console.log("Hydrated               :", hydrated);
    console.log("Cached collections     :", [...cache.keys()].join(", ") || "none");
    console.table(
      Object.keys(MODULES).map((name) => ({
        module: name,
        table: MODULES[name].table,
        browser_mirror_key: MODULES[name].localKey,
        writable: Boolean(WRITERS[name]),
        cached: cache.has(name)
      }))
    );
    console.log("Unsaved changes:  PPMDatabase.pendingWrites()");
    console.log('Compare a module: await PPMDatabase.compare("projects")');
    console.log("Compare all:      await PPMDatabase.compareAll()");
    console.log("Who changed what: await PPMDatabase.auditReport()");
    console.groupEnd();

    return {
      clientLoaded: Boolean(client()),
      signedIn: Boolean(active),
      assuranceLevel: aal,
      hydrated,
      cached: [...cache.keys()]
    };
  }

  /* ------------------------------------------------ Stage 6: hydrate and write through

     The application reads its collections synchronously, in about thirty places,
     several of them top-level constants that run the moment a page script loads.
     Converting all of that to async would be the rewrite the specification
     forbids, and the handoff warns specifically against making the bootstrap
     asynchronous without auditing every page.

     So instead of moving the reads, the store underneath them is filled from the
     database before page scripts run. Every existing synchronous read then keeps
     working unchanged and gets database data - including the reconciliation
     cascade in ppm-admin-utils.js, which is the thing that made a per-collection
     cutover impossible.

     Writes are handled the same way round. Rather than editing the six places
     that save these collections, Storage.setItem is intercepted for the three
     migrated keys: the local store is updated exactly as before, then whatever
     actually changed is pushed to the database. One seam instead of six, and no
     write site can be missed.

     Ordering note: this wraps whatever setItem is in place at the time, which
     includes the project-scoping filter installed by ppm-auth-utils.js. That
     filter still runs first; this only adds the push afterwards.
  */

  let writeThroughInstalled = false;
  let hydrated = false;
  // What the database held at hydration, so a write can tell what actually changed.
  const baseline = new Map();

  /* Every writable module is database-backed. Kept as a function because hydrate()
     and boot() both iterate it, and a future read-only module would filter here. */
  function activeModules() {
    return Object.keys(WRITERS);
  }

  /*
    JSON.stringify preserves key insertion order, so two records holding exactly
    the same data compare as different if anything rebuilt one of them with the
    keys in a different order - which the reconciliation cascade does routinely.

    That produced spurious writes: a record was pushed, the database stored
    identical content, and the row version incremented for nothing. Harmless in
    a single browser, but version churn is exactly what causes false conflicts
    once two people are editing.

    Sorting keys makes the comparison about content rather than order.
  */
  /*
    Undefined has to be dropped, not rendered, for the same reason JSON.stringify
    drops it.

    The mappers set fields like archivedAt to undefined when a project is not
    archived. Going through localStorage removes those keys entirely, so a record
    held in memory and the same record read back differ - every hydrated record
    looked modified the moment it was stored, and got pushed straight back to the
    database for no reason. Matching JSON's own semantics makes the two agree.
  */
  function stableStringify(value) {
    if (value === undefined) return undefined;
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value))
      return "[" + value.map((item) => stableStringify(item) ?? "null").join(",") + "]";

    const parts = [];
    Object.keys(value)
      .sort()
      .forEach((k) => {
        const rendered = stableStringify(value[k]);
        if (rendered !== undefined) parts.push(JSON.stringify(k) + ":" + rendered);
      });
    return "{" + parts.join(",") + "}";
  }

  function snapshot(moduleName, records) {
    const key = MODULES[moduleName].businessKey;
    const map = new Map();
    (records || []).forEach((row) => map.set(String(row[key]), stableStringify(payloadOf(row))));
    baseline.set(moduleName, map);
  }

  function snapshotSaved(moduleName, records, savedResults) {
    const keyField = MODULES[moduleName].businessKey;
    const map = baseline.get(moduleName) || new Map();
    const savedKeys = new Set((savedResults || []).map((result) => String(result.key || "")));

    (records || []).forEach((row) => {
      const key = String(row?.[keyField] || "");
      if (key && savedKeys.has(key)) map.set(key, stableStringify(payloadOf(row)));
    });
    baseline.set(moduleName, map);
  }

  function changedRecords(moduleName, records) {
    const key = MODULES[moduleName].businessKey;
    const previous = baseline.get(moduleName) || new Map();
    return (records || []).filter((row) => {
      const id = String(row?.[key] || "");
      if (!id) return false;
      return previous.get(id) !== stableStringify(payloadOf(row));
    });
  }

  /*
    Fills the local store from the database. Returns a report rather than
    throwing: if the database cannot be reached the existing local data is left
    exactly as it is, so the tool still opens and still works.
  */
  async function hydrate() {
    const modules = activeModules();
    const report = { hydrated: [], skipped: [], failed: [] };
    if (!modules.length) return report;

    /*
      Asked once here rather than left to the per-module guard in query(). Below aal2
      every module would fail for the same reason, and 4 identical warnings followed by
      32 more from the child adapter buries the one line that explains the page.
    */
    if ((await session()) && (await assuranceLevel()) !== "aal2") {
      modules.forEach((name) =>
        report.skipped.push({ module: name, reason: "multi-factor verification is not complete" })
      );
      console.warn(
        "PPMDatabase: not refreshing from the database - multi-factor verification is not complete, so it would " +
          "return no rows and empty every collection. Showing the last known local data instead."
      );
      return report;
    }

    for (const name of modules) {
      /*
        Never overwrite an edit that has not reached the database yet — but be
        precise about which pending entries actually represent one.

        Stage 12A. This used to block on any pending entry at all, including
        conflicts. A conflict means the local copy is stale, and reloading the
        authoritative row is exactly how a conflict is resolved, so treating it as
        a reason NOT to reload was self-defeating: it left hydration permanently
        blocked by the very thing hydration fixes. The child adapter already drew
        this distinction; the foundation adapter did not.

        Network failures and refusals are different. There the local copy may be
        the only copy of a change that never landed, so those still block.
      */
      /*
        Stage 16: a refusal is terminal, so it must not block hydration either.

        The reasoning above is right for a network failure - a retry may still land, so the
        local copy is worth protecting. It is wrong for a refusal. Row-level security or a
        workflow guard has permanently rejected that change; no amount of waiting will make it
        succeed. Blocking on it meant the collection was never refreshed again in that browser,
        so the screen showed indefinitely stale data while the console explained why once, on
        load, to nobody.

        Found in the field: a plan baseline refused on 9 August was still blocking every
        subsequent refresh of planBaselines two days later.

        The entry is kept, so pendingWrites() can still show what was rejected and why. What
        changes is that the database is allowed to win, which it already had.
      */
      /*
        A pending write no longer stops the refresh. Any of them.

        This blocked hydration whenever a change had not been saved, because the browser mirror
        held that change and refreshing would have overwritten it. That reasoning went with the
        mirror. A failed save updates nothing - PPMStore only changes the store once PostgreSQL
        confirms - so there is no local copy left to protect, and refusing to refresh now buys
        nothing and costs everything: with no mirror to fall back on, a skipped collection is an
        empty one, and the page shows nothing at all.

        The ledger stays, and is reported rather than acted on.
      */
      const unsaved = readPending().filter((p) => p.module === name);
      if (unsaved.length) {
        const kinds = [...new Set(unsaved.map((p) => p.kind))].join(", ");
        console.warn(
          `PPMDatabase: ${unsaved.length} "${name}" change(s) did not save (${kinds}). Refreshing from the database ` +
            `anyway - it holds the only copy. Run PPMDatabase.pendingWrites() to see them, then ` +
            `PPMDatabase.clearPendingFor("${name}") once you have.`
        );
      }

      const result = await query(name);
      if (!result.ok) {
        report.failed.push({ module: name, error: String(result.error?.message || result.error) });
        console.warn(
          `PPMDatabase: could not load "${name}" from the database. The page is showing the last known local data.`,
          result.error
        );
        continue;
      }

      try {
        /*
          Straight into PPMStore, which every page reads from.

          This used to write result.rows into localStorage under the collection's legacy key,
          past the project-scoping filter, using a natively-captured setItem. The comment here
          explained at length why the filter had to be avoided during hydration: it merged back
          records the user could not see, reintroducing stale copies of rows row-level security
          had already excluded. All of that reasoning existed to make a browser copy behave, and
          all of it goes with the copy. Row-level security decided what this person may load;
          what it returned is what the store holds.
        */
        adopt(name, result.rows);
        snapshot(name, result.rows);
        cache.set(name, result.rows);
        report.hydrated.push({ module: name, records: result.rows.length });
      } catch (error) {
        report.failed.push({ module: name, error: String(error?.message || error) });
      }
    }

    hydrated = true;
    if (report.hydrated.length)
      console.info(
        "PPMDatabase: loaded from the database - " +
          report.hydrated.map((r) => `${r.module} (${r.records})`).join(", ")
      );
    return report;
  }

  /*
    Hands a hydrated collection to PPMStore.

    ppm-data.js loads after this file, so PPMStore does not exist while this module is being
    defined - but hydration is asynchronous and its first await yields before any row is
    fetched, so by the time there is anything to adopt, it is there. The guard is for the one
    case that is not true: a page that loaded the adapters and not the data layer, where saying
    so once is better than throwing inside hydration and losing the rest of the collections.
  */
  function adopt(name, rows) {
    if (window.PPMStore && typeof PPMStore.adopt === "function") return PPMStore.adopt(name, rows);
    console.error(
      `PPMDatabase: ppm-data.js is not loaded, so "${name}" was fetched from the database and had ` +
        `nowhere to go. This page will show nothing.`
    );
    return false;
  }

  /* ============================================ Stage 16: the write-through is gone

     WHAT USED TO BE HERE

     installWriteThrough() replaced Storage.prototype.setItem for the whole page, and
     installWriteGlobalSeam() wrapped PPMAuth.writeGlobal, so that ordinary-looking browser
     storage writes were intercepted, diffed against a baseline and pushed to PostgreSQL.

     It worked, and it was indefensible. A call to a browser API performed a network write that
     no reader of the call site could see; the write returned before the database had been asked
     anything, so a page could report success for a write PostgreSQL went on to refuse; and it
     needed two independent interceptions to stay in step, which they did not - Stage 12's bug
     was configuration saving locally and never reaching the database, silently, for weeks.

     WHAT REPLACED IT

     ppm-data.js. Every business write in the application goes through PPMStore, one row at a
     time, awaited, returning a result the caller has to look at. Nothing patches any prototype.

     Three gates keep it that way: VERIFY-STATIC.mjs refuses any assignment to Storage.prototype,
     refuses a business collection written to localStorage outside ppm-data.js, and refuses a
     PPMStore write whose result is discarded.

     The browser mirror those seams wrote to is gone as well. Hydration hands each collection
     straight to PPMStore, so there is one copy of the data in the page and none in localStorage.
  */

  /* Runs on load, before page scripts read anything. Hydration only now - there are no seams
     left to install. */
  function boot() {
    return hydrate().catch((error) => {
      console.error("PPMDatabase: hydration failed; the page is using local data.", error);
      return { hydrated: [], skipped: [], failed: [{ module: "all", error: String(error) }] };
    });
  }

  const ready = boot();

  window.PPMDatabase = {
    DATABASE,
    MODULES,

    // reads
    getProjects,
    getProject,
    getProgrammes,
    getProgramme,
    getPortfolios,
    getPortfolio,
    getCurrentPerson,

    // writes
    saveProjects,
    saveProgrammes,
    savePortfolios,
    saveRecord,
    saveRecords,

    // lifecycle
    hydrate,
    ready,
    isHydrated: () => hydrated,
    pendingWrites,
    clearPending,
    clearPendingFor,

    // plumbing
    clearCache,
    isAvailable: () => Boolean(client()),
    session,
    assuranceLevel,

    // server-side audit
    getAuditTrail,
    auditReport,

    /*
      Diagnostics. Deliberately kept after the Stage 14 cleanup: these are how a
      bad write gets diagnosed, and they only read - none of them can change where
      the application gets its data from.
    */
    compare,
    compareAll,
    explain
  };
})();
