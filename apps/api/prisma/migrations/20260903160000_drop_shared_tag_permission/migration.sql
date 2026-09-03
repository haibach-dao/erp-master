-- Gỡ `config.tag.update` khỏi danh mục quyền.
--
-- MÃ NÀY CHƯA BAO GIỜ CÓ TRONG MÃ NGUỒN — đã tìm cả lịch sử git, migrations và scripts.
-- Nó vào CSDL bằng một lần `db:seed` chạy giữa chừng ngày 03/09/2026, lúc danh mục thẻ nhãn
-- còn là MỘT mã dùng chung; mô tả nó mang theo nói đúng điều đó: "Quản trị danh mục thẻ nhãn
-- (dùng chung mộ và khách)". Sau đó anh Bách chốt TÁCH làm hai danh mục riêng —
-- `config.plot_tag.update` và `config.customer_tag.update` — mã nguồn được sửa và commit,
-- còn dòng cũ thì ở lại CSDL cùng nguyên grant của nó.
--
-- VÌ SAO KHÔNG TỰ HẾT: `prisma/seed.ts` chỉ `upsert`, không bao giờ DELETE. Cửa THÊM mã tự
-- chạy, cửa GỠ mã thì phải có người viết migration. Đây là cùng một bất đối xứng đã sinh ra
-- lỗi thiếu mã người ký thẻ mộ cùng ngày, chỉ là chiều ngược lại.
--
-- MỨC NGUY HIỂM, đo chứ không đoán: hôm nay mã này KHÔNG mở cửa nào — không route nào tham
-- chiếu chuỗi `config.tag.update`. Nhưng nó là S3, `wildcard_exempt = true`, và ĐANG cấp cho
-- ADMIN|GROUP và QT_NGHIEP_VU|GROUP. Hai chỗ hỏng: nó hiện ra như một mã cấp được trên màn
-- hình ma trận quyền mà không ai tra ngược về mã nguồn được; và ngày nào có người viết một
-- route gate bằng đúng cái tên tự nhiên ấy thì hai vai đã cầm sẵn nó mà chưa ai duyệt.
--
-- Gỡ khỏi DANH MỤC chứ không chỉ gỡ khỏi vai — cùng lý do đã ghi ở
-- `20260826151000_drop_person_search_permission`: mã còn trong danh mục là mã còn cấp lại
-- được từ màn hình quản trị.

-- TỰ BẢO VỆ: nếu có vai nào đang CHỈ dựa vào mã này mà không cầm mã tường minh nào khác thì
-- gỡ nó sẽ làm vai đó RỖNG. Trường hợp đó phải DỪNG chứ không được lặng lẽ vô hiệu hoá một
-- ghế. Cùng nếp với `20260825200000_drop_wildcard_permission`.
DO $$
DECLARE
  unsafe_roles TEXT;
BEGIN
  SELECT string_agg(DISTINCT r.code, ', ') INTO unsafe_roles
  FROM authz.roles r
  JOIN authz.role_permissions rp ON rp.role_id = r.id
  JOIN authz.permissions p ON p.id = rp.permission_id AND p.code = 'config.tag.update'
  WHERE NOT EXISTS (
    SELECT 1
    FROM authz.role_permissions rp2
    JOIN authz.permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.code <> 'config.tag.update'
  );

  IF unsafe_roles IS NOT NULL THEN
    RAISE EXCEPTION
      'Dừng: vai % chỉ có `config.tag.update` và không cầm mã nào khác — gỡ mã này sẽ làm vai đó rỗng. Cấp mã thay thế (`config.plot_tag.update` / `config.customer_tag.update`) cho vai đó trước, rồi migrate lại.',
      unsafe_roles;
  END IF;
END $$;

-- Xoá GRANT trước rồi mới xoá dòng danh mục: `role_permissions.permission_id` có khoá ngoại
-- trỏ vào `permissions`, làm ngược thứ tự là vỡ ràng buộc.
DELETE FROM authz.role_permissions
WHERE permission_id IN (SELECT id FROM authz.permissions WHERE code = 'config.tag.update');

DELETE FROM authz.permissions WHERE code = 'config.tag.update';
