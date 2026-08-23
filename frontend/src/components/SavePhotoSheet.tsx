import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { apiFetch, fileUrl } from "@/src/lib/api";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Project = { id: string; title: string; original_path?: string; designs: any[] };

export default function SavePhotoSheet({
  visible,
  imagePath,
  onClose,
}: {
  visible: boolean;
  imagePath?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ projects: Project[] }>("/projects");
      setProjects(r.projects);
    } catch {}
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const addTo = async (projectId: string) => {
    if (!imagePath) return;
    setBusy(true);
    try {
      await apiFetch(`/projects/${projectId}/gallery`, { method: "POST", body: { image_path: imagePath } });
      toast.show("Photo saved to your project 🪴", "success");
      onClose();
    } catch (e: any) {
      toast.show(e.message || "Failed to save", "error");
    } finally {
      setBusy(false);
    }
  };

  const newProject = async () => {
    if (!imagePath) return;
    setBusy(true);
    try {
      await apiFetch("/projects", { method: "POST", body: { title: "Saved inspiration", original_path: imagePath } });
      toast.show("New project created from photo ✨", "success");
      onClose();
    } catch (e: any) {
      toast.show(e.message || "Failed to save", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>Save photo to a project 🪴</Text>
          {busy && <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.sm }} />}
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            <Pressable testID="save-new-project" style={styles.newRow} onPress={newProject} disabled={busy}>
              <View style={styles.newIcon}><Feather name="plus" size={20} color="#fff" /></View>
              <Text style={styles.newText}>New project from this photo</Text>
            </Pressable>
            {projects.map((p) => {
              const thumb = fileUrl(p.designs?.[p.designs.length - 1]?.image_path || p.original_path);
              return (
                <Pressable key={p.id} testID={`save-to-${p.id}`} style={styles.row} onPress={() => addTo(p.id)} disabled={busy}>
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPh]}><Feather name="image" size={18} color={colors.muted} /></View>
                  )}
                  <Text style={styles.rowText} numberOfLines={1}>{p.title}</Text>
                  <Feather name="chevron-right" size={18} color={colors.muted} />
                </Pressable>
              );
            })}
            {projects.length === 0 && (
              <Text style={styles.empty}>No projects yet — create one above.</Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,54,46,0.5)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, marginBottom: spacing.xs },
  newRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  newIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  newText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  thumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  thumbPh: { alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, fontFamily: fonts.text, fontWeight: "600", color: colors.onSurface },
  empty: { fontFamily: fonts.text, color: colors.muted, paddingVertical: spacing.md },
});
