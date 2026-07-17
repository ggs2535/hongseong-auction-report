"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const YAML = require("yaml");

const workflowPath = path.resolve(
  __dirname,
  "..",
  ".github",
  "workflows",
  "deploy-pages.yml",
);

test("프론트엔드 배포는 법원 조회 없이 검증된 public만 Pages에 올린다", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const workflow = YAML.parse(source);

  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.ok(workflow.on.push.paths.includes("public/**"));
  assert.ok(
    workflow.on.push.paths.includes(".github/workflows/deploy-pages.yml"),
  );
  assert.equal(workflow.concurrency["cancel-in-progress"], false);

  const verify = workflow.jobs.verify;
  assert.deepEqual(verify.permissions, { contents: "read" });
  assert.ok(verify.steps.some((step) => step.run === "npm run check"));
  const upload = verify.steps.find(
    (step) => step.uses === "actions/upload-pages-artifact@v5",
  );
  assert.equal(upload.with.path, "public");

  const deploy = workflow.jobs.deploy;
  assert.equal(deploy.needs, "verify");
  assert.deepEqual(deploy.permissions, {
    contents: "read",
    pages: "write",
    "id-token": "write",
  });
  assert.ok(
    deploy.steps.some((step) => step.uses === "actions/deploy-pages@v5"),
  );
  assert.doesNotMatch(source, /update:live|AUCTION_MODE|courtauction/iu);
});
