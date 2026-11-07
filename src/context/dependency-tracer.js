import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = [".js", ".cjs", ".mjs", ".ts"];

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

// Matches literal relative imports:
//   require("./foo")
//   require('../bar')
//   import x from "./baz"
const IMPORT_PATTERN =
  /(?:require\s*\(\s*|from\s*)["'](\.{1,2}\/[^"']+)["']/g;

export class DependencyTracer {
  constructor(projectRoot) {
    this.projectRoot = path.resolve(projectRoot);
    this.visited = new Set();
    this.edgeSet = new Set();
  }

  /**
   * Tag a file so later stages (context, planner, tests) can filter by kind.
   */
  classify(relativePath) {
    const normalized = relativePath.toLowerCase();
    const basename = path.basename(normalized);

    if (
      /\.model\.[cm]?[jt]s$/.test(normalized) ||
      /(^|\/)models\//.test(normalized)
    ) {
      return "model";
    }

    if (
      /(^|\/)tests?\//.test(normalized) ||
      /\.(test|spec)\./.test(normalized)
    ) {
      return "test";
    }

    if (
      /\/migrations\//.test(normalized) ||
      /^\d{14}-/.test(basename)
    ) {
      return "migration";
    }

    if (/\/seeders\//.test(normalized)) {
      return "seeder";
    }

    if (/\/scripts?\//.test(normalized) || /^manual-/.test(basename)) {
      return "script";
    }

    return "runtime";
  }

  /**
   * Some files load their siblings at runtime, e.g. Sequelize model loaders:
   *
   *   fs.readdirSync(__dirname).forEach(file => {
   *     require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
   *   });
   *
   * A static import regex cannot see those files. Detect the pattern and
   * expand the directory explicitly.
   */
  isDynamicDirLoader(content) {
    return (
      /readdirSync\s*\(\s*__dirname\s*\)/.test(content) &&
      /require\s*\(\s*path\.join\s*\(\s*__dirname/.test(content)
    );
  }

  async dynamicChildren(absoluteFilePath) {
    const directory = path.dirname(absoluteFilePath);

    const entries = await fs.readdir(directory, {
      withFileTypes: true
    });

    return entries
      .filter(entry => entry.isFile() && !entry.isSymbolicLink())
      .filter(entry =>
        SOURCE_EXTENSIONS.includes(path.extname(entry.name))
      )
      .map(entry => path.join(directory, entry.name));
  }

  /**
   * Only record edges that stay inside the project root, and never record the
   * same edge twice.
   */
  addEdge(graph, from, to) {
    if (from === to) return false;

    const absoluteTo = path.resolve(this.projectRoot, to);

    if (!absoluteTo.startsWith(this.projectRoot + path.sep)) {
      return false;
    }

    const key = `${from}->${to}`;

    if (this.edgeSet.has(key)) return false;

    this.edgeSet.add(key);
    graph.edges.push({ from, to });

    return true;
  }

  async traceGraph(entryFile) {
    const graph = {
      entry: entryFile,
      nodes: [],
      edges: [],
      types: {},
      meta: {}
    };

    this.visited = new Set();
    this.edgeSet = new Set();

    await this.visit(entryFile, graph);

    return this.finalize(graph);
  }

  /**
   * Add every source file under the given roots as a node, even if it is not
   * reachable from the entry point. This makes keyword-based context matching
   * complete (e.g. controllers that are only wired via route tables).
   */
  async sweep(graph, options = {}) {
    const roots = options.roots ?? ["app"];
    const ignorePaths = options.ignorePaths ?? [];
    const ignoreDirs = options.ignoreDirs ?? IGNORED_DIRS;

    const known = new Set(graph.nodes);

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
          if (ignoreDirs.has(entry.name)) continue;
          await walk(fullPath);
          continue;
        }

        if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
          continue;
        }

        const relativePath = path.relative(this.projectRoot, fullPath);

        if (
          ignorePaths.some(prefix => relativePath.startsWith(prefix))
        ) {
          continue;
        }

        if (!graph.types[relativePath]) {
          graph.types[relativePath] = this.classify(relativePath);
        }

        if (!known.has(relativePath)) {
          known.add(relativePath);
          graph.nodes.push(relativePath);
        }
      }
    };

    for (const root of roots) {
      await walk(path.resolve(this.projectRoot, root));
    }

    return this.finalize(graph);
  }

  finalize(graph) {
    // Deterministic output keeps generated-graph diffs clean.
    graph.nodes.sort();
    graph.edges.sort((a, b) =>
      `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`)
    );

    const counts = {};

    for (const node of graph.nodes) {
      const type = graph.types[node] ?? "runtime";
      counts[type] = (counts[type] ?? 0) + 1;
    }

    graph.meta = {
      root: this.projectRoot,
      generatedAt: new Date().toISOString(),
      counts
    };

    return graph;
  }

  async visit(relativePath, graph) {
    const absolutePath = path.resolve(
      this.projectRoot,
      relativePath
    );

    if (
      !absolutePath.startsWith(this.projectRoot + path.sep) ||
      this.visited.has(absolutePath)
    ) {
      return;
    }

    this.visited.add(absolutePath);

    let content;

    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      return;
    }

    const normalized = path.relative(this.projectRoot, absolutePath);

    if (!graph.types[normalized]) {
      graph.types[normalized] = this.classify(normalized);
    }

    graph.nodes.push(normalized);

    // 1. Literal relative imports.
    for (const match of content.matchAll(IMPORT_PATTERN)) {
      const resolved = await this.resolveImport(
        path.resolve(path.dirname(absolutePath), match[1])
      );

      if (!resolved) continue;

      const childPath = path.relative(this.projectRoot, resolved);

      this.addEdge(graph, normalized, childPath);
      await this.visit(childPath, graph);
    }

    // 2. Dynamic directory loaders (e.g. models/index.js).
    if (this.isDynamicDirLoader(content)) {
      for (const child of await this.dynamicChildren(absolutePath)) {
        const childPath = path.relative(this.projectRoot, child);

        if (childPath === normalized) continue;

        this.addEdge(graph, normalized, childPath);
        await this.visit(childPath, graph);
      }
    }
  }

  async resolveImport(basePath) {
    const candidates = [
      basePath,
      ...SOURCE_EXTENSIONS.map(ext => basePath + ext),
      ...SOURCE_EXTENSIONS.map(ext =>
        path.join(basePath, "index" + ext)
      )
    ];

    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);

        if (stat.isFile()) return candidate;
      } catch {
        // Continue checking candidates.
      }
    }

    return null;
  }
}
