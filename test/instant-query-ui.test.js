"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

test("모바일 보고서는 토큰 없이 소유자 전용 즉시 조회 요청 링크를 제공한다", () => {
  const html = read("public/index.html");
  const match = html.match(
    /id="instant-query-link"[\s\S]*?href="([^"]+)"/u,
  );
  assert.ok(match, "즉시 조회 요청 링크가 필요합니다.");

  const url = new URL(match[1].replaceAll("&amp;", "&"));
  assert.equal(url.origin, "https://github.com");
  assert.equal(
    url.pathname,
    "/ggs2535/hongseong-auction-report/issues/new",
  );
  assert.equal(url.searchParams.get("title"), "[즉시조회]");
  assert.match(url.searchParams.get("body"), /휴대폰 보고서/u);
  assert.match(html, /id="refresh-report-button"/u);
  assert.match(
    html,
    /id="instant-query-status"[\s\S]*?aria-live="polite"/u,
  );
  assert.match(html, /aria-label="즉시 조회 요청 \(새 창\)"/u);
  assert.match(html, /aria-label="실행 상태 보기 \(새 창\)"/u);
  assert.match(html, /app\.js\?v=3/u);
  assert.match(html, /style\.css\?v=3/u);
  assert.doesNotMatch(
    html,
    /(?:github_pat_|ghp_|authorization\s*:|bearer\s+)/iu,
  );
});

test("최신 결과 확인은 no-store 요청과 명시적 상태 안내를 사용한다", () => {
  const app = read("public/app.js");
  assert.match(app, /url\.searchParams\.set\("reportRefresh"/u);
  assert.match(app, /fetch\(url, \{ cache: "no-store" \}\)/u);
  assert.match(app, /new DOMParser\(\)/u);
  assert.match(app, /button\.setAttribute\("aria-busy", "true"\)/u);
  assert.match(app, /현재 화면이 최신입니다/u);
  assert.match(app, /오프라인에서는 새 결과를 확인할 수 없습니다/u);
  assert.match(app, /nextTimestamp > currentTimestamp/u);
  assert.match(app, /canonicalUrl\.search = ""/u);
  assert.match(app, /window\.location\.replace\(canonicalUrl\.href\)/u);
});

test("서비스 워커는 명시적 새로고침에 오프라인 cache를 최신처럼 반환하지 않는다", () => {
  const worker = read("public/sw.js");
  assert.match(worker, /STATIC_CACHE_NAME/u);
  assert.match(worker, /static-v3/u);
  assert.match(worker, /\.\/app\.js\?v=3/u);
  assert.match(worker, /\.\/style\.css\?v=3/u);
  assert.match(worker, /REPORT_CACHE_NAME/u);
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\)/u);
  assert.match(worker, /async function preservePreviousReport/u);
  assert.match(worker, /async function findPreviousSafeReport/u);
  assert.match(worker, /cacheSafeReport\(cache, previousReport\)/u);
  assert.match(worker, /async function canDeletePreviousCache/u);
  assert.match(worker, /if \(await canDeletePreviousCache\(key\)\)/u);
  assert.match(worker, /async function networkOnlyReport/u);
  const refreshBranch = worker.indexOf('url.searchParams.has("reportRefresh")');
  const navigationBranch = worker.indexOf('request.mode === "navigate"');
  assert.ok(refreshBranch >= 0);
  assert.ok(navigationBranch > refreshBranch);
  assert.match(worker, /networkOnlyReport\(request\)/u);
  assert.match(worker, /status: 503/u);
  assert.match(worker, /event\.waitUntil\(network/u);
  assert.match(worker, /cache write failure must not hide/u);
  assert.match(worker, /Continue online even if cache storage is unavailable/u);
});

test("즉시 조회 컨트롤은 휴대폰 폭에서 전체 너비와 터치 영역을 확보한다", () => {
  const css = read("public/style.css");
  assert.match(css, /\.button-query,\s*\.button-secondary[\s\S]*?min-height: 2\.8rem/u);
  assert.match(
    css,
    /@media \(max-width: 390px\)[\s\S]*?\.instant-query-actions \.button[\s\S]*?width: 100%/u,
  );
});

test("불완전 경고는 오류 코드, HTTP 상태, 메시지와 원본 경로를 안전하게 표시한다", () => {
  const html = read("public/index.html");
  for (const id of [
    "warning-error-details",
    "warning-error-summary",
    "warning-error-message",
    "warning-error-path-row",
    "warning-error-path",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"));
  }

  const app = read("public/app.js");
  const marker = "  const payload = readPayload();";
  assert.ok(app.includes(marker), "진단 함수 테스트 지점을 찾지 못했습니다.");
  const instrumented = app.replace(
    marker,
    "  globalThis.__buildFailureDiagnostic = buildFailureDiagnostic;\n  return;",
  );
  const context = vm.createContext({ URL, console });
  vm.runInContext(instrumented, context);

  const hostileMessage = 'Court Auction request failed <img src=x>';
  const diagnostic = context.__buildFailureDiagnostic({
    complete: false,
    errorCode: "UPSTREAM_ERROR",
    errorStatusCode: 500,
    upstreamUrl:
      "https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on?token=do-not-display",
    upstreamMessage: "Temporary server failure <script>",
    errorMessage: hostileMessage,
  });
  assert.equal(
    diagnostic.summary,
    "법원 서버 오류 · HTTP 500 · UPSTREAM_ERROR",
  );
  assert.equal(
    diagnostic.message,
    `Temporary server failure <script> · ${hostileMessage}`,
  );
  assert.equal(
    diagnostic.originalPath,
    "/pgj/pgjsearch/searchControllerMain.on",
  );

  assert.match(app, /completeness\?\.errorCode/u);
  assert.match(app, /completeness\?\.errorStatusCode/u);
  assert.match(app, /completeness\?\.upstreamUrl/u);
  assert.match(app, /completeness\?\.upstreamMessage/u);
  assert.match(app, /completeness\?\.errorMessage/u);
  assert.match(app, /setText\("warning-error-message", diagnostic\.message\)/u);
  assert.match(app, /setText\("warning-error-path", diagnostic\.originalPath\)/u);
  assert.doesNotMatch(app, /\.innerHTML\s*=/u);
});
