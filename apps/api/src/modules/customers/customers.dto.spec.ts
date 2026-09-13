import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto';

/* CỬA VÀO CỦA HỒ SƠ KHÁCH HÀNG — ô công ty.
 *
 * QUYẾT ĐỊNH CỦA ANH BÁCH, 09/09/2026: bắt buộc chọn công ty khi TẠO khách, và mở đường SỬA
 * công ty về sau. Ép ở DTO + SERVICE + MÀN HÌNH; cột `cemetery.customers.company_id` VẪN cho
 * phép NULL ở tầng CSDL theo đúng quyết định 27/08/2026 — không migration, không CHECK.
 *
 * Nghĩa là hàng rào duy nhất ở tầng này CHÍNH LÀ mấy dòng decorator dưới đây, nên chúng phải
 * có test riêng. Chạy qua đúng `ValidationPipe` mà `main.ts:20` dựng (`whitelist: true`,
 * `transform: true`), không tự gọi `validate()` — hai thứ đó khác nhau ở đúng chỗ đau nhất:
 * `whitelist: true` VỨT IM LẶNG mọi trường không được khai trong DTO. Một `companyId` gửi lên
 * mà DTO không khai thì không có lỗi nào cả, payload chỉ đơn giản là mất trường đó trên đường
 * xuống service — đúng cái đã xảy ra với `UpdateCustomerDto` cho tới hôm nay.
 */
const pipe = new ValidationPipe({ whitelist: true, transform: true });

const CREATE = { type: 'body' as const, metatype: CreateCustomerDto };
const UPDATE = { type: 'body' as const, metatype: UpdateCustomerDto };

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const res = (e as BadRequestException).getResponse();
    return JSON.stringify(res);
  }
  return '';
}

describe('CreateCustomerDto — công ty là BẮT BUỘC', () => {
  it('thiếu hẳn companyId thì TỪ CHỐI', async () => {
    await expect(
      pipe.transform({ type: 'ORGANIZATION', orgName: 'Cty X' }, CREATE),
    ).rejects.toThrow(BadRequestException);
  });

  /* CHUỖI RỖNG là ca đã tới được THẬT trước lượt này: DTO chỉ `@IsOptional() @IsString()`
   * (không `@IsNotEmpty`), `createCustomer` ghi thẳng `dto.companyId ?? null`, và bảng
   * `customers` không có CHECK nào trên `company_id`. Nên `''` lưu nguyên chữ rỗng, rồi mọi
   * hàng rào so `=== null` coi hồ sơ đó là ĐÃ CÓ công ty. */
  it('companyId là CHUỖI RỖNG thì TỪ CHỐI, không lặng lẽ nhận', async () => {
    await expect(
      pipe.transform({ type: 'ORGANIZATION', orgName: 'Cty X', companyId: '' }, CREATE),
    ).rejects.toThrow(BadRequestException);
  });

  /* Toàn khoảng trắng cũng là trống. `@IsNotEmpty` KHÔNG cắt khoảng trắng, nên thiếu bước
   * `@Transform(trim)` thì `'   '` đi lọt và được lưu như một công ty có thật — cùng hậu quả
   * với chuỗi rỗng, chỉ khác là nhìn mắt thường không thấy. */
  it('companyId TOÀN KHOẢNG TRẮNG thì TỪ CHỐI', async () => {
    await expect(
      pipe.transform({ type: 'ORGANIZATION', orgName: 'Cty X', companyId: '   ' }, CREATE),
    ).rejects.toThrow(BadRequestException);
  });

  it('câu báo lỗi bằng TIẾNG VIỆT và nói rõ phải chọn công ty', async () => {
    const msg = await messageOf(pipe.transform({ type: 'ORGANIZATION', orgName: 'Cty X' }, CREATE));

    expect(msg).toMatch(/công ty/i);
  });

  it('có companyId hợp lệ thì đi qua và GIỮ NGUYÊN giá trị', async () => {
    const out = (await pipe.transform(
      { type: 'ORGANIZATION', orgName: 'Cty X', companyId: 'cty-A' },
      CREATE,
    )) as CreateCustomerDto;

    expect(out.companyId).toBe('cty-A');
  });
});

describe('UpdateCustomerDto — companyId phải được KHAI thì mới đi xuống được', () => {
  /* Đây là phép kiểm chính của khối này, và nó không thể viết bằng `validate()`: DTO cũ
   * KHÔNG khai `companyId`, nên payload có `companyId` vẫn hợp lệ 100% — `whitelist: true`
   * chỉ lặng lẽ cắt trường đó ra. Màn hình gửi đúng, API trả 200, và cột không đổi. */
  it('companyId gửi lên KHÔNG bị whitelist cắt mất', async () => {
    const out = (await pipe.transform({ companyId: 'cty-B' }, UPDATE)) as UpdateCustomerDto;

    expect(out.companyId).toBe('cty-B');
  });

  /* Tuỳ chọn thật: không gửi thì không đổi. Ép bắt buộc ở đường SỬA là bắt người chỉ muốn
   * sửa số điện thoại phải nhắc lại công ty — và một trường bắt buộc bị nhắc lại máy móc là
   * chỗ người ta chọn nhầm. */
  it('không gửi companyId thì không sao, và không tự đẻ ra trường đó', async () => {
    const out = (await pipe.transform({ phone: '0900000000' }, UPDATE)) as UpdateCustomerDto;

    expect(out.companyId).toBeUndefined();
  });
});
