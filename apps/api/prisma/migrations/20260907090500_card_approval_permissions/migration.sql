-- HAI MÃ QUYỀN CỦA CỬA PHÊ DUYỆT IN THẺ MỘ, đi bằng đường TỰ CHẠY.
--
--   cemetery.card.submit   (S2) — gửi hồ sơ xin cấp thẻ đi duyệt
--   cemetery.card.approve  (S3) — duyệt / từ chối / trả lại hồ sơ cấp thẻ
--
-- VÌ SAO PHẢI CÓ FILE NÀY: cửa XOÁ một mã đi qua `prisma migrate deploy` (tự chạy khi triển
-- khai), còn cửa THÊM một mã thì chỉ đi qua `prisma db seed` mà KHÔNG lệnh nào tự gọi. Lỗi
-- 03/09/2026 đẻ ra từ đúng khe đó và nó IM LẶNG — mã có trong danh mục TypeScript, guard vẫn
-- từ chối, màn hình rỗng không kèm một dòng lý do nào. Ratchet
-- `permission-catalog-invariants` nay ép file này phải tồn tại.
--
-- KHÔNG dùng lại `authz.change.submit` / `authz.change.approve`: cả hai đã đánh dấu deprecated
-- từ 28/08/2026, không route nào gọi và không vai nào cầm. Dựng một tính năng đang sống lên hai
-- mã đã khai tử là mời người sau xoá chúng đi cùng đợt dọn dẹp.

DO $$
DECLARE
  /* id TẤT ĐỊNH, không random — xem chú thích dài ở
   * `20260903140000_card_signer_permissions/migration.sql`. Chuỗi dưới là
   * 2026-09-07T09:00:00Z, ĐÚNG mốc trên tên thư mục migration này. */
  ulid_time  CONSTANT TEXT   := '01M1XHH1M0';
  new_codes  CONSTANT TEXT[] := ARRAY['cemetery.card.submit', 'cemetery.card.approve'];

  matrix_seeded BOOLEAN;
  kd_scope      TEXT;
  ql_scope      TEXT;
  orphan_codes  TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM authz.role_permissions) INTO matrix_seeded;

  ---------------------------------------------------------------------------
  -- 1) Hai dòng danh mục. Mô tả / sensitivity / wildcard_exempt chép TRÙNG KHÍT
  --    `PERMISSION_CATALOG`; lệch thì lần `db:seed` sau UPDATE đè lại và sinh ra một cặp giá
  --    trị nhấp nháy không ai giải thích được. `wildcard_exempt` = (sensitivity = 'S3').
  --    KHÔNG chạm `reviewed_at`.
  ---------------------------------------------------------------------------
  INSERT INTO authz.permissions (id, code, description, sensitivity, wildcard_exempt, introduced_in)
  VALUES
    (ulid_time || substr(upper(md5('cemetery.card.submit')), 1, 16),
     'cemetery.card.submit',
     'Gửi hồ sơ xin cấp thẻ mộ đi duyệt',
     'S2', false, 'gate-1'),
    (ulid_time || substr(upper(md5('cemetery.card.approve')), 1, 16),
     'cemetery.card.approve',
     'Duyệt hồ sơ cấp thẻ mộ',
     'S3', true, 'gate-1')
  ON CONFLICT DO NOTHING;

  ---------------------------------------------------------------------------
  -- 2) Ai cầm `cemetery.card.submit` — SUY TỪ `cemetery.card.print`.
  --
  -- Ai đang được CẤP THẺ thì phải GỬI DUYỆT được, nếu không cửa phê duyệt biến chính họ
  -- thành người không làm được việc cũ của mình. Suy từ dữ liệu sống nên phạm vi tự khớp với
  -- CSDL đang chạy, không bị áp phạm vi của máy người viết migration.
  ---------------------------------------------------------------------------
  INSERT INTO authz.role_permissions (id, role_id, permission_id, scope)
  SELECT ulid_time || substr(upper(md5(r.code || '|' || tgt.code)), 1, 16),
         r.id,
         tgt.id,
         src.scope
  FROM authz.role_permissions src
  JOIN authz.permissions ref ON ref.id = src.permission_id AND ref.code = 'cemetery.card.print'
  JOIN authz.roles       r   ON r.id   = src.role_id
  CROSS JOIN authz.permissions tgt
  WHERE tgt.code = 'cemetery.card.submit'
  ON CONFLICT DO NOTHING;

  ---------------------------------------------------------------------------
  -- 3) CỘNG THÊM KD_KINH_DOANH — vai anh Bách gọi tên đích danh.
  --
  -- Yêu cầu gốc: "nhân viên kinh doanh thuộc công ty hoặc nhân viên kinh doanh tập đoàn muốn
  -- in thẻ mộ thì phải qua luồng phê duyệt". Nhưng KD_KINH_DOANH KHÔNG cầm
  -- `cemetery.card.print` (đo 07/09/2026: chỉ ADMIN, CSKH_TIEP_DON, QL_NGHIA_TRANG cầm), nên
  -- bước 2 suy ra không tới họ. Thiếu bước này thì đúng diễn viên chính của luồng lại không
  -- gửi duyệt được.
  --
  -- Phạm vi SUY RA theo ba nấc, không gõ cứng — cùng lối đã dùng cho CSKH_TIEP_DON ở
  -- migration 03/09: (a) phạm vi vai này đang cầm trên `cemetery.card.view`; (b) không có thì
  -- lấy phạm vi PHỔ BIẾN NHẤT trong các mã vai này đang cầm; (c) vẫn không có thì BỎ QUA kèm
  -- NOTICE. Không có nấc "mặc định COMPANY".
  ---------------------------------------------------------------------------
  SELECT COALESCE(
    (SELECT rp.scope
       FROM authz.role_permissions rp
       JOIN authz.roles       r ON r.id = rp.role_id       AND r.code = 'KD_KINH_DOANH'
       JOIN authz.permissions p ON p.id = rp.permission_id AND p.code = 'cemetery.card.view'),
    (SELECT rp.scope
       FROM authz.role_permissions rp
       JOIN authz.roles r ON r.id = rp.role_id AND r.code = 'KD_KINH_DOANH'
      GROUP BY rp.scope
      ORDER BY count(*) DESC, rp.scope
      LIMIT 1)
  ) INTO kd_scope;

  IF kd_scope IS NULL THEN
    RAISE NOTICE
      'Bỏ qua phần cấp `cemetery.card.submit` cho KD_KINH_DOANH: vai này không tồn tại hoặc chưa cầm mã nào. Nếu ghế kinh doanh có thật thì phải cấp bằng tay, nếu không họ sẽ không gửi duyệt được.';
  ELSE
    INSERT INTO authz.role_permissions (id, role_id, permission_id, scope)
    SELECT ulid_time || substr(upper(md5(r.code || '|' || p.code)), 1, 16),
           r.id, p.id, kd_scope
    FROM authz.roles r
    CROSS JOIN authz.permissions p
    WHERE r.code = 'KD_KINH_DOANH' AND p.code = 'cemetery.card.submit'
    ON CONFLICT DO NOTHING;
  END IF;

  ---------------------------------------------------------------------------
  -- 4) Ai cầm `cemetery.card.approve` — CHỈ QL_NGHIA_TRANG.
  --
  -- Đây là chỗ KHÔNG suy từ mã anh em được, và nói thẳng ra vì sao: luật nghiệp vụ GỌI TÊN
  -- một vai. Anh Bách chốt 05/09 "người ký là người quản lý nghĩa trang", và người ký chính là
  -- người duyệt. Không mã nào đang tồn tại có bộ vai trùng với "đúng một vai QL_NGHIA_TRANG",
  -- nên suy ra sẽ ra sai bộ.
  --
  -- Phạm vi thì VẪN suy ra theo ba nấc như trên — cái gõ cứng ở đây là TÊN VAI (do nghiệp vụ
  -- quyết), không phải PHẠM VI (do cấu hình CSDL quyết).
  --
  -- CỐ Ý KHÔNG cấp cho GD_CONG_TY làm ghế duyệt dự phòng: ghế đó cầm `cemetery.card_fee.waive`,
  -- và người vừa tha được tiền vừa gật được việc cấp thẻ là một cặp tách nhiệm vụ bị phá. Anh
  -- Bách chốt 05/09 xử vắng mặt bằng cách ĐỔI NGƯỜI KÝ MẶC ĐỊNH, không bằng ghế dự phòng.
  ---------------------------------------------------------------------------
  SELECT COALESCE(
    (SELECT rp.scope
       FROM authz.role_permissions rp
       JOIN authz.roles       r ON r.id = rp.role_id       AND r.code = 'QL_NGHIA_TRANG'
       JOIN authz.permissions p ON p.id = rp.permission_id AND p.code = 'cemetery.card.view'),
    (SELECT rp.scope
       FROM authz.role_permissions rp
       JOIN authz.roles r ON r.id = rp.role_id AND r.code = 'QL_NGHIA_TRANG'
      GROUP BY rp.scope
      ORDER BY count(*) DESC, rp.scope
      LIMIT 1)
  ) INTO ql_scope;

  IF ql_scope IS NULL THEN
    RAISE NOTICE
      'Bỏ qua phần cấp `cemetery.card.approve` cho QL_NGHIA_TRANG: vai này không tồn tại hoặc chưa cầm mã nào. Bước gác cuối file sẽ bắt được nếu ma trận đã seed.';
  ELSE
    INSERT INTO authz.role_permissions (id, role_id, permission_id, scope)
    SELECT ulid_time || substr(upper(md5(r.code || '|' || p.code)), 1, 16),
           r.id, p.id, ql_scope
    FROM authz.roles r
    CROSS JOIN authz.permissions p
    WHERE r.code = 'QL_NGHIA_TRANG' AND p.code = 'cemetery.card.approve'
    ON CONFLICT DO NOTHING;
  END IF;

  ---------------------------------------------------------------------------
  -- 5) TỰ BẢO VỆ — gác HẬU QUẢ, không gác điều kiện.
  --
  -- Kiểm đúng cái hỏng câm của 03/09: một mã NẰM TRONG DANH MỤC mà KHÔNG VAI NÀO CẦM. Trạng
  -- thái đó không nổ ở đâu — guard cứ từ chối, màn hình cứ rỗng, không log nào nói vì sao.
  -- Không có test nào trong repo đòi "mã mới phải có ít nhất một vai ngoài ADMIN" (ADMIN tự có
  -- qua ALL_CODES nên mọi phép kiểm mức vai vẫn xanh), nên bước gác này là chỗ DUY NHẤT bắt.
  ---------------------------------------------------------------------------
  IF matrix_seeded THEN
    SELECT string_agg(c, ', ' ORDER BY c) INTO orphan_codes
    FROM unnest(new_codes) AS c
    WHERE NOT EXISTS (
      SELECT 1
      FROM authz.role_permissions rp
      JOIN authz.permissions p ON p.id = rp.permission_id
      JOIN authz.roles r       ON r.id = rp.role_id
      WHERE p.code = c AND r.code <> 'ADMIN'
    );

    IF orphan_codes IS NOT NULL THEN
      RAISE EXCEPTION
        'Dừng: mã % đã vào danh mục nhưng KHÔNG vai nào NGOÀI ADMIN cầm — đúng cái hỏng câm ngày 03/09/2026. ADMIN tự có mọi mã qua ALL_CODES nên không tính. Nguyên nhân thường gặp: mã đối chiếu `cemetery.card.print` không còn vai nào cầm, hoặc vai QL_NGHIA_TRANG / KD_KINH_DOANH không tồn tại trên CSDL này. Cấp tay cho các vai đúng rồi migrate lại, hoặc chạy `pnpm --filter @erp/api db:seed` trước.',
        orphan_codes;
    END IF;
  ELSE
    RAISE NOTICE
      'authz.role_permissions rỗng — CSDL chưa seed ma trận quyền. Chỉ thêm 2 dòng vào danh mục, chưa cấp cho vai nào; `prisma db seed` chạy sau sẽ cấp.';
  END IF;
END $$;
