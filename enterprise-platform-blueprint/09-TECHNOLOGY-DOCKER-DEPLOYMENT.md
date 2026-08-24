# 9. Công nghệ và triển khai

Stack khuyến nghị: Next.js/TypeScript cho web, NestJS/TypeScript cho API, PostgreSQL, Redis, object storage tương thích S3 (MinIO local), Docker Compose. API phải có OpenAPI; migration và seed là bắt buộc.

Docker Compose local gồm: web, api, PostgreSQL, Redis, MinIO, Mailpit. Production ban đầu bổ sung reverse proxy, backup, TLS, monitoring và tách secret ra khỏi mã nguồn.

Nghiệm thu: một máy sạch chạy được toàn bộ stack qua tài liệu hướng dẫn; backup/restore có kiểm chứng; migration chạy lặp lại an toàn.

