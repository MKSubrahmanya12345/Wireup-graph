import { Router } from 'express';

import {
  getUserById,
  issueGuestSession,
  login,
  loginBodySchema,
  signup,
  signupBodySchema,
} from '../auth/authService.js';
import { requireAuth } from '../auth/authMiddleware.js';
import { ApiError, asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/** POST /api/auth/signup — create a Wireup account. */
router.post(
  '/auth/signup',
  asyncHandler(async (req, res) => {
    const parsed = signupBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest(
        parsed.error.issues[0]?.message ?? 'Check the signup form.',
        parsed.error.flatten(),
      );
    }
    const session = await signup(parsed.data);
    res.status(201).json(session);
  }),
);

/** POST /api/auth/login — exchange credentials for a session token. */
router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest(
        parsed.error.issues[0]?.message ?? 'Check the login form.',
        parsed.error.flatten(),
      );
    }
    const session = await login(parsed.data);
    res.status(200).json(session);
  }),
);

/** POST /api/auth/guest — one-click session, no signup wall. */
router.post(
  '/auth/guest',
  asyncHandler(async (_req, res) => {
    res.status(200).json(issueGuestSession());
  }),
);

/** GET /api/auth/me — who is this token? */
router.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user?.guest) {
      res.status(200).json({
        user: {
          id: 'guest',
          name: req.user.name ?? 'Guest',
          email: 'guest@wireup.local',
          createdAt: '',
        },
      });
      return;
    }
    const user = await getUserById(req.user!.sub);
    if (!user) throw new ApiError(401, 'This account no longer exists.');
    res.status(200).json({ user });
  }),
);

export default router;
