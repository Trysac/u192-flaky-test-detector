/**
 * CLI runner for flaky-test-detector.
 */
import { analyze, FlakyError, formatReport, parseJUnit, type RunInput } from "./index.js";

export interface CliIo {
  stdout(s: string): void;
  stderr(s: string): void;
  readFile(path: string): Promise<string>;
}

interface RunConfigFileItem {
  runId: string;
  commit: string;
  timestamp: string;
  files: string[];
}

/**
 * Resolves a relative report file path relative to the runs.json path.
 */
function resolveReportPath(configPath: string, relativePath: string): string {
  const lastSlash = Math.max(configPath.lastIndexOf("/"), configPath.lastIndexOf("\\"));
  if (lastSlash === -1) {
    return relativePath;
  }
  const dir = configPath.slice(0, lastSlash);
  return `${dir}/${relativePath}`;
}

/**
 * CLI entry point.
 * Returns 0 if all tests stable or broken, 1 if any flaky or suspect, 2 on error.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    let runsPath: string | null = null;
    let format: "text" | "json" = "text";
    let minRuns: number | undefined;

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--runs" && i + 1 < argv.length) {
        runsPath = argv[++i] ?? null;
      } else if (arg === "--format" && i + 1 < argv.length) {
        const val = argv[++i];
        if (val === "text" || val === "json") {
          format = val;
        } else {
          throw new FlakyError("INVALID_RUN", `Unsupported format: ${val}`);
        }
      } else if (arg === "--min-runs" && i + 1 < argv.length) {
        const n = Number(argv[++i]);
        if (!Number.isFinite(n) || n < 1) {
          throw new FlakyError("INVALID_RUN", "Invalid --min-runs value");
        }
        minRuns = n;
      }
    }

    if (!runsPath) {
      io.stderr("error: Missing --runs argument\n");
      return 2;
    }

    const configContent = await io.readFile(runsPath);
    let runConfigs: RunConfigFileItem[];
    try {
      runConfigs = JSON.parse(configContent);
      if (!Array.isArray(runConfigs)) {
        throw new Error("Expected JSON array");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new FlakyError("INVALID_RUN", `Failed to parse runs config: ${msg}`);
    }

    const runs: RunInput[] = [];
    for (const rc of runConfigs) {
      const results = [];
      for (const filePath of rc.files) {
        const fullPath = resolveReportPath(runsPath, filePath);
        const xml = await io.readFile(fullPath);
        const parsed = parseJUnit(xml);
        results.push(...parsed);
      }
      runs.push({
        runId: rc.runId,
        commit: rc.commit,
        timestamp: rc.timestamp,
        results,
      });
    }

    const report = analyze(runs, minRuns !== undefined ? { minRuns } : undefined);
    const output = formatReport(report, format);
    io.stdout(output);

    const hasFlakyOrSuspect = report.tests.some(
      (t) => t.verdict === "flaky" || t.verdict === "suspect",
    );

    return hasFlakyOrSuspect ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`error: ${message}\n`);
    return 2;
  }
}
