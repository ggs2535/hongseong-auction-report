"use strict";

const CACHE_PREFIX = "hongseong-auction-report-";
const STATIC_CACHE_NAME = `${CACHE_PREFIX}static-v3`;
const REPORT_CACHE_NAME = `${CACHE_PREFIX}report`;
const STATIC_ASSETS = [
  "./app.js?v=3",
  "./style.css?v=3",
  "./manifest.webmanifest?v=2",
  "./icon.svg?v=2",
];
const REPORT_CACHE_KEY = "./index.html";

function isSafeReportHtml(html) {
  const match = html.match(
    /<script\s+id=["']report-data["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match) return false;
  try {
    const payload = JSON.parse(match[1]);
    return (
      payload.cacheSafe === true &&
      payload.display?.completeness?.complete === true
    );
  } catch {
    return false;
  }
}

async function cacheSafeReport(cache, response) {
  if (!cache || !response?.ok) return false;
  const html = await response.clone().text();
  if (!isSafeReportHtml(html)) return false;
  await cache.put(REPORT_CACHE_KEY, response.clone());
  return true;
}

async function seedReportCache(cache) {
  try {
    const response = await fetch(REPORT_CACHE_KEY, { cache: "no-store" });
    return await cacheSafeReport(cache, response);
  } catch {
    // The static shell still installs. A later successful navigation can seed it.
    return false;
  }
}

async function findPreviousSafeReport() {
  const keys = await caches.keys();
  for (const key of keys) {
    if (
      !key.startsWith(CACHE_PREFIX) ||
      [STATIC_CACHE_NAME, REPORT_CACHE_NAME].includes(key)
    ) {
      continue;
    }
    try {
      const previousCache = await caches.open(key);
      const previousReport = await previousCache.match(REPORT_CACHE_KEY);
      if (await isSafeReportResponse(previousReport)) return previousReport;
    } catch {
      // Continue searching older app caches.
    }
  }
  return null;
}

async function preservePreviousReport(cache) {
  if (!cache) return false;
  if (await cache.match(REPORT_CACHE_KEY)) return true;
  const previousReport = await findPreviousSafeReport();
  if (previousReport && (await cacheSafeReport(cache, previousReport))) {
    return true;
  }
  return false;
}

async function prepareReportCache(cache) {
  if (await seedReportCache(cache)) return;
  await preservePreviousReport(cache);
}

async function isSafeReportResponse(response) {
  if (!response?.ok) return false;
  try {
    return isSafeReportHtml(await response.clone().text());
  } catch {
    return false;
  }
}

async function staticCacheIsReady() {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const matches = await Promise.all(
    STATIC_ASSETS.map((asset) => cache.match(asset)),
  );
  return matches.every(Boolean);
}

async function canDeletePreviousCache(key) {
  try {
    if (!(await staticCacheIsReady())) return false;
    const previousCache = await caches.open(key);
    const previousReport = await previousCache.match(REPORT_CACHE_KEY);
    if (!(await isSafeReportResponse(previousReport))) return true;

    const reportCache = await caches.open(REPORT_CACHE_NAME);
    const preservedReport = await reportCache.match(REPORT_CACHE_KEY);
    return isSafeReportResponse(preservedReport);
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .open(STATIC_CACHE_NAME)
        .then((cache) => cache.addAll(STATIC_ASSETS))
        .catch(() => undefined),
      caches
        .open(REPORT_CACHE_NAME)
        .then((cache) => prepareReportCache(cache))
        .catch(() => undefined),
    ]).then(async () => {
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        for (const key of keys) {
          if (
            !key.startsWith(CACHE_PREFIX) ||
            [STATIC_CACHE_NAME, REPORT_CACHE_NAME].includes(key)
          ) {
            continue;
          }
          if (await canDeletePreviousCache(key)) await caches.delete(key);
        }
      })
      .then(() => self.clients.claim()),
  );
});

async function networkFirstReport(request) {
  let cache = null;
  try {
    cache = await caches.open(REPORT_CACHE_NAME);
  } catch {
    // Continue online even if cache storage is unavailable.
  }
  let response = null;
  try {
    response = await fetch(request, { cache: "no-store" });
  } catch {
    // Fall through to the most recent complete report.
  }
  if (response?.ok) {
    try {
      await cacheSafeReport(cache, response);
    } catch {
      // A cache write failure must not hide a valid network response.
    }
    return response;
  }

  const cachedReport = cache
    ? await cache.match(REPORT_CACHE_KEY).catch(() => null)
    : null;
  if (cachedReport) return cachedReport;
  const previousReport = await findPreviousSafeReport().catch(() => null);
  if (previousReport) return previousReport;

  return new Response(
    "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>오프라인</title><body><main><h1>저장된 정상 보고서가 없습니다.</h1><p>인터넷에 연결한 뒤 다시 열어 주세요.</p></main></body></html>",
    {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

async function networkOnlyReport(request) {
  let cache = null;
  try {
    cache = await caches.open(REPORT_CACHE_NAME);
  } catch {
    // Continue online even if cache storage is unavailable.
  }
  let response;
  try {
    response = await fetch(request, { cache: "no-store" });
  } catch {
    return new Response("최신 보고서를 확인하려면 인터넷 연결이 필요합니다.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (response.ok) {
    try {
      await cacheSafeReport(cache, response);
    } catch {
      // A cache write failure must not hide a valid network response.
    }
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  let cache = null;
  let cached = null;
  try {
    cache = await caches.open(STATIC_CACHE_NAME);
    cached = await cache.match(request);
  } catch {
    // Continue with the network when cache storage is unavailable.
  }
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && cache) {
        try {
          await cache.put(request, response.clone());
        } catch {
          // Return the network response even when cache storage is full.
        }
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network.then(() => undefined));
    return cached;
  }
  const networkResponse = await network;
  if (networkResponse) return networkResponse;

  try {
    const cleanUrl = new URL(request.url);
    cleanUrl.search = "";
    const keys = await caches.keys();
    for (const key of keys) {
      if (
        !key.startsWith(CACHE_PREFIX) ||
        [STATIC_CACHE_NAME, REPORT_CACHE_NAME].includes(key)
      ) {
        continue;
      }
      const previousCache = await caches.open(key);
      const previousAsset =
        (await previousCache.match(request)) ||
        (await previousCache.match(cleanUrl.href));
      if (previousAsset) return previousAsset;
    }
  } catch {
    // No previous static asset is available.
  }
  return Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.searchParams.has("reportRefresh")) {
    event.respondWith(networkOnlyReport(request));
    return;
  }

  if (
    request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html")
  ) {
    event.respondWith(networkFirstReport(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});
