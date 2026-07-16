"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyDiff,
  calculatePriceRatio,
  compareItem,
  updateWithdrawalState,
} = require("../src/diff");

function item(overrides = {}) {
  return {
    id: "2025타경12001-1",
    caseNumber: "2025타경12001",
    itemNumber: "1",
    usage: "아파트",
    address: "충남 홍성군 홍성읍 법원로 10",
    appraisedPrice: 300000000,
    minimumSalePrice: 210000000,
    failedBidCount: 1,
    saleDate: "2026-08-18",
    status: "매각진행",
    remarks: [],
    remarksEvidence: [],
    documentVerification: {},
    ...overrides,
  };
}

test("최저가 비율은 소수 첫째 자리까지 계산하고 감정가가 없으면 null이다", () => {
  assert.equal(calculatePriceRatio(210000000, 300000000), 70);
  assert.equal(calculatePriceRatio("123,456", "300,000"), 41.2);
  assert.equal(calculatePriceRatio(1, 3), 33.3);
  assert.equal(calculatePriceRatio(100, 0), null);
  assert.equal(calculatePriceRatio(100, null), null);
});

test("유찰 횟수가 늘어난 경우 FAILED_BID_INCREMENT를 표시한다", () => {
  const previous = item({ failedBidCount: 1 });
  const current = item({ failedBidCount: 2 });
  assert.deepEqual(compareItem(current, previous), ["FAILED_BID_INCREMENT"]);
});

test("불완전 조회에서는 사라진 물건을 취하 후보나 WITHDRAWN으로 만들지 않는다", () => {
  const previousItem = item();
  const result = updateWithdrawalState({
    currentSourceIds: [],
    previousReport: {
      generatedAt: "2026-07-14T00:00:00.000Z",
      items: [previousItem],
      withdrawalCandidates: {},
    },
    complete: false,
    generatedAt: "2026-07-15T00:00:00.000Z",
  });

  assert.deepEqual(result.withdrawalCandidates, {});
  assert.deepEqual(result.withdrawnItems, []);
  assert.equal(result.restartedPreviousItems.size, 0);
});

test("두 번 연속 complete 조회에서 사라져야 WITHDRAWN으로 확정한다", () => {
  const previousItem = item();
  const firstMiss = updateWithdrawalState({
    currentSourceIds: [],
    previousReport: {
      generatedAt: "2026-07-13T00:00:00.000Z",
      items: [previousItem],
      withdrawalCandidates: {},
    },
    complete: true,
    generatedAt: "2026-07-14T00:00:00.000Z",
  });

  assert.equal(
    firstMiss.withdrawalCandidates[previousItem.id].consecutiveCompleteMisses,
    1,
  );
  assert.equal(firstMiss.withdrawnItems.length, 0);

  const secondMiss = updateWithdrawalState({
    currentSourceIds: [],
    previousReport: {
      generatedAt: "2026-07-13T00:00:00.000Z",
      items: [previousItem],
      withdrawalCandidates: firstMiss.withdrawalCandidates,
    },
    complete: true,
    generatedAt: "2026-07-15T00:00:00.000Z",
  });

  assert.equal(
    secondMiss.withdrawalCandidates[previousItem.id].consecutiveCompleteMisses,
    2,
  );
  assert.equal(secondMiss.withdrawalCandidates[previousItem.id].confirmed, true);
  assert.deepEqual(secondMiss.withdrawnItems, [
    {
      ...previousItem,
      changeType: ["WITHDRAWN"],
      withdrawn: true,
      withdrawnAt: "2026-07-15T00:00:00.000Z",
    },
  ]);
});

test("취하 후보가 원본 검색에 다시 보이면 RESTARTED로 표시한다", () => {
  const candidate = item({ status: "기일변경" });
  const current = item({ status: "매각진행" });
  const previousReport = {
    items: [],
    withdrawalCandidates: {
      [candidate.id]: {
        item: candidate,
        consecutiveCompleteMisses: 1,
        confirmed: false,
      },
    },
  };
  const withdrawal = updateWithdrawalState({
    currentSourceIds: [current.id],
    previousReport,
    complete: true,
    generatedAt: "2026-07-16T00:00:00.000Z",
  });
  const [changed] = applyDiff([current], previousReport, withdrawal);

  assert.equal(withdrawal.withdrawalCandidates[candidate.id], undefined);
  assert.deepEqual(withdrawal.restartedPreviousItems.get(candidate.id), candidate);
  assert.ok(changed.changeType.includes("STATUS_CHANGED"));
  assert.ok(changed.changeType.includes("RESTARTED"));
});

test("주거 필터 결과가 아니라 원본 검색에 ID가 있으면 취하 후보가 아니다", () => {
  const previousItem = item();
  const result = updateWithdrawalState({
    // 오늘 분류가 review/excluded로 바뀌어 report.items에 없어도 원본에는 존재한다.
    currentSourceIds: [previousItem.id],
    previousReport: {
      generatedAt: "2026-07-15T00:00:00.000Z",
      items: [previousItem],
      withdrawalCandidates: {},
    },
    complete: true,
    generatedAt: "2026-07-16T00:00:00.000Z",
  });

  assert.deepEqual(result.withdrawalCandidates, {});
  assert.deepEqual(result.withdrawnItems, []);
});
