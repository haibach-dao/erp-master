-- Ô CHỌN CÔNG TY CHO NGƯỜI TẠO KHÁCH HÀNG — cấp `org.company.view` bằng đường TỰ CHẠY.
--
-- KHÔNG có mã quyền mới ở đây: `org.company.view` đã nằm trong `authz.permissions` từ lâu
-- (S1, "Xem công ty"). Thứ thiếu là các dòng CẤP CHO VAI.
--
-- VÌ SAO PHẢI CÓ FILE NÀY: từ 09/09/2026 ô CÔNG TY CHỦ QUẢN là BẮT BUỘC khi tạo khách hàng,
-- và đường duy nhất điền nó là ô chọn lấy dữ liệu từ `GET /api/v1/cemetery/companies` — route
-- gác bằng `org.company.view`. Đo trên CSDL ngày 10/09/2026: mã đó CHỈ ADMIN cầm, trong khi
-- `crm.customer.create` thì CSKH_TIEP_DON, KD_KINH_DOANH, HS_NHAN_THAN đều cầm ở mức COMPANY.
-- Hệ quả: ba ghế đó mở hộp thoại "Khách hàng mới", ô chọn công ty ăn 403, nút Lưu XÁM VĨNH
-- VIỄN. Một mã CẤP mà không kèm mã ĐỌC DANH MỤC để điền ô bắt buộc thì mã cấp chỉ còn trên
-- giấy — đúng lớp lỗi "tính năng không ai dùng được" của lát 0 ngày 05/09.
--
-- Sửa `ROLE_CATALOG` một mình là KHÔNG ĐỦ: cửa THÊM một dòng cấp quyền chỉ đi qua
-- `prisma db seed`, mà không lệnh triển khai nào tự gọi seed (xem header
-- `scripts/authz-catalog-check.ts`). CI vẫn xanh, CSDL đang chạy không hề biết. Cùng khe hở đã
-- sinh ra sự cố 03/09/2026.
--
-- SUY TỪ DỮ LIỆU SỐNG, KHÔNG GÕ TÊN VAI. Luật là "ai TẠO ĐƯỢC khách hàng thì phải CHỌN ĐƯỢC
-- công ty chủ quản", nên vế phải suy từ chính `crm.customer.create`. Ba lợi ích, và đây là lý
-- do chọn lối này thay vì liệt kê ba tên vai:
--   · phạm vi tự khớp với CSDL đang chạy, không bị áp phạm vi của máy người viết migration;
--   · CSDL nào đã cấp `crm.customer.create` cho một vai thứ tư thì vai đó cũng được theo;
--   · không có nấc "mặc định COMPANY" nào để gõ sai.
-- Khác migration 07/09/2026 ở chỗ đó: lần ấy phải gọi tên `QL_NGHIA_TRANG` vì luật nghiệp vụ
-- gọi tên một vai. Lần này luật nói về một QUAN HỆ giữa hai mã, nên suy được trọn vẹn.

DO $$
DECLARE
  /* id TẤT ĐỊNH, không random — xem chú thích dài ở
   * `20260903140000_card_signer_permissions/migration.sql`. Chuỗi dưới là
   * 2026-09-10T09:00:00Z, ĐÚNG mốc trên tên thư mục migration này. */
  ulid_time  CONSTANT TEXT := '01M258Q6M0';
  target     CONSTANT TEXT := 'org.company.view';
  anchor     CONSTANT TEXT := 'crm.customer.create';

  matrix_seeded BOOLEAN;
  granted       INTEGER;
  stranded      TEXT;
BEGIN
  SELECT EXISTS (SELECT 1 FROM authz.role_permissions) INTO matrix_seeded;

  IF NOT matrix_seeded THEN
    RAISE NOTICE
      'authz.role_permissions rỗng — CSDL chưa seed ma trận quyền. Không có gì để suy ra; `prisma db seed` chạy sau sẽ cấp theo ROLE_CATALOG.';
    RETURN;
  END IF;

  ---------------------------------------------------------------------------
  -- 1) Cấp `org.company.view` cho MỌI vai đang cầm `crm.customer.create`, với ĐÚNG phạm vi
  --    vai đó đang cầm mã neo.
  --
  --    Phạm vi phải BẰNG, không rộng hơn: `createCustomer` hỏi phạm vi theo mã
  --    `crm.customer.create` trên công ty client gửi lên. Cấp `org.company.view` ở GROUP cho
  --    một vai bó COMPANY là mời họ chọn một công ty ngoài tầm rồi ăn 403 lúc Lưu — một ô
  --    chọn bày ra thứ không dùng được thì tệ hơn ô chọn rỗng, vì nó bắt người dùng thử đến
  --    khi trúng.
  --
  --    ADMIN đã cầm mã này ở GROUP qua ALL_CODES; `ON CONFLICT DO NOTHING` giữ nguyên dòng
  --    đó, không hạ phạm vi của ADMIN xuống COMPANY.
  ---------------------------------------------------------------------------
  INSERT INTO authz.role_permissions (id, role_id, permission_id, scope)
  SELECT ulid_time || substr(upper(md5(r.code || '|' || tgt.code)), 1, 16),
         r.id,
         tgt.id,
         src.scope
  FROM authz.role_permissions src
  JOIN authz.permissions ref ON ref.id = src.permission_id AND ref.code = anchor
  JOIN authz.roles       r   ON r.id   = src.role_id
  CROSS JOIN authz.permissions tgt
  WHERE tgt.code = target
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS granted = ROW_COUNT;
  RAISE NOTICE 'Đã cấp `%` cho % vai (suy từ `%`).', target, granted, anchor;

  ---------------------------------------------------------------------------
  -- 2) TỰ BẢO VỆ — gác HẬU QUẢ, không gác điều kiện.
  --
  --    Kiểm đúng cái vừa hỏng: một vai CẦM ĐƯỢC `crm.customer.create` mà KHÔNG đọc nổi danh
  --    mục công ty. Trạng thái đó không nổ ở đâu cả — API trả 403 cho một lần gọi phụ, màn
  --    hình chỉ hiện một nút xám, và không log nào nói vì sao. Không phép kiểm nào trong repo
  --    bắt được (đã đo 10/09: thêm ba dòng cấp quyền không làm đỏ một test nào), nên bước gác
  --    này là chỗ DUY NHẤT bắt.
  --
  --    KHÔNG loại trừ ADMIN ở đây, khác bước gác của migration 07/09: ở đó câu hỏi là "mã mới
  --    có ai ngoài ADMIN cầm không" nên phải loại ADMIN ra mới có nghĩa; ở đây câu hỏi là
  --    "MỌI vai tạo được khách có chọn được công ty không", mà ADMIN cũng phải thoả — và
  --    ADMIN thoả sẵn, nên không cần ngoại lệ nào.
  ---------------------------------------------------------------------------
  SELECT string_agg(r.code, ', ' ORDER BY r.code) INTO stranded
  FROM authz.role_permissions rp
  JOIN authz.permissions p ON p.id = rp.permission_id AND p.code = anchor
  JOIN authz.roles       r ON r.id = rp.role_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM authz.role_permissions rp2
    JOIN authz.permissions p2 ON p2.id = rp2.permission_id AND p2.code = target
    WHERE rp2.role_id = r.id
  );

  IF stranded IS NOT NULL THEN
    RAISE EXCEPTION
      'Dừng: vai % cầm `%` nhưng KHÔNG cầm `%`. Từ 09/09/2026 ô công ty chủ quản là bắt buộc khi tạo khách, và ô chọn công ty gác bằng `%` — nên các vai này bấm Lưu không được, im lặng, không lý do. Cấp `%` cho họ với ĐÚNG phạm vi họ đang cầm `%` rồi migrate lại.',
      stranded, anchor, target, target, target, anchor;
  END IF;
END $$;
