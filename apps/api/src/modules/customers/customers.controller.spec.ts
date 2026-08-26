import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { CustomersController } from './customers.controller';

/* Thứ tự khai route là một BẤT BIẾN, không phải chuyện thẩm mỹ.
 *
 * Express khớp route theo thứ tự đăng ký, và Nest đăng ký theo thứ tự phương thức khai
 * trong lớp. Nên `customers/:id` đứng trước `customers/search` sẽ nuốt luôn đường tìm
 * kiếm: "search" bị nhận làm id, và người dùng thấy 404 "Không tìm thấy khách hàng" khi
 * gõ vào ô tìm kiếm — một triệu chứng không dẫn tới nguyên nhân.
 *
 * Lỗi này đã xảy ra thật lúc thêm endpoint chi tiết (26/08/2026). Test này giữ cho nó
 * không quay lại, kể cả khi ai đó sắp xếp lại các phương thức cho "gọn".
 */
function handlerOrder(): string[] {
  const proto = CustomersController.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const fn = proto[name];
      const path: unknown =
        typeof fn === 'function' ? Reflect.getMetadata('path', fn as object) : undefined;
      return typeof path === 'string' ? path : '';
    })
    .filter((path) => path !== '');
}

describe('CustomersController — thứ tự route', () => {
  it('đọc được đường dẫn của các handler (tự kiểm cái quét)', () => {
    const paths = handlerOrder();
    expect(paths).toContain('customers/search');
    expect(paths).toContain('customers/:id');
  });

  it('`customers/search` phải khai TRƯỚC `customers/:id`', () => {
    const paths = handlerOrder();
    expect(
      paths.indexOf('customers/search'),
      'route tĩnh phải đứng trước route có tham số, nếu không nó bị nuốt',
    ).toBeLessThan(paths.indexOf('customers/:id'));
  });

  it('mọi route tĩnh dưới `customers/` đều đứng trước route tham số', () => {
    const paths = handlerOrder();
    const paramIndex = paths.indexOf('customers/:id');
    const staticAfterParam = paths
      .slice(paramIndex + 1)
      .filter((p) => p.startsWith('customers/') && !p.includes(':'));
    expect(staticAfterParam, 'những route này sẽ không bao giờ khớp').toEqual([]);
  });
});
