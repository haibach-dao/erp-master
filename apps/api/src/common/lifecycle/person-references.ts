import { activeBurial } from './active';

/* SỔ ĐĂNG KÝ THỨ HAI: mọi thứ trong hệ trỏ tới một HỒ SƠ NHÂN THÂN.
 *
 * VÌ SAO CÓ FILE NÀY — chú thích trong `deleteCustomer` đã tự đoán trước chỗ này sẽ hỏng:
 *
 *   "Các bảng dưới đây khoá theo NHÂN THÂN, không theo khách hàng — nên chúng không nằm
 *    trong sổ đăng ký theo cột khách hàng. Sổ đăng ký cho `Person` vẫn CHƯA có; đây chính
 *    là chỗ sẽ hỏng lần sau nếu thêm bảng trỏ vào `persons`."
 *
 * Nó hỏng thật, ngày 27/08/2026, đúng theo cách đã đoán. Rào chắn "đã được an táng" bị
 * ĐẨY TAY vào danh sách chặn ở `deleteCustomer` thay vì sinh ra từ sổ, nên nó là mục
 * DUY NHẤT không có `identify` — lời từ chối nói "đã được an táng (1 hồ sơ)" mà không nói
 * mộ nào, cốt nào. Chủ doanh nghiệp đọc câu đó, không thấy hồ sơ đó ở đâu trên màn hình,
 * và kết luận là hệ chưa cập nhật trạng thái. Câu từ chối đúng nhưng vô dụng cũng là một
 * lỗi, không phải một chi tiết hình thức.
 *
 * Nên sổ này tồn tại vì đúng lý do sổ theo khách hàng tồn tại: rào chắn SINH RA từ danh
 * sách, và một test đối chiếu danh sách với `schema.prisma` — thêm bảng trỏ vào `persons`
 * mà quên khai là GÃY BUILD.
 *
 * KHÁC sổ theo khách hàng ở một điểm, và đó là điểm phải đọc kỹ: cột trỏ tới nhân thân
 * KHÔNG phải lúc nào cũng chứa thẳng `Person.id`. `BurialRecord.deceasedPersonId` chứa
 * `DeceasedPerson.id` — tên cột có chữ `PersonId` nhưng nó trỏ vào bảng khác. Đó chính là
 * cái bẫy đã làm rào chắn an táng phải viết tay ngay từ đầu. Nên ở đây mỗi mục tự khai
 * CÁCH HỎI (`where`) từ một `personId`, thay vì để nơi gọi giả định `{ [column]: id }`.
 */

/** Thứ chặn xoá hồ sơ nhân thân: việc đã xảy ra ngoài đời, không rút lại bằng một nút bấm. */
export interface PersonBlockingReference {
  /** Tên model Prisma — dùng cho test đối chiếu với schema. */
  model: string;
  /** Cột trong schema trỏ (trực tiếp hoặc gián tiếp) tới nhân thân — dùng cho test. */
  column: string;
  /* Cách hỏi "còn dòng nào đang chặn không" từ một `personId`.
   *
   * Là HÀM chứ không phải `{ [column]: personId }`: xem chú thích đầu file — có cột mang
   * tên `...PersonId` mà giá trị lại là id của bảng trung gian. Bắt mỗi mục tự khai đường
   * đi là cách duy nhất để cái tên cột không nói dối nơi gọi. */
  where: (personId: string, now: Date) => Record<string, unknown>;
  /** Câu tiếng Việt điền vào lời từ chối, nhận số lượng. */
  message: (n: number) => string;
  /* Lấy NHÃN của vài dòng đang chặn, để lời từ chối chỉ ĐÍCH DANH thay vì chỉ đếm.
   * Cùng lý do như ở sổ theo khách hàng — và chính chỗ này là nơi thiếu nó đã cắn. */
  identify?: (
    client: Record<string, { findMany: (a: unknown) => Promise<unknown[]> }>,
    personId: string,
    now: Date,
  ) => Promise<string[]>;
}

/* Mệnh đề "người này đã được an táng", khai ĐÚNG MỘT LẦN và dùng ở cả `where` lẫn
 * `identify`. Xem chú thích ở `identify` bên dưới về lý do không chép. */
const BURIED_AS_DECEASED = (personId: string): Record<string, unknown> => ({
  deceased: { personId },
  ...activeBurial(),
});

export const PERSON_BLOCKING_REFERENCES: readonly PersonBlockingReference[] = [
  {
    model: 'BurialRecord',
    column: 'deceasedPersonId',
    /* Người này ĐÃ ĐƯỢC AN TÁNG — hồ sơ an táng trỏ vào hồ sơ NGƯỜI MẤT của họ, không trỏ
     * vào hồ sơ khách hàng. Đi qua quan hệ `deceased` thay vì tự tra `DeceasedPerson.id`
     * trước: hai lượt hỏi là hai chỗ có thể lệch nhau, và bỏ sót lượt thứ hai thì rào chắn
     * im lặng cho qua. */
    where: BURIED_AS_DECEASED,
    message: (n) => `đã được an táng (${n} hồ sơ)`,
    /* `identify` gọi LẠI `where` của chính mục này thay vì chép mệnh đề ra bản thứ hai.
     * Chép ra là đúng cái hình dạng lỗi đã đẻ ra toàn bộ mẫu sổ đăng ký này: hai bản của
     * một định nghĩa sẽ lệch nhau vào ngày ai đó sửa một bản. Ở đây hậu quả rất cụ thể —
     * bộ đếm nói "1 hồ sơ" còn nhãn liệt kê ra một tập khác. */
    identify: async (client, personId) => {
      const rows = (await client.burialRecord!.findMany({
        where: BURIED_AS_DECEASED(personId),
        select: { gravePlotId: true, slotNumber: true, status: true },
        take: 3,
      })) as { gravePlotId: string; slotNumber: number | null; status: string }[];
      if (rows.length === 0) return [];
      /* Hai lượt hỏi vì `BurialRecord.gravePlotId` là con trỏ LỎNG — không có quan hệ
       * Prisma nên không `select` lồng được. Thà nói rõ ở đây, hơn là thêm một khoá ngoại
       * chỉ để cho một câu thông báo đẹp: khoá ngoại đổi cả ngữ nghĩa xoá của bảng mộ. */
      const plots = (await client.gravePlot!.findMany({
        where: { id: { in: rows.map((r) => r.gravePlotId) } },
        select: { id: true, plotCode: true },
      })) as { id: string; plotCode: string }[];
      const codeById = new Map(plots.map((pl) => [pl.id, pl.plotCode]));
      return rows.map((r) => {
        const code = codeById.get(r.gravePlotId) ?? r.gravePlotId;
        const slot = r.slotNumber === null ? '' : ` cốt ${r.slotNumber}`;
        /* Kèm TRẠNG THÁI: "mộ A-01-01 cốt 2, Draft" nói cho người dùng biết hồ sơ này mới
         * là nháp và huỷ được, khác hẳn "Completed" là thứ không rút lại được. */
        return `mộ ${code}${slot}, ${r.status}`;
      });
    },
  },
];

/** Thứ KHÔNG chặn, nhưng phải XOÁ THEO khi xoá hồ sơ nhân thân. */
export interface PersonCascadeReference {
  model: string;
  column: string;
  where: (personId: string) => Record<string, unknown>;
  label: string;
}

/* Xoá theo, THEO ĐÚNG THỨ TỰ NÀY.
 *
 * Thứ tự không phải chuyện thẩm mỹ: `burial_records.deceased_person_id` có khoá ngoại
 * `ON DELETE RESTRICT` tới `deceased_persons`. Xoá hồ sơ người mất trước khi dọn hồ sơ an
 * táng ĐÃ HUỶ của họ thì CSDL ném `P2003` — một lỗi ràng buộc thô, không phải câu tiếng
 * Việt nào. Trước 27/08/2026 chuyện này không xảy ra được vì chưa có trạng thái nào rơi ra
 * ngoài `activeBurial()`; thêm `Cancelled` là mở đúng cái ngõ cụt đó ra.
 */
export const PERSON_CASCADE_REFERENCES: readonly PersonCascadeReference[] = [
  {
    model: 'BurialRecord',
    column: 'deceasedPersonId',
    /* Hồ sơ an táng ĐÃ HUỶ (mọi thứ không còn hiệu lực). Hồ sơ còn hiệu lực đã bị nhóm
     * CHẶN ở trên giữ lại rồi, nên tới được đây nghĩa là chỉ còn dòng đã huỷ.
     *
     * Xoá chứ không giữ: đây là hồ sơ CỦA CHÍNH người đang bị xoá, và để lại thì nó trỏ
     * vào một hồ sơ người mất không còn tồn tại. Sự kiện huỷ vẫn nằm trong nhật ký kiểm
     * toán — nơi nó thuộc về. */
    where: (personId) => ({ deceased: { personId }, NOT: { ...activeBurial() } }),
    label: 'hồ sơ an táng đã huỷ',
  },
  {
    model: 'FamilyRelationship',
    column: 'sourcePersonId',
    where: (personId) => ({ sourcePersonId: personId }),
    label: 'quan hệ nhân thân (chiều thuận)',
  },
  {
    model: 'FamilyRelationship',
    column: 'targetPersonId',
    /* Hai mục cho hai cột, mỗi mục một mệnh đề CHÍNH XÁC, thay vì một mục dùng `OR`. Test
     * đối chiếu schema soi theo CỘT, nên khai đủ hai cột là cách duy nhất để đổi tên một
     * trong hai cột về sau sẽ làm đỏ test. */
    where: (personId) => ({ targetPersonId: personId }),
    label: 'quan hệ nhân thân (chiều ngược)',
  },
  {
    model: 'PersonPhone',
    column: 'personId',
    where: (personId) => ({ personId }),
    label: 'số điện thoại',
  },
  {
    model: 'PersonAddress',
    column: 'personId',
    where: (personId) => ({ personId }),
    label: 'địa chỉ',
  },
  {
    model: 'PersonEducation',
    column: 'personId',
    where: (personId) => ({ personId }),
    label: 'học vấn',
  },
  {
    model: 'PersonBankAccount',
    column: 'personId',
    where: (personId) => ({ personId }),
    label: 'tài khoản ngân hàng',
  },
  {
    model: 'DeceasedPerson',
    column: 'personId',
    /* PHẢI đứng SAU `BurialRecord` — xem chú thích thứ tự ở trên. */
    where: (personId) => ({ personId }),
    label: 'hồ sơ người mất',
  },
];

/** Mọi model/cột được khai ở một trong hai nhóm — dùng cho test đối chiếu schema. */
export function declaredPersonReferences(): { model: string; column: string }[] {
  return [
    ...PERSON_BLOCKING_REFERENCES.map((r) => ({ model: r.model, column: r.column })),
    ...PERSON_CASCADE_REFERENCES.map((r) => ({ model: r.model, column: r.column })),
  ];
}
