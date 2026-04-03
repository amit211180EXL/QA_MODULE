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
  // Seed state from localStorage so the UI renders immediately without a spinner.
  const [user, setUser] = useState<CurrentUser | null>(() => readCachedUser());
  // If we already have a cached user, start as not-loading so the app renders instantly.
  const [isLoading, setIsLoading] = useState(() => !readCachedUser() && typeof window !== 'undefined' && !!Cookies.get('access_token'));

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
    const refreshToken = Cookies.get('refresh_token');
    if (refreshToken) {
      await authApi.logout(refreshToken).catch(() => null);
    }
    clearTokens();
    setUser(null);
    writeCachedUser(null);
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
