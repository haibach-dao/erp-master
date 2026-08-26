-- Gỡ `crm.person.search` khỏi danh mục quyền.
--
-- Mã này được thêm sáng 26/08/2026 với lý do: "người được an táng thường không phải khách
-- hàng, nên tìm trong danh sách khách sẽ không bao giờ ra họ". Lý do đó SAI — chủ doanh
-- nghiệp đã chốt người mất CŨNG LÀ khách hàng. Sau khi sửa, không đường nào còn dùng tới
-- nó.
--
-- Gỡ khỏi DANH MỤC chứ không chỉ gỡ khỏi vai: mã còn trong danh mục là mã còn cấp lại
-- được từ màn hình quản trị, và cấp một mã không route nào dùng là tạo ra một quyền vô
-- nghĩa mà người rà soát phải đi tìm hiểu.

DELETE FROM authz.role_permissions
WHERE permission_id IN (SELECT id FROM authz.permissions WHERE code = 'crm.person.search');

DELETE FROM authz.permissions WHERE code = 'crm.person.search';
