# PHÂN QUYỀN ERP-MASTER — HỌC GÌ TỪ ORACLE OPERA CLOUD

**Nháp phân tích trình anh Bách quyết định · Repo ERP-Master @ commit `0b34618` · Soạn: Claude (AI) · Số phiên: \_\_\_\_ (cần lấy ở List SO-LAY-PHIEN trước khi trình)**

Nhãn độ tin cậy dùng suốt tài liệu:
- **[ĐO]** — đọc trực tiếp từ code/tài liệu trong repo, đã mở file kiểm lại trong phiên này.
- **[OPERA-XN]** — mệnh đề về OPERA đã qua kiểm chứng đối kháng, verdict CONFIRMED.
- **[OPERA-?]** — về OPERA nhưng **chưa xác minh được** (verdict UNVERIFIABLE) → không dùng làm căn cứ.
- **[SĐ]** — suy đoán/đề xuất của người soạn, chưa có hiệu lực.

---

## A. KẾT LUẬN TRƯỚC

1. **Hệ hiện chỉ có một lớp bảo vệ thật: “đã đăng nhập hay chưa”.** Lớp mã quyền phủ **4/50 endpoint (8%)** — đúng 4 chỗ: `audit.event.view`, `cemetery.contract.activate`, `cemetery.document.view_sensitive`, `cemetery.grave.hold` **[ĐO]**. Lớp phạm vi dữ liệu **chưa cắm điện**: `PolicyEvaluator` không được gọi ở bất kỳ đâu trên đường xử lý request; guard chỉ so mã quyền rồi bỏ trường `scope` **[ĐO — `permission.guard.ts:31-32`]**.

2. **Bài học lớn nhất từ OPERA: tách “được làm gì” khỏi “ở đâu”, và quyền thật là PHẦN GIAO.** OPERA nói thẳng: gán vai một mình **không** cho người dùng vào được property; phải có Hub **[OPERA-XN]**. Đây đúng là “quyền hiệu dụng = phần giao nhỏ nhất” của Hiến pháp, và đúng chỗ ERP-Master đang hở nặng nhất.

3. **Nhưng ERP-Master hiện làm NGƯỢC nguyên tắc phần giao.** `PermissionsService.getGrants()` trả về **HỢP (union)** mọi grant của mọi vai **[ĐO — `permissions.service.ts:11-25`]**. Người có 2 vai sẽ được **phạm vi rộng nhất**, không phải hẹp nhất. Phải chốt quy tắc hợp giải nhiều vai **trước khi** nối scope, nếu không sẽ nối vào một logic sai hướng.

4. **Có một cái bẫy chết người: nối scope vào lúc này sẽ khoá sạch vai ADMIN.** Vai ADMIN được cấp `*.*.*` scope `GROUP` **[ĐO — `seed.ts:24`]**, nhưng `scopeAllows` kiểm `GROUP` bằng `eq(target.groupId, subject.groupId)` **[ĐO — `policy-evaluator.ts:50-51`]** và `eq()` trả `false` khi có `null` một phía **[ĐO — dòng 69-71]**; trong khi **toàn bộ schema KHÔNG có cột `groupId` nào** (grep sạch) **[ĐO]**. Nghĩa là đúng khoảnh khắc “nối dây”, ADMIN bị từ chối 100% endpoint. **Phải chốt lại ngữ nghĩa GROUP trước** — không phải “chỉ thiếu dây nối”.

5. **Danh mục quyền phải là danh mục ĐÓNG, quản bằng migration, và mã BẮT BUỘC 3 đoạn.** OPERA làm đúng vậy: task do nhà sản xuất định nghĩa trước, admin chỉ bật/tắt **[OPERA-XN]**. Ở ERP, `permissionMatches()` yêu cầu **số đoạn bằng nhau** **[ĐO — `policy-evaluator.ts:19-21`]** ⇒ mã sai số đoạn **thất bại im lặng**. Mức nhạy cảm phải là **cột dữ liệu**, tuyệt đối không thành đoạn thứ 4.

6. **Bỏ mặt nạ dữ liệu nhạy cảm phải là MỘT QUYỀN RIÊNG + ghi audit từng lần.** OPERA làm đúng thế (`View (unmasked) …` là task độc lập; mỗi lần bấm hiện thông tin bị mask đều vào Changes Log) **[OPERA-XN]**. Khớp quyết định **G0-A6 đã chốt** **[ĐO — checklist Gate 0]**. Ta phải làm **chặt hơn OPERA**: mask ở tầng API (không phải UI), tách endpoint reveal, và tách “xem trên màn hình” khỏi “tải file ra ngoài”.

7. **Bốn hành động phê duyệt phải tách rời: `create` → `verify` → `approve` → `activate`.** Lỗ hổng đo được: `activate` **có** quyền (`contracts.controller.ts:37`) nhưng `verify` **không có gì** (`:31`) **[ĐO]** — chốt cửa sau, bỏ ngỏ cửa trước, và người tạo hợp đồng tự thẩm định hợp đồng của mình. Tương tự `burials/:id/verify` và `/complete` (bất khả hồi) **[ĐO]**.

8. **Ba việc chỉ có ở ERP mà OPERA không có, phải tự làm:** (a) cửa **“Đã duyệt ≠ Hiệu lực”** cho chính ma trận quyền; (b) **ghế máy** cho worker — `hold-expiry.ts` hiện tự chuyển lô mộ `Held → Available` và ghi `changedBy: null` **[ĐO — dòng 30-38]**, tức còn một đường giải phóng mộ **không chủ thể, không quyền**; (c) **hạn hiệu lực của quyền** — `role_assignments` không có `validFrom/validTo/grantedBy` **[ĐO]**, nên vai khẩn cấp “có hạn giờ” hiện **không thể** thực thi.

---

## B. OPERA CLOUD LÀM THẾ NÀO

> **Trung thực về nguồn:** trong phiên tổng hợp này tôi **không** tự truy cập tài liệu Oracle. Mọi mệnh đề dưới đây lấy từ hồ sơ nghiên cứu + **kiểm chứng đối kháng** đã thực hiện trước đó (mỗi mệnh đề có verdict). Tài liệu Oracle có bản quyền — dưới đây **mô tả cấu trúc và nêu ví dụ tiêu biểu**, không sao chép danh mục dài.

### B.1 Năm tầng xếp chồng — [OPERA-XN]

| Tầng | Nội dung | Nguồn kiểm được |
|---|---|---|
| 1 — Danh tính | User và role **tạo ở ngoài** (Oracle Identity Manager / IdP liên kết) rồi **import** vào OPERA; trong OPERA màn Manage Users hiển thị vùng Roles **read-only** | [Managing Users 25.3](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.3/ocsuh/t_role_manager_managing_users.htm) |
| 2 — Cấp vai | Chỉ **HAI** cấp: **Chain role** (toàn tenancy) và **Property role** (một property). Một người có thể mang nhiều vai, trộn cả hai | [About Roles 25.1](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.1/ocsuh/c_manage_roles.htm) |
| 3 — Khuôn (template) | Template role là bộ task độc lập property, dùng làm khuôn. **Ràng buộc lõi: vai dẫn xuất chỉ được BỎ task, không được THÊM task ngoài khuôn** ⇒ tập quyền vai ⊆ template | [Configuring Template and Property Roles 23.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.2/ocsuh/t_manage_property_roles_configuring_property_and_template_roles.htm) |
| 4 — Task | Đơn vị cấp quyền nhỏ nhất, **định nghĩa trước bởi Oracle**; cây 3 mức Parent Task → Task → Sub-task; gom theo các nhóm trùng vùng chức năng phần mềm. **Không có cột hành động riêng** — động từ **nhúng trong tên** task (ví dụ tiêu biểu: một task quản lý chỉ dẫn thanh toán được tách thành hai sub-task “tạo/sửa” và “xoá”) | [OPERA Cloud Tasks 22.3](https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.3/ocsuh/ch_opera_tasks.htm) |
| 5 — Hub | Cụm property có tên, **gán cho USER**, tách rời khỏi vai. Khi cấp phát có hub mặc định chứa toàn bộ property | [Configuring Hubs 23.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.2/ocsuh/t_admin_enterprise_configuring_hubs.htm) |

**Mệnh đề mạnh nhất, đã xác minh nguyên văn [OPERA-XN]:** *gán vai một mình không cấp quyền vào property; người dùng còn phải được gán hub*, kèm biểu đồ Venn minh hoạ chỉ property nào **vừa** có property role **vừa** nằm trong hub thì mới vào được — [About Roles 26.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_manage_roles.htm).

### B.2 Bốn cơ chế phụ trợ — [OPERA-XN]

| Cơ chế | Nội dung | Nguồn |
|---|---|---|
| Bỏ mặt nạ = task riêng | Trường định danh bị mask; phải có task “xem bản không mask” mới thấy giá trị thật; **mỗi lần bỏ mặt nạ ghi Changes Log** | [Managing Profile Identification 23.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.2/ocsuh/t_create_manage_managing_profile_identification_and_personal_details.htm) |
| Nhãn “New” sau nâng cấp | Task mới xuất hiện sau upgrade được đánh dấu để admin rà; **không tự được cấp** | [Assigning Tasks to a Role 24.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/t_manage_property_roles_assigning_tasks_to_roles.htm) |
| Grant/revoke được audit | Cấp/thu task cho vai đều ghi vào Changes Log | cùng nguồn trên |
| “View là quyền nền” | Ở sản phẩm cùng họ **OPERA Cloud Distribution** (KHÁC PMS): mức quyền tường minh View / New-Edit / Delete theo module, và **không có View thì không thấy tuỳ chọn trên menu** | [Distribution — Role Permissions](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/22.1/ohdug/c_role_manager_role_permissions.htm) |

### B.3 Hai anti-pattern học để CHẶN — [OPERA-XN]

| Anti-pattern | Nội dung OPERA | Vì sao ERP phải chặn |
|---|---|---|
| Cùng tên vai, khác bộ quyền | Có control cho phép tạo property role **độc lập không template** ⇒ cùng một tên vai ở hai property mang bộ task khác nhau | Câu “TGĐ đã duyệt vai X” sẽ **mất nghĩa xác định**; audit và hồ sơ trình duyệt không đọc được |
| Thu quyền không hiệu lực ngay | Thay đổi task chạy qua tiến trình định kỳ, **có thể mất tới 10 phút** mới hiệu lực | ERP hiện tra DB **mỗi request**, không cache **[ĐO]** — tốt hơn OPERA. Phải giữ; nếu thêm cache thì TTL rất ngắn và **tuyệt đối không cache leaf nhạy cảm** |

### B.4 CHƯA XÁC MINH ĐƯỢC — không dùng làm căn cứ

| Mệnh đề | Trạng thái |
|---|---|
| Báo cáo “Configured Roles and Tasks” liệt kê vai × task với bộ lọc theo cấp/nhóm/vai | **[OPERA-?]** Tìm nhiều lần không thấy trang nào của Oracle mô tả báo cáo tên này. **Đây là ứng viên bịa cao nhất.** ERP **tự thiết kế** bản chiếu ma trận, **không viện dẫn Oracle** |
| Màn Manage Property Roles chia 3 khối “Search / Template Roles / Property Roles” | **[OPERA-?]** Tài liệu không dùng ba tên panel này |
| Chọn một Parent Task có tự động cấp task/sub-task con hay không | **[OPERA-?]** Tài liệu không phát biểu quy tắc kế thừa |
| OPERA có action “Copy Role / Copy Tasks” hay không | **[OPERA-?]** Không tìm thấy — mức “không thấy”, **không phải** xác nhận vắng mặt |
| OPERA có cửa trình duyệt/phê duyệt thay đổi ma trận quyền hay không | **[OPERA-?]** Chỉ thấy ghi Changes Log **sau khi** đã grant/revoke. Kết luận “OPERA không có cửa duyệt” là **suy từ việc không thấy** |
| Cơ chế phân quyền theo BẢN GHI (row-level) trong OPERA | **[OPERA-?]** Cấp nhỏ nhất xác minh được là property/hub. Vì vậy **không lấy OPERA làm khuôn** ở điểm này |

---

## C. SO SÁNH VỚI ERP-MASTER HIỆN TẠI

| Khía cạnh | OPERA Cloud | ERP-Master hiện tại **[ĐO]** | Khoảng cách |
|---|---|---|---|
| Đơn vị quyền nhỏ nhất | Task (node lá của cây 3 mức), danh mục đóng **[OPERA-XN]** | `authz.permissions.code` dạng `module.resource.action`, **6 mã** trong seed | Cấu trúc tương đương và **tốt hơn** (có cú pháp ⇒ wildcard theo đoạn). Nhưng danh mục quá mỏng và **chưa đóng** (không có test chặn mã lạ) |
| Cách biểu diễn hành động | Nhúng trong tên task, không có cột action **[OPERA-XN]** | Tách thành **đoạn thứ 3**, `permissionMatches` so từng đoạn, `*` khớp một đoạn | ERP **hơn** OPERA: viết được `cemetery.*.view`. Rủi ro kèm theo: **`*.*.*` trùm cả mã tương lai** |
| Phủ điểm chặn | Task gate mọi vùng chức năng | **4/50 endpoint** có `@RequirePermission`; **4 controller** (cemetery, files, burials, services = 28 route) **không đăng ký `PermissionGuard`** | **Khoảng cách lớn nhất về bề rộng** |
| Mặc định khi thiếu khai báo | View là quyền nền, không có View thì không thấy menu **[OPERA-XN]** | `if (required === undefined) return true;` — **default ALLOW** (`permission.guard.ts:23-25`) | **Ngược hoàn toàn.** Phải đảo sang default-DENY |
| Phạm vi dữ liệu | Hub gán cho **user**, tách rời vai; quyền = **phần giao** **[OPERA-XN]** | Có `role_permissions.scope` + `role_assignments.companyId` nhưng **guard bỏ hoàn toàn**; `PolicyEvaluator` **không có caller nào** | **Khoảng cách nghiêm trọng nhất về chiều sâu.** `companyId` hiện do **client tự khai** qua query/body ⇒ IDOR cấp công ty có hệ thống |
| Cấp phạm vi | Chain / Property / cụm property | Khai 6 scope `SELF·ASSIGNED·DEPARTMENT·COMPANY·GROUP·CUSTOM`; **không có `SITE`** | `DEPARTMENT`/`ASSIGNED`/`CUSTOM` **không có dữ liệu tựa** (không bảng phòng ban, không bảng phân công, không resolver). `GROUP` **không thực thi được** (không có cột `groupId`). Thực chất **chỉ `COMPANY` và `SELF`** khả thi |
| Hợp giải nhiều vai | Không rõ trong tài liệu | **HỢP (union)** mọi grant ⇒ **vai rộng nhất thắng** | **Ngược Hiến pháp** (“phần giao nhỏ nhất”). Chưa có deny tường minh |
| Dữ liệu nhạy cảm | Task “xem bản không mask” + audit từng lần **[OPERA-XN]** | Có **đúng một điểm sáng**: `GET /crm/persons/:id/national-id` có quyền + ghi audit `PII.NATIONAL_ID_VIEWED`. Ngoài ra: `GET /files/:id/download-url` **chỉ kiểm `scanStatus`, bỏ qua `sensitivity`** dù chú thích schema nói phải gate | Giấy chứng tử/hợp đồng hiện **tải được bởi mọi user đăng nhập** chỉ cần biết `fileId` |
| Hạn hiệu lực của quyền | Không rõ | `role_assignments` **không có** `validFrom/validTo/grantedBy/reason` | Trái khuyến nghị của chính G0-A6 (“cấp theo scope tối thiểu **có thời hạn**”). Vai khẩn cấp không thể triển khai |
| Actor không phải người | Không áp dụng | `apps/worker` đổi trạng thái lô mộ và subscription, ghi `changedBy: null`, **ngoài mọi lớp quyền** | Vi phạm “không danh tính → không dùng công cụ”. Cần **ghế máy** |
| Audit thay đổi quyền | Grant/revoke vào Changes Log **[OPERA-XN]** | `audit.audit_events` append-only + hash chain (tốt), nhưng **chưa nối** các bảng `authz`; audit thiếu `session_id / agent_id / device / tool / recipient` | Thiếu đúng các trục mà Hiến pháp mục 10 đòi |
| Bản chiếu ma trận cho người duyệt | Có báo cáo (**[OPERA-?]** — chưa xác minh) | Ma trận quyền **chỉ đọc được trong source code** (`seed.ts` + decorator) | Người có thẩm quyền hiện **không đọc được** thứ mình duyệt |
| Cửa “Đã duyệt ≠ Hiệu lực” | **[OPERA-?]** không thấy | Không có | ERP phải tự làm — chỗ ERP **hơn** OPERA |

---

## D. TAXONOMY QUYỀN ĐỀ XUẤT — [SĐ]

### D.1 Bốn ràng buộc kỹ thuật khoá thiết kế **[ĐO]**

| # | Sự thật | Hệ quả bắt buộc |
|---|---|---|
| 1 | `permissionMatches` yêu cầu **số đoạn bằng nhau** | Mã **cứng 3 đoạn**. Mức nhạy cảm là **CỘT**, không phải đoạn thứ 4 |
| 2 | Route thiếu metadata thì guard **cho qua** | Taxonomy phải phủ **hết**; thiếu một dòng = một cửa mở |
| 3 | `@RequirePermission(permission: string)` nhận **một** chuỗi; guard lấy **một** giá trị | **Một route = ĐÚNG MỘT mã gate.** Mã thứ hai phải kiểm ở **tầng service/trường** |
| 4 | `getGrants` trả **HỢP** các vai; không có deny | Phải chốt **quy tắc hợp giải** + **deny tường minh** trước khi nối scope |

### D.2 Năm trục

| Trục | Nơi lưu | Ghi chú |
|---|---|---|
| T1 `module` | đoạn 1 của mã | Miền nghiệp vụ, số ít, ≤ 12 module |
| T2 `resource` | đoạn 2 | **Thực thể nghiệp vụ, không phải tên bảng.** Tách riêng khi rủi ro khác hẳn (ví dụ `price` tách khỏi `grave_type`) |
| T3 `action` | đoạn 3 | Chỉ lấy từ **bộ đóng** ở D.3 |
| T4 mức nhạy cảm **S0–S3** | cột mới `authz.permissions.sensitivity` | Để **quản trị và chặn wildcard**, không dùng để so khớp runtime |
| T5 phạm vi | `role_permissions.scope`, `role_assignments.scope/companyId`, + **bảng gán phạm vi mới** | Tương đương Hub của OPERA |

**Công thức quyền hiệu dụng (sửa theo phản biện — 6 thừa số, đúng Hiến pháp):**

```
ĐƯỢC PHÉP = (người có mã quyền T1.T2.T3)
          ∧ (bản ghi đích nằm trong phạm vi HẸP NHẤT của các grant cùng khớp mã)
          ∧ (không có deny tường minh nào phủ bản ghi/lớp dữ liệu này)
          ∧ (grant còn trong hạn: validFrom ≤ nay < validTo)
          ∧ (ghế/agent được phép giữ leaf này, còn trong hạn)
          ∧ (phiên/thiết bị nhận diện được — bắt buộc với leaf S3)
```

### D.3 Bộ action ĐÓNG

**Nhóm A — 12 action dùng chung:** `view` · `search` · `export` · `view_sensitive` · `download` · `download_sensitive` · `create` · `update` · `delete` · `verify` · `approve` · `override`

Ba tầng đọc tách rời theo Hiến pháp (“quyền ĐỌC ≠ quyền trích xuất hàng loạt”):

| Action | Ranh giới | Audit |
|---|---|---|
| `view` | ≤ 1 bản ghi theo id, hoặc danh sách **bị chặn bởi scope**, dạng **đã mask** | chỉ với S3 |
| `search` | tra cứu theo tiêu chí người dùng tự nhập ⇒ quét dần được cả kho | có, nếu là dữ liệu cá nhân |
| `export` | dữ liệu **rời khỏi hệ** (CSV/Excel/PDF) hoặc trả > ngưỡng N bản ghi | **bắt buộc**, kèm tiêu chí + số dòng + đích nhận |

Bốn bước phê duyệt tách rời (hiện thực hoá “Đã duyệt ≠ Hiệu lực”): `create/update` (soạn) → `verify` (thẩm định) → `approve` (duyệt chủ trương) → `activate` (**cho hiệu lực**, sinh hệ quả thật).

**Nhóm B — action nghiệp vụ, danh sách ĐÓNG:** `activate` · `hold` · `release` · `set_status` · `set_price` · `renew` · `cancel` · `complete` · `assign` · `upload` · `confirm` · `adjust` · `backdate` · `close` · `set_sensitivity` · `set_protected` · `view_protected` · `view_price` · `view_history` · `grant` · `revoke` · `submit` · `record` · `withdraw` · `rotate` · `configure` · `ai_ingest`

Thêm mới một từ ⇒ **migration có review**, kèm lý do.

### D.4 Bốn mức nhạy cảm

| Mức | Nội dung | Ràng buộc |
|---|---|---|
| **S0** | Danh mục tham chiếu tĩnh | wildcard trùm được |
| **S1** | Dữ liệu tác nghiệp thường | wildcard trùm được; **phải áp scope** |
| **S2** | Giá, số tiền, trạng thái tài sản, metadata file | wildcard trùm được nhưng phải áp scope; audit khi ghi |
| **S3** | Dữ liệu cá nhân (NĐ13), unmask, export, approve, override, hành vi bất khả hồi, quản trị quyền, cấu hình an toàn | **không được trùm bởi `*`**; **audit từng lần**; **không cache**; **cần lý do theo mã** |

Ba cột metadata thêm vào `authz.permissions`: `sensitivity`, `wildcard_exempt`, `introduced_in` + `reviewed_at` (mã mới mặc định `reviewed_at = null` và **không cấp cho vai nào** — học nhãn “New” của OPERA).

### D.5 Danh mục quyền — **NGUỒN SỰ THẬT DUY NHẤT** (mọi bảng khác phải tham chiếu bảng này)

> Bản thiết kế trước có **hai bộ mã khác nhau** cho cùng một quyền (`cemetery.site.view` vs `cemetery.cemetery.view`, `contract.record.create` vs `contract.contract.create`, `crm.person.view_sensitive` vs `crm.person.unmask`) — không thể seed vì `Permission.code` là unique. Bảng dưới đây là bản **đã chốt một bộ**; `add` và `unmask` bị loại vì không nằm trong bộ action đóng.

| Module | Resource | Actions | Mức |
|---|---|---|---|
| `org` | `company` | `view` · `create` · `update` | S1 / S3 / S3 |
| `cemetery` | `reference` | `view` | S0 |
| `cemetery` | `site` | `view` · `create` | S1 / S2 |
| `cemetery` | `grave_type` | `view` · `create` | S1 |
| `cemetery` | `price` | `view` · `set_price` | S2 / **S3** |
| `cemetery` | `plot` | `view` · `search` · `export` · `create` · `set_status` · `override` · `view_history` | S1…**S3** |
| `cemetery` | `hold` | `view` · `hold` · `release` | S1 / S2 / **S3** |
| `crm` | `person` | `view` · `create` · `update` · `view_sensitive` · `export` · `set_protected` · `view_protected` · `ai_ingest` | S2 / **S3** |
| `crm` | `customer` | `view` · `search` · `create` · `export` | S2 / **S3** |
| `crm` | `relationship` | `view` · `create` · `verify` · `cancel` | **S3** |
| `crm` | `consent` | `view` · `record` · `withdraw` | **S3** |
| `contract` | `record` | `view` · `search` · `export` · `create` · `update` · `verify` · `approve` · `activate` · `cancel` · `ai_ingest` | S2 / **S3** |
| `contract` | `amount` | `view_sensitive` | **S3** |
| `contract` | `party` | `view` · `assign` | S2 / **S3** |
| `burial` | `deceased` | `view` · `create` | **S3** |
| `burial` | `record` | `view` · `search` · `export` · `create` · `verify` · `complete` | S2 / **S3** |
| `service` | `catalog` | `view` · `create` | S1 |
| `service` | `price` | `view` · `set_price` | S2 / **S3** |
| `service` | `subscription` | `view` · `search` · `export` · `create` · `renew` · `cancel` · `override` · `view_price` | S2 / **S3** |
| `service` | `transaction` | `view` · `adjust` · `backdate` | S2 / **S3** |
| `service` | `revenue` | `view` · `export` · `ai_ingest` | **S3** |
| `service` | `period` | `close` | **S3** |
| `file` | `object` | `view` · `upload` · `confirm` · `download` · `download_sensitive` · `set_sensitivity` · `delete` | S1…**S3** |
| `audit` | `event` | `view` · `view_sensitive` · `export` | S2 / **S3** |
| `audit` | `user_activity` | `view` | **S3** |
| `audit` | `integrity` | `view` | S2 |
| `authz` | `permission` / `role` | `view` · `create` · `update` | S1 / **S3** |
| `authz` | `role_permission` | `grant` · `revoke` | **S3** |
| `authz` | `role_assignment` | `assign` · `revoke` | **S3** |
| `authz` | `scope` | `assign` | **S3** |
| `authz` | `change` | `submit` · `approve` | S2 / **S3** |
| `authz` | `matrix` | `export` | S2 |
| `iam` | `user` / `session` | `view` · `create` · `update` · `revoke` | **S3** |
| `iam` | `secret` | `view` · `rotate` | **S3** |
| `config` | `reference` / `flag` | `update` · `view` | **S3** |
| `notification` | `template` / `message` / `channel` | `view` · `update` · `configure` | S2 / **S3** |

### D.6 Sửa theo phản biện: mã GATE ROUTE vs mã GATE TRƯỜNG

Vì một route chỉ mang được **một** mã **[ĐO]**, danh mục chia hai loại:

| Loại | Nơi kiểm | Ví dụ |
|---|---|---|
| **Gate route** (1 mã/route, trong `@RequirePermission`) | `PermissionGuard` | `contract.record.view` cho `GET /contracts/:id` |
| **Gate trường/hành vi phụ** (kiểm trong service bằng `getGrants` + `permissionMatches`) | service/interceptor | `contract.amount.view_sensitive`, `cemetery.price.view`, `service.subscription.view_price`, `audit.event.view_sensitive`, `file.object.download_sensitive`, `cemetery.plot.override`, `service.subscription.override`, `service.transaction.backdate` |

Bảng đối soát 50 endpoint: **5 công khai/tự thân** (chia hai nhóm: `@Public` thật = `/health`, `login`, `refresh`; **chỉ cần JwtAuthGuard** = `logout`, `/auth/me` — **không** khai `@Public` cho hai cái sau) + **45 route gate** + **8 mã gate trường**.

### D.7 Đổi tên 4 mã hiện hữu — chi phí đúng 4 decorator + `seed.ts` **[ĐO]**

| Hiện tại | Đề xuất | Lý do |
|---|---|---|
| `cemetery.grave.hold` | `cemetery.hold.hold` | Để có `cemetery.hold.release` đối xứng |
| `cemetery.contract.activate` | `contract.record.activate` | **Quan trọng:** giữ nguyên thì `cemetery.*.*` cấp cho vai nghĩa trang sẽ **trùm luôn quyền cho hiệu lực hợp đồng** |
| `cemetery.document.view_sensitive` | tách **hai**: `crm.person.view_sensitive` + `file.object.download_sensitive` | Một mã đang gánh hai rủi ro khác nhau (xem màn hình vs mang file ra ngoài) |
| `cemetery.customer.view` | `crm.customer.view` | Đúng miền. Lưu ý mã cũ là **quyền chết**: đã cấp cho STAFF nhưng **không endpoint nào dùng** **[ĐO]** |
| `audit.event.view` | **giữ nguyên** | Đã đúng quy ước |

### D.8 Ba khoảng trống taxonomy phải vá (phát hiện từ phản biện)

| Khoảng trống | Nội dung |
|---|---|
| **Ghế máy** | `apps/worker` cần `agent_id` + owner + hạn, một vai `SYSTEM_WORKER` với **đúng 2 mã** (`cemetery.plot.set_status` giới hạn `Held→Available`, `service.subscription.cancel` giới hạn hết hạn), `changedBy` = `agent_id` thay vì `null`, audit `actorType='AGENT'` |
| **Cơ chế của `override` và `export`** | Cấp quyền override hiện = làm được **vô hạn**. Cần: (a) **mã lý do** từ danh mục đóng, không phải text tự do; (b) **ngưỡng theo vai** (`role_limits`: leaf + trần giá trị); (c) **xác thực người thứ hai ngay trong giao dịch** — dùng được **ngay** dù A7 còn hoãn vì không cần workflow trạng thái. Với `export`: **trần bản ghi/trang bắt buộc trên MỌI endpoint danh sách** (nếu không, vòng lặp `view/search` chính là export mà không cần leaf `export`), **quota theo người/ngày**, audit đủ 4 trường |
| **Sổ hoạt động theo người** | Thêm `audit.user_activity.view` (chỉ DPO/KTNB) + bất biến: **mỗi lần gọi `audit.event.view*` tự phát một audit event** (nếu không, kiểm toán viên duyệt PII toàn tập đoàn mà không để lại vết) + ghi sự kiện `AUTH.LOGIN_FAILED / LOGIN_OK / SESSION_REVOKED` |

### D.9 Mask: nói rõ cơ chế (sửa theo phản biện)

Hàm mask **duy nhất** đang có nằm trong module audit, khớp theo **tên khoá bằng regex** **[ĐO]** — nó **không** che `totalAmount`, `referencePrice`, `price`, `agreedPrice`, `dateOfBirth`, `dateOfDeath`, `phone`, `email`, và sẽ trượt tên tiếng Việt (`soCccd`, `cmnd`, `ngaySinh`). Vì vậy “mask ở tầng DTO” **không** phải việc miễn phí — nó cần 1 PR hạ tầng:

| Cần làm | Chi tiết |
|---|---|
| Bảng trường nhạy cảm tường minh | `bảng.trường → mức S → leaf mở khoá → định dạng mask` |
| Danh sách trắng trường trả ra | Serializer theo **allowlist**, không theo regex tên khoá |
| Bất biến | `nationalIdCipher` / `nationalIdHash` **không bao giờ** được serialize ra API |
| 5 chỗ phải sửa **[ĐO]** | `contracts.service` (get/list → `totalAmount`), `services.service.revenue`, `services.service.listSubscriptions` (`agreedPrice`), `cemetery.service.listGraveTypes` (`referencePrice`), `audit-query` (`beforeData/afterData`) |
| Phạm vi NĐ13 rộng hơn A6 | A6 là **mức tối thiểu**, không phải giới hạn: `phone`/`email` mask mặc định, `dateOfBirth`/`dateOfDeath` mask thành năm, địa chỉ mask thành phường/xã |

### D.10 Scope: chốt lại ngữ nghĩa trước khi nối dây

| Scope | Trạng thái **[ĐO]** | Quyết định đề xuất **[SĐ]** |
|---|---|---|
| `GROUP` | **Không thực thi được** — không có cột `groupId` ở bất kỳ model nào | **Chốt nghĩa: “không giới hạn bản ghi”** (`case 'GROUP': return true`). Đây là cách duy nhất khớp dữ liệu hiện có. Thêm `org.groups` + `groupId` cho mọi bảng là **đắt, không làm trước M6** |
| `COMPANY` | Khả thi **có điều kiện** | Bắt buộc `role_assignments.companyId`; đối chiếu với `companyId` của bản ghi, **không tin client** |
| `SITE` (nghĩa trang) | **Chưa tồn tại** trong `SCOPES` | Cần migration: thêm `'SITE'` vào `SCOPES`, thêm `siteId` (= `cemeteryId`) vào `Subject`/`ResourceTarget`, thêm `case 'SITE'`. `GravePlot` **đã có** `cemeteryId` nên tựa được |
| `SELF` | Khả thi hẹp | Chỉ `grave_holds.createdBy`, `file_objects.uploadedBy` |
| `DEPARTMENT` · `ASSIGNED` · `CUSTOM` | **Không khả thi** | **Chặn ở tầng validate seed.** Enum khai sẵn mà không thực thi **tệ hơn không khai** — người duyệt đọc thấy `scope: DEPARTMENT` và tưởng đã có kiểm soát |
| Bẫy im lặng | `permissions.service.ts:20` **ép mọi scope lạ về `CUSTOM`**, mà `CUSTOM` không có resolver ⇒ **từ chối im lặng** | **BỎ fallback**: scope không hợp lệ ⇒ **seed FAIL / throw**, không deny lặng |
| Quy tắc hợp giải nhiều vai | Hiện là **HỢP** ⇒ vai rộng nhất thắng | **Chốt: phạm vi HẸP NHẤT trong các grant cùng khớp mã** (trừ khi có grant tường minh rộng hơn cho **đúng** mã đó, không qua wildcard). Thêm **deny tường minh cho LÀN CẤM — deny luôn thắng allow** |

### D.11 Sáu lớp nằm NGOÀI ma trận nhưng vô hiệu hoá được ma trận

| Lớp | Vấn đề **[ĐO]** | Việc phải làm |
|---|---|---|
| Khoá mã hoá CCCD | Ai giữ khoá thì vô hiệu hoá `crm.person.view_sensitive` | `iam.secret.view` / `iam.secret.rotate`, không lưu khoá dạng env phẳng, quy trình xoay khoá |
| Truy cập DB trực tiếp | Một DB user quyền đầy đủ mọi schema ⇒ bỏ qua sạch 45 leaf; trigger append-only cũng vô hiệu nếu là owner | Tách DB role (`app_rw` hạn chế / `app_migrate` riêng), xác nhận trigger không bị `DISABLE` bởi user runtime; hướng sau: RLS theo `company_id` |
| Cờ môi trường | `VIRUS_SCAN_ENABLED != 'true'` ⇒ tự đặt `scanStatus='clean'` — một **cờ môi trường đang là quyền quyết định bảo mật** | `config.flag.view/update` (S3); cờ ảnh hưởng an toàn **không đổi được ở runtime** bởi vai nghiệp vụ |
| Kênh dữ liệu đi ra | `outbox` → SMTP không có mã quyền nào; email nhắc hạn có thể mang tên người mất/thông tin hợp đồng ra ngoài | Module `notification.*`; payload outbox chỉ chứa trường **allowlist**, audit kèm **đích nhận** |
| Script cấp quyền | `scripts/seed-dev-user.ts` gán ADMIN `*.*.*` với `companyId = null` | Chặn cứng theo `NODE_ENV`; danh sách “các đường ghi vào `authz`” là **danh sách ĐÓNG có test CI** |
| Phiên/thiết bị | Token trong `localStorage`; JWT chỉ mang `{userId, email, sid}`; audit **không có** `session_id`/`agent_id`/`device`/`tool`/`recipient` | Chuyển sang httpOnly cookie, gắn phiên với thiết bị, thêm 5 cột vào audit — **trước khi** tuyên bố đã phủ trục thiết bị/phiên |

---

## E. DANH MỤC VAI + MA TRẬN VAI × QUYỀN

### E.1 Ánh xạ vai khách sạn → vai nghĩa trang

Luồng khách sạn *Reservation → Check-in → Stay → Folio → Check-out* ↔ luồng nghĩa trang *Giữ chỗ → Hợp đồng/phân bổ mộ → An táng → Dịch vụ định kỳ → Đối soát*.

| Vai OPERA | Vai nghĩa trang | Mã | Quyết định |
|---|---|---|---|
| Front Desk Agent | Tiếp đón & CSKH | `CSKH_TIEP_DON` | Giữ |
| Reservations Agent | Kinh doanh (giữ chỗ, soạn HĐ) | `KD_KINH_DOANH` | Giữ |
| Client Relations (Profiles) | Hồ sơ nhân thân & giấy tờ | `HS_NHAN_THAN` | Giữ (Person/CCCD/quan hệ là lớp riêng, dùng chung liên công ty theo **G0-E5.1**) |
| Arrivals / Check-in clerk | Nghiệp vụ an táng | `NV_AN_TANG` | Giữ, **tách khỏi kinh doanh** |
| Housekeeping | Chăm sóc mộ & bảo trì | `NV_BAO_TRI` | Giữ |
| Cashier | Thu ngân | `THU_NGAN` | Giữ |
| Front Office Manager | Quản lý nghĩa trang | `QL_NGHIA_TRANG` | Giữ — ghế **thẩm định** tác nghiệp |
| General Manager | Ban giám đốc công ty | `GD_CONG_TY` | Giữ — ghế **cho hiệu lực** |
| Revenue Manager | Người/hội đồng duyệt giá | `HD_GIA` | Giữ — **tách hẳn khỏi người bán** |
| Night Auditor | Kế toán đối soát | `KT_DOI_SOAT` | Giữ, **đổi bản chất: chỉ đọc** |
| Internal Auditor | Kiểm toán nội bộ | `KTNB_KIEM_TOAN` | Giữ — chỉ đọc toàn tập đoàn |
| Regional General Manager | *(không tạo vai)* | — | **BỎ vai, dùng phạm vi** — đúng bài học OPERA: ít cấp vai, phạm vi tách riêng |
| Accounts Receivable Clerk | *(chưa quyết)* | — | **TREO** — không kết luận bỏ, vì **G0-A5 còn “chờ Bách xác nhận diễn giải”** **[ĐO]**. Xem câu hỏi Q9 |
| Toolbox (sửa dữ liệu trực tiếp) | *(không tạo)* | — | **BỎ HẲN** — là đường phá hash-chain audit |
| Channel / Distribution, Exchange Interfaces, Guest self-service, Group/Block | — | — | **BỎ / HOÃN** (chưa có nghiệp vụ tương ứng; “khu gia tộc” ghi vào backlog) |
| IT Admin / Role Manager | Quản trị hệ thống | `QT_HE_THONG` | Giữ, **siết**: không xem dữ liệu nhạy cảm và doanh thu |
| *(OPERA không có)* | Quản trị nghiệp vụ (soạn ma trận quyền) | `QT_NGHIEP_VU` | **THÊM** — chỉ `submit`, không `approve` |
| *(OPERA không có)* | Cán bộ bảo vệ dữ liệu cá nhân | `DPO_DLCN` | **THÊM** — bắt buộc theo NĐ13 + G0-A6 |
| *(OPERA không có)* | Ghế máy cho worker | `SYSTEM_WORKER` | **THÊM** |
| *(OPERA không có)* | Vai khẩn cấp có hạn giờ | `BREAK_GLASS` | **THÊM nhưng KHOÁ** — chỉ tạo **sau khi** có `validTo`; nếu tạo trước, nó là **siêu quyền vĩnh viễn** |

**Tổng: 14 vai người + 1 ghế máy + 1 vai khẩn cấp (khoá).** Bỏ hẳn vai `ADMIN` `*.*.*`.

### E.2 Ma trận vai × quyền

Ký hiệu: **C** = được cấp · **A** = chỉ khi được phê duyệt (**ở Gate 1 coi như “–”** vì G0-A7 còn hoãn) · **–** = không cấp · **X** = cấm tuyệt đối (deny tường minh).
Scope: **G** = không giới hạn bản ghi · **CO** = công ty · **SI** = nghĩa trang · **SE** = của chính mình.

**Nhóm 1 — vai tác nghiệp**

| Quyền | CSKH | KD | HS_NT | AN_TANG | BAO_TRI | THU_NGAN |
|---|---|---|---|---|---|---|
| `cemetery.reference.view` | C | C | C | C | C | C |
| `cemetery.site.view` · `cemetery.grave_type.view` | C | C | – | C | C | C |
| `cemetery.plot.view` | C | C | – | C | C | C |
| `cemetery.plot.search` | – | C | – | – | C | – |
| `cemetery.plot.export` | – | – | – | – | – | – |
| `cemetery.plot.set_status` | – | – | – | A | A | – |
| `cemetery.plot.override` · `view_history` | – | – | – | – | – / C | – |
| `cemetery.price.view` | C | C | – | – | – | C |
| `cemetery.price.set_price` | – | – | – | – | – | – |
| `cemetery.hold.view` · `hold` · `release` | C / – / – | C / C / A | – | – | – | – |
| `crm.customer.view` · `create` | C / C | C / C | C / C | C / – | – | C / – |
| `crm.customer.search` | – | C | C | – | – | – |
| `crm.customer.export` | – | – | – | – | – | – |
| `crm.person.view` · `create` · `update` | C / – / – | C / C / – | C / C / C | C / – / – | – | – |
| `crm.person.view_sensitive` | – | – | **C** | – | – | – |
| `crm.person.export` · `ai_ingest` | – | – | – | – | – | – |
| `crm.person.view_protected` | X | X | X | X | X | X |
| `crm.relationship.view` · `create` | – | C / C | C / C | C / – | – | – |
| `crm.relationship.verify` · `cancel` | – | – | – | – | – | – |
| `crm.consent.view` · `record` | – | C / C | C / C | – | – | – |
| `contract.record.view` · `search` · `create` · `update` | C / – / – / – | C / C / C / C | – | C / – / – / – | – | C / C / – / – |
| `contract.amount.view_sensitive` | – | C | – | – | – | C |
| `contract.record.verify` · `approve` · `activate` · `cancel` | – | – | – | – | – | – |
| `contract.party.view` · `assign` | C / – | C / C | C / – | C / – | – | C / – |
| `burial.deceased.view` · `create` | – | – | C / C | C / C | – | – |
| `burial.record.view` · `create` | – | – | C / – | C / C | C / – | – |
| `burial.record.search` | – | – | C | C | – | – |
| `burial.record.verify` · `complete` · `export` | – | – | – | – | – | – |
| `service.catalog.view` · `create` | C / – | C / – | – | C / – | C / – | C / – |
| `service.price.view` · `set_price` | C / – | C / – | – | – | – | C / – |
| `service.subscription.view` · `create` · `renew` | C / – / – | C / C / C | – | – | C / – / – | C / C / C |
| `service.subscription.search` · `view_price` | – | C / C | – | – | – | C / C |
| `service.subscription.cancel` · `override` · `export` | – | – / A / – | – | – | – | – |
| `service.transaction.view` · `adjust` · `backdate` | – | – | – | – | – | C / – / – |
| `service.revenue.view` · `export` | – | – | – | – | – | – |
| `file.object.view` · `upload` · `confirm` · `download` | C×4 | C×4 | C×4 | C×4 | C / C / C / – | C×4 |
| `file.object.download_sensitive` | – | – | **C** | **C** | – | – |
| `file.object.set_sensitivity` · `delete` | – | – | – | – | – | – |
| **Scope mặc định** | CO→SI | CO→SI | CO | CO→SI | SI | CO |

**Nhóm 2 — quản lý, kiểm soát, quản trị**

| Quyền | QL_NGHIA_TRANG | GD_CONG_TY | HD_GIA | KT_DOI_SOAT | KTNB | DPO | QT_HE_THONG | QT_NGHIEP_VU | SYSTEM_WORKER |
|---|---|---|---|---|---|---|---|---|---|
| `cemetery.*.view` (đọc danh mục/tài sản) | C | C | C | C | C | – | – | C | – |
| `cemetery.plot.set_status` | C | C | – | – | – | – | – | – | **C** (chỉ `Held→Available`) |
| `cemetery.plot.override` | A | A | – | – | – | – | – | – | – |
| `cemetery.plot.export` | A | C | – | C | C | – | – | – | – |
| `cemetery.price.set_price` · `service.price.set_price` | – | A | **A** | – | – | – | – | – | – |
| `cemetery.hold.release` | C | C | – | – | – | – | – | – | – |
| `crm.customer.search` · `crm.person.view` | C | C | – | – | C | C | – | – | – |
| `crm.person.view_sensitive` | A | A | – | – | A | **C** | X | X | X |
| `crm.person.export` · `crm.customer.export` | – | A | – | – | A | A | X | – | – |
| `crm.person.set_protected` · `view_protected` | – | – | – | – | – | **C / A** | X | – | X |
| `crm.person.ai_ingest` và mọi `*.ai_ingest` | – | A | – | – | – | A | X | – | X |
| `crm.relationship.verify` · `cancel` | C | C | – | – | – | – | – | – | – |
| `crm.consent.view` · `withdraw` | C | C | – | – | C | **C** | – | – | – |
| `contract.record.verify` | **C** | – | – | – | – | – | – | – | – |
| `contract.record.approve` | – | **C** | – | – | – | – | – | – | – |
| `contract.record.activate` | – | **C** | – | – | – | – | – | – | – |
| `contract.record.cancel` · `export` | A | C | – | – / C | C | – | – | – | – |
| `contract.amount.view_sensitive` | C | C | C | C | C | – | X | – | – |
| `burial.record.verify` | **C** | – | – | – | – | – | – | – | – |
| `burial.record.complete` | – | **C** | – | – | – | – | – | – | – |
| `burial.record.export` · `burial.deceased.view` | A / C | C / C | – | – | C / C | – / C | – | – | – |
| `service.subscription.cancel` · `override` | C / A | C / A | – / A | – | – | – | – | – | **C** (chỉ hết hạn) |
| `service.subscription.view_price` · `search` | C | C | C | C | C | – | – | – | – |
| `service.transaction.view` · `adjust` · `backdate` | C / – / – | C / A / – | – | **C / – / –** | C / – / – | – | – | – | – |
| `service.period.close` | – | **C** | – | A | – | – | – | – | – |
| `service.revenue.view` · `export` | C (SI) | C (CO) | C (CO) | C (CO) | C (G) | – | X | – | – |
| `file.object.download_sensitive` | C | C | – | – | A | A | X | – | – |
| `file.object.set_sensitivity` · `delete` | A / – | A / – | – | – | – | A / – | – | – | – |
| `audit.event.view` | C (SI) | C (CO) | – | C (CO) | **C (G)** | **C (G)** | – | – | – |
| `audit.event.view_sensitive` · `export` | – | A | – | – | A | **C** | X | – | – |
| `audit.user_activity.view` | – | – | – | – | **C** | **C** | – | – | – |
| `audit.integrity.view` | – | C | – | C | C | – | C | – | – |
| `authz.permission.view` · `role.view` · `matrix.export` | C | C | – | – | C | C | C | C | – |
| `authz.role.create/update`, `role_permission.grant/revoke`, `role_assignment.assign/revoke`, `scope.assign` | – | – | – | – | – | – | – | – | – |
| `authz.change.submit` | – | – | – | – | – | – | C | **C** | – |
| `authz.change.approve` | – | **C** | – | – | – | – | X | X | – |
| `iam.user.*` · `iam.session.*` | – | A | – | – | C (view) | C (view) | **C** | – | – |
| `iam.secret.view` · `rotate` | – | A | – | – | – | – | **A** | – | – |
| `config.flag.view` · `update` | – | A | – | – | C / – | C / – | C / A | – | – |
| `config.reference.update` | – | A | – | – | – | – | – | **A** | – |
| `notification.template.*` · `message.view` · `channel.configure` | C / C / – | A | – | – | C | **C** | A | C / – / – | – |
| **Scope** | SI | CO | CO | CO | **G** | **G** | G (chỉ hạ tầng) | G (chỉ danh mục) | CO |

**Điểm cần thấy rõ trong ma trận:** không vai nào được cấp `authz.role_permission.grant` / `role_assignment.assign` / `scope.assign` ở Gate 1 — nghĩa là **việc cấp/thu quyền chỉ đi qua migration + review Git**, và Git là cửa phê duyệt tạm (xem câu hỏi Q11).

### E.3 Bảng xung đột quyền — tách nhiệm vụ (bắt buộc kiểm ở tầng service, không chỉ tầng vai)

| # | Cặp xung đột | Mức chặn | Bất biến phải test |
|---|---|---|---|
| 1 | `contract.record.create` × `contract.record.verify` | **bản ghi** | `verifiedBy ≠ createdBy` trên cùng hợp đồng |
| 2 | `contract.record.verify` × `contract.record.activate` | **bản ghi** | `activatedBy ≠ verifiedBy` |
| 3 | `burial.record.create` × `burial.record.verify` × `complete` | **bản ghi** | ba người khác nhau; `complete` chỉ sau `verify` |
| 4 | `cemetery.price.set_price` / `service.price.set_price` × `service.subscription.create` | **vai** | người đặt giá không được là người bán |
| 5 | `service.subscription.override` (lệch giá niêm yết) × chính người bán | **giao dịch** | cần **người thứ hai** xác thực + mã lý do + trần theo vai |
| 6 | `service.transaction.view/post` × `service.transaction.adjust` | **vai** | người ghi nhận ≠ người ghi bù |
| 7 | `service.period.close` × `service.transaction.backdate` | **hệ** | không ghi được giao dịch vào kỳ đã đóng |
| 8 | `crm.relationship.create` × `crm.relationship.verify` | **bản ghi** | người dựng quan hệ không tự xác minh (hiện `status` mặc định `Confirmed`, `verificationSource` để trống được **[ĐO]**) |
| 9 | `file.object.set_sensitivity` × `file.object.download_sensitive` | **vai** | không ai được tự hạ nhãn rồi tải (hiện client **tự khai** mức nhạy cảm **[ĐO]**) |
| 10 | `authz.change.submit` × `authz.change.approve` | **vai** | người soạn ma trận quyền ≠ người cho hiệu lực |
| 11 | Mọi quyền GHI nghiệp vụ × `KTNB_KIEM_TOAN` / `DPO_DLCN` | **vai** | hai vai kiểm soát **chỉ đọc**, không ghi |
| 12 | `QT_HE_THONG` × mọi leaf S3 nghiệp vụ | **vai** | quản trị hạ tầng **không** xem được CCCD, doanh thu, số tiền |
| 13 | `cemetery.hold.hold` × `cemetery.hold.release` | **vai** | tạo và huỷ giữ chỗ khác người (hiện tạo cần quyền, **huỷ không cần gì** **[ĐO]**) |

---

## F. KẾ HOẠCH TRIỂN KHAI — PR NHỎ, XẾP THEO “AN TOÀN NHIỀU NHẤT / CÔNG ÍT NHẤT”

| # | Mục tiêu | File thật sẽ sửa | Nghiệm thu | Rủi ro |
|---|---|---|---|---|
| **PR-1** | **Test CI bất biến taxonomy** (không đổi hành vi) | thêm `apps/api/test/authz-invariants.spec.ts`; đọc `prisma/seed.ts` + quét AST decorator | 3 test đỏ→xanh: (a) mọi mã trong seed `split('.').length === 3`; (b) mọi chuỗi trong `@RequirePermission` **tồn tại** trong danh mục; (c) snapshot liệt kê **mọi route thiếu metadata** + allowlist có review | Gần 0. Chỉ thêm test |
| **PR-2** | **Bịt 3 lỗ hổng file + rate-limit auth** (độc lập mô hình quyền) | `files.service.ts` (gate `sensitivity` trước khi phát signed URL; `confirm` kiểm người gọi = người upload; không tự đặt `scanStatus='clean'`), `app.module.ts` (throttler cho `login`/`refresh`) | Test: user không có `file.object.download_sensitive` gọi `download-url` trên file `restricted` ⇒ 403; `confirm` file người khác ⇒ 403; brute-force bị chặn | Thấp. Có thể vỡ luồng dev đang dựa vào `scanStatus` tự clean ⇒ nêu rõ trong PR |
| **PR-3** | **Seed danh mục quyền D.5 + 3 cột metadata** (chỉ thêm dòng `permissions`, **KHÔNG cấp cho vai nào**) | migration mới; `prisma/schema.prisma` (`sensitivity`, `wildcard_exempt`, `introduced_in`, `reviewed_at`); `prisma/seed.ts` | `SELECT count(*)` khớp danh mục; `role_permissions` **không thêm dòng nào**; PR-1 vẫn xanh | Rất thấp — chưa ai được cấp gì |
| **PR-4** | **Cấp tường minh S3 cho các vai được duyệt** (BƯỚC 1/2, vẫn giữ `*.*.*`) | `prisma/seed.ts` (thay `ADMIN` bằng 14 vai + grant tường minh); `scripts/seed-dev-user.ts` (truyền `companyId` thật, chặn theo `NODE_ENV`) | Sandbox: 3 mã đang dùng thật vẫn chạy — activate hợp đồng, xem CCCD, đọc audit | Trung bình. **Phải chạy bản chiếu “ai đang có quyền gì” trước và sau** |
| **PR-5** | **`@Public()` + gắn `PermissionGuard` cho 4 controller còn thiếu + gắn `@RequirePermission` cho 45 route** (vẫn default-allow) | tạo `public.decorator.ts`; `cemetery/files/burials/services.controller.ts`; 45 handler; `audit.controller.ts` bỏ TODO | PR-1 test (c) còn **0 route** ngoài allowlist; smoke test toàn bộ web | Trung bình-cao: mọi route đột ngột **thật sự** kiểm quyền ⇒ phải xong PR-4 trước |
| **PR-6** | **Đảo guard sang default-DENY + bật `wildcard_exempt`** (BƯỚC 2/2) | `permission.guard.ts:23-25` → `throw`; `policy-evaluator.permissionMatches` tôn trọng `wildcard_exempt`; guard tra bảng `permissions` theo mã yêu cầu, **fail-closed** | Test hồi quy: mã không có trong `permissions` ⇒ **403**; ADMIN/GD vẫn activate được hợp đồng | **Cao — thay đổi PHÁ VỠ.** Không gộp với PR-5 |
| **PR-7** | **Hạ tầng mask theo quyền người gọi** | chuyển `masking.util.ts` ra `common`; thêm interceptor + decorator `@MaskUnless('...')`; sửa **5 chỗ** ở D.9 | Test: user không có `contract.amount.view_sensitive` ⇒ `totalAmount` bị mask ở **cả** get và list | Trung bình. Nửa vời (API trả, UI che) là **vô hiệu hoá toàn bộ A6** |
| **PR-8** | **`/auth/me` trả quyền hiệu dụng + web bỏ nhập tay `companyId`** | `auth.controller.ts`/`auth.service.ts`; `apps/web/lib/api.ts`; `components/company-picker.tsx`; 5 trang (`dashboard`, `graves`, `contracts`, `burials`, `services`) | Web chỉ chọn được công ty **trong phạm vi được gán**; sidebar sinh từ quyền thật | Trung bình. Đây là **breaking change cho web**, phải đi cùng PR-9 |
| **PR-9** | **Chặn client tự khai `companyId`** | `cemetery/contracts/services` service + DTO; luật: `companyId = NULL` **chỉ** hợp lệ khi scope `GROUP` | Test: user công ty A truyền `?companyId=B` ⇒ **403** (không phải trả rỗng) | Cao. Cần bản chiếu “user nào đang có `companyId = null`” **trước khi bật** |
| **PR-10** | **Chốt ngữ nghĩa scope + nối `PolicyEvaluator` vào guard** | `scope.enum.ts` (+`'SITE'`); `policy.types.ts` (+`siteId`); `policy-evaluator.ts` (`GROUP → true`, `case 'SITE'`); `permissions.service.ts` (**bỏ** fallback `CUSTOM`, throw); `permission.guard.ts` (dựng `Subject`, nạp `target`) | 4 test: ADMIN scope GROUP vẫn qua; STAFF scope COMPANY bị chặn khi `target.companyId` khác; scope `SITE` khớp `grave_plots.cemetery_id`; scope sai chính tả làm **seed FAIL** | **Cao nhất về logic.** Không làm trước PR-9 |
| **PR-11** | **Hạn hiệu lực + quy tắc hợp giải nhiều vai + deny** | migration `role_assignments`: `valid_from`, `valid_to`, `granted_by`, `grant_reason`, `approved_by`; `permissions.service.getGrants` lọc thời gian + **chọn phạm vi hẹp nhất**; thêm bảng deny cho LÀN CẤM | Test: grant hết hạn ⇒ không còn quyền; người 2 vai (CO + G) bị giới hạn **theo vai hẹp**; deny thắng allow | Trung bình. **Điều kiện bắt buộc** để mở `BREAK_GLASS` |
| **PR-12** | **Ghế máy cho worker** | `apps/worker/src/hold-expiry.ts`, `service-sweep.ts`, `dispatcher.ts`; seed vai `SYSTEM_WORKER`; `changedBy` NOT NULL | `gravePlotStatusHistory.changedBy` = `agent_id`, không còn `null`; audit `actorType='AGENT'` | Thấp-trung bình. Migration NOT NULL cần backfill |
| **PR-13** | **Audit đủ trục giao dịch + sổ hoạt động** | `audit` module: thêm `session_id`, `agent_id`, `device_id`, `tool_name`, `recipient`; phát event cho `AUTH.*`; audit **việc đọc audit** | Đọc `/audit-events` sinh ra một dòng audit; sự kiện đăng nhập thất bại có ghi | Thấp. Bảng append-only nên chỉ thêm cột |
| **PR-14** | **LÀN CẤM: cột bảo vệ nhân thân** | `schema.prisma` model `Person` (+cột bảo vệ); `customers.service.ts`; 2 leaf `crm.person.set_protected` / `view_protected` + deny | Test: nhân thân được bảo vệ ⇒ `/relationships` và `/national-id` trả 403 kể cả với `view_sensitive` | Thấp về kỹ thuật, **cao về hệ quả nếu chậm** |
| **PR-15** | **Cơ chế `override`/`export` + luồng `authz.change.*`** — **chờ G0-A7** | bảng `override_reasons`, `role_limits`, quota export, trần phân trang bắt buộc; luồng `submit`→`approve` | Không đặt được giá lệch quá trần; export vượt quota ⇒ chặn + cảnh báo DPO | Phụ thuộc quyết định A7 |

**Ranh giới Gate 1:** PR-1 → PR-7 là “bịt cửa và dựng danh mục”, làm được **ngay**. PR-8 → PR-11 là “bật phạm vi”, cần quyết định của anh Bách về scope và về `companyId`. PR-12 → PR-15 là “đóng các cửa còn lại”.

---

## G. RỦI RO & CÁI ĐÃ TỪNG SAI

### G.1 Bài học đã trả giá: mã quyền phải đúng 3 đoạn

`permissionMatches` so **từng đoạn** và **yêu cầu số đoạn bằng nhau** **[ĐO — `policy-evaluator.ts:19-21`]**. Hệ quả đã từng gặp trong dự án: một mã **2 đoạn** kiểu `audit.view` **không bao giờ** khớp grant `*.*.*` — người có “toàn quyền” vẫn bị từ chối, và guard chỉ báo `Thiếu quyền: audit.view` chứ **không** báo “mã sai cấu trúc”. Đây là **thất bại im lặng hai chiều**: sai số đoạn thì hoặc **khoá cứng** (như trên) hoặc **mở toang** (nếu ai đó khai `cemetery.plot` 2 đoạn và cấp `cemetery.*` 2 đoạn). Vì vậy PR-1 (test CI) **phải là PR đầu tiên**, trước mọi thứ khác.

### G.2 Rủi ro seed lại quyền làm mất quyền ADMIN đang chạy

Hiện ADMIN có **đúng một** grant `*.*.*` **[ĐO — `seed.ts:24`]**, và **cả 3 route S3 đang gate đều chạy được nhờ chính wildcard đó**: activate hợp đồng, xem CCCD, đọc audit. Nếu bật `wildcard_exempt` cho leaf S3 mà **chưa** cấp tường minh, thì **không ai** activate được hợp đồng, **không ai** xem được CCCD, **không ai** đọc được audit. Vì vậy:
- Phương án A (`wildcard_exempt`) là **thay đổi PHÁ VỠ**, **không** phải “rẻ hơn”.
- **Bắt buộc hai bước tách rời:** PR-4 (cấp tường minh + xác minh sandbox) rồi mới PR-6 (bật exempt).
- Thêm test hồi quy tên rõ ràng: *“GD_CONG_TY vẫn activate được hợp đồng sau khi bật wildcard_exempt”*.
- Lưu ý kỹ thuật: `permissionMatches` là **hàm thuần, không truy DB**. Muốn tôn trọng cột `wildcard_exempt` thì guard phải tra bảng `permissions` theo **mã yêu cầu** — và hôm nay mã yêu cầu **không bắt buộc tồn tại** trong bảng. **Phải chốt fail-closed**, nếu không cột đó vừa vô hiệu vừa nguy hiểm.

### G.3 Mười một rủi ro còn lại

| # | Rủi ro | Ghi chú |
|---|---|---|
| 1 | **Duyệt hồ sơ này rồi coi như “đã có kiểm soát”** | Taxonomy **không tự bịt lỗ hổng nào**. Nó chỉ có tác dụng khi đủ 4 việc: seed + gắn decorator + đảo default-DENY + nối scope |
| 2 | **Nối scope quá sớm ⇒ khoá sạch ADMIN** | Vì `GROUP` so `groupId` mà schema không có cột đó. Phải chốt `GROUP = không giới hạn` trước |
| 3 | **Seed `scope: 'SITE'` trước khi thêm vào enum** ⇒ bị ép về `CUSTOM` ⇒ **deny im lặng** | Biểu hiện ra ngoài là “quyền tự nhiên mất”, cực khó chẩn đoán |
| 4 | **Đảo default-DENY không đúng phạm vi** | Sửa riêng `permission.guard.ts:23-25` chỉ chặn **13 route** trong 4 controller có guard; **28 route nguy hiểm nhất** (gồm ghi doanh thu bất biến và báo cáo doanh thu) **vẫn mở nguyên**. Và `@Public()` **chưa tồn tại** trong repo **[ĐO]** |
| 5 | **`logout` và `/auth/me` bị khai `@Public` do gộp nhóm “5 công khai”** | Hai route này **cần đăng nhập**; khai `@Public` là mở cửa trạng thái phiên |
| 6 | **Bật kiểm `companyId` khi dữ liệu còn `null`** ⇒ khoá hết người dùng | `role_assignments.companyId` nullable và `@@unique` có NULL **không chống trùng** trong PostgreSQL |
| 7 | **`BREAK_GLASS` tạo trước khi có `validTo`** ⇒ siêu quyền vĩnh viễn | Mâu thuẫn nội tại phải chặn ở quy trình |
| 8 | **Mask nửa vời** (API trả giá, UI che) ⇒ vô hiệu hoá A6 | Đã có **tiền lệ trong hệ**: schema ghi `sensitivity` phải gate download, code không thực thi |
| 9 | **`cemetery.persons` cố ý không có `companyId`** (G0-E5.1) ⇒ scope công ty **không mô hình hoá được cho chính lớp dữ liệu nhạy cảm nhất** | Nếu không thiết kế phạm vi riêng cho Person, mọi công sức scope ở bảng khác vẫn để hở đường vào qua CRM |
| 10 | **Vòng lặp `view/search` = `export` không cần leaf `export`** | Nếu không có **trần phân trang bắt buộc** + **quota theo người/ngày**, tam phân view/search/export bị đi vòng |
| 11 | **Số leaf S3 lớn (~45 mã)** ⇒ chi phí vận hành đẩy người dùng đòi quay lại wildcard | Cần công cụ cấp quyền hàng loạt **có kiểm soát**, nếu không sẽ tự tái tạo đúng rủi ro đang bịt |

### G.4 Ba chỗ hồ sơ trước đã trích dẫn quyết định chưa chốt như đã chốt

| Chỗ | Vấn đề **[ĐO]** | Sửa |
|---|---|---|
| `contract.record.activate` viện dẫn “G0-G3.1” làm căn cứ | Checklist Gate 0 xếp **G3.1 vào “Còn hoãn”**. Đáng chú ý: **chú thích trong `schema.prisma` đã tự khẳng định “Allocation happens at Active (G0-G3.1)”** — tức **code đã đi trước quyết định** | Đổi nhãn thành **[CHƯA CHỐT]**; đưa vào câu hỏi Q10 |
| “Bỏ vai Kế toán công nợ vì A5 = không công nợ” | A5 tuy có trong bảng đã chốt nhưng kèm nguyên văn **“(chờ Bách xác nhận diễn giải)”**, và dòng khuyến nghị nháp lại là “Import là nguồn chính” | Chuyển từ **kết luận** thành **câu hỏi Q9** |
| “A7 workflow phê duyệt” | Còn hoãn ⇒ **mọi ô “A” trong ma trận chưa thực thi được** | Ở Gate 1, **coi “A” = “–”**: quyền đó chỉ nằm ở vai quản lý, không cấp cho vai tác nghiệp |

---

## H. CÂU HỎI CẦN ANH BÁCH QUYẾT

### Ưu tiên 1 — nhóm A6 (ai được xem CCCD / giá / giấy tờ)

**Q1. Ai được xem CCCD đầy đủ (`crm.person.view_sensitive`)?**
- (a) **Chỉ vai `HS_NHAN_THAN` + `DPO_DLCN`** — quản lý và giám đốc phải xin theo hồ sơ.
- (b) Thêm `QL_NGHIA_TRANG` và `GD_CONG_TY` được cấp thường trực.
- (c) Bất kỳ ai có `crm.person.view`.
- **Khuyến nghị: (a).** Đây là lớp dữ liệu chịu NĐ13 nặng nhất; OPERA cũng biến việc bỏ mặt nạ thành một quyền tách riêng **[OPERA-XN]**.

**Q2. Xem CCCD có bắt NHẬP LÝ DO mỗi lần, và có giới hạn tần suất không?**
- (a) **Lý do theo MÃ** (danh mục đóng) + trần N lần/ngày/người + reveal phải **gắn với một hồ sơ đang xử lý**, không cho reveal rời rạc theo `personId` bất kỳ.
- (b) Chỉ ghi audit như hiện nay, không bắt lý do.
- **Khuyến nghị: (a).** OPERA **không** làm điều này — đây là chỗ ta chủ động làm chặt hơn. Lý do tự do (text) **không đối soát được**; reveal rời rạc theo `personId` chính là đường khai thác LÀN CẤM.

**Q3. Ai được xem GIÁ và SỐ TIỀN? Tách `price.view` khỏi `catalog.view` hay gộp?**
- (a) **Tách** (`cemetery.price.view`, `service.price.view`, `contract.amount.view_sensitive`, `service.subscription.view_price`) — đúng về rủi ro, nhưng **buộc API phải mask trường giá theo người gọi** (PR-7).
- (b) Gộp cho gọn: ai xem danh mục thì thấy giá.
- **Khuyến nghị: (a)**, và đặc biệt tách `service.subscription.view_price` — giá **đã thương lượng** phơi ra mức chiết khấu của người khác, nhạy hơn giá niêm yết.

**Q4. Ai được xem BÁO CÁO DOANH THU (`service.revenue.view`) và ở phạm vi nào?**
- (a) `GD_CONG_TY` + `KT_DOI_SOAT` + `HD_GIA` ở phạm vi **công ty**; `KTNB_KIEM_TOAN` toàn tập đoàn; `QL_NGHIA_TRANG` chỉ **nghĩa trang của mình**.
- (b) Rộng hơn cho các trưởng bộ phận.
- **Khuyến nghị: (a).** Hiện endpoint này **không có quyền nào** và `companyId` do client chọn ⇒ mọi user đăng nhập xem được doanh thu **mọi công ty** **[ĐO]**.

**Q5. Ngưỡng nào tính là “trích xuất hàng loạt” (`export`)?**
- (a) N = 200 bản ghi/lần trả về, cộng **quota theo người/ngày**.
- (b) Số khác do anh chốt.
- **Khuyến nghị: (a) làm mặc định**, và điều quan trọng hơn con số: **trần phân trang bắt buộc trên MỌI endpoint danh sách** + giám sát **tổng lượng đọc theo người**, vì Hiến pháp cấm trích xuất hàng loạt chứ không cấm “một lần gọi to”.

**Q6. LÀN CẤM: có bổ sung cột bảo vệ nhân thân ngay đợt này?**
- (a) **Có (PR-14)** — thêm cột bảo vệ + `set_protected`/`view_protected` + deny tường minh.
- (b) Để sau, tạm chấp nhận rủi ro.
- **Khuyến nghị: (a).** Hiện `model Person` **không có cột bảo vệ nào** **[ĐO]**, nên chỉ cần biết `personId` là đọc được quan hệ gia đình và xin CCCD của **bất kỳ ai**. Nếu chọn (b), cần biện pháp tạm: khoá hai endpoint đó về đúng vai `HS_NHAN_THAN`/`DPO_DLCN`.

**Q7. Dữ liệu S2/S3 có được đưa vào công cụ AI dùng chung không (`*.ai_ingest`)?**
- (a) **Cấm tuyệt đối** với dữ liệu cá nhân và số tiền; chỉ dùng bản **đã mask** hoặc dữ liệu tổng hợp; nhân thân được bảo vệ thì cấm kể cả đã mask.
- (b) Cho phép có kiểm soát theo từng trường hợp.
- **Khuyến nghị: (a).** Đây là quyền độc lập theo Hiến pháp và có hậu quả thật vì hệ đang được phát triển bằng chính công cụ AI.

### Ưu tiên 2 — nhóm A7 (việc gì phải qua phê duyệt)

**Q8. Ai `verify` và ai `activate` cho hợp đồng và hồ sơ an táng?**
- (a) **`QL_NGHIA_TRANG` thẩm định — `GD_CONG_TY` cho hiệu lực**, và bắt buộc `verifiedBy ≠ createdBy`, `activatedBy ≠ verifiedBy`.
- (b) Gộp một ghế cho nhanh.
- **Khuyến nghị: (a).** Đây là ánh xạ **tổ chức**, AI chỉ tách được *action*; nó chặn cả bất biến “người tạo không tự thẩm định”. Kèm câu hỏi phụ: khi **ghế trống** thì xử lý sao — Gate 0 đã có gợi ý `BLOCKED_NO_APPROVER` + escalation (mục F2.5) **[ĐO]**.

**Q9. G0-A5 đã chốt dứt điểm chưa (“không công nợ, thu đủ ngay”)?**
- (a) **Chốt dứt điểm** ⇒ không tạo vai Kế toán công nợ; sau này nếu có trả góp thì mở vai riêng với mã `service.receivable.*`, **không nhét tạm vào Thu ngân**.
- (b) Chưa ⇒ giữ vai treo.
- **Khuyến nghị: xin anh xác nhận (a).** Checklist hiện ghi kèm “(chờ Bách xác nhận diễn giải)” **[ĐO]**, nên AI **không được** tự kết luận bỏ một vai.

**Q10. G0-G3.1: mốc nào sinh phân bổ mộ — `Verified`, `Active`, hay hai bước?**
- (a) `Active` (như **chú thích code đã giả định**).
- (b) Hai bước `verify` → `approve` → `activate` như taxonomy đề xuất.
- **Khuyến nghị: (b)**, và lưu ý anh: **code đã đi trước quyết định** — cần chốt chính thức để không phải sửa ngược.

**Q11. Việc cấp/thu quyền đi qua cửa nào ở Gate 1?**
- (a) **Chỉ qua migration + review Git** (Git là cửa phê duyệt tạm) — rẻ, đã có dấu vết, nhưng **không phải cửa phê duyệt nghiệp vụ**.
- (b) Xây ngay luồng `authz.change.submit` → `authz.change.approve`.
- **Khuyến nghị: (a) cho Gate 1, (b) vào backlog ngay sau đó.**

**Q12. Những hành vi nào bắt buộc **người thứ hai xác thực ngay trong giao dịch** (không chờ workflow A7)?**
- (a) `override` giá/sức chứa, `service.subscription.override`, `cemetery.plot.set_status` về `Available` khi lô đã bán, `service.transaction.adjust`.
- (b) Không làm, chờ A7.
- **Khuyến nghị: (a).** Cơ chế này **dùng được ngay** vì không cần workflow trạng thái, và nó là thứ duy nhất chặn “cấp quyền override = làm được vô hạn”.

### Ưu tiên 3 — kiến trúc phân quyền

**Q13. Xử lý `*.*.*` của vai ADMIN theo phương án nào?**
- (a) **Bỏ hẳn `*.*.*`**, thay bằng 14 vai với quyền tường minh (khuyến nghị của ma trận E.2).
- (b) Giữ wildcard nhưng bật `wildcard_exempt` cho mọi leaf S3.
- **Khuyến nghị: (a).** Sạch hơn và loại bỏ hẳn nguồn leo quyền theo thời gian (mọi mã của M6, M7… tự chảy vào ADMIN). Nếu chọn (b) thì phải nhớ đó là **thay đổi phá vỡ** và phải sửa `permissionMatches` để cột đó có tác dụng thật.

**Q14. Chốt đúng ba scope `GROUP` / `COMPANY` / `SITE` và CHẶN `SELF`(hẹp) / `ASSIGNED` / `DEPARTMENT` / `CUSTOM`?**
- (a) **Chốt 3 scope**, chặn phần còn lại ở tầng validate seed, và **định nghĩa lại `GROUP` = “không giới hạn bản ghi”**.
- (b) Giữ mở cả 6 như enum hiện tại.
- **Khuyến nghị: (a).** Scope khai mà không thực thi khiến người duyệt **tưởng đã có kiểm soát**.

**Q15. `SITE` (nghĩa trang) có đúng là đơn vị phạm vi nhỏ nhất nghiệp vụ cần?**
- (a) Nhân viên gắn với **một** nghĩa trang ⇒ `SITE` là đủ.
- (b) Có người phụ trách **nhiều nghĩa trang không liền nhau** ⇒ cần **cụm phạm vi** kiểu Hub của OPERA (bảng gán phạm vi độc lập với vai).
- **Khuyến nghị: hỏi thực tế vận hành.** Nếu (b) thì phải làm bảng gán phạm vi ở PR-10, đừng sinh thêm cấp vai.

**Q16. Đổi tên 4 mã quyền hiện hữu ngay bây giờ?**
- (a) **Đổi ngay** — chi phí đúng 4 decorator + `seed.ts`, và sẽ tăng theo số route.
- (b) Giữ nguyên.
- **Khuyến nghị: (a).** Riêng `cemetery.contract.activate` là nguy hiểm nếu để nguyên: wildcard `cemetery.*.*` cấp cho vai nghĩa trang sẽ **trùm luôn quyền cho hiệu lực hợp đồng**.

---

*Đây là **NHÁP PHÂN TÍCH** do AI soạn, **chưa phải quyết định và chưa có hiệu lực**. Nó chỉ trở thành căn cứ khi người có thẩm quyền đánh giá ĐẠT, cho hiệu lực và cấp `decision_id`; trước đó mọi mã quyền, vai và scope ở đây là đề xuất. Hồ sơ cần bổ sung **số phiên** (List SO-LAY-PHIEN) trước khi trình, và mọi thay đổi trên `authz.roles` / `permissions` / `role_permissions` / `role_assignments` / `scope_policies` phải phát sinh audit event (ai yêu cầu · commit/nguồn · công cụ · cho ai).*