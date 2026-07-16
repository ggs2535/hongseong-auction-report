"use strict";

const crypto = require("node:crypto");

const { calculatePriceRatio } = require("./diff");
const { getPropertyId } = require("./pagination");
const {
  extractSpecialRemarks,
  unverifiedDocumentStatus,
} = require("./special-remarks");

function firstDefined(source, keys, fallback = "") {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function textValue(value) {
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(", ");
  }
  if (value && typeof value === "object") {
    return Object.values(value).map(textValue).filter(Boolean).join(", ");
  }
  return String(value ?? "").trim();
}

function numericValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDate(value) {
  const text = textValue(value);
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return text;
}

function stableSerializable(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((entry) => stableSerializable(entry, seen));
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableSerializable(value[key], seen)]),
  );
}

function createListFingerprint(source) {
  const projection = {
    caseNumber: firstDefined(source, ["caseNumber", "displayCaseNumber", "caseNo"]),
    itemNumber: firstDefined(source, ["itemNumber", "itemSeq", "propertyNumber"]),
    usage: source?.usage,
    address: source?.address,
    appraisedPrice: source?.appraisedPrice,
    minimumSalePrice: source?.minimumSalePrice,
    failedBidCount: firstDefined(source, ["failedBidCount", "flbdCount", "failureCount"]),
    saleDate: source?.saleDate,
    status: firstDefined(source, [
      "status",
      "statusName",
      "progressStatus",
      "progressStatusName",
      "progressStatusCode",
      "statusCode",
    ]),
    propertyDescription: source?.propertyDescription,
    buildingList: source?.buildingList,
    remarks: source?.remarks,
    usageCodes: source?.usageCodes,
    raw: source?.raw,
  };
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableSerializable(projection)))
    .digest("hex");
}

function normalizeProperty(source, options = {}) {
  const caseNumber = textValue(
    firstDefined(source, ["caseNumber", "displayCaseNumber", "caseNo"]),
  ).replace(/\s+/g, "");
  const itemNumber = textValue(
    firstDefined(source, ["itemNumber", "itemSeq", "propertyNumber"]),
  ).replace(/\s+/g, "");
  const id = getPropertyId({ caseNumber, itemNumber });
  const appraisedPrice = numericValue(
    firstDefined(source, ["appraisedPrice", "assessmentPrice"], 0),
  );
  const minimumSalePrice = numericValue(
    firstDefined(source, ["minimumSalePrice", "minimumPrice", "minPrice"], 0),
  );
  const extracted = extractSpecialRemarks(source);
  const cached = options.cachedItem;
  const reuseCachedEvidence = options.reuseCachedEvidence === true && cached;

  const normalized = {
    id,
    caseNumber,
    itemNumber,
    usage: textValue(
      firstDefined(source, [
        "usage",
        "usageName",
        "propertyUsage",
        "propertyDescription",
      ]),
    ),
    address: textValue(
      firstDefined(source, ["address", "roadAddress", "lotAddress"]),
    ),
    appraisedPrice,
    minimumSalePrice,
    priceRatio: calculatePriceRatio(minimumSalePrice, appraisedPrice),
    failedBidCount: numericValue(
      firstDefined(source, ["failedBidCount", "flbdCount", "failureCount"], 0),
    ),
    saleDate: normalizeDate(
      firstDefined(source, ["saleDate", "auctionDate", "bidDate"]),
    ),
    status: textValue(
      firstDefined(source, [
        "status",
        "statusName",
        "progressStatus",
        "progressStatusName",
        "progressStatusCode",
        "statusCode",
      ]),
    ),
    remarks: reuseCachedEvidence ? cached.remarks || [] : extracted.remarks,
    remarksEvidence: reuseCachedEvidence
      ? cached.remarksEvidence || []
      : extracted.remarksEvidence,
    documentVerification: reuseCachedEvidence
      ? cached.documentVerification || unverifiedDocumentStatus()
      : unverifiedDocumentStatus(),
    changeType: [],
    sourceUpdatedAt: textValue(
      firstDefined(
        source,
        ["sourceUpdatedAt", "updatedAt", "lastUpdatedAt"],
        options.generatedAt || "",
      ),
    ),
    detailStatus: options.detailStatus || "목록정보만 확인",
    listFingerprint:
      options.listFingerprint || createListFingerprint(source),
  };
  if (options.reuseCachedFields === true && cached) {
    for (const field of [
      "caseNumber",
      "itemNumber",
      "usage",
      "address",
      "appraisedPrice",
      "minimumSalePrice",
      "priceRatio",
      "failedBidCount",
      "saleDate",
      "status",
    ]) {
      if (cached[field] !== undefined) normalized[field] = cached[field];
    }
  }
  return normalized;
}

function findMatchingCaseItem(caseResponse, itemNumber) {
  const normalized = String(itemNumber || "").replace(/\s+/g, "");
  const items = caseResponse?.items || caseResponse?.properties || [];
  return (
    items.find((item) => {
      const candidate = firstDefined(item, ["itemNumber", "itemSeq", "propertyNumber"]);
      return String(candidate || "").replace(/\s+/g, "") === normalized;
    }) ||
    (normalized === "" && items.length === 1 ? items[0] : null)
  );
}

function extractCaseRawForItem(rawResponse, itemNumber) {
  const data = rawResponse?.data;
  if (!data || typeof data !== "object") return null;
  const normalized = String(itemNumber || "").replace(/\s+/g, "");
  const itemRows = Array.isArray(data.dlt_rletCsDspslObjctLst)
    ? data.dlt_rletCsDspslObjctLst
    : [];
  const scheduleRows = Array.isArray(data.dlt_rletCsGdsDtsDxdyInf)
    ? data.dlt_rletCsGdsDtsDxdyInf
    : [];
  const matchesItem = (row, keys) =>
    keys.some(
      (key) => String(row?.[key] ?? "").replace(/\s+/g, "") === normalized,
    );
  const matchedItems = itemRows.filter((row) =>
    matchesItem(row, ["dspslObjctSeq", "dspslGdsSeq", "dspslSeq"]),
  );
  const matchedSchedules = scheduleRows.filter((row) =>
    matchesItem(row, ["dspslGdsSeq", "dspslObjctSeq", "dspslSeq"]),
  );
  const basis = data.dma_csBasInf || {};

  return {
    caseStatus: {
      csNo: basis.csNo,
      csProgStatCd: basis.csProgStatCd,
      csProgSuspRsn: basis.csProgSuspRsn,
      auctnSuspStatCd: basis.auctnSuspStatCd,
      ultmtDvsCd: basis.ultmtDvsCd,
      csUltmtYmd: basis.csUltmtYmd,
    },
    itemRows: matchedItems.length === 0 && itemRows.length === 1 ? itemRows : matchedItems,
    scheduleRows:
      matchedSchedules.length === 0 && scheduleRows.length === 1
        ? scheduleRows
        : matchedSchedules,
  };
}

function mergeCaseDetail(listItem, caseResponse) {
  const detailItem = findMatchingCaseItem(
    caseResponse,
    firstDefined(listItem, ["itemNumber", "itemSeq", "propertyNumber"]),
  );
  if (!detailItem) return listItem;

  return {
    ...listItem,
    ...Object.fromEntries(
      Object.entries(detailItem).filter(([, value]) => value !== undefined && value !== null),
    ),
    caseNumber: firstDefined(listItem, ["caseNumber", "displayCaseNumber"]),
    itemNumber: firstDefined(listItem, ["itemNumber", "itemSeq"]),
    raw: {
      list: listItem.raw || listItem,
      case: detailItem.raw || detailItem,
      caseResponse: extractCaseRawForItem(
        caseResponse?.raw,
        firstDefined(listItem, ["itemNumber", "itemSeq", "propertyNumber"]),
      ),
      caseInfo: caseResponse?.caseInfo || null,
      schedule: caseResponse?.schedule || [],
    },
  };
}

module.exports = {
  createListFingerprint,
  extractCaseRawForItem,
  findMatchingCaseItem,
  mergeCaseDetail,
  normalizeDate,
  normalizeProperty,
  numericValue,
  textValue,
};
