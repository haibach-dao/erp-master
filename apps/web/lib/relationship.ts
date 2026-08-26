/* Quan hệ nhân thân: LƯU chung, HIỆN cụ thể.
 *
 * Danh mục chỉ có 4 mã — PARENT, CHILD, SPOUSE, SIBLING — và đó là cố ý. "Bố đẻ" với "mẹ
 * đẻ" KHÔNG phải hai quan hệ khác nhau: chúng là cùng một quan hệ làm cha mẹ, khác nhau ở
 * GIỚI TÍNH của người đó. Lưu thành hai mã riêng là chép giới tính vào mã quan hệ, và khi
 * ai đó sửa giới tính thì quan hệ hoá ra sai mà không ai biết.
 *
 * Nên nhãn cụ thể được SUY RA lúc hiển thị, từ ba thứ:
 *   - mã quan hệ
 *   - giới tính của người mang vai đó
 *   - với anh/chị/em: ai sinh trước (tiếng Việt phân biệt anh với em, tiếng Anh thì không)
 *
 * Thiếu dữ liệu thì lùi về nhãn chung — "Bố/Mẹ đẻ" đọc vẫn hiểu, còn đoán bừa "Bố đẻ" cho
 * một người chưa khai giới tính là ghi vào màn hình một điều chưa ai xác nhận.
 */

export type Gender = string | null | undefined;

/** So tuổi: 'older' = người mang vai sinh TRƯỚC người kia. `null` khi thiếu dữ liệu. */
export type BirthOrder = 'older' | 'younger' | null;

const LABEL: Record<string, (g: Gender, order: BirthOrder) => string> = {
  PARENT: (g) => (g === 'MALE' ? 'Bố đẻ' : g === 'FEMALE' ? 'Mẹ đẻ' : 'Bố/Mẹ đẻ'),
  CHILD: (g) => (g === 'MALE' ? 'Con trai' : g === 'FEMALE' ? 'Con gái' : 'Con'),
  SPOUSE: (g) => (g === 'MALE' ? 'Chồng' : g === 'FEMALE' ? 'Vợ' : 'Vợ/Chồng'),
  SIBLING: (g, order) => {
    if (g === 'MALE') {
      return order === 'older' ? 'Anh trai' : order === 'younger' ? 'Em trai' : 'Anh/Em trai';
    }
    if (g === 'FEMALE') {
      return order === 'older' ? 'Chị gái' : order === 'younger' ? 'Em gái' : 'Chị/Em gái';
    }
    return order === 'older' ? 'Anh/Chị' : order === 'younger' ? 'Em' : 'Anh/Chị/Em';
  },
  /* Không phải mã trong danh mục — là trường hợp chủ mộ tự an táng vào mộ mình đứng tên.
   * Có nhánh riêng vì tra bảng sẽ không ra và rơi về hiện nguyên mã "SELF". */
  SELF: () => 'Chính chủ mộ',
};

/**
 * Nhãn cho vai của MỘT NGƯỜI trong quan hệ.
 * `gender` là giới tính của chính người mang vai đó, không phải của người kia.
 */
export function relationshipLabel(code: string, gender: Gender, order: BirthOrder = null): string {
  const fn = LABEL[code];
  return fn === undefined ? code : fn(gender, order);
}

/* Ai sinh trước.
 *
 * Ngày sinh có thể đã bị lớp che rút thành NĂM (chuỗi 4 chữ số) với người không cầm
 * `crm.person.view_contact`. So theo năm vẫn đúng cho phần lớn trường hợp; cùng năm thì
 * trả `null` thay vì đoán — "anh" hay "em" đoán sai là sai một điều người ta để ý.
 */
export function birthOrder(subject: string | null, other: string | null): BirthOrder {
  if (subject === null || other === null || subject === '' || other === '') {
    return null;
  }
  const yearOnly = /^\d{4}$/;
  if (yearOnly.test(subject) || yearOnly.test(other)) {
    const a = Number(subject.slice(0, 4));
    const b = Number(other.slice(0, 4));
    if (Number.isNaN(a) || Number.isNaN(b) || a === b) return null;
    return a < b ? 'older' : 'younger';
  }
  const a = new Date(subject).getTime();
  const b = new Date(other).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return null;
  return a < b ? 'older' : 'younger';
}

/** Mã đối ứng — cùng bảng với `relationship_types.reciprocal_code` bên server. */
const RECIPROCAL: Record<string, string> = {
  PARENT: 'CHILD',
  CHILD: 'PARENT',
  SPOUSE: 'SPOUSE',
  SIBLING: 'SIBLING',
};

export function reciprocalOf(code: string): string | null {
  return RECIPROCAL[code] ?? null;
}

export interface PersonSide {
  fullName: string;
  gender: Gender;
  dateOfBirth: string | null;
}

/* Hai câu đọc được cho MỘT quan hệ.
 *
 * Quan hệ vốn hai chiều, nhưng người nhập chỉ khai một chiều — và đó là chỗ dễ nhầm nhất:
 * "chọn Cha/Mẹ" là ai làm cha mẹ ai? Hiện cả hai câu ra màn hình thì không còn chỗ hiểu
 * sai, và người nhập tự thấy mình chọn ngược trước khi bấm lưu.
 *
 * Quy ước lưu trữ: `source --CODE--> target` nghĩa là "source LÀ code của target".
 */
export function bothDirections(
  source: PersonSide,
  target: PersonSide,
  code: string,
): { forward: string; backward: string } {
  const order = birthOrder(source.dateOfBirth, target.dateOfBirth);
  const forwardRole = relationshipLabel(code, source.gender, order);

  const back = reciprocalOf(code);
  const backwardRole =
    back === null
      ? code
      : relationshipLabel(
          back,
          target.gender,
          order === null ? null : order === 'older' ? 'younger' : 'older',
        );

  return {
    forward: `${source.fullName} là ${forwardRole} của ${target.fullName}`,
    backward: `${target.fullName} là ${backwardRole} của ${source.fullName}`,
  };
}
