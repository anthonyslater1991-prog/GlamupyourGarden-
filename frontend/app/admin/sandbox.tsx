import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
  ScrollView,
  Modal,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { apiFetch, fileUrl } from "@/src/lib/api";
import { uploadImage } from "@/src/lib/upload";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { storage } from "@/src/utils/storage";
import CompareModal from "@/src/components/CompareModal";
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

type Result = { image_path: string; prompt: string; hotspots: any[] };
type Filters = {
  selChanges: string[];
  style: string;
  gardenType: string | null;
  mood: string | null;
  colourScheme: string | null;
  ornaments: string[];
  wishlistText: string;
  mustHaves: string;
  notes: string;
};
type Preset = { id: string; name: string; filters: Filters };

const PRESETS_KEY = "glam_sandbox_presets";

export default function AdminSandbox() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [selChanges, setSelChanges] = useState<string[]>([]);
  const [style, setStyle] = useState(STYLES[0]);
  const [gardenType, setGardenType] = useState<string | null>(null);
  const [mood, setMood] = useState<string | null>(null);
  const [colourScheme, setColourScheme] = useState<string | null>(null);
  const [ornaments, setOrnaments] = useState<string[]>([]);
  const [wishlistText, setWishlistText] = useState("");
  const [mustHaves, setMustHaves] = useState("");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [showBefore, setShowBefore] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);

  const result = results[0] || null;

  useEffect(() => {
    if (user && user.role !== "admin") router.replace("/(tabs)");
  }, [user]);

  useEffect(() => {
    storage.getItem<Preset[]>(PRESETS_KEY, []).then((p) => setPresets(p || []));
  }, []);

  const currentFilters = (): Filters => ({
    selChanges, style, gardenType, mood, colourScheme, ornaments, wishlistText, mustHaves, notes,
  });

  const applyFilters = (f: Filters) => {
    setSelChanges(f.selChanges || []);
    setStyle(f.style || STYLES[0]);
    setGardenType(f.gardenType ?? null);
    setMood(f.mood ?? null);
    setColourScheme(f.colourScheme ?? null);
    setOrnaments(f.ornaments || []);
    setWishlistText(f.wishlistText || "");
    setMustHaves(f.mustHaves || "");
    setNotes(f.notes || "");
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    const next = [{ id: `p_${Date.now()}`, name, filters: currentFilters() }, ...presets].slice(0, 20);
    setPresets(next);
    await storage.setItem(PRESETS_KEY, next);
    setPresetName("");
    setSaveOpen(false);
    toast.show(`Recipe "${name}" saved 📌`, "success");
  };

  const deletePreset = async (id: string) => {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    await storage.setItem(PRESETS_KEY, next);
  };

  const toggle = (arr: string[], set: (v: string[]) => void, val: string) => {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  };

  const handlePermissionDenied = (canAskAgain: boolean, what: string) => {
    if (canAskAgain) {
      toast.show(`${what} access is needed to continue`, "error");
    } else {
      toast.show(`Enable ${what} access in Settings`, "error");
      setTimeout(() => Linking.openSettings(), 900);
    }
  };

  const fromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return handlePermissionDenied(perm.canAskAgain, "Camera");
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!res.canceled && res.assets?.length) { setImageUri(res.assets[0].uri); }
  };

  const fromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return handlePermissionDenied(perm.canAskAgain, "Photos");
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!res.canceled && res.assets?.length) { setImageUri(res.assets[0].uri); }
  };

  const generate = async () => {
    if (!imageUri) { toast.show("Add a garden photo first 📷", "error"); return; }
    setBusy(true);
    try {
      const path = await uploadImage(imageUri);
      const wishlist = wishlistText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await apiFetch<Result>("/admin/sandbox-redesign", {
        method: "POST",
        body: {
          original_path: path,
          changes: selChanges,
          style,
          garden_type: gardenType,
          mood,
          colour_scheme: colourScheme,
          ornaments,
          must_haves: mustHaves.trim() || null,
          notes: notes.trim() || null,
          wishlist,
        },
      });
      setResults((prev) => [r, ...prev].slice(0, 2));
      setShowBefore(false);
      toast.show("Generated — nothing saved to the database ✨", "success");
    } catch (e: any) {
      toast.show(e.message || "Generation failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = async () => {
    if (!result) return;
    await Clipboard.setStringAsync(result.prompt);
    toast.show("Prompt copied 📋", "success");
  };

  const displayUri = result && !showBefore ? fileUrl(result.image_path) : imageUri || undefined;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-sandbox" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>AI Sandbox 🧪</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.lg }}
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.noteBox}>
          <Feather name="info" size={15} color={colors.brand} />
          <Text style={styles.noteText}>
            Test the AI redesign & prompt output on production. Nothing here is saved as a project or design.
          </Text>
        </View>

        {/* Saved recipes (presets) */}
        <View style={styles.field}>
          <View style={styles.promptTop}>
            <Text style={styles.panelLabel}>Saved recipes 📌</Text>
            <Pressable testID="save-preset" hitSlop={8} onPress={() => setSaveOpen(true)} style={styles.savePresetBtn}>
              <Feather name="plus" size={13} color={colors.brand} />
              <Text style={styles.savePresetText}>Save current</Text>
            </Pressable>
          </View>
          {presets.length === 0 ? (
            <Text style={styles.helperMuted}>Save a filter combo to re-run it instantly later.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {presets.map((p) => (
                <View key={p.id} style={styles.presetChip}>
                  <Pressable testID={`preset-${p.name}`} onPress={() => { applyFilters(p.filters); toast.show(`Recipe "${p.name}" loaded`, "success"); }}>
                    <Text style={styles.presetChipText}>{p.name}</Text>
                  </Pressable>
                  <Pressable testID={`preset-del-${p.name}`} hitSlop={6} onPress={() => deletePreset(p.id)}>
                    <Feather name="x" size={13} color={colors.muted} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Image preview */}
        {displayUri ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: displayUri }} style={styles.preview} contentFit="cover" />
            {result && (
              <View style={styles.stateBadge}>
                <Text style={styles.stateBadgeText}>{showBefore ? "BEFORE" : "AFTER ✨"}</Text>
              </View>
            )}
            <Pressable style={styles.retake} onPress={() => { setImageUri(null); setResults([]); }} testID="sandbox-retake">
              <Feather name="refresh-cw" size={15} color="#fff" />
              <Text style={styles.retakeText}>Change photo</Text>
            </Pressable>
            {result && (
              <Pressable style={styles.toggle} onPress={() => setShowBefore((s) => !s)} testID="sandbox-toggle">
                <Feather name={showBefore ? "eye" : "eye-off"} size={14} color="#fff" />
                <Text style={styles.retakeText}>{showBefore ? "See After" : "See Before"}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.pickRow}>
            <Pressable testID="sandbox-camera" style={styles.pickCard} onPress={fromCamera}>
              <View style={styles.pickIcon}><Feather name="camera" size={22} color={colors.brand} /></View>
              <Text style={styles.pickLabel}>Take photo</Text>
            </Pressable>
            <Pressable testID="sandbox-library" style={styles.pickCard} onPress={fromLibrary}>
              <View style={styles.pickIcon}><Feather name="upload" size={22} color={colors.brand} /></View>
              <Text style={styles.pickLabel}>Upload photo</Text>
            </Pressable>
          </View>
        )}

        {/* Prompt output */}
        {result && (
          <View style={styles.promptCard}>
            <View style={styles.promptTop}>
              <Text style={styles.panelLabel}>Prompt sent to the AI 🤖</Text>
              <Pressable testID="copy-prompt" hitSlop={8} onPress={copyPrompt}>
                <Feather name="copy" size={16} color={colors.brand} />
              </Pressable>
            </View>
            <Text style={styles.promptText} selectable>{result.prompt}</Text>
          </View>
        )}

        {/* Compare last two generations */}
        {results.length === 2 && (
          <Pressable testID="sandbox-compare" style={styles.compareBar} onPress={() => setCompareOpen(true)}>
            <Feather name="columns" size={16} color="#fff" />
            <Text style={styles.compareBarText}>Compare last 2 generations</Text>
          </Pressable>
        )}

        {/* Filters */}
        <ChipGroup label="Changes" options={CHANGES} selected={selChanges} onToggle={(v) => toggle(selChanges, setSelChanges, v)} />
        <ChipGroup label="Style" options={STYLES} selected={[style]} single onToggle={(v) => setStyle(v)} />
        <ChipGroup label="Garden type" options={GARDEN_TYPES} selected={gardenType ? [gardenType] : []} single onToggle={(v) => setGardenType(gardenType === v ? null : v)} />
        <ChipGroup label="Mood" options={MOODS} selected={mood ? [mood] : []} single onToggle={(v) => setMood(mood === v ? null : v)} />
        <ChipGroup label="Colour scheme" options={COLOUR_SCHEMES} selected={colourScheme ? [colourScheme] : []} single onToggle={(v) => setColourScheme(colourScheme === v ? null : v)} />
        <ChipGroup label="Ornaments & features" options={ORNAMENTS} selected={ornaments} onToggle={(v) => toggle(ornaments, setOrnaments, v)} />

        <View style={styles.field}>
          <Text style={styles.panelLabel}>Exact items / brands (comma-separated)</Text>
          <TextInput
            testID="sandbox-wishlist"
            style={styles.input}
            placeholder="e.g. Weber BBQ, rattan sofa set"
            placeholderTextColor={colors.muted}
            value={wishlistText}
            onChangeText={setWishlistText}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.panelLabel}>Must include</Text>
          <TextInput
            testID="sandbox-musthaves"
            style={styles.input}
            placeholder="e.g. keep the old oak tree"
            placeholderTextColor={colors.muted}
            value={mustHaves}
            onChangeText={setMustHaves}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.panelLabel}>Extra notes</Text>
          <TextInput
            testID="sandbox-notes"
            style={[styles.input, { height: 80, paddingTop: spacing.md }]}
            placeholder="Anything else to tell the AI…"
            placeholderTextColor={colors.muted}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </View>
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable testID="sandbox-generate" style={[styles.cta, (!imageUri || busy) && styles.ctaDisabled]} onPress={generate} disabled={busy || !imageUri}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="zap" size={18} color="#fff" />
              <Text style={styles.ctaText}>{result ? "Generate again" : "Generate (no save)"}</Text>
            </>
          )}
        </Pressable>
      </View>

      <CompareModal
        visible={compareOpen}
        onClose={() => setCompareOpen(false)}
        title="Compare generations"
        left={{ uri: results[1] ? fileUrl(results[1].image_path) : undefined, label: "Previous", caption: results[1]?.prompt }}
        right={{ uri: results[0] ? fileUrl(results[0].image_path) : undefined, label: "Latest", caption: results[0]?.prompt }}
      />

      <Modal visible={saveOpen} transparent animationType="fade" onRequestClose={() => setSaveOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSaveOpen(false)}>
          <Pressable style={styles.saveCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.saveTitle}>Save recipe 📌</Text>
            <Text style={styles.helperMuted}>Give this filter combo a name so you can re-run it later.</Text>
            <TextInput
              testID="preset-name-input"
              style={styles.input}
              placeholder="e.g. Cottage sunset"
              placeholderTextColor={colors.muted}
              value={presetName}
              onChangeText={setPresetName}
              autoFocus
            />
            <View style={styles.saveActions}>
              <Pressable style={styles.saveCancel} onPress={() => { setSaveOpen(false); setPresetName(""); }}>
                <Text style={styles.saveCancelText}>Cancel</Text>
              </Pressable>
              <Pressable testID="preset-save-confirm" style={[styles.saveConfirm, !presetName.trim() && styles.ctaDisabled]} onPress={savePreset} disabled={!presetName.trim()}>
                <Text style={styles.saveConfirmText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  single,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  single?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.panelLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <Pressable
              key={o}
              testID={`chip-${o}`}
              onPress={() => onToggle(o)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  noteBox: { flexDirection: "row", gap: spacing.sm, backgroundColor: "#EFF4EE", borderRadius: radius.md, padding: spacing.md, alignItems: "flex-start" },
  noteText: { flex: 1, fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
  pickRow: { flexDirection: "row", gap: spacing.md },
  pickCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, borderStyle: "dashed", paddingVertical: spacing.xl, alignItems: "center", gap: spacing.sm },
  pickIcon: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  pickLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  previewWrap: { borderRadius: radius.lg, overflow: "hidden" },
  preview: { width: "100%", height: 300, backgroundColor: colors.surfaceTertiary },
  stateBadge: { position: "absolute", top: spacing.md, left: spacing.md, backgroundColor: "rgba(42,54,46,0.75)", paddingVertical: 4, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  stateBadgeText: { color: "#fff", fontFamily: fonts.text, fontWeight: "800", fontSize: 11, letterSpacing: 0.5 },
  retake: { position: "absolute", bottom: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(42,54,46,0.75)", paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  toggle: { position: "absolute", bottom: spacing.md, left: spacing.md, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(42,54,46,0.75)", paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  retakeText: { color: "#fff", fontFamily: fonts.text, fontWeight: "600", fontSize: 13 },
  promptCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  promptTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  promptText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20 },
  field: { gap: spacing.sm },
  panelLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, minHeight: 50, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: fonts.text, fontWeight: "600", color: colors.onSurface, fontSize: 13 },
  chipTextOn: { color: "#fff" },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, height: 56, borderRadius: radius.md },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 16 },
  savePresetBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderColor: colors.brand, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: spacing.md },
  savePresetText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 12 },
  helperMuted: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, lineHeight: 17 },
  presetChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EFF4EE", borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: spacing.md },
  presetChipText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 13 },
  compareBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brandSecondary, height: 48, borderRadius: radius.md },
  compareBarText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(42,54,46,0.55)", justifyContent: "center", padding: spacing.xl },
  saveCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  saveTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  saveActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  saveCancel: { flex: 1, alignItems: "center", justifyContent: "center", height: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border },
  saveCancelText: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurfaceSecondary },
  saveConfirm: { flex: 1, alignItems: "center", justifyContent: "center", height: 48, borderRadius: radius.md, backgroundColor: colors.brand },
  saveConfirmText: { fontFamily: fonts.text, fontWeight: "700", color: "#fff" },
});
