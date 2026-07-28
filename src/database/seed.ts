import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { authIdentity } from '../modules/auth/schema/auth-identity.schema';
import { user } from '../modules/user/schema/user.schema';
import { hashPassword } from '../utils/password';
import * as schema from './schema';

const superadminCfg = {
  email: process.env.SUPERADMIN_EMAIL ?? 'superadmin@ubel.local',
  password: process.env.SUPERADMIN_PASSWORD ?? 'UbelAdmin123!',
  name: process.env.SUPERADMIN_NAME ?? 'Super Admin',
};

const riderCfg = {
  phone: process.env.SEED_USER_PHONE ?? '+251911000000',
  name: process.env.SEED_USER_NAME ?? 'Demo Rider',
  deviceId: process.env.SEED_USER_DEVICE_ID ?? 'seed-device',
};

const parseName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  const firstName = parts.shift() || name;
  const lastName = parts.pop() || firstName;
  const middleName = parts.join(' ') || undefined;
  return { firstName, middleName, lastName };
};

const superadminName = parseName(superadminCfg.name);
const riderName = parseName(riderCfg.name);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema, casing: 'snake_case' });

const seedSuperadmin = async () => {
  const passwordHash = await hashPassword(superadminCfg.password);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ userId: authIdentity.userId, identityId: authIdentity.id })
      .from(authIdentity)
      .where(
        and(
          eq(authIdentity.type, 'email'),
          eq(authIdentity.identifier, superadminCfg.email),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(authIdentity)
        .set({ passwordHash, verifiedAt: new Date() })
        .where(eq(authIdentity.id, existing.identityId));
      await tx
        .update(user)
        .set({ roles: ['super_admin'] })
        .where(eq(user.id, existing.userId));
      console.log(`Updated superadmin: ${superadminCfg.email}`);
    } else {
      const [newUser] = await tx
        .insert(user)
        .values({
          ...superadminName,
          roles: ['super_admin'],
          emailVerified: true,
        })
        .returning({ id: user.id });
      if (!newUser) throw new Error('failed to create user');

      await tx.insert(authIdentity).values({
        userId: newUser.id,
        type: 'email',
        identifier: superadminCfg.email,
        passwordHash,
        verifiedAt: new Date(),
      });
      console.log(`Created superadmin: ${superadminCfg.email}`);
    }
  });

  console.log(`  email:    ${superadminCfg.email}`);
  console.log(`  password: ${superadminCfg.password}`);
};

const seedDemoRider = async () => {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ userId: authIdentity.userId })
      .from(authIdentity)
      .where(
        and(
          eq(authIdentity.type, 'phone'),
          eq(authIdentity.identifier, riderCfg.phone),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(user)
        .set({ ...riderName, deviceId: riderCfg.deviceId })
        .where(eq(user.id, existing.userId));
      console.log(`Updated demo rider: ${riderCfg.phone}`);
    } else {
      const [newUser] = await tx
        .insert(user)
        .values({
          ...riderName,
          deviceId: riderCfg.deviceId,
          roles: ['rider'],
          phoneVerified: true,
        })
        .returning({ id: user.id });
      if (!newUser) throw new Error('failed to create user');

      await tx.insert(authIdentity).values({
        userId: newUser.id,
        type: 'phone',
        identifier: riderCfg.phone,
        verifiedAt: new Date(),
      });
      console.log(`Created demo rider: ${riderCfg.phone}`);
    }
  });

  console.log(`  phone: ${riderCfg.phone}`);
  console.log(`  otp:   000000  (hardcoded until SMS provider is wired)`);
};

const run = async () => {
  await seedSuperadmin();
  console.log('');
  await seedDemoRider();
};

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
