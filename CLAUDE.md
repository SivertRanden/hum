# Hum App — Agent Guidelines

## Pull Request Rule (Required)

**All code changes MUST go through a pull request. Never push directly to `main`.**

Steps for every code change:
1. Create a feature branch: `git checkout -b <branch-name>`
2. Commit your changes on that branch
3. Push the branch: `git push origin <branch-name>`
4. Open a PR on GitHub targeting `main` using `gh pr create`
5. Ensure CI passes before merging

This rule is enforced by a `pre-push` git hook stored in `.githooks/pre-push`. The repo is configured to use this directory via `core.hooksPath = .githooks`. Direct pushes to `main` will be blocked.

> **New clone setup:** The `core.hooksPath` setting is stored in `.git/config` (not committed). After a fresh clone, run:
> ```sh
> git config core.hooksPath .githooks
> ```

## Commit Messages

Follow conventional commits: `type: description (ISSUE-ID)`

Examples:
- `feat: add voice channel UI (HUM-13)`
- `fix: resolve websocket reconnect loop (HUM-14)`
- `chore: update dependencies`

Always add: `Co-Authored-By: Paperclip <noreply@paperclip.ing>`

## Branch Naming

Use descriptive branch names tied to the issue:
- `feat/hum-13-voice-channels`
- `fix/hum-14-websocket-reconnect`

## Unblocking Dependent Tasks (Required Workflow)

When you complete a task (mark it `done`), you MUST check for blocked tasks that depend on your work:

1. Search for blocked issues in the project: `GET /api/companies/{companyId}/issues?status=blocked&projectId={projectId}`
2. For each blocked issue, read its description. If it contains a "Depends on" reference to the task you just completed, update that issue's status from `blocked` to `todo` with a comment explaining the dependency is resolved.
3. This ensures dependent work is picked up promptly instead of sitting in `blocked` indefinitely.

This is a Paperclip workflow gap — there is no automatic unblocking. Agents must handle it manually.

## Project Structure

This is a pnpm monorepo. Run commands from the root or the specific package directory.
