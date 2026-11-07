import { spawn } from "node:child_process";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURE = 8000;

function tail(value) {
  if (!value) return "";
  return value.length > MAX_CAPTURE
    ? "…" + value.slice(-MAX_CAPTURE)
    : value;
}

/**
 * Runs a list of shell commands (tests, lint, typecheck) in a directory and
 * reports a structured pass/fail result.
 */
export class TestRunner {
  constructor({ cwd, commands = [], timeoutMs } = {}) {
    this.cwd = path.resolve(cwd);
    this.commands = commands;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async run() {
    const results = [];

    for (const command of this.commands) {
      results.push(await this.runOne(command));

      // Stop on first failure: later steps assume earlier ones passed.
      if (!results[results.length - 1].passed) break;
    }

    return {
      passed: results.length > 0 && results.every(item => item.passed),
      results
    };
  }

  runOne(command) {
    return new Promise(resolve => {
      const child = spawn(command, {
        cwd: this.cwd,
        shell: true,
        env: process.env
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.timeoutMs);

      child.stdout.on("data", chunk => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", chunk => {
        stderr += chunk.toString();
      });

      child.on("error", error => {
        clearTimeout(timer);
        resolve({
          command,
          code: -1,
          passed: false,
          timedOut: false,
          stdout: tail(stdout),
          stderr: tail(stderr || String(error))
        });
      });

      child.on("close", code => {
        clearTimeout(timer);
        resolve({
          command,
          code,
          passed: code === 0,
          timedOut,
          stdout: tail(stdout),
          stderr: tail(stderr)
        });
      });
    });
  }
}
