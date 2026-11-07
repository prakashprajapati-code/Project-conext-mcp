
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AnalysisAgent } from "./agents/analysis-agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const configPath = path.resolve(
    __dirname,
    "../config/project.json"
  );

  console.log("path",configPath)
  const config = JSON.parse(
    await fs.readFile(configPath, "utf8")
  );
   console.log()

  const agent = new AnalysisAgent({
    projectRoot: config.root
  });

  console.log("Analyzing ShopDot backend...\n");

  const report = await agent.analyzeProject();

  console.log("Total files:", report.structure.totalFiles);

  for (const [category, files] of Object.entries(
    report.structure.categories
  )) {
    console.log(`\n${category.toUpperCase()}:`);

    for (const file of  files) {
      console.log("  ", file);
    }
  }

  console.log("\nAnalysis completed.");
}

main().catch(console.error);
