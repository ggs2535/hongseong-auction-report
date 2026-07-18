"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  QUERY_COOLDOWN_MS,
  STATE_RELATIVE_PATH,
  evaluateSafetyWindow,
  isValidLatest,
  validateQuerySafetyState,
} = require("./query-safety-state");

const MIN_QUERY_INTERVAL_MS = QUERY_COOLDOWN_MS;

function evaluateScheduledQuery(options = {}) {
  const latest = options.latest || null;
  const safetyState = options.safetyState || null;
  const now =
    options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const cooldownMs =
    options.cooldownMs === undefined
      ? MIN_QUERY_INTERVAL_MS
      : Number(options.cooldownMs);

  if (Number.isNaN(now.getTime())) {
    throw new TypeError("now must be a valid date");
  }
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new TypeError("cooldownMs must be a non-negative number");
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
    reason: safety.allowed ? "scheduled" : safety.reason,
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
    validateQuerySafetyState,
  );
  return { latest, safetyState };
}

function writeGithubOutputs(filePath, result) {
  if (!filePath) return;
  fs.appendFileSync(
    filePath,
    [
      `allowed=${String(result.allowed)}`,
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
    "안전 상태 파일을 확인할 수 없어 이번 예약 조회를 실행하지 않았습니다.";
  if (result.reason === "blocked_today") {
    message =
      "오늘 법원 차단이 감지되어 남은 예약 조회를 실행하지 않습니다.";
  } else if (result.reason === "uncertain_today") {
    message =
      "이전 예약 조회가 비정상 종료되어 오늘 남은 예약 조회를 실행하지 않습니다.";
  } else if (result.reason === "cooldown") {
    message = `최근 조회 후 안전 간격이 지나지 않아 이번 예약을 건너뜁니다. 남은 시간: 약 ${Math.ceil(result.waitSeconds / 60)}분`;
  }
  fs.appendFileSync(
    filePath,
    `## 예약 조회 안전 보호\n\n${message}\n`,
    "utf8",
  );
}

function main() {
  const rootDir = path.resolve(__dirname, "..");
  const inputs = readPolicyInputs(rootDir);
  const result = evaluateScheduledQuery({
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
  MIN_QUERY_INTERVAL_MS,
  evaluateScheduledQuery,
  isValidLatest,
  readJsonStatus,
  readPolicyInputs,
  writeGithubOutputs,
  writeStepSummary,
};
