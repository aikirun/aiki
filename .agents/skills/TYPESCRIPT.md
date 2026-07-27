# TypeScript

This document outlines the TypeScript coding style and conventions for the project. It is intended to ensure consistency, readability, and maintainability across the codebase.

## 1. TypeScript style

- Prioritize clean, readable, and maintainable TypeScript code.
- Employ modern language features and patterns where appropriate and consistent with the existing codebase.
- Explicit types everywhere; avoid `any` and implicit `any`.
- Use `enum` or string literal unions for known strings.
- API responses: do NOT use `0 | 1`; convert to `true | false`.
- Never use `as any` or `as Type` type assertions.
- Use template literals instead of string concatenation.
- Avoid re-typing arrow function parameters when inference is sufficient: `items.map(item => item.id)` NOT `items.map((item: ItemType) => item.id)`.
- Do not rename default imports with `as`.
- Use `import Bar = Foo.Bar` namespace aliases with caution — if `Foo.Bar` is renamed, the alias won't auto-update.
- Error handling: prefer guard clauses and explicit error types; avoid complex/nested ternaries. Simple ternaries for assignments are acceptable if readable. Guard clauses first, happy path last.

## 2. Naming Conventions

- Suffix variable names with units (`timeoutDurationSeconds`).
- Use `UpperCamelCase` for class names and types, `lowerCamelCase` for variables and functions, and `SCREAMING_SNAKE_CASE` for constants.
- Classes: noun phrases. Methods/functions: verb phrases.

## 3. Interfaces and Types

- Co-locate interfaces near their use.
- Minimize optional-only interfaces; use discriminated unions where shapes diverge.
- Avoid dynamic field mapping (iterating over a mapping object to transfer properties). Prefer explicit property assignment for type safety.
- Use type predicate functions (`value is MyType`) for narrowing types in conditionals.
- Use discriminated unions with exhaustiveness checks (`never` in default branch) when modelling objects that can be one of several distinct shapes.

## 4. Development flow

- Always run `bun run lint` before committing. Use `bun run lint:fix` to auto-fix issues. Make sure there are no Biome complaints before pushing.
- Never use `biome-ignore` or any other Biome-suppression comments. If the linter complains, fix the underlying issue instead of suppressing it.
- Compile changed TypeScript and run the appropriate targeted tests.

## 5. Comments

No AI-style explanatory comments. Don't document the framework default. Don't paraphrase the code. Don't summarise code or tests in a comment so later readers can skip reading them — a summary that restates behaviour is a second source of truth that silently drifts. A comment is justified only when behaviour is non-obvious and a name/structure change couldn't carry it. When in doubt, delete it.

## 6. Security

- Input Sanitization: Assume all external inputs (user-provided, API requests) are untrusted. Sanitize/validate thoroughly.
- Always parametrize SQL queries to prevent SQL injection. Never interpolate user input directly into queries.
- Principle of Least Privilege: Enforce role-based access control and ensure processes/users have only the minimum necessary permissions.
- Error Handling: Return generic errors to clients; avoid leaking stack traces or internal details.
- Dependency Evaluation: Vet libraries before importing; avoid assuming any dependency is appropriate for every business scenario or context.
