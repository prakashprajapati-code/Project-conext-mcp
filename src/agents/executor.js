import fs from "node:fs/promises";
import path from "node:path";

/**
 * Applies edits inside an isolated worktree. Every path is contained to the
 * worktree root so an edit can never escape into the main checkout.
 */
export class Executor {
  constructor(worktreeRoot) {
    this.root = path.resolve(worktreeRoot);
  }

  resolve(relativePath) {
    const absolutePath = path.resolve(this.root, relativePath);

    if (
      absolutePath !== this.root &&
      !absolutePath.startsWith(this.root + path.sep)
    ) {
      throw new Error(
        `Access outside worktree is forbidden: ${relativePath}`
      );
    }

    return absolutePath;
  }

  async applyEdits(edits) {
    if (!Array.isArray(edits)) {
      throw new Error("Edits must be an array of { path, content }.");
    }

    const applied = [];

    for (const edit of edits) {
      if (
        !edit ||
        typeof edit.path !== "string" ||
        typeof edit.content !== "string"
      ) {
        throw new Error(
          "Each edit must have a string path and string content."
        );
      }

      const absolutePath = this.resolve(edit.path);

      await fs.mkdir(path.dirname(absolutePath), {
        recursive: true
      });

      await fs.writeFile(absolutePath, edit.content, "utf8");

      applied.push(edit.path);
    }

    return {
      applied,
      count: applied.length
    };
  }

  async read(relativePath) {
    const absolutePath = this.resolve(relativePath);

    return fs.readFile(absolutePath, "utf8");
  }
}
