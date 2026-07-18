"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  finalizeState,
  normalizeErrorCode,
  normalizeErrorStatusCode,
  reserveState,
  validateQuerySafetyState,
  writeOutcomeOutputs,
} = require("../src/query-safety-state");

const ATTEMPT = new Date("2026-07-16T12:00:00.000Z");
const FINISHED = new Date("2026-07-16T12:05:00.000Z");

function initialState(overrides = {}) {
  return {
    schemaVersion: 1,
    lastAttemptAt: null,
    lastEvent: null,
    lastRunId: null,
    lastResult: "never",
    blockedDate: null,
    updatedAt: null,
    ...overrides,
  };
}

function report(overrides = {}) {
  return {
    reportDate: "2026-07-16",
    generatedAt: "2026-07-16T12:01:00.000Z",
    source: { mode: "live" },
    completeness: {
      complete: true,
      blocked: false,
      errorCode: null,
    },
    ...overrides,
  };
}

function previousReport(overrides = {}) {
  return report({
    reportDate: "2026-07-15",
    generatedAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  });
}

function reserve(state = initialState(), overrides = {}) {
  return reserveState(state, {
    now: ATTEMPT,
    eventName: "schedule",
    runId: "123",
    latest: previousReport(),
    ...overrides,
  });
}

test("예약 조회 시작 전에 durable 안전 상태를 만든다", () => {
  const reserved = reserve();
  assert.deepEqual(reserved, {
    schemaVersion: 1,
    lastAttemptAt: ATTEMPT.toISOString(),
    lastEvent: "schedule",
    lastRunId: "123",
    lastResult: "started",
    blockedDate: null,
    updatedAt: ATTEMPT.toISOString(),
  });
  assert.equal(validateQuerySafetyState(reserved), true);
});

test("새 완전 보고서는 complete 결과로 durable 상태에 기록한다", () => {
  const reserved = reserve();
  const finalized = finalizeState(reserved, {
    latest: report(),
    updateOutcome: "success",
    now: FINISHED,
  });
  assert.equal(finalized.state.lastResult, "complete");
  assert.equal(finalized.state.blockedDate, null);
  assert.deepEqual(finalized.outcome, {
    fresh: true,
    complete: true,
    blocked: false,
    errorCode: null,
    errorStatusCode: null,
    result: "complete",
  });
});

test("새 BLOCKED 보고서는 날짜를 durable 상태에 남긴다", () => {
  const reserved = reserve();
  const finalized = finalizeState(reserved, {
    latest: report({
      completeness: {
        complete: false,
        blocked: true,
        errorCode: "BLOCKED",
      },
    }),
    updateOutcome: "success",
    now: FINISHED,
  });
  assert.equal(finalized.state.lastResult, "blocked");
  assert.equal(finalized.state.blockedDate, "2026-07-16");
  assert.equal(finalized.outcome.blocked, true);
  assert.equal(finalized.outcome.errorCode, "BLOCKED");
});

test("incomplete와 workflow 실패를 완료 조회로 보고하지 않는다", () => {
  const reserved = reserve();
  const incomplete = finalizeState(reserved, {
    latest: report({
      completeness: {
        complete: false,
        blocked: false,
        errorCode: "NETWORK_ERROR",
        errorStatusCode: 503,
      },
    }),
    updateOutcome: "success",
    now: FINISHED,
  });
  assert.equal(incomplete.state.lastResult, "incomplete");
  assert.equal(incomplete.outcome.errorCode, "NETWORK_ERROR");
  assert.equal(incomplete.outcome.errorStatusCode, 503);

  const failed = finalizeState(reserved, {
    latest: report({ generatedAt: "2026-07-16T11:00:00.000Z" }),
    updateOutcome: "failure",
    now: FINISHED,
  });
  assert.equal(failed.state.lastResult, "failed");
  assert.deepEqual(failed.outcome, {
    fresh: false,
    complete: false,
    blocked: false,
    errorCode: "WORKFLOW_FAILED",
    errorStatusCode: null,
    result: "failed",
  });
});

test("손상된 durable 상태는 수정하지 않고 거부한다", () => {
  assert.equal(validateQuerySafetyState({}), false);
  assert.throws(
    () =>
      reserveState(
        { schemaVersion: 1 },
        { now: ATTEMPT, latest: previousReport() },
      ),
    /state is invalid/u,
  );
  assert.equal(
    validateQuerySafetyState(
      initialState({
        lastResult: "failed",
        lastEvent: "schedule",
        lastRunId: "123",
        updatedAt: ATTEMPT.toISOString(),
      }),
    ),
    false,
  );
  assert.equal(
    validateQuerySafetyState(
      initialState({
        lastAttemptAt: ATTEMPT.toISOString(),
        lastEvent: "schedule",
        lastRunId: "123",
        lastResult: "blocked",
        blockedDate: "2026-99-99",
        updatedAt: ATTEMPT.toISOString(),
      }),
    ),
    false,
  );
  assert.equal(
    validateQuerySafetyState(
      initialState({
        lastAttemptAt: "2026-07-16T01:00:00.000Z",
        lastEvent: "schedule",
        lastRunId: "123",
        lastResult: "blocked",
        blockedDate: "2026-07-15",
        updatedAt: "2026-07-16T01:05:00.000Z",
      }),
    ),
    false,
  );
});

test("update job만 재실행해도 reserve가 당일 실패·차단·cooldown을 다시 검사한다", () => {
  const base = {
    lastAttemptAt: "2026-07-16T11:00:00.000Z",
    lastEvent: "schedule",
    lastRunId: "122",
    updatedAt: "2026-07-16T11:05:00.000Z",
  };
  for (const state of [
    initialState({ ...base, lastResult: "failed" }),
    initialState({
      ...base,
      lastResult: "blocked",
      blockedDate: "2026-07-16",
    }),
    initialState({
      ...base,
      lastAttemptAt: "2026-07-16T11:55:00.000Z",
      lastResult: "incomplete",
    }),
  ]) {
    assert.throws(
      () => reserve(state),
      /query reservation denied/u,
    );
  }
});

test("원격 오류 코드는 GitHub output 줄을 주입할 수 없게 정규화한다", () => {
  assert.equal(
    normalizeErrorCode("BLOCKED\ncomplete=true"),
    "BLOCKED_complete_true",
  );
  assert.equal(normalizeErrorStatusCode(500), 500);
  assert.equal(normalizeErrorStatusCode("400"), 400);
  assert.equal(normalizeErrorStatusCode("500\ncomplete=true"), null);
});

test("완전성 outcome을 GitHub job output으로 기록한다", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "query-outcome-"));
  const outputPath = path.join(directory, "output.txt");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  writeOutcomeOutputs(outputPath, {
    fresh: true,
    complete: false,
    blocked: true,
    errorCode: "BLOCKED",
    errorStatusCode: 403,
    result: "blocked",
  });
  assert.equal(
    fs.readFileSync(outputPath, "utf8"),
    "fresh=true\ncomplete=false\nblocked=true\nerror_code=BLOCKED\nerror_status=403\nresult=blocked\n",
  );
});
