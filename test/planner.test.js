import test from "node:test";
import assert from "node:assert/strict";

import { Planner, layerOf } from "../src/agents/planner.js";

test("layerOf maps files to layers", () => {
  assert.equal(
    layerOf("app/api/v1/common/models/user.model.js"),
    "model"
  );
  assert.equal(
    layerOf("app/api/v1/modules/brand/repository/brand.repository.js"),
    "repository"
  );
  assert.equal(
    layerOf("app/api/v1/modules/brand/controller/brand.controller.js"),
    "controller"
  );
  assert.equal(
    layerOf("app/api/v1/modules/brand/routes/brand.route.js"),
    "route"
  );
  assert.equal(
    layerOf("app/api/v1/modules/brand/middleware/brand.dto.js"),
    "middleware"
  );
});

test("buildPlan produces ordered, reviewable steps", async () => {
  const planner = new Planner();

  const plan = await planner.buildPlan(
    "Add pagination to brand products API"
  );

  assert.equal(typeof plan.task, "string");
  assert.ok(plan.steps.length > 0);
  assert.ok(plan.files.length > 0);
  assert.ok(["low", "medium", "high"].includes(plan.risk));

  // Steps are ordered by layer: model before repository before controller.
  const layers = plan.steps.map(step => step.layer);
  const order = [
    "model", "migration", "validation", "repository",
    "service", "controller", "route", "middleware", "helper", "other"
  ];
  const indexes = layers.map(layer => order.indexOf(layer));

  for (let index = 1; index < indexes.length; index++) {
    assert.ok(indexes[index - 1] <= indexes[index]);
  }

  for (const step of plan.steps) {
    assert.equal(typeof step.action, "string");
    assert.equal(typeof step.file, "string");
  }
});

test("buildPlan rejects an empty task", async () => {
  const planner = new Planner();

  await assert.rejects(
    () => planner.buildPlan("   "),
    /non-empty task/
  );
});
