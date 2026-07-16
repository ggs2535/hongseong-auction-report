"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const YAML = require("yaml");

function compact(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

test("GitHub Actions workflow YAML이 유효하고 필수 단계와 최소 권한을 갖는다", () => {
  const workflowPath = path.resolve(
    __dirname,
    "../.github/workflows/update-auction.yml",
  );
  const workflow = YAML.parse(fs.readFileSync(workflowPath, "utf8"));

  assert.equal(workflow.on.schedule[0].cron, "37 9 * * *");
  assert.deepEqual(workflow.on.workflow_dispatch, null);
  assert.deepEqual(workflow.on.issues, { types: ["opened"] });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const concurrencyGroup = compact(workflow.concurrency.group);
  assert.match(concurrencyGroup, /hongseong-auction-report-update/u);
  assert.match(
    concurrencyGroup,
    /format\('ignored-issue-\{0\}', github\.run_id\)/u,
  );
  assert.match(
    concurrencyGroup,
    /github\.event\.issue\.user\.login == 'ggs2535'/u,
  );
  assert.deepEqual(workflow.permissions, {});

  const gate = workflow.jobs.gate;
  const update = workflow.jobs.update;
  const deploy = workflow.jobs.deploy;
  const finish = workflow.jobs.finish_instant_query;
  assert.deepEqual(gate.permissions, { contents: "read" });
  assert.deepEqual(gate.outputs, {
    allowed: "${{ steps.policy.outputs.allowed }}",
    immediate: "${{ steps.policy.outputs.immediate }}",
    reason: "${{ steps.policy.outputs.reason }}",
    wait_seconds: "${{ steps.policy.outputs.wait_seconds }}",
  });
  assert.equal(gate.steps[0].with.ref, "main");
  const gateIf = compact(gate.if);
  for (const required of [
    "github.event_name != 'issues'",
    "github.repository == 'ggs2535/hongseong-auction-report'",
    "github.actor == 'ggs2535'",
    "github.triggering_actor == 'ggs2535'",
    "github.event.issue.user.login == 'ggs2535'",
    "github.event.issue.author_association == 'OWNER'",
    "github.event.issue.title == '[즉시조회]'",
  ]) {
    assert.match(gateIf, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }

  assert.equal(update.needs, "gate");
  assert.equal(update.if, "needs.gate.outputs.allowed == 'true'");
  assert.equal(update.steps[0].with.ref, "main");
  assert.deepEqual(update.permissions, { contents: "write" });
  assert.deepEqual(update.outputs, {
    report_complete: "${{ steps.instant_outcome.outputs.complete }}",
    report_blocked: "${{ steps.instant_outcome.outputs.blocked }}",
    report_error_code: "${{ steps.instant_outcome.outputs.error_code }}",
    report_result: "${{ steps.instant_outcome.outputs.result }}",
  });
  assert.deepEqual(deploy.permissions, {
    contents: "read",
    pages: "write",
    "id-token": "write",
  });
  assert.equal(deploy.needs, "update");
  assert.deepEqual(finish.needs, ["gate", "update", "deploy"]);
  assert.deepEqual(finish.permissions, { issues: "write" });
  const finishIf = compact(finish.if);
  assert.match(finishIf, /always\(\)/u);
  assert.match(finishIf, /github\.event_name == 'issues'/u);
  assert.match(
    finishIf,
    /github\.event\.issue\.title == '\[즉시조회\]'/u,
  );

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
  assert.match(stepText, /instant-query-state\.js reserve/u);
  assert.match(stepText, /instant-query-state\.js finalize/u);
  assert.match(stepText, /reserve auction query/u);
  assert.match(stepText, /record auction query outcome/u);
  assert.match(stepText, /git add -- data public/u);
  assert.match(stepText, /upload-pages-artifact@v5/u);
  assert.match(
    deploy.steps.map((step) => step.uses || "").join("\n"),
    /deploy-pages@v5/u,
  );

  const finishScript = finish.steps.map((step) => step.run || "").join("\n");
  assert.match(finishScript, /gh api --method POST/u);
  assert.match(finishScript, /gh api --method PATCH/u);
  assert.match(finishScript, /state_reason=completed/u);
  assert.match(finishScript, /POLICY_ALLOWED/u);
  assert.match(finishScript, /UPDATE_RESULT/u);
  assert.match(finishScript, /DEPLOY_RESULT/u);
  assert.match(finishScript, /REPORT_COMPLETE/u);
  assert.match(finishScript, /REPORT_BLOCKED/u);
  assert.match(finishScript, /state_unavailable/u);
  assert.match(finishScript, /uncertain_today/u);
  assert.ok(
    finishScript.indexOf('[[ "${REPORT_BLOCKED}" == "true" ]]') <
      finishScript.indexOf('[[ "${UPDATE_RESULT}" == "success"'),
  );
  assert.doesNotMatch(finishScript, /event\.issue\.(title|body)/u);
});
