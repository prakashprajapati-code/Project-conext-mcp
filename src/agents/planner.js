import { buildTaskContext } from "../context/context-builder.js";
import { findTestsFor } from "../context/test-locator.js";

const LAYER_ORDER = [
  "model",
  "migration",
  "validation",
  "repository",
  "service",
  "controller",
  "route",
  "middleware",
  "helper",
  "other"
];

const LAYER_ACTIONS = {
  model: "Inspect/update Sequelize model or association",
  migration: "Add a migration (schema change)",
  validation: "Update request validation / schema",
  repository: "Update query, filters, or pagination in repository",
  service: "Update business logic in service",
  controller: "Update controller handler and response",
  route: "Wire or verify the route",
  middleware: "Check middleware / auth behaviour",
  helper: "Review helper usage",
  other: "Review file"
};

const LAYER_RISK = {
  model: "high",
  migration: "high",
  service: "medium",
  repository: "medium",
  controller: "medium",
  validation: "medium",
  route: "low",
  middleware: "medium",
  helper: "low",
  other: "low"
};

export function layerOf(file) {
  const value = file.toLowerCase();

  if (/\.model\.[cm]?[jt]s$/.test(value) || /(^|\/)models\//.test(value)) {
    return "model";
  }

  if (/\/migrations\//.test(value)) return "migration";
  if (/validat|schema/.test(value)) return "validation";
  if (/repository|repo/.test(value)) return "repository";
  if (/service/.test(value)) return "service";
  if (/controller/.test(value)) return "controller";
  if (/route/.test(value)) return "route";
  if (/middleware/.test(value)) return "middleware";

  return "helper";
}

export class Planner {
  /**
   * Build a deterministic, reviewable plan from task context.
   * In production an LLM can refine the "action" fields; the structure
   * stays the same so gates/artifacts remain stable.
   */
  async buildPlan(task, options = {}) {
    if (typeof task !== "string" || !task.trim()) {
      throw new Error("A non-empty task description is required.");
    }

    const maxFiles = options.maxFiles ?? 20;

    const context = await buildTaskContext(task, {
      maxFiles
    });

    const tests = await findTestsFor(task);

    const matchedFiles =
      context.matchingFiles.length > 0
        ? context.matchingFiles.map(item => item.file)
        : context.contextFiles;

    const files = [
      ...new Set(matchedFiles)
    ].sort(
      (a, b) =>
        LAYER_ORDER.indexOf(layerOf(a)) -
          LAYER_ORDER.indexOf(layerOf(b)) ||
        a.localeCompare(b)
    );

    const steps = files.map((file, index) => {
      const layer = layerOf(file);

      return {
        id: index + 1,
        layer,
        file,
        action: LAYER_ACTIONS[layer] ?? LAYER_ACTIONS.other,
        risk: LAYER_RISK[layer] ?? "low"
      };
    });

    const risks = steps.map(step => step.risk);

    return {
      task,
      generatedAt: new Date().toISOString(),
      keywords: context.keywords,
      fallback: context.fallback,
      graphSummary: context.graphSummary,
      steps,
      files,
      tests: tests.tests.map(item => item.file),
      risk: risks.includes("high")
        ? "high"
        : risks.includes("medium")
          ? "medium"
          : "low",
      rollback:
        "Remove the task git worktree. The main checkout is never modified."
    };
  }
}
