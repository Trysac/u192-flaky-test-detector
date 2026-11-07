# Architecture

## Overview

`@trysac/flaky-test-detector` provides offline analysis of test run histories based on standard JUnit XML reports.

```
 JUnit XML String  ──>  [parseJUnit]  ──>  TestResult[]
                                                 │
                                                 ▼
 RunInput[] (commit, timestamp, results) ──>  [analyze]  ──>  Report
                                                                │
                                                                ▼
                                                          [formatReport]  ──>  Text / JSON
```

## Security and Robustness

1. **Safe Linear XML Parsing**: The tokenizer enforces depth limits (`maxDepth: 64` by default) and payload length limits (`maxLength: 20_000_000`). It strictly rejects `<!DOCTYPE` declarations, disallowing external entity inclusion (XXE) and recursive expansion attacks.
2. **Entity Expansion Restrictions**: Only predefined XML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`) and numeric character entities (`&#...;`, `&#x...;`) are expanded.
3. **Deterministic Classification Order**:
   - `flaky`: Test has at least one same-commit pass and fail, or has a Surefire rerun marker.
   - `broken`: All considered runs failed (n >= 1).
   - `suspect`: Run count meets threshold (`n >= minRuns`) and `flipRate >= suspectFlipRate`.
   - `stable`: Everything else.
