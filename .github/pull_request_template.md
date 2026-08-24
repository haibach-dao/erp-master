<!-- 1 task = 1 branch = 1 PR. Keep PRs small and scoped. -->

## Task

<!-- Task id (e.g. T07) and one-line summary -->

## What changed

<!-- Bullet points -->

## How to test

<!-- Commands / steps a reviewer can run -->

## Checklist

- [ ] `pnpm install` clean, `pnpm -r build` green
- [ ] `pnpm -r lint` and `pnpm format:check` green
- [ ] Tests for new logic (if any)
- [ ] Migrations run idempotently (if any)
- [ ] No secrets committed (only `.env.example`)
- [ ] Stayed within this task's file scope
- [ ] Did NOT touch Gate-0 / domain areas (Person, graves, contracts, services, permission seed)
