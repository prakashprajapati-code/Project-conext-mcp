import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const graphPath = path.resolve(
  __dirname,
  "../../tasks/shopdot-dependency-graph.json"
);

// Words that carry no signal when matched against file paths.
const STOPWORDS = new Set([
  "add", "adds", "added", "create", "creates", "created",
  "get", "gets", "set", "sets", "update", "updates", "updated",
  "delete", "deletes", "deleted", "remove", "removes", "removed",
  "fix", "fixes", "fixed", "make", "makes", "change", "changes",
  "the", "and", "for", "from", "with", "into", "onto", "that",
  "this", "these", "those", "api", "module", "modules", "code",
  "file", "files", "new", "old", "use", "using", "when", "then",
  "should", "would", "could", "can", "will", "need", "want"
]);

// Task wording -> codebase wording. The backend is terse ("auth", not
// "authentication"; "page/limit/offset", not "pagination").
const SYNONYMS = {
  authentication: ["auth"],
  authenticate: ["auth"],
  authorization: ["auth", "permission", "role"],
  pagination: ["page", "limit", "offset"],
  paginate: ["page", "limit", "offset"],
  paginated: ["page", "limit", "offset"],
  product: ["products"],
  products: ["product"],
  order: ["orders"],
  orders: ["order"],
  user: ["users"],
  users: ["user"],
  category: ["categories"],
  categories: ["category"],
  vendor: ["vendors", "seller"],
  retailer: ["retailers"],
  retailers: ["retailer"],
  brand: ["brands"],
  brands: ["brand"],
  transaction: ["transactions", "payment"],
  transactions: ["transaction", "payment"],
  notification: ["notifications", "email", "ses"],
  notifications: ["notification", "email", "ses"],
  upload: ["uploads", "s3"],
  uploads: ["upload", "s3"],
  validation: ["validations", "validate", "schema"],
  validations: ["validation", "validate", "schema"]
};

/**
 * Lightweight, deterministic stemmer. Intentionally simple: it only needs to
 * collapse common plural/gerund forms so "products" matches "product".
 */
export function stem(word) {
  let value = String(word).toLowerCase();

  if (value.length <= 3) return value;

  if (value.endsWith("ies") && value.length > 4) {
    return value.slice(0, -3) + "y";
  }

  if (value.endsWith("sses")) {
    return value.slice(0, -2);
  }

  if (value.endsWith("ses") && value.length > 4) {
    return value.slice(0, -2);
  }

  if (value.endsWith("ing") && value.length > 5) {
    return value.slice(0, -3);
  }

  if (value.endsWith("ed") && value.length > 4) {
    return value.slice(0, -2);
  }

  if (
    value.endsWith("s") &&
    !value.endsWith("ss") &&
    !value.endsWith("us") &&
    !value.endsWith("is")
  ) {
    return value.slice(0, -1);
  }

  return value;
}

/**
 * Turn a task string into normalized keywords, dropping low-signal words.
 */
export function tokenize(task) {
  return [
    ...new Set(
      String(task)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(word => word.length > 2 && !STOPWORDS.has(word))
    )
  ];
}

/**
 * Split a file path into normalized words so we can match whole words instead
 * of substrings ("add" must not match "address").
 */
export function pathWords(filePath) {
  return String(filePath)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

function buildTermMap(keywords) {
  const termToKeywords = new Map();

  for (const keyword of keywords) {
    const terms = new Set([stem(keyword)]);

    for (const synonym of SYNONYMS[keyword] ?? []) {
      terms.add(stem(synonym));
    }

    for (const term of terms) {
      if (!term) continue;

      if (!termToKeywords.has(term)) {
        termToKeywords.set(term, new Set());
      }

      termToKeywords.get(term).add(keyword);
    }
  }

  return termToKeywords;
}

function collectModules(nodes) {
  const modules = new Set();

  for (const file of nodes) {
    const match = file.match(/\/modules\/([^/]+)\//);

    if (match) modules.add(stem(match[1]));
  }

  return modules;
}

/**
 * Score every graph node against the task keywords.
 */
export function scoreFiles(nodes, keywords, types = {}) {
  const termToKeywords = buildTermMap(keywords);
  const modules = collectModules(nodes);

  const results = [];

  for (const file of nodes) {
    const words = pathWords(file);
    const wordSet = new Set(words);

    const matched = new Set();
    let score = 0;

    for (const [term, sourceKeywords] of termToKeywords) {
      if (wordSet.has(term)) {
        score += 2;

        // A direct hit on a module directory is a strong signal.
        if (modules.has(term)) score += 2;

        for (const keyword of sourceKeywords) matched.add(keyword);
        continue;
      }

      // Prefix fallback for word variants, but never for very short terms
      // (prevents "add" -> "address" style noise).
      if (term.length >= 4) {
        const partial = words.some(
          word =>
            word.length >= 4 &&
            (word.startsWith(term) || term.startsWith(word))
        );

        if (partial) {
          score += 1;
          for (const keyword of sourceKeywords) matched.add(keyword);
        }
      }
    }

    if (score > 0) {
      results.push({
        file,
        score,
        matchedKeywords: [...matched].sort(),
        type: types[file] ?? "runtime"
      });
    }
  }

  return results.sort(
    (a, b) =>
      b.score - a.score ||
      a.file.length - b.file.length ||
      a.file.localeCompare(b.file)
  );
}

export async function buildTaskContext(task, options = {}) {
  if (typeof task !== "string" || !task.trim()) {
    throw new Error("A non-empty task description is required.");
  }

  const maxMatches = options.maxMatches ?? 15;
  const maxFiles = options.maxFiles ?? 40;

  const graph = JSON.parse(
    await fs.readFile(graphPath, "utf8")
  );

  const keywords = tokenize(task);
  const matches = scoreFiles(
    graph.nodes,
    keywords,
    graph.types
  );

  const fallback = matches.length === 0;

  let selected;

  if (fallback) {
    // Never hand the assistant an empty context.
    selected = new Set(
      graph.nodes
        .filter(
          file =>
            /(^|\/)server\.[cm]?[jt]s$/.test(file) ||
            /base\.(controller|service)\.[cm]?[jt]s$/.test(file)
        )
        .slice(0, maxFiles)
    );

    if (selected.size === 0) {
      selected = new Set(graph.nodes.slice(0, maxFiles));
    }
  } else {
    const topMatches = matches.slice(0, maxMatches);

    // Rank everything we know about so the cap keeps the best files.
    const scoreOf = new Map(
      matches.map(item => [item.file, item.score])
    );

    selected = new Set(topMatches.map(item => item.file));

    // Add one-hop dependencies of the matching files.
    const relatedFiles = new Set();

    for (const edge of graph.edges) {
      if (selected.has(edge.from)) relatedFiles.add(edge.to);
      if (selected.has(edge.to)) relatedFiles.add(edge.from);
    }

    const rankedRelated = [...relatedFiles]
      .filter(file => !selected.has(file))
      .sort(
        (a, b) =>
          (scoreOf.get(b) ?? 0) - (scoreOf.get(a) ?? 0) ||
          a.localeCompare(b)
      );

    for (const file of rankedRelated) {
      if (selected.size >= maxFiles) break;
      selected.add(file);
    }
  }

  const contextFiles = [...selected]
    .sort(
      (a, b) =>
        (matches.find(m => m.file === a)?.score ?? 0) -
        (matches.find(m => m.file === b)?.score ?? 0)
    )
    .reverse()
    .slice(0, maxFiles);

  const relationships = graph.edges.filter(
    edge => selected.has(edge.from) && selected.has(edge.to)
  );

  return {
    task,
    keywords,
    fallback,
    graphSummary: {
      entry: graph.entry,
      totalFiles: graph.nodes.length,
      totalRelationships: graph.edges.length,
      generatedAt: graph.meta?.generatedAt ?? null
    },
    matchingFiles: (fallback ? [] : matches.slice(0, maxMatches)),
    contextFiles,
    relationships
  };
}
