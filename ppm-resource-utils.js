(function () {
  "use strict";

  const CREATE_PERSON_VALUE = "__ppm_create_person__";
  let quickAddState = null;

  /*
    Stage 16: people come from PPMStore, which holds what PostgreSQL confirmed, rather than from
    the localStorage mirror hydration used to fill. all() already drops anything that is not a
    record, so the defensive filtering that used to be here has one home instead of nine.
  */
  function getResources() {
    return window.PPMStore ? window.PPMStore.people.all() : [];
  }

  /*
    Stage 16: the one write seam.

    Was localStorage.setItem("ppmResources", ...), which reached PostgreSQL only because both
    adapters had replaced Storage.prototype.setItem, and which returned before the database
    had been asked anything - so a caller could report success for a write the database went
    on to refuse.

    replaceAll keeps the collection-shaped call every caller already makes, and writes only
    the records that actually changed, one row at a time, each carrying its own version.
    Callers must look at what comes back.
  */
  async function saveResources(resources) {
    if (!window.PPMStore) {
      return {
        ok: false,
        reason: "failed",
        message: "The data layer is not loaded on this page, so nothing was saved.",
        queued: false
      };
    }
    return window.PPMStore.people.replaceAll(resources);
  }

  function nextResourceId(resources) {
    const maximum = resources.reduce((current, resource) => {
      const match = String(resource.resourceId || "").match(/^RES-(\d+)$/i);
      return match ? Math.max(current, Number(match[1])) : current;
    }, 0);

    return `RES-${String(maximum + 1).padStart(4, "0")}`;
  }

  function normaliseName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function findResource(resourceId, fallbackName) {
    const resources = getResources();
    const byId = resources.find((resource) => resource.resourceId === resourceId);
    if (byId) return byId;

    const name = normaliseName(fallbackName);
    return name ? resources.find((resource) => normaliseName(resource.fullName) === name) || null : null;
  }

  function optionLabel(resource) {
    const identity = resource.fullName || resource.resourceId || "Unnamed resource";
    const details = [resource.jobTitle || resource.role, resource.team].filter(Boolean).join(" · ");
    const kind = resource.resourceKind === "Generic placeholder" ? " [Placeholder]" : "";
    const review = resource.needsReview
      ? resource.email
        ? " [Details required]"
        : " [Email/details required]"
      : "";
    return `${identity}${details ? ` — ${details}` : ""}${kind}${review}`;
  }

  function ensureQuickAddDialog() {
    let dialog = document.getElementById("ppmQuickPersonModal");
    if (dialog) return dialog;

    /* Styles live in ppm-shared.css. They used to be injected as a <style>
       element here, which a browser treats as an inline style - and that is
       what forced style-src 'unsafe-inline' in the Content Security Policy. */

    dialog = document.createElement("div");
    dialog.id = "ppmQuickPersonModal";
    dialog.className = "ppm-quick-person-backdrop";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "ppmQuickPersonTitle");
    dialog.innerHTML = `
      <div class="ppm-quick-person-dialog">
        <div class="ppm-quick-person-header">
          <div>
            <h2 id="ppmQuickPersonTitle">Add a person</h2>
            <p>Create a placeholder now. Team, job title and capacity can be completed later in Resources.</p>
          </div>
          <button id="ppmQuickPersonClose" type="button" class="ppm-quick-person-close" aria-label="Close">&times;</button>
        </div>
        <form id="ppmQuickPersonForm">
          <div class="ppm-quick-person-body">
            <div class="ppm-quick-person-field">
              <label for="ppmQuickPersonName">Name *</label>
              <input id="ppmQuickPersonName" type="text" maxlength="150" required autocomplete="name">
            </div>
            <div class="ppm-quick-person-field">
              <label for="ppmQuickPersonEmail">Email *</label>
              <input id="ppmQuickPersonEmail" type="email" maxlength="254" required autocomplete="email">
            </div>
          </div>
          <div id="ppmQuickPersonMessage" class="ppm-quick-person-message" role="alert"></div>
          <div class="ppm-quick-person-footer">
            <button id="ppmQuickPersonCancel" type="button" class="ppm-quick-person-button secondary">Cancel</button>
            <button type="submit" class="ppm-quick-person-button" data-permission="resources.edit">Create and select</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);

    document.getElementById("ppmQuickPersonForm").addEventListener("submit", saveQuickAddPerson);
    document
      .getElementById("ppmQuickPersonCancel")
      .addEventListener("click", () => closeQuickAddPerson(false));
    document
      .getElementById("ppmQuickPersonClose")
      .addEventListener("click", () => closeQuickAddPerson(false));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeQuickAddPerson(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dialog.classList.contains("visible")) {
        closeQuickAddPerson(false);
      }
    });

    return dialog;
  }

  function showQuickAddMessage(message) {
    const messageElement = document.getElementById("ppmQuickPersonMessage");
    messageElement.textContent = message || "";
    messageElement.classList.toggle("visible", Boolean(message));
  }

  function openQuickAddPerson(select, settings) {
    const dialog = ensureQuickAddDialog();
    quickAddState = {
      select,
      settings: { ...(settings || {}) },
      previousValue: select.dataset.ppmPreviousResourceId || ""
    };
    document.getElementById("ppmQuickPersonForm").reset();
    showQuickAddMessage("");
    dialog.classList.add("visible");
    document.body.style.overflow = "hidden";
    document.getElementById("ppmQuickPersonName").focus();
  }

  function closeQuickAddPerson(wasCreated) {
    const dialog = document.getElementById("ppmQuickPersonModal");

    if (!wasCreated && quickAddState) {
      quickAddState.select.value = quickAddState.previousValue;
    }

    if (dialog) dialog.classList.remove("visible");
    document.body.style.overflow = "";
    quickAddState = null;
  }

  function selectQuickAddPerson(resource, alreadyExisted) {
    if (!quickAddState) return;

    const { select, settings } = quickAddState;
    populatePersonSelect(select, {
      ...settings,
      selectedResourceId: resource.resourceId,
      legacyName: resource.fullName
    });
    select.value = resource.resourceId;
    select.dataset.ppmPreviousResourceId = resource.resourceId;
    closeQuickAddPerson(true);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(
      new CustomEvent("ppm-resource-created", {
        bubbles: true,
        detail: { resource, alreadyExisted }
      })
    );
  }

  /* A submit handler, so the async chain that starts at the save ends here rather than
     rippling any further. */
  async function saveQuickAddPerson(event) {
    event.preventDefault();
    if (!quickAddState) return;

    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const fullName = document.getElementById("ppmQuickPersonName").value.trim().replace(/\s+/g, " ");
    const email = document.getElementById("ppmQuickPersonEmail").value.trim().toLowerCase();
    const resources = getResources();
    const existing = resources.find((resource) => {
      return (
        normaliseName(resource.fullName) === normaliseName(fullName) ||
        String(resource.email || "")
          .trim()
          .toLowerCase() === email
      );
    });

    if (existing) {
      selectQuickAddPerson(existing, true);
      return;
    }

    const now = new Date().toISOString();
    const resource = {
      resourceId: nextResourceId(resources),
      resourceKind: "Named person",
      fullName,
      email,
      team: "",
      department: "",
      jobTitle: "",
      role: "",
      skills: "",
      location: "",
      managerResourceId: "",
      resourceType: "Employee",
      workingPattern: "Full time",
      standardWeeklyCapacity: 37.5,
      nonWorkingHoursPerWeek: 0,
      fixedOperationalHoursPerWeek: 0,
      otherUnavailableHoursPerWeek: 0,
      effectiveStartDate: "",
      effectiveEndDate: "",
      active: true,
      placeholder: true,
      needsReview: true,
      migrationNote: "Created from a people picklist; complete team, role and capacity details.",
      createdAt: now,
      updatedAt: now
    };

    resources.push(resource);

    /*
      Awaited, and the person is only selected if it actually saved. Previously this pushed,
      wrote to localStorage and selected the new person regardless - so a refused write left
      somebody selected in a picklist who did not exist in the database, and the next page to
      load simply would not have them.
    */
    const result = await saveResources(resources);
    if (!result.ok) {
      const message = document.getElementById("ppmQuickPersonMessage");
      if (message) message.textContent = result.message;
      else console.error("PPMResources: the new person was not saved.", result.message);
      return;
    }

    selectQuickAddPerson(resource, false);
  }

  function bindQuickAdd(select, settings) {
    select.ppmPersonSelectSettings = { ...(settings || {}) };
    if (select.dataset.ppmQuickAddBound === "true") return;

    select.dataset.ppmQuickAddBound = "true";
    select.addEventListener("change", (event) => {
      if (select.value === CREATE_PERSON_VALUE) {
        event.stopImmediatePropagation();
        openQuickAddPerson(select, select.ppmPersonSelectSettings);
        return;
      }

      select.dataset.ppmPreviousResourceId = select.value || "";
    });
  }

  function populatePersonSelect(selectOrId, options) {
    const settings = options || {};
    const select = typeof selectOrId === "string" ? document.getElementById(selectOrId) : selectOrId;

    if (!select) return;

    const selectedResource = findResource(settings.selectedResourceId, settings.legacyName);
    const selectedId = selectedResource ? selectedResource.resourceId : "";
    const resources = getResources()
      .filter((resource) => {
        const isSelected = resource.resourceId === selectedId;
        const isActive = resource.active !== false && resource.status !== "Inactive";
        const kindAllowed = settings.allowGeneric || resource.resourceKind !== "Generic placeholder";
        return isSelected || (isActive && kindAllowed);
      })
      .sort((first, second) => optionLabel(first).localeCompare(optionLabel(second)));

    select.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = settings.blankLabel || "Select a person";
    select.appendChild(blank);

    resources.forEach((resource) => {
      const option = document.createElement("option");
      option.value = resource.resourceId;
      option.textContent = optionLabel(resource);
      option.dataset.name = resource.fullName || "";
      option.dataset.email = resource.email || "";
      option.dataset.team = resource.team || "";
      option.dataset.role = resource.jobTitle || resource.role || "";
      select.appendChild(option);
    });

    if (settings.allowCreate !== false) {
      const createOption = document.createElement("option");
      createOption.value = CREATE_PERSON_VALUE;
      createOption.textContent = "+ Add a person (name and email)";
      select.appendChild(createOption);
    }

    if (selectedId) select.value = selectedId;
    select.dataset.ppmPreviousResourceId = selectedId || "";
    bindQuickAdd(select, settings);
  }

  function getSelectedPerson(selectOrId) {
    const select = typeof selectOrId === "string" ? document.getElementById(selectOrId) : selectOrId;

    if (!select || !select.value) {
      return { resourceId: "", name: "", email: "", team: "", role: "" };
    }

    const resource = findResource(select.value, "");
    if (!resource) {
      return { resourceId: "", name: "", email: "", team: "", role: "" };
    }

    return {
      resourceId: resource.resourceId || "",
      name: resource.fullName || "",
      email: resource.email || "",
      team: resource.team || "",
      role: resource.jobTitle || resource.role || ""
    };
  }

  function collectLegacyPeople() {
    const people = [];

    const addPerson = (name, email, resourceId) => {
      const cleanName = String(name || "").trim();
      if (!cleanName) return;
      people.push({
        fullName: cleanName,
        email: String(email || "").trim(),
        resourceId: String(resourceId || "").trim()
      });
    };

    /* all() flattens the project-keyed shape plans and RAID are stored in, so the three
       different unpackings this used to do are now one call each. */
    const store = window.PPMStore;

    (store ? store.projects.all() : []).forEach((project) => {
      addPerson(project.projectManager, project.projectManagerEmail, project.projectManagerResourceId);
      addPerson(project.sponsor, project.sponsorEmail, project.sponsorResourceId);
      addPerson(project.projectLead, project.projectLeadEmail, project.projectLeadResourceId);
    });

    (store ? store.plans.all() : []).forEach((task) => {
      addPerson(task.taskOwner, task.taskOwnerEmail, task.taskOwnerResourceId);
    });

    (store ? store.raid.all() : []).forEach((item) => {
      addPerson(item.owner, item.ownerEmail, item.ownerResourceId);
      addPerson(item.raisedBy, item.raisedByEmail, item.raisedByResourceId);
      addPerson(item.resolutionOwner, item.resolutionOwnerEmail, item.resolutionOwnerResourceId);
    });

    return people;
  }

  /*
    Stage 16: the read and the write are separated.

    This used to be one function that read the resources, derived any people who exist only in
    a legacy name field, and persisted them if anything had changed. Eleven call sites across
    ten files use the return value, one of them at the top of a page script where there is no
    function to make asynchronous - so a getter that also writes could not survive writes
    becoming awaited. It should not have been a getter that writes in any case.

    So deriveLegacyResources() computes and returns; backfillLegacyResources() is the only
    thing that saves. ensureLegacyResources() keeps its old name and its old synchronous
    contract, and all eleven callers are unaffected.

    IDENTIFIERS ARE STILL STABLE

    A derived person is given the next free RES-nnnn, so it matters that two pages deriving the
    same list agree. They do: the derivation is a pure function of the resources and the legacy
    people, and both pages read the same hydrated data. Persisting it early still matters, which
    is why the resource directory backfills on load - that freezes the identifiers rather than
    leaving them recomputed. That was previously a side effect of whichever page happened to
    call the getter first.
  */
  function deriveLegacyResources() {
    const resources = getResources();
    let changed = false;

    collectLegacyPeople().forEach((person) => {
      let existing = person.resourceId
        ? resources.find((resource) => resource.resourceId === person.resourceId)
        : null;

      if (!existing) {
        existing = resources.find(
          (resource) => normaliseName(resource.fullName) === normaliseName(person.fullName)
        );
      }

      if (existing) {
        if (!existing.email && person.email) {
          existing.email = person.email;
          existing.needsReview = false;
          changed = true;
        }
        return;
      }

      const now = new Date().toISOString();
      resources.push({
        resourceId: nextResourceId(resources),
        resourceKind: "Named person",
        fullName: person.fullName,
        email: person.email,
        team: "",
        department: "",
        jobTitle: "",
        role: "",
        skills: "",
        location: "",
        managerResourceId: "",
        resourceType: "Employee",
        workingPattern: "Full time",
        standardWeeklyCapacity: 37.5,
        effectiveStartDate: "",
        effectiveEndDate: "",
        active: true,
        needsReview: !person.email,
        migrationNote: "Migrated from an existing people field; add email and resource details.",
        createdAt: now,
        updatedAt: now
      });
      changed = true;
    });

    return { resources, changed };
  }

  /* The old name and the old contract: synchronous, returns the resources. It no longer
     writes, which is the only thing that changed for its eleven callers. */
  function ensureLegacyResources() {
    return deriveLegacyResources().resources;
  }

  /* The write half. Call it once where it matters - the resource directory does, on load -
     and look at what it returns, because unlike the old side effect this one can fail. */
  async function backfillLegacyResources() {
    const { resources, changed } = deriveLegacyResources();
    if (!changed) return { ok: true, saved: 0, unchanged: resources.length, nothingToDo: true };
    return saveResources(resources);
  }

  function resolveDisplayName(resourceId, fallbackName) {
    const resource = findResource(resourceId, fallbackName);
    return resource ? resource.fullName : fallbackName || "";
  }

  window.PPMResources = {
    getResources,
    saveResources,
    nextResourceId,
    findResource,
    optionLabel,
    populatePersonSelect,
    getSelectedPerson,
    ensureLegacyResources,
    backfillLegacyResources,
    resolveDisplayName
  };
})();
