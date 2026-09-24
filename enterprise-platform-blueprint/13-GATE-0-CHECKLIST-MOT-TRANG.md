# Gate 0 — Checklist quyết định trước khi finalize ERD & code

> Trạng thái: **ĐÃ CHỐT nhóm lõi (2026-08-24)** · Quyết bởi: **Bách** (người có thẩm quyền) · Cố vấn/ghi: Claude
> Nguồn phân tích: hồ sơ `12-HO-SO-HOP-VA-PHAN-BIEN.md` (vòng A–J)

## ✅ KẾT QUẢ CHỐT (2026-08-24, Bách quyết)

| decision_id | Mục | Quyết định |
|---|---|---|
| G0-A2 | Quyền sử dụng mộ | Tạo `grave_usage_right` tối thiểu (tách khỏi hợp đồng); CHƯA làm chuyển nhượng/thừa kế (chừa đường) |
| G0-A1 | Sức chứa mộ | Mặc định theo loại mộ; cho override từng vị trí, có audit |
| G0-A5 | "Đã thu" / doanh thu | **KHÔNG công nợ** — khách thanh toán đủ ngay; doanh thu tự ghi từ hoạt động dịch vụ trong hệ thống; KHÔNG import kế toán ngoài. → Bỏ `receivable_schedule`, thay bằng `service_transaction` + thanh toán đủ *(chờ Bách xác nhận diễn giải)* |
| G0-E5.1 | Person đa công ty | Dùng chung xuyên công ty; xem/sửa theo scope |
| G0-A6 | Dữ liệu nhạy cảm | Mặc định mask; xem đầy đủ cần vai trò được cấp + mọi lần xem/tải đều audit (NĐ13) |
| G0-E5.2 | Định danh CCCD | Mã hoá (xem lại được có quyền, mask hiển thị) + băm để dò trùng |
| G1 | Mô hình thời gian | `timestamptz` cho instant; `@db.Date` (lịch VN) cho ngày nghiệp vụ |

**Còn hoãn (chốt khi tới M3+/M5, không chặn M0/M1):** A3 (bên thanh toán khi đổi chủ), A4 (danh mục dịch vụ + giá + kỳ hạn + mốc nhắc), A7 (workflow đầu tiên), G3.1 (mốc trạng thái hợp đồng sinh allocation), IMP (có import dữ liệu cũ không).

---

## A. GATE 0 — phải chốt để bắt đầu code nền tảng
Cần chủ nghiệp vụ + phụ trách tuân thủ. Đây là các quyết định định hình ERD, phân quyền và workflow.

| Mã | Câu hỏi cần chốt | Khuyến nghị nháp | Chủ trả lời | Hạn | decision_id | Trạng thái |
|---|---|---|---|---|---|---|
| A2 | Quyền sử dụng mộ: vĩnh viễn/có hạn/tùy hợp đồng? Có chuyển nhượng & thừa kế? | Tạo `grave_usage_right` tối thiểu ngay; chưa xây workflow chuyển nhượng | | | | ☐ |
| A4 | Danh mục dịch vụ, công thức giá, chu kỳ thu, mốc nhắc hạn thật | Giữ nhắc 90/60/30/7 mặc định, cấu hình theo gói; giá snapshot khi đăng ký | | | | ☐ |
| A5 | Nguồn "đã thu": import kế toán / nhập tay có duyệt / API? | Import là nguồn chính; nhập tay là ngoại lệ có duyệt + bằng chứng | | | | ☐ |
| A6 | Ai được xem/tải CCCD, giấy chứng tử, giá HĐ, file nhạy cảm? | Mặc định deny restricted; cấp theo scope tối thiểu có thời hạn | | | | ☐ |
| E5.1 | Person/Customer dùng chung giữa các công ty hay tách theo công ty? | Person xuyên công ty; quyền xem/sửa theo scope; chốt trước khi vẽ ERD | | | | ☐ |
| E5.2 | Trường định danh nào mã hóa (xem lại được) vs chỉ băm (dò trùng)? | Field cần đối chiếu → mã hóa (KMS); field chỉ dò trùng → băm | | | | ☐ |
| G1 | Mô hình thời gian: instant vs ngày nghiệp vụ vs giờ hẹn | `timestamptz` cho instant; kiểu `date` theo lịch VN cho due/effective/expiry | | | | ☐ |
| G3.1 | Mốc trạng thái hợp đồng nào sinh allocation & đủ điều kiện M5: Verified / Active / hai bước? | Chọn 1 mốc rõ để tránh allocate/công nợ trùng | | | | ☐ |
| F2.4 | Policy context: bắt buộc chọn tường minh khi user có nhiều context? | Bắt chọn, không tự mặc định context gần nhất | | | | ☐ |
| F2.5 | Policy khi không resolve được người duyệt (ghế trống)? | Trạng thái `BLOCKED_NO_APPROVER` + escalation, giữ segregation of duties | | | | ☐ |
| IMP | Có import dữ liệu lịch sử (cũ) vào hệ thống không? | Chốt có/không (ảnh hưởng thiết kế khóa dò trùng); *cách* import thuộc cửa sau | | | | ☐ |
| A1 | Sức chứa mộ theo từng loại? | Mặc định theo loại, cho override từng vị trí có audit | | | | ☐ |
| A3 | Bên thanh toán khi chủ mộ mất/đổi đại diện/chuyển nhượng? | Trường payer trên HĐ/đăng ký, đổi bằng revision có audit | | | | ☐ |
| A7 | Workflow làm trước? | (1) duyệt giảm/điều chỉnh giá HĐ + (2) gia hạn dịch vụ | | | | ☐ |

## B. GATE UAT DỮ LIỆU THẬT — chỉ khi UAT dùng bản sao dữ liệu lịch sử/PII được phê duyệt
Nếu UAT chỉ dùng dữ liệu tổng hợp → bỏ qua cửa này (lùi về Gate Prod). Cần IT + tuân thủ + owner nghiệp vụ.

| Mã | Việc phải hoàn tất & kiểm thử đạt trước UAT | Chủ trả lời | Hạn | decision_id | Trạng thái |
|---|---|---|---|---|---|
| U1 | Import batch: raw bất biến, mapping version hóa, dry-run, quarantine lỗi | | | | ☐ |
| U2 | Mask PII đúng quyền trong môi trường UAT | | | | ☐ |
| U3 | Đối soát tổng số bản ghi/tổng tiền trước–sau import | | | | ☐ |
| U4 | Đường rollback theo import batch, import idempotent | | | | ☐ |
| U5 | Phê duyệt dùng dữ liệu thật cho UAT (tuân thủ NĐ13) | | | | ☐ |

## C. GATE PROD — trước go-live / nhận dữ liệu thật (mốc nào đến trước)
Chủ yếu IT/vận hành + owner ký ngưỡng.

| Mã | Việc phải chốt & kiểm thử đạt | Chủ trả lời | Hạn | decision_id | Trạng thái |
|---|---|---|---|---|---|
| P1 | RPO/RTO (mất tối đa bao nhiêu dữ liệu / khôi phục trong bao lâu) | | | | ☐ |
| P2 | Restore nhất quán chéo kho PostgreSQL ↔ MinIO ↔ audit manifest | | | | ☐ |
| P3 | Xoay khóa signed-URL/secret sau restore | | | | ☐ |
| P4 | Bootstrap RBAC + tài khoản break-glass (MFA, có hạn, alert, hậu kiểm) | | | | ☐ |
| P5 | Manifest ký/niêm phong chuỗi audit định kỳ (write-once) | | | | ☐ |
| P6 | Nơi lưu trú dữ liệu cá nhân (MinIO + backup) theo NĐ13 | | | | ☐ |
| P7 | Retention audit thật (đối chiếu quy định pháp lý ngành) | | | | ☐ |

---

**Nguyên tắc chốt (hiến pháp INDEVCO):** AI chỉ soạn nháp; chỉ người có thẩm quyền cho hiệu lực. Mỗi dòng chỉ coi là "đã chốt" khi có `decision_id`. Biên bản họp có số phiên là nguồn sự thật; file này là bản chiếu.
