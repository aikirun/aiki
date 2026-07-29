# TypeScript

This document outlines the TypeScript coding style and conventions for the project. It is intended to ensure consistency, readability, and maintainability across the codebase.

## 1. TypeScript style

- Prioritize clean, readable, and maintainable TypeScript code.
- Employ modern language features and patterns where appropriate and consistent with the existing codebase.
- Prefer `unknown` to `any`; never introduce `any` (explicit or implicit).
- Skip explicit type annotations on `let`/`const` when TypeScript infers the type from the initializer. Annotate where inference can't carry the intent (public signatures, empty collections).
- Use string-literal unions backed by `as const` arrays for known strings (`WORKFLOW_RUN_STATUSES` style); no TypeScript `enum`s.
- API responses: do NOT use `0 | 1`; convert to `true | false`.
- Type assertions are a last resort, with three accepted uses: branded ids and timestamps (`as WorkflowRunId`, `as TimestampMs`), `as const`, and `as NonEmptyArray<T>` when non-emptiness is already proven (after an `isNonEmptyArray` guard, or a length-preserving `.map` over a `NonEmptyArray`). When non-emptiness is not proven, use the `isNonEmptyArray` guard instead of asserting. Never assert to silence a genuine type error, and never use non-null assertions (`!`) without a proven invariant right above (see the testing guide for the one accepted pattern).
- No single-line `if` statements — always braces on their own lines.
- Use `Array.from(new Set(...))` rather than spreading a Set; avoid spread for concatenating potentially large arrays — use `concat` or push loops.
- Exhaustiveness checks use `satisfies` in the `default`/`else` branch: `value satisfies never` (or `value satisfies "a" | "b"` for the not-yet-handled remainder).
- Prefer `async`/`await` with `try`/`catch` over `.catch()` chaining.
- A branch like `result instanceof Promise ? await result : result` is deliberate (it avoids microtask overhead for sync values) — don't collapse it into a bare `await`.
- Log errors under the `err` key (pino's default error serializer).
- Use template literals instead of string concatenation.
- Avoid re-typing arrow function parameters when inference is sufficient: `items.map(item => item.id)` NOT `items.map((item: ItemType) => item.id)`.
- Do not rename default imports with `as`.
- Use `import Bar = Foo.Bar` namespace aliases with caution — if `Foo.Bar` is renamed, the alias won't auto-update.
- Error handling: prefer guard clauses and explicit error types; avoid complex/nested ternaries. Simple ternaries for assignments are acceptable if readable. Guard clauses first, happy path last.

## 2. Naming Conventions

- Suffix variable names with units (`timeoutDurationSeconds`; this codebase's convention is `Ms` for epoch/duration milliseconds).
- Use `UpperCamelCase` for class names and types, `lowerCamelCase` for variables and functions, and `SCREAMING_SNAKE_CASE` for constants.
- Classes: noun phrases. Methods/functions: verb phrases.
- No abbreviated variable names (`wf`, `ctx`, `cfg`) — write `workflow`, `context`, `config`.
- Timestamps are epoch milliseconds (`TimestampMs`) everywhere in code; never `Date` objects in domain types.

## 3. Interfaces and Types

- Co-locate interfaces near their use.
- Minimize optional-only interfaces; use discriminated unions where shapes diverge.
- Avoid dynamic field mapping (iterating over a mapping object to transfer properties). Prefer explicit property assignment for type safety.
- Use type predicate functions (`value is MyType`) for narrowing types in conditionals.
- Use discriminated unions with exhaustiveness checks (`satisfies` in the default branch) when modelling objects that can be one of several distinct shapes.
- The runtime validation schemas in `sdk/server/src/contract/schema/` (arktype) duplicate the unions from `types/` as string literals. The contract procedures are compile-time bound to the API types, but the check is one-directional: a schema accepting shapes outside the API type fails `bun run check`, while a schema missing a newly added union member infers a subtype and still compiles — it only fails at runtime parsing. When adding a union member (a new status, reason, or variant) in `types/`, update the matching schema in the same change.

## 4. Development flow

- Run `bun run check` (typecheck) and `bun run lint` before finishing; use `bun run lint:fix` to auto-fix. Make sure there are no Biome complaints before pushing.
- `biome-ignore` suppressions are a last resort and must carry a justification after the colon stating the invariant that makes the suppressed rule safe (e.g., a length assertion directly above a non-null assertion). If you can't state the invariant, fix the underlying issue instead.
- Read failing check/lint output before assuming it's pre-existing — it is usually your own new violation.
- Compile changed TypeScript and run the appropriate targeted tests.

## 5. Comments

No AI-style explanatory comments. Don't document the framework default. Don't paraphrase the code. Don't summarise code or tests in a comment so later readers can skip reading them — a summary that restates behaviour is a second source of truth that silently drifts. A comment is justified only when behaviour is non-obvious and a name/structure change couldn't carry it. When in doubt, delete it.

Comments describe the current design in present tense — the constraint the code can't show. Never chronicle bugs fixed, reference prior approaches ("no longer", "instead of the old X"), or contrast with alternatives that were never shipped.

Write for the package's audience. A comment's vocabulary must not exceed what a reader of that package can see: `types/` is read by SDK consumers, so its doc comments describe the contract as visible from the package boundary (workers, claims, refreshes), never internals of another package (server daemons, outbox rows, database statuses). Put mechanism detail in a comment in the package that implements the mechanism.

## 6. Security

- Input Sanitization: Assume all external inputs (user-provided, API requests) are untrusted. Sanitize/validate thoroughly.
- Always parametrize SQL queries to prevent SQL injection. Never interpolate user input directly into queries.
- Principle of Least Privilege: Enforce role-based access control and ensure processes/users have only the minimum necessary permissions.
- Error Handling: Return generic errors to clients; avoid leaking stack traces or internal details.
- Dependency Evaluation: Vet libraries before importing; avoid assuming any dependency is appropriate for every business scenario or context.
