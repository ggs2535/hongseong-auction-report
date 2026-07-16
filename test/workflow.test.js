"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const YAML = require("yaml");

test("GitHub Actions workflow YAML이 유효하고 필수 단계와 최소 권한을 갖는다", () => {
  const workflowPath = path.resolve(
    __dirname,
    "../.github/workflows/update-auction.yml",
  );
  const workflow = YAML.parse(fs.readFileSync(workflowPath, "utf8"));

  assert.equal(workflow.on.schedule[0].cron, "37 9 * * *");
  assert.deepEqual(workflow.on.workflow_dispatch, null);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(workflow.permissions, {});

  const update = workflow.jobs.update;
  const deploy = workflow.jobs.deploy;
  assert.deepEqual(update.permissions, { contents: "write" });
  assert.deepEqual(deploy.permissions, {
    contents: "read",
    pages: "write",
    "id-token": "write",
  });
  assert.equal(deploy.needs, "update");

  const stepText = update.steps
    .map((step) => `${step.name || ""} ${step.run || ""} ${step.uses || ""}`)
    .join("\n");
  assert.match(stepText, /npm ci/u);
  assert.match(stepText, /playwright install --with-deps chromium/u);
  assert.match(stepText, /npm test/u);
  assert.match(stepText, /npm run update/u);
  assert.match(stepText, /git add -- data public/u);
  assert.match(stepText, /upload-pages-artifact@v5/u);
  assert.match(
    deploy.steps.map((step) => step.uses || "").join("\n"),
    /deploy-pages@v5/u,
  );
});
