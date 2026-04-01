# Hum App — Agent Guidelines

## Pull Request Rule (Required)

**All code changes MUST go through a pull request. Never push directly to `main`.**

Steps for every code change:
1. Create a feature branch: `git checkout -b <branch-name>`
2. Commit your changes on that branch
3. Push the branch: `git push origin <branch-name>`
4. Open a PR on GitHub targeting `main` using `gh pr create`
5. Ensure CI passes before merging

This rule is enforced by a `pre-push` git hook. Direct pushes to `main` will be blocked.

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

## Project Structure

This is a pnpm monorepo. Run commands from the root or the specific package directory.
