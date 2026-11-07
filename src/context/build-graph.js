import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DependencyTracer } from "./dependency-tracer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const configPath = path.resolve(
  __dirname,
  "../../config/project.json"
);

const outputPath = path.resolve(
  __dirname,
  "../../tasks/shopdot-dependency-graph.json"
);

const checkOnly = process.argv.includes("--check");

function canonicalize(graph) {
  // Ignore timestamps so a freshness check compares real content only.
  return JSON.stringify({
    entry: graph.entry,
    nodes: graph.nodes,
    edges: graph.edges,
    types: graph.types ?? {},
    testFiles: graph.testFiles ?? []
  });
}

async function collectTestFiles(projectRoot, roots = ["tests", "test"]) {
  const found = [];

  const walk = async directory => {
    let entries;

    try {
      entries = await fs.readdir(directory, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        await walk(fullPath);
        continue;
      }

      if (/\.(test|spec)\.[cm]?[jt]s$/.test(entry.name)) {
        found.push(
          path.relative(projectRoot, fullPath)
        );
      }
    }
  };

  for (const root of roots) {
    await walk(path.resolve(projectRoot, root));
  }

  return found.sort();
}

async function main() {
  const config = JSON.parse(
    await fs.readFile(configPath, "utf8")
  );

  const entryFile = config.entry ?? "app/server.js";

  const tracer = new DependencyTracer(config.root);
  const graph = await tracer.traceGraph(entryFile);

  // Include app files that are not statically reachable (e.g. controllers
  // wired through route tables) so context matching is complete.
  await tracer.sweep(graph, {
    roots: ["app"],
    ignorePaths: [
      "app/database/migrations/",
      "app/database/seeders/"
    ]
  });

  // Index tests separately so the test stage can find them, without
  // polluting the runtime node list.
  graph.testFiles = await collectTestFiles(config.root);

  tracer.finalize(graph);

  if (checkOnly) {
    let onDisk;

    try {
      onDisk = JSON.parse(
        await fs.readFile(outputPath, "utf8")
      );
    } catch {
      console.error(
        "Graph is missing. Run `npm run graph` to generate it."
      );
      process.exitCode = 1;
      return;
    }

    if (canonicalize(onDisk) !== canonicalize(graph)) {
      const diskNodes = new Set(onDisk.nodes ?? []);
      const freshNodes = new Set(graph.nodes);

      const added = graph.nodes.filter(n => !diskNodes.has(n));
      const removed = [...diskNodes].filter(n => !freshNodes.has(n));

      console.error("Graph is stale. Run `npm run graph`.");

      if (added.length) {
        console.error(`  + ${added.length} new files`);
        console.error(`    e.g. ${added.slice(0, 5).join(", ")}`);
      }

      if (removed.length) {
        console.error(`  - ${removed.length} removed files`);
        console.error(`    e.g. ${removed.slice(0, 5).join(", ")}`);
      }

      process.exitCode = 1;
      return;
    }

    console.log("Graph is up to date.");
    return;
  }

  await fs.mkdir(path.dirname(outputPath), {
    recursive: true
  });

  await fs.writeFile(
    outputPath,
    JSON.stringify(graph, null, 2)
  );

  console.log("\nDependency graph:");
  console.log("Entry:", graph.entry);
  console.log("Total files:", graph.nodes.length);
  console.log("Total relationships:", graph.edges.length);

  console.log("\nFiles by type:");
  for (const [type, count] of Object.entries(
    graph.meta.counts
  ).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${type}`);
  }

  console.log(
    `\nTest files indexed: ${graph.testFiles.length}`
  );

  console.log("\nGraph saved:", outputPath);
}

main().catch(error => {
  console.error("Graph build error:", error.message);
  process.exitCode = 1;
});
