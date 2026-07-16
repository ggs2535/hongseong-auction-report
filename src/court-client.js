"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  calculateMissingCount,
  calculateTotalPages,
  mergePageResults,
} = require("./pagination");

function delay(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs(minDelayMs, jitterMs, random = Math.random) {
  return Math.max(0, minDelayMs) + Math.floor(random() * (Math.max(0, jitterMs) + 1));
}

function createPacer(options = {}) {
  const sleep = options.sleep || delay;
  const now = options.now || Date.now;
  const random = options.random || Math.random;
  const minDelayMs = options.minDelayMs ?? 3000;
  const jitterMs = options.jitterMs ?? 2000;
  let lastStartedAt = 0;
  let chain = Promise.resolve();

  async function waitTurn() {
    const targetGap = randomDelayMs(minDelayMs, jitterMs, random);
    if (lastStartedAt > 0) {
      const remaining = targetGap - (now() - lastStartedAt);
      if (remaining > 0) await sleep(remaining);
    }
    lastStartedAt = now();
  }

  return {
    run(operation) {
      const result = chain.then(async () => {
        await waitTurn();
        return operation();
      });
      chain = result.catch(() => {});
      return result;
    },
    wait: () => {
      const result = chain.then(waitTurn);
      chain = result.catch(() => {});
      return result;
    },
  };
}

function blockedPayload(value, seen = new WeakSet()) {
  if (typeof value === "string") {
    return /\bBLOCKED\b|ipcheck\s*[:=]\s*false/iu.test(value);
  }
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (value.ipcheck === false) return true;
  if (String(value.code || "").toUpperCase() === "BLOCKED") return true;
  return Object.values(value).some((entry) => blockedPayload(entry, seen));
}

function isBlockedError(error, seen = new WeakSet()) {
  if (!error) return false;
  if (typeof error === "object") {
    if (seen.has(error)) return false;
    seen.add(error);
  }
  if (String(error.code || "").toUpperCase() === "BLOCKED") return true;
  if (blockedPayload(error.upstreamPayload) || blockedPayload(error.data)) return true;
  if (error.cause && error.cause !== error && isBlockedError(error.cause, seen)) {
    return true;
  }
  return /\bBLOCKED\b|ipcheck\s*=\s*false/iu.test(String(error.message || ""));
}

function assertNotBlocked(response) {
  if (!blockedPayload(response)) return response;
  const error = new Error("Court Auction site returned ipcheck=false");
  error.code = "BLOCKED";
  error.upstreamPayload = response;
  throw error;
}

function errorWithCode(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function diagnosticText(value, maxLength = 500) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text ? text.slice(0, maxLength) : null;
}

function diagnosticUpstreamPath(value) {
  const text = diagnosticText(value);
  if (!text) return null;
  try {
    const url = new URL(text, "https://www.courtauction.go.kr");
    return url.pathname.startsWith("/pgj/") ? url.pathname.slice(0, 500) : null;
  } catch {
    return null;
  }
}

function errorChainValue(error, key) {
  const seen = new WeakSet();
  let current = error;
  while (current && typeof current === "object") {
    if (seen.has(current)) return null;
    seen.add(current);
    if (current[key] !== null && current[key] !== undefined) {
      return current[key];
    }
    current = current.cause;
  }
  return null;
}

function extractOperationalDiagnostics(error) {
  const rawStatus = Number(errorChainValue(error, "statusCode"));
  const errorStatusCode =
    Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
      ? rawStatus
      : null;
  return {
    errorStatusCode,
    upstreamUrl: diagnosticUpstreamPath(errorChainValue(error, "upstreamUrl")),
    upstreamMessage: diagnosticText(
      errorChainValue(error, "upstreamMessage"),
      1000,
    ),
  };
}

function createWarmupServerError(response, input) {
  const rawUrl =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : String(input?.url || "");
  let upstreamUrl = "/pgj/index.on";
  try {
    upstreamUrl = new URL(rawUrl).pathname;
  } catch {
    // Keep the fixed court warmup path without retaining a malformed URL.
  }
  const error = new Error(
    `Court Auction search page returned HTTP ${response.status}`,
  );
  error.code = "UPSTREAM_ERROR";
  error.statusCode = response.status;
  error.upstreamUrl = upstreamUrl;
  return error;
}

function isWarmupServerFailure(response, input, init = {}) {
  if (!response || response.ok !== false || response.status < 500) return false;
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  if (method !== "GET") return false;
  const rawUrl =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : String(input?.url || "");
  try {
    return new URL(rawUrl).pathname === "/pgj/index.on";
  } catch {
    return false;
  }
}

function findHongseongCourt(courtsResponse, fragment = "홍성지원") {
  const items = Array.isArray(courtsResponse)
    ? courtsResponse
    : courtsResponse?.items || courtsResponse?.courts || [];
  const court = items.find((entry) =>
    [entry?.name, entry?.branchName].some((name) =>
      String(name || "").includes(fragment),
    ),
  );
  if (!court?.code) {
    throw errorWithCode(
      "COURT_NOT_FOUND",
      `법원 목록에서 "${fragment}"을(를) 찾지 못했습니다.`,
    );
  }
  return court;
}

async function readFixtureJson(fixturesDir, name) {
  const filePath = path.join(fixturesDir, name);
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function createFixtureSource(config) {
  let pages;
  let cases;
  return {
    mode: "fixture",
    async getCourtCodes() {
      return readFixtureJson(config.fixturesDir, "courts.json");
    },
    async searchProperties(params) {
      pages ||= await readFixtureJson(config.fixturesDir, "search-pages.json");
      const result = pages[String(params.page)];
      if (!result) {
        throw errorWithCode(
          "FIXTURE_PAGE_NOT_FOUND",
          `Fixture page ${params.page} is missing`,
        );
      }
      return structuredClone({ ...result, _fetchMode: "http" });
    },
    async getCaseByCaseNumber(params) {
      cases ||= await readFixtureJson(config.fixturesDir, "cases.json");
      const result = cases[params.caseNumber];
      if (!result) return { found: false, items: [] };
      return structuredClone(result);
    },
    async close() {},
  };
}

function loadCourtLibrary() {
  // Live-only lazy import keeps fixture tests entirely offline.
  // eslint-disable-next-line global-require
  return require("court-auction-notice-search");
}

function createLiveSource(config, options = {}) {
  const library = options.library || loadCourtLibrary();
  const nativeFetch = options.fetchImpl || global.fetch;
  const pacer =
    options.pacer ||
    createPacer({
      minDelayMs: config.minDelayMs,
      jitterMs: config.jitterMs,
      sleep: options.sleep,
      now: options.now,
      random: options.random,
    });
  const pacedFetch = (...args) =>
    pacer.run(async () => {
      const response = await nativeFetch(...args);
      if (response?.ok === false && typeof response.clone === "function") {
        try {
          const payload = await response.clone().json();
          if (blockedPayload(payload)) {
            const error = new Error("Court Auction HTTP response reported BLOCKED");
            error.code = "BLOCKED";
            error.upstreamPayload = payload;
            throw error;
          }
        } catch (error) {
          if (isBlockedError(error)) throw error;
          // A non-JSON HTTP error is handled by the package as an upstream error.
        }
        if (isWarmupServerFailure(response, args[0], args[1])) {
          throw createWarmupServerError(response, args[0]);
        }
      }
      return response;
    });
  const listClient = new library.CourtAuctionHttpClient({
    fetchImpl: pacedFetch,
    minDelayMs: config.minDelayMs,
    jitterMs: config.jitterMs,
    timeoutMs: config.timeoutMs,
    maxCallsPerSession: config.maxListCalls,
  });
  const detailClient = new library.CourtAuctionHttpClient({
    fetchImpl: pacedFetch,
    minDelayMs: config.minDelayMs,
    jitterMs: config.jitterMs,
    timeoutMs: config.timeoutMs,
    maxCallsPerSession: config.maxDetailCalls,
  });
  const courtClient = new library.CourtAuctionHttpClient({
    fetchImpl: pacedFetch,
    minDelayMs: config.minDelayMs,
    jitterMs: config.jitterMs,
    timeoutMs: config.timeoutMs,
    maxCallsPerSession: 1,
  });
  let playwrightClient = null;
  let listTransportCalls = 0;
  let detailTransportCalls = 0;

  function consumeBudget(kind) {
    if (kind === "list") {
      if (listTransportCalls >= config.maxListCalls) {
        throw errorWithCode(
          "CALL_LIMIT",
          `목록 조회 호출 상한(${config.maxListCalls})에 도달했습니다.`,
        );
      }
      listTransportCalls += 1;
      return;
    }
    if (detailTransportCalls >= config.maxDetailCalls) {
      throw errorWithCode(
        "DETAIL_CALL_LIMIT",
        `상세 조회 호출 상한(${config.maxDetailCalls})에 도달했습니다.`,
      );
    }
    detailTransportCalls += 1;
  }

  function eligibleForBrowserFallback(error) {
    const { errorStatusCode } = extractOperationalDiagnostics(error);
    if (errorStatusCode !== null && errorStatusCode >= 500) return false;
    return (
      (error?.code === "UPSTREAM_ERROR" && error?.statusCode === 400) ||
      error?.code === "NETWORK_ERROR"
    );
  }

  function getPlaywrightClient() {
    if (!playwrightClient) {
      playwrightClient = new library.CourtAuctionPlaywrightClient({
        timeoutMs: config.timeoutMs,
        headless: true,
      });
    }
    return playwrightClient;
  }

  async function browserPost(method, params, kind) {
    consumeBudget(kind);
    const client = getPlaywrightClient();
    // Warmup navigation and POST are separated by the same global safety pacer.
    await pacer.run(() => client.warmup(method === "searchProperties" ? "propertySearch" : "caseDetail"));
    await pacer.wait();
    const result =
      method === "searchProperties"
        ? await library.searchProperties({
            ...params,
            client,
            fallback: false,
            fallbackOnBlocked: false,
          })
        : await library.getCaseByCaseNumber({ ...params, client });
    return assertNotBlocked(result);
  }

  async function withControlledFallback(method, params, client, kind) {
    consumeBudget(kind);
    try {
      const result =
        method === "searchProperties"
          ? await library.searchProperties({
              ...params,
              client,
              fallback: false,
              fallbackOnBlocked: false,
            })
          : await library.getCaseByCaseNumber({ ...params, client });
      return { ...assertNotBlocked(result), _fetchMode: "http" };
    } catch (error) {
      if (isBlockedError(error)) throw error;
      if (!eligibleForBrowserFallback(error)) throw error;
      const result = await browserPost(method, params, kind);
      return { ...result, _fetchMode: "playwright" };
    }
  }

  async function getCourtCodesWithFallback() {
    try {
      return assertNotBlocked(await library.getCourtCodes({ client: courtClient }));
    } catch (error) {
      if (isBlockedError(error)) throw error;
      if (!eligibleForBrowserFallback(error)) throw error;
      const client = getPlaywrightClient();
      await pacer.run(() => client.warmup("courts"));
      await pacer.wait();
      return assertNotBlocked(await library.getCourtCodes({ client }));
    }
  }

  return {
    mode: "live",
    get listTransportCalls() {
      return listTransportCalls;
    },
    async getCourtCodes() {
      return getCourtCodesWithFallback();
    },
    async searchProperties(params) {
      return withControlledFallback("searchProperties", params, listClient, "list");
    },
    async getCaseByCaseNumber(params) {
      return withControlledFallback(
        "getCaseByCaseNumber",
        params,
        detailClient,
        "detail",
      );
    },
    async close() {
      if (playwrightClient?.close) await playwrightClient.close().catch(() => {});
    },
  };
}

function baseCompleteness(startedAt) {
  return {
    complete: false,
    countsKnown: false,
    courtCode: "",
    totalCount: null,
    pageSize: 100,
    expectedPages: 0,
    fetchedPages: 0,
    failedPages: [],
    fetchedRawCount: 0,
    fetchedUniqueCount: 0,
    missingCount: null,
    matchedResidentialCount: 0,
    reviewCount: 0,
    fetchMode: "http",
    blocked: false,
    errorCode: null,
    errorMessage: null,
    errorStatusCode: null,
    upstreamUrl: null,
    upstreamMessage: null,
    startedAt,
    finishedAt: "",
  };
}

function setOperationalError(completeness, error, fallbackCode) {
  const diagnostics = extractOperationalDiagnostics(error);
  completeness.blocked = isBlockedError(error);
  completeness.errorCode = completeness.blocked
    ? "BLOCKED"
    : diagnostics.errorStatusCode !== null &&
        diagnostics.errorStatusCode >= 500
      ? "UPSTREAM_ERROR"
      : error?.code || fallbackCode;
  completeness.errorMessage = String(error?.message || error || "알 수 없는 오류");
  completeness.errorStatusCode = diagnostics.errorStatusCode;
  completeness.upstreamUrl = diagnostics.upstreamUrl;
  completeness.upstreamMessage = diagnostics.upstreamMessage;
}

async function fetchPageWithRetry(source, params, config, sleep) {
  try {
    return await source.searchProperties(params);
  } catch (error) {
    if (
      isBlockedError(error) ||
      ["CALL_LIMIT", "BUDGET_EXCEEDED"].includes(error?.code)
    ) {
      throw error;
    }
    await sleep(config.retryDelayMs);
    return source.searchProperties(params);
  }
}

function aggregateFetchMode(modes) {
  const unique = new Set(modes);
  if (unique.size > 1) return "mixed";
  return unique.has("playwright") ? "playwright" : "http";
}

async function collectAllProperties(options) {
  const { source, config } = options;
  const sleep = options.sleep || delay;
  const now = options.now || (() => new Date());
  const startedAt = now().toISOString();
  const completeness = baseCompleteness(startedAt);
  const pageResults = [];
  const successfulPages = [];
  const fetchModes = [];
  let court;

  try {
    const courts = assertNotBlocked(await source.getCourtCodes());
    court = findHongseongCourt(courts, config.courtNameFragment);
    completeness.courtCode = court.code;
  } catch (error) {
    setOperationalError(completeness, error, "COURT_LOOKUP_FAILED");
    completeness.finishedAt = now().toISOString();
    return { items: [], unidentified: [], completeness, court: null };
  }

  const makeParams = (page) => ({
    courtCode: court.code,
    usage: { large: "건물" },
    page,
    pageSize: config.pageSize,
    includeRaw: true,
    fallback: false,
    fallbackOnBlocked: false,
  });

  let firstPage;
  try {
    firstPage = assertNotBlocked(
      await fetchPageWithRetry(source, makeParams(1), config, sleep),
    );
  } catch (error) {
    setOperationalError(completeness, error, "FIRST_PAGE_FAILED");
    completeness.finishedAt = now().toISOString();
    return { items: [], unidentified: [], completeness, court };
  }

  const totalCount = Number(firstPage?.page?.totalCount);
  const pageSize = Number(firstPage?.page?.pageSize);
  if (
    !Number.isInteger(totalCount) ||
    totalCount < 0 ||
    !Number.isInteger(pageSize) ||
    pageSize <= 0
  ) {
    setOperationalError(
      completeness,
      errorWithCode("INVALID_PAGE_META", "첫 페이지의 페이지 정보가 유효하지 않습니다."),
      "INVALID_PAGE_META",
    );
    completeness.finishedAt = now().toISOString();
    return { items: [], unidentified: [], completeness, court };
  }

  completeness.countsKnown = true;
  completeness.totalCount = totalCount;
  completeness.pageSize = pageSize;
  completeness.expectedPages = Math.max(1, calculateTotalPages(totalCount, pageSize));
  pageResults.push(firstPage);
  successfulPages.push(1);
  fetchModes.push(firstPage._fetchMode || "http");

  for (let page = 2; page <= completeness.expectedPages; page += 1) {
    if (page > config.maxListCalls) {
      setOperationalError(
        completeness,
        errorWithCode(
          "CALL_LIMIT",
          `예상 ${completeness.expectedPages}페이지가 안전 호출 상한 ${config.maxListCalls}회를 초과합니다.`,
        ),
        "CALL_LIMIT",
      );
      break;
    }
    try {
      const result = assertNotBlocked(
        await fetchPageWithRetry(source, makeParams(page), config, sleep),
      );
      pageResults.push(result);
      successfulPages.push(page);
      fetchModes.push(result._fetchMode || "http");
    } catch (error) {
      if (isBlockedError(error) || ["CALL_LIMIT", "BUDGET_EXCEEDED"].includes(error?.code)) {
        setOperationalError(completeness, error, "PAGE_FETCH_FAILED");
        if (!completeness.failedPages.includes(page)) completeness.failedPages.push(page);
        break;
      }
      completeness.failedPages.push(page);
      setOperationalError(completeness, error, "PAGE_FETCH_FAILED");
    }
  }

  const merged = mergePageResults(pageResults);
  completeness.fetchedPages = successfulPages.length;
  completeness.fetchedRawCount = merged.fetchedRawCount;
  completeness.fetchedUniqueCount = merged.fetchedUniqueCount;
  completeness.missingCount = calculateMissingCount(
    completeness.totalCount,
    completeness.fetchedUniqueCount,
  );
  completeness.fetchMode = aggregateFetchMode(fetchModes);
  completeness.complete =
    !completeness.blocked &&
    completeness.errorCode === null &&
    completeness.failedPages.length === 0 &&
    completeness.fetchedPages === completeness.expectedPages &&
    completeness.missingCount === 0 &&
    completeness.fetchedUniqueCount === completeness.totalCount;

  if (!completeness.complete && !completeness.errorCode) {
    completeness.errorCode =
      completeness.fetchedUniqueCount !== completeness.totalCount
        ? "COUNT_MISMATCH"
        : "INCOMPLETE";
    completeness.errorMessage =
      completeness.fetchedUniqueCount !== completeness.totalCount
        ? `원본 총건수 ${completeness.totalCount}건과 고유 수집 ${completeness.fetchedUniqueCount}건이 일치하지 않습니다.`
        : "전체 페이지를 확인하지 못했습니다.";
  }
  completeness.finishedAt = now().toISOString();

  return {
    items: merged.items,
    unidentified: merged.unidentified,
    completeness,
    court,
  };
}

module.exports = {
  assertNotBlocked,
  blockedPayload,
  collectAllProperties,
  createFixtureSource,
  createLiveSource,
  createPacer,
  createWarmupServerError,
  delay,
  extractOperationalDiagnostics,
  findHongseongCourt,
  isBlockedError,
  isWarmupServerFailure,
  randomDelayMs,
};
