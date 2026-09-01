import bcrypt from 'bcryptjs';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getUserStore, normaliseEmail } from './userStore.js';

/**
 * Seed exactly one admin account at boot.
 *
 * Idempotent: if the account exists it is only promoted to 'admin' when it
 * is not already. The password is never logged; the default is a development
 * convenience and is called out loudly so it cannot silently ship.
 */
export async function seedAdminUser(): Promise<void> {
  if (env.ADMIN_SEED === '0') {
    logger.info('Admin seeding disabled (ADMIN_SEED=0).');
    return;
  }

  try {
    const store = getUserStore();
    const email = normaliseEmail(env.ADMIN_EMAIL);
    const existing = await store.findByEmail(email);

    if (existing) {
      if (existing.role !== 'admin') {
        await store.setRole(existing.id, 'admin');
        logger.info({ email }, 'Seed admin: existing account promoted to admin');
      } else {
        logger.info({ email }, 'Seed admin: admin account already present');
      }
      return;
    }

    const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
    const user = await store.create({
      name: env.ADMIN_NAME,
      email,
      passwordHash,
      role: 'admin',
    });
    logger.info({ email, id: user.id }, 'Seed admin: admin account created');
    if (env.ADMIN_PASSWORD === 'wireup-admin-dev') {
      logger.warn(
        'Seed admin is using the DEFAULT development password — set ADMIN_PASSWORD before deploying anywhere real.',
      );
    }
  } catch (error) {
    // Seeding must never take the API down.
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      'Seed admin failed (API still running)',
    );
  }
}
