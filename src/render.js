"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const REPORT_DATA_START = "<!-- REPORT_DATA_START -->";
const REPORT_DATA_END = "<!-- REPORT_DATA_END -->";

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function isCompleteReport(report) {
  return report?.completeness?.complete === true;
}

function reportSummary(report) {
  if (!report) return null;
  return {
    generatedAt: report.generatedAt || "",
    reportDate: report.reportDate || "",
    completeness: report.completeness || {},
    source: report.source || {},
  };
}

function displayProjection(report) {
  if (!report) return null;
  return {
    generatedAt: report.generatedAt || "",
    reportDate: report.reportDate || "",
    completeness: report.completeness || {},
    source: report.source || {},
    items: [
      ...(Array.isArray(report.items) ? report.items : []),
      ...(Array.isArray(report.withdrawnItems) ? report.withdrawnItems : []),
    ],
    reviewItems: Array.isArray(report.reviewItems) ? report.reviewItems : [],
    detailSummary: report.detailSummary || {},
  };
}

function buildClientPayload(latest, lastGood) {
  const latestComplete = isCompleteReport(latest);
  const validLastGood = isCompleteReport(lastGood) ? lastGood : null;
  const displayReport = latestComplete ? latest : validLastGood;
  const displaySource = latestComplete
    ? "latest"
    : validLastGood
      ? "last-good"
      : "none";

  return {
    schemaVersion: 1,
    latest: reportSummary(latest),
    display: displayProjection(displayReport),
    displaySource,
    lastGoodGeneratedAt: validLastGood?.generatedAt || null,
    cacheSafe:
      latestComplete && String(latest?.source?.mode || "") === "live",
  };
}

function normalizeCreateArguments(latestOrOptions, maybeLastGood) {
  if (
    latestOrOptions &&
    typeof latestOrOptions === "object" &&
    (Object.hasOwn(latestOrOptions, "latest") ||
      Object.hasOwn(latestOrOptions, "lastGood"))
  ) {
    return {
      latest: latestOrOptions.latest || null,
      lastGood: latestOrOptions.lastGood || null,
    };
  }
  return {
    latest: latestOrOptions || null,
    lastGood: maybeLastGood || null,
  };
}

function createReportHtml(template, latestOrOptions, maybeLastGood) {
  if (typeof template !== "string") {
    throw new TypeError("index.html template must be a string");
  }

  const startIndex = template.indexOf(REPORT_DATA_START);
  const endIndex = template.indexOf(REPORT_DATA_END);
  if (
    startIndex < 0 ||
    endIndex < 0 ||
    endIndex <= startIndex + REPORT_DATA_START.length
  ) {
    throw new Error("index.html is missing stable report data markers");
  }

  const { latest, lastGood } = normalizeCreateArguments(
    latestOrOptions,
    maybeLastGood,
  );
  const payload = buildClientPayload(latest, lastGood);
  const block = [
    REPORT_DATA_START,
    `<script id="report-data" type="application/json">${safeJson(payload)}</script>`,
    REPORT_DATA_END,
  ].join("\n");

  return [
    template.slice(0, startIndex),
    block,
    template.slice(endIndex + REPORT_DATA_END.length),
  ].join("");
}

async function renderReport({ latest, lastGood, publicDir, templateDir = publicDir }) {
  if (!publicDir) throw new TypeError("publicDir is required");

  const indexPath = path.join(publicDir, "index.html");
  const template = await fs.readFile(path.join(templateDir, "index.html"), "utf8");
  const html = createReportHtml(template, { latest, lastGood });
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(indexPath, html, "utf8");

  const payload = buildClientPayload(latest, lastGood);
  return {
    indexPath,
    displaySource: payload.displaySource,
    cacheSafe: payload.cacheSafe,
  };
}

module.exports = {
  REPORT_DATA_END,
  REPORT_DATA_START,
  buildClientPayload,
  createReportHtml,
  renderReport,
  safeJson,
};
