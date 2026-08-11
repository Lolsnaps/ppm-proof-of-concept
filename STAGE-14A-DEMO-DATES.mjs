/*
  STAGE 14A - shared date helpers for the demo data generator.

  Every date in the application is a calendar date, not an instant, so all
  arithmetic here works on ISO date strings in UTC and never constructs a local
  Date from a bare string. TODAY is fixed rather than read from the clock, which
  is what makes the generated SQL byte-identical on every run.
*/

/* The "now" the whole dataset is generated relative to. Set to the date the seed
   was authored so overdue milestones, in-flight tasks and reporting periods all
   line up with each other. */
export const TODAY = "2026-08-08";

export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonths(iso, months) {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

/* Move a date off a weekend, so no generated plan starts on a Saturday. */
export function workday(iso) {
  if (!iso) return "";
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (day === 6) return addDays(iso, 2);
  if (day === 0) return addDays(iso, 1);
  return iso;
}

export function addWorkingDays(iso, days) {
  let out = iso;
  let remaining = Math.abs(days);
  const step = days < 0 ? -1 : 1;
  while (remaining > 0) {
    out = addDays(out, step);
    const day = new Date(`${out}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return out;
}

export function daysBetween(fromIso, toIso) {
  return Math.round(
    (new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000
  );
}

export function isPast(iso) {
  return Boolean(iso) && iso < TODAY;
}

/* An ISO instant, used for createdAt/updatedAt style fields. The time of day is
   fixed so the output stays deterministic. */
export function at(iso, hour = 9, minute = 30) {
  return `${iso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

/* Financial period label matching the society's April year start, e.g. 2026-07
   sits in FY2026/27 period 4. */
export function financialPeriod(iso) {
  const [year, month] = iso.split("-").map(Number);
  const fyStart = month >= 4 ? year : year - 1;
  const period = month >= 4 ? month - 3 : month + 9;
  return {
    label: `${iso.slice(0, 7)}`,
    financialYear: `${fyStart}/${String((fyStart + 1) % 100).padStart(2, "0")}`,
    period
  };
}

/* Month label as the reporting pages render it, e.g. "August 2026". */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

export function monthLabel(iso) {
  const [year, month] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}
