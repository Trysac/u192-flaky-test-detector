# flaky-test-detector

[![npm version](https://img.shields.io/npm/v/@trysac/flaky-test-detector.svg)](https://www.npmjs.com/package/@trysac/flaky-test-detector)
[![license: MIT](https://img.shields.io/npm/l/@trysac/flaky-test-detector.svg)](LICENSE)
[![CI](https://github.com/Trysac/u192-flaky-test-detector/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u192-flaky-test-detector/actions/workflows/ci.yml)

Detect flaky tests from JUnit XML histories: same-commit pass and fail, Surefire flakyFailure, flip rate over runs and a bounded safe XML reader

## Problem

Describe in two or three sentences the concrete problem this utility solves, who hits it, and why existing
packages do not solve it well. Keep it factual; link to an issue or decision record when there is one.

## Install

```sh
npm install @trysac/flaky-test-detector
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations.

## Usage

```ts
import { greet } from "@trysac/flaky-test-detector";

// Build a greeting; surrounding whitespace is ignored.
const message = greet("  Ada ");
console.log(message); // "Hello, Ada!"

try {
  greet("   ");
} catch (error) {
  console.error((error as Error).message); // "name must not be empty"
}
```

## API

| Export | Signature | Description |
|---|---|---|
| `greet` | `(name: string) => string` | Placeholder API; replace it with the real one. |

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
