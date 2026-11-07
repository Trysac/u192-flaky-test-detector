# @trysac/flaky-test-detector

Flaky tests erode trust in CI: people rerun failed jobs until green and real regressions slip through, but nobody knows which tests are flaky because the evidence is spread over hundreds of JUnit reports. This utility reads JUnit XML from many runs and classifies every test with explicit, reproducible rules.

## Usage

```typescript
import { parseJUnit, analyze, formatReport } from "@trysac/flaky-test-detector";

const xml = '<testsuite name="s"><testcase classname="a.B" name="t1"/></testsuite>';
const results = parseJUnit(xml);
const report = analyze([{ runId: "r1", commit: "c1", timestamp: "2025-01-01T00:00:00Z", results }]);
console.log(formatReport(report, "text"));
```

## API Summary

### Core Functions
- `parseJUnit(xml: string, opts?: ParseJUnitOptions): TestResult[]`
- `analyze(runs: RunInput[], opts?: AnalyzeOptions): Report`
- `formatReport(report: Report, format: "text" | "json"): string`

### Limits & Options
- **XML Parsing**: Defaults: `maxLength` 20,000,000, `maxDepth` 64. Throws `FlakyError` on violation (`INPUT_TOO_LARGE`, `TOO_DEEP`).
- **Analysis**: Defaults: `minRuns` 5, `suspectFlipRate` 0.3, `maxRuns` 1000, `maxTestcases` 100,000.
- **Errors**: `FlakyError` codes include `DOCTYPE_NOT_ALLOWED`, `INVALID_XML`, `INVALID_RUN`, `LIMIT_EXCEEDED`.

## Why not <best-known alternative>?

Hosted analytics products require CI integration and subscriptions. This utility is offline, free, requires no runtime dependencies, and allows you to test your detection logic deterministically against your own history.

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model and safe parsing implementation.