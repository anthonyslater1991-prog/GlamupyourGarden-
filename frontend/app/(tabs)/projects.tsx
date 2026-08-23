import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { apiFetch, fileUrl } from "@/src/lib/api";
import ChatFab from "@/src/components/ChatFab";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Project = { id: string; title: string; original_path?: string; designs: any[]; updated_at: string };

export default function Projects() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reminderCount, setReminderCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const p = await apiFetch<{ projects: Project[] }>("/projects");
      setProjects(p.projects);
    } catch {}
    try {
      const r = await apiFetch<{ count: number }>("/reminders");
      setReminderCount(r.count);
    } catch {}
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View>
          <Text style={styles.title}>My Projects 🪴</Text>
          <Text style={styles.subtitle}>Your garden makeovers</Text>
        </View>
        <Pressable testID="new-project-button" style={styles.newBtn} onPress={() => router.push("/project/create")}>
          <Feather name="plus" size={20} color="#fff" />
        </Pressable>
      </View>

      <Pressable testID="open-agreements" style={styles.agreementsRow} onPress={() => router.push("/contracts")}>
        <Feather name="file-text" size={16} color={colors.brand} />
        <Text style={styles.agreementsText}>My agreements</Text>
        {reminderCount > 0 && (
          <View style={styles.reviewBadge}><Text style={styles.reviewBadgeText}>{reminderCount} to review</Text></View>
        )}
        <Feather name="chevron-right" size={16} color={colors.muted} />
      </Pressable>

      <FlatList
        data={projects}
        keyExtractor={(i) => i.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: 140, paddingTop: spacing.sm }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🌱</Text>
              <Text style={styles.emptyTitle}>No projects yet</Text>
              <Text style={styles.emptyText}>Tap + to snap or upload a photo of your garden and watch the magic happen ✨</Text>
              <Pressable testID="empty-start-button" style={styles.emptyBtn} onPress={() => router.push("/project/create")}>
                <Text style={styles.emptyBtnText}>Start your first project</Text>
              </Pressable>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const last = item.designs?.[item.designs.length - 1];
          const img = fileUrl(last?.image_path || item.original_path);
          return (
            <Pressable
              testID={`project-${item.id}`}
              style={styles.card}
              onPress={() => router.push(`/project/${item.id}`)}
            >
              {img ? (
                <Image source={{ uri: img }} style={styles.cardImg} contentFit="cover" />
              ) : (
                <View style={[styles.cardImg, styles.placeholder]}>
                  <Feather name="image" size={28} color={colors.muted} />
                </View>
              )}
              {item.designs?.length > 0 && (
                <View style={styles.badge}>
                  <Feather name="check" size={11} color="#fff" />
                  <Text style={styles.badgeText}>{item.designs.length}</Text>
                </View>
              )}
              <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
            </Pressable>
          );
        }}
      />
      <ChatFab bottom={insets.bottom + 80} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.onSurface },
  subtitle: { fontFamily: fonts.text, color: colors.muted, fontSize: 14 },
  newBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  card: { flex: 1, gap: spacing.xs },
  cardImg: { width: "100%", height: 150, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  placeholder: { alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: colors.brand,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
  },
  badgeText: { color: "#fff", fontFamily: fonts.text, fontWeight: "800", fontSize: 11 },
  cardTitle: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  agreementsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  agreementsText: { flex: 1, fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  reviewBadge: { backgroundColor: colors.brandTertiary, paddingVertical: 3, paddingHorizontal: 8, borderRadius: radius.pill },
  reviewBadgeText: { fontFamily: fonts.text, fontWeight: "800", color: colors.onBrandTertiary, fontSize: 11 },
  empty: { alignItems: "center", padding: spacing.xl, marginTop: spacing["3xl"], gap: spacing.sm },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  emptyText: { fontFamily: fonts.text, color: colors.muted, textAlign: "center", lineHeight: 21 },
  emptyBtn: {
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  emptyBtnText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700" },
});
