# Security practices

## Threat Model

This utility parses untrusted JUnit XML files often generated in CI environments. It defends against:

- **XXE (XML External Entity)**: `<!DOCTYPE` declarations are strictly forbidden.
- **Billion Laughs / Entity Expansion**: No DTD processing; only predefined and numeric entities are expanded.
- **Billion Laughs / Recursive Expansion**: `maxDepth` (default 64) prevents deep recursion.
- **Oversized Payloads**: `maxLength` (default 20,000,000 bytes) prevents memory exhaustion.
- **Mismatched tags**: The linear tokenizer strictly validates tag closure and hierarchy.

## Limits

The code enforces strict bounds on input sizes (`maxLength` and `maxDepth`) and run limits (`maxRuns` 1000, `maxTestcases` 100,000) to ensure predictable performance and avoid DoS scenarios during analysis.