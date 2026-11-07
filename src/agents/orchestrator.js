/**
 * Connects Plan -> Context -> Execute -> Test with approval gates and a
 * bounded retry loop.
 *
 * The editProvider is what makes this LLM-agnostic:
 *   - CLI patch mode returns a fixed list of edits once.
 *   - An LLM-backed provider can inspect failure logs and return new edits on
 *     each attempt.
 * Returning null means "no more edits to try" and ends the loop.
 */
export class Orchestrator {
  constructor({
    planner,
    executor,
    testRunner,
    editProvider,
    maxRetries = 3,
    onGate = async () => true,
    onEvent = () => {}
  }) {
    this.planner = planner;
    this.executor = executor;
    this.testRunner = testRunner;
    this.editProvider = editProvider;
    this.maxRetries = maxRetries;
    this.onGate = onGate;
    this.onEvent = onEvent;
  }

  async run(task) {
    const plan = await this.planner.buildPlan(task);

    this.onEvent({ type: "plan", plan });

    const planApproved = await this.onGate({
      type: "plan",
      plan
    });

    if (!planApproved) {
      return { status: "rejected", stage: "plan", plan };
    }

    let attempt = 0;
    let testResult = null;
    let lastApply = null;

    while (attempt <= this.maxRetries) {
      this.onEvent({ type: "attempt", attempt });

      const edits = await this.editProvider({
        plan,
        attempt,
        testResult
      });

      if (edits === null || edits === undefined) {
        return {
          status: attempt === 0 ? "planned" : "escalated",
          stage: "execute",
          plan,
          attempt,
          testResult,
          lastApply
        };
      }

      const applyApproved = await this.onGate({
        type: "diff",
        plan,
        edits,
        attempt
      });

      if (!applyApproved) {
        return {
          status: "rejected",
          stage: "diff",
          plan,
          attempt
        };
      }

      const applyResult = await this.executor.applyEdits(edits);
      lastApply = applyResult;

      this.onEvent({ type: "applied", attempt, applyResult });

      testResult = await this.testRunner.run();

      this.onEvent({ type: "tests", attempt, testResult });

      if (testResult.passed) {
        return {
          status: "passed",
          plan,
          attempt,
          lastApply,
          testResult
        };
      }

      attempt++;
    }

    return {
      status: "escalated",
      stage: "test",
      plan,
      attempt,
      lastApply,
      testResult
    };
  }
}
