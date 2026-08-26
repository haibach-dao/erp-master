-- Người mất CŨNG LÀ khách hàng (quyết định chủ doanh nghiệp 26/08/2026).
--
-- Hệ được dựng theo giả định sai: "người mất là một Person, không nhất thiết là Customer".
-- Hậu quả đo được trước khi vá: 3 nhân thân đã mất, KHÔNG ai trong số họ có hồ sơ khách
-- hàng, và 2 hồ sơ an táng trỏ vào họ. Nghĩa là màn hình khách hàng không bao giờ thấy
-- người đã được an táng.
--
-- Vá bằng cách TẠO hồ sơ khách hàng cho họ, không phải xoá họ đi: hai hồ sơ an táng kia
-- là sự thật đã xảy ra, và xoá sự thật để làm sạch dữ liệu là đúng thứ nhật ký kiểm toán
-- sinh ra để ngăn.

DO $$
DECLARE
  conflicting TEXT;
  created_count INT;
BEGIN
  /* TỰ BẢO VỆ: mã khách hàng sinh từ 8 ký tự cuối của person id. Xác suất trùng với mã
   * đã có là cực nhỏ nhưng không phải không — và trùng thì lệnh INSERT sẽ chết giữa
   * chừng với một lỗi ràng buộc khó đọc. Kiểm trước, dừng với câu nói rõ vấn đề. */
  SELECT string_agg('KH-' || right(p.id, 8), ', ') INTO conflicting
  FROM cemetery.persons p
  JOIN cemetery.deceased_persons d ON d.person_id = p.id
  WHERE NOT EXISTS (SELECT 1 FROM cemetery.customers c WHERE c.person_id = p.id)
    AND EXISTS (
      SELECT 1 FROM cemetery.customers c2 WHERE c2.customer_code = 'KH-' || right(p.id, 8)
    );

  IF conflicting IS NOT NULL THEN
    RAISE EXCEPTION
      'Dừng: mã khách hàng % đã tồn tại. Sinh mã bằng tay cho các trường hợp này rồi migrate lại.',
      conflicting;
  END IF;

  INSERT INTO cemetery.customers (id, person_id, customer_code, type, status, created_at, updated_at)
  SELECT
    p.id,                      -- dùng lại person id: một người một hồ sơ, không sinh id thứ hai
    p.id,
    'KH-' || right(p.id, 8),
    'INDIVIDUAL',
    'active',                  -- `status` của Customer là trạng thái HỒ SƠ, không phải sống/mất
    now(),
    now()
  FROM cemetery.persons p
  JOIN cemetery.deceased_persons d ON d.person_id = p.id
  WHERE NOT EXISTS (SELECT 1 FROM cemetery.customers c WHERE c.person_id = p.id);

  GET DIAGNOSTICS created_count = ROW_COUNT;
  RAISE NOTICE 'Đã tạo % hồ sơ khách hàng cho người đã mất', created_count;
END $$;
