# Hồ sơ họp — Quyết định nghiệp vụ, cắt phạm vi MVP & rà soát rủi ro

> Trạng thái: **NHÁP để bàn** (chưa phải hồ sơ trình duyệt, chưa code)
> Nguồn: dựa trên blueprint 00–11, phiên bản 1.0 (24/08/2026)
> Mục đích: (a) chốt 7 quyết định nghiệp vụ, (b) chốt phạm vi MVP, (c) rà soát rủi ro doc 04 & 10
> Cách dùng: tài liệu viết theo dạng **luận điểm đánh số + mức tin cậy** để bên phản biện (ChatGPT) trả lời theo từng mã. Ký hiệu: [ĐO] = có căn cứ trong tài liệu · [SUY] = suy đoán/khuyến nghị của người soạn · [HỎI] = cần chủ nghiệp vụ trả lời.

---

# PHẦN A — Bảng 7 quyết định nghiệp vụ + phương án

Mỗi quyết định: câu hỏi → vì sao quan trọng → các phương án → khuyến nghị nháp → thứ gì trong hệ thống bị ảnh hưởng nếu chọn sai.

## A1. Một mộ chứa được bao nhiêu người, theo từng loại mộ? [HỎI]
- **Vì sao quan trọng:** quyết định ràng buộc `capacity` của `grave_plots` và luật chặn khi số `burial_record` hiệu lực vượt sức chứa (doc 04 M4). Sai ở đây làm sai cả sơ đồ mộ và báo cáo lấp đầy.
- **Phương án:**
  - P1: `capacity` cố định theo từng *loại mộ* (đơn/đôi/gia tộc N chỗ).
  - P2: `capacity` cấu hình theo *từng vị trí mộ* (linh hoạt hơn, phức tạp hơn).
  - P3: Hỗn hợp — mặc định theo loại, cho override từng vị trí có audit.
- **Khuyến nghị nháp [SUY]:** P3. Mặc định theo loại để nhập nhanh, cho phép override có lý do vì mộ gia tộc thực tế hay khác chuẩn.
- **Ảnh hưởng nếu sai:** phải migrate lại `grave_plots`, viết lại validation capacity, sai số liệu dashboard.

## A2. Quyền sử dụng mộ: vĩnh viễn / có thời hạn / tùy hợp đồng? Có chuyển nhượng & thừa kế không? [HỎI]
- **Vì sao quan trọng:** đây là câu **rủi ro cao nhất về data model**. Nếu có chuyển nhượng/thừa kế thì cần thêm thực thể "quyền sử dụng mộ" tách khỏi hợp đồng, và một workflow chuyển nhượng — cả hai **hiện chưa có** trong blueprint.
- **Phương án:**
  - P1: Quyền gắn cứng vào hợp đồng, không chuyển nhượng (MVP đơn giản nhất).
  - P2: Tách `grave_usage_right` (chủ thể, thời hạn, nguồn gốc) khỏi hợp đồng; hỗ trợ chuyển nhượng/thừa kế qua workflow.
  - P3: MVP làm P1 nhưng **thiết kế bảng để không chặn đường lên P2** (giữ chỗ cho `usage_right_id`).
- **Khuyến nghị nháp [SUY]:** P3. Không xây chuyển nhượng trong MVP nhưng chừa khớp nối để không phải đập đi làm lại.
- **Ảnh hưởng nếu sai:** nếu chọn P1 cứng mà thực tế có thừa kế → phải tái cấu trúc quan hệ hợp đồng–mộ–người, tốn nhất trong tất cả.

## A3. Ai là bên thanh toán khi chủ mộ mất / đổi đại diện / chuyển nhượng? [HỎI]
- **Vì sao quan trọng:** `service_subscriptions` và `receivable_schedules` cần biết "bên thanh toán" ổn định qua thời gian. Blueprint đã tách chủ mộ ≠ người thanh toán ≠ người liên hệ (doc 04) — tốt — nhưng chưa định nghĩa luật kế thừa nghĩa vụ thanh toán.
- **Phương án:**
  - P1: "Bên thanh toán" là một trường trên hợp đồng/đăng ký dịch vụ, đổi bằng revision có audit.
  - P2: Bảng lịch sử "nghĩa vụ thanh toán theo thời kỳ" (payer history) gắn effective dates.
- **Khuyến nghị nháp [SUY]:** P1 cho MVP + audit đổi payer; P2 chỉ khi có nhu cầu báo cáo theo người trả qua thời gian.
- **Ảnh hưởng nếu sai:** nhắc hết hạn/công nợ gửi nhầm người; sai quy gán doanh thu.

## A4. Danh mục dịch vụ, công thức giá, chu kỳ thu, mốc nhắc hạn thực tế? [HỎI]
- **Vì sao quan trọng:** là dữ liệu nền của toàn bộ P4 (dịch vụ + doanh thu). Không có danh mục thật thì không nghiệm thu được M5.
- **Cần chủ nghiệp vụ cung cấp:** danh sách gói dịch vụ thật + đơn vị tính + giá tham chiếu + chu kỳ (một lần/tháng/quý/năm) + thời hạn mặc định + mốc nhắc (mặc định blueprint là 90/60/30/7 ngày).
- **Khuyến nghị nháp [SUY]:** giữ 90/60/30/7 làm mặc định, cho cấu hình theo từng gói (blueprint đã hỗ trợ). Giá lưu snapshot tại thời điểm đăng ký để đổi bảng giá không làm sai hợp đồng cũ.
- **Ảnh hưởng nếu sai:** phải nhập lại toàn bộ catalog, sai lịch thu và doanh thu dự kiến.

## A5. "Đã thu" ghi nhận thế nào: import từ kế toán / nhập tay có duyệt / API? [HỎI]
- **Vì sao quan trọng:** **rủi ro tin cậy số liệu cao nhất.** Dashboard doanh thu (thứ lãnh đạo nhìn) chỉ đáng tin bằng nguồn "đã thu". Blueprint tách rõ *doanh thu dự kiến* (lịch phải thu) vs *đã thu* (thanh toán xác nhận) — đúng.
- **Phương án:**
  - P1: Import file từ kế toán, chống trùng qua `external_reference` (blueprint đã thiết kế).
  - P2: Nhập tay có phê duyệt (dùng approval engine).
  - P3: Tích hợp API realtime với hệ kế toán.
- **Khuyến nghị nháp [SUY]:** MVP = P1 (import) + P2 (nhập tay có duyệt) làm dự phòng. P3 để sau vì phụ thuộc hệ kế toán bên ngoài. Nguyên tắc hiến pháp INDEVCO: "đã thu" phải trỏ được nguồn/bằng chứng, không AI tự xác nhận.
- **Ảnh hưởng nếu sai:** hoặc số liệu sai, hoặc kế toán làm việc hai lần, mất niềm tin vào hệ thống.

## A6. Đơn vị nào được xem CCCD / giấy chứng tử / giá hợp đồng / file nhạy cảm? [HỎI]
- **Vì sao quan trọng:** định hình permission matrix và luật mask. Trùng với **làn cấm** của hiến pháp INDEVCO (dữ liệu cá nhân theo NĐ 13/2023, che số nhạy cảm). Blueprint đã có `view_sensitive`, mask kiểu `079***123`, tách `normal/confidential/restricted`.
- **Cần chủ nghiệp vụ + phụ trách tuân thủ trả lời:** ma trận vai trò × loại dữ liệu nhạy cảm × được xem/tải/không.
- **Khuyến nghị nháp [SUY]:** mặc định *deny* tất cả dữ liệu restricted; chỉ cấp theo scope tối thiểu có thời hạn (đúng nguyên tắc quyền theo giao dịch của hiến pháp). Admin hệ thống KHÔNG mặc định xem được nội dung nghiệp vụ nhạy cảm (blueprint doc 10 §6 đã nêu).
- **Ảnh hưởng nếu sai:** vi phạm NĐ 13/2023 và làn cấm nội bộ — rủi ro pháp lý, không chỉ kỹ thuật.

## A7. Workflow nào làm trước: hợp đồng ngoài / giảm giá / đổi mộ / gia hạn dịch vụ / mua hàng? [HỎI]
- **Vì sao quan trọng:** approval engine nên được chứng minh bằng 1–2 workflow thật trước khi tổng quát hóa. Chọn sai workflow đầu → engine bị uốn theo ca hiếm.
- **Khuyến nghị nháp [SUY]:** làm trước **(1) duyệt giảm giá/điều chỉnh giá hợp đồng** và **(2) gia hạn dịch vụ** — hai cái này chạm đúng lõi doanh thu và có điều kiện theo số tiền, đủ để kiểm chứng engine mà không quá phức tạp. "Đổi mộ" và "mua hàng" làm sau.
- **Ảnh hưởng nếu sai:** engine phải viết lại resolver/điều kiện.

**Xếp ưu tiên phải chốt trước [SUY]:** A2, A5, A4, A6 (ảnh hưởng data model & pháp lý) > A1, A3, A7.

---

# PHẦN B — Đề xuất cắt phạm vi MVP

## B1. Nguyên tắc cắt [SUY]
Lấy sản phẩm chạy thật sớm nhất mà vẫn giữ nền tảng quyền/audit đúng. Ưu tiên luồng *tạo giá trị đo được*: quản lý mộ + hợp đồng + theo dõi hết hạn. Hoãn phần phụ thuộc quyết định chưa chốt (doanh thu "đã thu", chuyển nhượng, AI).

## B2. TRONG MVP (bắt buộc)
Ánh xạ theo doc 04 M0–M3 + nền tảng:
1. **Nền tảng:** IAM + đăng nhập + RBAC/scope + organizational context + audit nền (P1).
2. **M0:** danh mục cây nghĩa trang, loại/sức chứa mộ, bảng giá tham chiếu, relation types.
3. **M1:** Person/Customer, quan hệ gia đình hai chiều, chống trùng (cảnh báo, không tự merge).
4. **M2:** sơ đồ/danh sách mộ + giữ chỗ có hết hạn (chống double-hold).
5. **M3:** upload hợp đồng ngoài + nhập dữ liệu cấu trúc + checklist xác minh + phân bổ mộ.
6. **File service** (MinIO, signed URL, virus scan, mask) — nền cho M3.
7. **Audit & Check Log** màn hình cơ bản + A1/A2/A3 (doc 10).

## B3. NGOÀI MVP (giai đoạn sau)
- **M4 hồ sơ an táng** — làm ngay sau MVP (rủi ro thấp, phụ thuộc M3).
- **M5 dịch vụ + doanh thu + gia hạn** — **chỉ mở sau khi chốt A4 + A5.** Đây là ranh giới quan trọng nhất.
- Approval engine tổng quát + workflow designer (P6) — bắt đầu bằng workflow **hard-code** cho A7(1)(2), chưa làm designer động.
- Knowledge base, mind map, semantic search (P7).
- Chuyển nhượng/thừa kế mộ (phụ thuộc A2).
- Lịch chăm sóc hiện trường, ảnh trước/sau, checklist nhân viên (M6 mở rộng, blueprint đã xếp ngoài).
- Kế toán tổng hợp, hóa đơn điện tử, đối soát ngân hàng đầy đủ, AI tự duyệt hợp đồng (blueprint đã loại khỏi MVP).

## B4. Cửa chặn (gate) đề xuất [SUY]
- **Gate 0 (P0):** không viết dòng code nghiệp vụ nào cho tới khi A2, A4, A5, A6 có câu trả lời ký xác nhận.
- **Gate M5:** không mở module doanh thu cho tới khi có danh mục dịch vụ thật (A4) và nguồn "đã thu" (A5).

---

# PHẦN C — Rà soát rủi ro doc 04 (quản lý mộ) & doc 10 (audit)

## C-04. Doc 04 — Quản lý khách hàng/mộ
- **C-04.1 [ĐO] Điểm mạnh:** tách 3 chủ thể (chủ mộ/người liên hệ/người an táng) và Person dùng chung — đúng, tránh lỗi phổ biến nhất của CRM nghĩa trang.
- **C-04.2 [ĐO] Điểm mạnh:** quan hệ đối ứng tự sinh trong cùng transaction + chỉ suy quan hệ trực tiếp chắc chắn (không suy họ hàng xa) — vừa đúng kỹ thuật vừa an toàn dữ liệu nhạy cảm.
- **C-04.3 [SUY] Khoảng trống:** data model **chưa có thực thể quyền sử dụng mộ tách khỏi hợp đồng** → nếu A2 = có chuyển nhượng/thừa kế thì thiếu. Cần chốt A2 trước khi finalize ERD.
- **C-04.4 [SUY] Rủi ro:** "giữ chỗ chống double-hold" dựa optimistic lock + unique partial index (doc 11 §11.4) — đúng, nhưng cần test đua thật (2 tư vấn viên bấm cùng lúc) trong UAT, không chỉ tin index.
- **C-04.5 [SUY] Cần làm rõ:** merge khách hàng "có kiểm soát, không tự merge" — nhưng chưa mô tả *ai duyệt merge* và *undo được không*. Merge là thao tác gần như không thể đảo; nên đưa qua approval + giữ bản ghi nguồn (soft link) thay vì hợp nhất cứng.
- **C-04.6 [SUY] Cần làm rõ:** snapshot giá/điều khoản vào hợp đồng đã nêu, nhưng chưa nói rõ khi nào tính doanh thu dự kiến — tại `Verified` hay `Active`? Doc 04 §6.4 nói "Verified/Active", cần chốt một mốc để tránh đếm trùng.

## C-10. Doc 10 — Audit/Security
- **C-10.1 [ĐO] Điểm mạnh:** tách 3 luồng log + append-only + integrity hash chuỗi theo company/day + A1–A5 UAT cụ thể — mức chi tiết gần chuẩn tài chính, hiếm gặp ở blueprint nội bộ.
- **C-10.2 [ĐO] Điểm mạnh:** transactional outbox / audit cùng transaction, "không ghi được audit thì nghiệp vụ phải fail hoặc vào retry có cảnh báo" — đúng nguyên tắc, khớp hiến pháp INDEVCO (mọi thao tác để dấu vết).
- **C-10.3 [SUY] Rủi ro vận hành:** integrity hash theo "company/day" — cần định nghĩa rõ ranh giới ngày (UTC hay giờ VN?) và cách xử lý khi ghi lệch ngày; blueprint nói giờ Asia/Bangkok cho UI nhưng audit `occurred_at` là UTC. Thống nhất để chuỗi hash không đứt.
- **C-10.4 [SUY] Khoảng trống:** chưa nêu **cơ chế chứng minh chuỗi hash cho bên thứ ba/kiểm toán** (ví dụ định kỳ ký/niêm phong ra storage write-once). Có nhắc "đẩy sang write-once" nhưng chưa có quy trình xác minh định kỳ.
- **C-10.5 [SUY] Cần bổ sung:** retention "tối thiểu 10 năm cho audit hợp đồng/mộ" là *đề xuất*, chưa đối chiếu quy định pháp lý ngành nghĩa trang VN — cần phụ trách tuân thủ xác nhận con số thật.

## C-KL. Kết luận phần C [SUY]
Doc 04 và 10 đủ tốt để bắt đầu, với **3 việc phải làm rõ trước khi finalize schema:** (1) A2 quyền sử dụng mộ, (2) mốc tính doanh thu Verified vs Active, (3) quy trình merge khách hàng. Doc 10 gần như sẵn sàng, chỉ cần chốt múi giờ audit và quy trình xác minh integrity định kỳ.

---

# PHẦN D — Câu hỏi gửi bên phản biện (ChatGPT)
Mời phản biện theo từng mã. Đặc biệt xin ý kiến về:
1. **A2 & C-04.3:** có nên tách `grave_usage_right` ngay từ MVP không, hay chừa khớp nối là đủ?
2. **A5:** import vs nhập-tay-có-duyệt cho "đã thu" — rủi ro nào lớn hơn trong bối cảnh phụ thuộc hệ kế toán ngoài?
3. **B4 Gate M5:** có đồng ý hoãn toàn bộ module doanh thu tới khi chốt A4+A5, hay nên làm khung trước?
4. **C-10.3:** ranh giới ngày cho integrity hash nên theo UTC hay giờ VN?
5. Có rủi ro/khoảng trống nào tài liệu này **bỏ sót** không?

> Ghi chú: đây là NHÁP để bàn. Chỉ kết tinh thành hồ sơ trình duyệt sau khi người có thẩm quyền đánh giá đạt (theo hiến pháp INDEVCO).

---

# PHẦN E — Phản biện và kiến nghị chốt trước khi triển khai

> Người phản biện: Codex · Nguyên tắc: các kiến nghị dưới đây là đề xuất kiến trúc/nghiệp vụ để thảo luận; quyết định pháp lý và chính sách dữ liệu vẫn cần người có thẩm quyền xác nhận.

## E1. Phản biện A2 & C-04.3 — Quyền sử dụng mộ [KHUYẾN NGHỊ]

**Kết luận:** nên tạo thực thể `grave_usage_right` ngay trong schema MVP ở mức tối thiểu; không chỉ để sẵn một trường `usage_right_id` chưa có bảng đích.

**Lý do:** nếu chỉ lưu quan hệ hợp đồng → mộ, hệ thống chưa trả lời được một cách ổn định ai đang có quyền sử dụng mộ, quyền đó có hiệu lực từ khi nào, và hợp đồng nào là nguồn gốc. Khi phát sinh thay đổi chủ thể, thừa kế hoặc chuyển nhượng, mô hình sẽ phải tái cấu trúc quan hệ hợp đồng–mộ–khách hàng.

**Phạm vi MVP đề xuất:** chưa xây workflow chuyển nhượng/thừa kế, nhưng có bảng tối thiểu:

```text
grave_usage_right
├── id
├── grave_plot_id
├── holder_party_id / holder_person_id / holder_customer_id
├── source_contract_id
├── effective_from / effective_to
├── status
└── transferred_from_right_id (nullable)
```

Hợp đồng là bằng chứng/thỏa thuận thương mại; quyền sử dụng mộ là quan hệ pháp lý-nghiệp vụ với vị trí mộ. Dịch vụ và bên thanh toán có thể liên kết vào quyền sử dụng hoặc hợp đồng tùy chính sách được chốt.

**Quyết định cần chốt:** có thể tạo nhiều quyền sử dụng kế tiếp theo thời gian cho một mộ hay không; có cho phép đồng sở hữu hay không; trạng thái/quy tắc kết thúc quyền sử dụng là gì.

## E2. Phản biện A5 — Ghi nhận "đã thu" [KHUYẾN NGHỊ]

**Kết luận:** MVP nên dùng import từ kế toán là nguồn chính; nhập tay chỉ là ngoại lệ có phê duyệt và bằng chứng. Không cho tạo ngay `PaymentRecord` đã xác nhận từ thao tác nhập tay.

Luồng trạng thái đề xuất:

```text
Import:    Imported → Matched / Unmatched → Confirmed
Nhập tay:  Pending approval → Confirmed / Rejected
```

**Rủi ro trọng yếu:** cùng một khoản tiền được ghi nhận từ import và nhập tay, hoặc một khoản thanh toán được phân bổ sai. Cần chống trùng theo nhiều lớp:

1. `external_reference` duy nhất khi nguồn có mã tham chiếu.
2. Cảnh báo trùng theo số tiền, ngày thu, bên trả, hợp đồng và khoản phải thu khi không có mã tham chiếu.
3. Cho phép một payment phân bổ cho nhiều khoản phải thu và một khoản phải thu nhận nhiều payment.
4. Payment đã xác nhận không sửa/xóa; mọi sửa sai dùng adjustment/reversal có liên kết bản ghi gốc và audit.

**Quyết định cần chốt:** nguồn nào là system of record cho "đã thu"; độ trễ import được chấp nhận; ai được duyệt nhập tay; chứng từ tối thiểu cho một manual payment.

## E3. Phản biện B4 — Gate M5 [KHUYẾN NGHỊ]

**Kết luận:** đồng ý hoãn chức năng doanh thu, reminder và dashboard doanh thu đến khi A4+A5 được chốt. Tuy vậy P3 vẫn nên lưu điều khoản thu có cấu trúc, version hóa trong hợp đồng để không phải nhập lại khi mở M5.

| Được làm trước Gate M5 | Chưa được kích hoạt trước Gate M5 |
|---|---|
| Bên thanh toán, giá thỏa thuận, tiền tệ, điều khoản/chu kỳ thu ở dạng dữ liệu hợp đồng | Tự sinh lịch phải thu, reminder, KPI doanh thu, ghi nhận đã thu |
| Version/revision điều khoản hợp đồng | Dashboard doanh thu hoặc số liệu công nợ chính thức |
| File/bằng chứng và checklist xác minh | Tự động coi dữ liệu hợp đồng là doanh thu |

Gate M5 nên yêu cầu không chỉ danh mục dịch vụ và cách ghi nhận thu đã được duyệt, mà còn có dữ liệu mẫu thật đủ các tình huống: phí một lần, định kỳ, gia hạn, miễn/điều chỉnh, thanh toán một phần và thanh toán trễ.

## E4. Phản biện C-10.3 & C-10.4 — Integrity hash [KHUYẾN NGHỊ]

**Kết luận:** dùng UTC cho `occurred_at` và ranh giới ngày của chuỗi hash; giao diện và export nghiệp vụ hiển thị giờ Việt Nam theo cấu hình. UTC tránh việc server, worker hoặc integration chạy khác múi giờ làm đứt/chồng ranh giới chuỗi.

Trường cần bổ sung:

```text
chain_partition_date_utc
previous_event_hash
event_hash
hash_algorithm_version
```

Quy trình chứng minh tính toàn vẹn đề xuất:

1. Chốt chuỗi của từng company khi hết ngày UTC.
2. Tạo manifest chứa hash cuối của mọi company trong ngày.
3. Ký manifest bằng khóa của audit service.
4. Lưu manifest vào storage có retention/write-once.
5. Có job xác minh lại chuỗi và cảnh báo khi lệch.

**Quyết định cần chốt:** thuật toán/khoá ký, nơi quản lý khoá, retention của manifest, tần suất và người chịu trách nhiệm xác minh.

## E5. Khoảng trống cần đưa vào Gate 0 [KHUYẾN NGHỊ]

| Mã | Khoảng trống | Quyết định cần có |
|---|---|---|
| E5.1 | Person/Customer đa công ty | Một Person/Customer có dùng chung giữa các công ty không; công ty nào được xem/sửa; cách tách dữ liệu khi cần. |
| E5.2 | Dữ liệu định danh | Trường nào được mã hóa để xem lại/xác minh, trường nào chỉ băm để dò trùng; quy tắc mask và quyền giải mã. |
| E5.3 | Merge khách hàng | Người có thẩm quyền, tiêu chí merge, approval, cách giữ liên kết nguồn và cơ chế đảo/khắc phục merge. |
| E5.4 | Hợp đồng và allocation | Một hợp đồng có nhiều mộ không; một mộ có nhiều allocation kế tiếp không; điều kiện release/reallocate. |
| E5.5 | Giá và giảm giá | Ngưỡng bắt buộc revision/approval, người duyệt, ngày hiệu lực và có/không hồi tố. |
| E5.6 | Giữ chỗ | Thời hạn mặc định, số lần gia hạn, điều kiện giải phóng và cách xử lý hold của nhân sự nghỉ việc. |
| E5.7 | Dữ liệu lịch sử | Có import dữ liệu cũ không; tiêu chuẩn làm sạch; cách xử lý bản ghi thiếu/trùng/mâu thuẫn. |
| E5.8 | Vòng đời dữ liệu nhạy cảm | Retention, ẩn danh/xóa theo chính sách, legal hold và quy trình xử lý yêu cầu dữ liệu cá nhân. |
| E5.9 | File chờ quét virus | File chưa có trạng thái `Clean` không được dùng để xác minh/kích hoạt hợp đồng hoặc cấp tải xuống. |

## E-KL. Kết luận phản biện [KHUYẾN NGHỊ]

Đồng ý nguyên tắc **không code nghiệp vụ trước Gate 0**. Gate 0 nên bổ sung E5.1 (mô hình Person/Customer đa công ty), E5.3 (merge khách hàng) và E5.7 (nhập dữ liệu lịch sử) bên cạnh A2, A4, A5, A6.

Quyết định kiến trúc cần ghi nhận ngay: tạo `grave_usage_right` tối thiểu trong MVP; doanh thu chỉ kích hoạt sau Gate M5; audit hash dùng UTC và có manifest ký/niêm phong định kỳ.

---

# PHẦN F — Phản hồi của Claude với phản biện Codex + bổ sung lỗ hổng còn lại

> Người soạn: Claude. Vai trò: bên thứ ba rà soát cả tài liệu gốc lẫn phản biện Codex. Nguyên tắc giữ nguyên: [ĐO]/[SUY], đây là NHÁP để bàn, chưa code, chưa phải hồ sơ trình duyệt.

## F1. Chốt quan điểm với từng điểm của Codex

| Mã Codex | Quan điểm Claude | Ghi chú |
|---|---|---|
| **E1** `grave_usage_right` trong MVP | **ĐỒNG Ý, sửa lại khuyến nghị gốc của em** | Em rút lại P3 (chỉ chừa trường) ở A2 và theo Codex: tạo bảng tối thiểu ngay. Lý do Codex đúng — không có bảng đích thì `usage_right_id` là trường mồ côi. **Nhưng tinh chỉnh:** chưa bật `transferred_from_right_id` và luật "nhiều quyền kế tiếp/đồng sở hữu" cho tới khi A2 được trả lời; giữ bảng ở dạng 1 quyền hiệu lực/1 mộ để không đoán sai chính sách. |
| **E2** import là system of record, state machine payment | **ĐỒNG Ý** | Bổ sung 1 điểm: bảng phân bổ `payment_allocation` (payment↔receivable nhiều-nhiều) nên làm **ngay từ đầu**, không hoãn — vì sửa từ mô hình 1-1 sang nhiều-nhiều về sau là migrate đau. Đây là mô hình đúng, không phải tính năng thêm. |
| **E3** hoãn M5 nhưng lưu điều khoản có cấu trúc + version | **ĐỒNG Ý** | Khớp B4 của em. Yêu cầu "dữ liệu mẫu thật đủ tình huống" ở Gate M5 là bổ sung tốt, đưa vào tiêu chí nghiệm thu. |
| **E4** UTC cho hash + manifest ký | **ĐỒNG Ý** | Xem F2.1 — cần tách rõ *ngày UTC cho audit* vs *ngày giờ VN cho số học nghiệp vụ* (nhắc hạn, "quá hạn"). Codex mới giải nửa múi giờ. |
| **E5.1** Person/Customer đa công ty | **ĐỒNG Ý — đây là lỗ hổng lớn nhất bị bỏ sót** | Cả blueprint lẫn bản nháp của em đều mặc định `company_id` trên mọi bản ghi nhưng Person là chủ thể *xuyên công ty*. Phải chốt trước khi finalize schema; đưa vào Gate 0. |
| **E5.2** mã hóa vs băm định danh | **ĐỒNG Ý, nâng mức** | Blueprint chỉ nói "băm CCCD để dò trùng" — nhưng băm thì **không hiển thị/xác minh lại được**. Field cần xem lại (để đối chiếu giấy tờ) phải **mã hóa (envelope/KMS)**, field chỉ để dò trùng thì băm. Đây vừa là kỹ thuật vừa là pháp lý NĐ13 → gắn với A6 và cần tuân thủ ký. |
| **E5.3–E5.9** | **ĐỒNG Ý** | Đều là câu hỏi thật. E5.7 (nhập dữ liệu lịch sử) và E5.9 (file chưa `Clean` không được kích hoạt hợp đồng) là hai cái dễ gây sự cố sản xuất nhất. |

**Không có điểm nào của Codex em thấy sai.** Chỉ tinh chỉnh phạm vi ở E1 và mở rộng E4.

## F2. Lỗ hổng CẢ HAI bên còn bỏ sót [SUY]

- **F2.1 — Múi giờ nghiệp vụ (bổ trợ E4).** E4 chốt UTC cho audit là đúng, nhưng **số học nghiệp vụ phải tính theo giờ VN**: mốc nhắc 90/60/30/7 ngày, "đến hạn hôm nay", "quá hạn", chốt doanh thu theo tháng/quý. Nếu tính hạn bằng UTC, khách ở VN sẽ thấy lệch 1 ngày ở ranh giới. Quy tắc đề xuất: **lưu UTC, tính mốc nghiệp vụ theo `Asia/Ho_Chi_Minh`**, ghi rõ trong data dictionary từng cột dùng chuẩn nào.
- **F2.2 — Idempotency của nhắc hạn.** Blueprint bắt "mọi reminder phải audit" nhưng chưa chống **gửi trùng** khi job chạy lại/nhiều worker, và chưa chặn nhắc **sau khi đã gia hạn/hủy**. Cần khóa idempotency theo `(subscription_id, milestone, chu_kỳ)` và kiểm tra trạng thái đăng ký ngay trước khi gửi.
- **F2.3 — Proration (tính tiền theo tỷ lệ).** Chưa bên nào nói: hủy dịch vụ giữa kỳ, gia hạn sớm, đổi giá giữa chu kỳ thì tính tiền thế nào? Ảnh hưởng trực tiếp số liệu doanh thu. Cần chốt: có proration không, làm tròn ra sao. Tiền nên lưu **số nguyên đơn vị nhỏ nhất + mã tiền tệ**, không dùng float.
- **F2.4 — Context bắt buộc chọn, không mặc định im lặng.** Blueprint có context switcher nhưng nếu người dùng quên đổi context → bản ghi/luồng duyệt đi sai phòng ban. Đề xuất: khi người dùng có nhiều context, **bắt chọn tường minh** trước khi tạo nghiệp vụ, không tự chọn context gần nhất. (Khớp hiến pháp: quyền theo giao dịch, không theo chức danh.)
- **F2.5 — Resolver không tìm được người duyệt.** Approval engine dựa `DEPARTMENT_HEAD`/`POSITION_HOLDER`… nhưng khi ghế đó **trống** (chưa bổ nhiệm) thì yêu cầu kẹt. Cần định nghĩa fallback/escalation cho ca "no approver resolved" + cảnh báo, không để treo âm thầm.
- **F2.6 — Bootstrap RBAC & data residency.** (a) Ai là admin đầu tiên, seed role/permission thế nào — việc thực tế của Gate 0. (b) MinIO + backup chứa dữ liệu cá nhân nhạy cảm đặt **ở đâu** (on-prem/VN?) — NĐ13 quan tâm nơi lưu trú dữ liệu; cần phụ trách tuân thủ xác nhận.
- **F2.7 — Dữ liệu UAT không dùng PII thật.** Bộ UAT (2 công ty, 100 mộ…) không được dùng CCCD/giấy chứng tử của người thật → dùng dữ liệu tổng hợp. Vừa đúng làn cấm hiến pháp, vừa tránh rò rỉ khi test.

## F3. Gate 0 hợp nhất (cả 3 bên) — chốt trước khi code [SUY]

**Quyết định nghiệp vụ/pháp lý:** A2, A4, A5, A6 (gốc) + E5.1 Person đa công ty + E5.2 mã hóa/băm định danh + E5.3 merge + E5.7 nhập dữ liệu lịch sử + F2.6b nơi lưu trú dữ liệu.

**Quyết định kiến trúc ghi nhận ngay (ít tranh cãi, làm luôn):** tạo `grave_usage_right` tối thiểu (E1) · `payment_allocation` nhiều-nhiều từ đầu (F1/E2) · audit `occurred_at` = UTC + số học nghiệp vụ theo giờ VN (E4+F2.1) · tiền = số nguyên + mã tiền tệ (F2.3) · file chưa `Clean` không kích hoạt hợp đồng (E5.9).

## F4. Ghi chú quy trình

Ba luồng ý kiến (Claude soạn → Codex phản biện → Claude rà) đã hội tụ, **không còn bất đồng lớn**, chỉ còn các câu **[HỎI]** cần chủ nghiệp vụ + phụ trách tuân thủ trả lời. Theo hiến pháp INDEVCO, tài liệu này vẫn là **đề xuất đang bàn**; chỉ kết tinh thành hồ sơ trình duyệt sau khi người có thẩm quyền đánh giá đạt. Bước hợp lý tiếp theo: đưa Gate 0 (F3) ra họp lấy câu trả lời cho các mục [HỎI], rồi mới finalize ERD.

---

# PHẦN G — Phản biện Codex vòng 2: F2 và F3

> Kết luận: F2 nêu đúng 7 lỗ hổng có ảnh hưởng thực tế. Tuy nhiên F2.1 cần chỉnh về kiểu dữ liệu thời gian; F3 còn thiếu một số quyết định/gate kỹ thuật có thể làm sai phân quyền, workflow hoặc khả năng khôi phục dữ liệu nếu để sau.

## G1. Điều chỉnh F2.1 — không quy mọi dữ liệu thời gian về UTC [KHUYẾN NGHỊ]

Quy tắc "lưu UTC, tính nghiệp vụ giờ VN" là đúng cho **thời điểm xảy ra sự kiện**, như `occurred_at`, `created_at`, `approved_at`, thời điểm gửi reminder và thời hạn signed URL.

Nhưng các khái niệm thuần lịch nghiệp vụ không nên lưu thành UTC timestamp rồi quy đổi, vì có thể đổi ngày ở ranh giới múi giờ. Cần phân loại rõ trong data dictionary:

| Loại dữ liệu | Kiểu/chuẩn đề xuất | Ví dụ |
|---|---|---|
| Thời điểm tức thời | `timestamptz`, lưu/so sánh UTC | audit event, login, upload, payment received timestamp |
| Ngày nghiệp vụ | `date`, diễn giải theo lịch `Asia/Ho_Chi_Minh` | due date, effective_from/to, ngày an táng, ngày hết hạn dịch vụ |
| Giờ hẹn/lịch | local date-time + IANA timezone | lịch an táng, lịch chăm sóc, cuộc hẹn |

Với reminder theo 90/60/30/7 ngày, job phải tính từ `date` nghiệp vụ, chạy theo lịch Việt Nam và có ngưỡng giờ gửi được cấu hình. Đây là điều kiện để "đến hạn hôm nay" không lệch một ngày.

## G2. Bổ sung cho F2 — các lỗ hổng còn lại [KHUYẾN NGHỊ]

### G2.1. Outbox và idempotency cho mọi side effect

F2.2 mới nói về reminder. Cùng vấn đề còn áp dụng cho email, thông báo in-app, virus scan, payment import, export và webhook/tích hợp. Mỗi tác vụ gây tác động bên ngoài cần transactional outbox, khóa idempotency và trạng thái giao nhận; không gọi thẳng provider trong transaction nghiệp vụ.

Với reminder, khóa không chỉ là `(subscription_id, milestone, chu_kỳ)`: cần gắn cả **phiên bản/đợt đăng ký** và **kênh gửi**, ví dụ `(subscription_id, subscription_version, milestone_date, channel)`. Như vậy gia hạn mới vẫn được nhắc hợp lệ, còn retry của đợt cũ không gửi trùng.

### G2.2. Fallback approver phải giữ nguyên segregation of duties

F2.5 đúng nhưng fallback không thể chỉ là "đẩy lên người bất kỳ". Policy fallback phải được version hóa và snapshot vào approval instance; đồng thời luôn giữ các điều kiện: người tạo không tự duyệt, không tạo vòng lặp cấp trên, người được ủy quyền không vượt phạm vi, và escalation không tự biến thành phê duyệt.

Ca không resolve được approver nên có trạng thái rõ như `BLOCKED_NO_APPROVER`, SLA/cảnh báo cho owner workflow và chỉ được tiếp tục qua hành động được audit của người có quyền cấu hình/điều phối.

### G2.3. Import lịch sử cần cơ chế đối soát, không chỉ quyết định có/không

E5.7 đã đưa import lịch sử vào Gate 0, nhưng cần chốt cách nhập an toàn: raw file bất biến, mapping version hóa, dry-run, bản ghi lỗi vào quarantine, đối soát tổng số/tổng tiền trước-sau và đường rollback theo import batch. Import lặp lại phải idempotent; không dùng import để bypass validation, approval hoặc audit.

### G2.4. Khôi phục thảm họa có mục tiêu RPO/RTO

Blueprint yêu cầu backup/restore nhưng chưa có mục tiêu phục hồi. Gate 0 cần chủ sở hữu nghiệp vụ chấp nhận ít nhất: mất tối đa bao nhiêu dữ liệu (RPO), khôi phục trong bao lâu (RTO), thứ tự khôi phục PostgreSQL–object storage–audit manifest, và cách kiểm chứng quan hệ file metadata sau restore. Không có các ngưỡng này thì "backup hằng ngày" chưa phải yêu cầu vận hành có thể nghiệm thu.

### G2.5. Bootstrap và quyền khẩn cấp

F2.6a cần mở rộng thành quy trình: ai tạo admin đầu tiên, người đó được cấp quyền bằng đâu, quyền tối cao có thời hạn/đa phê duyệt thế nào, và có hay không tài khoản break-glass. Nếu có break-glass, mọi lần dùng phải MFA, có thời hạn, tạo security alert/audit và được rà soát hậu kiểm; không dùng chung mật khẩu hoặc tài khoản admin thường trực.

## G3. Bổ sung Gate 0 hợp nhất [KHUYẾN NGHỊ]

F3 nên giữ hai nhóm hiện có, đồng thời bổ sung các mục sau trước khi finalize ERD và triển khai nền tảng:

| Mã | Bổ sung vào Gate 0 | Lý do |
|---|---|---|
| G3.1 | Chốt mốc chuyển trạng thái hợp đồng nào làm phát sinh allocation và dữ liệu đủ điều kiện cho M5: `Verified`, `Active` hay hai bước tách biệt. | Tránh allocate/sinh công nợ hai lần hoặc quá sớm; đây chính là C-04.6 chưa được liệt kê trong F3. |
| G3.2 | Chốt mô hình thời gian ở G1 và đưa vào data dictionary. | Sai kiểu `date`/timestamp gây migration và lệch hạn dùng toàn hệ thống. |
| G3.3 | Phê duyệt policy context bắt buộc chọn (F2.4) và no-approver/fallback (F2.5). | Đây là policy quyền/workflow, không phải chi tiết UI có thể để sau. |
| G3.4 | Chốt quy trình bootstrap RBAC/break-glass (G2.5). | Tránh quyền quản trị ban đầu không kiểm soát hoặc không thể vận hành khi mất admin. |
| G3.5 | Chốt chiến lược import batch/đối soát (G2.3) và mục tiêu RPO/RTO (G2.4). | Đây là điều kiện an toàn để nhận dữ liệu cũ và vận hành dữ liệu thật. |

## G-KL. Kết luận vòng 2 [KHUYẾN NGHỊ]

F2 và F3 đã gần đủ để tổ chức Gate 0. Trước cuộc họp, nên sửa câu F2.1 thành phân loại ba loại thời gian ở G1 và thêm G3.1–G3.5 vào checklist chốt. Khi các mục đó có quyết định được phê duyệt, nhóm có thể finalize ERD nền tảng mà không phải đoán chính sách quan trọng trong lúc code.

---

# PHẦN H — Phản hồi Claude vòng 2: nhận sửa G1, chốt G2–G3, và tách lại Gate 0

> Người soạn: Claude (bên thứ ba rà vòng 2). Giữ [ĐO]/[SUY]/[HỎI]. Vẫn là NHÁP để bàn, chưa code.

## H1. Nhận sửa F2.1 theo G1 [ĐỒNG Ý — rút lại câu chữ cũ]

G1 đúng. Câu F2.1 của em ("lưu UTC, tính nghiệp vụ giờ VN") **áp dụng sai cho ngày thuần lịch**. Chốt lại theo 3 loại của Codex:
- **Thời điểm tức thời** → `timestamptz`, so sánh theo UTC (audit, login, upload, thời điểm nhận tiền).
- **Ngày nghiệp vụ** → kiểu `date`, diễn giải theo `Asia/Ho_Chi_Minh`, **không** đổi qua UTC (due date, effective_from/to, ngày an táng, ngày hết hạn dịch vụ).
- **Giờ hẹn/lịch** → local datetime + IANA timezone (lịch an táng, chăm sóc).

Đây là điểm phải ghi vào data dictionary; sai kiểu dữ liệu ở đây là lỗi migrate toàn hệ thống.

## H2. Chốt quan điểm với G2

| Mã | Quan điểm Claude | Tinh chỉnh thêm |
|---|---|---|
| **G2.1** outbox/idempotency cho mọi side effect; khóa reminder gắn version + channel | **ĐỒNG Ý** | Bổ sung: outbox event nên có `dedup_key` + `max_attempts` + dead-letter; provider ngoài (email/SMS/webhook) phải coi là *at-least-once*, phía nhận chịu idempotent. |
| **G2.2** fallback approver giữ segregation of duties, trạng thái `BLOCKED_NO_APPROVER` | **ĐỒNG Ý** | Thêm ca Codex chưa nêu: **ủy quyền hết hạn giữa lúc yêu cầu đang chạy**, và **người duyệt nghỉ việc giữa luồng** — phải re-resolve theo policy đã snapshot, không tự nhảy bừa. |
| **G2.3** import lịch sử có đối soát, dry-run, quarantine, rollback theo batch | **ĐỒNG Ý** | Không thêm; đã đủ. |
| **G2.4** mục tiêu RPO/RTO | **ĐỒNG Ý** | Thêm: restore phải về **điểm nhất quán chéo kho** (PostgreSQL ↔ MinIO ↔ audit manifest); sau restore phải **xoay khóa signed-URL/secret** vì backup có thể lộ khóa cũ. |
| **G2.5** bootstrap + break-glass | **ĐỒNG Ý** | Khớp hiến pháp INDEVCO (không token/tài khoản dùng chung; mọi thao tác để dấu vết). Break-glass mỗi lần dùng = 1 security alert + hậu kiểm. |

**Không có điểm nào của Codex vòng 2 em thấy sai.**

## H3. Phản biện lại Codex — Gate 0 đang bị nhồi quá tải [KHÔNG ĐỒNG Ý một phần]

G-KL nói "khi các mục G3.1–G3.5 được phê duyệt thì mới finalize ERD". **Em không đồng ý gộp tất cả vào một cửa.** Trộn quyết định *nghiệp vụ/data-model* (phải có trước khi vẽ ERD) với quyết định *vận hành production* (chỉ cần trước khi go-live dữ liệu thật) sẽ **làm nghẽn cuộc họp nghiệp vụ** bằng các câu hỏi hạ tầng mà chủ nghiệp vụ không trả lời được, và trì hoãn việc bắt đầu code nền tảng một cách không cần thiet.

Đề xuất **tách hai cửa**:

**GATE 0 — trước khi finalize ERD & viết code nền tảng** (cần chủ nghiệp vụ + tuân thủ):
- A2 (quyền sử dụng mộ), A4 (danh mục dịch vụ), A5 (nguồn "đã thu"), A6 (ai xem dữ liệu nhạy cảm)
- E5.1 (Person đa công ty), E5.2 (mã hóa vs băm định danh)
- G1 (mô hình 3 loại thời gian) — quyết định kỹ thuật nhưng chặn ERD
- G3.1 (mốc trạng thái hợp đồng sinh allocation/M5 — chính là C-04.6)
- F2.4 (context bắt buộc chọn) + F2.5/G2.2 (policy no-approver) — là **policy quyền/workflow**, chặn thiết kế authz

**GATE PROD — trước khi go-live với dữ liệu thật** (chủ yếu IT/vận hành + owner nghiệp vụ ký ngưỡng):
- G2.3 chiến lược import lịch sử/đối soát · E5.7
- G2.4 RPO/RTO + restore nhất quán chéo kho
- G2.5 bootstrap/break-glass RBAC
- C-10.4 manifest ký/niêm phong audit định kỳ · F2.6b nơi lưu trú dữ liệu (NĐ13)

Lý do [SUY]: RPO/RTO, break-glass, manifest ký, import lịch sử **không ảnh hưởng hình dạng ERD nền tảng**. Có thể bắt đầu M0–M1 song song trong khi các ngưỡng vận hành được chốt trước Gate Prod. Chỉ E5.7 (import lịch sử) cần *biết trước có hay không* vì ảnh hưởng thiết kế khóa dò trùng — nên câu **"có import dữ liệu cũ không?"** vẫn thuộc Gate 0, còn *cách* import thuộc Gate Prod.

## H4. Lỗ hổng cả hai bên bỏ sót — quản trị quyết định (theo hiến pháp INDEVCO) [SUY]

Sau 4 vòng nội dung đã chín, nhưng tài liệu **thiếu lớp quản trị quyết định** mà hiến pháp INDEVCO bắt buộc:
- Mỗi mục [HỎI]/Gate cần **chủ trả lời đích danh** + **hạn** + ô **decision_id** (để sau trỏ được "TGĐ/người ủy quyền đã quyết X"). Không có decision_id thì "đã chốt" chỉ là lời nói.
- Phiên họp Gate 0 phải **lấy số phiên** ở List SO-LAY-PHIEN trước khi bắt đầu; biên bản chốt là nguồn sự thật, tài liệu này chỉ là bản chiếu.
- Tài liệu hiện là **đề xuất đang bàn**; chỉ kết tinh thành *hồ sơ trình duyệt* sau khi người có thẩm quyền đánh giá đạt.

Đề xuất thêm 3 cột vào checklist Gate khi đưa ra họp: **Chủ trả lời | Hạn | decision_id (điền sau khi chốt)**.

## H-KL. Kết luận vòng 2 [SUY]

Nội dung **đã hội tụ — nên dừng mở rộng phạm vi rà** (rủi ro hiện tại là phân tích kéo dài, không phải thiếu phân tích). Ba việc còn lại đều là *thủ tục*, không phải *tranh luận*:
1. Nhận sửa G1 (mô hình thời gian) — đã đồng thuận.
2. Tách Gate 0 / Gate Prod theo H3 để cuộc họp nghiệp vụ không bị nghẽn bởi câu hỏi hạ tầng.
3. Gắn chủ trả lời + hạn + decision_id (H4) rồi đưa **Gate 0** ra họp lấy số phiên.

Khuyến nghị: chốt tài liệu ở đây, chuyển sang bản một trang Gate 0 cho cuộc họp. Không cần vòng phản biện thứ 3 trừ khi phát sinh câu hỏi mới.

---

# PHẦN I — Xác nhận Codex: tách gate và quản trị quyết định

## I1. Kết luận về H1–H4 [ĐỒNG Ý]

Codex đồng ý H1 và toàn bộ G2 được tinh chỉnh ở H2. Cách tách Gate 0/Gate Prod trong H3 hợp lý hơn đề xuất G3 ban đầu: các quyết định định hình ERD, phân quyền và workflow phải chốt trước code; các yêu cầu vận hành/khôi phục phải chốt trước khi đưa dữ liệu thật vào môi trường vận hành.

H4 là bổ sung bắt buộc: `decision_id`, chủ trả lời, hạn và số phiên họp biến các kết luận đang bàn thành quyết định có thể truy vết. Tài liệu này tiếp tục là tài liệu phân tích; biên bản có số phiên và quyết định được phê duyệt mới là nguồn sự thật.

## I2. Một điều kiện ranh giới cho Gate Prod [LƯU Ý]

"Cách import dữ liệu lịch sử" có thể nằm ở Gate Prod **nếu UAT chỉ dùng dữ liệu tổng hợp**. Nếu UAT cần dùng bản sao dữ liệu lịch sử/PII được phê duyệt, thiết kế import batch, mask, đối soát và rollback phải hoàn tất trước đợt UAT đó — có thể gọi là **Gate UAT dữ liệu thật**, không cần đưa trở lại Gate 0.

Tương tự, RPO/RTO, khôi phục nhất quán PostgreSQL–MinIO–audit manifest và xoay signed URL sau restore phải được kiểm thử đạt trước khi nhận dữ liệu thật hoặc go-live, tùy thời điểm nào đến trước.

## I-KL. Kết thúc phản biện

Không có phản biện kiến trúc mới. Đề xuất chấp nhận H3/H4, đóng vòng rà soát và lập checklist Gate 0 một trang có các cột `Mã quyết định | Câu hỏi | Chủ trả lời | Hạn | decision_id | Số phiên | Trạng thái`.

---

# PHẦN J — Chốt vòng: mô hình 3 cửa & đóng rà soát (Claude)

> Người soạn: Claude. Đóng vòng phản biện A–I. Vẫn là NHÁP để bàn, chưa code.

## J1. Nhận lưu ý I2 — tách thành 3 cửa [ĐỒNG Ý]

Codex đúng ở I2. Cửa vận hành không phải chỉ có "Gate Prod"; có một mốc trung gian khi UAT chạm dữ liệu thật. Chốt lại **3 cửa**:

| Cửa | Khi nào | Ai chốt | Nội dung |
|---|---|---|---|
| **GATE 0** | Trước khi finalize ERD & code nền tảng | Chủ nghiệp vụ + tuân thủ | A2, A4, A5, A6, E5.1, E5.2, G1, G3.1, F2.4, F2.5/G2.2 + câu *"có import dữ liệu cũ không?"* |
| **GATE UAT dữ liệu thật** | Trước đợt UAT dùng bản sao dữ liệu lịch sử/PII được phê duyệt (nếu có) | IT + tuân thủ + owner nghiệp vụ | import batch + mask + đối soát + rollback (G2.3/E5.7) phải hoàn tất & kiểm thử đạt |
| **GATE PROD** | Trước go-live dữ liệu thật / nhận dữ liệu thật (mốc nào đến trước) | IT/vận hành + owner ký ngưỡng | RPO/RTO + restore nhất quán chéo kho + xoay signed-URL (G2.4), bootstrap/break-glass (G2.5), manifest ký audit (C-10.4), nơi lưu trú dữ liệu NĐ13 (F2.6b) |

Nếu UAT chỉ dùng dữ liệu tổng hợp thì Gate UAT dữ liệu thật không phát sinh; import lịch sử lùi hẳn về Gate Prod.

## J2. Trạng thái vòng phản biện

Vòng A–I đã hội tụ: **không còn bất đồng kiến trúc**. Mọi mục còn lại là **[HỎI]** (chờ người có thẩm quyền) hoặc **thủ tục** (số phiên, decision_id). Theo hiến pháp INDEVCO, đây vẫn là *đề xuất đang bàn*; biên bản họp có số phiên + quyết định được phê duyệt mới là nguồn sự thật.

## J3. Sản phẩm kèm theo

Checklist Gate 0 một trang đưa ra họp: xem file `13-GATE-0-CHECKLIST-MOT-TRANG.md` (cùng thư mục). Đóng vòng rà soát tại đây.
