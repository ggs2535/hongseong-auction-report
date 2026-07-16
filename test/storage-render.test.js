"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REPORT_DATA_END,
  REPORT_DATA_START,
  buildClientPayload,
  createReportHtml,
  safeJson,
} = require("../src/render");
const { createConfig } = require("../src/config");
const { readJson, saveReport } = require("../src/storage");

function report(overrides = {}) {
  return {
    generatedAt: "2026-07-16T09:37:00.000Z",
    reportDate: "2026-07-16",
    source: { mode: "live" },
    completeness: {
      complete: true,
      totalCount: 1,
      fetchedUniqueCount: 1,
      missingCount: 0,
    },
    items: [{ id: "2025타경1-1", changeType: [] }],
    reviewItems: [],
    withdrawnItems: [],
    detailSummary: {},
    ...overrides,
  };
}

test("incomplete 실행은 latest/history만 쓰고 last-good bytes를 보존한다", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "auction-storage-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const complete = report();
  await saveReport(complete, {
    dataDir,
    timezone: "Asia/Seoul",
  });
  const lastGoodPath = path.join(dataDir, "last-good.json");
  const before = await fs.readFile(lastGoodPath);

  const incomplete = report({
    generatedAt: "2026-07-17T09:37:00.000Z",
    reportDate: "2026-07-17",
    completeness: {
      complete: false,
      countsKnown: false,
      totalCount: null,
      fetchedUniqueCount: 0,
      missingCount: null,
      blocked: true,
      errorCode: "BLOCKED",
    },
    items: [],
  });
  await saveReport(incomplete, {
    dataDir,
    timezone: "Asia/Seoul",
  });

  const after = await fs.readFile(lastGoodPath);
  assert.deepEqual(after, before);
  assert.equal((await readJson(path.join(dataDir, "latest.json"))).generatedAt, incomplete.generatedAt);
  assert.equal(
    (await readJson(path.join(dataDir, "history", "2026-07-17.json")))
      .completeness.complete,
    false,
  );
});

test("불완전 화면은 last-good 본문을 쓰되 정상 오프라인 cache를 덮지 않는다", () => {
  const lastGood = report({
    items: [{ id: "active", changeType: [] }],
    withdrawnItems: [{ id: "withdrawn", changeType: ["WITHDRAWN"] }],
    reviewItems: [{ item: { id: "review" }, reason: "수동확인 필요" }],
    detailSummary: { pending: 1 },
  });
  const latest = report({
    generatedAt: "2026-07-17T09:37:00.000Z",
    completeness: {
      complete: false,
      countsKnown: false,
      totalCount: null,
      fetchedUniqueCount: 0,
      missingCount: null,
      blocked: true,
    },
    items: [{ id: "partial" }],
  });

  const payload = buildClientPayload(latest, lastGood);
  assert.equal(payload.displaySource, "last-good");
  assert.equal(payload.cacheSafe, false);
  assert.deepEqual(
    payload.display.items.map(({ id }) => id),
    ["active", "withdrawn"],
  );
  assert.equal(payload.display.reviewItems[0].item.id, "review");
  assert.equal(payload.display.detailSummary.pending, 1);
});

test("완전한 live 보고서만 오프라인 cache 대상으로 표시한다", () => {
  assert.equal(buildClientPayload(report(), report()).cacheSafe, true);
  assert.equal(
    buildClientPayload(
      report({ source: { mode: "fixture" } }),
      report({ source: { mode: "fixture" } }),
    ).cacheSafe,
    false,
  );
});

test("내장 JSON은 script 종료 문자열을 실행 가능한 HTML로 만들지 않는다", () => {
  const dangerous = "</script><script>alert('xss')</script>";
  assert.doesNotMatch(safeJson({ dangerous }), /<\/script>/iu);

  const template = `${REPORT_DATA_START}\nold\n${REPORT_DATA_END}`;
  const html = createReportHtml(
    template,
    report({ items: [{ id: dangerous }] }),
    null,
  );
  assert.match(html, /id="report-data"/u);
  assert.doesNotMatch(html, /<script>alert/u);
});

test("fixture 기본 출력은 live data/public과 격리된다", () => {
  const rootDir = path.resolve(os.tmpdir(), "auction-config-root");
  const fixture = createConfig({
    rootDir,
    mode: "fixture",
    env: {},
    argv: [],
  });
  const live = createConfig({
    rootDir,
    mode: "live",
    env: {},
    argv: [],
  });

  assert.equal(fixture.dataDir, path.join(rootDir, ".fixture-output", "data"));
  assert.equal(fixture.publicDir, path.join(rootDir, ".fixture-output", "public"));
  assert.equal(live.dataDir, path.join(rootDir, "data"));
  assert.equal(live.publicDir, path.join(rootDir, "public"));
});
