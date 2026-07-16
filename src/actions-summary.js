"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function tableValue(value) {
  if (value === null || value === undefined || value === "") return "산정 불가";
  return String(value).replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function createSummary({ latest, lastGood, testOutcome, outcome, logTail }) {
  const completeness = latest?.completeness || {};
  const lines = [
    "## 홍성지원 경매 보고서 갱신",
    "",
    "| 항목 | 값 |",
    "| --- | --- |",
    `| 테스트 단계 | ${tableValue(testOutcome || "unknown")} |`,
    `| 수집 단계 | ${tableValue(outcome || "unknown")} |`,
    `| 전체조회 완료 | ${tableValue(completeness.complete)} |`,
    `| 차단 감지 | ${tableValue(completeness.blocked)} |`,
    `| 오류 코드 | ${tableValue(completeness.errorCode)} |`,
    `| 오류 메시지 | ${tableValue(completeness.errorMessage)} |`,
    `| 원본 전체 건수 | ${tableValue(completeness.totalCount)} |`,
    `| 확인 페이지 | ${tableValue(completeness.fetchedPages)}/${tableValue(completeness.expectedPages)} |`,
    `| 고유 확인 건수 | ${tableValue(completeness.fetchedUniqueCount)} |`,
    `| 미확인 건수 | ${tableValue(completeness.missingCount)} |`,
    `| 마지막 정상 전체조회 | ${tableValue(lastGood?.generatedAt)} |`,
    "",
  ];

  if (logTail) {
    lines.push(
      "<details><summary>수집 로그 마지막 부분</summary>",
      "",
      "```text",
      logTail,
      "```",
      "</details>",
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const root = path.resolve(__dirname, "..");
  const latest = readJsonIfPresent(path.join(root, "data", "latest.json"));
  const storedLastGood = readJsonIfPresent(path.join(root, "data", "last-good.json"));
  const lastGood =
    latest?.source?.mode &&
    latest.source.mode === storedLastGood?.source?.mode
      ? storedLastGood
      : null;
  const logParts = [];
  for (const logName of ["test.log", "update.log"]) {
    try {
      const tail = fs
        .readFileSync(path.join(root, logName), "utf8")
        .split(/\r?\n/)
        .slice(-40)
        .join("\n");
      logParts.push(`--- ${logName} ---\n${tail}`);
    } catch {
      // A later step may have been skipped before its log was created.
    }
  }
  const logTail = logParts.join("\n").slice(-12000);
  const summary = createSummary({
    latest,
    lastGood,
    testOutcome: process.env.TEST_OUTCOME,
    outcome: process.env.UPDATE_OUTCOME,
    logTail,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  } else {
    process.stdout.write(summary);
  }
}

if (require.main === module) main();

module.exports = { createSummary, tableValue };
