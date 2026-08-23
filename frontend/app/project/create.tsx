import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { apiFetch } from "@/src/lib/api";
import { uploadImage } from "@/src/lib/upload";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

export default function CreateProject() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (!res.canceled && res.assets?.length) setImageUri(res.assets[0].uri);
  };

  const fromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return handlePermissionDenied(perm.canAskAgain, "Photos");
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (!res.canceled && res.assets?.length) setImageUri(res.assets[0].uri);
  };

  const create = async () => {
    if (!imageUri) {
      toast.show("Add a photo of your garden first 📷", "error");
      return;
    }
    setBusy(true);
    try {
      const path = await uploadImage(imageUri);
      const r = await apiFetch<{ project: { id: string } }>("/projects", {
        method: "POST",
        body: { title: title.trim() || "My Garden Project", original_path: path },
      });
      router.replace(`/project/${r.project.id}`);
    } catch (e: any) {
      toast.show(e.message || "Failed to create project", "error");
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="close-create" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>New Project</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40, gap: spacing.lg }}
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>{"Snap or upload your current garden and we'll glam it up ✨"}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Project name</Text>
          <TextInput
            testID="project-title-input"
            style={styles.input}
            placeholder="e.g. Back garden makeover"
            placeholderTextColor={colors.muted}
            value={title}
            onChangeText={setTitle}
          />
        </View>

        {imageUri ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: imageUri }} style={styles.preview} contentFit="cover" />
            <Pressable style={styles.retake} onPress={() => setImageUri(null)} testID="retake">
              <Feather name="refresh-cw" size={15} color="#fff" />
              <Text style={styles.retakeText}>Change photo</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.pickRow}>
            <Pressable testID="camera-button" style={styles.pickCard} onPress={fromCamera}>
              <View style={styles.pickIcon}><Feather name="camera" size={24} color={colors.brand} /></View>
              <Text style={styles.pickLabel}>Take photo</Text>
            </Pressable>
            <Pressable testID="library-button" style={styles.pickCard} onPress={fromLibrary}>
              <View style={styles.pickIcon}><Feather name="upload" size={24} color={colors.brand} /></View>
              <Text style={styles.pickLabel}>Upload photo</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable testID="create-project-button" style={[styles.cta, !imageUri && styles.ctaDisabled]} onPress={create} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Feather name="feather" size={18} color="#fff" />
              <Text style={styles.ctaText}>Create Project</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  iconBtn: { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  intro: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 15, lineHeight: 22 },
  field: { gap: spacing.sm },
  label: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, height: 52, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  pickRow: { flexDirection: "row", gap: spacing.md },
  pickCard: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, borderStyle: "dashed", paddingVertical: spacing.xl, alignItems: "center", gap: spacing.sm },
  pickIcon: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  pickLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  previewWrap: { borderRadius: radius.lg, overflow: "hidden" },
  preview: { width: "100%", height: 300, backgroundColor: colors.surfaceTertiary },
  retake: { position: "absolute", bottom: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(42,54,46,0.75)", paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  retakeText: { color: "#fff", fontFamily: fonts.text, fontWeight: "600", fontSize: 13 },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, height: 56, borderRadius: radius.md },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 16 },
});
