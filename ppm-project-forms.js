/*
  Renders the project editors from the field registry.

  Three forms, all on the project details page, all rendered from ppm-project-fields.js:

    details    what the project is - identity, ownership, scope, strategic context
    status     what it is doing - stage, dates, progress, the nine RAGs, commentary
    assurance  the evidence each stage gate expects, grouped by stage

  Nothing here touches add-project.html. That page keeps its own markup for creating a
  project; these forms are built from the registry, which is derived from it at build time
  by BUILD-PROJECT-FIELDS.mjs so no field can be missed. At runtime the two are unrelated.

  WHAT THIS MODULE IS CAREFUL ABOUT

  - Field ids are prefixed. A control called `projectName` would collide with an element of
    that name on the host page, and getElementById returns whichever comes first - so one of
    the two readers silently gets the wrong element. Nothing here uses a bare field id; the
    reader queries [data-field] inside the form it was given.

  - A stored value that is not one of a select's options is kept, not dropped. Reference
    data changes, and a project carrying a retired option would otherwise have that value
    silently rewritten the next time anyone saved an unrelated field.

  - Read-only fields never enter the patch. The project code is generated and immutable;
    offering it back as a value to save is how it stops being either.

  - The patch contains only the fields of the form that was open. Editing the status must
    not rewrite the description with a stale copy of it.
*/
(function () {
  "use strict";

  const PREFIX = "ppmField-";
  const escapeHtml = (value) => PPMCore.escapeHtml(value);

  /* Every RAG dimension's field is `${key}Rag`, which is also what the record stores. */
  const ragFieldId = (key) => `${key}Rag`;
  const justificationFieldId = (key) => `${key}RagOverrideJustification`;

  function definitionOf(formName) {
    const form = window.PPMProjectFields?.forms?.[formName];
    if (!form) throw new Error(`No project form is defined as "${formName}".`);
    return form;
  }

  function allFields(formName) {
    return definitionOf(formName).groups.flatMap((group) => group.fields);
  }

  /* ------------------------------------------------------------------ markup */

  function attributesFor(field, permission) {
    const parts = [
      `id="${PREFIX}${field.id}"`,
      `data-field="${escapeHtml(field.id)}"`,
      /*
        PPMAuth fails closed: any control it finds that changes data and carries no
        data-permission is disabled, and it reports it in the console as untagged. These
        controls are created after its startup pass, so without this every field in the form
        arrived disabled - the permission model working exactly as designed, on markup that
        forgot to say what it needed.
      */
      `data-permission="${escapeHtml(permission)}"`
    ];
    if (field.required) parts.push("required");
    if (field.readOnly) parts.push("readonly");
    ["placeholder", "maxlength", "min", "max", "step"].forEach((name) => {
      if (field[name] !== undefined) parts.push(`${name}="${escapeHtml(field[name])}"`);
    });
    return parts.join(" ");
  }

  function controlMarkup(field, permission) {
    if (field.control === "select") {
      const options = (field.options || [])
        .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
        .join("");
      return `<select ${attributesFor(field, permission)}>${options}</select>`;
    }
    if (field.control === "textarea") {
      return `<textarea ${attributesFor(field, permission)} rows="${escapeHtml(field.rows || 3)}"></textarea>`;
    }
    return `<input ${attributesFor(field, permission)} type="${escapeHtml(field.type || "text")}">`;
  }

  function fieldMarkup(field, permission) {
    /* Long-form answers get the full width of the grid; there is no reading a business
       problem two inches at a time. */
    const wide = field.control === "textarea" ? " pf-field-wide" : "";
    const help = field.help ? `<p class="pf-help">${escapeHtml(field.help)}</p>` : "";
    const required = field.required ? ' <span class="pf-required" aria-hidden="true">*</span>' : "";
    /* The registry's label carries the asterisk the creation form marked up separately. */
    const label = escapeHtml(String(field.label).replace(/\s*\*$/, ""));
    return (
      `<div class="pf-field${wide}" data-field-container="${escapeHtml(field.id)}">` +
      `<label for="${PREFIX}${field.id}">${label}${required}</label>` +
      controlMarkup(field, permission) +
      `<p class="pf-problem" role="alert"></p>` +
      help +
      `</div>`
    );
  }

  function groupMarkup(group, index, permission) {
    /* Only the first group starts open. Forty fields all expanded is a wall, and the
       reader almost always wants the group they came for. */
    const open = index === 0 ? " open" : "";
    return (
      `<details class="pf-group"${open}>` +
      `<summary><span class="pf-group-name">${escapeHtml(group.name)}</span>` +
      `<span class="pf-group-count">${group.fields.length} field${group.fields.length === 1 ? "" : "s"}</span></summary>` +
      `<div class="pf-grid">${group.fields.map((field) => fieldMarkup(field, permission)).join("")}</div>` +
      `</details>`
    );
  }

  /*
    The nine RAG dimensions each get a badge showing what the rules calculate, and a
    justification box that is required when the reported value differs. Added here rather
    than sitting in the registry because they are not stored fields of their own shape -
    the justifications live together in one object on the record.
  */
  function decorateRagFields(host) {
    if (!window.PPMPlanning?.RAG_DIMENSIONS) return;
    PPMPlanning.RAG_DIMENSIONS.forEach(([key, label]) => {
      const container = host.querySelector(`[data-field-container="${ragFieldId(key)}"]`);
      if (!container || container.dataset.ragDecorated === "true") return;
      container.dataset.ragDecorated = "true";

      const badge = document.createElement("span");
      badge.className = "pf-calculated";
      badge.dataset.calculatedFor = key;
      container.querySelector("select, input")?.insertAdjacentElement("afterend", badge);

      const reason = document.createElement("textarea");
      reason.className = "pf-override-reason";
      reason.rows = 2;
      reason.maxLength = 2000;
      reason.dataset.justificationFor = key;
      reason.dataset.permission = "projects.status";
      reason.id = `${PREFIX}${justificationFieldId(key)}`;
      reason.placeholder = `Why the reported ${String(label).toLowerCase()} RAG differs from the calculated one`;

      const reasonLabel = document.createElement("label");
      reasonLabel.className = "pf-override-label";
      reasonLabel.setAttribute("for", reason.id);
      reasonLabel.textContent = "Reason for the override";

      container.append(reasonLabel, reason);
    });
  }

  function render(host, formName) {
    const definition = definitionOf(formName);
    if (host.dataset.ppmForm === formName) return;

    host.innerHTML = definition.groups
      .map((group, index) => groupMarkup(group, index, definition.permission || "projects.edit"))
      .join("");
    host.dataset.ppmForm = formName;
    if (formName === "status") decorateRagFields(host);
    PPMCore.applyComputedStyles(host);
  }

  /* ----------------------------------------------------------------- reading */

  const controlsIn = (host) => [...host.querySelectorAll("[data-field]")];

  function controlFor(host, id) {
    return host.querySelector(`[data-field="${id}"]`);
  }

  function coerce(field, raw) {
    if (field.control === "input" && field.type === "number") {
      if (String(raw).trim() === "") return "";
      const value = Number(raw);
      return Number.isFinite(value) ? value : "";
    }
    return typeof raw === "string" ? raw.trim() : raw;
  }

  /*
    Returns only what this form is responsible for. The caller merges it over the record it
    already loaded, which is what preserves the version optimistic locking depends on -
    re-reading the record here would defeat it.
  */
  function read(host, formName) {
    const patch = {};
    const byId = new Map(allFields(formName).map((field) => [field.id, field]));

    controlsIn(host).forEach((control) => {
      const field = byId.get(control.dataset.field);
      if (!field || field.readOnly) return;
      patch[field.id] = coerce(field, control.value);
    });

    if (formName === "status" && window.PPMPlanning?.RAG_DIMENSIONS) {
      const justifications = {};
      PPMPlanning.RAG_DIMENSIONS.forEach(([key]) => {
        const reason = host.querySelector(`[data-justification-for="${key}"]`);
        justifications[key] = reason ? reason.value.trim() : "";
      });
      patch.ragOverrideJustifications = justifications;
    }

    return patch;
  }

  /* --------------------------------------------------------------- populating */

  function setValue(host, field, value) {
    const control = controlFor(host, field.id);
    if (!control) return;
    const text = value === null || value === undefined ? "" : String(value);

    /*
      A stored value that is no longer offered is added back as an option rather than
      discarded. Reference data gets retired; a project that still carries the retired
      value must not have it silently rewritten by someone saving a different field.
    */
    if (control.tagName === "SELECT" && text && ![...control.options].some((o) => o.value === text)) {
      const option = document.createElement("option");
      option.value = text;
      option.textContent = `${text} (current value, no longer offered)`;
      control.append(option);
    }

    control.value = text;
  }

  function populate(host, formName, project) {
    const record = project || {};
    allFields(formName).forEach((field) => setValue(host, field, record[field.id]));

    if (formName === "status" && window.PPMPlanning?.RAG_DIMENSIONS) {
      const justifications = record.ragOverrideJustifications || {};
      PPMPlanning.RAG_DIMENSIONS.forEach(([key]) => {
        const reason = host.querySelector(`[data-justification-for="${key}"]`);
        if (reason) reason.value = justifications[key] || "";
      });
      refreshCalculated(host, record);
    }

    clearProblems(host);
  }

  /* -------------------------------------------------------- calculated RAGs */

  function calculatedFor(host, project) {
    if (!window.PPMPlanning?.calculateProjectRags) return {};
    return PPMPlanning.calculateProjectRags({ ...(project || {}), ...read(host, "status") });
  }

  /*
    A RAG value is a colour before it is a word, so it is shown in its own colour: green for
    Green, amber for Amber, red for Red, grey for Not Assessed. The badge used to be one
    purple for every value, which made a green project look like whatever purple means.
  */
  const RAG_TONES = { Green: "pf-rag-green", Amber: "pf-rag-amber", Red: "pf-rag-red" };
  const ragTone = (value) => RAG_TONES[value] || "pf-rag-none";

  function paintRag(element, value) {
    if (!element) return;
    Object.values(RAG_TONES)
      .concat("pf-rag-none")
      .forEach((tone) => element.classList.remove(tone));
    element.classList.add(ragTone(value));
  }

  function refreshCalculated(host, project) {
    if (!window.PPMPlanning?.RAG_DIMENSIONS) return {};
    const calculated = calculatedFor(host, project);

    PPMPlanning.RAG_DIMENSIONS.forEach(([key]) => {
      const select = controlFor(host, ragFieldId(key));
      const reported = select?.value || "Not Assessed";
      /* The reported value is what the reader chose, so it is what the control shows. */
      paintRag(select, reported);

      const badge = host.querySelector(`[data-calculated-for="${key}"]`);
      if (!badge) return;
      const value = calculated[key] || "Not Assessed";
      const differs = reported !== value;

      badge.textContent = `Calculated: ${value}${differs ? " · override" : ""}`;
      badge.className = "pf-calculated";
      paintRag(badge, value);
      if (differs) badge.classList.add("pf-calculated-override");

      /* The justification only appears when it is actually needed. */
      const container = host.querySelector(`[data-field-container="${ragFieldId(key)}"]`);
      if (container) container.classList.toggle("pf-override-needed", differs);
    });

    return calculated;
  }

  /* -------------------------------------------------------------- validation */

  function clearProblems(host) {
    host.querySelectorAll(".pf-problem").forEach((problem) => {
      problem.textContent = "";
    });
    host.querySelectorAll(".pf-field-invalid").forEach((field) => field.classList.remove("pf-field-invalid"));
  }

  function flag(host, id, message, problems) {
    const container = host.querySelector(`[data-field-container="${id}"]`);
    if (container) {
      container.classList.add("pf-field-invalid");
      const problem = container.querySelector(".pf-problem");
      if (problem) problem.textContent = message;
      /* A problem inside a collapsed group is a problem nobody can see. */
      const group = container.closest("details.pf-group");
      if (group) group.open = true;
    }
    problems.push(message);
  }

  /* Ordered pairs, checked only when both ends are present. */
  const DATE_PAIRS = [
    ["baselineStartDate", "baselineEndDate", "The baseline end date cannot be before the baseline start date."],
    ["forecastStartDate", "forecastEndDate", "The forecast end date cannot be before the forecast start date."],
    ["actualStartDate", "actualEndDate", "The actual end date cannot be before the actual start date."]
  ];

  function validate(host, formName, project) {
    clearProblems(host);
    const problems = [];
    const fields = allFields(formName);
    const patch = read(host, formName);

    fields.forEach((field) => {
      if (!field.required || field.readOnly) return;
      const value = patch[field.id];
      if (value === "" || value === null || value === undefined) {
        flag(host, field.id, `${String(field.label).replace(/\s*\*$/, "")} is required.`, problems);
      }
    });

    DATE_PAIRS.forEach(([from, to, message]) => {
      if (!(from in patch) || !(to in patch)) return;
      if (patch[from] && patch[to] && patch[to] < patch[from]) flag(host, to, message, problems);
    });

    if ("percentageComplete" in patch && patch.percentageComplete !== "") {
      const percentage = Number(patch.percentageComplete);
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)
        flag(host, "percentageComplete", "Percentage complete must be between 0 and 100.", problems);
    }

    /*
      A reported RAG that differs from the calculated one is allowed - the rules cannot know
      everything - but it has to be explained, because an unexplained override is
      indistinguishable from a mistake when someone reads it back in three months.
    */
    if (formName === "status" && window.PPMPlanning?.RAG_DIMENSIONS) {
      const calculated = refreshCalculated(host, project);
      PPMPlanning.RAG_DIMENSIONS.forEach(([key, label]) => {
        const reported = patch[ragFieldId(key)];
        const computed = calculated[key] || "Not Assessed";
        if (!reported || reported === computed) return;
        if (!(patch.ragOverrideJustifications?.[key] || "").trim()) {
          flag(
            host,
            ragFieldId(key),
            `The reported ${String(label).toLowerCase()} RAG differs from the calculated ${computed}. Give a reason for the override.`,
            problems
          );
        }
      });
    }

    return problems;
  }

  /*
    First thing to run in the console when a button appears to do nothing. Almost every
    report of that shape comes down to one of the first three lines: the registry did not
    load, the panel is not on the page, or the trigger was never bound.
  */
  function explain() {
    const trigger = (id) => {
      const element = document.getElementById(id);
      if (!element) return "missing from the page";
      const bound = element.dataset.ppmEditorBound === "true";
      const blocked = element.disabled || element.getAttribute("aria-disabled") === "true";
      return `${element.tagName.toLowerCase()}, ${bound ? "bound" : "NOT BOUND"}${blocked ? ", DISABLED by permissions" : ""}`;
    };

    console.group("PPMProjectForms status");
    console.log("Field registry loaded :", Boolean(window.PPMProjectFields?.forms));
    console.log(
      "Forms defined         :",
      window.PPMProjectFields?.forms ? Object.keys(window.PPMProjectFields.forms).join(", ") : "none"
    );
    console.log("Editor panel on page  :", Boolean(document.getElementById("projectEditorPanel")));
    console.log("Editor host on page   :", Boolean(document.getElementById("projectEditorHost")));
    console.table(
      ["editProjectButton", "updateStatusButton", "editAssuranceButton", "projectEditLink", "projectStatusLink", "projectAssuranceLink", "projectEditorSave", "projectEditorCancel"].map((id) => ({
        control: id,
        state: trigger(id)
      }))
    );
    console.log("PPMPlanning loaded    :", Boolean(window.PPMPlanning?.calculateProjectRags));
    console.log("PPMAuth loaded        :", Boolean(window.PPMAuth?.can));
    console.groupEnd();

    return {
      registry: Boolean(window.PPMProjectFields?.forms),
      panel: Boolean(document.getElementById("projectEditorPanel")),
      host: Boolean(document.getElementById("projectEditorHost"))
    };
  }

  window.PPMProjectForms = Object.freeze({
    render,
    populate,
    read,
    validate,
    refreshCalculated,
    explain,
    fieldCount: (formName) => allFields(formName).length,
    titleOf: (formName) => definitionOf(formName).title,
    descriptionOf: (formName) => definitionOf(formName).description,
    permissionOf: (formName) => definitionOf(formName).permission || "projects.edit"
  });
})();
