import { Platform } from "react-native";

/**
 * Injects the PWA manifest + home-screen icons into the document <head> on web.
 * Needed because Expo's `output: "single"` SPA does not use `app/+html.tsx`,
 * so we add the install metadata at runtime. No-op on native.
 */
export function installPwaHead() {
  if (Platform.OS !== "web" || typeof document === "undefined") return;

  const ensure = (selector: string, create: () => HTMLElement) => {
    if (!document.head.querySelector(selector)) {
      document.head.appendChild(create());
    }
  };

  ensure('link[rel="manifest"]', () => {
    const l = document.createElement("link");
    l.rel = "manifest";
    l.href = "/manifest.json";
    return l;
  });

  ensure('link[rel="apple-touch-icon"]', () => {
    const l = document.createElement("link");
    l.rel = "apple-touch-icon";
    l.href = "/apple-touch-icon.png";
    return l;
  });

  const metas: [string, string][] = [
    ["apple-mobile-web-app-capable", "yes"],
    ["mobile-web-app-capable", "yes"],
    ["apple-mobile-web-app-status-bar-style", "default"],
    ["apple-mobile-web-app-title", "Glam up your Garden"],
    ["theme-color", "#4A7C59"],
  ];
  metas.forEach(([name, content]) => {
    ensure(`meta[name="${name}"]`, () => {
      const m = document.createElement("meta");
      m.name = name;
      m.content = content;
      return m;
    });
  });
}
