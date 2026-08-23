import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Modal, ActivityIndicator, TextInput } from "react-native";
import { Image } from "expo-image";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
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
type AdminProject = { id: string; title: string; owner_name: string; owner_email: string; owner_phone?: string; owner_postcode?: string; owner_address?: string; design_count: number; original_path?: string; latest_image?: string; updated_at: string };
type Poll = { id: string; question: string; options: string[]; votes: number[]; active: boolean };
type Report = { id: string; reporter_name: string; reported_name: string; reason: string; context: string; created_at: string };

export default function AdminDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<AdminProject | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newQ, setNewQ] = useState("");
  const [newOpts, setNewOpts] = useState(["", "", "", ""]);
  const [creating, setCreating] = useState(false);

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
      const rp = await apiFetch<{ reports: Report[] }>("/admin/reports");
      setReports(rp.reports);
    } catch (e: any) {
      toast.show(e.message || "Failed to load", "error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createPoll = async () => {
    const opts = newOpts.map((o) => o.trim()).filter(Boolean);
    if (!newQ.trim() || opts.length < 2) {
      toast.show("Add a question and at least 2 options", "error");
      return;
    }
    setCreating(true);
    try {
      await apiFetch("/admin/polls", { method: "POST", body: { question: newQ.trim(), options: opts, activate: true } });
      toast.show("Poll created & set live 🗳️", "success");
      setCreateOpen(false);
      setNewQ("");
      setNewOpts(["", "", "", ""]);
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setCreating(false);
    }
  };

  const deletePoll = async (id: string) => {
    try {
      await apiFetch(`/admin/polls/${id}`, { method: "DELETE" });
      toast.show("Poll deleted", "success");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

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

        <Pressable testID="open-admin-map" style={styles.mapLink} onPress={() => router.push("/admin/map")}>
          <View style={styles.mapLinkIcon}><Feather name="map" size={18} color={colors.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mapLinkTitle}>Location Map</Text>
            <Text style={styles.mapLinkSub}>See customers & contractors on a map</Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.muted} />
        </Pressable>

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
        <View style={styles.pollHeaderRow}>
          <Text style={styles.sectionTitle}>Weekly poll rotation 🗳️</Text>
          <Pressable testID="create-poll-button" style={styles.createBtn} onPress={() => setCreateOpen(true)}>
            <Feather name="plus" size={15} color="#fff" />
            <Text style={styles.createText}>New poll</Text>
          </Pressable>
        </View>
        {polls.map((poll) => (
          <View key={poll.id} style={[styles.pollCard, poll.active && styles.pollActive]} testID={`admin-poll-${poll.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.pollQ}>{poll.question}</Text>
              <Text style={styles.pollVotes}>{poll.votes.reduce((a, b) => a + b, 0)} votes · {poll.options.length} options</Text>
            </View>
            {poll.active ? (
              <View style={styles.activeBadge}><Feather name="check" size={12} color="#fff" /><Text style={styles.activeText}>Active</Text></View>
            ) : (
              <View style={{ flexDirection: "row", gap: spacing.xs, alignItems: "center" }}>
                <Pressable testID={`delete-poll-${poll.id}`} style={styles.delBtn} onPress={() => deletePoll(poll.id)}>
                  <Feather name="trash-2" size={16} color={colors.error} />
                </Pressable>
                <Pressable testID={`activate-poll-${poll.id}`} style={styles.activateBtn} onPress={() => activatePoll(poll.id)}>
                  <Text style={styles.activateText}>Set live</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}

        {/* Reports */}
        <Text style={styles.sectionTitle}>Member reports 🚩</Text>
        {reports.length === 0 ? (
          <Text style={styles.empty}>No reports — all calm in the garden 🌿</Text>
        ) : (
          reports.map((r) => (
            <View key={r.id} style={styles.reportCard} testID={`report-${r.id}`}>
              <View style={styles.reportTop}>
                <Text style={styles.reportName}>{r.reported_name}</Text>
                <Text style={styles.reportDate}>{r.created_at?.slice(0, 10)}</Text>
              </View>
              <Text style={styles.reportReason}>{r.reason}</Text>
              <Text style={styles.reportMeta}>Reported by {r.reporter_name} · {r.context}</Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Create poll modal */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setCreateOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <KeyboardAwareScrollView bottomOffset={20} showsVerticalScrollIndicator={false}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>Create a poll 🗳️</Text>
              <Text style={styles.inputLabel}>Question</Text>
              <TextInput
                testID="poll-question-input"
                style={styles.pollInput}
                placeholder="e.g. What's your dream garden feature?"
                placeholderTextColor={colors.muted}
                value={newQ}
                onChangeText={setNewQ}
                multiline
              />
              <Text style={styles.inputLabel}>Options (2-4)</Text>
              {newOpts.map((o, i) => (
                <TextInput
                  key={i}
                  testID={`poll-option-input-${i}`}
                  style={styles.pollInput}
                  placeholder={`Option ${i + 1}${i < 2 ? "" : " (optional)"}`}
                  placeholderTextColor={colors.muted}
                  value={o}
                  onChangeText={(v) => setNewOpts((prev) => prev.map((x, idx) => (idx === i ? v : x)))}
                />
              ))}
              <Pressable testID="submit-poll-button" style={styles.submitBtn} onPress={createPoll} disabled={creating}>
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create & set live</Text>}
              </Pressable>
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Modal>

      {/* Project detail modal */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setSelected(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{selected?.title}</Text>
            <Text style={styles.projOwner}>{selected?.owner_name} · {selected?.owner_email}</Text>
            {(selected?.owner_phone || selected?.owner_postcode) && (
              <View style={styles.contactBox}>
                {!!selected?.owner_phone && (
                  <View style={styles.detailRow}><Feather name="phone" size={15} color={colors.brand} /><Text style={styles.detailText}>{selected?.owner_phone}</Text></View>
                )}
                {!!selected?.owner_postcode && (
                  <View style={styles.detailRow}><Feather name="map-pin" size={15} color={colors.brand} /><Text style={styles.detailText}>{selected?.owner_postcode}{selected?.owner_address ? ` · ${selected?.owner_address}` : ""}</Text></View>
                )}
              </View>
            )}
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
  contactBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginTop: spacing.xs },
  mapLink: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  mapLinkIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  mapLinkTitle: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 15 },
  mapLinkSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  pollHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.brand, paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  createText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 13 },
  delBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FBEAEA", alignItems: "center", justifyContent: "center" },
  reportCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: 3 },
  reportTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reportName: { fontFamily: fonts.text, fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  reportDate: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  reportReason: { fontFamily: fonts.text, color: colors.error, fontWeight: "600" },
  reportMeta: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  inputLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md, marginBottom: spacing.xs },
  pollInput: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, marginBottom: spacing.sm },
  submitBtn: { backgroundColor: colors.brand, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  submitText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 16 },
});
