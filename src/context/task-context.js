import { buildTaskContext } from "./context-builder.js";

async function main() {
  const task = process.argv.slice(2).join(" ");

  if (!task) {
    console.log(
      'Usage: node src/context/task-context.js "your task"'
    );
    process.exitCode = 1;
    return;
  }

  const result = await buildTaskContext(task);

  console.log("\nTask:", result.task);
  console.log("Keywords:", result.keywords);

  console.log("\nMatching files:");

  for (const item of result.matchingFiles) {
    console.log(
      `[score: ${item.score}] ${item.file}`
    );
  }

  console.log("\nSelected context files:", result.contextFiles.length);

  for (const file of result.contextFiles) {
    console.log(" ->", file);
  }

  console.log("\nRelationships:", result.relationships.length);
}

main().catch(error => {
  console.error("Task context error:", error.message);
  process.exitCode = 1;
});
