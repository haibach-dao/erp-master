import { describe, expect, it, vi } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { MaskingInterceptor } from './masking.interceptor';
import { MASK_RULES_KEY, REVEAL_FIELDS_KEY, type MaskRule } from './mask.decorator';
import type { PermissionsService } from '../../modules/authorization/permissions.service';
import type { PermissionGrant } from '../../modules/authorization/policy.types';

function run(opts: {
  body: unknown;
  rules?: MaskRule[];
  grants?: PermissionGrant[];
  userId?: string;
  wildcardExempt?: boolean;
  unknownCode?: boolean;
  reveal?: string[];
}): Promise<unknown> {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === MASK_RULES_KEY) return opts.rules;
      if (key === REVEAL_FIELDS_KEY) return opts.reveal;
      return undefined;
    },
  } as unknown as Reflector;

  const permissions = {
    getGrants: vi.fn().mockResolvedValue(opts.grants ?? []),
    getPermissionMeta: vi
      .fn()
      .mockResolvedValue(
        opts.unknownCode === true
          ? null
          : { code: 'x', sensitivity: 'S3', wildcardExempt: opts.wildcardExempt ?? true },
      ),
  } as unknown as PermissionsService;

  const context = {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({
      getRequest: () => (opts.userId === undefined ? {} : { user: { userId: opts.userId } }),
    }),
  } as unknown as ExecutionContext;

  const next: CallHandler = { handle: () => of(opts.body) };
  return lastValueFrom(
    new MaskingInterceptor(reflector, permissions).intercept(context, next) as never,
  );
}

const AMOUNT: MaskRule = { field: 'totalAmount', permission: 'contract.amount.view_sensitive' };

describe('MaskingInterceptor — fields the caller may not read', () => {
  it('masks a declared field when the caller lacks the unlocking code', async () => {
    const out = await run({
      body: { id: 'c1', totalAmount: '250000000' },
      rules: [AMOUNT],
      userId: 'u1',
    });
    expect(out).toEqual({ id: 'c1', totalAmount: '***' });
  });

  it('leaves the value alone when the caller holds the code by name', async () => {
    const out = await run({
      body: { id: 'c1', totalAmount: '250000000' },
      rules: [AMOUNT],
      userId: 'u1',
      grants: [{ permission: 'contract.amount.view_sensitive', scope: 'COMPANY' }],
    });
    expect(out).toEqual({ id: 'c1', totalAmount: '250000000' });
  });

  it('a wildcard grant does not unmask a wildcard-exempt field', async () => {
    const out = await run({
      body: { totalAmount: '1' },
      rules: [AMOUNT],
      userId: 'u1',
      grants: [{ permission: '*.*.*', scope: 'GROUP' }],
    });
    expect(out).toEqual({ totalAmount: '***' });
  });

  it('masks inside arrays and nested objects, not just at the top level', async () => {
    const out = await run({
      body: { data: [{ totalAmount: '1' }, { totalAmount: '2' }], page: 1 },
      rules: [AMOUNT],
      userId: 'u1',
    });
    expect(out).toEqual({ data: [{ totalAmount: '***' }, { totalAmount: '***' }], page: 1 });
  });

  it('fails closed: no authenticated caller means the field stays masked', async () => {
    const out = await run({ body: { totalAmount: '1' }, rules: [AMOUNT] });
    expect(out).toEqual({ totalAmount: '***' });
  });

  it('fails closed: an unlocking code missing from the catalog never unmasks', async () => {
    const out = await run({
      body: { totalAmount: '1' },
      rules: [AMOUNT],
      userId: 'u1',
      unknownCode: true,
      grants: [{ permission: 'contract.amount.view_sensitive', scope: 'COMPANY' }],
    });
    expect(out).toEqual({ totalAmount: '***' });
  });

  it('keeps null as null rather than turning "no value" into "hidden value"', async () => {
    const out = await run({ body: { totalAmount: null }, rules: [AMOUNT], userId: 'u1' });
    expect(out).toEqual({ totalAmount: null });
  });

  it('the year strategy keeps the year and drops the rest of a date', async () => {
    const out = await run({
      body: { dateOfBirth: new Date('1975-04-30T00:00:00Z') },
      rules: [{ field: 'dateOfBirth', permission: 'crm.person.view_sensitive', strategy: 'year' }],
      userId: 'u1',
    });
    expect(out).toEqual({ dateOfBirth: '1975' });
  });
});

describe('MaskingInterceptor — fields nobody may read', () => {
  it('strips never-serialize fields even with no rules and no caller', async () => {
    const out = await run({
      body: { id: 'p1', fullName: 'A', nationalIdCipher: 'xx', nationalIdHash: 'yy' },
    });
    expect(out).toEqual({ id: 'p1', fullName: 'A' });
  });

  it('strips them from nested rows too', async () => {
    const out = await run({
      body: { data: [{ person: { nationalIdCipher: 'xx', nationalIdMasked: '079***123' } }] },
    });
    expect(out).toEqual({ data: [{ person: { nationalIdMasked: '079***123' } }] });
  });

  it('leaves values that are not plain objects untouched', async () => {
    const when = new Date('2026-08-25T00:00:00Z');
    const out = (await run({ body: { occurredAt: when } })) as { occurredAt: Date };
    expect(out.occurredAt).toBe(when);
  });
});

/* Sổ trường nhạy cảm áp cho MỌI response, không cần route nhớ khai. Đây là chỗ sửa khiếm
 * khuyết lớn nhất của cách cũ: trước đây trường nhạy cảm THÊM VÀO SAU mặc định lọt ra.
 */
describe('MaskingInterceptor — sổ trường nhạy cảm toàn hệ', () => {
  it('che phone/email dù route KHÔNG khai gì cả', async () => {
    const out = await run({
      body: { id: 'c1', phone: '0901234567', email: 'a@b.vn' },
      userId: 'u1',
    });
    expect(out).toEqual({ id: 'c1', phone: '***', email: '***' });
  });

  it('che ngày sinh thành NĂM — đủ đối chiếu, không đủ định danh', async () => {
    const out = (await run({
      body: { dateOfBirth: new Date('1975-04-30T00:00:00Z') },
      userId: 'u1',
    })) as { dateOfBirth: string };
    expect(out.dateOfBirth).toBe('1975');
  });

  it('che ipAddress trong nhật ký — dữ liệu cá nhân theo NĐ13', async () => {
    const out = await run({
      body: { action: 'AUTH.LOGIN_OK', ipAddress: '10.0.0.7' },
      userId: 'u1',
    });
    expect(out).toEqual({ action: 'AUTH.LOGIN_OK', ipAddress: '***' });
  });

  it('mở khoá khi người gọi cầm mã tương ứng', async () => {
    const out = await run({
      body: { phone: '0901234567' },
      userId: 'u1',
      grants: [{ permission: 'crm.person.view_sensitive', scope: 'GROUP' }],
    });
    expect(out).toEqual({ phone: '0901234567' });
  });

  it('che cả trong bản ghi lồng nhau — chỗ dễ lọt nhất', async () => {
    const out = await run({
      body: { data: [{ person: { fullName: 'A', phone: '0901234567' } }] },
      userId: 'u1',
    });
    expect(out).toEqual({ data: [{ person: { fullName: 'A', phone: '***' } }] });
  });

  it('KHÔNG che tên người — che thì hệ không dùng được, bảo vệ bằng quyền route', async () => {
    const out = await run({ body: { fullName: 'Nguyễn Văn A' }, userId: 'u1' });
    expect(out).toEqual({ fullName: 'Nguyễn Văn A' });
  });
});

/* Sổ khớp theo TÊN, nên có chỗ cùng tên mà khác nghĩa: `email` của một Person là dữ liệu
 * cá nhân; `email` của chính người đang đăng nhập là dữ liệu của họ.
 */
describe('MaskingInterceptor — @RevealFields miễn cho đúng một route', () => {
  it('miễn trường được khai, giữ nguyên giá trị', async () => {
    const out = await run({ body: { email: 'toi@erp.vn' }, userId: 'u1', reveal: ['email'] });
    expect(out).toEqual({ email: 'toi@erp.vn' });
  });

  it('chỉ miễn ĐÚNG trường đó, các trường khác vẫn bị che', async () => {
    const out = await run({
      body: { email: 'toi@erp.vn', phone: '0901234567' },
      userId: 'u1',
      reveal: ['email'],
    });
    expect(out).toEqual({ email: 'toi@erp.vn', phone: '***' });
  });

  it('KHÔNG miễn được trường bị cấm serialize tuyệt đối', async () => {
    const out = await run({
      body: { nationalIdCipher: 'xx', email: 'toi@erp.vn' },
      userId: 'u1',
      reveal: ['email', 'nationalIdCipher'],
    });
    expect(out).toEqual({ email: 'toi@erp.vn' });
  });
});
