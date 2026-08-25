import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { PERMISSION_CATALOG, ROLE_CATALOG } from '../src/modules/authorization/permission-catalog';

const prisma = new PrismaClient();

// Danh tính ghế máy. Worker tra đúng email này và TỪ CHỐI CHẠY nếu không thấy.
export const SYSTEM_WORKER_EMAIL = 'system-worker@erp.local';
export const SYSTEM_WORKER_ROLE = 'SYSTEM_WORKER';

// Reference data: family relationship types with reciprocal mapping (blueprint doc 04).
const RELATIONSHIP_TYPES = [
  { code: 'SPOUSE', name: 'Vợ/Chồng', reciprocalCode: 'SPOUSE', genderSpecific: false },
  { code: 'PARENT', name: 'Cha/Mẹ', reciprocalCode: 'CHILD', genderSpecific: false },
  { code: 'CHILD', name: 'Con', reciprocalCode: 'PARENT', genderSpecific: false },
  { code: 'SIBLING', name: 'Anh/Chị/Em', reciprocalCode: 'SIBLING', genderSpecific: false },
];

// RBAC catalog (A6): the codes and role grants live in src/modules/authorization/
// permission-catalog.ts so the API, the seed and the CI invariants all read one list.

async function main(): Promise<void> {
  for (const rt of RELATIONSHIP_TYPES) {
    await prisma.relationshipType.upsert({ where: { code: rt.code }, update: rt, create: rt });
  }

  // Catalog rows only. `reviewedAt` is deliberately left untouched: a code nobody has
  // reviewed must stay visibly unreviewed (OPERA marks new tasks "New" for the same
  // reason), and re-seeding must never quietly bless a code an admin has not seen.
  const permByCode = new Map<string, string>();
  for (const def of PERMISSION_CATALOG) {
    const fields = {
      description: def.description,
      sensitivity: def.sensitivity,
      wildcardExempt: def.wildcardExempt,
      introducedIn: def.introducedIn,
    };
    const p = await prisma.permission.upsert({
      where: { code: def.code },
      update: fields,
      create: { id: ulid(), code: def.code, ...fields },
    });
    permByCode.set(def.code, p.id);
  }

  // NOTE: this loop only writes the grants already declared in ROLE_CATALOG. Seeding a
  // new catalog code must NOT hand it to anybody — a code arrives unassigned.
  for (const [code, def] of Object.entries(ROLE_CATALOG)) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name: def.name },
      create: { id: ulid(), code, name: def.name },
    });
    for (const g of def.grants) {
      const permissionId = permByCode.get(g.code);
      if (permissionId === undefined) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: { scope: g.scope },
        create: { id: ulid(), roleId: role.id, permissionId, scope: g.scope },
      });
    }
  }

  await seedSystemWorker();

  console.log(
    `[seed] relationship types: ${RELATIONSHIP_TYPES.length}, permissions: ${PERMISSION_CATALOG.length}, roles: ${Object.keys(ROLE_CATALOG).length}`,
  );
}

/* Ghế máy cho tiến trình nền.
 *
 * Worker giải phóng lô mộ khi phiếu giữ chỗ hết hạn. Trước đây nó ghi `changedBy: null`
 * — một đường đổi trạng thái mộ KHÔNG CHỦ THỂ và KHÔNG QUYỀN, tức nằm ngoài toàn bộ hệ
 * phân quyền. Ghế này cho nó một danh tính có thật, mang đúng hai mã quyền cần thiết.
 *
 * Không đăng nhập được: `status = 'system'` bị chặn ngay ở `login()`, và `passwordHash`
 * không phải hash hợp lệ nên không verify được. Hai lớp, không lớp nào dựa vào lớp kia.
 */
async function seedSystemWorker(): Promise<void> {
  const role = await prisma.role.findUnique({ where: { code: SYSTEM_WORKER_ROLE } });
  if (role === null) {
    return;
  }
  const agent = await prisma.user.upsert({
    where: { email: SYSTEM_WORKER_EMAIL },
    update: { status: 'system' },
    create: {
      id: ulid(),
      email: SYSTEM_WORKER_EMAIL,
      passwordHash: '!no-login:system-account',
      status: 'system',
    },
  });
  const existing = await prisma.roleAssignment.findFirst({
    where: { userId: agent.id, roleId: role.id },
  });
  if (existing === null) {
    await prisma.roleAssignment.create({
      data: {
        id: ulid(),
        userId: agent.id,
        roleId: role.id,
        grantedBy: 'seed',
        grantReason: 'Ghế máy cho tiến trình nền (hold-expiry, service-sweep)',
      },
    });
  }
  console.log(`[seed] ghế máy: ${SYSTEM_WORKER_EMAIL} -> ${SYSTEM_WORKER_ROLE}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
