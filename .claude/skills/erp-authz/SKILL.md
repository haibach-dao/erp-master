---
name: erp-authz
description: Dùng khi làm bất cứ việc gì liên quan phân quyền trong ERP-Master — thêm/sửa @RequirePermission, đặt tên mã quyền, seed permissions/roles, chạm PermissionGuard / PolicyEvaluator / PermissionsService / ScopeService / scope.enum / access_rules, thiết kế ma trận vai × quyền, gate endpoint mới, mask trường nhạy cảm, xử lý dữ liệu nhạy cảm (CCCD, giá, hợp đồng, file). Dùng cả khi gỡ lỗi 403 / "Thiếu quyền" / "Bị luật truy cập chặn" / "Ngoài phạm vi được gán" / user có quyền mà vẫn bị chặn / user không có quyền mà vẫn vào được. Also: RBAC, permission, role, scope, authorization, IDOR, access control, masking, segregation of duties, firewall rules.
---

# Phân quyền ERP-Master

Tài liệu tham chiếu đầy đủ (taxonomy, 14 vai người + 1 ghế máy, ma trận vai × quyền, kế hoạch PR, các câu hỏi chờ quyết):
`enterprise-platform-blueprint/16-PHAN-QUYEN-HOC-TU-OPERA.md`

**Đo lại ngày 2026-08-25, sau khi PR #22 và #23 merge vào `main`.** Hệ đã KHÁC HẲN so với lúc doc 16 được soạn — doc mô tả hiện trạng TRƯỚC khi triển khai, skill này mô tả hiện trạng SAU. Chỗ nào hai bên vênh nhau thì **skill này đúng, doc 16 là lịch sử**.

## 0. Trạng thái pháp lý — đọc trước

Doc 16 là **nháp do AI soạn**. Các quyết định Gate 0 (A1/A2/A5/A6/E5.1/E5.2/G1) vẫn **chưa có `decision_id`** trong `13-GATE-0-CHECKLIST-MOT-TRANG.md` (cột rỗng, trạng thái ☐, chưa có số phiên). Theo hiến pháp INDEVCO điều 6, **chưa trỏ được `decision_id` thì chưa phải quyết định**.
→ Khi viện dẫn A5/A6/G3.1…, gọi là **"khuyến nghị nháp"**, không gọi là "đã chốt".

**Nhưng bảy quyết định dưới đây thì chủ doanh nghiệp ĐÃ đưa ra trong phiên làm việc 2026-08-25**, và code đã theo. Vẫn chưa có `decision_id`, nhưng đừng đề xuất ngược lại chúng:

| Nội dung             | Quyết định                                                                      |
| -------------------- | ------------------------------------------------------------------------------- |
| `*.*.*` của ADMIN    | **Bỏ hẳn** (đã bỏ khỏi ma trận; ADMIN giữ 74 leaf S3 tường minh)                |
| `GROUP`              | **= không giới hạn bản ghi**, không phải "cùng tập đoàn"                        |
| Người ↔ nghĩa trang  | **Nhiều-nhiều** → bảng hub riêng `authz.scope_assignments`                      |
| Nhiều vai            | **HỢP (cộng dồn)**, KHÔNG phải giao / hẹp nhất                                  |
| ADMIN                | **Leo thang được** (gán ADMIN cho người khác) + sửa nội dung vai trên giao diện |
| LÀN CẤM              | **KHÔNG có nhân thân nào cần bảo vệ** → `access_rules` cố ý để RỖNG             |
| Luồng hợp đồng (Q10) | Ai cầm `activate` thì đi thẳng; ai không thì qua `verify` bởi người khác        |

## 1. Kiến trúc — 4 nguyên tắc

Nguyên tắc 1, 2, 4 học từ Oracle OPERA Cloud (**diễn giải, không trích nguyên văn** — Oracle có bản quyền). Nguyên tắc 3 **không phải** của Oracle.

1. **Tách trục "được làm gì" khỏi trục "ở đâu"; hai trục phải GIAO nhau.**
   Giữ vai không tự cho ai phạm vi nào. Có mã quyền mà không được gán công ty/nghĩa trang thì với tới **không bản ghi nào**.
   Nguồn OPERA: `.../opera-cloud/26.2/ocsuh/c_manage_roles.htm`
   ⚠️ **Đừng lẫn với quy tắc gộp vai.** "Giao" ở đây là giữa HAI TRỤC của cùng một yêu cầu. Còn nhiều vai của một người thì **CỘNG DỒN** (§0). Hai điều khác nhau, cả hai đều đúng.

2. **Danh mục quyền là ĐÓNG.** 125 mã trong `permission-catalog.ts`; bộ `action` là danh sách đóng 39 từ. Mã mới ⇒ sửa danh mục + migration, không sinh chuỗi tuỳ tiện ở call site. Có test CI chặn.

3. **Xem bản không mask là MỘT QUYỀN RIÊNG.** Mask ở **tầng API** (`MaskingInterceptor`), không phải UI. Căn cứ: khuyến nghị nháp G0-A6 + NĐ 13/2023.

4. **Không leo thang qua uỷ quyền** — **ĐÃ BỊ BÁC BỎ.** Chủ doanh nghiệp chọn cho phép leo thang, đổi lấy tính linh hoạt vận hành, bù bằng audit đầy đủ. Đừng đề xuất lại luật "không cấp được thứ mình không có".

## 2. Ràng buộc CỨNG của codebase — vi phạm là hỏng im lặng

| #   | Sự thật                                                               | Hệ quả bắt buộc                                                                        |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `permissionMatches` yêu cầu **số đoạn bằng nhau**                     | Mã **cứng 3 đoạn** `module.resource.action`. Sai số đoạn = **thất bại im lặng**        |
| 2   | `@RequirePermission` nhận **một** chuỗi                               | **Một route = ĐÚNG MỘT mã gate.** Điều kiện thứ hai kiểm ở tầng service                |
| 3   | Guard **TỪ CHỐI** route không khai quyền (default-DENY)               | Quên decorator = **route chết**, không phải cửa mở. Muốn công khai thì `@Public()`     |
| 4   | Leaf `wildcard_exempt` (mọi leaf S3) **không** bị grant wildcard trùm | Muốn cấp leaf S3 phải **gọi đúng tên**, `cemetery.*.*` không với tới                   |
| 5   | `getGrants()` lọc theo `valid_from`/`valid_to`                        | Grant hết hạn **tự rụng**. Test mock phải có hai cột này, nếu không truy vấn sai       |
| 6   | Gộp nhiều vai theo **HỢP, tính THEO TỪNG MÃ** (`scopeLevelFor`)       | Đừng tính một `level` chung rồi áp cho mọi mã — đó là rò rỉ, đã từng xảy ra            |
| 7   | `isScope()` vẫn fallback `'CUSTOM'` khi gặp chuỗi lạ                  | Seed scope sai chính tả ⇒ ép về CUSTOM ⇒ **deny im lặng**. CHƯA sửa                    |
| 8   | `SCOPES` = SELF·ASSIGNED·DEPARTMENT·**SITE**·COMPANY·GROUP·CUSTOM     | `DEPARTMENT`/`ASSIGNED`/`CUSTOM` khai mà **không thực thi** — test chặn không cho dùng |

**Bài học đã trả giá:** mã `audit.view` (2 đoạn) **không bao giờ** khớp grant `*.*.*` (3 đoạn). Người "toàn quyền" vẫn 403, mà guard chỉ báo `Thiếu quyền` chứ không báo mã sai cấu trúc.
→ **Gỡ lỗi 403 bất thường: đếm số đoạn của mã trước tiên.**

## 3. Chuỗi quyết định — thuộc lòng thứ tự này trước khi gỡ lỗi 403

```
1. @Public()?                              → cho qua
2. Chưa xác thực?                          → 403 "Chưa xác thực"
3. Route không khai quyền?                 → 403 "Route chưa khai quyền"
4. Mã không có trong bảng permissions?     → 403 "không có trong danh mục"
5. CHUỖI LUẬT access_rules, priority tăng dần, khớp ĐẦU TIÊN quyết, DỪNG
     DENY  → 403 "Bị luật truy cập chặn"
     ALLOW → cho qua, KHÔNG hỏi ma trận vai
6. Ma trận vai (hợp theo từng mã, đã lọc hạn, tôn trọng wildcard_exempt)
     không phủ → 403 "Thiếu quyền"        ← "deny all" ngầm ở cuối chuỗi
7. Phạm vi bản ghi (ScopeService, ở tầng SERVICE chứ không ở guard)
     ngoài phạm vi → 403 "Ngoài phạm vi được gán"
```

**Đọc câu báo lỗi là biết hỏng ở bước nào.** Năm câu ở trên là năm nguyên nhân khác hẳn nhau — đừng gộp chúng thành "user thiếu quyền".

⚠️ **Luật `ALLOW` nằm TRÊN ma trận vai.** Nó cấp được thứ không vai nào cấp, kể cả leaf S3 mà wildcard không với tới. Đó là bản chất mô hình tường lửa chủ doanh nghiệp chọn, không phải lỗi.

## 4. Bốn cái bẫy còn lại

1. **`scope.level` phải phân biệt `SITE` với `NONE`.** Vai mức `SITE` mà hub rỗng phải với tới **không gì cả**. Nếu chỉ có cờ "có/không bị giới hạn" thì "chưa gán nghĩa trang nào" bị đọc thành "vai này không bó theo nghĩa trang" ⇒ **fail-open**. Bẫy này đã xảy ra thật một lần.

2. **Hợp phải tính theo TỪNG MÃ.** Người vừa là `KTNB_KIEM_TOAN` (GROUP, chỉ đọc) vừa là `THU_NGAN` (COMPANY): tính chung sẽ cho họ GROUP trên `cemetery.plot.set_status` — mã vai kiểm toán **không hề cấp**. Đã xảy ra thật một lần.

3. **Mask nửa vời = vô hiệu hoá A6.** API trả đủ rồi UI mới che là không có tác dụng. Trường nhạy cảm mới ⇒ thêm `@MaskUnless` **tường minh**; serializer danh sách trắng toàn hệ **chưa có**, nên trường mới mặc định LỌT RA.

4. **Cái quét route trong test có thể nói dối.** Decorator xuống dòng (`@MaskUnless(` … `)`) từng làm đứt chuỗi decorator và route mất mã quyền trong bản quét. Đã sửa + có test cho chính cái quét. Sửa `test/route-scan.ts` thì chạy lại nhóm test đó trước.

## 5. Quy tắc khi viết code phân quyền

Khi **thêm endpoint mới**:

- Gắn `@RequirePermission('module.resource.action')` — 3 đoạn, `action` từ bộ đóng.
- Controller phải đăng ký `PermissionGuard` (trừ `health`, `iam/auth`).
- **Không nhận `companyId`/`cemeteryId` từ client rồi tin** — gọi `ScopeService.assertCompany()` / `assertSite()`. Ngoài phạm vi trả **403**, KHÔNG trả danh sách rỗng.
- Trả dữ liệu nhạy cảm ⇒ `@MaskUnless({ field, permission })` + audit mỗi lần xem/tải.

Khi **thêm mã quyền**: sửa `permission-catalog.ts` (3 đoạn, `resource` là thực thể nghiệp vụ, `sensitivity` là **cột** chứ không phải đoạn thứ 4, S3 ⇒ `wildcardExempt: true`) + migration. Test CI sẽ bắt nếu quên.

Khi **ghi vào `authz.*`**: **BẮT BUỘC** phát audit event kèm before/after. Vì ADMIN leo thang được và vai cộng dồn, audit là **bản ghi duy nhất** về việc một người đi tới quyền hiện tại bằng đường nào. Thu hồi = **đóng hiệu lực** (`validTo = now()`), **không xoá dòng**.

**Không tự ý làm** (hiến pháp INDEVCO — AI chỉ soạn nháp):

- Không tự cấp quyền cho mình hay cho ai, ngoài môi trường dev.
- Không tự quyết ai được xem CCCD / giá / doanh thu.
- Không tự ghi dòng vào `access_rules` cho LÀN CẤM — cần biết đích danh nhân thân được bảo vệ, đó là quyết định của chủ doanh nghiệp.
- Không tự triển khai production / đổi quyền / di trú dữ liệu khi chưa có phê duyệt người.

## 6. Lệnh đo lại (đừng tin số cũ)

**Chạy bằng Bash (Git Bash), KHÔNG phải PowerShell.** Từ gốc repo.

```bash
grep -rn "@RequirePermission" apps/api/src --include=*.controller.ts | wc -l
```

```bash
for f in $(find apps/api/src -name '*.controller.ts'); do grep -q "PermissionGuard" "$f" || echo "NO GUARD: $f"; done
```

Bản chiếu quyền (không cần DB) và chuỗi luật (cần DB):

```bash
pnpm --filter @erp/api exec tsx scripts/authz-report.ts
```

```bash
DATABASE_URL=... pnpm --filter @erp/api exec tsx scripts/authz-rules.ts
```

**Mốc đo 2026-08-25 (sau #23):** lệnh 1 = **55** · lệnh 2 = **2 dòng** (`health`, `iam/auth` — cả hai CỐ Ý) · 60 route tổng = 55 gate + 3 `@Public` + 2 tự thân (`logout`, `me`) · **323 test**.

**Khi số đo lệch mốc trên: repo luôn đúng, skill luôn sai.** Cập nhật ngay số + ngày đo trong file này, rồi báo người dùng đã sửa gì.

## 7. Còn nợ — biết trước để khỏi tưởng đã có

- **`access_rules` cố ý RỖNG.** Chủ doanh nghiệp đã trả lời: **không có nhân thân nào cần bảo vệ**. Đừng hỏi lại, và đừng tự ghi dòng nào vào. Cơ chế nằm đó cho lúc câu trả lời đổi.
- **`scope_assignments` đang RỖNG** — chưa ai bị bó theo nghĩa trang trên thực tế. Seed bằng `scripts/seed-scope.ts` hoặc màn hình `/organization/scope`.
- **Chưa có màn hình sửa chuỗi luật.** Thứ tự là toàn bộ ý nghĩa của bảng đó, nên cần kéo-thả chứ không phải form thêm dòng. Tạm đọc bằng `scripts/authz-rules.ts`.
- **Worker chưa phát audit event `actorType='AGENT'`.** Chuỗi hash toàn vẹn nằm trong `apps/api`; nhân bản sang worker mà lệch là gãy chuỗi. Cần tách `computeEventHash` ra package dùng chung trước.
- **`isScope()` vẫn fallback `CUSTOM`** — deny im lặng, chưa sửa.
- **`phone`/`email`/`dateOfBirth` chưa mask.** Phạm vi NĐ13 rộng hơn A6.
