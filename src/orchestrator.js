import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { Planner } from "./agents/planner.js";
import { Executor } from "./agents/executor.js";
import { TestRunner } from "./agents/test-runner.js";
import { Orchestrator } from "./agents/orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const configPath = path.resolve(
  __dirname,
  "../config/project.json"
);

const tasksDir = path.resolve(__dirname, "../tasks");

function parseArgs(argv) {
  const args = {
    task: "",
    patch: null,
    worktree: null,
    runTests: false,
    autoApprove: false,
    maxRetries: 3,
    maxFiles: 20,
    testCommands: []
  };

  const positional = [];

  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];

    if (value === "--patch") {
      args.patch = argv[++index];
    } else if (value === "--worktree") {
      args.worktree = argv[++index];
    } else if (value === "--run-tests") {
      args.runTests = true;
    } else if (value === "--auto-approve" || value === "-y") {
      args.autoApprove = true;
    } else if (value === "--max-retries") {
      args.maxRetries = Number(argv[++index]);
    } else if (value === "--max-files") {
      args.maxFiles = Number(argv[++index]);
    } else if (value === "--test-command") {
      args.testCommands.push(argv[++index]);
    } else {
      positional.push(value);
    }
  }

  args.task = positional.join(" ").trim();

  return args;
}

async function confirm(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await rl.question(`${message} [y/N] `);
  rl.close();

  return /^y(es)?$/i.test(answer.trim());
}

function printPlan(plan) {
  console.log(`\nTask: ${plan.task}`);
  console.log(`Risk: ${plan.risk}`);
  console.log(`Keywords: ${plan.keywords.join(", ") || "(none)"}`);
  console.log(
    `Context: ${plan.files.length} files, ${plan.tests.length} related tests`
  );

  if (plan.fallback) {
    console.log(
      "Warning: no keyword matches; using a fallback file set."
    );
  }

  console.log("\nPlan:");

  for (const step of plan.steps) {
    console.log(
      `  ${step.id}. [${step.layer}/${step.risk}] ${step.file}`
    );
    console.log(`     -> ${step.action}`);
  }

  if (plan.tests.length) {
    console.log("\nRelated tests:");
    for (const testFile of plan.tests) {
      console.log(`  - ${testFile}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.task) {
    console.log(
      [
        "Usage:",
        '  node src/orchestrator.js "Add pagination to brand products API"',
        "",
        "Options:",
        "  --worktree <dir>     Isolated git worktree to write edits into",
        "  --patch <file.json>  { edits: [{ path, content }] } to apply",
        "  --run-tests          Run config.testCommands after applying edits",
        "  --test-command <cmd> Override test command (repeatable)",
        "  --auto-approve, -y   Skip human approval gates",
        "  --max-retries <n>    Retry budget (default 3)",
        "  --max-files <n>      Context file cap (default 20)"
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const config = JSON.parse(
    await fs.readFile(configPath, "utf8")
  );

  const planner = new Planner();

  const plan = await planner.buildPlan(args.task, {
    maxFiles: args.maxFiles
  });

  await fs.mkdir(tasksDir, { recursive: true });
  await fs.writeFile(
    path.join(tasksDir, "plan.json"),
    JSON.stringify(plan, null, 2)
  );

  printPlan(plan);
  console.log("\nPlan artifact: tasks/plan.json");

  const hasExecution = Boolean(args.patch) || args.runTests;

  if (!hasExecution) {
    console.log(
      "\nPlan only. Pass --worktree and --patch to execute, or --run-tests to run tests."
    );
    return;
  }

  if (!args.worktree) {
    throw new Error(
      "--worktree is required to execute or test. Point it at an isolated git worktree of the backend."
    );
  }

  let patchEdits = null;

  if (args.patch) {
    const patchContent = JSON.parse(
      await fs.readFile(path.resolve(args.patch), "utf8")
    );

    patchEdits = Array.isArray(patchContent)
      ? patchContent
      : patchContent.edits;

    if (!Array.isArray(patchEdits)) {
      throw new Error(
        "Patch file must be an array or { edits: [...] }."
      );
    }
  }

  const executor = new Executor(args.worktree);

  const testRunner = new TestRunner({
    cwd: args.worktree,
    commands: args.runTests
      ? (args.testCommands.length
          ? args.testCommands
          : (config.testCommands ?? []))
      : []
  });

  const editProvider = async ({ attempt }) => {
    if (attempt === 0 && patchEdits) return patchEdits;
    return null;
  };

  const onGate = async ({ type, plan: currentPlan, edits }) => {
    if (args.autoApprove) return true;

    if (type === "plan") {
      return confirm(
        `Proceed with ${currentPlan.steps.length} steps (risk ${currentPlan.risk})?`
      );
    }

    if (type === "diff") {
      console.log("\nFiles to write:");
      for (const edit of edits) {
        console.log(`  - ${edit.path}`);
      }

      return confirm("Apply these edits and continue?");
    }

    return true;
  };

  const orchestrator = new Orchestrator({
    planner,
    executor,
    testRunner,
    editProvider,
    maxRetries: args.maxRetries,
    onGate,
    onEvent: event => {
      if (event.type === "applied") {
        console.log(
          `\nApplied ${event.applyResult.count} file(s) (attempt ${event.attempt + 1}).`
        );
      }

      if (event.type === "tests") {
        const { testResult, attempt } = event;

        console.log(
          `Tests attempt ${attempt + 1}: ${testResult.passed ? "PASS" : "FAIL"}`
        );

        for (const result of testResult.results) {
          console.log(
            `  ${result.passed ? "PASS" : "FAIL"} ${result.command}`
          );
        }
      }
    }
  });

  const outcome = await orchestrator.run(args.task);

  if (outcome.testResult) {
    await fs.writeFile(
      path.join(tasksDir, "test-result.json"),
      JSON.stringify(outcome.testResult, null, 2)
    );
  }

  console.log(`\nOutcome: ${outcome.status.toUpperCase()}`);
  console.log(`Attempts: ${outcome.attempt ?? 0}`);

  if (outcome.status === "escalated") {
    console.log(
      "Retry budget exhausted. Review tasks/test-result.json and escalate to a human."
    );
    process.exitCode = 1;
    return;
  }

  if (outcome.status === "rejected") {
    console.log("Rejected at the plan/diff gate. Nothing was run.");
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error("Orchestrator error:", error.message);
  process.exitCode = 1;
});
