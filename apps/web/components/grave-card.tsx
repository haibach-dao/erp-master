import type { CardPlot, GraveCard } from '@/lib/api';
import { birthOrder, relationshipLabel } from '@/lib/relationship';

/* Thẻ Quản Lý Mộ — bản in.
 *
 * Hai tờ A4 ngang, mỗi tờ gập đôi theo trục dọc giữa thành 4 mặt:
 *   tờ 1 = bìa sau | bìa trước      (mặt ngoài, nhìn thấy khi thẻ gập lại)
 *   tờ 2 = sơ đồ   | bảng người an táng (mặt trong)
 *
 * Kích thước theo đúng bản gốc: mỗi nửa 148.5mm — một nửa chính xác của 297mm. Chiều cao
 * lấy 210mm chuẩn A4 ngang (bản gốc để 209mm, lệch 1mm khỏi lưới giấy).
 */

const HALF = 'flex w-[148.5mm] flex-col px-[14mm] py-[12mm]';

function fmtDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('vi-VN');
}

/* Nhãn quan hệ trên thẻ dùng CHUNG `lib/relationship` với các màn hình khác.
 *
 * Trước đây file này giữ một bảng nhãn tĩnh riêng, in ra "Cha/Mẹ" và "Con" — trong khi
 * trang khách hàng đã in "Bố đẻ"/"Con gái". Cùng một quan hệ, hai cách gọi, và cách vô cảm
 * hơn lại rơi đúng vào tờ giấy trao tận tay gia đình. Nhãn là một luật hiển thị; luật sống
 * ở hai chỗ thì hai chỗ sẽ lệch.
 */
function occupantRelationship(
  code: string | null,
  gender: string | null | undefined,
  dateOfBirth: string | null,
  ownerDateOfBirth: string | null,
): string {
  if (code === null) return '';
  // Anh hay em phải so tuổi với CHỦ MỘ mới biết; thiếu ngày sinh thì nhãn lùi về trung tính.
  return relationshipLabel(code, gender, birthOrder(dateOfBirth, ownerDateOfBirth));
}

const NOTICES = [
  'Thẻ mộ là giấy chứng minh gia chủ có phần mộ đang đặt tại Nghĩa trang do Công ty quản lý. Chủ mộ không được tự ý sửa chữa, tẩy xoá.',
  'Mọi trường hợp tranh chấp về phần mộ hoặc phát sinh khác, Công ty chỉ giải quyết khi chủ mộ xuất trình thẻ mộ.',
  'Khi Chủ mộ thay đổi thông tin, số phần mộ trong thẻ phải đăng ký với Công ty và nộp lại thẻ mộ để cấp đổi thông tin.',
  'Các hoạt động trong Nghĩa trang phải tuân thủ Quy chế quản lý nghĩa trang do Công ty ban hành.',
];

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="print-sheet relative mx-auto mb-6 flex h-[210mm] w-[297mm] bg-white text-black shadow-sm ring-1 ring-neutral-300">
      {/* Đường gập giữa tờ */}
      <div className="absolute bottom-[5mm] left-1/2 top-[5mm] border-l border-dashed border-neutral-300" />
      {children}
    </div>
  );
}

function BackCover() {
  return (
    <div className={HALF}>
      <h3 className="mb-3 text-center text-[14px] font-bold">QUÝ KHÁCH LƯU Ý:</h3>
      <div className="flex flex-col gap-3">
        {NOTICES.map((text, i) => (
          <p key={text} className="m-0 text-justify text-[11px] leading-[1.5]">
            {i + 1}. {text}
          </p>
        ))}
      </div>

      <table className="mt-2 text-[12px] font-bold">
        <tbody>
          <tr>
            <td className="whitespace-nowrap align-top">Địa chỉ liên hệ:</td>
            <td className="pl-2">
              - Tập đoàn INDEVCO
              <br />- Xí nghiệp An Lạc Viên
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-auto pt-4 text-center text-[12px] font-bold leading-[1.6]">
        <div>Đường dây nóng khiếu nại: 0865.291.388</div>
        <div>Tổng đài CSKH: 0338.699.599</div>
      </div>
    </div>
  );
}

function FrontCover({ card, printNumber }: { card: GraveCard; printNumber: string }) {
  const rows: [string, string][] = [
    ['Họ và tên', card.owner.fullName ?? '—'],
    ['Giới tính', card.owner.gender ?? '—'],
    ['Ngày sinh', fmtDate(card.owner.dateOfBirth)],
    // CCCD in bản ĐÃ CHE. Bản đầy đủ không đi qua đường này — muốn xem thì có endpoint
    // riêng, có ghi nhật ký từng lần xem.
    ['Số CCCD', card.owner.nationalIdMasked ?? '—'],
    ['Cấp ngày', fmtDate(card.owner.nationalIdIssuedOn)],
    ['Nơi cấp', card.owner.nationalIdIssuedPlace ?? '—'],
    ['Điện thoại', card.owner.phone ?? '—'],
    ['Địa chỉ', card.owner.permanentAddress ?? '—'],
    ['Cấp lần đầu', fmtDate(card.ownershipDate)],
  ];

  return (
    <div className={`${HALF} justify-between`}>
      <div className="pt-[8mm] text-center">
        <h2 className="m-0 mb-1 text-[16px] font-extrabold uppercase tracking-[1px]">
          Thẻ Quản Lý Mộ
        </h2>
        <p className="m-0 text-[12px] font-semibold">
          {card.plots[0]?.cemeteryName ?? 'CÔNG VIÊN NGHĨA TRANG'}
        </p>
      </div>

      <div className="my-2 rounded-md bg-[#f0f4ff] px-3 py-1.5 text-center">
        <span className="text-[13px] font-bold text-[#1e3a8a]">
          THÔNG TIN CHỦ MỘ {card.customerCode}
        </span>
      </div>

      <table className="w-full flex-1 border-collapse text-[12px]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-neutral-200">
              <td className="w-[100px] px-2 py-1 align-top font-semibold">{label}</td>
              <td className="px-2 py-1">: {value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 grid grid-cols-2 gap-2 border-t-[1.5px] border-neutral-800 pt-2">
        <div className="text-center">
          <p className="m-0 mb-1 text-[11px] font-bold">CHỦ MỘ</p>
          <p className="m-0 text-[9px] italic text-neutral-500">(Ký ghi họ tên)</p>
          <div className="h-[35mm]" />
        </div>
        <div className="text-center">
          <p className="m-0 mb-0.5 text-[9px] font-semibold text-neutral-600">
            INDEVCO - XN AN LẠC VIÊN
          </p>
          <p className="m-0 mb-0.5 text-[11px] font-bold">{card.approvedTitle ?? 'PHÓ GIÁM ĐỐC'}</p>
          <div className="h-[25mm]" />
          <p className="m-0 text-[12px] font-semibold">{card.approvedBy ?? '...'}</p>
          <p className="m-0 mt-1 text-[9px] text-neutral-600">
            Ngày cấp lần {printNumber}: {new Date().toLocaleDateString('vi-VN')}
          </p>
          <p className="m-0 mt-0.5 text-[10px] font-bold text-[#1e3a8a]">Lần cấp: {printNumber}</p>
        </div>
      </div>
    </div>
  );
}

/* Sơ đồ mặt bằng vẽ từ toạ độ thật.
 *
 * Bản gốc để một ô nét đứt với dòng "(Bản vẽ khu mộ sẽ được đính kèm)" — nghĩa là mỗi thẻ
 * in ra vẫn phải dán bản vẽ bằng tay. Ở đây vẽ được vì phần mộ đã có `mapX`/`mapY`; mộ
 * chưa số hoá toạ độ thì rơi về đúng ô trống như cũ, không in ra sơ đồ sai.
 */
function PlotSketch({ plots }: { plots: CardPlot[] }) {
  const located = plots.filter(
    (p): p is CardPlot & { mapX: number; mapY: number } => p.mapX !== null && p.mapY !== null,
  );
  if (located.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded border-[1.5px] border-dashed border-neutral-400 bg-neutral-50 text-center">
        <div className="text-neutral-500">
          <p className="m-0 text-[10px]">Khu vực dán sơ đồ mặt bằng</p>
          <p className="m-0 mt-1 text-[9px] italic">(Phần mộ chưa số hoá toạ độ)</p>
        </div>
      </div>
    );
  }

  /* Khung nhìn ôm vừa các mộ, chừa lề 4 đơn vị. Một mộ đơn lẻ thì bề rộng bằng 0, nên
   * kẹp sàn để không chia cho 0 và không phóng đại một điểm thành cả trang. */
  const xs = located.map((p) => p.mapX);
  const ys = located.map((p) => p.mapY);
  const pad = 4;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 10);
  const height = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2, 10);

  return (
    <div className="flex-1 rounded border-[1.5px] border-neutral-800 p-2">
      <svg
        viewBox={`${minX} ${minY} ${width} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label="Sơ đồ mặt bằng khu mộ"
      >
        {located.map((p) => (
          <g key={p.gravePlotId}>
            <rect
              x={p.mapX - 1.4}
              y={p.mapY - 1.4}
              width={2.8}
              height={2.8}
              fill="#e2e8f0"
              stroke="#0f172a"
              strokeWidth={0.25}
            />
            <text x={p.mapX} y={p.mapY + 4.2} textAnchor="middle" fontSize={1.8} fill="#0f172a">
              {p.plotCode}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function MapFace({ plots }: { plots: CardPlot[] }) {
  return (
    <div className={HALF}>
      <h3 className="m-0 mb-3 text-center text-[13px] font-bold uppercase tracking-[0.5px]">
        Sơ Đồ Mặt Bằng Khu Mộ
      </h3>
      <div className="mb-3 rounded border-[1.5px] border-neutral-800 p-3">
        {plots.map((p, i) => (
          <div
            key={p.gravePlotId}
            className={
              i < plots.length - 1 ? 'mb-2.5 border-b border-dashed border-neutral-300 pb-2.5' : ''
            }
          >
            <p className="m-0 mb-1 text-[11px]">
              <strong>Vị trí {i + 1}:</strong> {p.plotCode} — {p.graveTypeName}
            </p>
            <p className="m-0 mb-0.5 text-[10px] text-neutral-700">
              Khu: {p.zone ?? '—'} / Khối: {p.block ?? '—'} / Dãy: {p.row ?? '—'}
            </p>
            <p className="m-0 mb-0.5 text-[10px] text-neutral-700">Dự án: {p.cemeteryName}</p>
            <p className="m-0 text-[10px] text-neutral-700">Số phần mộ tối đa: {p.capacity}</p>
          </div>
        ))}
      </div>
      <PlotSketch plots={plots} />
    </div>
  );
}

function OccupantsFace({
  plots,
  ownerDateOfBirth,
}: {
  plots: CardPlot[];
  ownerDateOfBirth: string | null;
}) {
  const multi = plots.length > 1;
  /* Dòng trống in sẵn theo `emptySlots` do SERVER tính. Giao diện không tự trừ sức chứa —
   * hai màn hình tự tính sẽ in ra hai loại thẻ khác nhau cho cùng một phần mộ. */
  const rows = plots.flatMap((p) => [
    ...p.occupants.map((o) => ({ key: o.burialRecordId, plot: p, occupant: o })),
    ...Array.from({ length: p.emptySlots }, (_, i) => ({
      key: `${p.gravePlotId}-empty-${i}`,
      plot: p,
      occupant: null,
    })),
  ]);

  return (
    <div className={HALF}>
      <h3 className="m-0 mb-2.5 text-center text-[13px] font-bold uppercase tracking-[0.5px]">
        {multi ? 'Thông Tin Về Phần Cốt' : 'Thông Tin Phần Mộ'}
      </h3>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-[#f1f5f9]">
            <th className="border-b-2 border-neutral-300 px-1.5 py-1 text-left font-bold">STT</th>
            <th className="border-b-2 border-neutral-300 px-1.5 py-1 text-left font-bold">
              Họ tên người an táng
            </th>
            {multi && (
              <th className="border-b-2 border-neutral-300 px-1.5 py-1 text-left font-bold">
                Vị trí
              </th>
            )}
            <th className="border-b-2 border-neutral-300 px-1.5 py-1 text-left font-bold">
              Quan hệ với chủ
            </th>
            <th className="border-b-2 border-neutral-300 px-1.5 py-1 text-left font-bold">
              Ngày sinh
            </th>
            <th className="border-b-2 border-neutral-300 px-1.5 py-1 text-left font-bold">
              Ngày an táng
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key} className="border-b border-neutral-200">
              <td className="px-1.5 py-1">{i + 1}</td>
              <td className={`px-1.5 py-1 ${row.occupant === null ? '' : 'font-semibold'}`}>
                {row.occupant?.fullName ?? '- - - - -'}
              </td>
              {multi && <td className="px-1.5 py-1 text-[9px]">{row.plot.plotCode}</td>}
              <td className="px-1.5 py-1">
                {occupantRelationship(
                  row.occupant?.relationshipToOwner ?? null,
                  row.occupant?.gender,
                  row.occupant?.dateOfBirth ?? null,
                  ownerDateOfBirth,
                )}
              </td>
              <td className="px-1.5 py-1">
                {row.occupant === null ? '' : fmtDate(row.occupant.dateOfBirth)}
              </td>
              <td className="px-1.5 py-1">
                {row.occupant === null ? '' : fmtDate(row.occupant.burialDate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-auto pt-2.5 text-center text-[9px] italic text-neutral-500">
        Thẻ có giá trị khi có đóng dấu và chữ ký Ban Giám Đốc
      </p>
    </div>
  );
}

export function GraveCardSheets({ card }: { card: GraveCard }) {
  /* Số in trên thẻ: đã cấp thì dùng số thật, chưa cấp thì dùng số DỰ KIẾN. Bản xem trước
   * hiện số dự kiến là đúng — người dùng cần thấy thẻ sẽ ra sao trước khi quyết cấp. */
  const raw = card.printNumber ?? card.nextPrintNumber ?? 1;
  const printNumber = String(raw).padStart(2, '0');

  return (
    <div className="print-root">
      <Sheet>
        <BackCover />
        <FrontCover card={card} printNumber={printNumber} />
      </Sheet>
      <Sheet>
        <MapFace plots={card.plots} />
        <OccupantsFace plots={card.plots} ownerDateOfBirth={card.owner.dateOfBirth} />
      </Sheet>
    </div>
  );
}
