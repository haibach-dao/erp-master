-- Ai SOẠN hợp đồng. Bảng đã có `verified_by` và `activated_by` nhưng thiếu cột này,
-- nên bất biến "người soạn không tự thẩm định hợp đồng của mình" không kiểm được.
-- Dòng cũ nhận NULL: không biết ai soạn thì không khẳng định được là trùng người, và
-- bất biến bên dưới chỉ chặn khi biết CHẮC hai bên là một.
ALTER TABLE "contracts"."external_contracts" ADD COLUMN "created_by" TEXT;
