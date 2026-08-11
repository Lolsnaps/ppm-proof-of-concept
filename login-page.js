"use strict";

const byId = (id) => document.getElementById(id);
const sections = ["existingSession", "loginSection", "mfaSection", "enrolSection", "passwordSection"];
let pendingFactorId = "";

/*
  Stage 13A. Held only for the length of the first-run flow.

  temporaryPassword is what the user typed at sign-in. It is kept so the forced
  change can refuse the same value being re-entered — otherwise "you must choose
  your own password" is satisfied by typing the administrator's one again, which
  defeats the point. Cleared as soon as the flow ends.

  linkedPerson avoids re-reading the person row between the enrolment, password and
  finish steps.
*/
let temporaryPassword = "";
let linkedPerson = null;

function showSection(id) {
  sections.forEach((sectionId) => byId(sectionId)?.classList.toggle("hidden", sectionId !== id));
  showMessage("", "");
}

function showMessage(text, type) {
  const message = byId("message");
  message.textContent = text;
  message.className = `message${text ? ` visible ${type || "info"}` : ""}`;
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  if (label) button.textContent = busy ? "Please wait…" : label;
}

async function getAal() {
  const { data, error } = await PPMSupabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  return data;
}

async function getVerifiedTotpFactor() {
  const { data, error } = await PPMSupabase.auth.mfa.listFactors();
  if (error) throw error;
  const factors = Array.isArray(data?.totp) ? data.totp : [];
  return factors.find((factor) => factor.status === "verified") || null;
}

async function loadLinkedPerson() {
  const { data: userData, error: userError } = await PPMSupabase.auth.getUser();
  if (userError || !userData?.user)
    throw new Error("Your authenticated session could not be verified. Please sign in again.");

  const BASE_COLUMNS =
    "legacy_resource_id, full_name, email, access_role, access_scope, selected_project_codes, " +
    "additional_roles, permission_overrides, active, account_status, team, department, job_title, legacy_payload";

  /*
    Stage 13A. password_reset_required is requested, but its absence must not break
    sign-in: if this build is ever loaded against a database where the migration has
    not been applied, an explicit column list would make the whole select fail and
    lock everyone out. So a missing column falls back and treats the flag as false.
  */
  let person = null;
  let error = null;
  ({ data: person, error } = await PPMSupabase
    .from("people")
    .select(`${BASE_COLUMNS}, password_reset_required`)
    .eq("auth_user_id", userData.user.id)
    .maybeSingle());

  if (error && /password_reset_required/i.test(String(error.message || ""))) {
    console.warn(
      "PPMAuth: public.people has no password_reset_required column — STAGE-13A-FIRST-RUN-MIGRATION.sql " +
        "has not been applied. First-run password changes will not be enforced."
    );
    ({ data: person, error } = await PPMSupabase
      .from("people")
      .select(BASE_COLUMNS)
      .eq("auth_user_id", userData.user.id)
      .maybeSingle());
  }

  if (error) throw error;
  if (!person)
    throw new Error("This login is not linked to an authorised PPM Resource account.");
  if (person.active === false || person.account_status !== "Active" || !person.access_role)
    throw new Error("This PPM account is not currently enabled for access.");

  return { person, user: userData.user };
}

function clearFirstRunState() {
  temporaryPassword = "";
  linkedPerson = null;
  byId("newPassword").value = "";
  byId("confirmPassword").value = "";
}

async function finishSignIn() {
  const aal = await getAal();
  if (aal?.currentLevel !== "aal2")
    throw new Error("Multi-factor authentication must be completed before access is granted.");

  const { person, user } = linkedPerson || (await loadLinkedPerson());
  clearFirstRunState();
  PPMAuth.establishSupabaseSession(person, user.id);
  location.href = PPMAuth.safeReturnUrl();
}

/*
  Stage 13A. Everything that happens once AAL2 has been reached, however it was
  reached — an existing authenticator or one just enrolled.

  The person row can only be read at AAL2, which is why the password check cannot
  happen any earlier: every table refuses an AAL1 session.
*/
async function afterAal2() {
  linkedPerson = await loadLinkedPerson();
  if (linkedPerson.person?.password_reset_required) {
    preparePasswordChange();
    return;
  }
  await finishSignIn();
}

async function prepareMfa() {
  const factor = await getVerifiedTotpFactor();
  if (!factor) {
    await prepareEnrolment();
    return;
  }

  pendingFactorId = factor.id;
  showSection("mfaSection");
  byId("mfaCode").value = "";
  setTimeout(() => byId("mfaCode").focus(), 0);
}

/*
  Stage 13A: first-run authenticator enrolment.

  This is what the application was missing entirely. Previously a new account
  reached prepareMfa(), found no factor and threw "Enrol MFA before using Portfolio
  Manager" — with nowhere to do so. Nobody but the first administrator could get
  in.

  Enrolment is permitted at AAL1, which is the only level Supabase allows it at, and
  grants access to nothing: all 37 tables carry a restrictive AAL2 policy, so an
  un-enrolled session can read no data at all.
*/
async function prepareEnrolment() {
  /*
    An abandoned attempt leaves an unverified factor behind, and Supabase refuses a
    second enrolment while one exists. Clearing them first makes a retry work
    instead of failing with a confusing "factor already exists".
  */
  const { data: existing } = await PPMSupabase.auth.mfa.listFactors();
  const stale = (existing?.totp || []).filter((factor) => factor.status !== "verified");
  for (const factor of stale) {
    await PPMSupabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await PPMSupabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Portfolio Manager ${new Date().toISOString().slice(0, 10)}`
  });
  if (error) throw new Error(`The authenticator could not be set up: ${error.message}`);

  pendingFactorId = data?.id || "";
  const qr = data?.totp?.qr_code || "";
  const host = byId("enrolQr");

  /*
    supabase-js returns the QR either as an SVG data URI or as raw SVG markup
    depending on version, so both are handled. Neither is a script, and the page
    CSP already allows data: images.
  */
  host.textContent = "";
  if (/^data:/i.test(qr)) {
    const image = document.createElement("img");
    image.src = qr;
    image.alt = "Authenticator QR code";
    host.appendChild(image);
  } else if (/^\s*<svg/i.test(qr)) {
    host.innerHTML = qr;
  } else {
    host.textContent = "Use the key below to add this account to your authenticator app.";
  }

  byId("enrolSecret").textContent = data?.totp?.secret || "unavailable";
  showSection("enrolSection");
  byId("enrolCode").value = "";
  setTimeout(() => byId("enrolCode").focus(), 0);
}

function preparePasswordChange() {
  showSection("passwordSection");
  byId("newPassword").value = "";
  byId("confirmPassword").value = "";
  setTimeout(() => byId("newPassword").focus(), 0);
}

async function routeAfterPassword() {
  const aal = await getAal();
  if (aal?.currentLevel === "aal2") {
    await afterAal2();
    return;
  }
  if (aal?.nextLevel === "aal2") {
    await prepareMfa();
    return;
  }

  // No factor at all: enrol one rather than dead-ending.
  await prepareEnrolment();
}

async function signIn(event) {
  event.preventDefault();
  const button = byId("loginButton");
  setBusy(button, true, "Sign in");

  try {
    const typed = byId("loginPassword").value;
    const { error } = await PPMSupabase.auth.signInWithPassword({
      email: byId("loginEmail").value.trim(),
      password: typed
    });

    if (error) throw new Error("The email address or password is incorrect.");
    temporaryPassword = typed;
    byId("loginPassword").value = "";
    await routeAfterPassword();
  } catch (error) {
    showSection("loginSection");
    showMessage(error.message || "Sign-in failed.", "error");
    setBusy(button, false, "Sign in");
    byId("loginPassword").focus();
  }
}

async function verifyMfa(event) {
  event.preventDefault();
  const button = byId("mfaButton");
  const code = byId("mfaCode").value.replace(/\s+/g, "");

  if (!/^\d{6}$/.test(code)) {
    showMessage("Enter the six-digit code from your authenticator app.", "error");
    return;
  }

  setBusy(button, true, "Verify and continue");
  try {
    const { error } = await PPMSupabase.auth.mfa.challengeAndVerify({
      factorId: pendingFactorId,
      code
    });
    if (error) throw new Error("The authenticator code was not accepted. Wait for a fresh code and try again.");
    await afterAal2();
  } catch (error) {
    showMessage(error.message || "Authenticator verification failed.", "error");
    setBusy(button, false, "Verify and continue");
    byId("mfaCode").select();
  }
}

/* Stage 13A: confirm the newly enrolled authenticator, which promotes the session
   to AAL2 and is what finally makes data readable. */
async function confirmEnrolment(event) {
  event.preventDefault();
  const button = byId("enrolButton");
  const code = byId("enrolCode").value.replace(/\s+/g, "");

  if (!/^\d{6}$/.test(code)) {
    showMessage("Enter the six-digit code shown in your authenticator app.", "error");
    return;
  }

  setBusy(button, true, "Confirm authenticator");
  try {
    const { error } = await PPMSupabase.auth.mfa.challengeAndVerify({
      factorId: pendingFactorId,
      code
    });
    if (error)
      throw new Error(
        "That code was not accepted. Check the app is showing a code for Portfolio Manager, wait for a fresh one and try again."
      );
    await afterAal2();
  } catch (error) {
    showMessage(error.message || "The authenticator could not be confirmed.", "error");
    setBusy(button, false, "Confirm authenticator");
    byId("enrolCode").select();
  }
}

/* Stage 13A: replace an administrator-issued password with the user's own. */
async function submitNewPassword(event) {
  event.preventDefault();
  const button = byId("passwordButton");
  const next = byId("newPassword").value;
  const confirm = byId("confirmPassword").value;

  if (next.length < 12) {
    showMessage("Use at least 12 characters.", "error");
    return;
  }
  if (next !== confirm) {
    showMessage("The two passwords do not match.", "error");
    return;
  }
  if (temporaryPassword && next === temporaryPassword) {
    showMessage("Choose a different password from the temporary one you were given.", "error");
    return;
  }

  setBusy(button, true, "Save password and continue");
  try {
    const { error } = await PPMSupabase.auth.updateUser({ password: next });
    if (error) throw new Error(error.message || "The password could not be changed.");

    /*
      Clearing the flag goes through an RPC rather than a table write. people is the
      identity table and opening a column-level write path on it for this would be a
      poor trade; the RPC only ever sets the flag false, and only for the caller.
    */
    const { error: rpcError } = await PPMSupabase.rpc("ppm_complete_first_run");
    if (rpcError)
      console.warn(
        "PPMAuth: the password was changed but the first-run flag could not be cleared.",
        rpcError
      );

    linkedPerson = await loadLinkedPerson();
    await finishSignIn();
  } catch (error) {
    showMessage(error.message || "The password could not be changed.", "error");
    setBusy(button, false, "Save password and continue");
    byId("newPassword").focus();
  }
}

async function useAnotherAccount() {
  try {
    await PPMSupabase.auth.signOut({ scope: "local" });
  } finally {
    PPMAuth.endSession("switched account");
    pendingFactorId = "";
    clearFirstRunState();
    byId("loginPassword").value = "";
    showSection("loginSection");
    byId("loginEmail").focus();
  }
}

async function cancelMfa() {
  await useAnotherAccount();
}

async function initialiseLogin() {
  showSection("loginSection");

  try {
    const { data: userData, error: userError } = await PPMSupabase.auth.getUser();
    if (userError || !userData?.user) return;

    const aal = await getAal();
    if (aal?.currentLevel === "aal2") {
      const { person, user } = await loadLinkedPerson();
      if (person?.password_reset_required) {
        linkedPerson = { person, user };
        preparePasswordChange();
        return;
      }
      const resource = PPMAuth.establishSupabaseSession(person, user.id, { audit: false });
      byId("existingSessionText").textContent =
        `You are signed in as ${resource.fullName || resource.email} (${resource.accessRole}).`;
      showSection("existingSession");
      return;
    }

    if (aal?.nextLevel === "aal2") {
      await prepareMfa();
      return;
    }

    // Signed in at AAL1 with no factor: offer enrolment rather than a dead end.
    await prepareEnrolment();
  } catch (error) {
    console.error("Login initialisation failed:", error);
    showSection("loginSection");
  }
}

document.querySelectorAll("[data-password-target]").forEach((button) =>
  button.addEventListener("click", () => {
    const input = byId(button.dataset.passwordTarget);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
  })
);

byId("loginForm").addEventListener("submit", signIn);
byId("mfaForm").addEventListener("submit", verifyMfa);
byId("mfaCancelButton").addEventListener("click", cancelMfa);
byId("enrolForm").addEventListener("submit", confirmEnrolment);
byId("enrolCancelButton").addEventListener("click", useAnotherAccount);
byId("passwordForm").addEventListener("submit", submitNewPassword);
byId("continueButton").addEventListener("click", () => (location.href = PPMAuth.safeReturnUrl()));
byId("otherAccountButton").addEventListener("click", useAnotherAccount);

document.addEventListener("DOMContentLoaded", initialiseLogin);
