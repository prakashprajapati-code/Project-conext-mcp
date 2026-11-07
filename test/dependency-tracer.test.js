import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DependencyTracer } from "../src/context/dependency-tracer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = path.resolve(__dirname, "fixtures/repo");

function edgeKey(edge) {
  return `${edge.from}->${edge.to}`;
}

async function trace() {
  const tracer = new DependencyTracer(REPO_ROOT);
  return tracer.traceGraph("server.js");
}

test("resolves literal relative imports", async () => {
  const graph = await trace();
  const edges = graph.edges.map(edgeKey);

  assert.ok(graph.nodes.includes("server.js"));
  assert.ok(graph.nodes.includes("a.js"));
  assert.ok(graph.nodes.includes("b.js"));

  assert.ok(edges.includes("server.js->a.js"));
  assert.ok(edges.includes("a.js->b.js"));
});

test("expands dynamic directory loaders (models/index.js)", async () => {
  const graph = await trace();
  const edges = graph.edges.map(edgeKey);

  assert.ok(graph.nodes.includes("models/index.js"));
  assert.ok(graph.nodes.includes("models/user.model.js"));
  assert.ok(graph.nodes.includes("models/order.model.js"));

  assert.ok(edges.includes("models/index.js->models/user.model.js"));
  assert.ok(edges.includes("models/index.js->models/order.model.js"));
});

test("handles import cycles without duplicating edges", async () => {
  const graph = await trace();
  const keys = graph.edges.map(edgeKey);

  assert.ok(keys.includes("a.js->b.js"));
  assert.ok(keys.includes("b.js->a.js"));
  assert.equal(new Set(keys).size, keys.length);
});

test("never records edges that escape the project root", async () => {
  const graph = await trace();

  assert.ok(!graph.nodes.includes("../outside/evil.js"));
  assert.ok(
    graph.edges.every(edge => !edge.to.startsWith("..")),
    "no edge should point outside the project root"
  );
});

test("classifies file types", async () => {
  const graph = await trace();

  assert.equal(graph.types["models/user.model.js"], "model");
  assert.equal(graph.types["models/index.js"], "model");
  assert.equal(graph.types["a.js"], "runtime");
});

test("produces deterministic output", async () => {
  const first = await trace();
  const second = await trace();

  assert.deepEqual(first.nodes, second.nodes);
  assert.deepEqual(first.edges, second.edges);
  assert.deepEqual(first.types, second.types);
});

test("sweep adds unreachable files as nodes", async () => {
  const graph = await trace();

  const before = new Set(graph.nodes);

  // Create a file that is not imported anywhere.
  const { writeFile, rm } = await import("node:fs/promises");
  const orphan = path.join(REPO_ROOT, "orphan.js");

  await writeFile(orphan, "module.exports = {};\n");

  try {
    const tracer = new DependencyTracer(REPO_ROOT);
    await tracer.sweep(graph, { roots: ["."] });

    assert.ok(!before.has("orphan.js"));
    assert.ok(graph.nodes.includes("orphan.js"));
    assert.equal(graph.types["orphan.js"], "runtime");
  } finally {
    await rm(orphan, { force: true });
  }
});
