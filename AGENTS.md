# Repository Instructions for Coding Agents

## Engineering Standards

- Deliver production-quality changes: understand the owning code path, fix the underlying cause, keep changes focused, and follow existing TypeScript and project conventions.
- Before editing, trace the behavior to the code that controls it, form a testable hypothesis, and identify a narrow check that could disprove it. Clarify assumptions when needed; otherwise choose a conservative, repository-consistent approach.
- Preserve existing behavior and public APIs unless the task explicitly requires a change. Avoid unrelated refactors and unnecessary dependencies.
- For changes to public APIs, configuration formats, or persisted data, assess compatibility and provide migration guidance or documentation when needed.
- Add or update focused tests for behavior changes. Update documentation when user-visible behavior or setup changes.
- Handle errors and invalid input deliberately. Do not suppress failures, weaken types, or leave placeholder implementations to make checks pass.
- Treat external input as untrusted. When relevant, consider authorization, input validation, secret handling, and whether logs or error messages could expose sensitive data.
- Inspect the working tree before editing. Preserve user changes and do not include unrelated modifications in the task.
- Before reporting completion, inspect the final diff for unrelated changes, accidental generated-file or dependency churn, and unintended API or configuration changes. Run `git diff --check` to catch whitespace errors.

## Required Validation

For every implementation change, run the complete repository checks and wait for each command to finish before reporting the task complete:

1. `npm run format:check` to check Prettier formatting.
2. `npm run lint` to run ESLint with warnings treated as errors.
3. `npm run typecheck` to verify TypeScript types.
4. `npm test` to run the complete Jest test suite, not only the tests nearest to the change.

If formatting fails on files changed for the task, run `npm run format`, inspect the resulting diff to ensure it contains no unrelated changes, and rerun `npm run format:check`. Resolve failures caused by the task and rerun the relevant failed check. Do not weaken or remove tests merely to get a passing result. Do not claim success for checks that failed, were skipped, or are still running. If a required check cannot run because of an environment or dependency issue, report the exact blocker and remaining checks.

For a change that only affects documentation or other non-TypeScript files, still run all four required checks; additionally use Prettier on the changed file when it is a supported format and repository formatting rules apply.

## Commits

- Do not create commits unless the user asks for a commit or the task explicitly requires one.
- Every commit message must follow Conventional Commits: `<type>(<optional-scope>): <imperative summary>`.
- Use an appropriate type such as `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, or `chore`. Keep the summary concise and imperative; add a body or footer when useful, including issue-closing references when requested.
- Examples: `fix(camera): reconnect after stream timeout`, `test: cover invalid broker configuration`, `docs: clarify Docker setup`.
