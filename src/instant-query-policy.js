"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  QUERY_COOLDOWN_MS,
  STATE_RELATIVE_PATH,
  evaluateSafetyWindow,
  isValidLatest,
  validateInstantQueryState,
} = require("./instant-query-state");

const INSTANT_QUERY_COOLDOWN_MS = QUERY_COOLDOWN_MS;
const IMMEDIATE_EVENTS = new Set(["issues", "workflow_dispatch"]);

function evaluateInstantQuery(options = {}) {
  const eventName = String(options.eventName || "");
  const latest = options.latest || null;
  const safetyState = options.safetyState || null;
  const runAttempt = Number(options.runAttempt || 1);
  const immediate = IMMEDIATE_EVENTS.has(eventName) || runAttempt > 1;
  const now =
    options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const cooldownMs =
    options.cooldownMs === undefined
      ? INSTANT_QUERY_COOLDOWN_MS
      : Number(options.cooldownMs);

  if (Number.isNaN(now.getTime())) {
    throw new TypeError("now must be a valid date");
  }
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new TypeError("cooldownMs must be a non-negative number");
  }
  if (!Number.isInteger(runAttempt) || runAttempt < 1) {
    throw new TypeError("runAttempt must be a positive integer");
  }

  const safety = evaluateSafetyWindow({
    latest,
    latestAvailable: options.latestAvailable,
    safetyState,
    safetyStateAvailable: options.safetyStateAvailable,
    now,
    cooldownMs,
  });
  return {
    ...safety,
    immediate,
    reason: safety.allowed && !immediate ? "scheduled" : safety.reason,
  };
}

function readJsonStatus(filePath, validator) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      available: validator(value),
      value,
    };
  } catch {
    return {
      available: false,
      value: null,
    };
  }
}

function readPolicyInputs(rootDir) {
  const latest = readJsonStatus(
    path.join(rootDir, "data", "latest.json"),
    isValidLatest,
  );
  const safetyState = readJsonStatus(
    path.join(rootDir, STATE_RELATIVE_PATH),
    validateInstantQueryState,
  );
  return { latest, safetyState };
}

function writeGithubOutputs(filePath, result) {
  if (!filePath) return;
  fs.appendFileSync(
    filePath,
    [
      `allowed=${String(result.allowed)}`,
      `immediate=${String(result.immediate)}`,
      `reason=${result.reason}`,
      `wait_seconds=${result.waitSeconds}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function writeStepSummary(filePath, result) {
  if (!filePath || result.allowed) return;
  let message =
    "안전 상태 파일을 확인할 수 없어 즉시 조회를 실행하지 않았습니다.";
  if (result.reason === "blocked_today") {
    message =
      "오늘 법원 차단이 감지되어 같은 날 즉시 조회를 다시 실행하지 않았습니다.";
  } else if (result.reason === "uncertain_today") {
    message =
      "법원 요청을 시작한 실행이 비정상 종료되어 같은 날 즉시 재조회를 실행하지 않았습니다.";
  } else if (result.reason === "cooldown") {
    message = `법원 과부하 방지를 위해 약 ${Math.ceil(result.waitSeconds / 60)}분 뒤 다시 요청할 수 있습니다.`;
  }
  fs.appendFileSync(
    filePath,
    `## 즉시 조회 안전 보호\n\n${message}\n`,
    "utf8",
  );
}

function main() {
  const rootDir = path.resolve(__dirname, "..");
  const inputs = readPolicyInputs(rootDir);
  const result = evaluateInstantQuery({
    eventName: process.env.GITHUB_EVENT_NAME,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    latest: inputs.latest.value,
    latestAvailable: inputs.latest.available,
    safetyState: inputs.safetyState.value,
    safetyStateAvailable: inputs.safetyState.available,
    now: new Date(),
  });
  writeGithubOutputs(process.env.GITHUB_OUTPUT, result);
  writeStepSummary(process.env.GITHUB_STEP_SUMMARY, result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) main();

module.exports = {
  IMMEDIATE_EVENTS,
  INSTANT_QUERY_COOLDOWN_MS,
  evaluateInstantQuery,
  isValidLatest,
  readJsonStatus,
  readPolicyInputs,
  writeGithubOutputs,
  writeStepSummary,
};
