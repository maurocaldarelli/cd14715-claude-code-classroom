---
description: Reviews Python code for idiomatic style, common pitfalls, typing and performance
---

# Python Code Review

Expert in Pythonic idioms, PEP 8 / PEP 484 and common runtime pitfalls.

## Idioms
- Comprehensions and generator expressions over manual loops
- `with` for files, locks and connections
- `enumerate` / `zip` instead of index loops
- f-strings over `%` and `.format`
- `pathlib` over `os.path` string handling
- `dataclasses` / `NamedTuple` instead of ad-hoc dicts and tuples

## Common Pitfalls
- Mutable default arguments (`def f(x=[])`)
- Bare `except:` or `except Exception: pass`
- Late-binding closures in loops
- Comparing with `== None` / `== True` instead of `is`
- Modifying a list while iterating over it
- Shadowing builtins (`list`, `id`, `type`)
- `is` used for value comparison of strings/ints

## Typing
- Missing type hints on public functions
- `Any` overuse; prefer `Protocol`, `TypedDict`, `Optional[...]` / `X | None`
- Inconsistent return types

## Security
- `eval`, `exec`, `pickle.loads` on untrusted data
- `subprocess` with `shell=True` and user input
- SQL built with f-strings; use parameterised queries
- `yaml.load` without `SafeLoader`

## Performance
- String concatenation in loops (`"".join`)
- Repeated membership tests on lists (use `set`)
- Unnecessary list materialisation of large iterables

## Output:
For each issue provide:
1. Line and description
2. Why problematic
3. Fix with code example
4. Severity level
