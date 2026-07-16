"use strict";

const SEARCH_FIELDS = [
  "usage",
  "address",
  "propertyDescription",
  "buildingList",
  "landCategoryList",
  "remarks",
  "usageCodes",
  "raw",
];

const RESIDENTIAL_KEYWORDS = [
  "아파트",
  "공동주택",
  "단독주택",
  "다가구주택",
  "다세대주택",
  "연립주택",
  "빌라",
  "도시형생활주택",
  "원룸",
  "오피스텔",
  "주택",
];

const EXCLUDED_KEYWORDS = [
  "근린생활시설",
  "상가",
  "점포",
  "사무실",
  "공장",
  "창고",
  "숙박시설",
  "모텔",
  "펜션",
  "여관",
  "병원",
  "의료시설",
  "교육시설",
  "종교시설",
  "축사",
  "농업시설",
  "주유소",
  "자동차",
  "선박",
  "기계",
  "임야",
];

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function collectStringLeaves(value, field, output = [], seen = new WeakSet()) {
  if (typeof value === "string" || typeof value === "number") {
    const text = normalizeText(value);
    if (text) output.push({ field, text });
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (seen.has(value)) return output;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectStringLeaves(entry, `${field}[${index}]`, output, seen),
    );
    return output;
  }

  for (const [key, entry] of Object.entries(value)) {
    collectStringLeaves(entry, field ? `${field}.${key}` : key, output, seen);
  }
  return output;
}

function collectSearchText(item) {
  const leaves = [];
  for (const field of SEARCH_FIELDS) {
    collectStringLeaves(item?.[field], field, leaves);
  }
  return leaves;
}

function hasStandaloneLandToken(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = "(?:^|[\\s,;/|()\\[\\]{}:·])";
  const ending = "(?=$|[\\s,;/|()\\[\\]{}:·])";
  return new RegExp(`${boundary}${escaped}${ending}`, "u").test(text);
}

function findUsageKeywords(leaves) {
  const joined = leaves.map(({ text }) => text).join("\n");
  const residential = RESIDENTIAL_KEYWORDS.filter((keyword) => joined.includes(keyword));
  const excluded = EXCLUDED_KEYWORDS.filter((keyword) => joined.includes(keyword));

  const hasResidentialContextForMixedUse =
    joined.includes("주상복합") &&
    /(주거\s*부분|주거용|공동주택|아파트|오피스텔|주택)/u.test(joined);
  if (hasResidentialContextForMixedUse) {
    residential.push("주상복합 중 주거부분");
  }

  if (leaves.some(({ text }) => hasStandaloneLandToken(text, "전"))) excluded.push("전");
  if (leaves.some(({ text }) => hasStandaloneLandToken(text, "답"))) excluded.push("답");

  return {
    residential: [...new Set(residential)],
    excluded: [...new Set(excluded)],
  };
}

function determineRegion(address) {
  const text = normalizeText(address);
  if (!text) return { region: null, determinate: false };
  if (text.includes("홍성군")) return { region: "홍성군", determinate: true };
  if (text.includes("예산군")) return { region: "예산군", determinate: true };

  const containsKoreanLocality = /(?:시|군|구)(?:\s|$)/u.test(text);
  return { region: null, determinate: containsKoreanLocality };
}

function reviewResult(item, reasonCode, reason, region, keywords) {
  return {
    classification: "review",
    item,
    region,
    reasonCode,
    reason,
    matchedKeywords: keywords,
  };
}

function classifyProperty(item) {
  const address = normalizeText(item?.address);
  const regionResult = determineRegion(address);
  const leaves = collectSearchText(item);
  const keywords = findUsageKeywords(leaves);

  if (!address || !regionResult.determinate) {
    return reviewResult(
      item,
      "ADDRESS_UNDETERMINED",
      "주소 확인 필요",
      regionResult.region,
      keywords,
    );
  }

  if (!regionResult.region) {
    return {
      classification: "excluded",
      item,
      region: null,
      reasonCode: "OUTSIDE_REGION",
      reason: "홍성군·예산군 외 지역",
      matchedKeywords: keywords,
    };
  }

  if (keywords.residential.length > 0 && keywords.excluded.length > 0) {
    return reviewResult(
      item,
      "MIXED_USE",
      "복합용도·수동확인 필요",
      regionResult.region,
      keywords,
    );
  }

  if (keywords.residential.length > 0) {
    return {
      classification: "included",
      item,
      region: regionResult.region,
      reasonCode: "RESIDENTIAL",
      reason: "주거용 키워드 확인",
      matchedKeywords: keywords,
    };
  }

  return {
    classification: "excluded",
    item,
    region: regionResult.region,
    reasonCode:
      keywords.excluded.length > 0 ? "NON_RESIDENTIAL" : "NO_RESIDENTIAL_KEYWORD",
    reason:
      keywords.excluded.length > 0
        ? "제외 용도 키워드 확인"
        : "주거용 키워드 미확인",
    matchedKeywords: keywords,
  };
}

function filterResidential(items) {
  const included = [];
  const reviewItems = [];
  const excluded = [];

  for (const item of items || []) {
    const result = classifyProperty(item);
    if (result.classification === "included") {
      included.push({ ...item, region: result.region });
    } else if (result.classification === "review") {
      reviewItems.push({
        item: { ...item, region: result.region },
        reasonCode: result.reasonCode,
        reason: result.reason,
        matchedKeywords: result.matchedKeywords,
      });
    } else {
      excluded.push(result);
    }
  }

  return { included, reviewItems, excluded };
}

module.exports = {
  EXCLUDED_KEYWORDS,
  RESIDENTIAL_KEYWORDS,
  SEARCH_FIELDS,
  classifyProperty,
  collectSearchText,
  determineRegion,
  filterResidential,
  findUsageKeywords,
  hasStandaloneLandToken,
};
