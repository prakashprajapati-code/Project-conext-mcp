
import fs from "node:fs/promises";
import path from "node:path";
import { FileScanner } from "../tools/file-scanner.js";

export class AnalysisAgent {
  constructor({ projectRoot }) {
    this.projectRoot = path.resolve(projectRoot);

    this.scanner = new FileScanner(this.projectRoot);
  }

  async readFile(relativePath) {
    const absolutePath = path.resolve(
      this.projectRoot,
      relativePath
    );

    if (
      absolutePath !== this.projectRoot &&
      !absolutePath.startsWith(this.projectRoot + path.sep)
    ) {
      throw new Error("Access outside project is forbidden");
    }

    return fs.readFile(absolutePath, "utf8");
  }

  async analyzeProject() {
    const structure = await this.scanner.analyze();

    const importantFiles = [
      "package.json",
      "README.md"
    ];

    const projectInfo = {};

    for (const file of importantFiles) {
      try {
        projectInfo[file] = await this.readFile(file);
      } catch {
        projectInfo[file] = "Not found";
      }
    }

    return {
      projectName: "ShopDot Backend",
      structure,
      projectInfo
    };
  }
}
