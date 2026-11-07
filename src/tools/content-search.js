import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([
  ".js", ".cjs", ".mjs", ".ts", ".json", ".md"
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage",
  ".next", "logs", "uploads"
]);

const MAX_FILE_BYTES = 1024 * 1024;

/**
 * Simple content search over the target project. This complements path-based
 * context matching: a task like "pagination" has no file named *pagination*,
 * but the word appears inside controllers/repositories.
 */
export async function searchFiles(projectRoot, query, options = {}) {
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("A non-empty search query is required.");
  }

  const root = path.resolve(projectRoot);
  const maxResults = options.maxResults ?? 50;
  const useRegex = options.regex ?? false;
  const pathPrefix = options.pathPrefix ?? null;

  let matcher;

  if (useRegex) {
    const expression = new RegExp(query, "i");
    matcher = line => expression.test(line);
  } else {
    const needle = query.toLowerCase();
    matcher = line => line.toLowerCase().includes(needle);
  }

  const results = [];

  const walk = async directory => {
    if (results.length >= maxResults) return;

    let entries;

    try {
      entries = await fs.readdir(directory, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(fullPath);
        continue;
      }

      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }

      const relativePath = path.relative(root, fullPath);

      if (pathPrefix && !relativePath.startsWith(pathPrefix)) {
        continue;
      }

      let stat;

      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.size > MAX_FILE_BYTES) continue;

      let content;

      try {
        content = await fs.readFile(fullPath, "utf8");
      } catch {
        continue;
      }

      const lines = content.split("\n");

      for (let index = 0; index < lines.length; index++) {
        if (!matcher(lines[index])) continue;

        results.push({
          file: path.relative(root, fullPath),
          line: index + 1,
          text: lines[index].trim().slice(0, 240)
        });

        if (results.length >= maxResults) break;
      }
    }
  };

  await walk(root);

  return {
    query,
    regex: useRegex,
    total: results.length,
    truncated: results.length >= maxResults,
    results
  };
}
