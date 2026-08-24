# Contributing — ERP Master

## Environment

- Node **22 LTS** (`.nvmrc`); tolerated 22–24. pnpm **11.19.0**.
- Enable pnpm via Corepack (`corepack enable`) or install globally (`npm i -g pnpm@11.19.0`).
- Start local infra: `docker compose up -d` (postgres, redis, minio, mailpit) or `make up`.
- Copy `.env.example` → `.env`. Never commit `.env` or secrets — only `.env.example`.

## Workflow

- **1 task = 1 branch = 1 PR.** Branch name `t<id>-<slug>` (e.g. `t07-auth`).
- **Directory ownership:** only touch the files/dirs named in your task. If you must
  change shared `packages/*`, the OpenAPI contract, or root config, get lead sign-off.
- Rebase/merge from `main` before opening the PR. Keep PRs small and reviewable.

## Definition of Done (every PR)

- `pnpm install` clean and `pnpm -r build` green (build also type-checks).
- `pnpm -r lint` and `pnpm format:check` green.
- Tests for new logic; migrations run idempotently.
- No secrets committed. PR description: task id, what changed, how to test.

## Time model (G1)

- Instants → `timestamptz` (compare in UTC): audit, login, upload, payment received.
- Business calendar dates → Prisma `@db.Date`, interpreted in `Asia/Ho_Chi_Minh`
  (NOT converted to UTC): due dates, effective_from/to, burial date, service expiry.

## Blocked until Gate 0

Do **not** create domain tables or endpoints — Person/Customer (cross-company),
`grave_usage_right`, graves, contracts, services, receivables, or concrete permission
seeds — until the Gate 0 decisions in `enterprise-platform-blueprint/13-...` are signed
off with decision ids. If a task forces such a choice, stop and ask the lead.

## Native build scripts

pnpm 11 reads the allowlist from `pnpm-workspace.yaml` (`allowBuilds:`), not the
package.json `pnpm` field. Add new native deps there (e.g. `sharp: true`).
