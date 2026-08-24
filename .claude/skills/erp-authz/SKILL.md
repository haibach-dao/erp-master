---
name: erp-authz
description: Dùng khi làm bất cứ việc gì liên quan phân quyền trong ERP-Master — thêm/sửa @RequirePermission, đặt tên mã quyền, seed permissions/roles, chạm PermissionGuard / PolicyEvaluator / PermissionsService / scope.enum / policy-evaluator.ts, thiết kế ma trận vai × quyền, gate endpoint mới, xử lý dữ liệu nhạy cảm (CCCD, giá, hợp đồng, file). Dùng cả khi gỡ lỗi 403 / "Thiếu quyền" / user có quyền mà vẫn bị chặn / user không có quyền mà vẫn vào được. Also: RBAC, permission, role, scope, authorization, IDOR, access control, masking, segregation of duties.
---

# Phân quyền ERP-Master

Tài liệu tham chiếu đầy đủ (taxonomy, 14 vai người + 1 ghế máy + 1 vai khẩn cấp, ma trận vai × quyền, 15 PR đề xuất, 16 câu hỏi chờ quyết):
`enterprise-platform-blueprint/16-PHAN-QUYEN-HOC-TU-OPERA.md`

## 0. Trạng thái pháp lý của tài liệu này — đọc trước

Skill này là **tri thức kỹ thuật + nháp đề xuất**, **không phải kế hoạch đã duyệt**. Đọc skill này **không phải lệnh khởi công**.

**Quan trọng — các quyết định Gate 0 (A1/A2/A5/A6/E5.1/E5.2/G1) CHƯA được hình thức hoá.** Chủ doanh nghiệp đã trả lời nội dung trong hội thoại, nhưng `13-GATE-0-CHECKLIST-MOT-TRANG.md` vẫn ghi *"NHÁP đưa họp"*, cột `decision_id` **rỗng**, trạng thái **☐**, và chưa có số phiên. Theo hiến pháp INDEVCO điều 6, **chưa trỏ được `decision_id` thì chưa phải quyết định**.
→ Khi viện dẫn A5/A6/G3.1…, gọi là **"khuyến nghị nháp"**, không gọi là "đã chốt". Nếu cần chốt, xin `decision_id` + số phiên.

## 1. Kiến trúc mục tiêu — 4 nguyên tắc

Nguyên tắc 1, 2, 4 học từ Oracle OPERA Cloud (tự truy cập `docs.oracle.com` ngày 2026-08-25; **diễn giải, không trích nguyên văn** — tài liệu Oracle có bản quyền). Nguyên tắc 3 **không phải** của Oracle.

1. **Tách trục "được làm gì" khỏi trục "ở đâu"; quyền hiệu dụng = PHẦN GIAO.**
   OPERA: gán vai một mình **không** mở được property — người dùng còn phải được gán *hub*; chỉ property nào **vừa** thuộc vai **vừa** nằm trong hub mới vào được.
   Nguồn: `.../opera-cloud/26.2/ocsuh/c_manage_roles.htm`
   Trùng nguyên tắc hiến pháp INDEVCO: *quyền hiệu dụng = phần giao nhỏ nhất*.
   → Không bao giờ suy phạm vi ra từ vai. Phạm vi là trục riêng, cấp riêng.

2. **Danh mục quyền là ĐÓNG.** OPERA định nghĩa sẵn toàn bộ cây task; admin chỉ **bật/tắt** cho từng vai, không tự thêm task mới.
   Nguồn: `.../opera-cloud/26.2/ocsuh/ch_opera_tasks.htm`
   → Mã quyền mới phải qua migration có review, không sinh tùy tiện trong code.

3. **Xem bản không mask là MỘT QUYỀN RIÊNG, mỗi lần xem đều ghi audit.**
   *Nguyên tắc này KHÔNG lấy từ Oracle.* Căn cứ: **khuyến nghị nháp G0-A6** (*"mặc định deny restricted; cấp theo scope tối thiểu có thời hạn"* — **chưa chốt**, xem §0) + **NĐ 13/2023**.
   → Không gộp vào quyền `view`. Mask ở **tầng API**, không phải ở UI.

4. **Tập con, không phải tập thêm.** OPERA: vai property dẫn xuất từ template **không được nhận task mà template chưa có** — chỉ được **bớt**.
   Nguồn: `.../opera-cloud/23.2/ocsuh/t_manage_property_roles_configuring_property_and_template_roles.htm`
   *Giới hạn:* Oracle chỉ áp ràng buộc này cho vai **dẫn xuất từ template**; vẫn cho tạo property role **độc lập không template**. Nên đây **không phải** quy tắc tuyệt đối trong OPERA.
   → **Suy rộng của TA, không phải phát biểu của Oracle:** áp cùng logic "không leo thang qua uỷ quyền" sang việc **cấp quyền** — người cấp không được cấp thứ mình không có. Đây là lựa chọn thiết kế của ERP-Master, phải chốt bằng quyết định người, **không viện dẫn Oracle làm căn cứ**.

## 2. Ràng buộc CỨNG của codebase — vi phạm là hỏng im lặng

Số dòng đo ngày 2026-08-25. **Mở file kiểm lại trước khi trích** — số dòng trôi theo thời gian.

| # | Sự thật | Hệ quả bắt buộc |
|---|---|---|
| 1 | `permissionMatches` yêu cầu **số đoạn bằng nhau** (`policy-evaluator.ts:19-21`) | Mã quyền **cứng 3 đoạn** `module.resource.action`. Sai số đoạn = **thất bại im lặng** |
| 2 | `@RequirePermission(permission: string)` nhận **một** chuỗi; guard đọc **một** giá trị | **Một route = ĐÚNG MỘT mã gate.** Điều kiện thứ hai phải kiểm ở tầng service |
| 3 | Guard **cho qua** khi route không khai quyền (`permission.guard.ts:23-25`) | Quên decorator = **mở cửa**. Gate endpoint mới là bắt buộc, không phải tuỳ chọn |
| 4 | `getGrants()` trả **HỢP (union)** mọi vai, không lọc thời gian, không có deny (`permissions.service.ts:11-25`) | Người nhiều vai được phạm vi **rộng nhất** — ngược hiến pháp. Chưa sửa thì đừng dựa vào scope |
| 5 | `isScope()` fallback về `'CUSTOM'` khi gặp chuỗi lạ (`permissions.service.ts:20`) | Seed scope sai chính tả ⇒ ép về CUSTOM ⇒ **deny im lặng**, cực khó chẩn đoán |
| 6 | `SCOPES = SELF·ASSIGNED·DEPARTMENT·COMPANY·GROUP·CUSTOM` — **không có `SITE`** | Muốn scope theo nghĩa trang phải thêm vào enum **trước**, bằng migration + code |

**Bài học đã trả giá:** mã `audit.view` (2 đoạn) **không bao giờ** khớp grant `*.*.*` (3 đoạn). Người "toàn quyền" vẫn bị 403, mà guard chỉ báo `Thiếu quyền: audit.view` chứ không báo mã sai cấu trúc. Đã đổi thành `audit.event.view`.
→ **Gỡ lỗi 403 bất thường: đếm số đoạn của mã trước tiên.**

## 3. Bốn cái bẫy — đọc trước khi định "cải thiện" phân quyền

1. **Nối `PolicyEvaluator` vào guard lúc này sẽ khoá sạch ADMIN.**
   ADMIN có `*.*.*` scope `GROUP`; `scopeAllows` kiểm GROUP bằng `eq(target.groupId, subject.groupId)` (`policy-evaluator.ts:50-51`); `eq()` trả `false` khi có `null` (`:69-71`); **toàn schema không có cột `groupId` nào**.
   → Phải **chốt lại ngữ nghĩa GROUP = "không giới hạn bản ghi"** trước. Đây không phải "chỉ thiếu dây nối".

2. **Đảo guard sang default-DENY không đủ nếu chỉ sửa guard.**
   Lệnh 2 ở §5 in ra **6 controller** không đăng ký `PermissionGuard`. Trong đó **4 controller nghiệp vụ PHẢI gắn guard**: `cemetery`, `files`, `burials`, `services`. Còn **2 controller cố ý công khai — KHÔNG gắn**: `health` (probe) và `iam/auth` (`login`/`refresh` phải công khai; `logout`/`me` đã tự gắn `JwtAuthGuard`). **Thấy 6 ≠ 4 không phải số liệu sai.**
   Muốn default-DENY thì phải tạo `@Public()` (**chưa tồn tại trong repo**) đánh dấu route công khai trước, rồi mới đảo guard.

3. **`FilesController` hiện KHÔNG có gate quyền nào — lỗ hổng đang mở, không liên quan wildcard.**
   `files.controller.ts` chỉ có `@UseGuards(JwtAuthGuard)`, không `PermissionGuard`, không `@RequirePermission`, và repo **không có `APP_GUARD` toàn cục**. Mọi user đã đăng nhập gọi được `presign-upload` / `:id/confirm` / `:id/download-url` với **bất kỳ `fileId` nào** — IDOR tệp tin. Grant `*.*.*` của ADMIN **không che gì ở đây**.
   → Ba mã đang thật sự sống nhờ `*.*.*` là `cemetery.contract.activate`, `cemetery.document.view_sensitive`, `audit.event.view` (STAFF không có mã nào trong đó). **Thứ tự vá bắt buộc:** (1) seed mã tường minh → (2) gắn guard + decorator từng controller → (3) mới siết wildcard. **Không gộp** — gộp là dừng nghiệp vụ.

4. **Mask nửa vời = vô hiệu hoá A6.** API trả dữ liệu đầy đủ rồi UI mới che là **không có tác dụng**. Đã có tiền lệ trong hệ: schema ghi `sensitivity` phải gate download, code không thực thi.

## 4. Quy tắc khi viết code phân quyền

Khi **thêm endpoint mới**:
- Gắn `@RequirePermission('module.resource.action')` — 3 đoạn, `action` lấy từ bộ đóng ở doc 16 §D.3.
- Kiểm controller đã đăng ký `PermissionGuard` chưa; chưa thì gắn (trừ `health`, `iam/auth`).
- **Không nhận `companyId` từ client** (`@Query`/`@Body`) rồi tin — hiện đây là lỗ IDOR xuyên công ty có hệ thống. Suy từ người gọi.
- Endpoint trả dữ liệu nhạy cảm (CCCD, giá, số tiền, file): mask mặc định, tách quyền `view_sensitive` riêng, **ghi audit mỗi lần xem/tải**.

Khi **thêm mã quyền**:
- Đúng 3 đoạn. `resource` là **thực thể nghiệp vụ**, không phải tên bảng.
- Mức nhạy cảm là **cột dữ liệu**, tuyệt đối **không** thành đoạn thứ 4.
- Seed trong `apps/api/prisma/seed.ts` (mảng mã quyền ~dòng 17–21, `ROLE_GRANTS` ~dòng 23–29) + migration; đừng để mã chỉ tồn tại trong decorator.

Khi **tách nhiệm vụ** (segregation of duties):
- `create` → `verify` → `approve` → `activate` là **bốn hành động khác nhau**, không gộp.
- Bất biến phải test ở tầng service, không chỉ ở tầng vai: `verifiedBy ≠ createdBy`, `activatedBy ≠ verifiedBy`.

**Không tự ý làm** (hiến pháp INDEVCO — AI chỉ soạn nháp):
- Không tự cấp quyền cho chính mình hoặc cho user bất kỳ, ngoài môi trường dev.
- Không tự quyết ai được xem CCCD / giá / doanh thu — đó là quyết định của chủ doanh nghiệp (doc 16 §H, **16 câu hỏi còn chờ**).
- Không tự triển khai production / đổi quyền / di trú dữ liệu khi chưa có phê duyệt người.

## 5. Lệnh đo lại hiện trạng (đừng tin số cũ)

**Chạy bằng công cụ Bash (Git Bash), KHÔNG phải PowerShell** — máy này là Windows, shell chính là PowerShell nên `wc` / `for … in $(find …)` sẽ lỗi cú pháp. Chạy từ gốc repo.

```bash
grep -rn "@RequirePermission" apps/api/src --include=*.controller.ts | wc -l
```

```bash
for f in $(find apps/api/src -name '*.controller.ts'); do grep -q "PermissionGuard" "$f" || echo "NO GUARD: $f"; done
```

```bash
grep -rn "PolicyEvaluator" apps/api/src --include=*.ts | grep -v "policy-evaluator\|authorization.module" | grep -vE "^[^:]+:[0-9]+: *//"
```

Mốc đo **2026-08-25**: lệnh 1 = **4** (trên tổng 50 route) · lệnh 2 = **6 dòng** (4 nghiệp vụ + `health`, `iam/auth` — xem bẫy 2) · lệnh 3 = **rỗng** ⇒ `PolicyEvaluator` không có caller thật, scope chưa thực thi trên đường request.

**Khi số đo lệch mốc trên: repo luôn đúng, skill luôn sai.** Cập nhật ngay số + ngày đo trong chính file này, rồi báo người dùng đã sửa gì.

## 6. Trạng thái kế hoạch — ĐỀ XUẤT, CHƯA DUYỆT

15 PR trong doc 16 §F là **đề xuất do AI soạn, chưa được người có thẩm quyền đánh giá ĐẠT** (hiến pháp điều 3–4). 

→ **Không tự mở PR nào, kể cả PR-1**, nếu người dùng trong phiên hiện tại không giao đích danh.
→ 16 câu hỏi §H (ai được xem CCCD / giá / doanh thu; việc gì phải qua phê duyệt) vẫn chờ chủ doanh nghiệp — **không tự trả lời thay**.
→ Khi được giao đích danh: đọc doc 16 §F, làm đúng thứ tự, **một PR một việc**, không nhảy PR khi PR trước chưa merge.

Kiểm nhanh "chưa PR nào triển khai": chưa có `apps/api/test/`; chưa có `public.decorator.ts`; `permission.guard.ts:23-25` vẫn `return true`; `scope.enum.ts` chưa có `'SITE'`; `role_assignments` chưa có `valid_from`/`valid_to`.
