import test from "node:test";
import assert from "node:assert/strict";

import { Orchestrator } from "../src/agents/orchestrator.js";

function makePlan() {
  return {
    task: "task",
    steps: [{ id: 1, layer: "service", file: "a.js", action: "x", risk: "low" }],
    files: ["a.js"],
    tests: [],
    risk: "low"
  };
}

function makeExecutor() {
  const applied = [];

  return {
    applied,
    async applyEdits(edits) {
      applied.push(...edits.map(edit => edit.path));
      return {
        applied: edits.map(edit => edit.path),
        count: edits.length
      };
    }
  };
}

test("passes after fixing a failed attempt", async () => {
  const executor = makeExecutor();

  const testResults = [
    { passed: false, results: [{ command: "x", passed: false, code: 1 }] },
    { passed: true, results: [{ command: "x", passed: true, code: 0 }] }
  ];

  let runCount = 0;

  const orchestrator = new Orchestrator({
    planner: { buildPlan: async () => makePlan() },
    executor,
    testRunner: {
      run: async () =>
        testResults[Math.min(runCount++, testResults.length - 1)]
    },
    editProvider: async ({ attempt }) => [
      { path: "a.js", content: `attempt-${attempt}` }
    ],
    maxRetries: 2
  });

  const outcome = await orchestrator.run("task");

  assert.equal(outcome.status, "passed");
  assert.equal(outcome.attempt, 1);
  assert.deepEqual(executor.applied, ["a.js", "a.js"]);
});

test("escalates when the retry budget is exhausted", async () => {
  const orchestrator = new Orchestrator({
    planner: { buildPlan: async () => makePlan() },
    executor: makeExecutor(),
    testRunner: {
      run: async () => ({
        passed: false,
        results: [{ command: "x", passed: false, code: 1 }]
      })
    },
    editProvider: async () => [
      { path: "a.js", content: "still broken" }
    ],
    maxRetries: 2
  });

  const outcome = await orchestrator.run("task");

  assert.equal(outcome.status, "escalated");
  assert.equal(outcome.attempt, 3);
});

test("returns planned when the edit provider has nothing to apply", async () => {
  const orchestrator = new Orchestrator({
    planner: { buildPlan: async () => makePlan() },
    executor: makeExecutor(),
    testRunner: { run: async () => ({ passed: true, results: [] }) },
    editProvider: async () => null,
    maxRetries: 2
  });

  const outcome = await orchestrator.run("task");

  assert.equal(outcome.status, "planned");
});

test("rejects at the plan gate", async () => {
  const orchestrator = new Orchestrator({
    planner: { buildPlan: async () => makePlan() },
    executor: makeExecutor(),
    testRunner: { run: async () => ({ passed: true, results: [] }) },
    editProvider: async () => [],
    onGate: async ({ type }) => type !== "plan",
    maxRetries: 2
  });

  const outcome = await orchestrator.run("task");

  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.stage, "plan");
});
