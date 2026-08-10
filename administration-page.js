"use strict";

(function () {
  "use strict";
  const el = (id) => document.getElementById(id);
  const escapeHtml = PPMCore.escapeHtml;
  const clone = PPMCore.clone;
  let state = {};
  let selectedTemplateId = "";
  let selectedCalendarId = "";
  let editingPortfolioId = "";
  let editingCalendarId = "";
  let pendingAction = null;
  let displayedRuleScope = null;
  let displayedReferenceCategory = "";

  function canAdmin() {
    if (!window.PPMAuth) return true;
    const user = PPMAuth.getCurrentUser && PPMAuth.getCurrentUser();
    return Boolean(
      PPMAuth.can("administration.edit") ||
      PPMAuth.can("users.manage") ||
      ["System Administrator", "Portfolio Manager / PMO Manager"].includes(user && user.accessRole)
    );
  }

  function canPortfolioEdit() {
    return canAdmin() || !window.PPMAuth || Boolean(PPMAuth.can("portfolios.edit"));
  }

  /*
    Stage 16: every configuration save goes through here.

    PPMAdmin now returns { ok, reason, message, value } instead of the saved value, because a
    write can be refused - by row-level security, by a version clash, or by being offline. This
    unwraps it: on success the caller gets the value it used to get, and on failure it gets the
    value it already had, the reason on screen, and false so it can stop.

    The alternative was four extra lines at each of thirteen call sites, which is how one of
    them quietly ends up not checking.
  */
  async function persist(promise, current) {
    const result = await promise;
    if (result && result.ok) return { ok: true, value: result.value };
    const message = (result && result.message) || "The change could not be saved.";
    showMessage(
      result && result.queued
        ? `${message} It is saved on this computer and will be retried.`
        : message,
      result && result.queued ? "warning" : "error"
    );
    return { ok: false, value: current };
  }

  function showMessage(message, type) {
    const box = el("pageMessage");
    box.textContent = message;
    box.className = `message ${type || "success"}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => {
      box.className = "message";
    }, 6000);
  }

  function assertEdit() {
    if (canAdmin()) return true;
    if (window.PPMAuth)
      PPMAuth.permissionToast(
        "Only authorised system and portfolio administrators can change this configuration."
      );
    return false;
  }

  function assertPortfolioEdit() {
    if (canPortfolioEdit()) return true;
    if (window.PPMAuth) PPMAuth.permissionToast("You do not have permission to change portfolio records.");
    return false;
  }

  function setEditAccess() {
    const editable = canAdmin();
    const portfolioEditable = canPortfolioEdit();
    el("portfolioForm")
      .querySelectorAll(".admin-input")
      .forEach((control) => control.classList.add("portfolio-input"));
    el("readOnlyNote").style.display = editable ? "none" : "block";
    if (!editable && portfolioEditable)
      el("readOnlyNote").textContent =
        "Portfolio editor access: you can maintain portfolio records; shared lifecycle, validation, reference-data, RAG and reporting configuration remains read-only.";
    document.querySelectorAll(".admin-edit,.admin-input:not(.portfolio-input)").forEach((control) => {
      if (!editable && !control.disabled) {
        control.disabled = true;
        control.dataset.adminAccessDisabled = "true";
      } else if (editable && control.dataset.adminAccessDisabled === "true") {
        control.disabled = false;
        delete control.dataset.adminAccessDisabled;
      }
    });
    document.querySelectorAll(".portfolio-edit-control,.portfolio-input").forEach((control) => {
      if (!portfolioEditable && !control.disabled) {
        control.disabled = true;
        control.dataset.portfolioAccessDisabled = "true";
      } else if (portfolioEditable && control.dataset.portfolioAccessDisabled === "true") {
        control.disabled = false;
        delete control.dataset.portfolioAccessDisabled;
      }
    });
  }

  function reloadState() {
    state = {
      portfolios: PPMAdmin.getPortfolios(),
      templates: PPMAdmin.getLifecycleTemplates(),
      references: PPMAdmin.getReferenceData(),
      rules: PPMAdmin.getMandatoryRules(),
      rag: PPMAdmin.getRagConfig(),
      calendars: PPMAdmin.getReportingCalendars(),
      periods: PPMAdmin.getReportingPeriods()
    };
    selectedTemplateId =
      selectedTemplateId && state.templates.some((row) => row.templateId === selectedTemplateId)
        ? selectedTemplateId
        : state.templates[0]?.templateId || "";
    selectedCalendarId =
      selectedCalendarId && state.calendars.some((row) => row.calendarId === selectedCalendarId)
        ? selectedCalendarId
        : state.calendars.find((row) => row.isDefault)?.calendarId || state.calendars[0]?.calendarId || "";
  }

  function openTab(name) {
    document
      .querySelectorAll(".tab-button")
      .forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
    document
      .querySelectorAll(".tab-panel")
      .forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${name}`));
    history.replaceState({}, "", `${location.pathname}#${name}`);
  }

  function confirmChange(message, label, action) {
    pendingAction = action;
    el("confirmationMessage").textContent = message;
    el("confirmAction").textContent = label || "Confirm";
    el("confirmationBubble").classList.add("visible");
    el("confirmAction").focus();
  }

  function closeConfirmation() {
    pendingAction = null;
    el("confirmationBubble").classList.remove("visible");
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }
  function formatDate(value) {
    if (!value) return "Not set";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  function option(value, label, selected) {
    return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }

  function renderOverview() {
    el("summaryPortfolios").textContent = state.portfolios.filter((row) => row.active).length;
    el("summaryTemplates").textContent = state.templates.filter((row) => row.active).length;
    el("summaryStages").textContent = state.templates
      .filter((row) => row.active)
      .reduce((total, row) => total + row.stages.filter((stage) => stage.active).length, 0);
    const currentVersions = Object.fromEntries(
      state.templates.map((row) => [row.templateId, Number(row.version || 1)])
    );
    el("summaryRules").textContent = state.rules.filter(
      (row) =>
        row.active && row.required && Number(row.templateVersion || 1) === currentVersions[row.templateId]
    ).length;
    el("summaryReferences").textContent = Object.values(state.references)
      .flat()
      .filter((row) => row.active).length;
    el("summaryPeriods").textContent = state.periods.filter(
      (row) => row.status === "Open" && !row.locked
    ).length;
  }

  function resourceRows() {
    const rows = PPMAuth.readGlobal(
      "ppmResources",
      [],
      "administration assigns portfolio owners and sponsors from the full people directory"
    );
    return Array.isArray(rows)
      ? rows.filter((row) => row && row.active !== false && row.resourceKind !== "Generic placeholder")
      : [];
  }

  function programmeRows() {
    const rows = PPMAuth.readGlobal(
      "ppmProgrammes",
      [],
      "administration maintains programme-to-portfolio membership across the whole portfolio"
    );
    return Array.isArray(rows) ? rows.filter((row) => row && row.active !== false) : [];
  }

  function fillPeopleSelect(select, selectedId) {
    const resources = resourceRows().sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
    select.innerHTML =
      '<option value="">Select a person</option>' +
      resources
        .map((row) =>
          option(
            row.resourceId,
            `${row.fullName}${row.jobTitle ? ` · ${row.jobTitle}` : ""}`,
            row.resourceId === selectedId
          )
        )
        .join("");
  }

  function personSelection(select) {
    const row = resourceRows().find((resource) => resource.resourceId === select.value);
    return row
      ? { name: row.fullName || "", resourceId: row.resourceId || "", email: row.email || "" }
      : { name: "", resourceId: "", email: "" };
  }

  function renderPortfolios() {
    const templateMap = Object.fromEntries(state.templates.map((row) => [row.templateId, row.name]));
    const calendarMap = Object.fromEntries(state.calendars.map((row) => [row.calendarId, row.name]));
    el("portfolioRows").innerHTML = state.portfolios
      .map(
        (row) =>
          `<tr><td><span class="cell-title">${escapeHtml(row.name)}</span><span class="cell-subtext">${escapeHtml(row.portfolioId)} · ${(row.programmeIds || []).length} programme${(row.programmeIds || []).length === 1 ? "" : "s"}</span></td>
<td>${escapeHtml(row.owner || "Not assigned")}</td>
<td>${escapeHtml(row.executiveSponsor || "Not assigned")}</td>
<td><span class="badge ${row.active ? "green" : ""}">${escapeHtml(row.status)}</span></td>
<td>${formatMoney(row.budget)}</td>
<td>${escapeHtml(templateMap[row.lifecycleTemplateId] || "Not set")}</td>
<td><span class="cell-title">${escapeHtml(row.defaultReportingFrequency || "Not set")}</span><span class="cell-subtext">${escapeHtml(calendarMap[row.reportingCalendarId] || "No calendar")}</span></td>
<td><div class="action-group"><button class="button light small portfolio-edit" type="button" data-id="${escapeHtml(row.portfolioId)}" data-permission="administration.edit">Edit</button><button class="button danger small portfolio-retire admin-edit" type="button" data-id="${escapeHtml(row.portfolioId)}" ${row.active ? "" : "disabled"} data-permission="administration.edit">Retire</button></div></td></tr>`
      )
      .join("");
    document.querySelectorAll(".portfolio-edit,.portfolio-retire").forEach((button) => {
      button.classList.remove("admin-edit");
      button.classList.add("portfolio-edit-control");
      button.dataset.permission = "portfolios.edit";
    });
    el("portfolioEmpty").hidden = state.portfolios.length > 0;
    document
      .querySelectorAll(".portfolio-edit")
      .forEach((button) => button.addEventListener("click", () => openPortfolio(button.dataset.id)));
    document
      .querySelectorAll(".portfolio-retire")
      .forEach((button) => button.addEventListener("click", () => retirePortfolio(button.dataset.id)));
  }

  function populatePortfolioModalOptions(row) {
    fillPeopleSelect(el("portfolioOwner"), row.ownerResourceId);
    fillPeopleSelect(el("portfolioSponsor"), row.executiveSponsorResourceId);
    el("portfolioLifecycle").innerHTML = state.templates
      .filter((item) => item.active || item.templateId === row.lifecycleTemplateId)
      .map((item) =>
        option(
          item.templateId,
          `${item.name} (v${item.version})`,
          item.templateId === row.lifecycleTemplateId
        )
      )
      .join("");
    el("portfolioCalendar").innerHTML =
      '<option value="">No calendar</option>' +
      state.calendars
        .filter((item) => item.active || item.calendarId === row.reportingCalendarId)
        .map((item) => option(item.calendarId, item.name, item.calendarId === row.reportingCalendarId))
        .join("");
    fillPortfolioPeriodOptions(row.reportingCalendarId, row.currentReportingPeriodId);
    el("portfolioProgrammes").innerHTML = programmeRows()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((item) =>
        option(
          item.programmeId || item.workstreamId || item.name,
          item.name || item.workstream || item.programmeId,
          (row.programmeIds || []).includes(item.programmeId || item.workstreamId || item.name)
        )
      )
      .join("");
    el("portfolioReportingFrequency").innerHTML = PPMAdmin.getReferenceValues("reportingFrequencies", {
      includeInactive: true
    })
      .map((item) => option(item.value, item.label, item.value === row.defaultReportingFrequency))
      .join("");
  }

  function fillPortfolioPeriodOptions(calendarId, selectedPeriodId) {
    el("portfolioPeriod").innerHTML =
      '<option value="">No current period</option>' +
      state.periods
        .filter((item) => !calendarId || item.calendarId === calendarId || item.periodId === selectedPeriodId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map((item) =>
          option(item.periodId, `${item.name} · ${item.status}`, item.periodId === selectedPeriodId)
        )
        .join("");
  }

  function openPortfolio(id) {
    const existing = state.portfolios.find((row) => row.portfolioId === id);
    if (!existing && !assertPortfolioEdit()) return;
    const row =
      existing ||
      PPMAdmin.normalisePortfolio(
        {
          portfolioId: PPMAdmin.nextPortfolioId(state.portfolios),
          name: "",
          status: "Active",
          active: true,
          lifecycleTemplateId: state.templates.find((item) => item.isDefault)?.templateId || "",
          reportingCalendarId: state.calendars.find((item) => item.isDefault)?.calendarId || ""
        },
        state.portfolios.length
      );
    editingPortfolioId = existing ? id : "";
    populatePortfolioModalOptions(row);
    el("portfolioModalTitle").textContent = existing ? "Edit portfolio" : "Add portfolio";
    el("portfolioId").value = row.portfolioId;
    el("portfolioName").value = row.name;
    el("portfolioStatus").value = row.status;
    el("portfolioDescription").value = row.description;
    el("portfolioBudget").value = row.budget;
    el("portfolioFinancialYear").value = String(row.financialYearStartMonth || 4);
    el("portfolioFinancialYearName").value = row.financialYear || "";
    el("portfolioObjectives").value = row.objectives || "";
    el("portfolioPriorities").value = row.priorities || "";
    el("portfolioRisks").value = (row.risks || []).join("\n");
    el("portfolioIssues").value = (row.issues || []).join("\n");
    el("portfolioDependencies").value = (row.dependencies || []).join("\n");
    el("portfolioModal").classList.add("visible");
  }

  function closePortfolio() {
    editingPortfolioId = "";
    el("portfolioModal").classList.remove("visible");
  }

  async function savePortfolio(event) {
    event.preventDefault();
    if (!assertPortfolioEdit()) return;
    const name = el("portfolioName").value.trim();
    if (!name) {
      showMessage("Enter a portfolio name.", "error");
      return;
    }
    const id = el("portfolioId").value;
    if (
      state.portfolios.some((row) => row.portfolioId !== id && row.name.toLowerCase() === name.toLowerCase())
    ) {
      showMessage("Portfolio names must be unique.", "error");
      return;
    }
    const owner = personSelection(el("portfolioOwner"));
    const sponsor = personSelection(el("portfolioSponsor"));
    const existing = state.portfolios.find((row) => row.portfolioId === editingPortfolioId);
    const record = PPMAdmin.normalisePortfolio(
      {
        ...(existing || {}),
        portfolioId: id,
        name,
        description: el("portfolioDescription").value.trim(),
        owner: owner.name,
        ownerResourceId: owner.resourceId,
        ownerEmail: owner.email,
        executiveSponsor: sponsor.name,
        executiveSponsorResourceId: sponsor.resourceId,
        executiveSponsorEmail: sponsor.email,
        status: el("portfolioStatus").value,
        active: el("portfolioStatus").value === "Active",
        budget: Number(el("portfolioBudget").value || 0),
        financialYearStartMonth: Number(el("portfolioFinancialYear").value),
        financialYear: el("portfolioFinancialYearName").value.trim(),
        lifecycleTemplateId: el("portfolioLifecycle").value,
        reportingCalendarId: el("portfolioCalendar").value,
        currentReportingPeriodId: el("portfolioPeriod").value,
        defaultReportingFrequency: el("portfolioReportingFrequency").value,
        programmeIds: [...el("portfolioProgrammes").selectedOptions].map((item) => item.value),
        objectives: el("portfolioObjectives").value.trim(),
        priorities: el("portfolioPriorities").value.trim(),
        risks: el("portfolioRisks")
          .value.split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
        issues: el("portfolioIssues")
          .value.split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
        dependencies: el("portfolioDependencies")
          .value.split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
        updatedAt: new Date().toISOString()
      },
      state.portfolios.length
    );
    const assignedProgrammeIds = new Set(record.programmeIds || []);
    state.portfolios = state.portfolios.map((row) =>
      row.portfolioId === record.portfolioId
        ? row
        : {
            ...row,
            programmeIds: (row.programmeIds || []).filter(
              (programmeId) => !assignedProgrammeIds.has(programmeId)
            )
          }
    );
    const index = state.portfolios.findIndex((row) => row.portfolioId === editingPortfolioId);
    if (index >= 0) state.portfolios[index] = record;
    else state.portfolios.push(record);
    const portfoliosResult = await persist(PPMAdmin.savePortfolios(state.portfolios, {
      entityId: id,
      action: existing ? "Portfolio updated" : "Portfolio created",
      summary: `${name} was ${existing ? "updated" : "created"}.`
    }), state.portfolios);
    if (!portfoliosResult.ok) return;
    state.portfolios = portfoliosResult.value;
    closePortfolio();
    refresh();
    showMessage(`${name} was saved.`);
  }

  async function retirePortfolio(id) {
    if (!assertPortfolioEdit()) return;
    const row = state.portfolios.find((item) => item.portfolioId === id);
    if (!row) return;
    const projects = PPMAuth.readGlobal(
      "ppmProjects",
      [],
      "administration counts how many projects use each portfolio and lifecycle template, so it must see the whole portfolio"
    );
    const linked = (Array.isArray(projects) ? projects : []).filter(
      (project) => project.portfolioId === id || (!project.portfolioId && project.portfolio === row.name)
    ).length;
    confirmChange(
      `Retire ${row.name}?${linked ? ` ${linked} linked project${linked === 1 ? " remains" : "s remain"} visible and will retain the portfolio reference.` : ""} The record and audit history will be retained.`,
      "Retire portfolio",
      async () => {
        row.active = false;
        row.status = "Inactive";
        row.updatedAt = new Date().toISOString();
        const portfoliosResult = await persist(PPMAdmin.savePortfolios(state.portfolios, {
          entityId: id,
          action: "Portfolio retired",
          summary: `${row.name} was retired.`
        }), state.portfolios);
        if (!portfoliosResult.ok) return;
        state.portfolios = portfoliosResult.value;
        closeConfirmation();
        refresh();
        showMessage(`${row.name} was retired.`);
      }
    );
  }

  function renderTemplateList() {
    el("templateList").innerHTML =
      state.templates
        .map(
          (row) =>
            `<button type="button" class="template-select${row.templateId === selectedTemplateId ? " active" : ""}" data-id="${escapeHtml(row.templateId)}"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.templateId)} · v${row.version} · ${row.active ? "Active" : "Retired"}${row.isDefault ? " · Default" : ""}</span></button>`
        )
        .join("") || '<div class="empty">No lifecycle templates are available.</div>';
    document.querySelectorAll(".template-select").forEach((button) =>
      button.addEventListener("click", () => {
        selectedTemplateId = button.dataset.id;
        renderTemplateList();
        renderTemplateEditor();
      })
    );
  }

  function templateRecordFromEditor() {
    const current = state.templates.find((row) => row.templateId === selectedTemplateId) || {};
    const selectedTypes = [...el("templateProjectTypes").selectedOptions].map((item) => item.value);
    const stages = [...el("stageRows").querySelectorAll("tr")]
      .map((row, index) => ({
        stageId: row.dataset.stageId || PPMAdmin.uid("STG"),
        name: row.querySelector('[data-field="name"]').value.trim(),
        order: Number(row.querySelector('[data-field="order"]').value || index + 1),
        gateRequired: row.querySelector('[data-field="gateRequired"]').checked,
        gateName: row.querySelector('[data-field="gateName"]').value.trim(),
        description: row.querySelector('[data-field="description"]').value.trim(),
        active: true
      }))
      .sort((a, b) => a.order - b.order)
      .map((row, index) => ({ ...row, order: index + 1 }));
    return PPMAdmin.normaliseTemplate(
      {
        ...current,
        templateId: el("templateId").value,
        name: el("templateName").value.trim(),
        description: el("templateDescription").value.trim(),
        applicableProjectTypes: selectedTypes.length ? selectedTypes : ["*"],
        effectiveFrom: el("templateEffectiveFrom").value,
        isDefault: el("templateDefault").checked,
        active: el("templateActive").checked,
        stages,
        updatedAt: new Date().toISOString()
      },
      state.templates.length
    );
  }

  function templateRules(templateId, version, rows = state.rules) {
    return rows.filter(
      (rule) => rule.templateId === templateId && Number(rule.templateVersion || 1) === Number(version || 1)
    );
  }

  function mapRulesToTemplateVersion(sourceRules, record, version, preserveIds) {
    const stageById = new Map(record.stages.map((stage) => [String(stage.stageId), stage]));
    const stageByName = new Map(record.stages.map((stage) => [String(stage.name).toLowerCase(), stage]));
    return sourceRules
      .map((rule, index) => {
        const stage =
          stageById.get(String(rule.stageId || "")) ||
          stageByName.get(String(rule.stage || "").toLowerCase());
        if (!stage) return null;
        return PPMAdmin.normaliseRule(
          {
            ...rule,
            ruleId: preserveIds ? rule.ruleId : PPMAdmin.uid("RULE"),
            templateId: record.templateId,
            templateVersion: version,
            stage: stage.name,
            stageId: stage.stageId,
            createdAt: preserveIds ? rule.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          index,
          version
        );
      })
      .filter(Boolean);
  }

  function lifecycleSnapshot(template, rules) {
    return {
      version: template.version,
      effectiveFrom: template.effectiveFrom,
      supersededAt: new Date().toISOString(),
      supersededBy: window.PPMAuth?.getCurrentUser()?.fullName || "Prototype administrator",
      name: template.name,
      description: template.description,
      applicableProjectTypes: clone(template.applicableProjectTypes),
      stages: clone(template.stages),
      mandatoryRules: clone(rules)
    };
  }

  function activeTemplateHasRequiredRule(record, rules) {
    if (!record.active) return true;
    const firstStage = record.stages
      .filter((stage) => stage.active !== false)
      .sort((a, b) => a.order - b.order)[0];
    if (!firstStage) return false;
    const firstStageRules = rules.filter(
      (rule) =>
        rule.active !== false &&
        rule.required !== false &&
        (rule.stageId === firstStage.stageId || rule.stage === firstStage.name)
    );
    const projectTypes = record.applicableProjectTypes?.length ? record.applicableProjectTypes : ["*"];
    if (projectTypes.includes("*")) return firstStageRules.some((rule) => rule.projectType === "*");
    return projectTypes.every((projectType) =>
      firstStageRules.some(
        (rule) =>
          rule.projectType === "*" ||
          String(rule.projectType).toLowerCase() === String(projectType).toLowerCase()
      )
    );
  }

  function comparableRules(rows) {
    return JSON.stringify(
      rows
        .map((rule) => ({
          ruleId: rule.ruleId,
          projectType: rule.projectType,
          stage: rule.stage,
          stageId: rule.stageId,
          fieldId: rule.fieldId,
          label: rule.label,
          required: rule.required,
          active: rule.active,
          guidance: rule.guidance,
          anyFieldIds: rule.anyFieldIds || [],
          validValues: rule.validValues || [],
          invalidValues: rule.invalidValues || []
        }))
        .sort((a, b) => a.ruleId.localeCompare(b.ruleId))
    );
  }

  function renderTemplateEditor() {
    const row = state.templates.find((item) => item.templateId === selectedTemplateId);
    const controls = [
      "templateName",
      "templateEffectiveFrom",
      "templateDescription",
      "templateProjectTypes",
      "templateDefault",
      "templateActive",
      "addStageButton",
      "saveTemplateButton",
      "retireTemplateButton"
    ];
    controls.forEach((id) => {
      if (el(id)) el(id).disabled = !row || !canAdmin();
    });
    if (!row) {
      el("templateEditorTitle").textContent = "No lifecycle selected";
      el("stageRows").innerHTML = "";
      return;
    }
    el("templateEditorTitle").textContent = row.name;
    el("templateVersionBadge").textContent = `Version ${row.version}`;
    el("templateId").value = row.templateId;
    el("templateName").value = row.name;
    el("templateEffectiveFrom").value = row.effectiveFrom || "";
    el("templateDescription").value = row.description || "";
    el("templateDefault").checked = row.isDefault;
    el("templateActive").checked = row.active;
    const types = [
      { value: "*", label: "All project types" },
      ...PPMAdmin.getReferenceValues("projectTypes", { includeInactive: true }).map((item) => ({
        value: item.value,
        label: item.label
      }))
    ];
    el("templateProjectTypes").innerHTML = types
      .map((item) => option(item.value, item.label, row.applicableProjectTypes.includes(item.value)))
      .join("");
    el("stageRows").innerHTML = row.stages
      .sort((a, b) => a.order - b.order)
      .map(
        (stage) =>
          `<tr data-stage-id="${escapeHtml(stage.stageId)}"><td><input class="admin-input" data-field="order" type="number" min="1" value="${stage.order}"></td>
<td><input class="admin-input" data-field="name" value="${escapeHtml(stage.name)}"></td>
<td><input data-field="stageId" value="${escapeHtml(stage.stageId)}" readonly></td>
<td><input class="admin-input" data-field="gateRequired" type="checkbox" ${stage.gateRequired ? "checked" : ""}></td>
<td><input class="admin-input" data-field="gateName" value="${escapeHtml(stage.gateName || "")}"></td>
<td><textarea class="admin-input" data-field="description">${escapeHtml(stage.description || "")}</textarea></td>
<td><button type="button" class="button danger small stage-remove admin-edit" data-permission="administration.edit">Remove</button></td></tr>`
      )
      .join("");
    document
      .querySelectorAll(".stage-remove")
      .forEach((button) => button.addEventListener("click", () => removeStage(button.closest("tr"))));
    setEditAccess();
  }

  function addTemplate() {
    if (!assertEdit()) return;
    const source =
      state.templates.find((row) => row.templateId === selectedTemplateId) ||
      state.templates.find((row) => row.isDefault) ||
      state.templates[0];
    const id = PPMAdmin.nextLifecycleTemplateId(state.templates);
    const stages = (source?.stages || []).map((stage) => ({ ...clone(stage), stageId: PPMAdmin.uid("STG") }));
    const record = PPMAdmin.normaliseTemplate(
      {
        templateId: id,
        name: "New lifecycle template",
        description: "",
        applicableProjectTypes: clone(source?.applicableProjectTypes || ["*"]),
        stages,
        active: true,
        isDefault: false,
        version: 1,
        effectiveFrom: PPMAdmin.todayIso(),
        versions: []
      },
      state.templates.length
    );
    state.templates.push(record);
    const sourceRules = source ? templateRules(source.templateId, source.version) : [];
    const targetByName = new Map(record.stages.map((stage) => [String(stage.name).toLowerCase(), stage]));
    state.rules.push(
      ...sourceRules
        .map((rule, index) => {
          const stage = targetByName.get(String(rule.stage).toLowerCase());
          return stage
            ? PPMAdmin.normaliseRule(
                {
                  ...rule,
                  ruleId: PPMAdmin.uid("RULE"),
                  templateId: id,
                  templateVersion: 1,
                  stage: stage.name,
                  stageId: stage.stageId,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                },
                state.rules.length + index,
                1
              )
            : null;
        })
        .filter(Boolean)
    );
    selectedTemplateId = id;
    renderTemplateList();
    renderTemplateEditor();
    el("templateName").focus();
  }

  function addStage() {
    if (!assertEdit()) return;
    const template = state.templates.find((row) => row.templateId === selectedTemplateId);
    if (!template) return;
    template.stages.push({
      stageId: PPMAdmin.uid("STG"),
      name: "New stage",
      order: template.stages.length + 1,
      gateRequired: true,
      gateName: "",
      description: "",
      active: true
    });
    renderTemplateEditor();
  }

  function removeStage(rowElement) {
    if (!assertEdit()) return;
    if (el("stageRows").children.length <= 1) {
      showMessage("A lifecycle template must contain at least one stage.", "error");
      return;
    }
    const name = rowElement.querySelector('[data-field="name"]').value || "this stage";
    confirmChange(
      `Remove ${name} from this lifecycle version? Existing project records keep their current stage text, but new projects will no longer use it.`,
      "Remove stage",
      () => {
        rowElement.remove();
        [...el("stageRows").rows].forEach((row, index) => {
          row.querySelector('[data-field="order"]').value = index + 1;
        });
        closeConfirmation();
      }
    );
  }

  async function saveTemplate() {
    if (!assertEdit()) return;
    const existingStored = PPMAdmin.getLifecycleTemplates().find(
      (row) => row.templateId === selectedTemplateId
    );
    const record = templateRecordFromEditor();
    const persistedRules = PPMAdmin.getMandatoryRules();
    if (!record.name) {
      showMessage("Enter a lifecycle template name.", "error");
      return;
    }
    if (!record.stages.length || record.stages.some((stage) => !stage.name)) {
      showMessage("Every lifecycle stage needs a name.", "error");
      return;
    }
    const stageNames = record.stages.map((stage) => stage.name.toLowerCase());
    if (new Set(stageNames).size !== stageNames.length) {
      showMessage("Lifecycle stage names must be unique within a template.", "error");
      return;
    }
    if (record.applicableProjectTypes.includes("*") && record.applicableProjectTypes.length > 1)
      record.applicableProjectTypes = ["*"];
    const comparable = (row) =>
      JSON.stringify({
        name: row.name,
        description: row.description,
        applicableProjectTypes: row.applicableProjectTypes,
        stages: row.stages,
        active: row.active,
        isDefault: row.isDefault,
        effectiveFrom: row.effectiveFrom
      });
    let rulesToSave;
    if (existingStored && comparable(existingStored) !== comparable(record)) {
      const oldRules = templateRules(existingStored.templateId, existingStored.version, persistedRules);
      record.versions = [
        ...(existingStored.versions || []).filter(
          (row) => Number(row.version) !== Number(existingStored.version)
        ),
        lifecycleSnapshot(existingStored, oldRules)
      ];
      record.version = existingStored.version + 1;
      rulesToSave = [
        ...persistedRules,
        ...mapRulesToTemplateVersion(oldRules, record, record.version, false)
      ];
    } else if (existingStored) {
      record.version = existingStored.version;
      record.versions = clone(existingStored.versions || []);
      rulesToSave = persistedRules;
    } else {
      record.version = 1;
      const draftRules = templateRules(record.templateId, 1);
      const mappedDraftRules = mapRulesToTemplateVersion(draftRules, record, 1, true);
      rulesToSave = [
        ...persistedRules.filter((rule) => rule.templateId !== record.templateId),
        ...mappedDraftRules
      ];
    }
    const currentRules = templateRules(record.templateId, record.version, rulesToSave);
    if (!activeTemplateHasRequiredRule(record, currentRules)) {
      showMessage(
        "An active lifecycle must have at least one active mandatory field in its first stage. Add a rule or save the template as inactive.",
        "error"
      );
      return;
    }
    const index = state.templates.findIndex((row) => row.templateId === record.templateId);
    if (index >= 0) state.templates[index] = record;
    else state.templates.push(record);
    if (record.isDefault)
      state.templates.forEach((row) => {
        if (row.templateId !== record.templateId) row.isDefault = false;
      });
    const templatesResult = await persist(PPMAdmin.saveLifecycleTemplates(state.templates, {
      entityId: record.templateId,
      action: existingStored ? "Lifecycle template version saved" : "Lifecycle template created",
      summary: `${record.name} version ${record.version} was saved.`
    }), state.templates);
    if (!templatesResult.ok) return;
    state.templates = templatesResult.value;
    const rulesResult = await persist(PPMAdmin.saveMandatoryRules(rulesToSave, { audit: false }), state.rules);
    if (!rulesResult.ok) return;
    state.rules = rulesResult.value;
    refresh();
    showMessage(`${record.name} version ${record.version} was saved.`);
  }

  async function retireTemplate() {
    if (!assertEdit()) return;
    const row = state.templates.find((item) => item.templateId === selectedTemplateId);
    if (!row || !row.active) return;
    if (row.isDefault && state.templates.filter((item) => item.active).length === 1) {
      showMessage("Create another active default lifecycle before retiring this template.", "error");
      return;
    }
    const projects = PPMAuth.readGlobal(
      "ppmProjects",
      [],
      "administration counts how many projects use each portfolio and lifecycle template, so it must see the whole portfolio"
    );
    const linked = (Array.isArray(projects) ? projects : []).filter(
      (project) => project.lifecycleTemplateId === row.templateId
    ).length;
    confirmChange(
      `Retire ${row.name}?${linked ? ` ${linked} existing project${linked === 1 ? " will" : "s will"} retain this lifecycle version.` : ""} It will no longer be offered for new projects.`,
      "Retire template",
      async () => {
        row.active = false;
        row.isDefault = false;
        const replacement = state.templates.find((item) => item.active && item.templateId !== row.templateId);
        if (replacement && !state.templates.some((item) => item.active && item.isDefault))
          replacement.isDefault = true;
        const templatesResult = await persist(PPMAdmin.saveLifecycleTemplates(state.templates, {
          entityId: row.templateId,
          action: "Lifecycle template retired",
          summary: `${row.name} was retired.`
        }), state.templates);
        if (!templatesResult.ok) return;
        state.templates = templatesResult.value;
        closeConfirmation();
        refresh();
        showMessage(`${row.name} was retired.`);
      }
    );
  }

  function populateRuleFilters() {
    const template =
      state.templates.find((row) => row.templateId === el("ruleTemplateFilter").value) ||
      state.templates.find((row) => row.templateId === selectedTemplateId) ||
      state.templates[0];
    el("ruleTemplateFilter").innerHTML = state.templates
      .map((row) =>
        option(row.templateId, `${row.name} (v${row.version})`, row.templateId === template?.templateId)
      )
      .join("");
    const currentType = el("ruleProjectTypeFilter").value || "*";
    el("ruleProjectTypeFilter").innerHTML =
      option("*", "All project types", currentType === "*") +
      PPMAdmin.getReferenceValues("projectTypes", { includeInactive: true })
        .map((row) => option(row.value, row.label, row.value === currentType))
        .join("");
    const currentStage = el("ruleStageFilter").value || template?.stages[0]?.name || "";
    el("ruleStageFilter").innerHTML = (template?.stages || [])
      .filter((row) => row.active)
      .sort((a, b) => a.order - b.order)
      .map((row) => option(row.name, row.name, row.name === currentStage))
      .join("");
  }

  function currentRuleScope() {
    const template = state.templates.find((row) => row.templateId === el("ruleTemplateFilter").value);
    return {
      templateId: el("ruleTemplateFilter").value,
      templateVersion: Number(template?.version || 1),
      projectType: el("ruleProjectTypeFilter").value,
      stage: el("ruleStageFilter").value
    };
  }

  function renderRules() {
    const scope = currentRuleScope();
    const rows = state.rules.filter(
      (row) =>
        row.templateId === scope.templateId &&
        Number(row.templateVersion || 1) === scope.templateVersion &&
        row.projectType === scope.projectType &&
        row.stage === scope.stage
    );
    displayedRuleScope = { ...scope };
    el("ruleRows").innerHTML = rows
      .map(
        (row) =>
          `<tr data-id="${escapeHtml(row.ruleId)}"><td><input class="admin-input" data-field="fieldId" value="${escapeHtml(row.fieldId)}" list="knownFieldIds"></td>
<td><input class="admin-input" data-field="label" value="${escapeHtml(row.label)}"></td>
<td><input class="admin-input" data-field="required" type="checkbox" ${row.required ? "checked" : ""}></td>
<td><textarea class="admin-input" data-field="guidance">${escapeHtml(row.guidance || "")}</textarea></td>
<td><input class="admin-input" data-field="active" type="checkbox" ${row.active ? "checked" : ""}></td>
<td><button type="button" class="button danger small rule-remove admin-edit" data-permission="administration.edit">Remove</button></td></tr>`
      )
      .join("");
    if (!document.getElementById("knownFieldIds")) {
      const list = document.createElement("datalist");
      list.id = "knownFieldIds";
      list.innerHTML = Object.entries(PPMAdmin.FIELD_LABELS)
        .map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`)
        .join("");
      document.body.appendChild(list);
    }
    el("ruleEmpty").hidden = rows.length > 0;
    document
      .querySelectorAll(".rule-remove")
      .forEach((button) =>
        button.addEventListener("click", () => removeRule(button.closest("tr").dataset.id))
      );
    setEditAccess();
  }

  function captureVisibleRules() {
    const scope = displayedRuleScope || currentRuleScope();
    const other = state.rules.filter(
      (row) =>
        !(
          row.templateId === scope.templateId &&
          Number(row.templateVersion || 1) === Number(scope.templateVersion || 1) &&
          row.projectType === scope.projectType &&
          row.stage === scope.stage
        )
    );
    const template = state.templates.find((row) => row.templateId === scope.templateId);
    const stage = template?.stages.find((row) => row.name === scope.stage);
    const visible = [...el("ruleRows").querySelectorAll("tr")].map((row) => {
      const existing = state.rules.find((item) => item.ruleId === row.dataset.id) || {};
      return PPMAdmin.normaliseRule(
        {
          ...existing,
          ruleId: row.dataset.id,
          templateId: scope.templateId,
          templateVersion: scope.templateVersion,
          projectType: scope.projectType,
          stage: scope.stage,
          stageId: stage?.stageId || "",
          fieldId: row.querySelector('[data-field="fieldId"]').value.trim(),
          label: row.querySelector('[data-field="label"]').value.trim(),
          required: row.querySelector('[data-field="required"]').checked,
          guidance: row.querySelector('[data-field="guidance"]').value.trim(),
          active: row.querySelector('[data-field="active"]').checked
        },
        0,
        scope.templateVersion
      );
    });
    state.rules = [...other, ...visible];
    return visible;
  }

  function addRule() {
    if (!assertEdit()) return;
    captureVisibleRules();
    const scope = currentRuleScope();
    const template = state.templates.find((row) => row.templateId === scope.templateId);
    const stage = template?.stages.find((row) => row.name === scope.stage);
    state.rules.push(
      PPMAdmin.normaliseRule(
        {
          ruleId: PPMAdmin.uid("RULE"),
          templateId: scope.templateId,
          templateVersion: scope.templateVersion,
          projectType: scope.projectType,
          stage: scope.stage,
          stageId: stage?.stageId || "",
          fieldId: "",
          label: "",
          required: true,
          active: true
        },
        state.rules.length,
        scope.templateVersion
      )
    );
    renderRules();
    el("ruleRows").lastElementChild?.querySelector('[data-field="fieldId"]')?.focus();
  }

  function removeRule(id) {
    if (!assertEdit()) return;
    const row = state.rules.find((item) => item.ruleId === id);
    confirmChange(
      `Remove the mandatory-field rule for ${row?.label || row?.fieldId || "this field"}?`,
      "Remove rule",
      () => {
        state.rules = state.rules.filter((item) => item.ruleId !== id);
        closeConfirmation();
        renderRules();
      }
    );
  }

  async function saveRules() {
    if (!assertEdit()) return;
    const persistedTemplates = PPMAdmin.getLifecycleTemplates();
    const persistedTemplate = persistedTemplates.find(
      (row) => row.templateId === currentRuleScope().templateId
    );
    const persistedRules = PPMAdmin.getMandatoryRules();
    const rows = captureVisibleRules();
    if (rows.some((row) => !row.fieldId || !row.label)) {
      showMessage("Every mandatory-field rule needs a field ID and end-user label.", "error");
      return;
    }
    const ids = rows.map((row) => row.fieldId.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      showMessage("A field can appear only once within the selected stage and project type.", "error");
      return;
    }
    if (!persistedTemplate) {
      showMessage("Save the lifecycle template before maintaining its mandatory-field rules.", "error");
      return;
    }
    const oldVersion = Number(persistedTemplate.version || 1);
    const persistedCurrent = templateRules(persistedTemplate.templateId, oldVersion, persistedRules);
    const editedCurrent = templateRules(persistedTemplate.templateId, oldVersion, state.rules);
    if (comparableRules(persistedCurrent) === comparableRules(editedCurrent)) {
      refresh();
      showMessage("No mandatory-field changes needed saving.");
      return;
    }
    const nextTemplate = {
      ...persistedTemplate,
      version: oldVersion + 1,
      effectiveFrom: PPMAdmin.todayIso(),
      updatedAt: new Date().toISOString(),
      versions: [
        ...(persistedTemplate.versions || []).filter((row) => Number(row.version) !== oldVersion),
        lifecycleSnapshot(persistedTemplate, persistedCurrent)
      ]
    };
    const nextRules = mapRulesToTemplateVersion(editedCurrent, nextTemplate, nextTemplate.version, false);
    if (!activeTemplateHasRequiredRule(nextTemplate, nextRules)) {
      showMessage(
        "An active lifecycle must retain at least one active mandatory field in its first stage.",
        "error"
      );
      return;
    }
    const templateIndex = persistedTemplates.findIndex((row) => row.templateId === nextTemplate.templateId);
    persistedTemplates[templateIndex] = nextTemplate;
    const templatesResult = await persist(PPMAdmin.saveLifecycleTemplates(persistedTemplates, {
      entityId: nextTemplate.templateId,
      action: "Lifecycle validation version saved",
      summary: `${nextTemplate.name} version ${nextTemplate.version} was created when mandatory-field rules changed.`
    }), state.templates);
    if (!templatesResult.ok) return;
    state.templates = templatesResult.value;
    const rulesResult = await persist(PPMAdmin.saveMandatoryRules([...persistedRules, ...nextRules], {
      entityId: `${nextTemplate.templateId}:${nextTemplate.version}:${currentRuleScope().stage}`,
      action: "Mandatory field rules updated",
      summary: `Mandatory field rules for ${currentRuleScope().stage} were updated in lifecycle version ${nextTemplate.version}.`
    }), state.rules);
    if (!rulesResult.ok) return;
    state.rules = rulesResult.value;
    refresh();
    showMessage(`Mandatory field rules were saved as ${nextTemplate.name} version ${nextTemplate.version}.`);
  }

  function renderReferenceCategories() {
    const current = el("referenceCategory").value || PPMAdmin.referenceCategories()[0]?.key;
    el("referenceCategory").innerHTML = PPMAdmin.referenceCategories()
      .map((row) => option(row.key, row.label, row.key === current))
      .join("");
  }

  function renderReferences() {
    const category = el("referenceCategory").value;
    const rows = state.references[category] || [];
    displayedReferenceCategory = category;
    el("referenceRows").innerHTML = rows
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(
        (row) =>
          `<tr data-id="${escapeHtml(row.referenceId)}"><td><input value="${escapeHtml(row.referenceId)}" readonly></td>
<td><input class="admin-input" data-field="code" value="${escapeHtml(row.code)}"></td>
<td><input class="admin-input" data-field="label" value="${escapeHtml(row.label)}"></td>
<td><input class="admin-input" data-field="value" value="${escapeHtml(row.value)}"></td>
<td><input class="admin-input" data-field="sortOrder" type="number" min="0" value="${row.sortOrder}"></td>
<td><input class="admin-input" data-field="active" type="checkbox" ${row.active ? "checked" : ""}></td>
<td><button type="button" class="button danger small reference-remove admin-edit" data-permission="administration.edit">Remove</button></td></tr>`
      )
      .join("");
    el("referenceEmpty").hidden = rows.length > 0;
    document
      .querySelectorAll(".reference-remove")
      .forEach((button) =>
        button.addEventListener("click", () => removeReference(button.closest("tr").dataset.id))
      );
    setEditAccess();
  }

  function captureReferences() {
    const category = displayedReferenceCategory || el("referenceCategory").value;
    state.references[category] = [...el("referenceRows").querySelectorAll("tr")].map((row, index) => ({
      referenceId: row.dataset.id,
      code: row.querySelector('[data-field="code"]').value.trim(),
      label: row.querySelector('[data-field="label"]').value.trim(),
      value: row.querySelector('[data-field="value"]').value.trim(),
      sortOrder: Number(row.querySelector('[data-field="sortOrder"]').value || (index + 1) * 10),
      active: row.querySelector('[data-field="active"]').checked
    }));
    return state.references[category];
  }

  function addReference() {
    if (!assertEdit()) return;
    captureReferences();
    const category = el("referenceCategory").value;
    state.references[category].push({
      referenceId: PPMAdmin.uid("REF"),
      code: "NEW_VALUE",
      label: "New value",
      value: "New value",
      sortOrder: (state.references[category].length + 1) * 10,
      active: true
    });
    renderReferences();
    el("referenceRows").lastElementChild?.querySelector('[data-field="label"]')?.select();
  }
  function removeReference(id) {
    if (!assertEdit()) return;
    const category = el("referenceCategory").value;
    const row = state.references[category].find((item) => item.referenceId === id);
    confirmChange(
      `Remove ${row?.label || "this reference value"}? Existing records keep their stored value, but it will no longer appear in picklists.`,
      "Remove value",
      () => {
        state.references[category] = state.references[category].filter((item) => item.referenceId !== id);
        closeConfirmation();
        renderReferences();
      }
    );
  }
  async function saveReferences() {
    if (!assertEdit()) return;
    const rows = captureReferences();
    if (rows.some((row) => !row.code || !row.label || !row.value)) {
      showMessage("Every reference value needs a code, display label and stored value.", "error");
      return;
    }
    const codes = rows.map((row) => row.code.toLowerCase());
    if (new Set(codes).size !== codes.length) {
      showMessage("Reference codes must be unique within a category.", "error");
      return;
    }
    const referencesResult = await persist(PPMAdmin.saveReferenceData(state.references, {
      entityId: el("referenceCategory").value,
      action: "Reference data updated",
      summary: `${el("referenceCategory").selectedOptions[0]?.textContent || "Reference data"} was updated.`
    }), state.references);
    if (!referencesResult.ok) return;
    state.references = referencesResult.value;
    refresh();
    showMessage("Reference data was saved.");
  }

  function renderRag() {
    Object.keys(PPMAdmin.DEFAULT_RAG_CONFIG).forEach((key) => {
      if (el(key)) el(key).value = state.rag[key];
    });
  }
  async function saveRag() {
    if (!assertEdit()) return;
    const values = Object.fromEntries(
      Object.keys(PPMAdmin.DEFAULT_RAG_CONFIG).map((key) => [key, Number(el(key).value)])
    );
    if (
      values.scheduleRedToleranceDays <= values.scheduleAmberToleranceDays ||
      values.resourceRedUtilisation <= values.resourceAmberUtilisation ||
      values.financialRedVariance <= values.financialAmberVariance
    ) {
      showMessage("Each Red threshold must be greater than its Amber threshold.", "error");
      return;
    }
    const ragResult = await persist(PPMAdmin.saveRagConfig(values, {
      action: "RAG thresholds updated",
      summary: "Calculated RAG thresholds were updated."
    }), state.rag);
    if (!ragResult.ok) return;
    state.rag = ragResult.value;
    renderRag();
    showMessage("RAG thresholds were saved and will be used by project calculations.");
  }

  function renderCalendars() {
    const portfolioMap = Object.fromEntries(state.portfolios.map((row) => [row.portfolioId, row.name]));
    el("calendarRows").innerHTML = state.calendars
      .map(
        (row) =>
          `<tr><td><span class="cell-title">${escapeHtml(row.name)}</span><span class="cell-subtext">${escapeHtml(row.calendarId)}${row.isDefault ? " · Default" : ""}</span></td>
<td>${escapeHtml(portfolioMap[row.portfolioId] || "All portfolios")}</td>
<td>${escapeHtml(row.frequency)}</td>
<td>${row.dueOffsetDays} days after period end</td>
<td>Starts ${new Date(2000, row.financialYearStartMonth - 1, 1).toLocaleDateString("en-GB", { month: "long" })}</td>
<td><span class="badge ${row.active ? "green" : ""}">${row.active ? "Active" : "Retired"}</span></td>
<td><div class="action-group"><button type="button" class="button light small calendar-edit" data-id="${escapeHtml(row.calendarId)}" data-permission="administration.edit">Edit</button><button type="button" class="button light small calendar-periods" data-id="${escapeHtml(row.calendarId)}">Periods</button><button type="button" class="button danger small calendar-retire admin-edit" data-id="${escapeHtml(row.calendarId)}" ${row.active ? "" : "disabled"} data-permission="administration.edit">Retire</button></div></td></tr>`
      )
      .join("");
    el("calendarEmpty").hidden = state.calendars.length > 0;
    document
      .querySelectorAll(".calendar-edit")
      .forEach((button) => button.addEventListener("click", () => openCalendar(button.dataset.id)));
    document.querySelectorAll(".calendar-periods").forEach((button) =>
      button.addEventListener("click", () => {
        selectedCalendarId = button.dataset.id;
        el("periodCalendarFilter").value = selectedCalendarId;
        renderPeriods();
        el("periodHeading").scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );
    document
      .querySelectorAll(".calendar-retire")
      .forEach((button) => button.addEventListener("click", () => retireCalendar(button.dataset.id)));
  }

  function openCalendar(id) {
    const existing = state.calendars.find((row) => row.calendarId === id);
    if (!existing && !assertEdit()) return;
    const row =
      existing ||
      PPMAdmin.normaliseCalendar(
        {
          calendarId: PPMAdmin.nextReportingCalendarId(state.calendars),
          name: "",
          description: "",
          portfolioId: state.portfolios[0]?.portfolioId || "",
          frequency: "Monthly",
          dueOffsetDays: 5,
          financialYearStartMonth: 4,
          active: true,
          isDefault: false
        },
        state.calendars.length
      );
    editingCalendarId = existing ? id : "";
    el("calendarModalTitle").textContent = existing ? "Edit reporting calendar" : "Add reporting calendar";
    el("calendarId").value = row.calendarId;
    el("calendarName").value = row.name;
    el("calendarDescription").value = row.description;
    el("calendarFrequency").value = row.frequency;
    el("calendarDueOffset").value = row.dueOffsetDays;
    el("calendarFinancialYear").value = String(row.financialYearStartMonth);
    el("calendarDefault").checked = row.isDefault;
    el("calendarActive").checked = row.active;
    el("calendarPortfolio").innerHTML =
      '<option value="">All portfolios</option>' +
      state.portfolios
        .map((item) => option(item.portfolioId, item.name, item.portfolioId === row.portfolioId))
        .join("");
    el("calendarModal").classList.add("visible");
  }
  function closeCalendar() {
    editingCalendarId = "";
    el("calendarModal").classList.remove("visible");
  }
  async function saveCalendar(event) {
    event.preventDefault();
    if (!assertEdit()) return;
    const name = el("calendarName").value.trim();
    if (!name) {
      showMessage("Enter a reporting calendar name.", "error");
      return;
    }
    const existing = state.calendars.find((row) => row.calendarId === editingCalendarId);
    const record = PPMAdmin.normaliseCalendar(
      {
        ...(existing || {}),
        calendarId: el("calendarId").value,
        name,
        description: el("calendarDescription").value.trim(),
        portfolioId: el("calendarPortfolio").value,
        frequency: el("calendarFrequency").value,
        dueOffsetDays: Number(el("calendarDueOffset").value || 0),
        financialYearStartMonth: Number(el("calendarFinancialYear").value),
        isDefault: el("calendarDefault").checked,
        active: el("calendarActive").checked,
        updatedAt: new Date().toISOString()
      },
      state.calendars.length
    );
    const index = state.calendars.findIndex((row) => row.calendarId === editingCalendarId);
    if (index >= 0) state.calendars[index] = record;
    else state.calendars.push(record);
    if (record.isDefault)
      state.calendars.forEach((row) => {
        if (row.calendarId !== record.calendarId) row.isDefault = false;
      });
    const calendarsResult = await persist(PPMAdmin.saveReportingCalendars(state.calendars, {
      entityId: record.calendarId,
      action: existing ? "Reporting calendar updated" : "Reporting calendar created",
      summary: `${name} was ${existing ? "updated" : "created"}.`
    }), state.calendars);
    if (!calendarsResult.ok) return;
    state.calendars = calendarsResult.value;
    selectedCalendarId = record.calendarId;
    closeCalendar();
    refresh();
    showMessage(`${name} was saved.`);
  }
  async function retireCalendar(id) {
    if (!assertEdit()) return;
    const row = state.calendars.find((item) => item.calendarId === id);
    if (!row) return;
    if (row.isDefault && state.calendars.filter((item) => item.active).length === 1) {
      showMessage("Create another active default calendar before retiring this one.", "error");
      return;
    }
    confirmChange(
      `Retire ${row.name}? Existing reporting periods and reports remain available.`,
      "Retire calendar",
      async () => {
        row.active = false;
        row.isDefault = false;
        const replacement = state.calendars.find((item) => item.active && item.calendarId !== id);
        if (replacement && !state.calendars.some((item) => item.active && item.isDefault))
          replacement.isDefault = true;
        const calendarsResult = await persist(PPMAdmin.saveReportingCalendars(state.calendars, {
          entityId: id,
          action: "Reporting calendar retired",
          summary: `${row.name} was retired.`
        }), state.calendars);
        if (!calendarsResult.ok) return;
        state.calendars = calendarsResult.value;
        closeConfirmation();
        refresh();
        showMessage(`${row.name} was retired.`);
      }
    );
  }

  function populatePeriodCalendarFilter() {
    el("periodCalendarFilter").innerHTML = state.calendars
      .map((row) =>
        option(
          row.calendarId,
          `${row.name}${row.active ? "" : " (retired)"}`,
          row.calendarId === selectedCalendarId
        )
      )
      .join("");
  }
  function renderPeriods() {
    selectedCalendarId = el("periodCalendarFilter").value || selectedCalendarId;
    const calendar = state.calendars.find((row) => row.calendarId === selectedCalendarId);
    const rows = state.periods
      .filter((row) => row.calendarId === selectedCalendarId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    el("periodHeading").textContent = calendar ? `${calendar.name} periods` : "Reporting periods";
    el("periodRows").innerHTML = rows
      .map(
        (row) =>
          `<tr data-id="${escapeHtml(row.periodId)}" class="${row.locked ? "period-locked" : ""}"><td><input class="admin-input" data-field="name" value="${escapeHtml(row.name)}"></td>
<td><input class="admin-input" data-field="startDate" type="date" value="${escapeHtml(row.startDate)}"></td>
<td><input class="admin-input" data-field="endDate" type="date" value="${escapeHtml(row.endDate)}"></td>
<td><input class="admin-input" data-field="submissionDueDate" type="date" value="${escapeHtml(row.submissionDueDate)}"></td>
<td><select class="admin-input" data-field="status">${["Upcoming", "Open", "Closed", "Locked"].map((value) => option(value, value, value === row.status)).join("")}</select></td>
<td><input class="admin-input" data-field="locked" type="checkbox" ${row.locked ? "checked" : ""}></td>
<td><button type="button" class="button danger small period-remove admin-edit" data-permission="administration.edit">Remove</button></td></tr>`
      )
      .join("");
    el("periodEmpty").hidden = rows.length > 0;
    document
      .querySelectorAll(".period-remove")
      .forEach((button) =>
        button.addEventListener("click", () => removePeriod(button.closest("tr").dataset.id))
      );
    setEditAccess();
  }
  function capturePeriods() {
    const other = state.periods.filter((row) => row.calendarId !== selectedCalendarId);
    const current = [...el("periodRows").querySelectorAll("tr")].map((row, index) => {
      const locked = row.querySelector('[data-field="locked"]').checked;
      const existing = state.periods.find((item) => item.periodId === row.dataset.id) || {};
      return PPMAdmin.normalisePeriod(
        {
          ...existing,
          periodId: row.dataset.id,
          calendarId: selectedCalendarId,
          name: row.querySelector('[data-field="name"]').value.trim(),
          startDate: row.querySelector('[data-field="startDate"]').value,
          endDate: row.querySelector('[data-field="endDate"]').value,
          submissionDueDate: row.querySelector('[data-field="submissionDueDate"]').value,
          status: locked ? "Locked" : row.querySelector('[data-field="status"]').value,
          locked,
          lockedAt: locked ? existing.lockedAt || new Date().toISOString() : "",
          lockedBy: locked
            ? existing.lockedBy || window.PPMAuth?.getCurrentUser()?.fullName || "Prototype administrator"
            : ""
        },
        index
      );
    });
    state.periods = [...other, ...current];
    return current;
  }
  function addPeriod() {
    if (!assertEdit()) return;
    capturePeriods();
    state.periods.push(
      PPMAdmin.normalisePeriod(
        {
          periodId: PPMAdmin.uid("PER"),
          calendarId: selectedCalendarId,
          name: "New reporting period",
          startDate: "",
          endDate: "",
          submissionDueDate: "",
          status: "Upcoming",
          locked: false
        },
        state.periods.length
      )
    );
    renderPeriods();
  }
  function removePeriod(id) {
    if (!assertEdit()) return;
    const row = state.periods.find((item) => item.periodId === id);
    confirmChange(
      `Remove ${row?.name || "this reporting period"}? Approved reports linked to a locked period should be retained.`,
      "Remove period",
      () => {
        state.periods = state.periods.filter((item) => item.periodId !== id);
        closeConfirmation();
        renderPeriods();
      }
    );
  }
  async function savePeriods() {
    if (!assertEdit()) return;
    const rows = capturePeriods();
    if (rows.some((row) => !row.name || !row.startDate || !row.endDate || !row.submissionDueDate)) {
      showMessage("Every reporting period needs a name, start, finish and submission due date.", "error");
      return;
    }
    if (rows.some((row) => row.endDate < row.startDate)) {
      showMessage("A reporting period finish date cannot be before its start date.", "error");
      return;
    }
    const periodsResult = await persist(PPMAdmin.saveReportingPeriods(state.periods, {
      entityId: selectedCalendarId,
      action: "Reporting periods updated",
      summary: `Reporting periods for ${state.calendars.find((row) => row.calendarId === selectedCalendarId)?.name || selectedCalendarId} were updated.`
    }), state.periods);
    if (!periodsResult.ok) return;
    state.periods = periodsResult.value;
    refresh();
    showMessage("Reporting periods were saved.");
  }
  async function generatePeriods() {
    if (!assertEdit()) return;
    capturePeriods();
    const generated = await persist(PPMAdmin.saveReportingPeriods(state.periods, { audit: false }), state.periods);
    if (!generated.ok) return;
    state.periods = generated.value;
    const count = Number(el("generateCount").value || 12);
    const before = state.periods.filter((row) => row.calendarId === selectedCalendarId).length;
    PPMAdmin.ensureReportingPeriods(selectedCalendarId, { count });
    reloadState();
    refresh();
    const after = state.periods.filter((row) => row.calendarId === selectedCalendarId).length;
    showMessage(
      after > before
        ? `${after - before} reporting period${after - before === 1 ? " was" : "s were"} created.`
        : "The requested reporting periods already exist."
    );
  }

  /* ======================================================================
     Data and backup
     ----------------------------------------------------------------------
     All of this delegates to PPMData in ppm-data-safety.js. This section
     only draws the screen and asks for confirmation before anything
     destructive happens.
     ==================================================================== */

  const DATA_SET_LABELS = {
    ppmProjects: "Projects",
    ppmProjectPlans: "Project plans",
    ppmProjectMilestones: "Milestones",
    ppmProjectRaid: "RAID items",
    ppmProjectActions: "Actions",
    ppmProjectDecisions: "Decisions",
    ppmProjectBenefits: "Benefits",
    ppmProjectFinancials: "Project financials",
    ppmProjectDocuments: "Document links",
    ppmStatusReports: "Status reports",
    ppmStageGates: "Stage gates",
    ppmProgrammes: "Programmes",
    ppmResources: "People and user accounts",
    ppmAuditHistory: "Audit history",
    ppmPortfolios: "Portfolios",
    ppmLifecycleTemplates: "Lifecycle templates",
    ppmLifecycleMandatoryRules: "Mandatory field rules",
    ppmReferenceData: "Reference lists",
    ppmRagConfig: "RAG thresholds",
    ppmReportingCalendars: "Reporting calendars",
    ppmReportingPeriods: "Reporting periods",
    ppmResourceDemand: "Resource demand",
    ppmResourceScenarios: "Resource scenarios",
    ppmPlanBaselines: "Plan baselines",
    ppmPlanBaselineRequests: "Rebaseline requests",
    ppmRagHistory: "RAG history"
  };

  function dataSetLabel(key) {
    return DATA_SET_LABELS[key] || key;
  }

  let pendingRestore = null;

  function renderStorage() {
    if (!window.PPMData) return;
    const state = PPMData.usage();
    const backup = PPMData.buildBackup();
    const records = Object.fromEntries(backup.summary.map((row) => [row.key, row.records]));

    const fill = document.getElementById("storageMeterFill");
    fill.style.width = `${Math.max(2, state.percent)}%`;
    fill.className = `storage-meter-fill ${state.level}`;

    document.getElementById("storageSummary").textContent =
      `${PPMData.formatBytes(state.bytes)} used of about ${PPMData.formatBytes(state.quota)} (${state.percent}%). ` +
      (state.level === "urgent"
        ? "Saving will stop working soon — archive the audit history now."
        : state.level === "warn"
          ? "Archive the audit history soon to free space."
          : "There is plenty of room.");

    document.getElementById("storageRows").innerHTML = state.byKey
      .map(
        (row) => `<tr>
          <td>${escapeHtml(dataSetLabel(row.key))}<div class="muted-cell">${escapeHtml(row.key)}</div></td>
          <td>${records[row.key] === undefined ? "—" : Number(records[row.key]).toLocaleString("en-GB")}</td>
          <td>${escapeHtml(PPMData.formatBytes(row.bytes))}</td>
          <td>${state.bytes ? Math.round((row.bytes / state.bytes) * 100) : 0}%</td>
        </tr>`
      )
      .join("");
  }

  function downloadBackup() {
    if (!assertEdit()) return;
    try {
      const backup = PPMData.exportAll();
      document.getElementById("backupResult").textContent =
        `Backup downloaded — ${backup.keyCount} data set(s), taken ${new Date(backup.createdAt).toLocaleString("en-GB")}.`;
      renderStorage();
    } catch (error) {
      document.getElementById("backupResult").textContent =
        error.message || "The backup could not be created.";
    }
  }

  function archiveAudit() {
    if (!assertEdit()) return;
    const keep = Number(document.getElementById("archiveKeep").value) || 500;
    confirmChange(
      `Archive audit events older than the most recent ${keep.toLocaleString("en-GB")}? The events are downloaded as a file first, then removed from this browser.`,
      "Archive events",
      () => {
        const result = PPMData.archiveAuditHistory(keep);
        document.getElementById("archiveResult").textContent = result.message;
        renderStorage();
        refresh();
      }
    );
  }

  function previewRestore(file) {
    const preview = document.getElementById("restorePreview");
    const confirmRow = document.getElementById("restoreConfirmRow");
    const result = document.getElementById("restoreResult");
    result.textContent = "";
    pendingRestore = null;
    preview.hidden = true;
    confirmRow.hidden = true;

    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed = null;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (error) {
        preview.hidden = false;
        preview.className = "restore-preview invalid";
        preview.textContent = "That file is not valid JSON, so it cannot be a backup from this tool.";
        return;
      }

      const check = PPMData.inspectBackup(parsed);
      preview.hidden = false;
      if (!check.valid) {
        preview.className = "restore-preview invalid";
        preview.innerHTML = `<strong>This file cannot be restored.</strong><ul>${check.problems
          .map((problem) => `<li>${escapeHtml(problem)}</li>`)
          .join("")}</ul>`;
        return;
      }

      pendingRestore = parsed;
      const contents = PPMData.describeBackup(parsed);
      /*
        Stage 12F. Split the file by what can actually be restored. Collections that
        now live in PostgreSQL are refused, so the preview has to say that here —
        offering a "Replace all data" button and then refusing on click would be a
        worse experience than not offering it.
      */
      const split = PPMData.partitionBackup(parsed);
      preview.className = "restore-preview";

      const restorableList = contents.filter((row) => split.restorable.includes(row.key));

      preview.innerHTML =
        `<strong>Backup read.</strong> Taken ${escapeHtml(new Date(parsed.createdAt).toLocaleString("en-GB"))} by ${escapeHtml(parsed.createdBy || "an unknown user")}.` +
        (split.databaseBacked.length
          ? `<p><strong>${split.databaseBacked.length} data set(s) in this file now live in the database and cannot be ` +
            `restored from a file.</strong> The database is the authoritative copy. Restoring them would load stale ` +
            `records into this browser, and any edit made against them would then overwrite newer database data.</p>` +
            `<p>If the file is right and the database is wrong, correct it in the application so the change is ` +
            `versioned and audited like any other.</p>` +
            `<ul>${split.databaseBacked
              .slice(0, 10)
              .map((key) => `<li>${escapeHtml(dataSetLabel(key))} — not restorable</li>`)
              .join("")}${split.databaseBacked.length > 10 ? `<li>and ${split.databaseBacked.length - 10} more</li>` : ""}</ul>`
          : "") +
        (restorableList.length
          ? `<p>These browser-only data set(s) <em>can</em> be restored:</p><ul>${restorableList
              .slice(0, 8)
              .map(
                (row) =>
                  `<li>${escapeHtml(dataSetLabel(row.key))}: ${Number(row.records).toLocaleString("en-GB")} record(s)</li>`
              )
              .join("")}</ul>`
          : `<p>Nothing in this file is restorable to this browser.</p>`);

      confirmRow.hidden = !restorableList.length;
      document.getElementById("restoreConfirm").value = "";
      document.getElementById("restoreButton").disabled = true;
    };
    reader.readAsText(file);
  }

  /*
    Stage 12F. Restores only the collections that genuinely live in this browser.
    The confirmation wording changed with it: promising to replace "every project,
    plan and register" would now be a lie, because those are refused.
  */
  function runRestore() {
    if (!assertEdit() || !pendingRestore) return;
    const split = PPMData.partitionBackup(pendingRestore);
    confirmChange(
      `Replace ${split.restorable.length} browser-only data set(s) with the contents of the backup file? ` +
        (split.databaseBacked.length
          ? `The ${split.databaseBacked.length} database-backed data set(s) will be left untouched. `
          : "") +
        "This cannot be undone.",
      "Restore browser data",
      () => {
        try {
          const result = PPMData.restoreLocalOnly(pendingRestore);
          document.getElementById("restoreResult").textContent =
            `${result.restored} data set(s) restored` +
            (result.skipped.length ? `, ${result.skipped.length} left to the database` : "") +
            ". Reloading…";
          setTimeout(() => location.reload(), 1200);
        } catch (error) {
          document.getElementById("restoreResult").textContent = error.message || "The restore failed.";
        }
      }
    );
  }

  function initDataTab() {
    document.getElementById("downloadBackupButton").addEventListener("click", downloadBackup);
    document.getElementById("archiveAuditButton").addEventListener("click", archiveAudit);
    document
      .getElementById("restoreFile")
      .addEventListener("change", (event) => previewRestore(event.target.files[0]));
    document.getElementById("restoreConfirm").addEventListener("input", (event) => {
      document.getElementById("restoreButton").disabled =
        event.target.value.trim().toUpperCase() !== "RESTORE";
    });
    document.getElementById("restoreButton").addEventListener("click", runRestore);
    renderStorage();
  }

  function refresh() {
    reloadState();
    renderOverview();
    renderPortfolios();
    renderTemplateList();
    renderTemplateEditor();
    renderReferenceCategories();
    renderReferences();
    populateRuleFilters();
    renderRules();
    renderRag();
    renderCalendars();
    populatePeriodCalendarFilter();
    renderStorage();
    renderPeriods();
    setEditAccess();
  }

  document
    .querySelectorAll(".tab-button")
    .forEach((button) => button.addEventListener("click", () => openTab(button.dataset.tab)));
  document
    .querySelectorAll("[data-open-tab]")
    .forEach((button) => button.addEventListener("click", () => openTab(button.dataset.openTab)));
  el("cancelConfirmation").addEventListener("click", closeConfirmation);
  el("confirmationBubble").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeConfirmation();
  });
  el("confirmAction").addEventListener("click", () => {
    const action = pendingAction;
    if (action) action();
  });
  el("addPortfolioButton").addEventListener("click", () => openPortfolio(""));
  el("portfolioForm").addEventListener("submit", savePortfolio);
  el("closePortfolioModal").addEventListener("click", closePortfolio);
  el("cancelPortfolioModal").addEventListener("click", closePortfolio);
  el("portfolioModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closePortfolio();
  });
  el("portfolioCalendar").addEventListener("change", () =>
    fillPortfolioPeriodOptions(el("portfolioCalendar").value, "")
  );
  el("addTemplateButton").addEventListener("click", addTemplate);
  el("addStageButton").addEventListener("click", addStage);
  el("saveTemplateButton").addEventListener("click", saveTemplate);
  el("retireTemplateButton").addEventListener("click", retireTemplate);
  el("ruleTemplateFilter").addEventListener("change", () => {
    captureVisibleRules();
    populateRuleFilters();
    renderRules();
  });
  el("ruleProjectTypeFilter").addEventListener("change", () => {
    captureVisibleRules();
    renderRules();
  });
  el("ruleStageFilter").addEventListener("change", () => {
    captureVisibleRules();
    renderRules();
  });
  el("addRuleButton").addEventListener("click", addRule);
  el("saveRulesButton").addEventListener("click", saveRules);
  el("referenceCategory").addEventListener("change", () => {
    captureReferences();
    renderReferences();
  });
  el("addReferenceButton").addEventListener("click", addReference);
  el("saveReferencesButton").addEventListener("click", saveReferences);
  el("saveRagButton").addEventListener("click", saveRag);
  el("addCalendarButton").addEventListener("click", () => openCalendar(""));
  el("calendarForm").addEventListener("submit", saveCalendar);
  el("closeCalendarModal").addEventListener("click", closeCalendar);
  el("cancelCalendarModal").addEventListener("click", closeCalendar);
  el("calendarModal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeCalendar();
  });
  el("periodCalendarFilter").addEventListener("change", () => {
    capturePeriods();
    selectedCalendarId = el("periodCalendarFilter").value;
    renderPeriods();
  });
  el("generatePeriodsButton").addEventListener("click", generatePeriods);
  el("addPeriodButton").addEventListener("click", addPeriod);
  el("savePeriodsButton").addEventListener("click", savePeriods);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (el("confirmationBubble").classList.contains("visible")) closeConfirmation();
    else if (el("portfolioModal").classList.contains("visible")) closePortfolio();
    else if (el("calendarModal").classList.contains("visible")) closeCalendar();
  });

  const adminParameters = new URLSearchParams(location.search);
  const requestedTab = adminParameters.get("tab") || (location.hash || "#overview").slice(1);
  const requestedItem = adminParameters.get("item") || "";
  reloadState();
  if (
    requestedTab === "lifecycles" &&
    requestedItem &&
    state.templates.some((row) => row.templateId === requestedItem)
  )
    selectedTemplateId = requestedItem;
  openTab(document.getElementById(`panel-${requestedTab}`) ? requestedTab : "overview");
  initDataTab();
  refresh();
  if (
    requestedTab === "portfolios" &&
    requestedItem &&
    state.portfolios.some((row) => row.portfolioId === requestedItem)
  )
    requestAnimationFrame(() => openPortfolio(requestedItem));
})();
