"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const courtLibrary = require("court-auction-notice-search");

const {
  collectAllProperties,
  createLiveSource,
} = require("../src/court-client");
const {
  PROPERTY_SEARCH_PATH,
  submitPropertySearchUi,
  submitPropertySearchUiPage,
  submitPropertySearchUiPageSize,
} = require("../src/court-ui-search");

function searchParams(page = 1, pageSize = 100) {
  return {
    courtCode: "B000281",
    usage: { large: "건물" },
    page,
    pageSize,
    saleDate: { from: "20260717", to: "20260731" },
    includeRaw: true,
    fallback: false,
    fallbackOnBlocked: false,
  };
}

function fakeUiPage({
  body,
  payload = { data: {} },
  rawText,
  responses,
  status = 200,
}) {
  const operations = [];
  let bidAllChecked = false;
  const responseSpecs = responses || [{ body, payload, rawText, status }];
  let responseIndex = 0;
  const page = {
    async waitForFunction() {
      operations.push(["waitForFunction"]);
    },
    locator(selector) {
      return {
        async allTextContents() {
          operations.push(["allTextContents", selector]);
          return ["전체", "홍성지원"];
        },
        async waitFor(options) {
          operations.push(["waitFor", selector, options.state]);
        },
        async selectOption(option) {
          operations.push(["selectOption", selector, option.label]);
        },
        async isChecked() {
          operations.push(["isChecked", selector]);
          return bidAllChecked;
        },
        async check() {
          throw new Error(`input check must not be used: ${selector}`);
        },
        async inputValue() {
          operations.push(["inputValue", selector]);
          return "2026.01.01";
        },
        async fill(value) {
          operations.push(["fill", selector, value]);
        },
        async press(key) {
          operations.push(["press", selector, key]);
        },
        async click() {
          operations.push(["click", selector]);
          if (
            selector ===
            'label[for="mf_wfm_mainFrame_rad_mvprpBidLst_input_2"]'
          ) {
            bidAllChecked = true;
          }
        },
      };
    },
    async waitForResponse(predicate) {
      operations.push(["waitForResponse"]);
      const spec =
        responseSpecs[Math.min(responseIndex, responseSpecs.length - 1)];
      responseIndex += 1;
      const responsePayload =
        spec.payload || {
          data: {
            dma_pageInfo: {
              pageNo: spec.body.dma_pageInfo.pageNo,
              pageSize: spec.body.dma_pageInfo.pageSize,
              totalCnt: spec.totalCount ?? 0,
              totalYn: "Y",
            },
            dlt_srchResult: [],
          },
        };
      const response = {
        status: () => spec.status ?? 200,
        url: () => `https://www.courtauction.go.kr${PROPERTY_SEARCH_PATH}`,
        request: () => ({
          method: () => "POST",
          postDataJSON: () => spec.body,
        }),
        text: async () => spec.rawText ?? JSON.stringify(responsePayload),
      };
      assert.equal(predicate(response), true);
      return response;
    },
  };
  return { page, operations };
}

test("UI fallback submits the official WebSquare search form", async () => {
  const submittedBody = courtLibrary.buildPropertySearchBody(
    searchParams(1, 10),
  );
  const payload = { data: { result: [], pageInfo: { totalCount: 0 } } };
  const { page, operations } = fakeUiPage({ body: submittedBody, payload });

  const result = await submitPropertySearchUi(page, {
    courtName: "홍성지원",
    courtCode: "B000281",
    usageLarge: "건물",
    saleDate: searchParams().saleDate,
    timeoutMs: 1000,
  });

  assert.deepEqual(result.payload, payload);
  assert.equal(result.requestBody.dma_pageInfo.pageSize, 10);
  assert.ok(
    operations.some(
      ([operation, , value]) =>
        operation === "selectOption" && value === "홍성지원",
    ),
  );
  assert.ok(
    operations.some(
      ([operation, , value]) => operation === "selectOption" && value === "건물",
    ),
  );
  assert.ok(
    operations.some(
      ([operation, , value]) => operation === "fill" && value === "2026.07.17",
    ),
  );
  assert.ok(
    operations.some(
      ([operation, , value]) => operation === "fill" && value === "2026.07.31",
    ),
  );
  assert.deepEqual(
    operations.filter(([operation]) => operation === "click"),
    [
      [
        "click",
        'label[for="mf_wfm_mainFrame_rad_mvprpBidLst_input_2"]',
      ],
      ["click", "#mf_wfm_mainFrame_btn_gdsDtlSrch"],
    ],
  );
  assert.equal(
    operations.filter(
      ([operation, selector]) =>
        operation === "isChecked" &&
        selector === "#mf_wfm_mainFrame_rad_mvprpBidLst_input_2",
    ).length,
    2,
  );
});

test("UI fallback fails closed when WebSquare submits a different contract", async () => {
  const submittedBody = courtLibrary.buildPropertySearchBody(searchParams());
  submittedBody.dma_srchGdsDtlSrchInfo.cortOfcCd = "B000999";
  const { page } = fakeUiPage({ body: submittedBody });

  await assert.rejects(
    () =>
      submitPropertySearchUi(page, {
        courtName: "홍성지원",
        courtCode: "B000281",
        usageLarge: "건물",
        saleDate: searchParams().saleDate,
        timeoutMs: 1000,
      }),
    (error) => error.code === "UI_CONTRACT_MISMATCH",
  );
});

test("UI fallback treats a non-JSON ipcheck response as BLOCKED", async () => {
  const submittedBody = courtLibrary.buildPropertySearchBody(
    searchParams(1, 10),
  );
  const { page } = fakeUiPage({
    body: submittedBody,
    rawText: "request rejected: ipcheck=false",
    status: 400,
  });

  await assert.rejects(
    () =>
      submitPropertySearchUi(page, {
        courtName: "홍성지원",
        courtCode: "B000281",
        usageLarge: "건물",
        saleDate: searchParams().saleDate,
        timeoutMs: 1000,
      }),
    (error) => error.code === "BLOCKED" && error.statusCode === 400,
  );
});

test("UI fallback preserves a non-JSON HTTP status", async () => {
  const submittedBody = courtLibrary.buildPropertySearchBody(
    searchParams(1, 10),
  );
  const { page } = fakeUiPage({
    body: submittedBody,
    rawText: "<html><body>service unavailable</body></html>",
    status: 500,
  });

  await assert.rejects(
    () =>
      submitPropertySearchUi(page, {
        courtName: "홍성지원",
        courtCode: "B000281",
        usageLarge: "건물",
        saleDate: searchParams().saleDate,
        timeoutMs: 1000,
      }),
    (error) =>
      error.code === "UPSTREAM_ERROR" &&
      error.statusCode === 500 &&
      error.upstreamUrl === PROPERTY_SEARCH_PATH,
  );
});

test("UI pagination clicks the requested official page link", async () => {
  const pageOneBody = courtLibrary.buildPropertySearchBody(
    searchParams(1, 10),
  );
  const pageTwoBody = courtLibrary.buildPropertySearchBody(
    searchParams(2, 10),
  );
  const { page, operations } = fakeUiPage({ body: pageTwoBody });

  const result = await submitPropertySearchUiPage(
    page,
    2,
    1000,
    pageOneBody,
  );

  assert.equal(result.requestBody.dma_pageInfo.pageNo, 2);
  assert.ok(
    operations.some(
      ([operation, selector]) =>
        operation === "click" && selector.endsWith("_page_2"),
    ),
  );
});

test("UI pagination fails closed if the 40-item page size is lost", async () => {
  const pageOneBody = courtLibrary.buildPropertySearchBody(
    searchParams(1, 10),
  );
  pageOneBody.dma_pageInfo.pageSize = 40;
  const pageTwoBody = courtLibrary.buildPropertySearchBody(
    searchParams(2, 10),
  );
  const { page } = fakeUiPage({ body: pageTwoBody });

  await assert.rejects(
    () => submitPropertySearchUiPage(page, 2, 1000, pageOneBody),
    (error) => error.code === "UI_CONTRACT_MISMATCH",
  );
});

test("UI pagination fails closed if a search filter changes", async () => {
  const pageOneBody = courtLibrary.buildPropertySearchBody(
    searchParams(1, 10),
  );
  pageOneBody.dma_pageInfo.pageSize = 40;
  const pageTwoBody = courtLibrary.buildPropertySearchBody(
    searchParams(2, 10),
  );
  pageTwoBody.dma_pageInfo.pageSize = 40;
  pageTwoBody.dma_srchGdsDtlSrchInfo.cortOfcCd = "B000999";
  const { page } = fakeUiPage({ body: pageTwoBody });

  await assert.rejects(
    () => submitPropertySearchUiPage(page, 2, 1000, pageOneBody),
    (error) =>
      error.code === "UI_CONTRACT_MISMATCH" &&
      error.message.includes("cortOfcCd"),
  );
});

test("UI page size change requests 40 items on the first page", async () => {
  const resizedBody = courtLibrary.buildPropertySearchBody(
    searchParams(1, 10),
  );
  resizedBody.dma_pageInfo.pageSize = 40;
  const { page, operations } = fakeUiPage({ body: resizedBody });

  const result = await submitPropertySearchUiPageSize(page, {
    courtCode: "B000281",
    usageLarge: "건물",
    saleDate: searchParams().saleDate,
    pageSize: 40,
    timeoutMs: 1000,
  });

  assert.equal(result.requestBody.dma_pageInfo.pageNo, 1);
  assert.equal(result.requestBody.dma_pageInfo.pageSize, 40);
  assert.ok(
    operations.some(
      ([operation, selector, value]) =>
        operation === "selectOption" &&
        selector === "#mf_wfm_mainFrame_sbx_pageSize" &&
        value === "40",
    ),
  );
});

test("UI contract mismatch is not retried", async () => {
  let searchCalls = 0;
  let sleeps = 0;
  const result = await collectAllProperties({
    source: {
      async getCourtCodes() {
        return {
          items: [{ code: "B000281", branchName: "홍성지원" }],
        };
      },
      async searchProperties() {
        searchCalls += 1;
        const error = new Error("UI contract changed");
        error.code = "UI_CONTRACT_MISMATCH";
        throw error;
      },
    },
    config: {
      courtNameFragment: "홍성지원",
      pageSize: 100,
      maxListCalls: 10,
      retryDelayMs: 30000,
      timezone: "Asia/Seoul",
    },
    sleep: async () => {
      sleeps += 1;
    },
    now: () => new Date("2026-07-17T00:00:00.000Z"),
  });

  assert.equal(searchCalls, 1);
  assert.equal(sleeps, 0);
  assert.equal(result.completeness.errorCode, "UI_CONTRACT_MISMATCH");
});

test("live source initializes the UI once and reuses that browser session", async () => {
  const pageOneBody = courtLibrary.buildPropertySearchBody(
    searchParams(1, 10),
  );
  const pageOneLargeBody = courtLibrary.buildPropertySearchBody(
    searchParams(1, 10),
  );
  pageOneLargeBody.dma_pageInfo.pageSize = 40;
  const pageTwoBody = courtLibrary.buildPropertySearchBody(
    searchParams(2, 10),
  );
  pageTwoBody.dma_pageInfo.pageSize = 40;
  const pageThreeBody = courtLibrary.buildPropertySearchBody(
    searchParams(3, 10),
  );
  pageThreeBody.dma_pageInfo.pageSize = 40;
  const pageFourBody = courtLibrary.buildPropertySearchBody(
    searchParams(4, 10),
  );
  pageFourBody.dma_pageInfo.pageSize = 40;
  const { page, operations } = fakeUiPage({
    responses: [
      { body: pageOneBody, totalCount: 148 },
      { body: pageOneLargeBody, totalCount: 148 },
      { body: pageTwoBody, totalCount: 148 },
      { body: pageThreeBody, totalCount: 148 },
      { body: pageFourBody, totalCount: 148 },
      { body: pageOneBody, totalCount: 5 },
    ],
  });
  let httpSearchCalls = 0;
  let browserPostCalls = 0;
  let browserClients = 0;

  class HttpClient {
    async postJson() {
      httpSearchCalls += 1;
      const error = new Error("generic 400");
      error.code = "UPSTREAM_ERROR";
      error.statusCode = 400;
      throw error;
    }
  }
  class BrowserClient {
    constructor() {
      browserClients += 1;
      this.page = page;
    }
    async warmup() {}
    async postJson(endpoint, body) {
      browserPostCalls += 1;
      throw new Error(`synthetic browser POST is forbidden: ${endpoint} ${body}`);
    }
    async close() {}
  }

  const library = {
    ...courtLibrary,
    CourtAuctionHttpClient: HttpClient,
    CourtAuctionPlaywrightClient: BrowserClient,
  };
  const source = createLiveSource(
    {
      courtNameFragment: "홍성지원",
      minDelayMs: 3000,
      jitterMs: 2000,
      timeoutMs: 30000,
      maxListCalls: 10,
      maxDetailCalls: 5,
    },
    {
      library,
      pacer: {
        run: async (operation) => operation(),
        wait: async () => {},
      },
    },
  );

  const first = await source.searchProperties(searchParams(1));
  assert.equal(first.page.pageSize, 40);
  assert.equal(source.listTransportCalls, 3);
  const second = await source.searchProperties(searchParams(2));
  const third = await source.searchProperties(searchParams(3));
  const fourth = await source.searchProperties(searchParams(4));

  assert.equal(first._fetchMode, "playwright");
  assert.equal(second._fetchMode, "playwright");
  assert.equal(third._fetchMode, "playwright");
  assert.equal(fourth._fetchMode, "playwright");
  assert.equal(httpSearchCalls, 1);
  assert.equal(second.page.pageSize, 40);
  assert.equal(browserPostCalls, 0);
  assert.equal(source.listTransportCalls, 6);
  assert.equal(
    operations.filter(
      ([operation, selector]) =>
        operation === "click" &&
        selector === "#mf_wfm_mainFrame_btn_gdsDtlSrch",
    ).length,
    1,
  );
  assert.equal(
    operations.filter(
      ([operation, selector]) =>
        operation === "click" && selector.endsWith("_page_2"),
    ).length,
    1,
  );
  assert.equal(
    operations.filter(
      ([operation, selector]) =>
        operation === "click" &&
        (selector.endsWith("_page_3") || selector.endsWith("_page_4")),
    ).length,
    2,
  );
  await source.close();

  const afterClose = await source.searchProperties(searchParams(1));
  assert.equal(afterClose._fetchMode, "playwright");
  assert.equal(afterClose.page.pageSize, 10);
  assert.equal(httpSearchCalls, 2);
  assert.equal(browserClients, 2);
  assert.equal(browserPostCalls, 0);
  assert.equal(source.listTransportCalls, 8);
  assert.equal(
    operations.filter(
      ([operation, selector]) =>
        operation === "click" &&
        selector === "#mf_wfm_mainFrame_btn_gdsDtlSrch",
    ).length,
    2,
  );
  assert.equal(
    operations.filter(
      ([operation, selector, value]) =>
        operation === "selectOption" &&
        selector === "#mf_wfm_mainFrame_sbx_pageSize" &&
        value === "40",
    ).length,
    1,
  );
  await source.close();
});
