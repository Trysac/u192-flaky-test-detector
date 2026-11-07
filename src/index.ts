/**
 * Public entry point for @trysac/flaky-test-detector.
 * Safe JUnit XML parsing and flaky test history analyzer.
 */

/**
 * Machine-readable error codes thrown by {@link FlakyError}.
 */
export type FlakyErrorCode =
  | "INPUT_TOO_LARGE"
  | "DOCTYPE_NOT_ALLOWED"
  | "TOO_DEEP"
  | "INVALID_XML"
  | "INVALID_RUN"
  | "LIMIT_EXCEEDED";

/**
 * Base typed error thrown by parser and analyzer operations.
 */
export class FlakyError extends Error {
  readonly code: FlakyErrorCode;

  constructor(code: FlakyErrorCode, message: string) {
    super(message.length > 200 ? `${message.slice(0, 197)}...` : message);
    this.name = "FlakyError";
    this.code = code;
  }
}

/**
 * Outcome of an individual testcase in a JUnit report.
 */
export type TestOutcome = "passed" | "failed" | "skipped";

/**
 * Parsed testcase result.
 */
export interface TestResult {
  id: string;
  classname: string;
  name: string;
  outcome: TestOutcome;
  flakyMarker: boolean;
  durationMs: number | null;
}

/**
 * Options for parsing JUnit XML.
 */
export interface ParseJUnitOptions {
  maxLength?: number; // default 20_000_000
  maxDepth?: number; // default 64
}

interface XmlNode {
  tag: string;
  attributes: Record<string, string>;
  children: XmlNode[];
}

/**
 * Decodes XML predefined entities and numeric character references.
 */
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g,
    (_, entity, dec, hex) => {
      if (entity) {
        switch (entity) {
          case "amp":
            return "&";
          case "lt":
            return "<";
          case "gt":
            return ">";
          case "quot":
            return '"';
          case "apos":
            return "'";
          default:
            return _;
        }
      }
      if (dec) {
        const code = Number.parseInt(dec, 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      }
      if (hex) {
        const code = Number.parseInt(hex, 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      }
      return _;
    },
  );
}

/**
 * Parses attributes from an attribute string.
 */
function parseAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z0-9_.:-]+)\s*=\s*("[^"]*"|'[^']*')/g;
  for (const match of attrText.matchAll(pattern)) {
    const name = match[1];
    const rawVal = match[2];
    if (name && rawVal !== undefined) {
      const innerVal = rawVal.slice(1, -1);
      attrs[name] = decodeEntities(innerVal);
    }
  }
  return attrs;
}

/**
 * Safe linear XML tokenizer and tree builder for JUnit XML.
 */
function parseXmlTree(xml: string, maxDepth: number): XmlNode {
  if (xml.includes("<!DOCTYPE") || xml.includes("<!doctype")) {
    throw new FlakyError("DOCTYPE_NOT_ALLOWED", "DOCTYPE declarations are forbidden");
  }

  let index = 0;
  const len = xml.length;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;

  while (index < len) {
    const nextLt = xml.indexOf("<", index);
    if (nextLt === -1) {
      break;
    }

    index = nextLt;
    if (xml.startsWith("<!--", index)) {
      const end = xml.indexOf("-->", index + 4);
      if (end === -1) {
        throw new FlakyError("INVALID_XML", "Unclosed comment");
      }
      index = end + 3;
      continue;
    }

    if (xml.startsWith("<?", index)) {
      const end = xml.indexOf("?>", index + 2);
      if (end === -1) {
        throw new FlakyError("INVALID_XML", "Unclosed processing instruction");
      }
      index = end + 2;
      continue;
    }

    if (xml.startsWith("<![CDATA[", index)) {
      const end = xml.indexOf("]]>", index + 9);
      if (end === -1) {
        throw new FlakyError("INVALID_XML", "Unclosed CDATA");
      }
      index = end + 3;
      continue;
    }

    // Closing tag
    if (xml.startsWith("</", index)) {
      const end = xml.indexOf(">", index + 2);
      if (end === -1) {
        throw new FlakyError("INVALID_XML", "Unclosed closing tag");
      }
      const tagName = xml.slice(index + 2, end).trim();
      const current = stack.pop();
      if (!current || current.tag !== tagName) {
        throw new FlakyError(
          "INVALID_XML",
          `Mismatched closing tag: expected ${current?.tag}, got ${tagName}`,
        );
      }
      index = end + 1;
      continue;
    }

    // Opening or self-closing tag
    const closeTag = xml.indexOf(">", index + 1);
    if (closeTag === -1) {
      throw new FlakyError("INVALID_XML", "Unclosed tag");
    }

    const rawTagContent = xml.slice(index + 1, closeTag).trim();
    index = closeTag + 1;

    const isSelfClosing = rawTagContent.endsWith("/");
    const tagBody = isSelfClosing ? rawTagContent.slice(0, -1).trim() : rawTagContent;
    const firstSpace = tagBody.search(/\s/);
    const tagName = firstSpace === -1 ? tagBody : tagBody.slice(0, firstSpace);
    const attrText = firstSpace === -1 ? "" : tagBody.slice(firstSpace);

    if (!tagName || /[^a-zA-Z0-9_.:-]/.test(tagName)) {
      throw new FlakyError("INVALID_XML", `Invalid tag name: ${tagName}`);
    }

    if (stack.length + 1 > maxDepth) {
      throw new FlakyError("TOO_DEEP", `XML exceeds maximum depth limit of ${maxDepth}`);
    }

    const node: XmlNode = {
      tag: tagName,
      attributes: parseAttributes(attrText),
      children: [],
    };

    if (stack.length > 0) {
      stack[stack.length - 1]?.children.push(node);
    } else {
      if (root !== null) {
        throw new FlakyError("INVALID_XML", "Multiple root elements found");
      }
      root = node;
    }

    if (!isSelfClosing) {
      stack.push(node);
    }
  }

  if (stack.length > 0) {
    throw new FlakyError("INVALID_XML", `Unclosed tag: ${stack[stack.length - 1]?.tag}`);
  }

  if (!root) {
    throw new FlakyError("INVALID_XML", "Empty XML document");
  }

  return root;
}

/**
 * Parses duration attribute into rounded milliseconds or null.
 */
function parseDurationMs(timeStr: string | undefined): number | null {
  if (!timeStr) {
    return null;
  }
  const s = Number(timeStr.trim());
  if (!Number.isFinite(s) || s < 0) {
    return null;
  }
  return Math.round(s * 1000);
}

/**
 * Extracts test cases from a parsed XML node tree.
 */
function extractTestcases(
  node: XmlNode,
  currentSuiteName: string | null,
  results: TestResult[],
): void {
  let suiteName = currentSuiteName;
  if (node.tag === "testsuite") {
    const nameAttr = node.attributes.name;
    if (nameAttr && nameAttr.trim().length > 0) {
      suiteName = nameAttr.trim();
    }
  }

  if (node.tag === "testcase") {
    const name = (node.attributes.name ?? "").trim();
    const classnameAttr = (node.attributes.classname ?? "").trim();
    const classname = classnameAttr !== "" ? classnameAttr : (suiteName ?? "");
    const id = `${classname}::${name}`;
    const durationMs = parseDurationMs(node.attributes.time);

    let hasFailureOrError = false;
    let hasSkipped = false;
    let flakyMarker = false;

    for (const child of node.children) {
      if (child.tag === "failure" || child.tag === "error") {
        hasFailureOrError = true;
      } else if (child.tag === "skipped") {
        hasSkipped = true;
      } else if (
        child.tag === "flakyFailure" ||
        child.tag === "flakyError" ||
        child.tag === "rerunFailure"
      ) {
        flakyMarker = true;
      }
    }

    let outcome: TestOutcome;
    if (hasFailureOrError) {
      outcome = "failed";
    } else if (hasSkipped) {
      outcome = "skipped";
    } else {
      outcome = "passed";
    }

    results.push({
      id,
      classname,
      name,
      outcome,
      flakyMarker,
      durationMs,
    });
  }

  for (const child of node.children) {
    extractTestcases(child, suiteName, results);
  }
}

/**
 * Parses JUnit XML string into structured testcase results.
 */
export function parseJUnit(xml: string, opts?: ParseJUnitOptions): TestResult[] {
  const maxLength = opts?.maxLength ?? 20_000_000;
  const maxDepth = opts?.maxDepth ?? 64;

  if (xml.length > maxLength) {
    throw new FlakyError("INPUT_TOO_LARGE", `Input exceeds maximum length ${maxLength}`);
  }

  const root = parseXmlTree(xml, maxDepth);
  const results: TestResult[] = [];
  extractTestcases(root, null, results);
  return results;
}

/**
 * Input run containing metadata and test results.
 */
export interface RunInput {
  runId: string;
  commit: string;
  timestamp: string; // ISO 8601 with zone
  results: TestResult[];
}

/**
 * Analysis options.
 */
export interface AnalyzeOptions {
  minRuns?: number; // default 5
  suspectFlipRate?: number; // default 0.3
  maxRuns?: number; // default 1000
  maxTestcases?: number; // default 100_000
}

/**
 * Classification verdict for a test.
 */
export type Verdict = "flaky" | "suspect" | "broken" | "stable";

/**
 * Per-test statistics and verdict.
 */
export interface TestStat {
  id: string;
  runs: number;
  passes: number;
  failures: number;
  flipRate: number;
  flakyCommits: string[];
  verdict: Verdict;
}

/**
 * Complete flaky test analysis report.
 */
export interface Report {
  tests: TestStat[];
}

/**
 * Merges multiple test results of the same testcase in a single run.
 * Worst outcome wins: failed > passed > skipped.
 */
function mergeRunResults(
  results: TestResult[],
): Map<string, { outcome: TestOutcome; flakyMarker: boolean }> {
  const map = new Map<string, { outcome: TestOutcome; flakyMarker: boolean }>();
  for (const r of results) {
    const existing = map.get(r.id);
    if (!existing) {
      map.set(r.id, { outcome: r.outcome, flakyMarker: r.flakyMarker });
    } else {
      const combinedFlaky = existing.flakyMarker || r.flakyMarker;
      let finalOutcome = existing.outcome;
      if (existing.outcome === "failed" || r.outcome === "failed") {
        finalOutcome = "failed";
      } else if (existing.outcome === "passed" || r.outcome === "passed") {
        finalOutcome = "passed";
      } else {
        finalOutcome = "skipped";
      }
      map.set(r.id, { outcome: finalOutcome, flakyMarker: combinedFlaky });
    }
  }
  return map;
}

interface ResolvedRun {
  runId: string;
  commit: string;
  timeMs: number;
  resultsById: Map<string, { outcome: TestOutcome; flakyMarker: boolean }>;
}

/**
 * Analyzes test runs across commits to identify flaky, suspect, broken, or stable tests.
 */
export function analyze(runs: RunInput[], opts?: AnalyzeOptions): Report {
  const minRuns = opts?.minRuns ?? 5;
  const suspectFlipRate = opts?.suspectFlipRate ?? 0.3;
  const maxRuns = opts?.maxRuns ?? 1000;
  const maxTestcases = opts?.maxTestcases ?? 100_000;

  if (runs.length > maxRuns) {
    throw new FlakyError(
      "LIMIT_EXCEEDED",
      `Run count ${runs.length} exceeds maximum limit of ${maxRuns}`,
    );
  }

  const resolvedRuns: ResolvedRun[] = [];
  const allTestIds = new Set<string>();

  for (const r of runs) {
    if (!r.runId || !r.commit || !r.timestamp) {
      throw new FlakyError(
        "INVALID_RUN",
        "Run is missing required fields (runId, commit, timestamp)",
      );
    }
    const parsedTime = Date.parse(r.timestamp);
    if (!Number.isFinite(parsedTime)) {
      throw new FlakyError("INVALID_RUN", `Invalid run timestamp: ${r.timestamp}`);
    }
    const merged = mergeRunResults(r.results);
    for (const id of merged.keys()) {
      allTestIds.add(id);
    }
    if (allTestIds.size > maxTestcases) {
      throw new FlakyError(
        "LIMIT_EXCEEDED",
        `Testcase count exceeds maximum limit of ${maxTestcases}`,
      );
    }
    resolvedRuns.push({
      runId: r.runId,
      commit: r.commit,
      timeMs: parsedTime,
      resultsById: merged,
    });
  }

  // Sort runs chronologically by timestamp, then by runId
  resolvedRuns.sort((a, b) => {
    if (a.timeMs !== b.timeMs) {
      return a.timeMs - b.timeMs;
    }
    return a.runId.localeCompare(b.runId);
  });

  const testStats: TestStat[] = [];

  for (const testId of allTestIds) {
    let passes = 0;
    let failures = 0;
    let anyFlakyMarker = false;
    const consideredOutcomes: TestOutcome[] = [];
    const commitOutcomes = new Map<string, { pass: boolean; fail: boolean }>();

    for (const run of resolvedRuns) {
      const res = run.resultsById.get(testId);
      if (!res) {
        continue;
      }
      if (res.flakyMarker) {
        anyFlakyMarker = true;
      }

      if (res.outcome === "skipped") {
        continue;
      }

      consideredOutcomes.push(res.outcome);
      if (res.outcome === "passed") {
        passes += 1;
      } else if (res.outcome === "failed") {
        failures += 1;
      }

      let cState = commitOutcomes.get(run.commit);
      if (!cState) {
        cState = { pass: false, fail: false };
        commitOutcomes.set(run.commit, cState);
      }
      if (res.outcome === "passed") {
        cState.pass = true;
      } else if (res.outcome === "failed") {
        cState.fail = true;
      }
    }

    const n = consideredOutcomes.length;
    let flips = 0;
    for (let i = 1; i < n; i++) {
      if (consideredOutcomes[i] !== consideredOutcomes[i - 1]) {
        flips += 1;
      }
    }

    let rawFlipRate = 0;
    if (n >= 2) {
      rawFlipRate = flips / (n - 1);
    }
    const flipRate = Math.round(rawFlipRate * 10000) / 10000;

    const flakyCommits: string[] = [];
    for (const [commit, st] of commitOutcomes.entries()) {
      if (st.pass && st.fail) {
        flakyCommits.push(commit);
      }
    }
    flakyCommits.sort();

    let verdict: Verdict;
    if (flakyCommits.length > 0 || anyFlakyMarker) {
      verdict = "flaky";
    } else if (n >= 1 && failures === n) {
      verdict = "broken";
    } else if (n >= minRuns && flipRate >= suspectFlipRate) {
      verdict = "suspect";
    } else {
      verdict = "stable";
    }

    testStats.push({
      id: testId,
      runs: n,
      passes,
      failures,
      flipRate,
      flakyCommits,
      verdict,
    });
  }

  // Sort order: verdict order (flaky, suspect, broken, stable), flipRate descending, id ascending
  const verdictRank: Record<Verdict, number> = {
    flaky: 0,
    suspect: 1,
    broken: 2,
    stable: 3,
  };

  testStats.sort((a, b) => {
    const rA = verdictRank[a.verdict];
    const rB = verdictRank[b.verdict];
    if (rA !== rB) {
      return rA - rB;
    }
    if (b.flipRate !== a.flipRate) {
      return b.flipRate - a.flipRate;
    }
    return a.id.localeCompare(b.id);
  });

  return { tests: testStats };
}

/**
 * Formats a report into human-readable text or JSON string.
 */
export function formatReport(r: Report, format: "text" | "json"): string {
  if (format === "json") {
    return JSON.stringify(r, null, 2);
  }

  let flakyCount = 0;
  let suspectCount = 0;
  let brokenCount = 0;
  let stableCount = 0;

  for (const t of r.tests) {
    switch (t.verdict) {
      case "flaky":
        flakyCount++;
        break;
      case "suspect":
        suspectCount++;
        break;
      case "broken":
        brokenCount++;
        break;
      case "stable":
        stableCount++;
        break;
    }
  }

  const lines: string[] = [];
  lines.push(
    `flaky ${flakyCount}, suspect ${suspectCount}, broken ${brokenCount}, stable ${stableCount}`,
  );

  for (const t of r.tests) {
    if (t.verdict !== "stable") {
      lines.push(`${t.verdict} ${t.id} flip=${t.flipRate} runs=${t.runs}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
