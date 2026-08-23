import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Modal } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { colors, spacing, radius, fonts } from "@/src/theme";

const DISMISS_KEY = "glam_install_dismissed";

/**
 * Friendly, no-brainer "install this app" prompt for the web/PWA build.
 * - Chrome/Edge (Android + desktop): captures beforeinstallprompt -> one-tap Install.
 * - iOS Safari: shows simple "Share -> Add to Home Screen" steps (no native prompt exists).
 * - Hides when already installed (standalone) or previously dismissed. No-op on native apps.
 */
export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [deferred, setDeferred] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    // Already installed?
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;

    // Previously dismissed this session/device?
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {}

    const ua = window.navigator.userAgent || "";
    const iOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(iOS);

    const onBip = (e: any) => {
      e.preventDefault();
      setDeferred(e);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    // Always surface the prompt on web (one-tap install if supported, else clear steps).
    const t = setTimeout(() => setVisible(true), 1200);

    window.addEventListener("appinstalled", () => setVisible(false));

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      if (t) clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  const install = async () => {
    if (deferred) {
      deferred.prompt();
      try {
        await deferred.userChoice;
      } catch {}
      setDeferred(null);
      setVisible(false);
    } else {
      // No native prompt (iOS, or already dismissed by browser) -> show steps.
      setHowToOpen(true);
    }
  };

  if (Platform.OS !== "web" || !visible) return null;

  return (
    <>
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.banner}>
          <Image source={require("../../assets/images/icon.png")} style={styles.icon} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Add to your home screen</Text>
            <Text style={styles.sub}>Open Glam up your Garden like an app — one tap, no app store.</Text>
          </View>
          <Pressable testID="install-app-btn" style={styles.cta} onPress={install}>
            <Feather name="download" size={15} color="#fff" />
            <Text style={styles.ctaText}>{deferred ? "Install" : "How"}</Text>
          </Pressable>
          <Pressable testID="install-dismiss" style={styles.close} onPress={dismiss} hitSlop={10}>
            <Feather name="x" size={18} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      <Modal visible={howToOpen} transparent animationType="fade" onRequestClose={() => setHowToOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setHowToOpen(false)} />
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <View style={styles.sheet}>
            <Image source={require("../../assets/images/icon.png")} style={styles.sheetIcon} contentFit="cover" />
            <Text style={styles.sheetTitle}>Save to your home screen</Text>
            {isIOS ? (
              <>
                <Step n="1" icon="share" text="Tap the Share button in Safari's toolbar" />
                <Step n="2" icon="plus-square" text="Choose “Add to Home Screen”" />
                <Step n="3" icon="check" text="Tap “Add” — the Glam up your Garden icon appears on your home screen" />
              </>
            ) : (
              <>
                <Step n="1" icon="more-vertical" text="Open your browser menu (⋮ or the address-bar icon)" />
                <Step n="2" icon="download" text="Choose “Install app” / “Add to Home screen”" />
                <Step n="3" icon="check" text="Confirm — it opens like a real app from your home screen or desktop" />
              </>
            )}
            <Pressable testID="install-howto-done" style={styles.doneBtn} onPress={() => { setHowToOpen(false); dismiss(); }}>
              <Text style={styles.doneText}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Step({ n, icon, text }: { n: string; icon: any; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Feather name={icon} size={18} color={colors.brand} style={{ marginRight: spacing.sm }} />
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", padding: spacing.md, zIndex: 999 },
  banner: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, width: "100%", maxWidth: 460,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  icon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  title: { fontFamily: fonts.display, fontSize: 15, color: colors.onSurface },
  sub: { fontFamily: fonts.text, fontSize: 12, color: colors.muted, lineHeight: 16 },
  cta: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.brand, paddingVertical: 9, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  ctaText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 13 },
  close: { padding: 4 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,54,46,0.5)" },
  sheetWrap: { flex: 1, justifyContent: "center", alignItems: "center", padding: spacing.lg },
  sheet: { width: "100%", maxWidth: 420, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, alignItems: "stretch" },
  sheetIcon: { width: 64, height: 64, borderRadius: radius.md, alignSelf: "center" },
  sheetTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, textAlign: "center" },
  step: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", marginRight: spacing.sm },
  stepNumText: { color: "#fff", fontFamily: fonts.text, fontWeight: "800", fontSize: 12 },
  stepText: { flex: 1, fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  doneBtn: { backgroundColor: colors.brand, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  doneText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 15 },
});
