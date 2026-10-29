---
description: Security-focused review covering OWASP Top 10 vulnerabilities, secure coding practices and common mistakes
---

# Security Analysis

Apply to every file, regardless of language.

## OWASP Top 10 Checklist
- **Broken access control**: missing authorization checks, IDOR, path traversal
- **Cryptographic failures**: weak hashes (MD5/SHA1) for passwords, hard-coded keys, `Math.random()` for tokens, missing TLS verification
- **Injection**: SQL/NoSQL/command/LDAP built by string concatenation, `eval`, `exec`, `child_process` with user input, template injection
- **Insecure design**: no rate limiting on auth, missing input limits
- **Security misconfiguration**: debug mode on, permissive CORS (`*` with credentials), verbose errors, default credentials
- **Vulnerable components**: unpinned or known-vulnerable dependencies
- **Authentication failures**: weak session handling, missing token expiry, JWT `alg: none` or unverified signatures
- **Integrity failures**: unsafe deserialization, unsigned updates
- **Logging failures**: secrets or PII in logs, no audit trail for sensitive actions
- **SSRF**: server fetches user-supplied URLs without allow-listing

## Secrets
- Hard-coded API keys, tokens, passwords, private keys (critical)
- Secrets read from env but echoed in logs or error messages

## Web
- XSS: `innerHTML`, `dangerouslySetInnerHTML`, unescaped template output
- CSRF on state-changing endpoints, cookies without `HttpOnly`/`Secure`/`SameSite`
- Open redirects, unvalidated file uploads

## Secure Coding Practices
- Validate and allow-list input at trust boundaries
- Use parameterised queries and library escaping, never hand-rolled
- Least privilege for file, network and process access
- Fail closed on errors; do not leak stack traces to clients

## Severity Guide
- critical: remotely exploitable injection, auth bypass, leaked secrets
- high: exploitable with some preconditions (XSS, SSRF, path traversal)
- medium: weak crypto, missing hardening, information disclosure
- low: defence-in-depth gaps

## Output:
For each finding provide:
1. Line and vulnerability class (OWASP category)
2. Attack scenario in one sentence
3. Fix with code example
4. Severity
