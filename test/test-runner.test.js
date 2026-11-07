import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TestRunner } from "../src/agents/test-runner.js";

async function makeDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "shopdot-tests-"));
}

test("passes when all commands exit zero", async () => {
  const cwd = await makeDir();

  try {
    const runner = new TestRunner({
      cwd,
      commands: [
        'node -e "process.exit(0)"',
        'node -e "console.log(\\"ok\\")"'
      ]
    });

    const result = await runner.run();

    assert.equal(result.passed, true);
    assert.equal(result.results.length, 2);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("fails when a command exits non-zero", async () => {
  const cwd = await makeDir();

  try {
    const runner = new TestRunner({
      cwd,
      commands: ['node -e "process.exit(2)"']
    });

    const result = await runner.run();

    assert.equal(result.passed, false);
    assert.equal(result.results[0].code, 2);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test("stops after the first failing command", async () => {
  const cwd = await makeDir();

  try {
    const runner = new TestRunner({
      cwd,
      commands: [
        'node -e "process.exit(1)"',
        'node -e "process.exit(0)"'
      ]
    });

    const result = await runner.run();

    assert.equal(result.results.length, 1);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
