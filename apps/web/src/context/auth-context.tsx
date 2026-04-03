'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi, CurrentUser } from '@/lib/api';
import { setTokens, clearTokens } from '@/lib/api-client';
import Cookies from 'js-cookie';

const USER_CACHE_KEY = 'qa_user_cache';

function readCachedUser(): CurrentUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CurrentUser) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: CurrentUser | null) {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_CACHE_KEY);
    }
  } catch {
    // localStorage may be unavailable in some privacy modes.
  }
}

interface AuthState {
  user: CurrentUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthActions {
  login: (email: string, password: string, tenantSlug?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState & AuthActions>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Always start null so SSR and first client render match (no hydration mismatch).
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = Cookies.get('access_token');
    if (!token) {
      setUser(null);
      writeCachedUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me);
      writeCachedUser(me);
    } catch {
      setUser(null);
      writeCachedUser(null);
      clearTokens();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Hydrate from localStorage first (near-instant) then refresh via API.
    const cached = readCachedUser();
    if (cached) {
      setUser(cached);
      setIsLoading(false);
    }
    refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string, tenantSlug?: string) => {
    const result = await authApi.login({ email, password }, tenantSlug);
    setTokens(result.accessToken, result.refreshToken);
    const me = await authApi.me();
    setUser(me);
    writeCachedUser(me);
  }, []);

  const logout = useCallback(async () => {
    // Clear local state immediately so the UI responds instantly.
    const refreshToken = Cookies.get('refresh_token');
    clearTokens();
    setUser(null);
    writeCachedUser(null);
    // Invalidate the session on the server in the background (fire-and-forget).
    if (refreshToken) {
      authApi.logout(refreshToken).catch(() => null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticated: !!user, login, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
