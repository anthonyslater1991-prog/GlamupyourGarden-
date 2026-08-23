import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
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
import { useAuth } from "@/src/context/AuthContext";
import { storage } from "@/src/utils/storage";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

const CHANGES = [
  "Add flowers", "New patio", "Lush green lawn", "Water feature",
  "Garden lighting", "Cosy seating area", "Stone pathway", "Trees & shrubs",
];
const STYLES = ["Tranquil", "Modern", "Cottage", "Wildlife-friendly"];
const GARDEN_TYPES = ["Zen", "Cottage", "Modern", "Mediterranean", "Tropical", "Family", "Wildlife"];
const MOODS = ["Tranquil", "Relaxing", "Vibrant", "Cosy", "Minimal", "Playful"];
const COLOUR_SCHEMES = ["Green & natural", "Blues & purples", "Warm sunset", "Whites & pastels", "Bold & bright"];
const ORNAMENTS = ["Water feature", "Statues & ornaments", "Pergola", "Fire pit", "Raised beds", "Bird bath", "Garden lighting", "Decking"];

type Hotspot = { id: string; name: string; description: string; price: string; retailer: string; url: string; x: number; y: number };
type Design = { id: string; image_path: string; changes: string[]; style?: string; hotspots: Hotspot[]; saved: boolean };
type Project = { id: string; title: string; original_path: string; designs: Design[]; gallery?: { id: string; image_path: string; note?: string }[] };

export default function ProjectViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, refresh } = useAuth();
  const { width } = useWindowDimensions();

  const [project, setProject] = useState<Project | null>(null);
  const [current, setCurrent] = useState<Design | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [selChanges, setSelChanges] = useState<string[]>([]);
  const [style, setStyle] = useState(STYLES[0]);
  const [gardenType, setGardenType] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [colourScheme, setColourScheme] = useState<string | null>(null);
  const [ornaments, setOrnaments] = useState<string[]>([]);
  const [mustHaves, setMustHaves] = useState("");
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [wishInput, setWishInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [activeHotspot, setActiveHotspot] = useState<Hotspot | null>(null);
  const [showHotspots, setShowHotspots] = useState(true);
  const [priceSummary, setPriceSummary] = useState<any>(null);
  const [priceInput, setPriceInput] = useState("");
  const [addingPrice, setAddingPrice] = useState(false);

  useEffect(() => {
    if (activeHotspot) {
      setPriceInput("");
      setAddingPrice(false);
      apiFetch(`/product-prices?name=${encodeURIComponent(activeHotspot.name)}`)
        .then(setPriceSummary)
        .catch(() => setPriceSummary(null));
    } else {
      setPriceSummary(null);
    }
  }, [activeHotspot]);

  const submitPrice = async () => {
    if (!activeHotspot || !priceInput.trim()) return;
    try {
      const r = await apiFetch(`/product-prices`, {
        method: "POST",
        body: { name: activeHotspot.name, price: priceInput.trim(), retailer: activeHotspot.retailer, url: activeHotspot.url },
      });
      setPriceSummary(r);
      setPriceInput("");
      setAddingPrice(false);
      toast.show("Thanks! Price shared with the community 💚", "success");
    } catch (e: any) {
      toast.show(e.message || "Failed to add price", "error");
    }
  };

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

  // Merge any products the AI assistant queued into the wishlist.
  useEffect(() => {
    (async () => {
      const pending = await storage.getItem<string[]>("glam_pending_wishlist", []);
      if (pending && pending.length) {
        setWishlist((prev) => Array.from(new Set([...prev, ...pending])));
        await storage.removeItem("glam_pending_wishlist");
        toast.show("Added the assistant's picks to your wishlist 🛍️", "success");
      }
    })();
  }, []);

  const saveMyStyle = async () => {
    try {
      await apiFetch("/auth/style", {
        method: "PUT",
        body: { data: { style, gardenType, mood, colourScheme, ornaments } },
      });
      await refresh();
      toast.show("Saved as your style ⭐", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const applyMyStyle = () => {
    const s = user?.saved_style;
    if (!s) {
      toast.show("Save a style first to reuse it", "info");
      return;
    }
    if (s.style) setStyle(s.style);
    setGardenType(s.gardenType ?? null);
    setMood(s.mood ?? null);
    setColourScheme(s.colourScheme ?? null);
    setOrnaments(Array.isArray(s.ornaments) ? s.ornaments : []);
    toast.show("Your saved style applied ✨", "success");
  };

  const toggleChange = (c: string) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setSelChanges((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const toggleOrnament = (c: string) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setOrnaments((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  };

  const addWish = () => {
    const v = wishInput.trim();
    if (!v) return;
    setWishlist((prev) => [...prev, v]);
    setWishInput("");
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await apiFetch<{ design: Design }>(`/projects/${id}/redesign`, {
        method: "POST",
        body: {
          changes: selChanges,
          style,
          garden_type: gardenType,
          mood,
          colour_scheme: colourScheme,
          ornaments,
          must_haves: mustHaves,
          wishlist,
        },
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

      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
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
          {project.gallery && project.gallery.length > 0 && (
            <View style={{ gap: spacing.sm }}>
              <Text style={styles.panelLabel}>Saved inspiration 🖼️</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
                {project.gallery.map((g) => (
                  <Image key={g.id} source={{ uri: fileUrl(g.image_path) }} style={styles.galleryThumb} contentFit="cover" />
                ))}
              </ScrollView>
            </View>
          )}
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

          <Text style={styles.panelLabel}>Garden type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {GARDEN_TYPES.map((s) => {
              const active = gardenType === s;
              return (
                <Pressable key={s} testID={`gtype-${s}`} style={[styles.styleChip, active && styles.styleChipActive]} onPress={() => setGardenType(active ? null : s)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.panelLabel}>Feel / mood</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {MOODS.map((s) => {
              const active = mood === s;
              return (
                <Pressable key={s} testID={`mood-${s}`} style={[styles.styleChip, active && styles.styleChipActive]} onPress={() => setMood(active ? null : s)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.panelLabel}>Colour scheme</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {COLOUR_SCHEMES.map((s) => {
              const active = colourScheme === s;
              return (
                <Pressable key={s} testID={`colour-${s}`} style={[styles.styleChip, active && styles.styleChipActive]} onPress={() => setColourScheme(active ? null : s)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.panelLabel}>Features & ornaments</Text>
          <View style={styles.chipsWrap}>
            {ORNAMENTS.map((c) => {
              const active = ornaments.includes(c);
              return (
                <Pressable key={c} testID={`ornament-${c}`} style={[styles.chip, active && styles.chipActive]} onPress={() => toggleOrnament(c)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.panelLabel}>Exact items or brands you want 🛍️</Text>
          <Text style={styles.helperText}>Add specific products/brands (e.g. "Farrow & Ball Sage paint", "rattan corner sofa") — each gets a shoppable supplier link.</Text>
          <View style={styles.wishRow}>
            <TextInput
              testID="wishlist-input"
              style={styles.wishInput}
              placeholder="Type an item or brand..."
              placeholderTextColor={colors.muted}
              value={wishInput}
              onChangeText={setWishInput}
              onSubmitEditing={addWish}
              returnKeyType="done"
            />
            <Pressable testID="add-wishlist" style={styles.wishAdd} onPress={addWish}>
              <Feather name="plus" size={20} color="#fff" />
            </Pressable>
          </View>
          {wishlist.length > 0 && (
            <View style={styles.chipsWrap}>
              {wishlist.map((w, i) => (
                <Pressable key={`${w}-${i}`} testID={`wish-${i}`} style={styles.wishChip} onPress={() => setWishlist((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Text style={styles.wishChipText}>{w}</Text>
                  <Feather name="x" size={13} color={colors.brand} />
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.panelLabel}>Anything else you must have?</Text>
          <TextInput
            testID="must-haves-input"
            style={styles.notesInput}
            placeholder="e.g. keep the old oak tree, low-maintenance, kid-safe..."
            placeholderTextColor={colors.muted}
            value={mustHaves}
            onChangeText={setMustHaves}
            multiline
          />

          <View style={styles.styleActions}>
            <Pressable testID="save-my-style" style={styles.styleActionBtn} onPress={saveMyStyle}>
              <Feather name="star" size={15} color={colors.brand} />
              <Text style={styles.styleActionText}>Save my style</Text>
            </Pressable>
            <Pressable testID="apply-my-style" style={styles.styleActionBtn} onPress={applyMyStyle}>
              <Feather name="refresh-ccw" size={15} color={colors.brand} />
              <Text style={styles.styleActionText}>Apply my style</Text>
            </Pressable>
          </View>

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

            {priceSummary && priceSummary.count > 0 && (
              <View style={styles.communityPrice}>
                <Feather name="users" size={15} color={colors.brand} />
                <Text style={styles.communityPriceText}>
                  Community price: {priceSummary.avg_display} · from {priceSummary.count} buyer{priceSummary.count === 1 ? "" : "s"}
                </Text>
              </View>
            )}

            {priceSummary?.best_value && (
              <View style={styles.bestValue} testID="best-value-badge">
                <Feather name="award" size={14} color="#fff" />
                <Text style={styles.bestValueText}>Best value: {priceSummary.best_value.display} at {priceSummary.best_value.retailer}</Text>
              </View>
            )}

            {priceSummary?.latest?.length > 0 && (
              <View style={styles.historyBox}>
                <Text style={styles.historyTitle}>Recent prices</Text>
                {priceSummary.latest.map((p: any) => (
                  <View key={p.id} style={styles.historyRow}>
                    <Text style={styles.historyPrice}>{p.display}</Text>
                    <Text style={styles.historyMeta} numberOfLines={1}>
                      {p.retailer ? `at ${p.retailer}` : ""} · {p.user_name}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {addingPrice ? (
              <View style={styles.priceRow}>
                <TextInput
                  testID="price-input"
                  style={styles.priceInput}
                  placeholder="What did you pay? e.g. 45"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  value={priceInput}
                  onChangeText={setPriceInput}
                />
                <Pressable testID="submit-price" style={styles.priceSubmit} onPress={submitPrice}>
                  <Text style={styles.priceSubmitText}>Add</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable testID="add-price-button" style={styles.addPriceBtn} onPress={() => setAddingPrice(true)}>
                <Feather name="tag" size={15} color={colors.brand} />
                <Text style={styles.addPriceText}>I bought this — add the price you paid</Text>
              </Pressable>
            )}

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
  galleryThumb: { width: 90, height: 90, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: 9, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: fonts.text, fontWeight: "600", color: colors.onSurfaceSecondary, fontSize: 13 },
  chipTextActive: { color: "#fff" },
  styleChip: { paddingVertical: 9, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  styleChipActive: { backgroundColor: colors.brandSecondary, borderColor: colors.brandSecondary },
  helperText: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, lineHeight: 17 },
  wishRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  wishInput: { flex: 1, height: 48, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  wishAdd: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  wishChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EFF4EE", borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: spacing.md },
  wishChipText: { fontFamily: fonts.text, fontWeight: "600", color: colors.brand, fontSize: 13 },
  notesInput: { minHeight: 70, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, textAlignVertical: "top" },
  styleActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  styleActionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1.5, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md },
  styleActionText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 13 },
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
  communityPrice: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#EFF4EE", borderRadius: radius.md, padding: spacing.md },
  communityPriceText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 13, flex: 1 },
  bestValue: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  bestValueText: { fontFamily: fonts.text, fontWeight: "700", color: "#fff", fontSize: 13, flex: 1 },
  historyBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  historyTitle: { fontFamily: fonts.text, fontWeight: "800", color: colors.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  historyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  historyPrice: { fontFamily: fonts.text, fontWeight: "800", color: colors.onSurface, fontSize: 14, width: 70 },
  historyMeta: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, flex: 1 },
  addPriceBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1.5, borderColor: colors.borderStrong, borderRadius: radius.md, paddingVertical: spacing.md },
  addPriceText: { fontFamily: fonts.text, fontWeight: "600", color: colors.brand, fontSize: 13 },
  priceRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  priceInput: { flex: 1, height: 48, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  priceSubmit: { backgroundColor: colors.brand, height: 48, paddingHorizontal: spacing.xl, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  priceSubmitText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700" },
});
