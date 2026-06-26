import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const roles = await prisma.roles.findMany();
    console.log('--- ACTUAL ROLES IN DATABASE ---');
    roles.forEach(r => console.log(`- "${r.name}"`));
    console.log('--------------------------------');
  } finally {
    await prisma.$disconnect();
  }
}
main();
