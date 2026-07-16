"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSummary } = require("../src/actions-summary");

test("Actions 요약은 원본 HTTP 상태와 경로를 보존한다", () => {
  const summary = createSummary({
    latest: {
      completeness: {
        complete: false,
        blocked: false,
        errorCode: "UPSTREAM_ERROR",
        errorStatusCode: 500,
        upstreamUrl: "/pgj/pgjsearch/searchControllerMain.on",
        upstreamMessage: "Temporary server failure",
        errorMessage: "Court Auction request failed",
        totalCount: null,
        fetchedPages: 0,
        expectedPages: 0,
        fetchedUniqueCount: 0,
        missingCount: null,
      },
    },
    lastGood: null,
    testOutcome: "success",
    outcome: "success",
    logTail: "",
  });

  assert.match(summary, /\| HTTP 상태 \| 500 \|/u);
  assert.match(
    summary,
    /\| 원본 경로 \| \/pgj\/pgjsearch\/searchControllerMain\.on \|/u,
  );
  assert.match(summary, /\| 원본 오류 \| Temporary server failure \|/u);
});
