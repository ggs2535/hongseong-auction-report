"use strict";

const CACHE_NAME = "hongseong-auction-report-v1";
const STATIC_ASSETS = [
  "./app.js",
  "./style.css",
  "./manifest.webmanifest",
  "./icon.svg",
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
  if (!response?.ok) return false;
  const html = await response.clone().text();
  if (!isSafeReportHtml(html)) return false;
  await cache.put(REPORT_CACHE_KEY, response.clone());
  return true;
}

async function seedReportCache(cache) {
  try {
    const response = await fetch(REPORT_CACHE_KEY, { cache: "no-store" });
    await cacheSafeReport(cache, response);
  } catch {
    // The static shell still installs. A later successful navigation can seed it.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS);
      await seedReportCache(cache);
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirstReport(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      await cacheSafeReport(cache, response);
      return response;
    }
  } catch {
    // Fall through to the most recent complete report.
  }

  const cachedReport = await cache.match(REPORT_CACHE_KEY);
  if (cachedReport) return cachedReport;

  return new Response(
    "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>오프라인</title><body><main><h1>저장된 정상 보고서가 없습니다.</h1><p>인터넷에 연결한 뒤 다시 열어 주세요.</p></main></body></html>",
    {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html")
  ) {
    event.respondWith(networkFirstReport(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
