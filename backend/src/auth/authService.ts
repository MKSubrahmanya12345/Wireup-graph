import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../config/env.js';
import { ApiError } from '../middleware/errorHandler.js';
import { getUserStore, type StoredUser } from './userStore.js';

/**
 * Wireup auth service — signup, login, token issuing and verification.
 * Passwords are bcrypt-hashed (cost 12); sessions are signed JWTs.
 */

export const signupBodySchema = z.object({
  name: z.string().trim().min(2, 'Name needs at least 2 characters.').max(80),
  email: z.string().trim().email('Enter a valid email address.').max(160),
  password: z
    .string()
    .min(8, 'Password needs at least 8 characters.')
    .max(128),
});

export const loginBodySchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(160),
  password: z.string().min(1, 'Password is required.').max(128),
});

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  expiresIn: number;
  user: PublicUser;
}

function toPublic(user: StoredUser): PublicUser {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function issueToken(user: StoredUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    env.JWT_SECRET,
    { expiresIn: env.AUTH_TOKEN_TTL_SECONDS },
  );
}

export async function signup(input: z.infer<typeof signupBodySchema>): Promise<AuthSession> {
  const store = getUserStore();
  const email = input.email.trim().toLowerCase();

  const passwordHash = await bcrypt.hash(input.password, 12);
  let user: StoredUser;
  try {
    user = await store.create({ name: input.name, email, passwordHash });
  } catch (error) {
    const code = (error as { code?: string | number }).code;
    if (code === 'EMAIL_TAKEN' || code === 11000) {
      throw new ApiError(409, 'An account with this email already exists. Log in instead.');
    }
    throw error;
  }

  return { token: issueToken(user), expiresIn: env.AUTH_TOKEN_TTL_SECONDS, user: toPublic(user) };
}

export async function login(input: z.infer<typeof loginBodySchema>): Promise<AuthSession> {
  const store = getUserStore();
  const user = await store.findByEmail(input.email);

  // Deliberately vague: never reveal which half was wrong.
  if (!user) throw new ApiError(401, 'Invalid email or password.');

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new ApiError(401, 'Invalid email or password.');

  return { token: issueToken(user), expiresIn: env.AUTH_TOKEN_TTL_SECONDS, user: toPublic(user) };
}

export interface TokenPayload {
  sub: string;
  email: string;
  name: string;
}

export function verifyToken(token: string): TokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === 'string' || !payload.sub) throw new Error('bad payload');
    return payload as unknown as TokenPayload;
  } catch {
    throw new ApiError(401, 'Your session expired. Log in again.');
  }
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const user = await getUserStore().findById(id);
  return user ? toPublic(user) : null;
}
