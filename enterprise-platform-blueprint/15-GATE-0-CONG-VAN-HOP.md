# Công văn / Nghị trình họp Gate 0

> Trạng thái: **NHÁP để anh gửi** · Kèm theo: `13-GATE-0-CHECKLIST-MOT-TRANG.md` (bảng quyết định) · Bối cảnh: `11-...` (tổng hợp) + `04-...` (quản lý mộ)
> Nguyên tắc (hiến pháp INDEVCO): đây là tài liệu phân tích; **biên bản họp có số phiên + quyết định được phê duyệt mới là nguồn sự thật**. Mỗi quyết định chỉ "đã chốt" khi có `decision_id`.

## 1. Vì sao họp bây giờ
Nền tảng kỹ thuật (định danh, phân quyền, phê duyệt-nền, audit, file, worker, khung web/api) **đã hoàn tất và kiểm thử** (Wave 2, đã merge vào `main`). Toàn bộ **domain tạo giá trị** (quản lý mộ, khách hàng, hợp đồng, dịch vụ, doanh thu) **đang bị chặn có chủ đích** — không dựng bảng/nghiệp vụ nào cho tới khi các quyết định nghiệp vụ được chốt. Gate 0 là **cửa mở khóa** để bắt đầu domain mà không phải đoán và không phải đập đi làm lại.

## 2. Mục tiêu cuộc họp (đầu ra bắt buộc)
- Trả lời dứt điểm các mục **[HỎI]** trong bảng file 13, tối thiểu nhóm **A (Gate 0)**.
- Mỗi dòng: có **quyết định** + **chủ trả lời** + **hạn** (nếu chưa chốt được) + **decision_id**.
- Biên bản có **số phiên** (lấy ở List SO-LAY-PHIEN trước khi bắt đầu).

## 3. Thành phần dự họp (đề xuất theo vai trò — anh gán người thật)
| Vai trò | Vì sao cần | Quyết định liên quan |
|---|---|---|
| Chủ nghiệp vụ quản lý mộ | Chủ các quyết định nghiệp vụ | A1, A2, A3, A4, A7, IMP |
| Kế toán / Doanh thu | Nguồn "đã thu", chu kỳ thu | A4, A5 |
| Phụ trách tuân thủ / pháp chế | NĐ13, dữ liệu nhạy cảm, lưu trú | A6, E5.1, E5.2, (Gate Prod) |
| IT/Kỹ thuật (lead = Claude điều phối) | Ảnh hưởng ERD, thời gian, import | E5.1, G1, G3.1, IMP |
| Người có thẩm quyền phê duyệt vào main | Cho hiệu lực quyết định | Tất cả |

## 4. Thứ tự ưu tiên trong họp (nếu thiếu thời gian, chốt theo thứ tự này)
1. **A2** — quyền sử dụng mộ (vĩnh viễn/có hạn/chuyển nhượng-thừa kế): rủi ro ERD cao nhất.
2. **A6 + E5.2** — ai xem dữ liệu nhạy cảm + mã hóa/băm định danh: pháp lý NĐ13.
3. **A5 + A4** — nguồn "đã thu" + danh mục dịch vụ/giá/chu kỳ: lõi doanh thu.
4. **E5.1** — Person/Customer đa công ty hay tách: định hình toàn bộ quan hệ dữ liệu.
5. **G1, G3.1, A1, A3, A7, IMP** — còn lại.

## 5. Chuẩn bị trước khi họp (gửi kèm)
- Đọc **file 13** (bảng quyết định một trang) + cột **Khuyến nghị nháp** (đã có sẵn phương án đề xuất cho từng câu).
- Tham chiếu nhanh: doc **04** (quản lý mộ) và **11 §16** (danh sách quyết định gốc).

## 6. Sau họp
- Điền `decision_id` + số phiên vào file 13; đó là tín hiệu để đội kỹ thuật (Claude điều phối) **bắt đầu dựng domain M0/M1** trên nền đã có.
- Các mục thuộc **Gate UAT dữ liệu thật** và **Gate Prod** (RPO/RTO, break-glass, manifest ký, nơi lưu trú dữ liệu) chốt sau, trước UAT-dữ-liệu-thật / go-live tương ứng — không chặn việc bắt đầu code domain.

---
*Nhắc: AI chỉ soạn nháp và điều phối; chỉ người có thẩm quyền cho hiệu lực. Không có decision_id = chưa chốt.*
