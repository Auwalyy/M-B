'use client';

import type { AuthResponseDto, AuthUserDto, LoginInput, Permission, RegisterInput } from '@mb/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessionChange, refreshSession, setSession } from './api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  user: AuthUserDto | null;
  login: (input: LoginInput) => Promise<AuthUserDto>;
  register: (input: RegisterInput) => Promise<AuthUserDto>;
  logout: () => Promise<void>;
  /** Replace the cached profile (e.g. after editing it or changing password). */
  setUser: (user: AuthUserDto) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const CHANNEL = 'mb-auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<AuthUserDto | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    const off = onSessionChange((session) => {
      if (session) {
        setUserState(session.user);
        setStatus('authenticated');
      } else {
        setUserState(null);
        setStatus('anonymous');
        queryClient.clear();
      }
    });
    // Restore the session from the refresh cookie on page load.
    void refreshSession().then((s) => {
      if (!s) setStatus('anonymous');
    });

    // Sign-out in one tab signs out every tab.
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
    if (channel) {
      channel.onmessage = (e) => {
        if (e.data === 'logout') setSession(null);
        if (e.data === 'login') void refreshSession();
      };
    }
    return () => {
      off();
      channel?.close();
    };
  }, [queryClient]);

  const broadcast = (msg: string) => {
    if (typeof BroadcastChannel === 'undefined') return;
    const c = new BroadcastChannel(CHANNEL);
    c.postMessage(msg);
    c.close();
  };

  const login = useCallback(async (input: LoginInput) => {
    const res = await api.post<AuthResponseDto>('/auth/login', input);
    queryClient.clear();
    setSession(res);
    broadcast('login');
    return res.user;
  }, [queryClient]);

  const register = useCallback(async (input: RegisterInput) => {
    const res = await api.post<AuthResponseDto>('/auth/register', input);
    setSession(res);
    broadcast('login');
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSession(null);
      broadcast('logout');
    }
  }, []);

  const setUser = useCallback((u: AuthUserDto) => setUserState(u), []);

  const value = useMemo(() => ({ status, user, login, register, logout, setUser }), [status, user, login, register, logout, setUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function hasPermission(user: AuthUserDto | null, permission: Permission): boolean {
  return Boolean(user?.permissions.includes(permission));
}

export function useCan(permission: Permission): boolean {
  return hasPermission(useAuth().user, permission);
}

export const isStaff = (user: AuthUserDto | null) => Boolean(user && user.role !== 'CUSTOMER');
