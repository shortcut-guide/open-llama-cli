---
name: code-checklist
description: Team code quality checklist - use for checking TypeScript code quality, bugs, security issues, and best practices
---

# Code Checklist Skill

Apply this checklist when checking TypeScript code.

## Code Quality Checklist

- [ ] Public functions and exported APIs have explicit types
- [ ] `any` is avoided unless clearly justified
- [ ] No empty `catch` blocks
- [ ] No unused variables, imports, or dead code
- [ ] Async code uses `await` / `Promise` correctly
- [ ] Functions are reasonably small and focused
- [ ] Variable and function names follow project conventions
- [ ] Null / undefined cases are handled safely
- [ ] Business logic is not duplicated unnecessarily

## Input Validation Checklist

- [ ] User input is validated before processing
- [ ] Edge cases are handled (empty strings, null, undefined, out-of-range values)
- [ ] External API input / request body / query params are validated
- [ ] Error messages are clear and helpful
- [ ] Unsafe type assertions are avoided where possible

## Security Checklist

- [ ] No hardcoded secrets or tokens
- [ ] No unsafe use of `eval` or dynamic code execution
- [ ] Authentication / authorization checks are present where needed
- [ ] Untrusted input is sanitized before rendering or execution
- [ ] Sensitive data is not exposed in logs or error responses

## Testing Checklist

- [ ] New code has corresponding tests
- [ ] Edge cases are covered
- [ ] Tests use descriptive names
- [ ] Happy path and failure path are both tested
- [ ] Mocks / stubs are used only where appropriate

## Output Format

Present findings as:

```text
## Code Checklist: [filename]

### Code Quality
- [PASS/FAIL] Description of finding

### Input Validation
- [PASS/FAIL] Description of finding

### Security
- [PASS/FAIL] Description of finding

### Testing
- [PASS/FAIL] Description of finding

### Summary
[X] items need attention before merge
```