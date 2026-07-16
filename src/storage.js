"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

async function readJson(filePath, options = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && options.allowMissing) return null;
    throw new Error(`JSON 파일을 읽지 못했습니다: ${filePath}`, { cause: error });
  }
}

async function writeJsonAtomic(filePath, value, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (options.writeMode === "direct") {
    await fs.writeFile(filePath, serialized, "utf8");
    return;
  }
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, serialized, "utf8");
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function dateInTimezone(date, timezone = "Asia/Seoul") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function loadLastGood(dataDir) {
  return readJson(path.join(dataDir, "last-good.json"), { allowMissing: true });
}

async function loadLatest(dataDir) {
  return readJson(path.join(dataDir, "latest.json"), { allowMissing: true });
}

async function saveReport(report, options) {
  const dataDir = options.dataDir;
  const timezone = options.timezone || "Asia/Seoul";
  const reportDate =
    report.reportDate || dateInTimezone(new Date(report.generatedAt), timezone);
  const historyDir = path.join(dataDir, "history");

  await fs.mkdir(historyDir, { recursive: true });
  const writeOptions = { writeMode: options.writeMode || "atomic" };
  await writeJsonAtomic(path.join(dataDir, "latest.json"), report, writeOptions);
  await writeJsonAtomic(
    path.join(historyDir, `${reportDate}.json`),
    report,
    writeOptions,
  );
  if (report.completeness?.complete === true) {
    await writeJsonAtomic(
      path.join(dataDir, "last-good.json"),
      report,
      writeOptions,
    );
  }

  return {
    latestPath: path.join(dataDir, "latest.json"),
    historyPath: path.join(historyDir, `${reportDate}.json`),
    lastGoodUpdated: report.completeness?.complete === true,
  };
}

module.exports = {
  dateInTimezone,
  loadLastGood,
  loadLatest,
  readJson,
  saveReport,
  writeJsonAtomic,
};
