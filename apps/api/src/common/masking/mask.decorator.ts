import { SetMetadata } from '@nestjs/common';

export const MASK_RULES_KEY = 'maskRules';

/* Named fields that must never leave the API at all, for anybody, at any permission
 * level. These are the raw material behind a masked value — the ciphertext and the
 * lookup hash of a national id, a password hash. Handing them out defeats the masking
 * completely, and no role should be able to ask for them through a business endpoint.
 */
export const NEVER_SERIALIZE = [
  'nationalIdCipher',
  'nationalIdHash',
  'passwordHash',
  'refreshTokenHash',
] as const;

export type MaskStrategy = 'redact' | 'year';

export interface MaskRule {
  /** Property name as it appears in the response body. */
  field: string;
  /** Caller must hold this code to see the real value. */
  permission: string;
  /** `redact` -> '***'. `year` -> keep the year of a date only. */
  strategy?: MaskStrategy;
}

/* Declare which response fields are masked unless the caller holds a specific code.
 *
 * This is the field-level half of the model: the route's single @RequirePermission says
 * whether the caller may call the endpoint at all, and these rules say which columns of
 * the answer they are allowed to actually read. Masking has to happen here, on the way
 * out of the API — an API that returns the real number and asks the UI to hide it has
 * not hidden anything (doc 16 §D.9).
 */
export const MaskUnless = (...rules: MaskRule[]) => SetMetadata(MASK_RULES_KEY, rules);

export const REVEAL_FIELDS_KEY = 'revealFields';

/* Miễn một trường khỏi sổ trường nhạy cảm áp toàn hệ, cho ĐÚNG route này.
 *
 * Sổ đó khớp theo TÊN trường, nên có chỗ cùng tên mà khác nghĩa: `email` của một Person là
 * dữ liệu cá nhân, `email` của chính người đang đăng nhập là dữ liệu của họ. Route nào
 * trả trường đó một cách chính đáng thì phải NÓI RA — và nói ra là một quyết định đọc
 * được trong code review, khác hẳn với việc quên khai rồi mặc định lọt.
 *
 * Không miễn được `NEVER_SERIALIZE`: những trường đó không có ngữ cảnh nào là hợp lệ.
 */
export const RevealFields = (...fields: string[]) => SetMetadata(REVEAL_FIELDS_KEY, fields);
