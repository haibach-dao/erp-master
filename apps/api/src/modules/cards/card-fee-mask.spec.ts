import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PERMISSION_CATALOG } from '../authorization/permission-catalog';
import { MASK_RULES_KEY } from '../../common/masking/mask.decorator';
import { CARD_FEE_MASK_RULES } from './card-fee-mask';
import { CardsController } from './cards.controller';
import { CardApprovalsController } from './card-approvals.controller';

/* LƯỚI CHE TIỀN PHÍ THẺ MỘ — bộ này tồn tại vì một cảnh báo tự viết ra rồi thành sự thật.
 *
 * `cards.controller.ts` có sẵn chú thích: "không test nào kiểm chuỗi trong `@MaskUnless`
 * (`masking-invariants.spec.ts` chỉ soi `SENSITIVE_FIELDS`), nên một mã gõ sai ở đây che vĩnh
 * viễn với MỌI người — kể cả ADMIN — mà không lỗi, không cảnh báo."
 *
 * Lát 1 làm lộ ra vế còn lại của cùng lỗ đó: thêm một controller trả CÙNG những con số tiền mà
 * QUÊN khai luật che, thì cũng không gì báo — chỉ khác là lần này dữ liệu chảy RA thay vì bị
 * giấu đi. Một lượt soi độc lập bắt được 07/09/2026 trước khi mở PR.
 */
describe('lưới che tiền phí thẻ mộ', () => {
  const reflector = new Reflector();

  /* Mã gõ sai không nổ ở đâu cả — guard chỉ thấy một chuỗi không ai cầm và che với tất cả. */
  it('mọi mã quyền trong sổ luật đều CÓ THẬT trong danh mục', () => {
    const known = new Set(PERMISSION_CATALOG.map((d) => d.code));
    for (const rule of CARD_FEE_MASK_RULES) {
      expect(known.has(rule.permission)).toBe(true);
    }
  });

  /* `quoteTotal` là tên trường MỚI của lát 1 và không trùng luật che nào khác trong hệ — thiếu
   * nó thì nó KHÔNG BAO GIỜ bị che ở bất kỳ đâu. */
  it('sổ luật phủ đủ BỐN tên trường tiền, gồm cả quoteTotal', () => {
    const fields = CARD_FEE_MASK_RULES.map((r) => r.field).sort();
    expect(fields).toEqual(['feeAmount', 'quoteTotal', 'totalAmount', 'unitPrice']);
  });

  /* Đây là ca bắt lỗi thật: một controller mới trả số tiền mà quên khai luật che.
   *
   * Kiểm CẢ HAI cùng một phép so — thêm controller thứ ba sau này mà quên thì thêm nó vào
   * mảng dưới là thấy ngay, còn quên hẳn thì ít nhất chỗ này nhắc rằng có một sổ để chép. */
  it.each([
    ['CardsController', CardsController],
    ['CardApprovalsController', CardApprovalsController],
  ])('%s khai đủ sổ luật che', (_name, target) => {
    const rules = reflector.get<readonly { field: string; permission: string }[]>(
      MASK_RULES_KEY,
      target,
    );
    expect(rules).toBeDefined();
    const fields = (rules ?? []).map((r) => r.field).sort();
    expect(fields).toEqual(['feeAmount', 'quoteTotal', 'totalAmount', 'unitPrice']);
  });
});
