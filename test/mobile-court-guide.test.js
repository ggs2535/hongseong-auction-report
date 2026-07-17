"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8");
}

function loadAppFunctions(contextValues = {}) {
  const app = read("public/app.js");
  const marker = "  const payload = readPayload();";
  assert.ok(app.includes(marker), "앱 함수 테스트 지점을 찾지 못했습니다.");
  const instrumented = app.replace(
    marker,
    [
      "  globalThis.__parseCourtCaseNumber = parseCourtCaseNumber;",
      "  globalThis.__resolveCourtSearchUrl = resolveCourtSearchUrl;",
      "  globalThis.__copyText = copyText;",
      "  return;",
    ].join("\n"),
  );
  const context = vm.createContext({ URL, console, ...contextValues });
  vm.runInContext(instrumented, context);
  return context;
}

test("법원 사건번호는 홍성지원 타경 연도와 붙여넣을 번호로만 분리한다", () => {
  const context = loadAppFunctions();

  const compact = context.__parseCourtCaseNumber("20250130001175");
  assert.equal(compact.year, "2025");
  assert.equal(compact.serial, "1175");
  assert.equal(compact.display, "2025타경1175");

  const display = context.__parseCourtCaseNumber("2025 타경 001175");
  assert.equal(display.year, "2025");
  assert.equal(display.serial, "1175");
  assert.equal(context.__parseCourtCaseNumber("20250131001175"), null);
  assert.equal(context.__parseCourtCaseNumber("2025카합1175"), null);
});

test("법원 검색 링크는 확인된 공식 사건검색 화면만 허용한다", () => {
  const context = loadAppFunctions();
  const official =
    "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml&pgjId=151F00";

  assert.equal(context.__resolveCourtSearchUrl(official), official);
  assert.equal(
    context.__resolveCourtSearchUrl(
      "https://www.courtauction.go.kr.evil.example/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml&pgjId=151F00",
    ),
    official,
  );
  assert.equal(
    context.__resolveCourtSearchUrl(
      "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/OTHER.xml&pgjId=151F00",
    ),
    official,
  );
});

test("Clipboard API가 거절되면 모바일 Chrome용 복사 대체 경로를 시도한다", async () => {
  let fallbackCalled = false;
  let removed = false;
  const textarea = {
    style: {},
    setAttribute() {},
    select() {},
    remove() {
      removed = true;
    },
  };
  const context = loadAppFunctions({
    navigator: {
      clipboard: {
        async writeText() {
          throw new Error("permission denied");
        },
      },
    },
    window: { isSecureContext: true },
    document: {
      body: { append() {} },
      createElement() {
        return textarea;
      },
      execCommand(command) {
        fallbackCalled = command === "copy";
        return true;
      },
    },
  });

  await context.__copyText("1175");
  assert.equal(textarea.value, "1175");
  assert.equal(fallbackCalled, true);
  assert.equal(removed, true);
});

test("모바일 카드에는 분리된 복사 단계와 직접 법원 링크가 제공된다", () => {
  const app = read("public/app.js");
  const css = read("public/style.css");

  assert.match(app, /copy\.dataset\.copyValue = parsed\.serial/u);
  assert.match(app, /link\.target = "_blank"/u);
  assert.match(app, /link\.rel = "noopener noreferrer"/u);
  assert.match(app, /법원 화면에서 홍성지원과/u);
  assert.match(app, /결과 물건을 열면 사진과 비고를 볼 수 있습니다/u);
  assert.match(
    app,
    /card\.append\(top, location, values, remarks, mobileCourtGuide\(item\)\)/u,
  );
  assert.doesNotMatch(app, /window\.open\(/u);

  assert.match(
    css,
    /\.mobile-court-guide\s*\{\s*display: none;/u,
  );
  assert.match(
    css,
    /@media \(max-width: 720px\)[\s\S]*?\.mobile-court-guide\s*\{[\s\S]*?display: block;/u,
  );
  assert.match(
    css,
    /\.mobile-court-action\s*\{[\s\S]*?min-height: 2\.75rem;/u,
  );
});
