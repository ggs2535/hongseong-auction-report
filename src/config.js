"use strict";

const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const COURT_SEARCH_URL =
  "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml&pgjId=151F00";

function readPositiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function resolveMode(argv = process.argv.slice(2), env = process.env) {
  if (argv.includes("--live")) return "live";
  if (argv.includes("--fixture")) return "fixture";
  const mode = String(env.AUCTION_MODE || "fixture").trim().toLowerCase();
  if (!["fixture", "live"].includes(mode)) {
    throw new TypeError("AUCTION_MODE must be either fixture or live");
  }
  return mode;
}

function createConfig(overrides = {}) {
  const env = overrides.env || process.env;
  const argv = overrides.argv || process.argv.slice(2);
  const mode = overrides.mode || resolveMode(argv, env);
  const rootDir = path.resolve(overrides.rootDir || env.PROJECT_ROOT || PROJECT_ROOT);
  const fixtureCanonicalOutput =
    String(env.FIXTURE_CANONICAL_OUTPUT || "").toLowerCase() === "true";
  const fixtureOutputRoot = path.join(rootDir, ".fixture-output");
  const storageWriteMode = String(env.STORAGE_WRITE_MODE || "atomic").toLowerCase();
  if (!["atomic", "direct"].includes(storageWriteMode)) {
    throw new TypeError("STORAGE_WRITE_MODE must be atomic or direct");
  }

  const config = {
    rootDir,
    mode,
    courtNameFragment: "홍성지원",
    pageSize: 100,
    maxListCalls: readPositiveInteger(env.MAX_LIST_CALLS, 10, "MAX_LIST_CALLS"),
    maxDetailCalls: readPositiveInteger(env.MAX_DETAIL_CALLS, 5, "MAX_DETAIL_CALLS"),
    minDelayMs: readPositiveInteger(env.MIN_DELAY_MS, 3000, "MIN_DELAY_MS"),
    jitterMs: readPositiveInteger(env.JITTER_MS, 2000, "JITTER_MS"),
    timeoutMs: readPositiveInteger(env.TIMEOUT_MS, 30000, "TIMEOUT_MS"),
    retryDelayMs: readPositiveInteger(env.RETRY_DELAY_MS, 30000, "RETRY_DELAY_MS"),
    fallbackOnBlocked: false,
    searchUrl: COURT_SEARCH_URL,
    dataDir: path.resolve(
      overrides.dataDir ||
        env.DATA_DIR ||
        (mode === "fixture" && !fixtureCanonicalOutput
          ? path.join(fixtureOutputRoot, "data")
          : path.join(rootDir, "data")),
    ),
    publicDir: path.resolve(
      overrides.publicDir ||
        env.PUBLIC_DIR ||
        (mode === "fixture" && !fixtureCanonicalOutput
          ? path.join(fixtureOutputRoot, "public")
          : path.join(rootDir, "public")),
    ),
    publicTemplateDir: path.join(rootDir, "public"),
    fixturesDir: path.resolve(
      overrides.fixturesDir || env.FIXTURES_DIR || path.join(rootDir, "fixtures"),
    ),
    timezone: "Asia/Seoul",
    storageWriteMode,
    fixtureCanonicalOutput,
  };

  if (config.pageSize !== 100) {
    throw new Error("pageSize is policy-locked to 100");
  }
  if (config.maxListCalls > 10) {
    throw new Error("MAX_LIST_CALLS cannot exceed the safety cap of 10");
  }
  if (config.minDelayMs < 3000 && mode === "live") {
    throw new Error("Live mode requires MIN_DELAY_MS of at least 3000");
  }
  if (config.jitterMs < 2000 && mode === "live") {
    throw new Error("Live mode requires JITTER_MS of at least 2000");
  }

  return Object.freeze(config);
}

module.exports = {
  COURT_SEARCH_URL,
  PROJECT_ROOT,
  createConfig,
  resolveMode,
};
