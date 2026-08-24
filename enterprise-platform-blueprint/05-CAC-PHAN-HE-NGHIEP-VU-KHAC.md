# 5. Các phân hệ nghiệp vụ khác

## Thứ tự sau quản lý mộ

1. Mua hàng: kiểm chứng approval theo hạn mức.
2. Đặt phòng họp: kiểm chứng booking, lịch và xung đột thời gian.
3. Đặt xe: mở rộng booking bằng tài nguyên xe/tài xế.
4. Duyệt giá: tận dụng workflow, policy và versioning.

## Tiêu chí chung

- Module phải tái sử dụng permission, file, audit, notification và approval engine.
- Không tạo bảng user/role/workflow độc lập cho từng module.
- Mỗi module có trạng thái, người chịu trách nhiệm, danh mục, dashboard và export theo quyền.

