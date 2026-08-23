import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { apiFetch, saveToken, clearToken, loadToken } from "@/src/lib/api";

if (Platform.OS !== "web") {
  WebBrowser.maybeCompleteAuthSession();
}

export type User = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  picture?: string | null;
  bio?: string;
  allow_messages?: boolean;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, role: string) => Promise<void>;
  googleLogin: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: User) => void;
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);
export const useAuth = () => useContext(AuthContext);

function extractSessionId(url: string): string | null {
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const handledSessions = useRef<Set<string>>(new Set());

  const finishSession = useCallback(async (sessionId: string) => {
    if (handledSessions.current.has(sessionId)) return;
    handledSessions.current.add(sessionId);
    const data = await apiFetch<{ session_token: string; user: User }>("/auth/session", {
      method: "POST",
      body: { session_id: sessionId },
      auth: false,
    });
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  const checkExisting = useCallback(async () => {
    const t = await loadToken();
    if (!t) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<{ user: User }>("/auth/me");
      setUser(data.user);
    } catch {
      await clearToken();
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      // Web: process session_id in URL first
      if (Platform.OS === "web") {
        const href = window.location.href;
        const sid = extractSessionId(href);
        if (sid) {
          try {
            await finishSession(sid);
            const clean = window.location.origin + window.location.pathname;
            window.history.replaceState(window.history.state, "", clean);
          } catch (e) {
            console.log("web session error", e);
          }
          setLoading(false);
          return;
        }
      } else {
        // Native cold start deep link
        const initial = await Linking.getInitialURL();
        if (initial) {
          const sid = extractSessionId(initial);
          if (sid) {
            try {
              await finishSession(sid);
            } catch (e) {
              console.log("cold link error", e);
            }
            setLoading(false);
            return;
          }
        }
      }
      await checkExisting();
    })();
  }, [finishSession, checkExisting]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<{ session_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string, role: string) => {
    const data = await apiFetch<{ session_token: string; user: User }>("/auth/register", {
      method: "POST",
      body: { name, email, password, role },
      auth: false,
    });
    await saveToken(data.session_token);
    setUser(data.user);
  }, []);

  const googleLogin = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web" ? window.location.origin + "/" : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }

    let captured: string | null = null;
    const sub = Linking.addEventListener("url", (e) => {
      const sid = extractSessionId(e.url);
      if (sid) captured = sid;
    });
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      let sid: string | null = null;
      if (result.type === "success" && result.url) {
        sid = extractSessionId(result.url);
      }
      if (!sid && captured) sid = captured;
      if (!sid) {
        const init = await Linking.getInitialURL();
        if (init) sid = extractSessionId(init);
      }
      if (sid) await finishSession(sid);
    } finally {
      sub.remove();
    }
  }, [finishSession]);

  const logout = useCallback(async () => {
    await clearToken();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: User }>("/auth/me");
      setUser(data.user);
    } catch {}
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, googleLogin, logout, refresh, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
