"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectAllProperties,
  createLiveSource,
  isBlockedError,
  randomDelayMs,
} = require("../src/court-client");
const {
  enrichResidentialItems,
  reflectDetailBlock,
} = require("../src/index");
const { normalizeProperty } = require("../src/normalize");

function config(overrides = {}) {
  return {
    courtNameFragment: "홍성지원",
    pageSize: 100,
    maxListCalls: 10,
    maxDetailCalls: 5,
    minDelayMs: 3000,
    jitterMs: 2000,
    timeoutMs: 30000,
    retryDelayMs: 30000,
    ...overrides,
  };
}

function rawProperty(index) {
  return {
    caseNumber: `2025타경${100000 + index}`,
    itemNumber: "1",
    usage: "아파트",
    address: "충남 홍성군 홍성읍",
  };
}

test("요청 지연 난수는 3~5초 범위를 벗어나지 않는다", () => {
  assert.equal(randomDelayMs(3000, 2000, () => 0), 3000);
  assert.equal(randomDelayMs(3000, 2000, () => 0.999999), 5000);
});

test("일반 페이지 실패는 30초 후 정확히 한 번만 재시도한다", async () => {
  let pageTwoCalls = 0;
  const sleeps = [];
  const source = {
    async getCourtCodes() {
      return {
        items: [{ code: "B000281", name: "대전지방법원 홍성지원" }],
      };
    },
    async searchProperties({ page }) {
      if (page === 2 && pageTwoCalls++ === 0) {
        const error = new Error("temporary");
        error.code = "NETWORK_ERROR";
        throw error;
      }
      return {
        page: { totalCount: 101, pageSize: 100 },
        items:
          page === 1
            ? Array.from({ length: 100 }, (_, index) => rawProperty(index))
            : [rawProperty(100)],
      };
    },
  };
  const result = await collectAllProperties({
    source,
    config: config(),
    sleep: async (ms) => sleeps.push(ms),
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });

  assert.equal(pageTwoCalls, 2);
  assert.deepEqual(sleeps, [30000]);
  assert.equal(result.completeness.complete, true);
  assert.deepEqual(result.completeness.failedPages, []);
});

test("첫 페이지 HTTP 500 진단을 보존하고 한 번만 재시도한다", async () => {
  let searchCalls = 0;
  const sleeps = [];
  const source = {
    async getCourtCodes() {
      return {
        items: [{ code: "B000281", branchName: "홍성지원" }],
      };
    },
    async searchProperties() {
      searchCalls += 1;
      const error = new Error(
        "Court Auction request failed for /pgj/pgjsearch/searchControllerMain.on",
      );
      error.code = "UPSTREAM_ERROR";
      error.statusCode = 500;
      error.upstreamUrl =
        "https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on?token=do-not-store";
      error.upstreamMessage = "Temporary\nserver failure";
      throw error;
    },
  };
  const result = await collectAllProperties({
    source,
    config: config(),
    sleep: async (ms) => sleeps.push(ms),
    now: () => new Date("2026-07-17T00:00:00.000Z"),
  });

  assert.equal(searchCalls, 2);
  assert.deepEqual(sleeps, [30000]);
  assert.equal(result.completeness.complete, false);
  assert.equal(result.completeness.countsKnown, false);
  assert.equal(result.completeness.errorCode, "UPSTREAM_ERROR");
  assert.equal(result.completeness.errorStatusCode, 500);
  assert.equal(
    result.completeness.upstreamUrl,
    "/pgj/pgjsearch/searchControllerMain.on",
  );
  assert.equal(
    result.completeness.upstreamMessage,
    "Temporary server failure",
  );
});

test("HTTP 500은 브라우저 fallback으로 확대하지 않는다", async () => {
  let searchCalls = 0;
  let browserClients = 0;
  class HttpClient {}
  class BrowserClient {
    constructor() {
      browserClients += 1;
    }
    async warmup() {}
    async close() {}
  }
  const library = {
    CourtAuctionHttpClient: HttpClient,
    CourtAuctionPlaywrightClient: BrowserClient,
    async searchProperties() {
      searchCalls += 1;
      const error = new Error("upstream 500");
      error.code = "UPSTREAM_ERROR";
      error.statusCode = 500;
      throw error;
    },
  };
  const source = createLiveSource(config(), {
    library,
    pacer: {
      run: async (operation) => operation(),
      wait: async () => {},
    },
  });

  await assert.rejects(
    () =>
      source.searchProperties({
        courtCode: "B000281",
        usage: { large: "건물" },
        page: 1,
        pageSize: 100,
      }),
    (error) =>
      error.code === "UPSTREAM_ERROR" && error.statusCode === 500,
  );
  assert.equal(searchCalls, 1);
  assert.equal(browserClients, 0);
  await source.close();
});

test("일반 HTTP 400만 브라우저 fallback을 정확히 한 번 사용한다", async () => {
  let searchCalls = 0;
  let browserClients = 0;
  class HttpClient {}
  class BrowserClient {
    constructor() {
      browserClients += 1;
    }
    async warmup() {}
    async close() {}
  }
  const library = {
    CourtAuctionHttpClient: HttpClient,
    CourtAuctionPlaywrightClient: BrowserClient,
    async searchProperties({ client }) {
      searchCalls += 1;
      if (client instanceof BrowserClient) {
        return {
          page: { totalCount: 0, pageSize: 100 },
          items: [],
        };
      }
      const error = new Error("generic WAF 400");
      error.code = "UPSTREAM_ERROR";
      error.statusCode = 400;
      throw error;
    },
  };
  const source = createLiveSource(config(), {
    library,
    pacer: {
      run: async (operation) => operation(),
      wait: async () => {},
    },
  });

  const result = await source.searchProperties({
    courtCode: "B000281",
    usage: { large: "건물" },
    page: 1,
    pageSize: 100,
  });
  assert.equal(result._fetchMode, "playwright");
  assert.equal(searchCalls, 2);
  assert.equal(browserClients, 1);
  await source.close();
});

test("10페이지를 넘는 검색은 추가 호출 없이 incomplete가 된다", async () => {
  const calls = [];
  const source = {
    async getCourtCodes() {
      return {
        items: [{ code: "B000281", branchName: "홍성지원" }],
      };
    },
    async searchProperties({ page }) {
      calls.push(page);
      return {
        page: { totalCount: 1100, pageSize: 100 },
        items: Array.from({ length: 100 }, (_, index) =>
          rawProperty((page - 1) * 100 + index),
        ),
      };
    },
  };
  const result = await collectAllProperties({
    source,
    config: config(),
    sleep: async () => {},
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });

  assert.deepEqual(calls, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(result.completeness.complete, false);
  assert.equal(result.completeness.errorCode, "CALL_LIMIT");
  assert.equal(result.completeness.missingCount, 100);
});

test("목록에서 BLOCKED가 발생한 뒤 상세 조회를 시작하지 않는다", async () => {
  let detailCalls = 0;
  const result = await enrichResidentialItems({
    rawItems: [rawProperty(1)],
    source: {
      async getCaseByCaseNumber() {
        detailCalls += 1;
        throw new Error("must not be called");
      },
    },
    courtCode: "B000281",
    previousReport: null,
    generatedAt: "2026-07-16T00:00:00.000Z",
    maxDetailCalls: 5,
    detailsAllowed: false,
    listBlocked: true,
  });

  assert.equal(detailCalls, 0);
  assert.equal(result.detailSummary.blocked, false);
  assert.equal(result.detailSummary.pending, 1);
  assert.equal(result.items[0].detailStatus, "상세조회 중단·목록 차단");
});

test("상세조회 BLOCKED는 전체 보고서를 incomplete로 전환한다", () => {
  const completeness = {
    complete: true,
    blocked: false,
    errorCode: null,
    errorMessage: null,
  };
  reflectDetailBlock(completeness, { blocked: true });
  assert.equal(completeness.complete, false);
  assert.equal(completeness.blocked, true);
  assert.equal(completeness.errorCode, "BLOCKED");
});

test("목록이 불완전하면 차단으로 오인하지 않고 상세호출을 보류한다", async () => {
  let detailCalls = 0;
  const result = await enrichResidentialItems({
    rawItems: [rawProperty(2)],
    source: {
      async getCaseByCaseNumber() {
        detailCalls += 1;
      },
    },
    courtCode: "B000281",
    previousReport: null,
    generatedAt: "2026-07-16T00:00:00.000Z",
    maxDetailCalls: 5,
    detailsAllowed: false,
    listBlocked: false,
  });
  assert.equal(detailCalls, 0);
  assert.equal(result.detailSummary.blocked, false);
  assert.equal(result.detailSummary.pending, 1);
  assert.equal(result.items[0].detailStatus, "상세조회 보류·목록 불완전");
});

test("목록이 그대로인 물건은 전일 상세 필드를 잃지 않고 cache를 재사용한다", async () => {
  const raw = {
    ...rawProperty(3),
    usage: "",
    propertyDescription: "공동주택(아파트)",
  };
  const basic = normalizeProperty(raw, {
    generatedAt: "2026-07-15T00:00:00.000Z",
  });
  const previous = {
    ...basic,
    usage: "아파트",
    detailStatus: "상세조회 완료",
  };
  let detailCalls = 0;
  const result = await enrichResidentialItems({
    rawItems: [raw],
    source: {
      async getCaseByCaseNumber() {
        detailCalls += 1;
      },
    },
    courtCode: "B000281",
    previousReport: { items: [previous], reviewItems: [] },
    generatedAt: "2026-07-16T00:00:00.000Z",
    maxDetailCalls: 5,
    detailsAllowed: true,
  });

  assert.equal(detailCalls, 0);
  assert.equal(result.items[0].usage, "아파트");
  assert.equal(result.items[0].detailStatus, "전일 상세정보 재사용");
});

test("HTTP 400 본문이 ipcheck=false이면 browser fallback 없이 차단한다", async () => {
  const responses = [
    new Response("", { status: 200 }),
    Response.json({
      data: {
        result: [
          {
            cortOfcCd: "B000281",
            cortOfcNm: "대전지방법원 홍성지원",
            cortSptNm: "홍성지원",
          },
        ],
      },
    }),
    new Response("", { status: 200 }),
    Response.json(
      { data: { ipcheck: false }, message: "BLOCKED" },
      { status: 400 },
    ),
  ];
  let fetchCalls = 0;
  const source = createLiveSource(config(), {
    fetchImpl: async () => {
      const response = responses[fetchCalls];
      fetchCalls += 1;
      if (!response) throw new Error("unexpected fallback request");
      return response;
    },
    pacer: {
      run: async (operation) => operation(),
      wait: async () => {},
    },
  });

  const courts = await source.getCourtCodes();
  assert.equal(courts.items[0].code, "B000281");
  await assert.rejects(
    () =>
      source.searchProperties({
        courtCode: "B000281",
        usage: { large: "건물" },
        page: 1,
        pageSize: 100,
      }),
    (error) => isBlockedError(error),
  );
  assert.equal(fetchCalls, 4);
  await source.close();
});
