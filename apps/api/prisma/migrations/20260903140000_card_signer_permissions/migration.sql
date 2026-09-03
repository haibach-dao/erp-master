-- HAI MÃ QUYỀN CỦA DANH MỤC NGƯỜI KÝ THẺ MỘ, đi bằng đường TỰ CHẠY.
--
--   cemetery.card_signer.view  (S1) — đọc danh mục người ký, hiện ở ô chọn trên màn cấp thẻ
--   config.card_signer.update  (S3) — mở/sửa danh mục người ký, toàn hệ
--
-- VÌ SAO PHẢI CÓ FILE NÀY, trong khi `prisma/seed.ts` đã upsert cả danh mục:
-- hệ đang BẤT ĐỐI XỨNG ở đúng chỗ nguy hiểm nhất. Cửa XOÁ một mã quyền đi qua
-- `prisma migrate deploy` — lệnh TỰ CHẠY khi triển khai, đã dùng hai lần
-- (`20260825200000_drop_wildcard_permission`, `20260826151000_drop_person_search_permission`).
-- Cửa THÊM một mã thì chỉ đi qua `prisma db seed`, mà KHÔNG lệnh nào tự gọi
-- (`postinstall` chỉ chạy `prisma generate`). Nghĩa là: bỏ quyền thì chắc chắn tới nơi,
-- thêm quyền thì phụ thuộc việc ai đó NHỚ gõ một lệnh. Lỗi 03/09/2026 đẻ ra từ đúng khe đó,
-- và nó im lặng — mã có trong danh mục TypeScript, guard vẫn từ chối, màn hình rỗng không
-- kèm một dòng lý do nào.
--
-- Chú thích đầu `permission-catalog.ts` đã viết sẵn luật này từ đầu và chưa lần nào được ép:
-- "Adding one is a deliberate edit + migration, never an ad-hoc string at a call site".
-- File này là phần "+ migration" của câu đó.
--
-- KHÔNG ĐƯỢC dùng phép so "số mã trong danh mục vs số dòng trong CSDL" làm bước gác:
-- `seed.ts` import THẲNG `PERMISSION_CATALOG` rồi upsert, nên trên một CSDL vừa seed, phép
-- so ấy là so một danh sách với CHÍNH NÓ — không bao giờ đỏ được.

DO $$
DECLARE
  /* SINH `id`: `authz.permissions.id` và `authz.role_permissions.id` là khoá TEXT, tầng ứng
   * dụng đổ ULID vào (`seed.ts` gọi `ulid()`). SQL không có hàm ULID, nên ở đây id được DỰNG
   * theo đúng hình dạng ULID và DUY NHẤT bằng cách suy từ dữ liệu, chứ không random:
   *
   *   id = <10 ký tự dấu thời gian> || <16 ký tự lấy từ md5 của khoá tự nhiên>
   *
   * 10 ký tự đầu của ULID là 48 bit mili-giây từ epoch, mã Crockford base32. Chuỗi dưới đây
   * là 2026-09-03T14:00:00Z — ĐÚNG mốc trên tên thư mục migration này, nên hai dòng mới sắp
   * xếp theo id vẫn nằm đúng chỗ của chúng trong dòng thời gian, cạnh các dòng seed sinh ra
   * cùng ngày.
   *
   * 16 ký tự sau lấy từ `substr(upper(md5(khoá)), 1, 16)`. md5 ra hex, `upper` cho ra 0-9A-F
   * — toàn bộ đều nằm trong bảng chữ Crockford (bảng này chỉ bỏ I, L, O, U), nên chuỗi 26 ký
   * tự thu được là một ULID HỢP LỆ, đọc được bằng mọi bộ giải ULID.
   *
   * VÌ SAO SUY RA CHỨ KHÔNG RANDOM: khoá tự nhiên dùng để băm là MÃ QUYỀN (và mã vai) — thứ
   * giống hệt nhau ở mọi CSDL. Nên chạy file này trên máy dev, staging và production cho ra
   * CÙNG MỘT id. Đối chiếu ma trận quyền giữa hai môi trường thành phép so id thẳng, không
   * phải phép so qua `code`. Random thì mất hẳn tính chất đó, đổi lại không được gì.
   */
  ulid_time  CONSTANT TEXT   := '01M1KS3FR0';
  new_codes  CONSTANT TEXT[] := ARRAY['cemetery.card_signer.view', 'config.card_signer.update'];

  matrix_seeded BOOLEAN;
  cskh_scope    TEXT;
  orphan_codes  TEXT;
BEGIN
  /* Đo TRƯỚC khi ghi: CSDL này đã từng seed ma trận quyền chưa.
   * Một CSDL vừa `migrate deploy` xong mà chưa `db seed` thì `authz.roles` và
   * `authz.role_permissions` đều rỗng — lúc đó không có gì để suy ra, và đó là chuyện BÌNH
   * THƯỜNG, không phải lỗi. Bước gác cuối file phải biết phân biệt hai hoàn cảnh này. */
  SELECT EXISTS (SELECT 1 FROM authz.role_permissions) INTO matrix_seeded;

  ---------------------------------------------------------------------------
  -- 1) Hai dòng danh mục.
  --
  -- Mô tả, `sensitivity`, `wildcard_exempt`, `introduced_in` chép ĐÚNG những gì
  -- `PERMISSION_CATALOG` sẽ ghi. Cố ý trùng khít: nếu ở đây ghi khác, thì lần `db:seed` kế
  -- tiếp sẽ UPDATE đè lại và hai đường sinh ra một cặp giá trị nhấp nháy không ai giải thích
  -- được. `wildcard_exempt` = (sensitivity = 'S3') là đúng luật hàm `p()` trong danh mục.
  --
  -- KHÔNG chạm `reviewed_at` — không ở INSERT, không ở nhánh trùng. Seed CỐ Ý bỏ trống cột
  -- này ("một mã chưa ai rà phải NHÌN THẤY LÀ CHƯA RA"), và một migration lặng lẽ đóng dấu
  -- đã-rà cho hai mã S1/S3 mới toanh thì còn tệ hơn seed, vì không ai đọc nó.
  --
  -- `ON CONFLICT DO NOTHING` KHÔNG chỉ đích danh cột: dòng đã có (máy đã seed) đụng chỉ mục
  -- duy nhất trên `code`, còn một lần chạy lại file này đụng CẢ khoá chính — vì id ở đây là
  -- tất định nên chạy lại sinh ra đúng id cũ. Chỉ đích danh một trong hai thì cái còn lại
  -- vẫn nổ. Và DO NOTHING chứ không DO UPDATE: dòng đã có KHÔNG được ghi đè.
  ---------------------------------------------------------------------------
  INSERT INTO authz.permissions (id, code, description, sensitivity, wildcard_exempt, introduced_in)
  VALUES
    (ulid_time || substr(upper(md5('cemetery.card_signer.view')), 1, 16),
     'cemetery.card_signer.view',
     'Xem danh mục người ký thẻ mộ',
     'S1', false, 'gate-1'),
    (ulid_time || substr(upper(md5('config.card_signer.update')), 1, 16),
     'config.card_signer.update',
     'Quản trị danh mục người ký thẻ mộ (toàn hệ)',
     'S3', true, 'gate-1')
  ON CONFLICT DO NOTHING;

  ---------------------------------------------------------------------------
  -- 2) Ai cầm `cemetery.card_signer.view`.
  --
  -- SUY TỪ DỮ LIỆU SỐNG, không gõ cứng danh sách vai: lấy y nguyên bộ vai (và PHẠM VI của
  -- từng vai) đang cầm `cemetery.card_fee.view`. Hai mã này đi cùng nhau theo thiết kế — cả
  -- hai nằm trong gói `CEMETERY_READ_ALL`, tức "ai đọc được nghĩa trang thì đọc được biểu phí
  -- và đọc được người ký".
  --
  -- Vì sao suy ra tốt hơn gõ cứng: phạm vi TỰ KHỚP với CSDL đang chạy. QL_NGHIA_TRANG là SITE
  -- ở máy này, nhưng một công ty con cấu hình vai đó thành COMPANY thì mã mới cũng theo
  -- COMPANY — chứ không bị áp phạm vi của máy người viết migration. Gõ cứng `SITE` vào đây là
  -- lặng lẽ NỚI hoặc SIẾT quyền của một CSDL mà mình chưa từng nhìn thấy.
  --
  -- `ON CONFLICT DO NOTHING` cùng lý do như trên: chạy lại đụng cả khoá chính lẫn ràng buộc
  -- duy nhất (role_id, permission_id) một lúc, vì id là tất định.
  ---------------------------------------------------------------------------
  INSERT INTO authz.role_permissions (id, role_id, permission_id, scope)
  SELECT ulid_time || substr(upper(md5(r.code || '|' || tgt.code)), 1, 16),
         r.id,
         tgt.id,
         src.scope
  FROM authz.role_permissions src
  JOIN authz.permissions ref ON ref.id = src.permission_id AND ref.code = 'cemetery.card_fee.view'
  JOIN authz.roles       r   ON r.id   = src.role_id
  CROSS JOIN authz.permissions tgt
  WHERE tgt.code = 'cemetery.card_signer.view'
  ON CONFLICT DO NOTHING;

  ---------------------------------------------------------------------------
  -- 3) CỘNG THÊM CSKH_TIEP_DON — chỗ hai mã lệch nhau, và lệch có lý do.
  --
  -- `cemetery.card_fee.view` là S2 và CỐ Ý không cấp cho quầy tiếp đón. Nhưng người ký thì
  -- ngược hẳn: quầy tiếp đón CHÍNH LÀ nơi cấp thẻ (`cemetery.card.print`), ô chọn người ký
  -- nằm ngay trên màn hình họ dùng hàng ngày. Thiếu mã này thì ô đó rỗng đúng ở chỗ dùng
  -- nhiều nhất — và danh sách chỉ gồm tên + chức danh cán bộ INDEVCO, không có gì để giấu,
  -- nên nó là S1 chứ không phải S2.
  --
  -- Phạm vi cũng SUY RA chứ không gõ cứng, theo ba nấc:
  --   a) phạm vi mà chính vai này đang cầm trên `cemetery.card.view` — đúng màn hình có ô
  --      chọn người ký, nên đây là dòng đối chiếu sát nghĩa nhất;
  --   b) không có thì lấy phạm vi PHỔ BIẾN NHẤT trong các mã vai này đang cầm;
  --   c) vẫn không có (vai chưa cầm mã nào, hoặc vai không tồn tại) thì BỎ QUA, kèm NOTICE.
  -- Không có nấc "mặc định COMPANY": gõ một phạm vi cứng vào một CSDL mình chưa nhìn thấy
  -- chính là thứ cả bước này đang tránh.
  ---------------------------------------------------------------------------
  SELECT COALESCE(
    (SELECT rp.scope
       FROM authz.role_permissions rp
       JOIN authz.roles       r ON r.id = rp.role_id       AND r.code = 'CSKH_TIEP_DON'
       JOIN authz.permissions p ON p.id = rp.permission_id AND p.code = 'cemetery.card.view'),
    (SELECT rp.scope
       FROM authz.role_permissions rp
       JOIN authz.roles r ON r.id = rp.role_id AND r.code = 'CSKH_TIEP_DON'
      GROUP BY rp.scope
      ORDER BY count(*) DESC, rp.scope
      LIMIT 1)
  ) INTO cskh_scope;

  IF cskh_scope IS NULL THEN
    RAISE NOTICE
      'Bỏ qua phần cấp thêm cho CSKH_TIEP_DON: vai này không tồn tại hoặc chưa cầm mã nào, không có gì để suy ra phạm vi. Nếu quầy tiếp đón có thật thì phải cấp `cemetery.card_signer.view` bằng tay, nếu không ô chọn người ký sẽ rỗng ngay tại quầy.';
  ELSE
    INSERT INTO authz.role_permissions (id, role_id, permission_id, scope)
    SELECT ulid_time || substr(upper(md5(r.code || '|' || p.code)), 1, 16),
           r.id,
           p.id,
           cskh_scope
    FROM authz.roles r
    CROSS JOIN authz.permissions p
    WHERE r.code = 'CSKH_TIEP_DON'
      AND p.code = 'cemetery.card_signer.view'
    ON CONFLICT DO NOTHING;
  END IF;

  ---------------------------------------------------------------------------
  -- 4) Ai cầm `config.card_signer.update`.
  --
  -- Suy từ `config.plot_tag.update` — mã anh em ĐÚNG NGHĨA: cùng là "mở một danh mục TOÀN HỆ",
  -- cùng S3, cùng ra đời ở ghế giữ danh mục (QT_NGHIEP_VU). Bộ vai của nó là bộ vai đúng cho
  -- mã này, không phải chép tay lại.
  --
  -- Cố ý KHÔNG suy từ `config.reference.update`: mã đó hiện chưa route nào dùng, nhưng
  -- QT_NGHIEP_VU đang cầm `config.reference.view` — bám vào một mã lơ lửng là bám vào một bộ
  -- vai chưa ai rà lần nào.
  ---------------------------------------------------------------------------
  INSERT INTO authz.role_permissions (id, role_id, permission_id, scope)
  SELECT ulid_time || substr(upper(md5(r.code || '|' || tgt.code)), 1, 16),
         r.id,
         tgt.id,
         src.scope
  FROM authz.role_permissions src
  JOIN authz.permissions ref ON ref.id = src.permission_id AND ref.code = 'config.plot_tag.update'
  JOIN authz.roles       r   ON r.id   = src.role_id
  CROSS JOIN authz.permissions tgt
  WHERE tgt.code = 'config.card_signer.update'
  ON CONFLICT DO NOTHING;

  ---------------------------------------------------------------------------
  -- 5) TỰ BẢO VỆ — gác HẬU QUẢ, không gác điều kiện.
  --
  -- Bước gác này kiểm đúng cái hỏng của ngày 03/09: một mã NẰM TRONG DANH MỤC mà KHÔNG VAI
  -- NÀO CẦM. Trạng thái đó không nổ ở đâu cả — guard cứ từ chối, màn hình cứ rỗng, không log
  -- nào nói vì sao. Nó chỉ lộ ra khi có người dùng thật kêu.
  --
  -- Gác hậu quả chứ không gác điều kiện là cố ý: kiểm "mã đối chiếu có tồn tại không" chỉ bắt
  -- được một nguyên nhân, còn kiểm "cuối cùng có ai cầm không" bắt được MỌI nguyên nhân dẫn
  -- tới cùng cái hỏng đó — mã đối chiếu bị xoá, grant của nó bị thu hết, vai bị đổi tên, hay
  -- một lỗi trong chính file này.
  --
  -- Chỉ gác khi ma trận ĐÃ SEED. CSDL trắng (mới `migrate deploy`, chưa `db seed`) thì hai mã
  -- chưa ai cầm là đúng và `db seed` chạy sau sẽ cấp — bắt lỗi ở đó là chặn cửa dựng hệ mới.
  --
  -- `prisma migrate deploy` bọc mỗi file migration trong MỘT giao dịch, nên RAISE EXCEPTION ở
  -- đây cuộn ngược cả hai dòng danh mục lẫn mọi grant vừa chèn: dừng sạch, không để lại nửa vời.
  ---------------------------------------------------------------------------
  IF matrix_seeded THEN
    SELECT string_agg(c, ', ' ORDER BY c) INTO orphan_codes
    FROM unnest(new_codes) AS c
    WHERE NOT EXISTS (
      SELECT 1
      FROM authz.role_permissions rp
      JOIN authz.permissions p ON p.id = rp.permission_id
      WHERE p.code = c
    );

    IF orphan_codes IS NOT NULL THEN
      RAISE EXCEPTION
        'Dừng: mã % đã vào danh mục nhưng KHÔNG vai nào cầm — đúng cái hỏng câm ngày 03/09/2026 (guard từ chối, màn hình rỗng, không lý do). Nguyên nhân thường gặp: mã đối chiếu `cemetery.card_fee.view` / `config.plot_tag.update` không còn vai nào cầm trên CSDL này. Cấp tay cho các vai đúng rồi migrate lại, hoặc chạy `pnpm --filter @erp/api db:seed` trước.',
        orphan_codes;
    END IF;
  ELSE
    RAISE NOTICE
      'authz.role_permissions rỗng — CSDL chưa seed ma trận quyền. Chỉ thêm 2 dòng vào danh mục, chưa cấp cho vai nào; `prisma db seed` chạy sau sẽ cấp.';
  END IF;
END $$;
