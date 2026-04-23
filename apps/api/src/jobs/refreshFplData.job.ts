import { refreshFplData } from './Fpl-sync.service.js';
import { prisma }         from '../db/prisma.js';

refreshFplData()
  .then((summary) => {
    console.log('FPL refresh OK:', summary);
    process.exit(0);
  })
  .catch((err) => {
    console.error('FPL refresh FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });