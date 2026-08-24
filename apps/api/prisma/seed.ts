import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

const prisma = new PrismaClient();

// Reference data: family relationship types with reciprocal mapping (blueprint doc 04).
const RELATIONSHIP_TYPES = [
  { code: 'SPOUSE', name: 'Vợ/Chồng', reciprocalCode: 'SPOUSE', genderSpecific: false },
  { code: 'PARENT', name: 'Cha/Mẹ', reciprocalCode: 'CHILD', genderSpecific: false },
  { code: 'CHILD', name: 'Con', reciprocalCode: 'PARENT', genderSpecific: false },
  { code: 'SIBLING', name: 'Anh/Chị/Em', reciprocalCode: 'SIBLING', genderSpecific: false },
];

// RBAC catalog (A6): permissions + roles. ADMIN gets a wildcard; STAFF a limited set.
const PERMISSIONS = [
  '*.*.*',
  'cemetery.customer.view',
  'cemetery.grave.hold',
  'cemetery.contract.activate',
  'cemetery.document.view_sensitive',
  'audit.event.view',
];
const ROLE_GRANTS: Record<string, { name: string; grants: { code: string; scope: string }[] }> = {
  ADMIN: { name: 'Quản trị', grants: [{ code: '*.*.*', scope: 'GROUP' }] },
  STAFF: {
    name: 'Nhân viên',
    grants: [
      { code: 'cemetery.customer.view', scope: 'COMPANY' },
      { code: 'cemetery.grave.hold', scope: 'COMPANY' },
    ],
  },
};

async function main(): Promise<void> {
  for (const rt of RELATIONSHIP_TYPES) {
    await prisma.relationshipType.upsert({ where: { code: rt.code }, update: rt, create: rt });
  }

  const permByCode = new Map<string, string>();
  for (const code of PERMISSIONS) {
    const p = await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { id: ulid(), code },
    });
    permByCode.set(code, p.id);
  }

  for (const [code, def] of Object.entries(ROLE_GRANTS)) {
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

  console.log(
    `[seed] relationship types: ${RELATIONSHIP_TYPES.length}, permissions: ${PERMISSIONS.length}, roles: ${Object.keys(ROLE_GRANTS).length}`,
  );
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
