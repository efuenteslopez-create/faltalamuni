"use client";

/**
 * FLM — Estado de autenticación.
 * La sesión vive en una cookie httpOnly manejada por /api/auth/*;
 * este provider solo refleja quién está logueado (GET /api/auth/me).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, type ApiUser } from "./api";

interface AuthState {
  user: ApiUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api.me();
      setUser(u);
    } catch (err) {
      // 401 = sin sesión; cualquier otro error también deja usuario nulo
      // para no bloquear la navegación pública.
      if (err instanceof ApiError && err.status !== 401) {
        /* noop: se reintentará en el próximo refresh */
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { user: u } = await api.login({ email, password });
    setUser(u);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const { user: u } = await api.register({ email, password, displayName });
      setUser(u);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
