import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
  Linking,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { apiFetch, fileUrl } from "@/src/lib/api";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

const CHANGES = [
  "Add flowers", "New patio", "Lush green lawn", "Water feature",
  "Garden lighting", "Cosy seating area", "Stone pathway", "Trees & shrubs",
];
const STYLES = ["Tranquil", "Modern", "Cottage", "Wildlife-friendly"];

type Hotspot = { id: string; name: string; description: string; price: string; retailer: string; url: string; x: number; y: number };
type Design = { id: string; image_path: string; changes: string[]; style?: string; hotspots: Hotspot[]; saved: boolean };
type Project = { id: string; title: string; original_path: string; designs: Design[] };

export default function ProjectViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();

  const [project, setProject] = useState<Project | null>(null);
  const [current, setCurrent] = useState<Design | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [selChanges, setSelChanges] = useState<string[]>([]);
  const [style, setStyle] = useState(STYLES[0]);
  const [generating, setGenerating] = useState(false);
  const [activeHotspot, setActiveHotspot] = useState<Hotspot | null>(null);
  const [showHotspots, setShowHotspots] = useState(true);

  const imgH = Math.round((width - spacing.lg * 2) * 0.85);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ project: Project }>(`/projects/${id}`);
      setProject(r.project);
      if (r.project.designs?.length) {
        setCurrent(r.project.designs[r.project.designs.length - 1]);
      }
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const toggleChange = (c: string) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setSelChanges((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await apiFetch<{ design: Design }>(`/projects/${id}/redesign`, {
        method: "POST",
        body: { changes: selChanges, style },
      });
      setCurrent(r.design);
      setShowBefore(false);
      setShowHotspots(true);
      await load();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show("Your garden glow-up is ready! 🌿✨", "success");
    } catch (e: any) {
      toast.show(e.message || "Redesign failed", "error");
    } finally {
      setGenerating(false);
    }
  };

  const saveDesign = async () => {
    if (!current) return;
    try {
      await apiFetch(`/projects/${id}/designs/${current.id}/save`, { method: "POST" });
      toast.show("Saved to your project 💾", "success");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const openHotspot = (h: Hotspot) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActiveHotspot(h);
  };

  if (!project) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  const displayPath = showBefore || !current ? project.original_path : current.image_path;
  const displayUri = fileUrl(displayPath);

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-project" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{project.title}</Text>
        <View style={{ flexDirection: "row", gap: spacing.xs }}>
          {current && (
            <Pressable testID="save-design" style={styles.iconBtn} onPress={saveDesign}>
              <Feather name={current.saved ? "check-circle" : "bookmark"} size={20} color={colors.brand} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Image viewer */}
        <View style={[styles.imageWrap, { height: imgH, marginHorizontal: spacing.lg }]}>
          {displayUri ? (
            <Image source={{ uri: displayUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
              <Feather name="image" size={40} color={colors.muted} />
            </View>
          )}

          {/* Before/After badge */}
          <View style={styles.stateBadge}>
            <Text style={styles.stateBadgeText}>{showBefore || !current ? "BEFORE" : "AFTER ✨"}</Text>
          </View>

          {/* Hotspots (only on after image) */}
          {current && !showBefore && showHotspots &&
            current.hotspots.map((h) => (
              <Pressable
                key={h.id}
                testID={`hotspot-${h.id}`}
                onPress={() => openHotspot(h)}
                style={[styles.hotspot, { left: h.x * (width - spacing.lg * 2) - 18, top: h.y * imgH - 18 }]}
              >
                <BlurView intensity={40} tint="light" style={styles.hotspotBlur}>
                  <View style={styles.hotspotInner}>
                    <Feather name="plus" size={18} color="#fff" />
                  </View>
                </BlurView>
              </Pressable>
            ))}

          {/* Toggle before/after */}
          {current && (
            <Pressable
              testID="before-after-toggle"
              style={styles.toggle}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                setShowBefore((s) => !s);
              }}
            >
              <Feather name="repeat" size={15} color={colors.onSurface} />
              <Text style={styles.toggleText}>{showBefore ? "See After" : "See Before"}</Text>
            </Pressable>
          )}

          {current && !showBefore && (
            <Pressable
              testID="toggle-hotspots"
              style={styles.eyeToggle}
              onPress={() => setShowHotspots((s) => !s)}
            >
              <Feather name={showHotspots ? "shopping-bag" : "eye-off"} size={15} color="#fff" />
            </Pressable>
          )}
        </View>

        {current && !showBefore && showHotspots && (
          <Text style={styles.shopHint}>Tap the + markers to shop this look 🛍️</Text>
        )}

        {/* Redesign panel */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>
            {current ? "Try another look" : "Choose your changes"}
          </Text>

          <Text style={styles.panelLabel}>What would you like to change?</Text>
          <View style={styles.chipsWrap}>
            {CHANGES.map((c) => {
              const active = selChanges.includes(c);
              return (
                <Pressable
                  key={c}
                  testID={`change-${c}`}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggleChange(c)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.panelLabel}>Style</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {STYLES.map((s) => {
              const active = style === s;
              return (
                <Pressable
                  key={s}
                  testID={`style-${s}`}
                  style={[styles.styleChip, active && styles.styleChipActive]}
                  onPress={() => setStyle(s)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable testID="generate-button" style={styles.generateBtn} onPress={generate} disabled={generating}>
            <Feather name="zap" size={18} color="#fff" />
            <Text style={styles.generateText}>{current ? "Regenerate" : "Redesign with AI"}</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Generating overlay */}
      <Modal visible={generating} transparent animationType="fade">
        <View style={styles.genOverlay}>
          <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.genCard}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.genEmoji}>🌱🌸🌿</Text>
            <Text style={styles.genText}>Growing your dream garden...</Text>
            <Text style={styles.genSub}>This can take up to 30 seconds</Text>
          </LinearGradient>
        </View>
      </Modal>

      {/* Hotspot product modal */}
      <Modal visible={!!activeHotspot} transparent animationType="slide" onRequestClose={() => setActiveHotspot(null)}>
        <View style={styles.hsOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setActiveHotspot(null)} />
          <View style={[styles.hsCard, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.hsRetailerRow}>
              <View style={styles.hsIcon}><Feather name="shopping-bag" size={18} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hsName}>{activeHotspot?.name}</Text>
                <Text style={styles.hsRetailer}>at {activeHotspot?.retailer}</Text>
              </View>
              {!!activeHotspot?.price && <Text style={styles.hsPrice}>{activeHotspot?.price}</Text>}
            </View>
            <Text style={styles.hsDesc}>{activeHotspot?.description}</Text>
            <Pressable
              testID="visit-retailer-button"
              style={styles.hsBtn}
              onPress={() => activeHotspot && Linking.openURL(activeHotspot.url)}
            >
              <Feather name="external-link" size={16} color="#fff" />
              <Text style={styles.hsBtnText}>Shop at {activeHotspot?.retailer}</Text>
            </Pressable>
            <Text style={styles.hsNote}>Affiliate links coming soon — supports the app 💚</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, textAlign: "center", marginHorizontal: spacing.sm },
  imageWrap: { borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  placeholder: { alignItems: "center", justifyContent: "center" },
  stateBadge: { position: "absolute", top: spacing.md, left: spacing.md, backgroundColor: "rgba(42,54,46,0.75)", paddingVertical: 5, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  stateBadgeText: { color: "#fff", fontFamily: fonts.text, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  hotspot: { position: "absolute", width: 36, height: 36 },
  hotspotBlur: { width: 36, height: 36, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.6)" },
  hotspotInner: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  toggle: { position: "absolute", bottom: spacing.md, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.92)", paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill },
  toggleText: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 13 },
  eyeToggle: { position: "absolute", bottom: spacing.md, right: spacing.md, width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  shopHint: { fontFamily: fonts.text, color: colors.muted, textAlign: "center", marginTop: spacing.md, fontSize: 13 },
  panel: { padding: spacing.lg, gap: spacing.md },
  panelTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  panelLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xs },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: 9, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: fonts.text, fontWeight: "600", color: colors.onSurfaceSecondary, fontSize: 13 },
  chipTextActive: { color: "#fff" },
  styleChip: { paddingVertical: 9, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  styleChipActive: { backgroundColor: colors.brandSecondary, borderColor: colors.brandSecondary },
  generateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, height: 56, borderRadius: radius.md, marginTop: spacing.md },
  generateText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 16 },
  genOverlay: { flex: 1, backgroundColor: "rgba(42,54,46,0.5)", alignItems: "center", justifyContent: "center", padding: spacing.xl },
  genCard: { borderRadius: radius.lg, padding: spacing["2xl"], alignItems: "center", gap: spacing.md, width: "100%" },
  genEmoji: { fontSize: 30 },
  genText: { fontFamily: fonts.display, fontSize: 20, color: "#fff", textAlign: "center" },
  genSub: { fontFamily: fonts.text, color: "rgba(255,255,255,0.85)", fontSize: 13 },
  hsOverlay: { flex: 1, backgroundColor: "rgba(42,54,46,0.5)", justifyContent: "flex-end" },
  hsCard: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.xs },
  hsRetailerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  hsIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  hsName: { fontFamily: fonts.display, fontSize: 18, color: colors.onSurface },
  hsRetailer: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  hsPrice: { fontFamily: fonts.display, fontSize: 20, color: colors.brand },
  hsDesc: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 15, lineHeight: 21 },
  hsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, height: 52, borderRadius: radius.md },
  hsBtnText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 15 },
  hsNote: { fontFamily: fonts.text, color: colors.muted, textAlign: "center", fontSize: 12 },
});
