"use strict";

const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertNotBlocked,
  blockedPayload,
  collectAllProperties,
  createFixtureSource,
  isBlockedError,
} = require("../src/court-client");
const {
  extractCaseRawForItem,
  findMatchingCaseItem,
  mergeCaseDetail,
  normalizeProperty,
} = require("../src/normalize");
const { filterResidential } = require("../src/residential-filter");
const {
  extractSpecialRemarks,
  unverifiedDocumentStatus,
} = require("../src/special-remarks");

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

function fixtureConfig() {
  return {
    fixturesDir: FIXTURES_DIR,
    courtNameFragment: "홍성지원",
    pageSize: 100,
    maxListCalls: 10,
    retryDelayMs: 0,
  };
}

test("특이사항은 원문 근거의 필드명과 문장을 함께 보존할 때만 생성한다", () => {
  const source = {
    remarks: "유치권 신고가 있으므로 현황을 확인할 것",
    raw: {
      printSt: "법정지상권 성립 여부는 불분명함",
      unrelated: "특별한 내용 없음",
    },
  };
  const result = extractSpecialRemarks(source);

  assert.deepEqual(result.remarks, ["유치권", "법정지상권"]);
  assert.deepEqual(result.remarksEvidence, [
    {
      keyword: "유치권",
      field: "remarks",
      sourceText: "유치권 신고가 있으므로 현황을 확인할 것",
    },
    {
      keyword: "법정지상권",
      field: "raw.printSt",
      sourceText: "법정지상권 성립 여부는 불분명함",
    },
  ]);
  for (const remark of result.remarks) {
    assert.ok(
      result.remarksEvidence.some(
        ({ keyword, field, sourceText }) =>
          keyword === remark && field.length > 0 && sourceText.includes(remark),
      ),
    );
  }

  assert.deepEqual(extractSpecialRemarks({ remarks: "특이사항 없음" }), {
    remarks: [],
    remarksEvidence: [],
  });
});

test("정규화 결과는 가격비율·원문 특이사항 근거·미검증 문서 상태를 갖는다", () => {
  const normalized = normalizeProperty(
    {
      caseNumber: "2025타경13001",
      itemNumber: "1",
      usage: "아파트",
      address: "충남 홍성군 홍성읍",
      appraisedPrice: "300,000,000원",
      minimumSalePrice: "210,000,000원",
      flbdCount: "2회",
      saleDate: "2026.08.18",
      progressStatusName: "매각진행",
      raw: {
        printSt: "별도등기 있음",
      },
    },
    { generatedAt: "2026-07-16T00:00:00.000Z" },
  );

  assert.equal(normalized.id, "2025타경13001-1");
  assert.equal(normalized.priceRatio, 70);
  assert.equal(normalized.failedBidCount, 2);
  assert.equal(normalized.saleDate, "2026-08-18");
  assert.deepEqual(normalized.remarks, ["별도등기"]);
  assert.deepEqual(normalized.remarksEvidence, [
    {
      keyword: "별도등기",
      field: "raw.printSt",
      sourceText: "별도등기 있음",
    },
  ]);
  assert.deepEqual(normalized.documentVerification, unverifiedDocumentStatus());
});

test("fixture 한 페이지는 중복을 제거한 뒤 missingCount 0인 complete 조회다", async () => {
  const config = fixtureConfig();
  const source = createFixtureSource(config);
  const result = await collectAllProperties({
    source,
    config,
    sleep: async () => {},
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });

  assert.equal(result.court.code, "B000281");
  assert.match(result.court.code, /^B\d{6}$/u);
  assert.equal(result.completeness.totalCount, 7);
  assert.equal(result.completeness.expectedPages, 1);
  assert.equal(result.completeness.fetchedPages, 1);
  assert.equal(result.completeness.fetchedRawCount, 8);
  assert.equal(result.completeness.fetchedUniqueCount, 7);
  assert.equal(result.completeness.missingCount, 0);
  assert.equal(result.completeness.complete, true);

  const classified = filterResidential(result.items);
  assert.deepEqual(
    classified.included.map(({ caseNumber, region }) => ({ caseNumber, region })),
    [
      { caseNumber: "2025타경10001", region: "홍성군" },
      { caseNumber: "2025타경10002", region: "예산군" },
    ],
  );
  assert.deepEqual(
    classified.reviewItems.map(({ item, reasonCode }) => ({
      caseNumber: item.caseNumber,
      reasonCode,
    })),
    [
      { caseNumber: "2025타경10003", reasonCode: "MIXED_USE" },
      { caseNumber: "2025타경10005", reasonCode: "ADDRESS_UNDETERMINED" },
      { caseNumber: "2025타경10007", reasonCode: "MIXED_USE" },
    ],
  );
  assert.deepEqual(
    classified.excluded.map(({ item, reasonCode }) => ({
      caseNumber: item.caseNumber,
      reasonCode,
    })),
    [
      { caseNumber: "2025타경10004", reasonCode: "OUTSIDE_REGION" },
      { caseNumber: "2025타경10006", reasonCode: "NON_RESIDENTIAL" },
    ],
  );

  const caseDetail = await source.getCaseByCaseNumber({
    courtCode: result.court.code,
    caseNumber: "2025타경10001",
  });
  const listItem = result.items.find(
    ({ caseNumber }) => caseNumber === "2025타경10001",
  );
  const merged = mergeCaseDetail(listItem, caseDetail);
  assert.equal(merged.raw.list.csNo, "2025타경10001");
  assert.equal(merged.raw.case.printSt.includes("대항력"), true);
  assert.equal(merged.raw.caseInfo.courtCode, "B000281");
});

test("BLOCKED/ipcheck=false 응답이면 재시도나 브라우저 우회 없이 즉시 중단한다", async () => {
  let searchCalls = 0;
  let sleeps = 0;
  const payload = {
    data: {
      ipcheck: false,
    },
  };
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
    async searchProperties() {
      searchCalls += 1;
      const error = new Error("upstream denied the request");
      error.data = payload;
      throw error;
    },
  };

  assert.equal(blockedPayload(payload), true);
  assert.throws(
    () => assertNotBlocked(payload),
    (error) => error.code === "BLOCKED" && isBlockedError(error),
  );

  const result = await collectAllProperties({
    source,
    config: fixtureConfig(),
    sleep: async () => {
      sleeps += 1;
    },
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });

  assert.equal(searchCalls, 1);
  assert.equal(sleeps, 0);
  assert.equal(result.completeness.complete, false);
  assert.equal(result.completeness.blocked, true);
  assert.equal(result.completeness.errorCode, "BLOCKED");
  assert.equal(result.completeness.fetchedPages, 0);
});

test("사건 raw 보충은 해당 물건 행만 선택해 다른 물건 근거를 섞지 않는다", () => {
  const raw = {
    data: {
      dma_csBasInf: {
        csNo: "2025타경14001",
        csProgStatCd: "진행",
      },
      dlt_rletCsDspslObjctLst: [
        { dspslObjctSeq: "1", note: "일반 물건" },
        { dspslObjctSeq: "2", note: "유치권 신고 물건" },
      ],
      dlt_rletCsGdsDtsDxdyInf: [
        { dspslGdsSeq: "1", dspslDxdyYmd: "20260818" },
        { dspslGdsSeq: "2", dspslDxdyYmd: "20260825" },
      ],
      dlt_rletCsIntrpsLst: [{ kind: "임차인", name: "공개대상아님" }],
    },
  };
  const scoped = extractCaseRawForItem(raw, "1");
  assert.equal(scoped.itemRows.length, 1);
  assert.equal(scoped.itemRows[0].note, "일반 물건");
  assert.equal(scoped.scheduleRows.length, 1);
  assert.equal(scoped.scheduleRows[0].dspslGdsSeq, "1");
  assert.equal(JSON.stringify(scoped).includes("유치권"), false);
  assert.equal(JSON.stringify(scoped).includes("공개대상아님"), false);
});

test("상세 응답에 물건번호가 일치하지 않으면 첫 물건을 대신 쓰지 않는다", () => {
  const response = {
    items: [
      { itemSeq: "1", address: "첫 번째 물건" },
      { itemSeq: "3", address: "세 번째 물건" },
    ],
  };
  assert.equal(findMatchingCaseItem(response, "2"), null);
  assert.equal(findMatchingCaseItem(response, "3").address, "세 번째 물건");
});
