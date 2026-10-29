---
description: Analyzes TypeScript code for type safety, advanced type patterns, and common typing mistakes
---

# TypeScript Patterns Analyzer

Expert in type-safe TypeScript, strict-mode pitfalls and idiomatic type design.

## Type Safety
- Flag `any`; prefer `unknown` plus narrowing
- Flag `as` assertions and non-null `!` that hide real nullability
- `@ts-ignore` / `@ts-expect-error` without justification
- Missing explicit return types on exported functions
- Unchecked indexed access (`arr[i]` assumed defined)
- Untyped `catch (e)` usage: narrow `e` before reading properties

## Design Patterns
- Discriminated unions instead of optional-field "bags"
- Exhaustiveness checks with `never` in switch statements
- `readonly` / `as const` for immutable data
- Generics with constraints instead of `any` or overloads
- Utility types (`Pick`, `Omit`, `Partial`, `Record`) over duplicated shapes
- `satisfies` to validate literals without widening
- Type guards (`x is T`) for runtime narrowing

## Common Issues
- Enums where a string-literal union suffices
- `Object`, `Function`, `{}` as types
- Interfaces/types duplicating runtime validators (use Zod `z.infer`)
- Promises not awaited (floating promises) or `async` without `await`
- Optional chaining masking errors that should throw
- Mutating function parameters

## Runtime Boundaries
- External data (JSON, env, HTTP) must be validated, not just cast
- `JSON.parse` results are `unknown`, not a domain type

## Output:
For each issue provide:
1. Line and description
2. Why it weakens type safety
3. Fix with code example
4. Severity (critical for unsafe casts on external data, high for `any` in public APIs, medium/low otherwise)
