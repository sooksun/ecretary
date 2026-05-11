import { PrismaClient, MeetingType, MeetingStatus, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'admin1234';

async function main() {
  const org = await prisma.organization.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'โรงเรียนสาธิต M-Secretary',
      type: 'school',
    },
  });

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@msecretary.local' },
    update: { passwordHash },
    create: {
      organizationId: org.id,
      name: 'Admin Recorder',
      email: 'admin@msecretary.local',
      role: UserRole.ADMIN,
      passwordHash,
    },
  });

  const sample = await prisma.meeting.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      organizationId: org.id,
      createdById: user.id,
      title: 'ประชุม PLC ตัวอย่าง',
      meetingType: MeetingType.PLC,
      location: 'ห้องประชุมเล็ก',
      agendaText: 'ติดตามการอ่านออกเขียนได้ ป.1-3',
      status: MeetingStatus.DRAFT,
      participants: {
        create: [
          { name: 'ผอ. สมชาย', roleLabel: 'ประธาน' },
          { name: 'ครูสมศรี', roleLabel: 'ครูประจำชั้น' },
          { name: 'ครูวิภา', roleLabel: 'หัวหน้าวิชาการ' },
        ],
      },
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seeded org=%s user=%s meeting=%s', org.id, user.id, sample.id);
  // eslint-disable-next-line no-console
  console.log('Login: email=admin@msecretary.local password=%s', SEED_PASSWORD);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
