# Chạy API ở máy local

```bash
pnpm --filter @erp/api dev
```

## Vì sao KHÔNG dùng `tsx`

`dev` từng chạy `tsx watch src/main.ts`. Nó **không bao giờ khởi động được** NestJS, và lỗi
báo ra không hề nhắc tới nguyên nhân:

```
TypeError: Cannot read properties of undefined (reading 'get')
    at new FilesService (src/modules/files/files.service.ts:45:31)
```

`tsx` dùng esbuild, và **esbuild không sinh `emitDecoratorMetadata`**. Không có metadata đó
thì Nest không đọc được kiểu tham số constructor, nên nó tiêm `undefined` cho **mọi** phụ
thuộc. Ứng dụng chết ở chỗ đầu tiên dùng tới một phụ thuộc — chỗ đó trông như lỗi của
`FilesService`, trong khi `FilesService` không có gì sai.

Kiểm lại bằng một dòng (`undefined` = không có metadata):

```bash
node -r @swc-node/register -e "require('reflect-metadata');const{FilesService}=require('./src/modules/files/files.service.ts');console.log(Reflect.getMetadata('design:paramtypes',FilesService))"
```

`@swc-node/register` (SWC) **có** sinh metadata, nên `dev` dùng nó.

`--watch-path=./src` chứ không phải `--watch`: SWC ghi cache vào `node_modules`, và
`node --watch` theo dõi cả chỗ đó nên tiến trình restart vô tận. Giới hạn watch vào `src`
là hết.
`tsc` cũng có — vì thế `pnpm build && pnpm start` luôn chạy đúng, và đó là lý do trước đây
không ai phát hiện: mọi lần thử đều tình cờ chạy bản build.

## Thứ tự khởi động

1. Hạ tầng: `docker compose up -d` (postgres, redis, minio, mailpit)
2. Migration + danh mục: `pnpm --filter @erp/api db:migrate` rồi `db:seed`
3. API: `pnpm --filter @erp/api dev` (cổng 4000)
4. Web: `pnpm --filter @erp/web dev` (cổng 3000)

Nếu `pnpm` chết vì mạng ở bước kiểm deps, gọi trực tiếp `npx prisma ...` trong `apps/api`.

## Tài khoản đăng nhập

Không có tài khoản mặc định, và mật khẩu **không** được commit ở đâu. Tự đặt:

```bash
$env:DEV_USER_EMAIL = "admin@local"
$env:DEV_USER_PASSWORD = "<mật khẩu bạn chọn>"
$env:DEV_USER_ALL_COMPANIES = "true"
npx tsx scripts/seed-dev-user.ts
```

`scripts/seed-dev-user.ts` từ chối chạy nếu thiếu `DEV_USER_PASSWORD`, và từ chối chạy
ngoài `development`/`test` — nó là một trong các đường ghi vào `authz`.
