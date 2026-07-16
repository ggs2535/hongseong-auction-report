"use strict";

const CHANGE_ORDER = [
  "NEW",
  "PRICE_DOWN",
  "PRICE_UP",
  "FAILED_BID_INCREMENT",
  "SALE_DATE_CHANGED",
  "STATUS_CHANGED",
  "RESTARTED",
  "WITHDRAWN",
  "DETAIL_UPDATED",
];

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function calculatePriceRatio(minimumSalePrice, appraisedPrice) {
  const minimum = asFiniteNumber(minimumSalePrice);
  const appraisal = asFiniteNumber(appraisedPrice);
  if (minimum === null || appraisal === null || appraisal <= 0) return null;
  return Math.round((minimum / appraisal) * 1000) / 10;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function isDifferent(left, right) {
  return JSON.stringify(stableValue(left)) !== JSON.stringify(stableValue(right));
}

function compareItem(current, previous, options = {}) {
  if (!previous) {
    return options.restarted ? ["RESTARTED"] : ["NEW"];
  }

  const changes = [];
  const currentMinimum = asFiniteNumber(current.minimumSalePrice);
  const previousMinimum = asFiniteNumber(previous.minimumSalePrice);
  if (currentMinimum !== null && previousMinimum !== null) {
    if (currentMinimum < previousMinimum) changes.push("PRICE_DOWN");
    if (currentMinimum > previousMinimum) changes.push("PRICE_UP");
  }

  const currentFailed = asFiniteNumber(current.failedBidCount);
  const previousFailed = asFiniteNumber(previous.failedBidCount);
  if (
    currentFailed !== null &&
    previousFailed !== null &&
    currentFailed > previousFailed
  ) {
    changes.push("FAILED_BID_INCREMENT");
  }
  if (String(current.saleDate || "") !== String(previous.saleDate || "")) {
    changes.push("SALE_DATE_CHANGED");
  }
  if (String(current.status || "") !== String(previous.status || "")) {
    changes.push("STATUS_CHANGED");
  }
  if (options.restarted) changes.push("RESTARTED");

  const detailProjection = (item) => ({
    usage: item?.usage || "",
    address: item?.address || "",
    remarks: item?.remarks || [],
    remarksEvidence: item?.remarksEvidence || [],
    documentVerification: item?.documentVerification || {},
  });
  if (isDifferent(detailProjection(current), detailProjection(previous))) {
    changes.push("DETAIL_UPDATED");
  }

  return CHANGE_ORDER.filter((type) => changes.includes(type));
}

function cloneWithdrawalState(state) {
  return JSON.parse(JSON.stringify(state || {}));
}

function updateWithdrawalState({
  currentSourceIds,
  previousReport,
  complete,
  generatedAt,
}) {
  const sourceIds = new Set(currentSourceIds || []);
  const state = cloneWithdrawalState(previousReport?.withdrawalCandidates);
  const restartedPreviousItems = new Map();
  const withdrawnItems = [];

  if (!complete) {
    return { withdrawalCandidates: state, restartedPreviousItems, withdrawnItems };
  }

  for (const [id, record] of Object.entries(state)) {
    if (sourceIds.has(id)) {
      restartedPreviousItems.set(id, record.item);
      delete state[id];
      continue;
    }
    if (record.confirmed) continue;

    record.consecutiveCompleteMisses =
      Number(record.consecutiveCompleteMisses || 0) + 1;
    record.lastMissingAt = generatedAt;
    if (record.consecutiveCompleteMisses >= 2) {
      record.confirmed = true;
      record.confirmedAt = generatedAt;
      withdrawnItems.push({
        ...record.item,
        changeType: ["WITHDRAWN"],
        withdrawn: true,
        withdrawnAt: generatedAt,
      });
    }
  }

  for (const previousItem of previousReport?.items || []) {
    const id = previousItem?.id;
    if (!id || sourceIds.has(id) || state[id]) continue;
    state[id] = {
      item: previousItem,
      consecutiveCompleteMisses: 1,
      firstMissingAt: generatedAt,
      lastMissingAt: generatedAt,
      lastSeenAt: previousReport?.generatedAt || "",
      confirmed: false,
      confirmedAt: null,
    };
  }

  return { withdrawalCandidates: state, restartedPreviousItems, withdrawnItems };
}

function applyDiff(currentItems, previousReport, withdrawalResult) {
  const previousById = new Map(
    (previousReport?.items || []).map((item) => [item.id, item]),
  );
  const restarted = withdrawalResult?.restartedPreviousItems || new Map();

  return (currentItems || []).map((item) => {
    const restartedPrevious = restarted.get(item.id);
    const previous = previousById.get(item.id) || restartedPrevious;
    return {
      ...item,
      changeType: compareItem(item, previous, {
        restarted: Boolean(restartedPrevious),
      }),
    };
  });
}

function hasListLevelChanges(current, previous) {
  if (!previous) return true;
  if (current?.listFingerprint && previous?.listFingerprint) {
    return current.listFingerprint !== previous.listFingerprint;
  }
  const fields = [
    "usage",
    "address",
    "appraisedPrice",
    "minimumSalePrice",
    "failedBidCount",
    "saleDate",
    "status",
  ];
  return fields.some((field) => isDifferent(current?.[field], previous?.[field]));
}

module.exports = {
  CHANGE_ORDER,
  applyDiff,
  calculatePriceRatio,
  compareItem,
  hasListLevelChanges,
  updateWithdrawalState,
};
