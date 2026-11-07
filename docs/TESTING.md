# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suites in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.

## Coverage

- `test/cli.test.ts`: Covers CLI runner (`run`), IO interaction, error handling (missing files, bad JSON), and output formats.
- `test/index.test.ts`: Covers `parseJUnit` (including boundary checks for depth, length, invalid XML, entities, and Surefire markers) and `analyze` (verdict logic, sorting, flip rates, and limits).

## Rules

- Coverage must stay at or above 80 % for lines, branches, functions and statements.
- Tests are deterministic, rely on injected memory buffers rather than real FS where possible, and assert directly against output/thrown errors.