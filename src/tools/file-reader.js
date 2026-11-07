
import fs from "node:fs/promises";
import path from "node:path";

export class FileReader {
  constructor(projectRoot) {
    this.projectRoot = path.resolve(projectRoot);
  }

  async read(relativePath) {
    const absolutePath = path.resolve(
      this.projectRoot,
      relativePath
    );

    // Prevent reading files outside the project.
    if (
      absolutePath !== this.projectRoot &&
      !absolutePath.startsWith(this.projectRoot + path.sep)
    ) {
      throw new Error("Access outside project is forbidden");
    }

    const content = await fs.readFile(absolutePath, "utf8");

    return {
      path: relativePath,
      content,
      lines: content.split("\n").length
    };
  }
}
