import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Reference data: family relationship types with reciprocal mapping (blueprint doc 04).
const RELATIONSHIP_TYPES = [
  { code: 'SPOUSE', name: 'Vợ/Chồng', reciprocalCode: 'SPOUSE', genderSpecific: false },
  { code: 'PARENT', name: 'Cha/Mẹ', reciprocalCode: 'CHILD', genderSpecific: false },
  { code: 'CHILD', name: 'Con', reciprocalCode: 'PARENT', genderSpecific: false },
  { code: 'SIBLING', name: 'Anh/Chị/Em', reciprocalCode: 'SIBLING', genderSpecific: false },
];

async function main(): Promise<void> {
  for (const rt of RELATIONSHIP_TYPES) {
    await prisma.relationshipType.upsert({ where: { code: rt.code }, update: rt, create: rt });
  }
  console.log(`[seed] relationship types upserted: ${RELATIONSHIP_TYPES.length}`);
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
