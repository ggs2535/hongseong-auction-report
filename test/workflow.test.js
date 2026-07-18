"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const YAML = require("yaml");

test("예약 workflow는 낮 시간 매시간 실행하고 즉시조회 트리거를 제공하지 않는다", () => {
  const workflowPath = path.resolve(
    __dirname,
    "../.github/workflows/update-auction.yml",
  );
  const workflowText = fs.readFileSync(workflowPath, "utf8");
  const workflow = YAML.parse(workflowText);

  assert.deepEqual(Object.keys(workflow.on), ["schedule"]);
  assert.deepEqual(workflow.on.schedule, [
    {
      cron: "37 9-18 * * *",
      timezone: "Asia/Seoul",
    },
  ]);
  assert.deepEqual(workflow.concurrency, {
    group: "hongseong-auction-report-update",
    "cancel-in-progress": false,
  });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ["gate", "update", "deploy"]);
  assert.doesNotMatch(
    workflowText,
    /workflow_dispatch|issues:|event\.issue|finish_instant_query|\[즉시조회\]/u,
  );

  const gate = workflow.jobs.gate;
  const update = workflow.jobs.update;
  const deploy = workflow.jobs.deploy;
  assert.deepEqual(gate.permissions, { contents: "read" });
  assert.deepEqual(gate.outputs, {
    allowed: "${{ steps.policy.outputs.allowed }}",
    reason: "${{ steps.policy.outputs.reason }}",
    wait_seconds: "${{ steps.policy.outputs.wait_seconds }}",
  });
  assert.equal(gate.steps[0].with.ref, "main");
  assert.match(gate.steps.at(-1).run, /query-safety-policy\.js/u);

  assert.equal(update.needs, "gate");
  assert.equal(update.if, "needs.gate.outputs.allowed == 'true'");
  assert.equal(update.steps[0].with.ref, "main");
  assert.deepEqual(update.permissions, { contents: "write" });
  assert.equal(update.outputs, undefined);

  const stepText = update.steps
    .map((step) => `${step.name || ""} ${step.run || ""} ${step.uses || ""}`)
    .join("\n");
  assert.match(stepText, /npm ci/u);
  assert.match(
    stepText,
    /node node_modules\/playwright\/cli\.js install --with-deps chromium/u,
  );
  assert.match(stepText, /npm test/u);
  assert.match(stepText, /npm run update/u);
  assert.match(stepText, /query-safety-state\.js reserve/u);
  assert.match(stepText, /query-safety-state\.js finalize/u);
  assert.match(stepText, /data\/query-safety-state\.json/u);
  assert.match(stepText, /reserve auction query/u);
  assert.match(stepText, /record auction query outcome/u);
  assert.match(stepText, /git add -- data public/u);
  assert.match(stepText, /upload-pages-artifact@v5/u);
  assert.doesNotMatch(stepText, /instant-query|gh api|issues\/\$\{ISSUE_NUMBER\}/u);

  assert.equal(deploy.needs, "update");
  assert.deepEqual(deploy.permissions, {
    contents: "read",
    pages: "write",
    "id-token": "write",
  });
  assert.match(
    deploy.steps.map((step) => step.uses || "").join("\n"),
    /deploy-pages@v5/u,
  );
});
