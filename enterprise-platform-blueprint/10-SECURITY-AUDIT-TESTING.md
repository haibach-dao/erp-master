# 10. Bảo mật, audit, check log và kiểm thử

## 1. Phân biệt ba loại log

Không dùng một bảng log duy nhất cho mọi mục đích. Cần có ba luồng riêng:

| Loại | Mục đích | Ví dụ | Ai được xem |
|---|---|---|---|
| **Audit trail** | Truy vết thay đổi nghiệp vụ/pháp lý | Ai đổi người đại diện hợp đồng, từ giá nào sang giá nào | Người có quyền audit theo scope |
| **Security log** | Phát hiện và điều tra rủi ro an ninh | Đăng nhập lỗi, truy cập chéo công ty, nâng quyền, tải file nhạy cảm | Security admin, auditor |
| **System/technical log** | Vận hành và chẩn đoán lỗi kỹ thuật | API lỗi, job hết hạn hold không chạy, timeout object storage | IT vận hành |

Audit trail **không được thay thế bằng application log**. Application log có thể xoay vòng; audit trail phải lưu được lịch sử đủ lâu và người dùng không thể sửa/xóa thông thường.

## 2. Những sự kiện bắt buộc phải audit

### Identity, quyền và tổ chức

- Đăng nhập thành công/thất bại, logout, reset mật khẩu, thay đổi MFA.
- Tạo/khóa/xóa mềm user.
- Cấp, thu hồi, thay đổi role, permission, scope, position, organizational context.
- Thay đổi cơ cấu tập đoàn/công ty/phòng ban hoặc người phụ trách.
- Tạo, sửa, thu hồi ủy quyền và thời hạn ủy quyền.

### Approval workflow

- Tạo, submit, approve, reject, return, cancel yêu cầu.
- Thay đổi workflow definition, điều kiện, approver resolver và version workflow.
- Hệ thống resolve ai là approver, dựa vào context/quy tắc nào.
- Escalation, nhắc việc, quá SLA và hành động của người được ủy quyền.

### Quản lý mộ và khách hàng

- Tạo/sửa/khóa/merge khách hàng; phải ghi cả bản ghi nguồn và bản ghi đích khi merge.
- Tạo, xác nhận, đóng hoặc sửa quan hệ gia đình; phải ghi cả quan hệ gốc và quan hệ đối ứng tự sinh.
- Xem hoặc tải thông tin giấy tờ nhạy cảm.
- Tạo/giải phóng/đổi hạn giữ chỗ.
- Chuyển trạng thái mộ: Available, Held, Allocated, Occupied, Maintenance, Locked.
- Tạo/sửa/submit/duyệt/ký/hủy hợp đồng; thay đổi giá, bên ký, vị trí mộ hoặc thời hạn.
- Allocate/release một vị trí mộ.
- Tạo/xác minh/hoàn tất/hủy hồ sơ an táng.
- Upload/xác minh/thay thế hợp đồng ngoài hệ thống; sinh, điều chỉnh, import thanh toán và chuyển trạng thái khoản phải thu.
- Tạo, gia hạn, tạm dừng, hủy hoặc thay đổi giá/thời hạn dịch vụ chăm sóc mộ; mọi reminder gửi ra cũng phải truy vết được.

### File và export

- Upload, thay file, xóa file, tải file, chia sẻ file.
- Quét virus thất bại, file bị chặn, signed URL được cấp.
- Export danh sách khách hàng/hợp đồng/dữ liệu nhạy cảm, gồm filter đã dùng và số bản ghi xuất.

## 3. Cấu trúc audit event

Audit được ghi theo mô hình event append-only. Một audit event không bị `UPDATE` hoặc `DELETE` bởi tài khoản ứng dụng thông thường.

```text
audit_events
├── id                       UUID/ULID
├── occurred_at              thời điểm UTC
├── tenant_id / company_id   ngữ cảnh tổ chức
├── actor_type               USER | SYSTEM | SERVICE | IMPERSONATION
├── actor_id                 ai thực hiện
├── effective_context_id     context đang dùng
├── action                   CUSTOMER.MERGED / GRAVE.HELD / APPROVAL.APPROVED...
├── entity_type              customer | grave_plot | contract | file...
├── entity_id                bản ghi bị tác động
├── parent_entity_type/id    ví dụ hợp đồng cha của allocation
├── result                   SUCCESS | DENIED | FAILURE
├── reason / comment         lý do nghiệp vụ
├── before_data              snapshot JSON đã mask
├── after_data               snapshot JSON đã mask
├── changed_fields           các trường đã đổi
├── request_id / correlation_id
├── ip_address / user_agent  dữ liệu phiên truy cập
├── source                   WEB | API | JOB | IMPORT | INTEGRATION
└── integrity_hash           hash chống chỉnh sửa trái phép
```

`before_data` và `after_data` chỉ lưu trường cần truy vết; không ghi password, refresh token, file binary, hoặc toàn bộ dữ liệu nhạy cảm không cần thiết. CCCD/giấy tờ phải được mask trong log, ví dụ `079***123`.

## 4. Chuỗi audit và tính toàn vẹn

Mỗi event tạo `integrity_hash` từ event trước đó trong cùng company/day. Điều này giúp phát hiện log bị can thiệp. Bản sao audit định kỳ được đẩy sang storage chỉ-ghi (write-once hoặc bucket có retention policy) và chỉ tài khoản audit service được quyền ghi.

Quy tắc:

1. Không chạy audit trong transaction tách rời làm mất event khi nghiệp vụ thành công.
2. Với lệnh nghiệp vụ quan trọng, ghi audit cùng transaction hoặc theo transactional outbox có cơ chế retry/idempotency.
3. Nếu không ghi được audit cho thao tác bắt buộc, transaction nghiệp vụ phải thất bại hoặc vào hàng đợi retry có cảnh báo mức cao.
4. Không cho phép người thao tác chọn tắt audit.

## 5. Màn hình "Audit & Check Log"

Màn hình này là màn hình riêng, không trộn với timeline thông thường.

### Bộ lọc

- Khoảng thời gian; mặc định 30 ngày gần nhất.
- Công ty, phòng ban, khu nghĩa trang, module.
- Người thực hiện, người bị tác động, context.
- Hành động, loại đối tượng, mã bản ghi.
- Kết quả: thành công, bị từ chối, lỗi.
- IP, nguồn thao tác: web/API/job/import.
- Chỉ hiển thị `sensitive access` hoặc `permission changes`.

### Danh sách log

| Thời điểm | Ai | Context | Hành động | Đối tượng | Kết quả | Chi tiết |
|---|---|---|---|---|---|---|
| 08:45 | Nguyễn A | IT / CNTT | `GRAVE.HELD` | Mộ A-01-12 | Thành công | Khách hàng KH-0001; hết hạn 17:00 |
| 09:00 | Trần B | Sales / Kinh doanh | `CONTRACT.PRICE_CHANGED` | HD-2026-001 | Thành công | 120tr → 115tr; lý do giảm giá |
| 09:12 | System | Job | `HOLD.EXPIRED` | Mộ A-01-12 | Thành công | Hết hạn giữ chỗ |
| 09:15 | Lê C | CSKH | `DOCUMENT.DOWNLOADED` | Giấy chứng tử | Bị từ chối | Không có quyền xem dữ liệu restricted |

### Trang chi tiết event

- Ai thực hiện, đang dùng context nào và có quyền nào.
- Bản ghi liên quan, link mở bản ghi nếu còn quyền.
- Giá trị trước/sau dạng diff, không phải JSON thô mặc định.
- Lý do, file/liên kết liên quan, IP, thiết bị, correlation ID.
- Chuỗi event liên quan: tạo → submit → duyệt → ký → allocate.
- Nút export audit chỉ dành cho auditor và luôn tạo audit event mới.

### Timeline tại từng bản ghi

Ở trang Customer 360, Hợp đồng, Vị trí mộ và Hồ sơ an táng có timeline rút gọn. Nó chỉ hiển thị event mà người xem được quyền thấy. Audit screen đầy đủ vẫn là nguồn kiểm tra chính thức.

## 6. Phân quyền xem log

| Vai trò | Được xem |
|---|---|
| Người dùng thường | Timeline bản ghi trong scope, không xem IP/technical details |
| Trưởng phòng | Event nghiệp vụ của phòng trong scope, dữ liệu đã mask |
| Compliance/Auditor | Audit nghiệp vụ và security event thuộc company/group được cấp |
| Security admin | Security log, permission changes, denied access; không mặc định xem nội dung hợp đồng nhạy cảm |
| System operator | System logs, không mặc định xem dữ liệu nghiệp vụ hoặc PII |

Không cấp `audit.view_all` cho admin hệ thống mặc định. Quyền vận hành kỹ thuật và quyền xem dữ liệu nghiệp vụ nhạy cảm nên tách nhau.

## 7. Retention và backup

Đề xuất ban đầu, cần xác nhận lại theo quy định pháp lý/nội quy của doanh nghiệp:

| Dữ liệu | Thời hạn khuyến nghị | Cách xử lý |
|---|---|---|
| Audit hợp đồng/mộ/approval | Tối thiểu 10 năm hoặc theo thời hạn hồ sơ pháp lý | Immutable archive + backup |
| Security log | 1–3 năm | Searchable storage rồi archive |
| System log thường | 90–180 ngày | Rotation và archive lỗi quan trọng |
| Download/export log | Cùng thời hạn audit | Gắn với audit event |

Không đưa dữ liệu nhạy cảm quá mức vào technical log hoặc hệ thống theo dõi lỗi bên thứ ba.

## 8. Alert và kiểm tra định kỳ

### Cảnh báo tức thời

- Hơn 5 lần login thất bại trong một khoảng thời gian.
- Đăng nhập ở vị trí/thiết bị bất thường theo chính sách.
- Cấp `admin`, `approve`, `audit.view_all` hoặc scope `GROUP`.
- Thay đổi workflow đang hiệu lực.
- Bulk export vượt ngưỡng.
- Tải nhiều file restricted hoặc truy cập bị từ chối lặp lại.
- Job hold expiry, notification hoặc approval escalation thất bại.
- Chuỗi audit hash không hợp lệ.

### Check log định kỳ

- Hàng ngày: kiểm tra job lỗi, approval quá SLA, hold hết hạn không được giải phóng.
- Hàng tuần: rà soát quyền cấp mới, quyền hết hạn, delegation còn hiệu lực, export dữ liệu.
- Hàng tháng: audit truy cập dữ liệu nhạy cảm, user không hoạt động, thay đổi workflow và backup restore sample.
- Hàng quý: rà soát role/permission matrix với chủ sở hữu nghiệp vụ.

## 9. API và kỹ thuật ghi log

- Mỗi request có `correlation_id`; client gửi hoặc server sinh ra và trả lại trong response.
- Backend interceptor/middleware ghi request metadata, nhưng audit nghiệp vụ do service layer ghi để biết chính xác action và before/after data.
- Background job phải có `actor_type=SYSTEM`, job name và correlation id riêng.
- API tích hợp phải có `actor_type=SERVICE`, service account và phạm vi company rõ ràng.
- Không log toàn bộ request body vào system log.
- Audit query phải phân trang, index theo `company_id, occurred_at`, `entity_type, entity_id`, `actor_id` và `action`.

## 10. Kịch bản nghiệm thu audit/check log

### A1 — Truy vết giữ chỗ mộ

1. Tư vấn viên giữ chỗ mộ A-01-12 cho khách hàng KH-0001.
2. Quản lý mở Audit & Check Log, lọc theo mã mộ.
3. Hệ thống hiển thị ai tạo, thời gian, context, khách hàng, thời hạn hold và trạng thái trước/sau.
4. Khi job hết hạn chạy, event `HOLD.EXPIRED` xuất hiện và trạng thái vị trí về `Available`.

**Đạt khi:** đầy đủ chuỗi event, không sửa/xóa được từ giao diện, và nhân viên khác công ty không xem được.

### A2 — Truy vết thay đổi giá hợp đồng

1. Người dùng sửa giá hợp đồng từ 120 triệu thành 115 triệu và nhập lý do.
2. Workflow yêu cầu duyệt lại.
3. Audit hiển thị before/after, người sửa, lý do, workflow version và hành động duyệt.

**Đạt khi:** không thể sửa giá trực tiếp sau khi submitted/approved mà không tạo revision/audit; diff hiển thị chính xác.

### A3 — Kiểm tra truy cập trái phép

1. User công ty A cố gọi API xem hồ sơ hợp đồng restricted của công ty B.
2. Backend trả 403, không trả metadata của hồ sơ.
3. Security log ghi `ACCESS.DENIED`, actor, endpoint, scope, company target và correlation id.

**Đạt khi:** thao tác bị chặn ở backend và auditor/security admin truy vết được sự kiện mà không lộ nội dung nhạy cảm.

### A4 — Kiểm tra file nhạy cảm

1. User có quyền tải giấy chứng tử của một hồ sơ an táng.
2. Hệ thống tạo signed URL ngắn hạn, ghi `DOCUMENT.DOWNLOADED`.
3. User không có quyền gọi lại endpoint bị từ chối và cũng được ghi `ACCESS.DENIED`.

**Đạt khi:** không có URL vĩnh viễn; tải file và từ chối tải đều truy vết được.

### A5 — Kiểm tra thay đổi quyền

1. Admin cấp role Approver cho một user trong phòng CNTT với thời hạn 30 ngày.
2. Log hiển thị người cấp, quyền trước/sau, scope, lý do và thời hạn.
3. Hết thời hạn, hệ thống tự thu hồi quyền và tạo audit event.

**Đạt khi:** không có quyền cấp vô thời hạn ngoài trường hợp đã được phê duyệt; context/phạm vi được hiển thị rõ.

## 11. Kiểm thử bắt buộc

- Unit test cho audit event builder, masking và integrity hash.
- Integration test: nghiệp vụ thất bại không tạo audit success; nghiệp vụ thành công có đúng audit event.
- E2E: customer → hold → contract → approval → allocation → burial record; tất cả event nối theo correlation id.
- Security test: user vượt scope, link file hết hạn, export trái quyền, truy cập API trực tiếp.
- Load test audit query cho tối thiểu số bản ghi dự kiến trong 12 tháng.
- Restore test: khôi phục backup audit và kiểm tra integrity chain.

## 12. Điều kiện nghiệm thu tổng thể

1. 100% hành động nghiệp vụ critical trong danh mục trên tạo audit event.
2. Không user nghiệp vụ nào sửa/xóa được event lịch sử.
3. Bản ghi audit luôn có actor, thời gian, action, entity, company/context và kết quả.
4. Event thay đổi có before/after hoặc changed fields đúng thực tế; dữ liệu nhạy cảm được mask.
5. Audit screen lọc, phân trang, xem diff và export đúng quyền.
6. Ít nhất năm kịch bản A1–A5 được UAT ký đạt.
7. Có alert cho thay đổi quyền, workflow, lỗi job quan trọng và truy cập bị từ chối đáng ngờ.
8. Có biên bản kiểm tra backup/restore và kiểm tra integrity log.
