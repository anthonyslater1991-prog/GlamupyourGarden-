import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API = `${BASE}/api`;
export const TOKEN_KEY = "glam_session_token";

let memToken: string | null = null;

export function setToken(token: string | null) {
  memToken = token;
}
export function getMemToken() {
  return memToken;
}

export async function loadToken(): Promise<string | null> {
  const t = await storage.secureGet<string>(TOKEN_KEY, "");
  memToken = t || null;
  return memToken;
}

export async function saveToken(token: string) {
  memToken = token;
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken() {
  memToken = null;
  await storage.secureRemove(TOKEN_KEY);
}

type Opts = { method?: string; body?: any; auth?: boolean };

export async function apiFetch<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== false && memToken) headers.Authorization = `Bearer ${memToken}`;
  const res = await fetch(`${API}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && data.detail) || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : "Request failed");
  }
  return data as T;
}

// Build an authenticated URL for <Image> display (works on web + native).
export function fileUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  const t = memToken ? `?token=${encodeURIComponent(memToken)}` : "";
  return `${API}/files/${path}${t}`;
}
