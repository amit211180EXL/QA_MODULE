import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: false,
});

// Attach access token from cookie on every request
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = Cookies.get('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

// Auto-refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !original._retry) {
      const refreshToken = Cookies.get('refresh_token');
      if (!refreshToken) {
        clearTokens();
        if (typeof window !== 'undefined') window.location.href = '/login';
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`, {
          refreshToken,
        });
        const newAccess: string = data.data.accessToken;
        const newRefresh: string = data.data.refreshToken;

        setTokens(newAccess, newRefresh);
        refreshQueue.forEach((cb) => cb(newAccess));
        refreshQueue = [];

        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      } catch {
        clearTokens();
        if (typeof window !== 'undefined') window.location.href = '/login';
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export function setTokens(accessToken: string, refreshToken: string) {
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  Cookies.set('access_token', accessToken, { secure: isSecure, sameSite: 'lax', expires: 1 / 96 }); // 15 min
  Cookies.set('refresh_token', refreshToken, { secure: isSecure, sameSite: 'lax', expires: 30 });
}

export function clearTokens() {
  Cookies.remove('access_token');
  Cookies.remove('refresh_token');
}
