# Project record: flaky-test-detector

## Objective

To provide an offline, reproducible analysis tool for CI test histories. It is for engineers who need to identify flaky tests without sending test data to third-party hosted services.

## Scope

In scope:
- Bounded, safe XML parsing for JUnit files (linear tokenizer).
- Identification of flaky tests based on same-commit pass/fail.
- Identification of flaky tests via Maven Surefire rerun markers.
- Flip-rate analysis across chronological CI runs.
- CLI and library APIs for test report analysis.

## Out-of-scope

- Fetching or integrating directly with CI/CD provider APIs.
- Automatic remediation, test quarantine, or issue filing.
- Parsing test report formats other than JUnit XML.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Factory run u192 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | gemini-3.8-flash | yes | 4556 | 12817 | 0 | 0 | 0.0257 |
| fix-1 | gemini-3.8-flash | no | 23719 | 4530 | 0 | 42631 | 0.0380 |
| fix-2 | gemini-3.8-flash | no | 22199 | 986 | 0 | 39927 | 0.0233 |
| fix-3 | gemini-3.8-flash | no | 15954 | 88 | 0 | 11763 | 0.0132 |
| audit | gemini-3.1-flash-lite | no | 31726 | 402 | 0 | 20349 | 0.0090 |
| docs | gemini-3.1-flash-lite | no | 16285 | 1263 | 0 | 0 | 0.0060 |

Total: $0.1152. Prices: Anthropic list prices.
