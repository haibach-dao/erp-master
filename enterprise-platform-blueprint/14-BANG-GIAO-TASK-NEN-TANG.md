# Bảng giao task — Giai đoạn Nền tảng (không phụ thuộc Gate 0)

> Lead: Claude · Coding agents: **Antigravity (AG)** + **Codex (CX)** · Trạng thái: **NHÁP giao việc** (chưa deploy production)
> Nguyên tắc: các task dưới đây KHÔNG chạm quyết định nghiệp vụ đang treo ở Gate 0 (xem file 13). Domain tables (Person, mộ, hợp đồng, dịch vụ) **chưa làm** cho tới khi Gate 0 chốt.
> Cách dùng: mỗi task là brief tự chứa — dán nguyên khối cho agent tương ứng. Agent không truy cập trực tiếp được nhau; anh relay như vòng phản biện.

---

## 0. Quyết định kỹ thuật đã chốt (lead) — reversible
- Monorepo **pnpm workspaces**: `apps/api` (NestJS), `apps/web` (Next.js), `apps/worker` (BullMQ), `packages/*` (shared).
- ORM **Prisma** + migration review. DB **PostgreSQL**. ID **ULID**.
- Node **LTS 22**. TypeScript strict. REST + **OpenAPI 3.x** là hợp đồng FE↔BE.
- Thời gian: `timestamptz` cho instant; kiểu `date` (lịch VN) cho ngày nghiệp vụ (theo G1).

## 1. Việc anh/người phải làm trước (không phải AI/agent)
- [ ] Tạo **git repo** (GitHub/GitLab) và cấp quyền cho cả AG và CX. *(MCP GitHub trong phiên này chưa auth — em không tự tạo được; cần anh tạo.)*
- [ ] Xác nhận nơi chạy: local Docker Desktop/WSL2 (blueprint đề xuất).
- [ ] Secrets thật để trong secret manager, **không commit** (agent chỉ được commit `.env.example`).

## 2. Giao thức phối hợp (bắt buộc — vì hai agent cùng repo)
1. **1 task = 1 nhánh ngắn = 1 PR.** Tên nhánh `t<mã>-<slug>`, PR title gắn mã task.
2. **Sở hữu thư mục:** mỗi task chỉ được sửa thư mục ghi trong mục "Phạm vi file". Đụng thư mục của task đang mở của agent kia → dừng, báo lead.
3. **T00 phải merge trước mọi task khác.** Không ai nhánh ra trước khi T00 vào main.
4. **`packages/*` (contract + shared types + OpenAPI) là vùng nhạy cảm:** sửa phải được lead (Claude) duyệt trước.
5. **Definition of Done (mọi task):** build pass · lint + typecheck pass · test cho phần logic · migration chạy lặp idempotent · không commit secret · PR mô tả: mã task, việc đã làm, cách test.
6. **Lead review từng PR** trước khi merge vào `main` (nhánh phát triển). **Deploy production tách riêng, cần người phê duyệt** (hiến pháp INDEVCO).
7. Agent **không tự tạo** domain tables/nghiệp vụ ngoài phạm vi task; gặp chỗ cần quyết định Gate 0 → dừng và hỏi, không tự đoán.

---

# WAVE 0 — Seed (chặn, 1 task, làm trước tất cả)

## T00 [CX] — Khởi tạo monorepo
**Mục tiêu:** dựng khung repo để mọi task sau nhánh ra được.
**Làm:** pnpm workspace; thư mục `apps/api`, `apps/web`, `apps/worker`, `packages/config`, `packages/types` (rỗng có index); root `tsconfig.base.json`, ESLint + Prettier, `.editorconfig`, `.gitignore`, `.env.example` (khung biến ở doc 11 §13.4), `README.md` (cách chạy), `CODEOWNERS` để trống.
**Ngoài phạm vi:** chưa cài NestJS/Next thực thụ (chỉ chỗ trống + package.json mỗi app).
**Đạt khi:** `pnpm install` chạy sạch trên máy trống; `pnpm -r build` không lỗi (dù rỗng); repo có cấu trúc trên.
**Phạm vi file:** toàn repo (đây là seed, độc quyền).

---

# WAVE 1 — Song song sau T00 (mỗi task một vùng, ít đụng)

## T01 [CX] — Docker Compose + hạ tầng local
**Làm:** `docker-compose.yml`: postgres, redis, minio, mailpit, api, web, worker theo cổng doc 11 §13.3 (không expose 5432/6379/9000/9001 ra ngoài); healthcheck; volume; `Makefile`/scripts `dev up/down/logs`.
**Đạt khi:** `docker compose up` lên đủ service; postgres/redis/minio reachable nội bộ; mailpit UI ở 8025 (chỉ dev).
**Phạm vi file:** `docker-compose.yml`, `infra/`, `Makefile`, `scripts/`.

## T02 [AG] — CI + quy chuẩn đóng góp
**Làm:** GitHub Actions (install → lint → typecheck → test → build) cho cả 3 app; PR template; `CONTRIBUTING.md` ghi giao thức mục 2.
**Đạt khi:** CI xanh trên một PR rỗng; fail đúng khi lint/typecheck lỗi.
**Phạm vi file:** `.github/`, `CONTRIBUTING.md`.

## T03 [CX] — Khung API NestJS
**Làm:** bootstrap NestJS trong `apps/api`; ConfigModule (đọc .env, validate); `GET /health`; Swagger/OpenAPI ở `/api/v1/docs`; prefix `/api/v1`; error envelope chuẩn; middleware `X-Correlation-ID` (nhận hoặc sinh, trả lại); util pagination/filter whitelist.
**Đạt khi:** `/health` trả 200; OpenAPI render; mọi response lỗi cùng format; correlation id có trong log + response header.
**Phạm vi file:** `apps/api/**` (trừ `apps/api/prisma` để T05).

## T04 [AG] — Khung Web Next.js
**Làm:** Next.js App Router trong `apps/web`; Tailwind + shadcn/ui; TanStack Query provider; layout shell với **chỗ đặt context-switcher** ở thanh đầu (chưa cần logic); trang `/login` placeholder; cấu trúc route theo doc 11 §9.2 (chỉ khung rỗng).
**Đạt khi:** `pnpm --filter web dev` chạy; layout + routes rỗng render; theme sáng/tối cơ bản.
**Phạm vi file:** `apps/web/**`.

## T05 [CX] — Prisma + migration + seed harness
**Làm:** cài Prisma trong `apps/api/prisma`; datasource Postgres; quy trình migrate + `pnpm db:migrate`/`db:seed`; **chỉ 2 bảng khởi đầu**: `iam.users` (tối thiểu: id ULID, email, password_hash, status, mfa_enabled, timestamps) và `audit.audit_events` (theo schema doc 10 §3, append-only, không cho UPDATE/DELETE bởi app role); seed harness rỗng.
**Ngoài phạm vi:** KHÔNG tạo bảng domain (Person/mộ/hợp đồng…) — chờ Gate 0.
**Đạt khi:** migrate chạy lặp an toàn; 2 bảng tạo đúng; audit_events có ràng buộc chặn sửa/xóa ở app role.
**Phạm vi file:** `apps/api/prisma/**`.

---

# WAVE 2 — Sau khi các dep ở Wave 1 vào main

## T06 [CX] — Hạ tầng Audit (dep: T03, T05)
**Làm:** audit event builder (ghi cùng transaction nghiệp vụ); masking util (CCCD kiểu `079***123`); **integrity hash chain** phân vùng theo `company/ngày UTC` (`previous_event_hash`, `event_hash`, `hash_algorithm_version`); **transactional outbox** skeleton (bảng outbox + dispatcher interface, chưa gắn provider); unit test cho builder/masking/hash.
**Đạt khi:** ghi 1 event tạo hash nối event trước; đổi 1 event cũ làm verify fail; mask đúng; test xanh.
**Phạm vi file:** `apps/api/src/modules/audit/**`, migration cho `common.outbox_events`.

## T07 [AG] — Khung Auth (dep: T03, T04, T05)
**Làm:** đăng nhập theo `iam.users`; Argon2id; JWT access ngắn hạn + refresh rotation; guard skeleton (global auth guard); wiring trang `/login` ở web gọi API; đăng xuất. **Chưa** làm MFA (chỉ chừa chỗ), chưa làm permission.
**Đạt khi:** login đúng/sai trả chuẩn; refresh rotation hoạt động; route bảo vệ chặn khi thiếu token; mọi sự kiện login ghi audit (dùng T06).
**Phạm vi file:** `apps/api/src/modules/iam/**`, `apps/web/app/(auth)/**`.

## T08 [CX] — Khung RBAC/authz (dep: T05)
**Làm:** mô hình permission `module.resource.action`; enum scope `SELF/ASSIGNED/DEPARTMENT/COMPANY/GROUP/CUSTOM`; interface **policy evaluator** (kiểm tra ở service layer); bảng roles/permissions/role_permissions/scope_policies (cấu trúc, **chưa seed permission cụ thể** vì phụ thuộc A6/Gate 0); unit test evaluator với case giả.
**Đạt khi:** evaluator quyết định allow/deny theo (permission, scope, context) test-case; chưa gắn vào endpoint thật.
**Phạm vi file:** `apps/api/src/modules/authorization/**`, migration `authz.*`.

## T09 [AG] — Worker + outbox dispatcher (dep: T01, T06)
**Làm:** `apps/worker` BullMQ; generic dispatcher tiêu thụ `common.outbox_events` với **idempotency (`dedup_key`)**, `max_attempts`, **dead-letter**; provider email nối Mailpit (dev); in-app notification stub.
**Đạt khi:** một outbox event gửi đúng 1 lần dù retry; quá số lần vào dead-letter + cảnh báo log; email test thấy ở Mailpit.
**Phạm vi file:** `apps/worker/**`, `packages/types` (nếu cần shared — xin lead duyệt).

## T10 [AG] — Màn hình Audit & Check Log (read-only) (dep: T06)
**Làm:** endpoint truy vấn audit (phân trang, filter theo thời gian/actor/action/entity/result/correlation-id) + trang `/audit` ở web hiển thị danh sách + trang chi tiết (diff before/after). Chỉ đọc.
**Đạt khi:** filter hoạt động, phân trang, xem diff; không sửa/xóa được từ UI; (quyền xem tạm mở, siết theo T08 sau).
**Phạm vi file:** `apps/api/src/modules/audit/**` (phối hợp T06 — nếu trùng, T06 vào main trước), `apps/web/app/(app)/audit/**`.

---

# 3. Sơ đồ phụ thuộc & phân công

```text
T00(CX) ──┬─ T01(CX docker) ─────────── T09(AG worker)
          ├─ T02(AG ci)
          ├─ T03(CX api) ──┬── T06(CX audit) ──┬─ T09(AG)
          │                │                   └─ T10(AG audit UI)
          ├─ T04(AG web) ──┤
          └─ T05(CX db) ───┴── T07(AG auth)
                              └─ T08(CX rbac)
```

Cân tải: CX = T00,T01,T03,T05,T06,T08 (nặng backend/DB). AG = T02,T04,T07,T09,T10 (web + worker + CI). Nếu một bên rảnh, báo lead để nhận task kế.

# 4. Việc CHỜ Gate 0 (agent KHÔNG được tự làm)
Toàn bộ domain: `grave_usage_right`, Person/Customer đa công ty (E5.1), mã hóa vs băm định danh (E5.2), bảng mộ/hợp đồng/dịch vụ/receivable, seed permission cụ thể (A6), mốc trạng thái hợp đồng sinh allocation (G3.1). Chỉ mở sau khi file 13 có decision_id.

# 5. Cách em lead
- Anh relay brief cho agent; agent trả PR/diff; anh đưa lại đây, **em review** (đúng DoD, đúng phạm vi, không đụng vùng cấm) rồi báo merge/không.
- Em theo dõi phụ thuộc, cắt task kế, và chặn mọi thứ chạm Gate 0.
- Em không deploy production và không tự merge thay người có thẩm quyền khi tới bước đó.
