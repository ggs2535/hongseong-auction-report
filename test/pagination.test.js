"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPropertySearchBody,
} = require("court-auction-notice-search");

const {
  calculateMissingCount,
  calculateTotalPages,
  deduplicateProperties,
  getPropertyId,
  mergePageResults,
  pageNumbers,
} = require("../src/pagination");
const { collectAllProperties } = require("../src/court-client");

function property(index) {
  return {
    caseNumber: `2025타경${String(10000 + index)}`,
    itemNumber: "1",
  };
}

test("전체 건수와 pageSize로 마지막의 작은 페이지까지 계산한다", () => {
  assert.equal(calculateTotalPages(0, 100), 0);
  assert.equal(calculateTotalPages(100, 100), 1);
  assert.equal(calculateTotalPages(101, 100), 2);
  assert.equal(calculateTotalPages(201, 100), 3);
  assert.deepEqual(pageNumbers(201, 100), [1, 2, 3]);
  assert.throws(() => calculateTotalPages(1, 0), /positive integer/);
});

test("101건이면 100건 페이지와 1건 페이지를 모두 순차 조회한다", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => property(index + 1));
  const lastPage = [property(101)];
  const calls = [];
  const source = {
    async getCourtCodes() {
      return {
        items: [
          {
            code: "B000281",
            name: "대전지방법원 홍성지원",
            branchName: "홍성지원",
          },
        ],
      };
    },
    async searchProperties(params) {
      calls.push(params);
      return {
        page: { totalCount: 101, pageSize: 100 },
        items: params.page === 1 ? firstPage : lastPage,
        _fetchMode: "http",
      };
    },
  };

  const result = await collectAllProperties({
    source,
    config: {
      courtNameFragment: "홍성지원",
      pageSize: 100,
      maxListCalls: 10,
      retryDelayMs: 0,
    },
    sleep: async () => {
      assert.fail("성공한 페이지 사이에 재시도 대기가 호출되면 안 됩니다.");
    },
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });

  assert.deepEqual(
    calls.map(({ page }) => page),
    [1, 2],
  );
  assert.equal(calls[0].usage.large, "건물");
  assert.equal(calls[0].courtName, "홍성지원");
  assert.equal(calls[0].pageSize, 100);
  assert.deepEqual(calls[0].saleDate, {
    from: "20260716",
    to: "20260730",
  });
  assert.deepEqual(calls[1].saleDate, calls[0].saleDate);
  const requestBody = buildPropertySearchBody(calls[0]);
  assert.equal(
    requestBody.dma_srchGdsDtlSrchInfo.bidBgngYmd,
    "20260716",
  );
  assert.equal(
    requestBody.dma_srchGdsDtlSrchInfo.bidEndYmd,
    "20260730",
  );
  assert.equal(requestBody.dma_srchGdsDtlSrchInfo.bidDvsCd, "");
  assert.equal(calls[0].includeRaw, true);
  assert.equal(calls[0].fallbackOnBlocked, false);
  assert.equal(result.items.length, 101);
  assert.equal(result.completeness.expectedPages, 2);
  assert.equal(result.completeness.fetchedPages, 2);
  assert.equal(result.completeness.missingCount, 0);
  assert.equal(result.completeness.complete, true);
});

test("사건번호와 물건번호가 같은 행은 여러 페이지에 있어도 한 번만 남긴다", () => {
  const first = {
    caseNumber: "2025타경10123",
    itemNumber: "1",
    marker: "first",
  };
  const duplicate = {
    displayCaseNumber: " 2025타경10123 ",
    itemSeq: " 1 ",
    marker: "duplicate",
  };
  const other = {
    caseNumber: "2025타경10123",
    itemNumber: "2",
    marker: "other",
  };

  assert.equal(getPropertyId(first), "2025타경10123-1");
  assert.equal(getPropertyId(duplicate), "2025타경10123-1");

  const direct = deduplicateProperties([first, duplicate, other]);
  assert.equal(direct.duplicateCount, 1);
  assert.deepEqual(direct.items, [first, other]);

  const merged = mergePageResults([
    { items: [first] },
    { items: [duplicate, other] },
  ]);
  assert.equal(merged.fetchedRawCount, 3);
  assert.equal(merged.fetchedUniqueCount, 2);
  assert.equal(merged.duplicateCount, 1);
  assert.equal(merged.items[0].marker, "first");
  assert.equal(calculateMissingCount(2, merged.fetchedUniqueCount), 0);
});
