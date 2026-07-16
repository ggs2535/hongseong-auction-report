"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { dateInTimezone, writeJsonAtomic } = require("./storage");

const STATE_RELATIVE_PATH = path.join("data", "instant-query-state.json");
const QUERY_COOLDOWN_MS = 10 * 60 * 1000;
const EVENTS = new Set(["issues", "schedule", "workflow_dispatch"]);
const RESULTS = new Set([
  "never",
  "started",
  "complete",
  "incomplete",
  "blocked",
  "failed",
]);

function optionalString(value) {
  return value === null || value === undefined ? null : String(value);
}

function normalizeErrorCode(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value)
    .replace(/[^A-Za-z0-9_.:-]/gu, "_")
    .slice(0, 80);
}

function normalizeErrorStatusCode(value) {
  if (value === null || value === undefined || value === "") return null;
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

function isDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validateInstantQueryState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (!RESULTS.has(String(value.lastResult || ""))) return false;
  for (const key of [
    "lastAttemptAt",
    "lastEvent",
    "lastRunId",
    "blockedDate",
    "updatedAt",
  ]) {
    if (value[key] !== null && typeof value[key] !== "string") return false;
  }
  if (
    value.lastAttemptAt !== null &&
    !Number.isFinite(Date.parse(value.lastAttemptAt))
  ) {
    return false;
  }
  if (
    value.updatedAt !== null &&
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    return false;
  }
  if (value.blockedDate !== null && !isDateOnly(value.blockedDate)) {
    return false;
  }
  if (value.lastEvent !== null && !EVENTS.has(value.lastEvent)) return false;
  if (value.lastRunId !== null && !/^\d+$/u.test(value.lastRunId)) return false;
  if (value.lastResult === "never") {
    return (
      value.lastAttemptAt === null &&
      value.lastEvent === null &&
      value.lastRunId === null &&
      value.blockedDate === null &&
      value.updatedAt === null
    );
  }
  if (
    value.lastAttemptAt === null ||
    value.lastEvent === null ||
    value.lastRunId === null ||
    value.updatedAt === null
  ) {
    return false;
  }
  if (value.lastResult === "blocked" && value.blockedDate === null) {
    return false;
  }
  if (
    value.lastResult === "blocked" &&
    dateInTimezone(new Date(value.lastAttemptAt), "Asia/Seoul") !==
      value.blockedDate
  ) {
    return false;
  }
  return true;
}

function isValidLatest(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Number.isFinite(Date.parse(String(value.generatedAt || ""))) &&
      isDateOnly(value.reportDate) &&
      value.source &&
      ["fixture", "live"].includes(value.source.mode) &&
      value.completeness &&
      typeof value.completeness === "object" &&
      typeof value.completeness.complete === "boolean" &&
      typeof value.completeness.blocked === "boolean" &&
      !(value.completeness.complete && value.completeness.blocked),
  );
}

function evaluateSafetyWindow(options = {}) {
  const latest = options.latest || null;
  const safetyState = options.safetyState || null;
  const now =
    options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const cooldownMs =
    options.cooldownMs === undefined
      ? QUERY_COOLDOWN_MS
      : Number(options.cooldownMs);

  if (Number.isNaN(now.getTime())) throw new TypeError("now must be valid");
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new TypeError("cooldownMs must be a non-negative number");
  }
  if (
    options.latestAvailable === false ||
    options.safetyStateAvailable === false ||
    !isValidLatest(latest) ||
    !validateInstantQueryState(safetyState)
  ) {
    return { allowed: false, reason: "state_unavailable", waitSeconds: 0 };
  }

  const today = dateInTimezone(now, "Asia/Seoul");
  const latestIsLive = latest.source.mode === "live";
  if (
    String(safetyState.blockedDate || "") === today ||
    (latestIsLive &&
      latest.completeness.blocked === true &&
      String(latest.reportDate || "") === today)
  ) {
    return { allowed: false, reason: "blocked_today", waitSeconds: 0 };
  }

  const lastAttemptTimestamp = Date.parse(
    String(safetyState.lastAttemptAt || ""),
  );
  if (
    Number.isFinite(lastAttemptTimestamp) &&
    ["started", "failed"].includes(safetyState.lastResult) &&
    dateInTimezone(new Date(lastAttemptTimestamp), "Asia/Seoul") === today
  ) {
    return { allowed: false, reason: "uncertain_today", waitSeconds: 0 };
  }

  const policyTimestamps = [
    latestIsLive
      ? Date.parse(String(latest.generatedAt || ""))
      : Number.NaN,
    lastAttemptTimestamp,
  ].filter(Number.isFinite);
  const latestTimestamp =
    policyTimestamps.length > 0 ? Math.max(...policyTimestamps) : Number.NaN;
  if (Number.isFinite(latestTimestamp)) {
    const elapsedMs = now.getTime() - latestTimestamp;
    if (elapsedMs < cooldownMs) {
      return {
        allowed: false,
        reason: "cooldown",
        waitSeconds: Math.max(
          1,
          Math.ceil((cooldownMs - elapsedMs) / 1000),
        ),
      };
    }
  }

  return { allowed: true, reason: "ready", waitSeconds: 0 };
}

function reserveState(state, options = {}) {
  if (!validateInstantQueryState(state)) {
    throw new Error("instant-query state is invalid");
  }
  const now =
    options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new TypeError("now must be valid");
  const safety = evaluateSafetyWindow({
    latest: options.latest,
    latestAvailable: options.latestAvailable,
    safetyState: state,
    safetyStateAvailable: true,
    now,
    cooldownMs: options.cooldownMs,
  });
  if (!safety.allowed) {
    throw new Error(`query reservation denied: ${safety.reason}`);
  }

  const reserved = {
    ...state,
    lastAttemptAt: now.toISOString(),
    lastEvent: optionalString(options.eventName),
    lastRunId: optionalString(options.runId),
    lastResult: "started",
    updatedAt: now.toISOString(),
  };
  if (!validateInstantQueryState(reserved)) {
    throw new Error("reserved instant-query state is invalid");
  }
  return reserved;
}

function finalizeState(state, options = {}) {
  if (!validateInstantQueryState(state)) {
    throw new Error("instant-query state is invalid");
  }
  const now =
    options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) throw new TypeError("now must be valid");

  const latest = options.latest || null;
  const reservationTimestamp = Date.parse(String(state.lastAttemptAt || ""));
  const reportTimestamp = Date.parse(String(latest?.generatedAt || ""));
  const freshReport =
    latest?.source?.mode === "live" &&
    Number.isFinite(reservationTimestamp) &&
    Number.isFinite(reportTimestamp) &&
    reportTimestamp >= reservationTimestamp;
  const updateSucceeded = String(options.updateOutcome || "") === "success";
  const complete =
    updateSucceeded && freshReport && latest?.completeness?.complete === true;
  const blocked =
    updateSucceeded && freshReport && latest?.completeness?.blocked === true;
  const errorCode =
    updateSucceeded && freshReport
      ? normalizeErrorCode(latest?.completeness?.errorCode)
      : "WORKFLOW_FAILED";
  const errorStatusCode =
    updateSucceeded && freshReport
      ? normalizeErrorStatusCode(latest?.completeness?.errorStatusCode)
      : null;
  const lastResult = blocked
    ? "blocked"
    : complete
      ? "complete"
      : updateSucceeded && freshReport
        ? "incomplete"
        : "failed";

  return {
    state: {
      ...state,
      lastResult,
      blockedDate: blocked
        ? optionalString(latest?.reportDate)
        : state.blockedDate,
      updatedAt: now.toISOString(),
    },
    outcome: {
      fresh: freshReport,
      complete,
      blocked,
      errorCode,
      errorStatusCode,
      result: lastResult,
    },
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeOutcomeOutputs(filePath, outcome) {
  if (!filePath) return;
  fs.appendFileSync(
    filePath,
    [
      `fresh=${String(outcome.fresh)}`,
      `complete=${String(outcome.complete)}`,
      `blocked=${String(outcome.blocked)}`,
      `error_code=${outcome.errorCode || ""}`,
      `error_status=${outcome.errorStatusCode || ""}`,
      `result=${outcome.result}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function main() {
  const command = process.argv[2];
  const rootDir = path.resolve(__dirname, "..");
  const statePath = path.join(rootDir, STATE_RELATIVE_PATH);
  const state = readJson(statePath);

  if (command === "reserve") {
    let latest = null;
    let latestAvailable = true;
    try {
      latest = readJson(path.join(rootDir, "data", "latest.json"));
    } catch {
      latestAvailable = false;
    }
    const reserved = reserveState(state, {
      latest,
      latestAvailable,
      eventName: process.env.GITHUB_EVENT_NAME,
      runId: process.env.GITHUB_RUN_ID,
      now: new Date(),
    });
    await writeJsonAtomic(statePath, reserved);
    process.stdout.write(`${JSON.stringify(reserved)}\n`);
    return;
  }

  if (command === "finalize") {
    let latest = null;
    try {
      latest = readJson(path.join(rootDir, "data", "latest.json"));
    } catch {
      // The durable reservation still enforces cooldown when collection failed.
    }
    const finalized = finalizeState(state, {
      latest,
      updateOutcome: process.env.UPDATE_OUTCOME,
      now: new Date(),
    });
    await writeJsonAtomic(statePath, finalized.state);
    writeOutcomeOutputs(process.env.GITHUB_OUTPUT, finalized.outcome);
    process.stdout.write(`${JSON.stringify(finalized)}\n`);
    return;
  }

  throw new Error("usage: node src/instant-query-state.js reserve|finalize");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  EVENTS,
  QUERY_COOLDOWN_MS,
  RESULTS,
  STATE_RELATIVE_PATH,
  evaluateSafetyWindow,
  finalizeState,
  isDateOnly,
  isValidLatest,
  normalizeErrorCode,
  normalizeErrorStatusCode,
  reserveState,
  validateInstantQueryState,
  writeOutcomeOutputs,
};
