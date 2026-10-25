---
name: fix-github-issue
description: 'Use when investigating and fixing a specific GitHub issue. Creates an issue-named branch from origin/main, rebases it onto the latest origin/main, implements a focused fix, and runs relevant checks.'
argument-hint: 'GitHub issue number or URL'
---

# Fix a GitHub Issue

Use this workflow to investigate and implement one specific GitHub issue on a dedicated branch.

## 1. Establish the Issue and Repository Context

1. Get the issue number or URL. If it is not provided, ask for it; do not guess which issue to fix.
2. Read the issue title, description, acceptance criteria, and relevant discussion. Use `gh issue view <number>` when available. If the issue cannot be accessed, ask the user to provide its details.
3. Read the repository's contributor guidance and applicable agent instructions. Inspect the code and tests nearest to the reported behavior.
4. Check the current branch, remotes, and working tree. Preserve all existing user changes. If the tree is not clean, do not switch branches, stash, or discard anything automatically; explain the situation and ask how to proceed.

## 2. Create the Issue Branch

1. Confirm the `origin` remote exists, then fetch the latest main branch:

    ```sh
    git fetch origin main
    ```

2. Name the branch `issue/<number>-<short-kebab-case-title>`, for example `issue/123-camera-reconnect`.
    - Use the actual issue number and a concise title slug.
    - Keep the name lowercase and omit punctuation other than hyphens and the single slash after `issue`.
3. Create the branch directly from the fetched remote main:

    ```sh
    git switch --create issue/<number>-<short-kebab-case-title> origin/main
    ```

4. If that branch name already exists, inspect its status and commits. Never overwrite or force-reset it. Ask before reusing it or choosing a different name.

## 3. Diagnose and Implement

1. Trace the issue to the code path that directly controls the behavior. State a testable hypothesis about the cause and identify the narrowest relevant check.
2. Reproduce the behavior with an existing test or a focused check when practical. If evidence contradicts the hypothesis, revise it before editing.
3. Make the smallest change that satisfies the issue. Follow local conventions, preserve public behavior outside the issue, and add or update focused tests. Update documentation only when the change affects documented behavior.
4. Do not broaden the work into unrelated cleanup. Do not commit, push, or open a pull request unless the user requests it.

## 4. Rebase and Verify

1. Inspect the working tree and confirm every change belongs to this issue. If unrelated or newly introduced user changes are present, preserve them and ask how to proceed; do not include them in the rebase.
2. Fetch the latest main and rebase the issue branch onto it:

    ```sh
    git fetch origin main
    git rebase --autostash origin/main
    ```

    Autostash lets issue changes remain uncommitted while incorporating main updates that arrived during the work. Use it only after confirming there are no unrelated working-tree changes. If Git refuses because of untracked files or other local state, stop and ask before moving or stashing anything.

3. If a rebase conflict occurs, resolve it only when the correct resolution is clear from the issue and surrounding code. Otherwise stop, preserve the conflict state, and explain what needs the user's decision. Never use `git rebase --skip`, `git reset`, or force-push to make the conflict disappear without explicit direction.
4. Run the narrowest relevant tests first, then any repository-required checks for the changed code. Report failures accurately; do not claim checks passed if they were not run.
5. Confirm the current branch name and summarize the fix, tests run, and any remaining caveats.
