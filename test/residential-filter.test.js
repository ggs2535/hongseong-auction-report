"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyProperty,
  determineRegion,
  filterResidential,
  findUsageKeywords,
  hasStandaloneLandToken,
} = require("../src/residential-filter");

test("충청남도·충남 표기 모두에서 홍성군과 예산군 주거 물건을 포함한다", () => {
  const items = [
    {
      id: "2025타경11001-1",
      address: "충청남도 홍성군 홍성읍 법원로 10",
      usage: "아파트",
    },
    {
      id: "2025타경11002-1",
      address: "충남 예산군 예산읍 아리랑로 25",
      propertyDescription: "단독주택",
    },
  ];

  const result = filterResidential(items);
  assert.deepEqual(
    result.included.map(({ id, region }) => ({ id, region })),
    [
      { id: "2025타경11001-1", region: "홍성군" },
      { id: "2025타경11002-1", region: "예산군" },
    ],
  );
  assert.equal(result.reviewItems.length, 0);
  assert.equal(result.excluded.length, 0);
});

test("관할 밖 주소와 관할 내 비주거 용도를 제외한다", () => {
  const outside = classifyProperty({
    address: "충청남도 보령시 중앙로 88",
    usage: "아파트",
  });
  assert.equal(outside.classification, "excluded");
  assert.equal(outside.reasonCode, "OUTSIDE_REGION");

  const nonResidential = classifyProperty({
    address: "충남 예산군 삽교읍 산업단지로 9",
    usage: "근린생활시설",
    buildingList: ["상가"],
  });
  assert.equal(nonResidential.classification, "excluded");
  assert.equal(nonResidential.reasonCode, "NON_RESIDENTIAL");
  assert.deepEqual(nonResidential.matchedKeywords.residential, []);
  assert.ok(nonResidential.matchedKeywords.excluded.includes("근린생활시설"));
});

test("주거와 제외 용도가 함께 발견되면 자동 포함하지 않고 review로 보낸다", () => {
  const result = classifyProperty({
    address: "충청남도 홍성군 광천읍 광천로 77",
    usage: "주상복합",
    buildingList: ["1층 상가", "2층 주거부분"],
    propertyDescription: "주상복합 중 주거부분과 근린생활시설",
  });

  assert.equal(result.classification, "review");
  assert.equal(result.reasonCode, "MIXED_USE");
  assert.equal(result.reason, "복합용도·수동확인 필요");
  assert.ok(result.matchedKeywords.residential.includes("주상복합 중 주거부분"));
  assert.ok(result.matchedKeywords.excluded.includes("상가"));
});

test("주소가 비거나 지역 판정이 불가능하면 메인 목록 대신 review로 보낸다", () => {
  for (const address of ["", "소재지 별도 확인"]) {
    const result = classifyProperty({
      address,
      usage: "다세대주택",
    });
    assert.equal(result.classification, "review");
    assert.equal(result.reasonCode, "ADDRESS_UNDETERMINED");
  }

  assert.deepEqual(determineRegion("충남 홍성군 홍성읍"), {
    region: "홍성군",
    determinate: true,
  });
  assert.deepEqual(determineRegion(""), {
    region: null,
    determinate: false,
  });
});

test("전·답은 독립 토큰일 때만 제외 키워드이며 단어 일부는 오탐하지 않는다", () => {
  assert.equal(hasStandaloneLandToken("토지 지목: 전", "전"), true);
  assert.equal(hasStandaloneLandToken("답, 대지", "답"), true);
  assert.equal(hasStandaloneLandToken("전원주택", "전"), false);
  assert.equal(hasStandaloneLandToken("답사 완료", "답"), false);

  const mixedLand = classifyProperty({
    address: "충남 홍성군 금마면 금마로 43",
    usage: "단독주택",
    landCategoryList: ["전"],
  });
  assert.equal(mixedLand.classification, "review");
  assert.ok(mixedLand.matchedKeywords.excluded.includes("전"));

  const safe = findUsageKeywords([
    { field: "propertyDescription", text: "전원주택" },
  ]);
  assert.ok(safe.residential.includes("주택"));
  assert.deepEqual(safe.excluded, []);
});
