import bcrypt from 'bcryptjs';
import prisma from '../prisma/client';
import { ensureAuthTables, setEmailVerified } from '../services/authStore';

async function upsertUser(params: {
  email: string;
  password: string;
  displayName: string;
  role: 'TEACHER' | 'STUDENT' | 'ADMIN';
}) {
  const { email, password, displayName, role } = params;

  const hash = await bcrypt.hash(password, 10);

  return prisma.user.upsert({
    where: { email },
    update: { password: hash, displayName, role },
    create: { email, password: hash, displayName, role },
    select: { id: true, email: true, displayName: true, role: true },
  });
}

async function main() {
  await ensureAuthTables();

  const password = 'demo-password';

  const admin = await upsertUser({
    email: 'demo.admin@example.com',
    password,
    displayName: 'Demo Admin',
    role: 'ADMIN',
  });

  const teacher = await upsertUser({
    email: 'demo.teacher@example.com',
    password,
    displayName: 'Demo Teacher',
    role: 'TEACHER',
  });

  const student = await upsertUser({
    email: 'demo.student@example.com',
    password,
    displayName: 'Demo Student',
    role: 'STUDENT',
  });



  // Mark demo accounts as verified so you can log in immediately.
  await setEmailVerified(admin.id, true);
  await setEmailVerified(teacher.id, true);
  await setEmailVerified(student.id, true);
 


  // console.log('✅ Users ready:');
  //console.log('Admin:  ', admin);
  //console.log('Teacher:', teacher);
  //console.log('Student:', student);
  //console.log('\nLogin creds:');
  //console.log('demo.admin@example.com   / demo-password');
  //console.log('demo.teacher@example.com / demo-password');
  //console.log('demo.student@example.com / demo-password');
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
