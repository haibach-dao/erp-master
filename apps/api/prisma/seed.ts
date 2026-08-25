import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { PERMISSION_CATALOG, ROLE_CATALOG } from '../src/modules/authorization/permission-catalog';

const prisma = new PrismaClient();

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

  console.log(
    `[seed] relationship types: ${RELATIONSHIP_TYPES.length}, permissions: ${PERMISSION_CATALOG.length}, roles: ${Object.keys(ROLE_CATALOG).length}`,
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
