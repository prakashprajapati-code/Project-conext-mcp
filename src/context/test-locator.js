import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tokenize, scoreFiles } from "./context-builder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const graphPath = path.resolve(
  __dirname,
  "../../tasks/shopdot-dependency-graph.json"
);

/**
 * Find test files related to a task by matching task keywords against the
 * separately indexed test file list.
 */
export async function findTestsFor(task, options = {}) {
  if (typeof task !== "string" || !task.trim()) {
    throw new Error("A non-empty task description is required.");
  }

  const maxResults = options.maxResults ?? 15;

  const graph = JSON.parse(
    await fs.readFile(graphPath, "utf8")
  );

  const keywords = tokenize(task);
  const matches = scoreFiles(
    graph.testFiles ?? [],
    keywords
  );

  return {
    task,
    keywords,
    total: matches.length,
    tests: matches.slice(0, maxResults).map(item => ({
      file: item.file,
      score: item.score,
      matchedKeywords: item.matchedKeywords,
      type: "test"
    }))
  };
}
