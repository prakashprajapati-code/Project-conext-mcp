import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const configPath = path.resolve(
  __dirname,
  "../../config/project.json"
);

const graphPath = path.resolve(
  __dirname,
  "../../tasks/shopdot-dependency-graph.json"
);

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts"
]);

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "logs",
  "uploads"
]);

const RUNTIME_EXCLUDES = [
  "app/database/migrations/",
  "app/database/seeders/"
];

const THRESHOLDS = {
  runtimeCoverage: 0.95,
  modelCoverage: 0.99,
  testCoverage: 0.95
};

async function walk(directory, files = []) {
  let entries;

  try {
    entries = await fs.readdir(directory, {
      withFileTypes: true
    });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(fullPath, files);
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function check(label, actual, expected, threshold) {
  const ok = threshold(actual, expected);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}: ${actual} / ${expected}`
  );
  return ok;
}

async function main() {
  const config = JSON.parse(
    await fs.readFile(configPath, "utf8")
  );

  const graph = JSON.parse(
    await fs.readFile(graphPath, "utf8")
  );

  const root = config.root;
  const nodes = new Set(graph.nodes);
  const testFiles = new Set(graph.testFiles ?? []);

  const allFiles = await walk(root);

  const runtimeFiles = allFiles
    .map(f => path.relative(root, f))
    .filter(rel => rel.startsWith("app/"))
    .filter(rel =>
      !RUNTIME_EXCLUDES.some(prefix => rel.startsWith(prefix))
    );

  const modelFiles = runtimeFiles.filter(rel =>
    /\.model\.[cm]?[jt]s$/.test(rel)
  );

  const diskTestFiles = allFiles
    .map(f => path.relative(root, f))
    .filter(rel => /\.(test|spec)\.[cm]?[jt]s$/.test(rel));

  const runtimeCovered = runtimeFiles.filter(rel =>
    nodes.has(rel)
  ).length;

  const modelsCovered = modelFiles.filter(rel =>
    nodes.has(rel)
  ).length;

  const testsCovered = diskTestFiles.filter(rel =>
    testFiles.has(rel)
  ).length;

  const dangling = graph.edges.filter(
    edge => !nodes.has(edge.to)
  );

  const escaping = graph.edges.filter(
    edge => edge.to.startsWith("..")
  );

  console.log("Graph data-quality report\n");

  let ok = true;

  ok =
    check(
      "Runtime coverage",
      runtimeCovered,
      runtimeFiles.length,
      (a, b) => a / b >= THRESHOLDS.runtimeCoverage
    ) && ok;

  ok =
    check(
      "Model coverage",
      modelsCovered,
      modelFiles.length,
      (a, b) => a / b >= THRESHOLDS.modelCoverage
    ) && ok;

  ok =
    check(
      "Test index coverage",
      testsCovered,
      diskTestFiles.length,
      (a, b) => b === 0 || a / b >= THRESHOLDS.testCoverage
    ) && ok;

  console.log(
    `${dangling.length === 0 ? "PASS" : "FAIL"}  Dangling edges: ${dangling.length}`
  );
  ok = ok && dangling.length === 0;

  console.log(
    `${escaping.length === 0 ? "PASS" : "FAIL"}  Escaping edges: ${escaping.length}`
  );
  ok = ok && escaping.length === 0;

  console.log(
    `\nRuntime:   ${runtimeCovered}/${runtimeFiles.length} (${pct(runtimeCovered / Math.max(runtimeFiles.length, 1))})`
  );
  console.log(
    `Models:    ${modelsCovered}/${modelFiles.length} (${pct(modelsCovered / Math.max(modelFiles.length, 1))})`
  );
  console.log(
    `Tests:     ${testsCovered}/${diskTestFiles.length} (${pct(testsCovered / Math.max(diskTestFiles.length, 1))})`
  );
  console.log(
    `Nodes:     ${nodes.size} | Edges: ${graph.edges.length}`
  );

  if (!ok) {
    console.error(
      "\nData quality is below threshold. Run `npm run graph`."
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nAll checks passed.");
}

main().catch(error => {
  console.error("Graph validation error:", error.message);
  process.exitCode = 1;
});
