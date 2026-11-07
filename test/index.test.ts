import { describe, expect, it } from "vitest";
import { analyze, FlakyError, formatReport, parseJUnit, type RunInput } from "../src/index.js";

describe("JUnit XML Parsing", () => {
  it("parses JUnit XML with testsuites and testcases", () => {
    const xml =
      '<testsuite name="s"><testcase classname="a.B" name="t1" time="0.25"/><testcase classname="a.B" name="t2"><failure message="x"/></testcase><testcase name="t3"><skipped/></testcase></testsuite>';
    const results = parseJUnit(xml);

    expect(results.map((r) => r.id)).toEqual(["a.B::t1", "a.B::t2", "s::t3"]);
    expect(results.map((r) => r.outcome)).toEqual(["passed", "failed", "skipped"]);
    expect(results.map((r) => r.durationMs)).toEqual([250, null, null]);
  });

  it("parses Surefire flakyFailure and error tags", () => {
    const surefireXml = '<testcase classname="a" name="x"><flakyFailure message="m"/></testcase>';
    const results1 = parseJUnit(surefireXml);
    expect(results1).toHaveLength(1);
    expect(results1[0]?.outcome).toBe("passed");
    expect(results1[0]?.flakyMarker).toBe(true);

    const errorXml = '<testcase classname="a" name="x"><error/></testcase>';
    const results2 = parseJUnit(errorXml);
    expect(results2[0]?.outcome).toBe("failed");
    expect(results2[0]?.flakyMarker).toBe(false);
  });

  it("parses rerunFailure as flakyMarker true and passed if no failure child", () => {
    const rerunXml = '<testcase classname="a" name="x"><rerunFailure message="flaky"/></testcase>';
    const results = parseJUnit(rerunXml);
    expect(results[0]?.outcome).toBe("passed");
    expect(results[0]?.flakyMarker).toBe(true);
  });

  it("decodes XML entities including numeric ones and handles CDATA and comments", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- comment here -->
<testsuite name="s &amp; &#65; &#x42;">
  <testcase classname="c" name="a &amp; b">
    <![CDATA[ some cdata info ]]>
  </testcase>
</testsuite>`;
    const results = parseJUnit(xml);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("a & b");
  });

  it("rejects DOCTYPE declarations", () => {
    const xml = '<!DOCTYPE x [<!ENTITY a "b">]><testsuite/>';
    expect(() => parseJUnit(xml)).toThrowError(FlakyError);
    try {
      parseJUnit(xml);
    } catch (e) {
      expect(e).toBeInstanceOf(FlakyError);
      expect((e as FlakyError).code).toBe("DOCTYPE_NOT_ALLOWED");
    }
  });

  it("enforces maxDepth boundary (64 accepted, 65 rejected)", () => {
    let deep64 = '<testcase name="t"/>';
    for (let i = 0; i < 63; i++) {
      deep64 = `<g>${deep64}</g>`;
    }
    expect(parseJUnit(deep64, { maxDepth: 64 })).toHaveLength(1);

    let deep65 = '<testcase name="t"/>';
    for (let i = 0; i < 64; i++) {
      deep65 = `<g>${deep65}</g>`;
    }
    expect(() => parseJUnit(deep65, { maxDepth: 64 })).toThrowError(FlakyError);
    try {
      parseJUnit(deep65, { maxDepth: 64 });
    } catch (e) {
      expect((e as FlakyError).code).toBe("TOO_DEEP");
    }
  });

  it("rejects mismatched or unclosed tags with INVALID_XML", () => {
    expect(() => parseJUnit("<testsuite><testcase>")).toThrowError(FlakyError);
    try {
      parseJUnit("<testsuite><testcase>");
    } catch (e) {
      expect((e as FlakyError).code).toBe("INVALID_XML");
    }

    expect(() => parseJUnit("<testsuite></other>")).toThrowError(FlakyError);
    expect(() => parseJUnit("")).toThrowError(FlakyError);
    expect(() => parseJUnit("<a/><b/>")).toThrowError(FlakyError);
    expect(() => parseJUnit("<!-- unclosed")).toThrowError(FlakyError);
    expect(() => parseJUnit("<? unclosed")).toThrowError(FlakyError);
    expect(() => parseJUnit("<![CDATA[ unclosed")).toThrowError(FlakyError);
  });

  it("enforces maxLength boundary (20_000_000 accepted, 20_000_001 rejected)", () => {
    const base = "<testsuite>";
    const close = "</testsuite>";
    const fillLen = 20_000_000 - base.length - close.length;
    const validXml = `${base}${" ".repeat(fillLen)}${close}`;
    expect(validXml.length).toBe(20_000_000);
    expect(() => parseJUnit(validXml)).not.toThrow();

    const tooLargeXml = `${validXml} `;
    expect(tooLargeXml.length).toBe(20_000_001);
    expect(() => parseJUnit(tooLargeXml)).toThrowError(FlakyError);
    try {
      parseJUnit(tooLargeXml);
    } catch (e) {
      expect((e as FlakyError).code).toBe("INPUT_TOO_LARGE");
    }
  });

  it("handles invalid time attributes", () => {
    const xml = '<testcase name="t" time="abc"/>';
    const results = parseJUnit(xml);
    expect(results[0]?.durationMs).toBeNull();
  });

  it("handles single-quoted attributes and CRLF", () => {
    const xml =
      "<testsuite name='suite1'\r\n><testcase classname='my.Class' name='myTest' time='1.5'/>\r\n</testsuite>";
    const results = parseJUnit(xml);
    expect(results[0]?.id).toBe("my.Class::myTest");
    expect(results[0]?.durationMs).toBe(1500);
  });
});

describe("Flaky Test Analyzer", () => {
  it("identifies flaky test when same commit has pass and failure", () => {
    const runs: RunInput[] = [
      {
        runId: "r1",
        commit: "c1",
        timestamp: "2025-01-01T10:00:00Z",
        results: [
          {
            id: "a.B::t2",
            classname: "a.B",
            name: "t2",
            outcome: "failed",
            flakyMarker: false,
            durationMs: null,
          },
        ],
      },
      {
        runId: "r2",
        commit: "c1",
        timestamp: "2025-01-01T11:00:00Z",
        results: [
          {
            id: "a.B::t2",
            classname: "a.B",
            name: "t2",
            outcome: "passed",
            flakyMarker: false,
            durationMs: null,
          },
        ],
      },
    ];

    const report = analyze(runs);
    expect(report.tests).toHaveLength(1);
    expect(report.tests[0]?.verdict).toBe("flaky");
    expect(report.tests[0]?.flakyCommits).toEqual(["c1"]);
  });

  it("classifies flip rates over distinct commits", () => {
    const makeRuns = (outcomes: ("passed" | "failed")[]): RunInput[] => {
      return outcomes.map((outcome, idx) => ({
        runId: `run-${idx}`,
        commit: `commit-${idx}`,
        timestamp: new Date(1700000000000 + idx * 3600000).toISOString(),
        results: [
          {
            id: "test1",
            classname: "c",
            name: "test1",
            outcome,
            flakyMarker: false,
            durationMs: null,
          },
        ],
      }));
    };

    // P F P P F P -> 6 runs, 4 flips: 4 / 5 = 0.8
    const rSuspect = analyze(
      makeRuns(["passed", "failed", "passed", "passed", "failed", "passed"]),
    );
    expect(rSuspect.tests[0]?.flipRate).toBe(0.8);
    expect(rSuspect.tests[0]?.verdict).toBe("suspect");

    // P P P P P F -> 6 runs, 1 flip: 1 / 5 = 0.2
    const rStable = analyze(makeRuns(["passed", "passed", "passed", "passed", "passed", "failed"]));
    expect(rStable.tests[0]?.flipRate).toBe(0.2);
    expect(rStable.tests[0]?.verdict).toBe("stable");

    // F F F F F F -> 6 runs, 0 flips -> broken
    const rBroken = analyze(makeRuns(["failed", "failed", "failed", "failed", "failed", "failed"]));
    expect(rBroken.tests[0]?.verdict).toBe("broken");

    // P F P F -> 4 runs (< default minRuns 5) -> stable
    const rShort = analyze(makeRuns(["passed", "failed", "passed", "failed"]));
    expect(rShort.tests[0]?.verdict).toBe("stable");
  });

  it("considers Surefire testcase with flakyFailure as verdict flaky", () => {
    const run: RunInput = {
      runId: "r1",
      commit: "c1",
      timestamp: "2025-01-01T00:00:00Z",
      results: [
        {
          id: "a::x",
          classname: "a",
          name: "x",
          outcome: "passed",
          flakyMarker: true,
          durationMs: 100,
        },
      ],
    };
    const rep = analyze([run]);
    expect(rep.tests[0]?.verdict).toBe("flaky");
  });

  it("throws LIMIT_EXCEEDED when run count > 1000", () => {
    const dummyRun: RunInput = {
      runId: "r",
      commit: "c",
      timestamp: "2025-01-01T00:00:00Z",
      results: [],
    };
    const runs = Array.from({ length: 1001 }, (_, i) => ({ ...dummyRun, runId: `r${i}` }));
    expect(() => analyze(runs)).toThrowError(FlakyError);
    try {
      analyze(runs);
    } catch (e) {
      expect((e as FlakyError).code).toBe("LIMIT_EXCEEDED");
    }
  });

  it("throws INVALID_RUN on invalid timestamp", () => {
    const runs: RunInput[] = [{ runId: "r1", commit: "c1", timestamp: "yesterday", results: [] }];
    expect(() => analyze(runs)).toThrowError(FlakyError);
    try {
      analyze(runs);
    } catch (e) {
      expect((e as FlakyError).code).toBe("INVALID_RUN");
    }
  });

  it("merges duplicate testcases in single run with worst outcome winning", () => {
    const run: RunInput = {
      runId: "r1",
      commit: "c1",
      timestamp: "2025-01-01T00:00:00Z",
      results: [
        {
          id: "t1",
          classname: "c",
          name: "t1",
          outcome: "passed",
          flakyMarker: false,
          durationMs: null,
        },
        {
          id: "t1",
          classname: "c",
          name: "t1",
          outcome: "failed",
          flakyMarker: false,
          durationMs: null,
        },
      ],
    };
    const rep = analyze([run]);
    expect(rep.tests[0]?.verdict).toBe("broken");
    expect(rep.tests[0]?.failures).toBe(1);
  });

  it("orders tests by verdict order, then flipRate descending, then id", () => {
    // Build report fixture with one of each: flaky, suspect, broken, stable
    const runs: RunInput[] = [
      // Flaky test f1: same commit flip
      {
        runId: "r1",
        commit: "c1",
        timestamp: "2025-01-01T01:00:00Z",
        results: [
          {
            id: "t_flaky",
            classname: "c",
            name: "t_flaky",
            outcome: "passed",
            flakyMarker: false,
            durationMs: null,
          },
        ],
      },
      {
        runId: "r2",
        commit: "c1",
        timestamp: "2025-01-01T02:00:00Z",
        results: [
          {
            id: "t_flaky",
            classname: "c",
            name: "t_flaky",
            outcome: "failed",
            flakyMarker: false,
            durationMs: null,
          },
        ],
      },
      // Suspect test s1: 6 runs, 4 flips
      ...(["passed", "failed", "passed", "passed", "failed", "passed"] as const).map(
        (outcome, i) => ({
          runId: `rs${i}`,
          commit: `cs${i}`,
          timestamp: `2025-01-01T0${i}:00:00Z`,
          results: [
            {
              id: "t_suspect",
              classname: "c",
              name: "t_suspect",
              outcome,
              flakyMarker: false,
              durationMs: null,
            },
          ],
        }),
      ),
      // Broken test b1: 1 run failed
      {
        runId: "rb1",
        commit: "cb1",
        timestamp: "2025-01-01T01:00:00Z",
        results: [
          {
            id: "t_broken",
            classname: "c",
            name: "t_broken",
            outcome: "failed",
            flakyMarker: false,
            durationMs: null,
          },
        ],
      },
      // Stable test st1: 1 run passed
      {
        runId: "rst1",
        commit: "cst1",
        timestamp: "2025-01-01T01:00:00Z",
        results: [
          {
            id: "t_stable",
            classname: "c",
            name: "t_stable",
            outcome: "passed",
            flakyMarker: false,
            durationMs: null,
          },
        ],
      },
    ];

    const rep = analyze(runs);
    expect(rep.tests.map((t) => t.verdict)).toEqual(["flaky", "suspect", "broken", "stable"]);

    const formatted = formatReport(rep, "text");
    expect(formatted.startsWith("flaky 1, suspect 1, broken 1, stable 1\n")).toBe(true);
    expect(formatted).toContain("flaky t_flaky flip=1 runs=2");
    expect(formatted).toContain("suspect t_suspect flip=0.8 runs=6");
    expect(formatted).toContain("broken t_broken flip=0 runs=1");
    expect(formatted).not.toContain("stable t_stable");

    const jsonFormatted = formatReport(rep, "json");
    const parsedJson = JSON.parse(jsonFormatted);
    expect(parsedJson.tests).toHaveLength(4);
  });
});
