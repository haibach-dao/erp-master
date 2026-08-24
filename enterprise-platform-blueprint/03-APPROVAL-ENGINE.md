# 3. Approval engine dùng chung

## Thành phần

```text
Workflow Definition → Workflow Version → Steps → Approver Resolver → Approval Instance → Actions
```

Approver resolver là quy tắc tìm người duyệt, không phải user cố định:

- `DIRECT_MANAGER`
- `DEPARTMENT_HEAD`
- `POSITION_HOLDER`
- `ROLE_HOLDER`
- `COMPANY_DIRECTOR`
- `BUDGET_OWNER`
- `SPECIFIC_USER` (chỉ dùng khi thực sự cần)

## Yêu cầu tối thiểu

- Duyệt tuần tự và song song.
- Điều kiện theo số tiền, loại yêu cầu, công ty, phòng ban hoặc rủi ro.
- Approve, reject, return for revision, cancel.
- SLA, nhắc việc, escalation.
- Ủy quyền có thời hạn.
- Không cho người tạo tự duyệt.
- Lưu người duyệt thực tế, lý do và thời điểm.

## Trạng thái chung

```text
DRAFT → SUBMITTED → IN_REVIEW → APPROVED | REJECTED | RETURNED | CANCELLED | EXPIRED
```

## Điều kiện nghiệm thu

1. Mỗi yêu cầu xác định đúng workflow theo `request type + company + department + context`.
2. Thay trưởng phòng không làm thay đổi người duyệt của yêu cầu đang chạy; yêu cầu mới dùng cơ cấu mới.
3. Không thể duyệt hai lần cùng một bước và không thể duyệt khi đã quá trạng thái.
4. Mọi action đều có audit và notification.

