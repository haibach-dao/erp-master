-- Bỏ HẲN `*.*.*` (G0-Q13): xoá grant và xoá cả dòng trong danh mục.
--
-- Bỏ khỏi danh mục chứ không chỉ bỏ khỏi vai: mã còn trong danh mục là mã còn cấp lại
-- được từ màn hình quản trị, và một lần cấp lại là xoá sạch ý nghĩa của việc bỏ nó.
--
-- TỰ BẢO VỆ: nếu có vai nào đang chỉ dựa vào `*.*.*` mà không có mã tường minh nào, thì
-- xoá wildcard sẽ làm vai đó RỖNG. Trường hợp đó migration DỪNG và bảo chạy seed trước.
DO $$
DECLARE
  unsafe_roles TEXT;
BEGIN
  SELECT string_agg(DISTINCT r.code, ', ') INTO unsafe_roles
  FROM authz.roles r
  JOIN authz.role_permissions rp ON rp.role_id = r.id
  JOIN authz.permissions p ON p.id = rp.permission_id AND p.code = '*.*.*'
  WHERE NOT EXISTS (
    SELECT 1
    FROM authz.role_permissions rp2
    JOIN authz.permissions p2 ON p2.id = rp2.permission_id
    WHERE rp2.role_id = r.id AND p2.code <> '*.*.*'
  );

  IF unsafe_roles IS NOT NULL THEN
    RAISE EXCEPTION
      'Dừng: vai % chỉ có `*.*.*` và không có mã tường minh nào — xoá wildcard sẽ làm vai đó rỗng. Chạy `pnpm --filter @erp/api db:seed` trước, rồi migrate lại.',
      unsafe_roles;
  END IF;

  DELETE FROM authz.role_permissions
  WHERE permission_id IN (SELECT id FROM authz.permissions WHERE code = '*.*.*');

  DELETE FROM authz.permissions WHERE code = '*.*.*';

  /* Dọn luôn mã SAI SỐ ĐOẠN.
   *
   * `permissionMatches` so số đoạn, nên mã không đúng 3 đoạn (ví dụ `audit.view` của lần
   * hỏng cũ) khớp RỖNG với mọi thứ. Nó vô hại khi nằm im, nhưng nó vẫn CẤP ĐƯỢC từ màn
   * hình quản trị — và cấp nó cho một vai là tạo ra một vai bị 403 im lặng, cực khó chẩn
   * đoán. Danh mục đóng thì không được chứa mã không thể khớp. */
  DELETE FROM authz.role_permissions
  WHERE permission_id IN (
    SELECT id FROM authz.permissions
    WHERE array_length(string_to_array(code, '.'), 1) <> 3
  );

  DELETE FROM authz.permissions
  WHERE array_length(string_to_array(code, '.'), 1) <> 3;
END $$;
