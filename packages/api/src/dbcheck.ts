import { prisma } from './utils/prisma';

async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, companyId: true, status: true },
  });
  console.log('PROJECTS:', JSON.stringify(projects, null, 2));

  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
  });
  console.log('COMPANIES:', JSON.stringify(companies, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
