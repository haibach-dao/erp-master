# 8. Dashboard và báo cáo

Dashboard phải theo context và scope. Dashboard mộ/khách hàng giai đoạn đầu gồm: khách mới, hold sắp hết hạn, mộ theo trạng thái, hợp đồng sắp hết hạn, hồ sơ thiếu giấy tờ, lịch an táng, dịch vụ sắp hết hạn, dịch vụ đã hết hạn, doanh thu dự kiến, đã thu, còn phải thu và khoản quá hạn.

Dashboard doanh thu cần lọc theo ngày/tháng/quý/năm/khoảng tùy chọn, công ty, khu mộ, loại mộ, khách hàng, loại khoản thu và trạng thái. `Expected revenue` (theo lịch phải thu) phải tách hoàn toàn với `Collected revenue` (thanh toán đã xác nhận).

Nghiệm thu: số KPI có thể drill-down về bản ghi gốc; filter không làm lộ dữ liệu ngoài scope; export có watermark/audit khi cần.
