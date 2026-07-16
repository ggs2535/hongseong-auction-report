"use strict";

function toNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function calculateTotalPages(totalCount, pageSize) {
  const total = toNonNegativeNumber(totalCount);
  const size = Number(pageSize);
  if (!Number.isInteger(size) || size <= 0) {
    throw new TypeError("pageSize must be a positive integer");
  }
  return Math.ceil(total / size);
}

function pageNumbers(totalCount, pageSize, cap = Infinity) {
  const pages = calculateTotalPages(totalCount, pageSize);
  const limit = Math.min(pages, Number.isFinite(cap) ? Math.max(0, cap) : pages);
  return Array.from({ length: limit }, (_, index) => index + 1);
}

function normalizeIdentifier(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "");
}

function getPropertyId(item) {
  const caseNumber = normalizeIdentifier(
    item?.caseNumber ?? item?.displayCaseNumber ?? item?.raw?.caseNumber,
  );
  const itemNumber = normalizeIdentifier(
    item?.itemNumber ?? item?.itemSeq ?? item?.raw?.itemNumber ?? item?.raw?.itemSeq,
  );
  if (!caseNumber || !itemNumber) return null;
  return `${caseNumber}-${itemNumber}`;
}

function deduplicateProperties(items) {
  const seen = new Map();
  const unidentified = [];

  for (const item of items || []) {
    const id = getPropertyId(item);
    if (!id) {
      unidentified.push(item);
      continue;
    }
    if (!seen.has(id)) seen.set(id, item);
  }

  return {
    items: [...seen.values()],
    duplicateCount: Math.max(0, (items?.length || 0) - seen.size - unidentified.length),
    unidentified,
  };
}

function mergePageResults(pageResults) {
  const rawItems = [];
  for (const result of pageResults || []) {
    if (Array.isArray(result?.items)) rawItems.push(...result.items);
  }
  const deduplicated = deduplicateProperties(rawItems);
  return {
    ...deduplicated,
    fetchedRawCount: rawItems.length,
    fetchedUniqueCount: deduplicated.items.length,
  };
}

function calculateMissingCount(totalCount, fetchedUniqueCount) {
  return Math.max(
    toNonNegativeNumber(totalCount) - toNonNegativeNumber(fetchedUniqueCount),
    0,
  );
}

module.exports = {
  calculateMissingCount,
  calculateTotalPages,
  deduplicateProperties,
  getPropertyId,
  mergePageResults,
  pageNumbers,
};
