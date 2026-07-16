"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INSTANT_QUERY_COOLDOWN_MS,
  evaluateInstantQuery,
  readPolicyInputs,
  writeGithubOutputs,
} = require("../src/instant-query-policy");

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
    state.lastEvent ||= "issues";
    state.lastRunId ||= "123";
    state.updatedAt ||= state.lastAttemptAt;
  }
  return state;
}

test("정기 실행도 유효한 안전 상태를 확인한 뒤 gate를 통과한다", () => {
  const result = evaluateInstantQuery({
    eventName: "schedule",
    latest: latest({
      generatedAt: "2026-07-15T00:00:00.000Z",
    }),
    safetyState: safetyState(),
    now: NOW,
  });
  assert.deepEqual(result, {
    allowed: true,
    immediate: false,
    reason: "scheduled",
    waitSeconds: 0,
  });
});

test("정기 실행도 당일 BLOCKED 안전 상태를 우회하지 않는다", () => {
  const result = evaluateInstantQuery({
    eventName: "schedule",
    latest: latest({ generatedAt: "2026-07-15T00:00:00.000Z" }),
    safetyState: safetyState({ blockedDate: "2026-07-16" }),
    now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.immediate, false);
  assert.equal(result.reason, "blocked_today");
});

test("정기 실행 재실행은 즉시 조회 정책을 우회하지 않는다", () => {
  const result = evaluateInstantQuery({
    eventName: "schedule",
    runAttempt: 2,
    latest: latest(),
    safetyState: safetyState({ blockedDate: "2026-07-16" }),
    now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.immediate, true);
  assert.equal(result.reason, "blocked_today");
});

test("유효한 초기 상태의 첫 즉시 조회를 실행할 수 있다", () => {
  assert.equal(
    evaluateInstantQuery({
      eventName: "issues",
      latest: latest({ generatedAt: "2026-07-15T00:00:00.000Z" }),
      safetyState: safetyState(),
      now: NOW,
    }).allowed,
    true,
  );
});

test("fixture 생성 시각은 live 즉시 조회 cooldown으로 사용하지 않는다", () => {
  const result = evaluateInstantQuery({
    eventName: "workflow_dispatch",
    latest: latest({
      generatedAt: NOW.toISOString(),
      source: { mode: "fixture" },
    }),
    safetyState: safetyState(),
    now: NOW,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "ready");
});

test("이슈와 workflow_dispatch 즉시 조회는 최근 실행 후 10분 동안 거부한다", () => {
  for (const eventName of ["issues", "workflow_dispatch"]) {
    const result = evaluateInstantQuery({
      eventName,
      latest: latest({ generatedAt: "2026-07-16T11:55:00.000Z" }),
      safetyState: safetyState(),
      now: NOW,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "cooldown");
    assert.equal(result.waitSeconds, 300);
  }
});

test("10분 대기 경계에 도달하면 즉시 조회를 허용한다", () => {
  const result = evaluateInstantQuery({
    eventName: "issues",
    latest: latest({
      generatedAt: new Date(
        NOW.getTime() - INSTANT_QUERY_COOLDOWN_MS,
      ).toISOString(),
    }),
    safetyState: safetyState(),
    now: NOW,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, "ready");
});

test("오늘 BLOCKED가 기록되면 같은 날 즉시 재조회를 거부한다", () => {
  const result = evaluateInstantQuery({
    eventName: "issues",
    latest: latest({
      generatedAt: "2026-07-15T00:00:00.000Z",
      completeness: { complete: false, blocked: true },
    }),
    safetyState: safetyState(),
    now: NOW,
  });
  assert.deepEqual(result, {
    allowed: false,
    immediate: true,
    reason: "blocked_today",
    waitSeconds: 0,
  });
});

test("전날 BLOCKED는 다음 날 즉시 조회를 막지 않는다", () => {
  const result = evaluateInstantQuery({
    eventName: "issues",
    latest: latest({
      reportDate: "2026-07-15",
      generatedAt: "2026-07-15T00:00:00.000Z",
      completeness: { complete: false, blocked: true },
    }),
    safetyState: safetyState(),
    now: NOW,
  });
  assert.equal(result.allowed, true);
});

test("durable 예약 시각이 최근이면 latest가 오래되어도 즉시 조회를 거부한다", () => {
  const result = evaluateInstantQuery({
    eventName: "issues",
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

test("durable 차단 날짜가 오늘이면 latest와 관계없이 즉시 조회를 거부한다", () => {
  const result = evaluateInstantQuery({
    eventName: "workflow_dispatch",
    latest: latest({ generatedAt: "2026-07-15T00:00:00.000Z" }),
    safetyState: safetyState({ blockedDate: "2026-07-16" }),
    now: NOW,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "blocked_today");
});

test("법원 요청을 시작한 실행이 실패·중단되면 같은 날 재조회를 거부한다", () => {
  for (const lastResult of ["started", "failed"]) {
    const result = evaluateInstantQuery({
      eventName: "issues",
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

test("latest 또는 durable 상태가 없거나 손상되면 fail-closed한다", () => {
  for (const overrides of [
    { latest: null, latestAvailable: false, safetyState: safetyState() },
    {
      latest: latest(),
      safetyState: null,
      safetyStateAvailable: false,
    },
    { latest: { generatedAt: "bad" }, safetyState: safetyState() },
    {
      latest: latest({ reportDate: "not-a-date" }),
      safetyState: safetyState(),
    },
    {
      latest: latest({ completeness: {} }),
      safetyState: safetyState(),
    },
    {
      latest: latest({
        completeness: { complete: "false", blocked: "true" },
      }),
      safetyState: safetyState(),
    },
    {
      latest: latest({
        completeness: { complete: true, blocked: true },
      }),
      safetyState: safetyState(),
    },
  ]) {
    const result = evaluateInstantQuery({
      eventName: "issues",
      now: NOW,
      ...overrides,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "state_unavailable");
  }
});

test("GitHub output은 상수값만 줄 단위로 기록한다", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "instant-query-"));
  const outputPath = path.join(directory, "output.txt");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  writeGithubOutputs(outputPath, {
    allowed: false,
    immediate: true,
    reason: "cooldown",
    waitSeconds: 90,
  });
  assert.equal(
    fs.readFileSync(outputPath, "utf8"),
    "allowed=false\nimmediate=true\nreason=cooldown\nwait_seconds=90\n",
  );
});

test("정책 파일이 없거나 손상되면 available=false로 읽는다", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "instant-latest-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let inputs = readPolicyInputs(directory);
  assert.equal(inputs.latest.available, false);
  assert.equal(inputs.safetyState.available, false);

  fs.mkdirSync(path.join(directory, "data"));
  fs.writeFileSync(path.join(directory, "data", "latest.json"), "{", "utf8");
  fs.writeFileSync(
    path.join(directory, "data", "instant-query-state.json"),
    JSON.stringify(safetyState()),
    "utf8",
  );
  inputs = readPolicyInputs(directory);
  assert.equal(inputs.latest.available, false);
  assert.equal(inputs.safetyState.available, true);
});
