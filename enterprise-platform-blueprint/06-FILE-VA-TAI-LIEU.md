# 6. File và tài liệu

- File nằm ở object storage; PostgreSQL chỉ lưu metadata và liên kết.
- Có giới hạn dung lượng, whitelist loại file, checksum, virus scan và signed URL.
- File có mức độ nhạy cảm: normal, confidential, restricted.
- Các bản ghi hợp đồng, hồ sơ an táng và approval action lưu file link có audit.

Nghiệm thu: người không có quyền không lấy được file bằng cách đoán URL; file nhiễm virus bị chặn; lịch sử ai upload/download được truy vết.

