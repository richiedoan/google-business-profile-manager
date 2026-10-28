# Project Coding Standards

Use this file as the project-level coding standard.  
Do not treat it as a product specification or implementation plan.

## 1. General Principles

- Prefer simple, explicit, maintainable code.
- Do not over-engineer.
- Keep functions and components focused on one responsibility.
- Reuse logic only when duplication is meaningful; avoid premature abstraction.
- Preserve existing project conventions unless there is a clear reason to improve them.
- Do not silently change unrelated code.
- Before editing, inspect the relevant files and understand the current flow.

## 2. TypeScript

- Use TypeScript strictly.
- Avoid `any`; use proper types, generics, `unknown`, or type narrowing.
- Prefer explicit domain types over loose objects.
- Keep shared API contracts typed.
- Avoid unnecessary type assertions (`as`).
- Prefer discriminated unions for state/error variants where useful.
- Use enums only when they add real value; string unions are often simpler.

Example:

```ts
type UserRole = 'VIEWER' | 'MANAGER';
```

## 3. Naming

Use clear, intention-revealing names.

Prefer:

```ts
getLocations()
updateLocation()
isAuthenticated
canEditLocation
selectedLocationIds
```

Avoid:

```ts
getData()
handleThing()
temp
foo
data2
```

Naming conventions:

- Components/classes/types: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE` only for true constants
- Files: follow the existing project convention consistently

## 4. Functions

- Keep functions small and focused.
- Prefer early returns over deeply nested conditions.
- Avoid functions with many positional parameters; use an options object when appropriate.
- Separate validation, business logic, and I/O when practical.
- Do not hide errors with empty or broad `catch` blocks.

Prefer:

```ts
if (!user) {
  throw new UnauthorizedException();
}

if (!canEdit) {
  throw new ForbiddenException();
}

return updateLocation();
```

over deeply nested `if` blocks.

## 5. React

- Prefer functional components and hooks.
- Keep components focused on rendering and user interaction.
- Move reusable business/data logic into hooks/services when appropriate.
- Avoid unnecessary `useEffect`.
- Do not use `useEffect` for data fetching when TanStack Query already owns that server state.
- Avoid duplicated derived state.
- Compute derived values instead of storing them where possible.
- Keep props minimal and typed.
- Avoid giant components; split by responsibility, not arbitrarily.

## 6. Server State

- Use TanStack Query for server-owned data.
- Use local state for local UI state.
- Do not mirror TanStack Query data into another global store without a strong reason.
- Keep query keys deterministic and consistent.
- Invalidate the smallest relevant query scope after mutations.
- Handle loading, empty, error, and success states explicitly.

## 7. Forms

- Use React Hook Form for non-trivial forms.
- Use Zod for schema validation where applicable.
- Keep frontend validation aligned with backend validation.
- Backend validation remains authoritative.
- Preserve dirty state and prevent accidental data loss when needed.

## 8. Backend / NestJS

- Keep controllers thin.
- Put business logic in services.
- Keep persistence logic separate from controllers.
- Use DTO/schema validation for incoming requests.
- Centralize repeated error mapping.
- Use guards/policies for authorization instead of duplicating permission checks across controllers.
- Do not expose infrastructure/provider-specific details unnecessarily.

Preferred flow:

```text
Controller
→ validation
→ authorization
→ service
→ repository/provider
→ normalized response
```

## 9. API Design

- Use clear REST semantics.
- Use appropriate HTTP status codes.
- Keep response shapes stable.
- Normalize errors into predictable application-level contracts.
- Do not expose raw stack traces, database errors, or third-party provider errors to clients.
- Treat `401` and `403` differently:
  - `401` = not authenticated
  - `403` = authenticated but not allowed

## 10. Error Handling

- Fail explicitly.
- Do not swallow exceptions.
- Prefer domain-specific error codes/messages.
- Keep user-facing errors understandable.
- Log enough context to debug, but never log secrets.
- Preserve original causes internally when useful.

Avoid:

```ts
catch {
  return null;
}
```

unless `null` is intentionally part of the contract.

## 11. Security Standards

- Never hardcode secrets.
- Never commit `.env` files containing real credentials.
- Never log:
  - passwords
  - access tokens
  - refresh tokens
  - session secrets
  - OAuth authorization codes
  - client secrets
- Do not store sensitive bearer tokens in browser storage unless explicitly required by architecture.
- Validate all external input.
- Enforce authorization on the server.
- Never trust resource IDs from URLs without permission checks.
- Avoid unsafe HTML rendering.
- Use explicit CORS configuration.
- Keep CSRF protections aligned with cookie/session architecture.

## 12. Database

- Keep schema changes intentional.
- Use migrations.
- Avoid duplicating external-source data unless there is a clear product need.
- Add indexes only when justified by actual query patterns.
- Use transactions when multiple writes must succeed or fail together.
- Do not expose database models directly as public API contracts when separation is useful.

## 13. Testing

For meaningful changes, add or update tests.

Prioritize tests for:

- business rules
- authorization
- validation
- error handling
- important data transformations
- critical user flows

Avoid testing implementation details unnecessarily.

When possible, cover:

```text
happy path
invalid input
unauthenticated
unauthorized
not found
external/provider failure
```

## 14. Code Quality

Before considering a task complete:

- run typecheck
- run lint
- run relevant tests
- remove dead code
- remove debug logs
- remove commented-out implementation
- ensure imports are clean
- ensure no secrets were introduced

Do not claim success if checks are failing.

## 15. Comments and Documentation

- Prefer self-explanatory code over excessive comments.
- Comment the reason, not the obvious syntax.
- Document non-obvious security decisions and trade-offs.
- Keep README/docs aligned with actual behavior.

Good:

```ts
// Reject cross-account access even when the user has MANAGER role.
```

Bad:

```ts
// Check if user can edit.
```

## 16. Refactoring Rules

- Do not refactor unrelated code during a focused task.
- Preserve behavior unless behavior change is intentional.
- Refactor only when it improves clarity, safety, testability, or removes meaningful duplication.
- Keep refactors reviewable and incremental.

## 17. AI Coding Behavior

When implementing a task:

1. inspect relevant existing code first
2. state the smallest intended change
3. follow existing conventions
4. implement only the requested scope
5. add/update tests when needed
6. run checks
7. report changed files and verification steps

If requirements are ambiguous and could materially change architecture or behavior, ask before making the assumption.

Do not invent APIs, environment variables, provider behavior, or requirements without evidence.
