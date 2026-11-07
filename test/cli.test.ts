import { describe, expect, it } from "vitest";
import { type CliIo, run } from "../src/cli.js";

describe("CLI run()", () => {
  const makeMockIo = (
    files: Record<string, string>,
  ): { io: CliIo; stdout: string[]; stderr: string[] } => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io: CliIo = {
      stdout: (s: string) => stdout.push(s),
      stderr: (s: string) => stderr.push(s),
      readFile: async (p: string) => {
        const content = files[p];
        if (content === undefined) {
          throw new Error(`File not found: ${p}`);
        }
        return content;
      },
    };
    return { io, stdout, stderr };
  };

  it("returns 1 when any test is flaky or suspect", async () => {
    const runsJson = JSON.stringify([
      {
        runId: "r1",
        commit: "c1",
        timestamp: "2025-01-01T00:00:00Z",
        files: ["rep1.xml"],
      },
      {
        runId: "r2",
        commit: "c1",
        timestamp: "2025-01-01T01:00:00Z",
        files: ["rep2.xml"],
      },
    ]);
    const rep1 = '<testsuite name="s"><testcase name="t" classname="c"/></testsuite>';
    const rep2 =
      '<testsuite name="s"><testcase name="t" classname="c"><failure message="f"/></testcase></testsuite>';

    const { io, stdout } = makeMockIo({
      "runs.json": runsJson,
      "rep1.xml": rep1,
      "rep2.xml": rep2,
    });

    const code = await run(["--runs", "runs.json"], io);
    expect(code).toBe(1);
    expect(stdout.join("")).toContain("flaky c::t");
  });

  it("returns 0 when all tests are stable or broken", async () => {
    const runsJson = JSON.stringify([
      {
        runId: "r1",
        commit: "c1",
        timestamp: "2025-01-01T00:00:00Z",
        files: ["rep1.xml"],
      },
    ]);
    const rep1 = '<testsuite name="s"><testcase name="t" classname="c"/></testsuite>';

    const { io, stdout } = makeMockIo({
      "dir/runs.json": runsJson,
      "dir/rep1.xml": rep1,
    });

    const code = await run(["--runs", "dir/runs.json", "--format", "json"], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.tests[0].verdict).toBe("stable");
  });

  it("returns 2 with 'error: ' on stderr for unreadable files or FlakyError", async () => {
    const { io: ioMissing, stderr: stderrMissing } = makeMockIo({});
    const codeMissing = await run(["--runs", "missing.json"], ioMissing);
    expect(codeMissing).toBe(2);
    expect(stderrMissing.join("")).toMatch(/^error: /);

    const { io: ioNoArg, stderr: stderrNoArg } = makeMockIo({});
    const codeNoArg = await run([], ioNoArg);
    expect(codeNoArg).toBe(2);
    expect(stderrNoArg.join("")).toMatch(/^error: /);

    const { io: ioBadJson, stderr: stderrBadJson } = makeMockIo({
      "runs.json": "invalid json",
    });
    const codeBadJson = await run(["--runs", "runs.json"], ioBadJson);
    expect(codeBadJson).toBe(2);
    expect(stderrBadJson.join("")).toMatch(/^error: /);

    const { io: ioBadFormat, stderr: stderrBadFormat } = makeMockIo({
      "runs.json": "[]",
    });
    const codeBadFormat = await run(["--runs", "runs.json", "--format", "yaml"], ioBadFormat);
    expect(codeBadFormat).toBe(2);
    expect(stderrBadFormat.join("")).toMatch(/^error: /);
  });
});
