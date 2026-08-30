import { create } from 'zustand';

import { api, setAuthToken, setUnauthorizedHandler } from '../services/api';
import type { AuthUser } from '../types/build';

/**
 * Wireup session state. The token lives in localStorage via api.ts; this store
 * holds the user profile and the login/signup/logout actions.
 */
interface AuthState {
  user: AuthUser | null;
  /** True once the stored token has been validated this session. */
  bootstrapped: boolean;
  busy: boolean;
  error: string | null;

  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (name: string, email: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearError: () => void;
}

export const useAuth = create<AuthState>()((set) => ({
  user: null,
  bootstrapped: false,
  busy: false,
  error: null,

  bootstrap: async () => {
    setUnauthorizedHandler(() => set({ user: null }));
    if (!localStorage.getItem('wireup.token')) {
      set({ bootstrapped: true });
      return;
    }
    try {
      const { user } = await api.me();
      set({ user, bootstrapped: true });
    } catch {
      setAuthToken(null);
      set({ user: null, bootstrapped: true });
    }
  },

  login: async (email, password) => {
    set({ busy: true, error: null });
    try {
      const session = await api.login({ email, password });
      setAuthToken(session.token);
      set({ user: session.user, busy: false });
      return true;
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : 'Login failed.',
      });
      return false;
    }
  },

  signup: async (name, email, password) => {
    set({ busy: true, error: null });
    try {
      const session = await api.signup({ name, email, password });
      setAuthToken(session.token);
      set({ user: session.user, busy: false });
      return true;
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : 'Signup failed.',
      });
      return false;
    }
  },

  logout: () => {
    setAuthToken(null);
    set({ user: null });
  },

  clearError: () => set({ error: null }),
}));

/** Convenience for route guards. */
export function isAuthenticated(): boolean {
  return Boolean(useAuth.getState().user);
}
