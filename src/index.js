"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  collectAllProperties,
  createFixtureSource,
  createLiveSource,
  isBlockedError,
} = require("./court-client");
const { createConfig } = require("./config");
const {
  applyDiff,
  hasListLevelChanges,
  updateWithdrawalState,
} = require("./diff");
const {
  findMatchingCaseItem,
  mergeCaseDetail,
  normalizeProperty,
} = require("./normalize");
const { getPropertyId } = require("./pagination");
const {
  classifyProperty,
  filterResidential,
} = require("./residential-filter");
const { renderReport } = require("./render");
const { dateInTimezone, loadLastGood, saveReport } = require("./storage");

function previousReportForMode(lastGood, mode) {
  if (!lastGood || lastGood?.source?.mode !== mode) return null;
  return lastGood;
}

async function preparePublicOutput(config) {
  if (path.resolve(config.publicDir) === path.resolve(config.publicTemplateDir)) return;
  await fs.mkdir(config.publicDir, { recursive: true });
  const entries = await fs.readdir(config.publicTemplateDir, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (entry.name === "index.html") continue;
    await fs.cp(
      path.join(config.publicTemplateDir, entry.name),
      path.join(config.publicDir, entry.name),
      { recursive: true, force: true },
    );
  }
}

function normalizeReviewEntry(entry, generatedAt) {
  const normalized = normalizeProperty(entry.item, {
    generatedAt,
    detailStatus: "수동확인 필요",
  });
  return {
    item: normalized,
    reasonCode: entry.reasonCode,
    reason: entry.reason,
    matchedKeywords: entry.matchedKeywords || {
      residential: [],
      excluded: [],
    },
  };
}

function hasUsableDetailCache(item) {
  return ["상세조회 완료", "전일 상세정보 재사용"].includes(
    String(item?.detailStatus || ""),
  );
}

function reflectDetailBlock(completeness, detailSummary) {
  if (!detailSummary?.blocked) return completeness;
  completeness.complete = false;
  completeness.blocked = true;
  completeness.errorCode = "BLOCKED";
  completeness.errorMessage =
    "사건 상세조회 중 법원 사이트의 BLOCKED 응답을 감지했습니다.";
  return completeness;
}

function buildInitialReviewItems(filtered, unidentified, generatedAt) {
  const reviewItems = filtered.reviewItems.map((entry) =>
    normalizeReviewEntry(entry, generatedAt),
  );

  for (const item of unidentified || []) {
    const classification = classifyProperty(item);
    reviewItems.push(
      normalizeReviewEntry(
        {
          item,
          reasonCode: "IDENTIFIER_UNDETERMINED",
          reason: "사건번호 또는 물건번호 확인 필요",
          matchedKeywords: classification.matchedKeywords,
        },
        generatedAt,
      ),
    );
  }
  return reviewItems;
}

async function enrichResidentialItems(options) {
  const {
    rawItems,
    source,
    courtCode,
    previousReport,
    generatedAt,
    maxDetailCalls,
    detailsAllowed = true,
    listBlocked = false,
  } = options;
  const previousById = new Map(
    [
      ...(previousReport?.items || []),
      ...(previousReport?.reviewItems || []).map((entry) => entry.item),
    ]
      .filter((item) => item?.id)
      .map((item) => [item.id, item]),
  );
  const entries = rawItems.map((sourceItem) => {
    const basic = normalizeProperty(sourceItem, { generatedAt });
    const previous = previousById.get(basic.id);
    return {
      sourceItem,
      basic,
      previous,
      needsDetail:
        !previous ||
        !hasUsableDetailCache(previous) ||
        hasListLevelChanges(basic, previous),
    };
  });
  const detailSummary = {
    requested: entries.filter(({ needsDetail }) => needsDetail).length,
    attempted: 0,
    succeeded: 0,
    failed: 0,
    pending: 0,
    blocked: false,
  };

  let detailsHalted = !detailsAllowed;
  for (const entry of entries) {
    if (!entry.needsDetail) {
      entry.normalized = normalizeProperty(entry.sourceItem, {
        generatedAt,
        cachedItem: entry.previous,
        reuseCachedEvidence: true,
        reuseCachedFields: true,
        detailStatus: "전일 상세정보 재사용",
        listFingerprint: entry.basic.listFingerprint,
      });
      continue;
    }

    if (detailsHalted || detailSummary.attempted >= maxDetailCalls) {
      detailSummary.pending += 1;
      entry.normalized = normalizeProperty(entry.sourceItem, {
        generatedAt,
        cachedItem: entry.previous,
        reuseCachedEvidence: Boolean(entry.previous),
        detailStatus: detailsAllowed
          ? "상세조회 대기"
          : listBlocked
            ? "상세조회 중단·목록 차단"
            : "상세조회 보류·목록 불완전",
        listFingerprint: entry.basic.listFingerprint,
      });
      continue;
    }

    detailSummary.attempted += 1;
    try {
      const caseResponse = await source.getCaseByCaseNumber({
        courtCode,
        caseNumber: entry.basic.caseNumber,
        includeRaw: true,
      });
      if (!caseResponse?.found) {
        const error = new Error("사건 상세정보를 찾지 못했습니다.");
        error.code = "DETAIL_NOT_FOUND";
        throw error;
      }
      if (!findMatchingCaseItem(caseResponse, entry.basic.itemNumber)) {
        const error = new Error("사건 상세응답에서 해당 물건번호를 찾지 못했습니다.");
        error.code = "DETAIL_ITEM_NOT_FOUND";
        throw error;
      }
      entry.sourceItem = mergeCaseDetail(entry.sourceItem, caseResponse);
      entry.normalized = normalizeProperty(entry.sourceItem, {
        generatedAt,
        detailStatus: "상세조회 완료",
        listFingerprint: entry.basic.listFingerprint,
      });
      detailSummary.succeeded += 1;
    } catch (error) {
      detailSummary.failed += 1;
      if (isBlockedError(error)) {
        detailSummary.blocked = true;
        detailsHalted = true;
      }
      entry.normalized = normalizeProperty(entry.sourceItem, {
        generatedAt,
        cachedItem: entry.previous,
        reuseCachedEvidence: Boolean(entry.previous),
        detailStatus: isBlockedError(error)
          ? "상세조회 차단"
          : "상세조회 실패·목록정보 사용",
        listFingerprint: entry.basic.listFingerprint,
      });
    }
  }

  const included = [];
  const additionalReviewItems = [];
  for (const entry of entries) {
    const classification = classifyProperty(entry.sourceItem);
    if (classification.classification === "included") {
      included.push({
        ...entry.normalized,
        region: classification.region,
      });
    } else if (classification.classification === "review") {
      additionalReviewItems.push({
        item: {
          ...entry.normalized,
          region: classification.region,
        },
        reasonCode: classification.reasonCode,
        reason: classification.reason,
        matchedKeywords: classification.matchedKeywords,
      });
    }
  }

  return { items: included, additionalReviewItems, detailSummary };
}

function createReport({
  config,
  collection,
  items,
  reviewItems,
  detailSummary,
  previousReport,
  generatedAt,
}) {
  const sourceItemIds = collection.items.map(getPropertyId).filter(Boolean);
  const withdrawal = updateWithdrawalState({
    currentSourceIds: sourceItemIds,
    previousReport,
    complete: collection.completeness.complete,
    generatedAt,
  });
  const diffedItems = applyDiff(items, previousReport, withdrawal);
  collection.completeness.matchedResidentialCount = diffedItems.length;
  collection.completeness.reviewCount = reviewItems.length;

  const reportDate = dateInTimezone(new Date(generatedAt), config.timezone);
  const lastGoodGeneratedAt = collection.completeness.complete
    ? generatedAt
    : previousReport?.generatedAt || null;

  return {
    schemaVersion: 1,
    projectName: "hongseong-auction-report",
    reportDate,
    generatedAt,
    timezone: config.timezone,
    source: {
      mode: config.mode,
      courtCode: collection.court?.code || "",
      courtName:
        collection.court?.branchName || collection.court?.name || "홍성지원",
      searchUrl: config.searchUrl,
      readOnly: true,
    },
    completeness: collection.completeness,
    summary: {
      totalCount: collection.completeness.totalCount,
      checkedCount: collection.completeness.fetchedUniqueCount,
      missingCount: collection.completeness.missingCount,
      residentialCount: diffedItems.length,
      reviewCount: reviewItems.length,
      success: collection.completeness.complete,
      countsKnown: collection.completeness.countsKnown,
    },
    items: diffedItems,
    reviewItems,
    withdrawnItems: withdrawal.withdrawnItems,
    sourceItemIds,
    withdrawalCandidates: withdrawal.withdrawalCandidates,
    detailSummary,
    lastGoodGeneratedAt,
    notices: [
      "매각물건명세서·현황조사서 미검증",
      "감정평가서 미검증",
      "입찰 전 법원 원문 문서를 직접 확인하세요.",
    ],
  };
}

async function run(options = {}) {
  const config = options.config || createConfig(options.configOverrides);
  await preparePublicOutput(config);
  const now = options.now || (() => new Date());
  const lastGood = options.lastGood ?? (await loadLastGood(config.dataDir));
  const previousReport = previousReportForMode(lastGood, config.mode);
  const source =
    options.source ||
    (config.mode === "fixture"
      ? createFixtureSource(config)
      : createLiveSource(config, options.liveSourceOptions));

  let report;
  try {
    const collection = await collectAllProperties({
      source,
      config,
      sleep: options.sleep,
      now,
    });
    const generatedAt = collection.completeness.finishedAt || now().toISOString();
    const filtered = filterResidential(collection.items);
    const addressReviewCandidates = filtered.reviewItems.filter(
      ({ reasonCode }) => reasonCode === "ADDRESS_UNDETERMINED",
    );
    const deferredReviewItems = filtered.reviewItems.filter(
      ({ reasonCode }) => reasonCode !== "ADDRESS_UNDETERMINED",
    );
    const initialReviewItems = buildInitialReviewItems(
      { ...filtered, reviewItems: deferredReviewItems },
      collection.unidentified,
      generatedAt,
    );
    const enriched = await enrichResidentialItems({
      rawItems: [
        ...filtered.included,
        ...addressReviewCandidates.map(({ item }) => item),
      ],
      source,
      courtCode: collection.completeness.courtCode,
      previousReport,
      generatedAt,
      maxDetailCalls: config.maxDetailCalls,
      detailsAllowed: collection.completeness.complete,
      listBlocked: collection.completeness.blocked,
    });
    reflectDetailBlock(collection.completeness, enriched.detailSummary);
    const reviewItems = [
      ...initialReviewItems,
      ...enriched.additionalReviewItems,
    ];
    report = createReport({
      config,
      collection,
      items: enriched.items,
      reviewItems,
      detailSummary: enriched.detailSummary,
      previousReport,
      generatedAt,
    });
  } finally {
    await source.close?.();
  }

  await saveReport(report, {
    dataDir: config.dataDir,
    timezone: config.timezone,
    writeMode: config.storageWriteMode,
  });
  await renderReport({
    latest: report,
    lastGood: report.completeness.complete ? report : previousReport,
    publicDir: config.publicDir,
    templateDir: config.publicTemplateDir,
  });

  const summary = {
    complete: report.completeness.complete,
    blocked: report.completeness.blocked,
    errorCode: report.completeness.errorCode,
    totalCount: report.completeness.totalCount,
    fetchedUniqueCount: report.completeness.fetchedUniqueCount,
    missingCount: report.completeness.missingCount,
    residentialCount: report.completeness.matchedResidentialCount,
    reviewCount: report.completeness.reviewCount,
    reportDate: report.reportDate,
  };
  if (report.completeness.blocked) {
    console.warn("::warning::법원 사이트가 요청을 차단하여 불완전 보고서를 저장했습니다.");
  }
  console.log(`REPORT_SUMMARY ${JSON.stringify(summary)}`);
  return report;
}

async function main() {
  await run();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("FATAL_UPDATE_ERROR", error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildInitialReviewItems,
  createReport,
  enrichResidentialItems,
  hasUsableDetailCache,
  reflectDetailBlock,
  previousReportForMode,
  preparePublicOutput,
  run,
};
