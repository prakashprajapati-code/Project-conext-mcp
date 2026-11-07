import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Executor } from "../src/agents/executor.js";

test("applies edits inside the worktree", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "shopdot-exec-")
  );

  try {
    const executor = new Executor(root);

    const result = await executor.applyEdits([
      {
        path: "app/api/v1/modules/brand/brand.service.js",
        content: "module.exports = {};\n"
      }
    ]);

    assert.equal(result.count, 1);
    assert.equal(
      await executor.read("app/api/v1/modules/brand/brand.service.js"),
      "module.exports = {};\n"
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects edits that escape the worktree", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "shopdot-exec-")
  );

  try {
    const executor = new Executor(root);

    await assert.rejects(
      () =>
        executor.applyEdits([
          { path: "../evil.js", content: "bad" }
        ]),
      /outside worktree is forbidden/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed edits", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "shopdot-exec-")
  );

  try {
    const executor = new Executor(root);

    await assert.rejects(
      () => executor.applyEdits([{ path: "a.js", content: 42 }]),
      /string content/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
