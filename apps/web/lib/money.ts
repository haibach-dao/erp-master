/* Money coming from the API may be masked: the server replaces the value with '***'
 * when the caller lacks the permission that unlocks that field. Formatting has to
 * survive that — `Number('***')` is NaN, and "NaNđ" reads like a bug rather than like
 * "you are not allowed to see this".
 */
export const MASKED = '***';

export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const amount = Number(value);
  if (Number.isNaN(amount)) {
    return MASKED;
  }
  return `${amount.toLocaleString('vi-VN')}đ`;
}
