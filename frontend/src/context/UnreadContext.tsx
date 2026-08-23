import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { AppState } from "react-native";
import { apiFetch } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";

type UnreadCtx = { count: number; refresh: () => Promise<void> };
const Ctx = createContext<UnreadCtx>({ count: 0, refresh: async () => {} });
export const useUnread = () => useContext(Ctx);

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const timer = useRef<any>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setCount(0);
      return;
    }
    try {
      const r = await apiFetch<{ count: number }>("/unread");
      setCount(r.count);
    } catch {}
  }, [user]);

  useEffect(() => {
    refresh();
    if (timer.current) clearInterval(timer.current);
    if (user) {
      timer.current = setInterval(refresh, 8000);
    }
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => {
      if (timer.current) clearInterval(timer.current);
      sub.remove();
    };
  }, [user, refresh]);

  return <Ctx.Provider value={{ count, refresh }}>{children}</Ctx.Provider>;
}
