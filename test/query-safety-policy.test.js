"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MIN_QUERY_INTERVAL_MS,
  evaluateScheduledQuery,
  readPolicyInputs,
  writeGithubOutputs,
  writeStepSummary,
} = require("../src/query-safety-policy");

const NOW = new Date("2026-07-16T12:00:00.000Z");

function latest(overrides = {}) {
  return {
    reportDate: "2026-07-16",
    generatedAt: "2026-07-16T11:00:00.000Z",
    source: { mode: "live" },
    completeness: { complete: false, blocked: false },
    ...overrides,
  };
}

function safetyState(overrides = {}) {
  const state = {
    schemaVersion: 1,
    lastAttemptAt: null,
    lastEvent: null,
    lastRunId: null,
    lastResult: "never",
    blockedDate: null,
    updatedAt: null,
    ...overrides,
  };
  if (state.blockedDate && overrides.lastResult === undefined) {
    state.lastResult = "blocked";
  }
  if (state.lastResult !== "never") {
    state.lastAttemptAt ||=
      state.blockedDate === "2026-07-16"
        ? "2026-07-16T00:00:00.000Z"
        : "2026-07-15T00:00:00.000Z";
    state.lastEvent ||= "schedule";
    state.lastRunId ||= "123";
    state.updatedAt ||= state.lastAttemptAt;
  }
  return state;
}

test("예약 실행은 유효한 안전 상태를 확인한 뒤 gate를 통과한다", () => {
  const result = evaluateScheduledQuery({
    latest: latest({ generatedAt: "2026-07-15T00:00:00.000Z" }),
    safetyState: safetyState(),
    now: NOW,
  });
  assert.deepEqual(result, {
    allowed: true,
    reason: "scheduled",
    waitSeconds: 0,
  });
});

test("예약 실행도 당일 BLOCKED 안전 상태를 우회하지 않는다", () => {
  const result = evaluateScheduledQuery({
    latest: latest({ generatedAt: "2026-07-15T00:00:00.000Z" }),
    safetyState: safetyState({ blockedDate: "2026-07-16" }),
    now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "blocked_today");
});

test("법원 요청을 시작한 실행이 실패하거나 중단되면 그날 예약을 중지한다", () => {
  for (const lastResult of ["started", "failed"]) {
    const result = evaluateScheduledQuery({
      latest: latest({ generatedAt: "2026-07-15T00:00:00.000Z" }),
      safetyState: safetyState({
        lastAttemptAt: "2026-07-16T11:00:00.000Z",
        lastResult,
      }),
      now: NOW,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "uncertain_today");
  }
});

test("최근 durable 예약은 중복 예약 실행을 안전 간격 동안 거부한다", () => {
  const result = evaluateScheduledQuery({
    latest: latest({ generatedAt: "2026-07-15T00:00:00.000Z" }),
    safetyState: safetyState({
      lastAttemptAt: "2026-07-16T11:58:00.000Z",
      lastResult: "incomplete",
    }),
    now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "cooldown");
  assert.equal(result.waitSeconds, 480);
});

test("안전 간격 경계에 도달하면 다음 예약을 허용한다", () => {
  const result = evaluateScheduledQuery({
    latest: latest({
      generatedAt: new Date(
        NOW.getTime() - MIN_QUERY_INTERVAL_MS,
      ).toISOString(),
    }),
    safetyState: safetyState(),
    now: NOW,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "scheduled");
});

test("전날 BLOCKED 기록은 다음 날 예약을 막지 않는다", () => {
  const result = evaluateScheduledQuery({
    latest: latest({
      reportDate: "2026-07-15",
      generatedAt: "2026-07-15T00:00:00.000Z",
      completeness: { complete: false, blocked: true },
    }),
    safetyState: safetyState({
      blockedDate: "2026-07-15",
      lastAttemptAt: "2026-07-15T00:00:00.000Z",
    }),
    now: NOW,
  });
  assert.equal(result.allowed, true);
});

test("fixture 생성 시각은 live 조회 안전 간격으로 사용하지 않는다", () => {
  const result = evaluateScheduledQuery({
    latest: latest({
      generatedAt: NOW.toISOString(),
      source: { mode: "fixture" },
    }),
    safetyState: safetyState(),
    now: NOW,
  });
  assert.equal(result.allowed, true);
});

test("latest 또는 안전 상태가 없거나 손상되면 fail-closed한다", () => {
  for (const overrides of [
    { latest: null, latestAvailable: false, safetyState: safetyState() },
    {
      latest: latest(),
      safetyState: null,
      safetyStateAvailable: false,
    },
    { latest: { generatedAt: "bad" }, safetyState: safetyState() },
    {
      latest: latest({ completeness: { complete: true, blocked: true } }),
      safetyState: safetyState(),
    },
  ]) {
    const result = evaluateScheduledQuery({ now: NOW, ...overrides });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "state_unavailable");
  }
});

test("GitHub output은 상수값만 줄 단위로 기록한다", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "query-safety-"));
  const outputPath = path.join(directory, "output.txt");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  writeGithubOutputs(outputPath, {
    allowed: false,
    reason: "cooldown",
    waitSeconds: 90,
  });
  assert.equal(
    fs.readFileSync(outputPath, "utf8"),
    "allowed=false\nreason=cooldown\nwait_seconds=90\n",
  );
});

test("정책 파일이 없거나 손상되면 available=false로 읽는다", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "query-input-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let inputs = readPolicyInputs(directory);
  assert.equal(inputs.latest.available, false);
  assert.equal(inputs.safetyState.available, false);

  fs.mkdirSync(path.join(directory, "data"));
  fs.writeFileSync(path.join(directory, "data", "latest.json"), "{", "utf8");
  fs.writeFileSync(
    path.join(directory, "data", "query-safety-state.json"),
    JSON.stringify(safetyState()),
    "utf8",
  );
  inputs = readPolicyInputs(directory);
  assert.equal(inputs.latest.available, false);
  assert.equal(inputs.safetyState.available, true);
});

test("거부된 예약은 Actions 요약에 남는다", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "query-summary-"));
  const summaryPath = path.join(directory, "summary.md");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  writeStepSummary(summaryPath, {
    allowed: false,
    reason: "blocked_today",
    waitSeconds: 0,
  });
  assert.match(fs.readFileSync(summaryPath, "utf8"), /남은 예약 조회/u);
});
