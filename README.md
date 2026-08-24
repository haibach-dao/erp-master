# ERP Master

Monorepo nền tảng cho hệ thống ERP Master. T00 chỉ tạo workspace TypeScript; chưa cài NestJS, Next.js, Prisma hoặc bất kỳ domain schema nào.

## Yêu cầu

- Node.js 22 LTS
- pnpm 11 (Corepack được khuyến nghị)

## Chạy local

```bash
corepack enable
pnpm install
pnpm build
```

Sao chép `.env.example` thành `.env` và điền giá trị môi trường khi các task tiếp theo cần dùng. Không commit file `.env` hoặc secret.

## Cấu trúc

```text
apps/
  api/       API placeholder
  web/       Web placeholder
  worker/    Background worker placeholder
packages/
  config/    Shared configuration placeholder
  types/     Shared types placeholder
```

## Kiểm tra chất lượng

```bash
pnpm lint
pnpm format:check
pnpm build
```
