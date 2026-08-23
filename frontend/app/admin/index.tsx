import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Modal, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { apiFetch, fileUrl } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Overview = {
  visitors: { total: number; active_5m: number; active_1h: number; active_24h: number };
  active_users: { last_5m: number; last_1h: number; last_24h: number };
  totals: { users: number; projects: number; designs: number; wall_posts: number; direct_messages: number; room_messages: number; active_projects_24h: number };
};
type AdminProject = { id: string; title: string; owner_name: string; owner_email: string; design_count: number; original_path?: string; latest_image?: string; updated_at: string };
type Poll = { id: string; question: string; options: string[]; votes: number[]; active: boolean };

export default function AdminDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<AdminProject | null>(null);

  useEffect(() => {
    if (user && user.role !== "admin") router.replace("/(tabs)");
  }, [user]);

  const load = useCallback(async () => {
    try {
      const o = await apiFetch<Overview>("/admin/overview");
      setOverview(o);
      const p = await apiFetch<{ projects: AdminProject[] }>("/admin/projects");
      setProjects(p.projects);
      const pl = await apiFetch<{ polls: Poll[] }>("/admin/polls");
      setPolls(pl.polls);
    } catch (e: any) {
      toast.show(e.message || "Failed to load", "error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activatePoll = async (id: string) => {
    try {
      await apiFetch(`/admin/polls/${id}/activate`, { method: "POST" });
      toast.show("Poll activated for this week 🗳️", "success");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  if (!overview) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>;
  }

  const t = overview.totals;

  return (
    <View style={styles.root}>
      <LinearGradient colors={[colors.surfaceInverse, colors.brand]} style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-admin" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Admin Dashboard 🛡️</Text>
          <Text style={styles.headerSub}>Glam up your Garden control centre</Text>
        </View>
      </LinearGradient>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60, gap: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brand} />}
      >
        {/* Live activity */}
        <Text style={styles.sectionTitle}>Live activity 🔴</Text>
        <View style={styles.statGrid}>
          <StatCard label="On app now (5 min)" value={overview.visitors.active_5m} accent={colors.success} testID="stat-now" />
          <StatCard label="Active users (5 min)" value={overview.active_users.last_5m} accent={colors.brand} testID="stat-users-5m" />
          <StatCard label="Visits last hour" value={overview.visitors.active_1h} accent={colors.brandSecondary} testID="stat-1h" />
          <StatCard label="Visits last 24h" value={overview.visitors.active_24h} accent={colors.brandTertiary} testID="stat-24h" />
        </View>

        <Text style={styles.sectionTitle}>Community totals 🌍</Text>
        <View style={styles.statGrid}>
          <StatCard label="Members" value={t.users} accent={colors.brand} testID="stat-members" />
          <StatCard label="Projects" value={t.projects} accent={colors.brandSecondary} testID="stat-projects" />
          <StatCard label="AI redesigns" value={t.designs} accent={colors.brandTertiary} testID="stat-designs" />
          <StatCard label="Active projects 24h" value={t.active_projects_24h} accent={colors.success} testID="stat-active-projects" />
          <StatCard label="Wall posts" value={t.wall_posts} accent={colors.brand} testID="stat-posts" />
          <StatCard label="Messages sent" value={t.direct_messages + t.room_messages} accent={colors.info} testID="stat-messages" />
        </View>

        {/* Projects */}
        <Text style={styles.sectionTitle}>All projects 🪴</Text>
        {projects.map((p) => (
          <Pressable key={p.id} testID={`admin-project-${p.id}`} style={styles.projRow} onPress={() => setSelected(p)}>
            {p.latest_image || p.original_path ? (
              <Image source={{ uri: fileUrl(p.latest_image || p.original_path) }} style={styles.projThumb} contentFit="cover" />
            ) : (
              <View style={[styles.projThumb, styles.thumbPlaceholder]}><Feather name="image" size={20} color={colors.muted} /></View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.projTitle}>{p.title}</Text>
              <Text style={styles.projOwner}>{p.owner_name} · {p.owner_email}</Text>
              <Text style={styles.projMeta}>{p.design_count} redesign{p.design_count === 1 ? "" : "s"}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.muted} />
          </Pressable>
        ))}
        {projects.length === 0 && <Text style={styles.empty}>No projects yet.</Text>}

        {/* Poll rotation */}
        <Text style={styles.sectionTitle}>Weekly poll rotation 🗳️</Text>
        {polls.map((poll) => (
          <View key={poll.id} style={[styles.pollCard, poll.active && styles.pollActive]} testID={`admin-poll-${poll.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pollQ}>{poll.question}</Text>
              <Text style={styles.pollVotes}>{poll.votes.reduce((a, b) => a + b, 0)} votes</Text>
            </View>
            {poll.active ? (
              <View style={styles.activeBadge}><Feather name="check" size={12} color="#fff" /><Text style={styles.activeText}>Active</Text></View>
            ) : (
              <Pressable testID={`activate-poll-${poll.id}`} style={styles.activateBtn} onPress={() => activatePoll(poll.id)}>
                <Text style={styles.activateText}>Set live</Text>
              </Pressable>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Project detail modal */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setSelected(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{selected?.title}</Text>
            <Text style={styles.projOwner}>{selected?.owner_name} · {selected?.owner_email}</Text>
            {(selected?.latest_image || selected?.original_path) && (
              <Image source={{ uri: fileUrl(selected?.latest_image || selected?.original_path) }} style={styles.detailImg} contentFit="cover" />
            )}
            <View style={styles.detailRow}>
              <Feather name="layers" size={16} color={colors.brand} />
              <Text style={styles.detailText}>{selected?.design_count} AI redesign{selected?.design_count === 1 ? "" : "s"} generated</Text>
            </View>
            <View style={styles.detailRow}>
              <Feather name="clock" size={16} color={colors.brand} />
              <Text style={styles.detailText}>Updated {selected?.updated_at?.slice(0, 10)}</Text>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StatCard({ label, value, accent, testID }: { label: string; value: number; accent: string; testID: string }) {
  return (
    <View style={styles.statCard} testID={testID}>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.display, fontSize: 22, color: "#fff" },
  headerSub: { fontFamily: fonts.text, color: "rgba(255,255,255,0.85)", fontSize: 12 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  statCard: { width: "47%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: 2 },
  statValue: { fontFamily: fonts.display, fontSize: 28 },
  statLabel: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  projRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  projThumb: { width: 54, height: 54, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  projTitle: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  projOwner: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  projMeta: { fontFamily: fonts.text, color: colors.brand, fontSize: 12, fontWeight: "600" },
  empty: { fontFamily: fonts.text, color: colors.muted },
  pollCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  pollActive: { borderColor: colors.brand, backgroundColor: "#EFF4EE" },
  pollQ: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  pollVotes: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: 2 },
  activeBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.brand, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  activeText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 12 },
  activateBtn: { borderWidth: 1.5, borderColor: colors.brand, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  activateText: { color: colors.brand, fontFamily: fonts.text, fontWeight: "700", fontSize: 12 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,54,46,0.5)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.xs },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  detailImg: { width: "100%", height: 200, borderRadius: radius.md, marginTop: spacing.sm },
  detailRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  detailText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary },
});
