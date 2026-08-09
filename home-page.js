"use strict";
const user = PPMAuth.getCurrentUser(),
  escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;"),
  flatten = (store) =>
    Array.isArray(store)
      ? store
      : store && typeof store === "object"
        ? Object.values(store).filter(Array.isArray).flat()
        : [];
const projects = PPMAuth.filterProjects(PPMAuth.readScoped("ppmProjects", [])),
  plans = flatten(PPMAuth.readScoped("ppmProjectPlans", {})),
  actions = flatten(PPMAuth.readScoped("ppmProjectActions", {}));
const myTasks = plans.filter(
    (task) =>
      task.taskOwnerResourceId === user.resourceId &&
      !["Complete", "Completed", "Cancelled"].includes(task.status)
  ),
  myActions = actions.filter(
    (action) =>
      action.ownerResourceId === user.resourceId &&
      !["Complete", "Completed", "Closed", "Cancelled"].includes(action.status)
  ),
  myApprovals = PPMNotifications.getNotifications().filter((item) => item.category === "approval");
document.getElementById("welcomeTitle").textContent =
  `Welcome, ${(user.fullName || user.email).split(" ")[0]}`;
document.getElementById("today").textContent = new Date().toLocaleDateString("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric"
});
document.getElementById("roleScope").textContent = `${user.accessRole} · ${PPMAuth.effectiveScope(user)}`;
document.getElementById("roleDescription").textContent =
  PPMAuth.roleDefinition(user.accessRole)?.description ||
  "Your access is controlled by the permissions attached to your Resource account.";
document.getElementById("projectCount").textContent = projects.length;
document.getElementById("taskCount").textContent = myTasks.length;
document.getElementById("actionCount").textContent = myActions.length;
document.getElementById("approvalCount").textContent = myApprovals.length;
document.getElementById("projectList").innerHTML = projects.length
  ? projects
      .slice(0, 8)
      .map(
        (project) =>
          `<a class="list-item" href="project-details.html?code=${encodeURIComponent(project.projectCode)}"><div><div class="item-title">${escapeHtml(project.projectCode)} · ${escapeHtml(project.projectName || "Unnamed project")}</div><div class="item-meta">${escapeHtml(project.programme || project.workstream || "No programme")} · PM: ${escapeHtml(project.projectManager || "Not assigned")}</div></div><span class="status ${String(project.overallRag || "").toLowerCase()}">${escapeHtml(project.overallRag || project.projectStatus || "Not assessed")}</span></a>`
      )
      .join("")
  : '<div class="empty">No projects are currently included in your access scope.</div>';
const taskRows = myTasks.slice(0, 6).map(
    (task) =>
      `<a class="list-item" href="project-plan.html?code=${encodeURIComponent(task.projectCode || "")}"><div><div class="item-title">${escapeHtml(task.taskName || task.taskId)}</div><div class="item-meta">${escapeHtml(task.projectCode || "No project")} · Forecast finish ${escapeHtml(task.forecastEndDate || "not set")}</div></div><span class="status ${String(
        task.status || ""
      )
        .toLowerCase()
        .replaceAll(" ", "-")}">${escapeHtml(task.status || "Not started")}</span></a>`
  ),
  actionRows = myActions
    .slice(0, 6)
    .map(
      (action) =>
        `<a class="list-item" href="registers.html?tab=actions&item=${encodeURIComponent(action.actionId || "")}"><div><div class="item-title">${escapeHtml(action.description || action.actionId)}</div><div class="item-meta">${escapeHtml(action.projectCode || action.projectId || "No project")} · Due ${escapeHtml(action.dueDate || "not set")}</div></div><span class="status">Action</span></a>`
    ),
  approvalRows = myApprovals
    .slice(0, 4)
    .map(
      (item) =>
        `<a class="list-item" href="${escapeHtml(item.href)}"><div><div class="item-title">${escapeHtml(item.title)}</div><div class="item-meta">${escapeHtml(item.detail || item.meta || "Approval decision required")}</div></div><span class="status amber">Approval</span></a>`
    );
document.getElementById("workList").innerHTML =
  [...approvalRows, ...taskRows, ...actionRows].slice(0, 9).join("") ||
  '<div class="empty">No open tasks, actions or approvals are assigned to you.</div>';
