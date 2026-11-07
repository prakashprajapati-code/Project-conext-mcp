
import fs from "node:fs/promises";
import path from "node:path";

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

const ALLOWED_EXTENSIONS = new Set([
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".json",
  ".md"
]);

export class FileScanner {
  constructor(projectRoot) {
    this.projectRoot = path.resolve(projectRoot);
  }

  async scan(directory = this.projectRoot, files = []) {
    const entries = await fs.readdir(directory, {
      withFileTypes: true
    });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;

        await this.scan(fullPath, files);
        continue;
      }

      const extension = path.extname(entry.name);

      if (ALLOWED_EXTENSIONS.has(extension)) {
        files.push(
          path.relative(this.projectRoot, fullPath)
        );
      }

      if (files.length >= 3000) {
        return files;
      }
    }

    return files;
  }

  categorize(files) {
    const categories = {
      routes: [],
      controllers: [],
      services: [],
      repositories: [],
      models: [],
      middleware: [],
      validations: [],
      tests: [],
      other: []
    };

    for (const file of files) {
      const name = path.basename(file).toLowerCase();

      if (/route/.test(name)) {
        categories.routes.push(file);
      } else if (/controller/.test(name)) {
        categories.controllers.push(file);
      } else if (/service/.test(name)) {
        categories.services.push(file);
      } else if (/repository|repo/.test(name)) {
        categories.repositories.push(file);
      } else if (/model/.test(name)) {
        categories.models.push(file);
      } else if (/middleware/.test(name)) {
        categories.middleware.push(file);
      } else if (/validat|schema/.test(name)) {
        categories.validations.push(file);
      } else if (/\.(test|spec)\./.test(name)) {
        categories.tests.push(file);
      } else {
        categories.other.push(file);
      }
    }

    return categories;
  }

  async analyze() {
    const files = await this.scan();
    const categories = this.categorize(files);

    return {
      totalFiles: files.length,
      categories
    };
  }
}
