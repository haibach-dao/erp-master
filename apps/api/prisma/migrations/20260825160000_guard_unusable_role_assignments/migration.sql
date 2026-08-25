-- CỔNG CHẶN DEPLOY, không phải thay đổi cấu trúc.
--
-- Từ bản này, `company_id` không còn do client khai: người gọi phải ĐƯỢC GÁN công ty,
-- trừ khi vai của họ có phạm vi GROUP (không giới hạn bản ghi). Nghĩa là mọi dòng gán
-- vai với `company_id = NULL` mà vai KHÔNG có grant nào ở phạm vi GROUP sẽ trở thành
-- một dòng vô dụng: người đó giữ vai nhưng bị từ chối ở mọi request, và giao diện
-- không giải thích được vì sao.
--
-- Trước đây chỗ này chỉ được canh bằng một script mà ai đó phải NHỚ chạy trước khi
-- deploy. Đây là cùng phép kiểm đó, đặt vào đúng chỗ không ai quên được.
--
-- GẶP LỖI NÀY THÌ LÀM GÌ:
--   1. Xem chi tiết:  pnpm --filter @erp/api exec tsx scripts/authz-scope-check.ts
--   2. Với từng dòng, chọn MỘT trong hai:
--      a. Gán công ty:  UPDATE authz.role_assignments SET company_id = '<id>' WHERE id = '<row>';
--      b. Thu hồi vai:  UPDATE authz.role_assignments SET valid_to = now()   WHERE id = '<row>';
--   3. Chạy lại migration.
-- KHÔNG xoá đoạn kiểm này để deploy cho xong — nó đang nói rằng có người sắp mất quyền.
DO $$
DECLARE
  broken_count INT;
BEGIN
  SELECT count(*) INTO broken_count
  FROM authz.role_assignments ra
  WHERE ra.company_id IS NULL
    AND (ra.valid_to IS NULL OR ra.valid_to > now())
    AND NOT EXISTS (
      SELECT 1
      FROM authz.role_permissions rp
      WHERE rp.role_id = ra.role_id
        AND coalesce(ra.scope, rp.scope) = 'GROUP'
    );

  IF broken_count > 0 THEN
    RAISE EXCEPTION
      'Dừng deploy: % dòng gán vai có company_id = NULL nhưng vai không có phạm vi GROUP. Những người này sẽ MẤT QUYỀN. Chạy scripts/authz-scope-check.ts để xem chi tiết, gán công ty hoặc thu hồi vai, rồi chạy lại.',
      broken_count;
  END IF;
END $$;
