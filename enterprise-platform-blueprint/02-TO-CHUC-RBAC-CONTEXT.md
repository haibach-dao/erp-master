# 2. Tổ chức, RBAC và organizational context

## Mô hình tổ chức

```text
Tập đoàn → Công ty → Chi nhánh (nếu có) → Phòng ban → User
```

User có một **primary position assignment** và có thể có nhiều **role assignment** theo tổ chức và thời hạn.

## Organizational context

Context là tổ hợp: `user + role hoặc position + organization unit + business domain + phạm vi quyền`.

Ví dụ ông A có hai context:

| Context | Nghiệp vụ | Scope | Luồng |
|---|---|---|---|
| Chuyên viên CNTT / Phòng CNTT | Mua sắm thiết bị | Phòng CNTT | Phụ trách CNTT → Giám đốc |
| Tuyển dụng / Phòng HCNS | Tuyển dụng | Phòng HCNS | Trưởng phòng HCNS → Giám đốc |

Context phải được snapshot vào bản ghi lúc tạo để thay đổi nhân sự về sau không làm sai lịch sử.

## Permission

Định danh quyền dạng `module.resource.action`, ví dụ:

```text
cemetery.customer.view
cemetery.customer.create
cemetery.contract.submit
cemetery.contract.approve
purchase.request.create
```

Scope chuẩn: `SELF`, `ASSIGNED`, `DEPARTMENT`, `COMPANY`, `GROUP`, `CUSTOM`.

Không nên cấp quyền rải trực tiếp cho user. Ngoại lệ rất hiếm mới dùng bảng user-permission riêng, bắt buộc có ngày hết hạn và lý do.

