import type { PrismaService } from '../../prisma/prisma.service';

/* Đổi ID thành TÊN ĐỌC ĐƯỢC cho nhật ký kiểm toán.
 *
 * Vì sao làm ở API chứ không ở giao diện: nhật ký trỏ tới hơn mười loại đối tượng nằm ở
 * bảy schema khác nhau. Để giao diện tự tra thì mỗi trang phải biết đường đi tới từng
 * bảng, và mỗi lần thêm một loại đối tượng lại phải sửa cả hai phía.
 *
 * Vì sao gom theo LÔ: một trang nhật ký 50 dòng có thể trỏ tới 50 đối tượng. Tra từng
 * dòng là 50 lượt truy vấn cho một lần mở trang — mẫu N+1 kinh điển. Ở đây gom id theo
 * loại rồi tra MỘT lượt cho mỗi loại: nhiều nhất là số loại đối tượng, không phụ thuộc số
 * dòng.
 *
 * LƯU Ý VỀ DỮ LIỆU CÁ NHÂN: nhãn của `person`/`customer` là HỌ TÊN. Trước đây trang nhật
 * ký chỉ hiện ID nên nó không đọc ra tên ai; nay ai đọc được nhật ký sẽ đọc được tên. Đó
 * là chủ đích (chủ doanh nghiệp yêu cầu 26/08/2026) và `fullName` vốn đã nằm trong danh
 * sách đã-rà là dữ liệu tác nghiệp, gate bằng quyền route. Chỉ 5 vai có `audit.event.view`.
 */

/** Nhãn loại đối tượng. Mã lạ thì hiện nguyên mã, đừng nuốt mất. */
const ENTITY_TYPE_LABEL: Record<string, string> = {
  person: 'Nhân thân',
  customer: 'Khách hàng',
  grave_plot: 'Phần mộ',
  external_contract: 'Hợp đồng',
  burial_record: 'Hồ sơ an táng',
  service_subscription: 'Dịch vụ',
  family_relationship: 'Quan hệ nhân thân',
  card_print_log: 'Thẻ quản lý mộ',
  file: 'Tệp',
  file_object: 'Tệp',
  access_rule: 'Luật truy cập',
  role_assignment: 'Gán vai',
  role_permission: 'Quyền của vai',
  scope_assignment: 'Gán phạm vi',
  test: 'Bản ghi thử',
};

export function entityTypeLabel(entityType: string): string {
  return ENTITY_TYPE_LABEL[entityType] ?? entityType;
}

/** Rút gọn id để vẫn đối chiếu được khi không tra ra tên — đừng bỏ trống. */
function shortId(id: string): string {
  return id.length <= 10 ? id : `…${id.slice(-8)}`;
}

export interface LabelledEvent {
  actorId: string | null;
  actorType: string;
  entityType: string;
  entityId: string;
}

/* Ai thao tác. `iam.users` chỉ có email, chưa có cột tên — nên nhãn là email, và đó là
 * danh tính NHÂN VIÊN dùng cho quy trách nhiệm, không phải dữ liệu khách hàng. */
export async function resolveActorLabels(
  prisma: PrismaService,
  events: LabelledEvent[],
): Promise<Map<string, string>> {
  const ids = [...new Set(events.map((e) => e.actorId).filter((id): id is string => id !== null))];
  if (ids.length === 0) {
    return new Map();
  }
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.email]));
}

type Resolver = (prisma: PrismaService, ids: string[]) => Promise<Map<string, string>>;

function join(parts: (string | null | undefined)[], sep = ' · '): string {
  return parts.filter((p): p is string => p !== null && p !== undefined && p !== '').join(sep);
}

/* Mỗi loại một truy vấn. Thiếu resolver thì rơi về id rút gọn — thêm loại đối tượng mới
 * mà quên khai ở đây chỉ làm nhãn kém đẹp, KHÔNG làm vỡ trang nhật ký. */
const RESOLVERS: Record<string, Resolver> = {
  person: async (prisma, ids) => {
    const rows = await prisma.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  },
  customer: async (prisma, ids) => {
    const rows = await prisma.customer.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        customerCode: true,
        orgName: true,
        person: { select: { fullName: true } },
      },
    });
    return new Map(
      rows.map((r) => [r.id, join([r.person?.fullName ?? r.orgName, r.customerCode])]),
    );
  },
  grave_plot: async (prisma, ids) => {
    const rows = await prisma.gravePlot.findMany({
      where: { id: { in: ids } },
      select: { id: true, plotCode: true, cemetery: { select: { name: true } } },
    });
    return new Map(rows.map((r) => [r.id, join([r.plotCode, r.cemetery.name])]));
  },
  external_contract: async (prisma, ids) => {
    const rows = await prisma.externalContract.findMany({
      where: { id: { in: ids } },
      select: { id: true, contractNo: true },
    });
    return new Map(rows.map((r) => [r.id, r.contractNo]));
  },
  burial_record: async (prisma, ids) => {
    const rows = await prisma.burialRecord.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        gravePlotId: true,
        deceased: { select: { person: { select: { fullName: true } } } },
      },
    });
    return new Map(rows.map((r) => [r.id, r.deceased.person.fullName]));
  },
  service_subscription: async (prisma, ids) => {
    const rows = await prisma.serviceSubscription.findMany({
      where: { id: { in: ids } },
      select: { id: true, catalog: { select: { name: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.catalog.name]));
  },
  family_relationship: async (prisma, ids) => {
    const rows = await prisma.familyRelationship.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        source: { select: { fullName: true } },
        target: { select: { fullName: true } },
      },
    });
    return new Map(rows.map((r) => [r.id, `${r.source.fullName} → ${r.target.fullName}`]));
  },
  card_print_log: async (prisma, ids) => {
    const rows = await prisma.cardPrintLog.findMany({
      where: { id: { in: ids } },
      select: { id: true, printNumber: true, customerId: true },
    });
    return new Map(rows.map((r) => [r.id, `Lần cấp ${String(r.printNumber).padStart(2, '0')}`]));
  },
  access_rule: async (prisma, ids) => {
    const rows = await prisma.accessRule.findMany({
      where: { id: { in: ids } },
      select: { id: true, effect: true, permissionCode: true },
    });
    return new Map(rows.map((r) => [r.id, `${r.effect} ${r.permissionCode}`]));
  },
};

/* `file` và `file_object` cùng trỏ tới một bảng — hai tên gọi tồn tại vì mã cũ phát
 * `file`, mã mới phát `file_object`. Khai cả hai thay vì đi sửa nhật ký đã ghi: nhật ký
 * là append-only, sửa lịch sử để cho đẹp là đúng thứ nó sinh ra để ngăn. */
const fileResolver: Resolver = async (prisma, ids) => {
  const rows = await prisma.fileObject.findMany({
    where: { id: { in: ids } },
    select: { id: true, originalName: true },
  });
  return new Map(rows.map((r) => [r.id, r.originalName]));
};
RESOLVERS.file = fileResolver;
RESOLVERS.file_object = fileResolver;

/** Khoá `type:id` để một map phục vụ mọi loại. */
export function entityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export async function resolveEntityLabels(
  prisma: PrismaService,
  events: LabelledEvent[],
): Promise<Map<string, string>> {
  const byType = new Map<string, Set<string>>();
  for (const e of events) {
    const set = byType.get(e.entityType) ?? new Set<string>();
    set.add(e.entityId);
    byType.set(e.entityType, set);
  }

  const out = new Map<string, string>();
  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const resolver = RESOLVERS[type];
      if (resolver === undefined) {
        return;
      }
      /* Đối tượng đã bị xoá thì tra không ra — vẫn phải hiện dòng nhật ký. Nhật ký sống
       * lâu hơn thứ nó nói về, đó là điểm của việc nó bất biến. */
      const resolved = await resolver(prisma, [...ids]);
      for (const [id, label] of resolved) {
        out.set(entityKey(type, id), label);
      }
    }),
  );
  return out;
}

/** Nhãn cuối cùng cho một dòng: tên tra được, hoặc id rút gọn nếu không tra ra. */
export function entityLabelFor(
  labels: Map<string, string>,
  entityType: string,
  entityId: string,
): string {
  return labels.get(entityKey(entityType, entityId)) ?? shortId(entityId);
}
