import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  RefreshControl,
  Linking,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { apiFetch, fileUrl } from "@/src/lib/api";
import ChatFab from "@/src/components/ChatFab";
import { colors, spacing, radius, fonts } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const HERO =
  "https://images.pexels.com/photos/38080084/pexels-photo-38080084.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

const SOCIALS = [
  { icon: "logo-facebook", url: "https://facebook.com", key: "fb" },
  { icon: "logo-instagram", url: "https://instagram.com", key: "ig" },
  { icon: "logo-tiktok", url: "https://tiktok.com", key: "tt" },
  { icon: "logo-youtube", url: "https://youtube.com", key: "yt" },
];

type Poll = { id: string; question: string; options: string[]; votes: number[] };
type Project = { id: string; title: string; original_path?: string; designs: any[] };

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  const [visits, setVisits] = useState<number | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [pollOpen, setPollOpen] = useState(false);
  const [voted, setVoted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nearby, setNearby] = useState<any[]>([]);
  const [nearbyDismissed, setNearbyDismissed] = useState(false);
  const [reviewPrompts, setReviewPrompts] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const v = await apiFetch<{ total_visits: number }>("/visit", { method: "POST" });
      setVisits(v.total_visits);
      const s = await apiFetch("/stats");
      setStats(s);
      const p = await apiFetch<{ projects: Project[] }>("/projects");
      setProjects(p.projects);
      const pl = await apiFetch<{ poll: Poll | null }>("/polls/active");
      setPoll(pl.poll);
      if (pl.poll) {
        const seenId = await storage.getItem<string>("glam_poll_seen", "");
        if (seenId !== pl.poll.id) {
          setPollOpen(true);
        }
      }
      try {
        const na = await apiFetch<{ alerts: any[] }>("/alerts/nearby");
        setNearby(na.alerts);
      } catch {}
      try {
        const rem = await apiFetch<{ review_prompts: any[] }>("/reminders");
        setReviewPrompts(rem.review_prompts);
      } catch {}
    } catch (e: any) {
      console.log("home load", e.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const vote = async (idx: number) => {
    if (!poll || voted) return;
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const res = await apiFetch<{ poll: Poll }>(`/polls/${poll.id}/vote`, {
        method: "POST",
        body: { option_index: idx },
      });
      setPoll(res.poll);
      setVoted(true);
      await storage.setItem("glam_poll_seen", poll.id);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const dismissPoll = async () => {
    if (poll) await storage.setItem("glam_poll_seen", poll.id);
    setPollOpen(false);
  };

  const totalVotes = poll ? poll.votes.reduce((a, b) => a + b, 0) : 0;
  const firstName = (user?.name || "Gardener").split(" ")[0];

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.brandRow}>
            <Text style={styles.leaf}>🌿</Text>
            <Text style={styles.brandName}>Glam up your Garden</Text>
          </View>
          <View style={styles.socialRow}>
            {SOCIALS.map((s) => (
              <Pressable
                key={s.key}
                testID={`social-${s.key}`}
                style={styles.socialBtn}
                onPress={() => Linking.openURL(s.url)}
              >
                <Ionicons name={s.icon as any} size={17} color={colors.brand} />
              </Pressable>
            ))}
          </View>
        </View>

        {/* Visit counter */}
        <View style={styles.visitRow}>
          <View style={styles.visitPill}>
            <Feather name="eye" size={13} color={colors.brandSecondary} />
            <Text style={styles.visitText}>
              {visits != null ? visits.toLocaleString() : "—"} garden visits
            </Text>
          </View>
          {stats && (
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{stats.active_5m} active now</Text>
            </View>
          )}
        </View>

        {/* Review reminder — job complete */}
        {reviewPrompts.length > 0 && (
          <Pressable
            testID="review-reminder"
            style={[styles.alertCard, { borderColor: colors.brandTertiary }]}
            onPress={() => router.push(`/contractor/${reviewPrompts[0].contractor_id}?review=1&contract_id=${reviewPrompts[0].contract_id}`)}
          >
            <View style={[styles.alertIcon, { backgroundColor: colors.brandTertiary }]}>
              <Feather name="star" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Your job is complete! 🌟</Text>
              <Text style={styles.alertSub}>
                Leave a photo review for {reviewPrompts[0].contractor_name}
                {reviewPrompts.length > 1 ? ` (+${reviewPrompts.length - 1} more)` : ""}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.muted} />
          </Pressable>
        )}

        {/* Nearby top-rated pro alert */}
        {nearby.length > 0 && !nearbyDismissed && (
          <Pressable
            testID="nearby-alert"
            style={styles.alertCard}
            onPress={() => router.push(`/contractor/${nearby[0].id}`)}
          >
            <View style={styles.alertIcon}>
              <Feather name="bell" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>Top-rated pro in your area! ⭐</Text>
              <Text style={styles.alertSub}>
                {nearby[0].name} · {nearby[0].distance_km} km away · {nearby[0].rating}★
              </Text>
            </View>
            <Pressable testID="dismiss-nearby" hitSlop={10} onPress={() => setNearbyDismissed(true)}>
              <Feather name="x" size={18} color={colors.muted} />
            </Pressable>
          </Pressable>
        )}

        {/* Hero */}
        <Pressable style={styles.hero} testID="start-project-hero" onPress={() => router.push("/project/create")}>
          <Image source={{ uri: HERO }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient
            colors={["rgba(42,54,46,0.1)", "rgba(42,54,46,0.75)"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroContent}>
            <Text style={styles.heroHi}>Hi {firstName} ☀️</Text>
            <Text style={styles.heroTitle}>Ready to reimagine{"\n"}your garden?</Text>
            <View style={styles.heroBtn}>
              <Feather name="camera" size={18} color={colors.brand} />
              <Text style={styles.heroBtnText}>Start a Project</Text>
            </View>
          </View>
        </Pressable>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <QuickAction icon="image" label="Community" onPress={() => router.push("/(tabs)/community")} />
          <QuickAction icon="tool" label="Find a Pro" onPress={() => router.push("/(tabs)/contractors")} />
          <QuickAction icon="bar-chart-2" label="Weekly Poll" onPress={() => poll && setPollOpen(true)} />
        </View>

        {/* My projects */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Projects</Text>
          <Pressable testID="see-all-projects" onPress={() => router.push("/(tabs)/projects")}>
            <Text style={styles.seeAll}>See all</Text>
          </Pressable>
        </View>

        {projects.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyEmoji}>🌱</Text>
            <Text style={styles.emptyText}>No projects yet. Snap your garden to begin!</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
          >
            {projects.map((p) => {
              const last = p.designs?.[p.designs.length - 1];
              const img = fileUrl(last?.image_path || p.original_path);
              return (
                <Pressable
                  key={p.id}
                  testID={`project-card-${p.id}`}
                  style={styles.projCard}
                  onPress={() => router.push(`/project/${p.id}`)}
                >
                  {img ? (
                    <Image source={{ uri: img }} style={styles.projImg} contentFit="cover" />
                  ) : (
                    <View style={[styles.projImg, styles.projPlaceholder]}>
                      <Feather name="image" size={28} color={colors.muted} />
                    </View>
                  )}
                  <Text style={styles.projTitle} numberOfLines={1}>{p.title}</Text>
                  <Text style={styles.projMeta}>
                    {p.designs?.length || 0} redesign{p.designs?.length === 1 ? "" : "s"}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </ScrollView>

      <ChatFab bottom={insets.bottom + 80} />

      {/* Poll popup */}
      <Modal visible={pollOpen && !!poll} transparent animationType="fade" onRequestClose={dismissPoll}>
        <View style={styles.modalOverlay}>
          <View style={styles.pollCard} testID="poll-modal">
            <Pressable style={styles.pollClose} onPress={dismissPoll} testID="poll-close">
              <Feather name="x" size={20} color={colors.muted} />
            </Pressable>
            <Text style={styles.pollBadge}>🗳️ WEEKLY POLL</Text>
            <Text style={styles.pollQuestion}>{poll?.question}</Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {poll?.options.map((opt, i) => {
                const pct = totalVotes ? Math.round((poll.votes[i] / totalVotes) * 100) : 0;
                return (
                  <Pressable
                    key={i}
                    testID={`poll-option-${i}`}
                    style={styles.pollOption}
                    onPress={() => vote(i)}
                    disabled={voted}
                  >
                    {voted && <View style={[styles.pollFill, { width: `${pct}%` }]} />}
                    <Text style={styles.pollOptText}>{opt}</Text>
                    {voted && <Text style={styles.pollPct}>{pct}%</Text>}
                  </Pressable>
                );
              })}
            </View>
            {voted && <Text style={styles.pollThanks}>Thanks for voting! 🌸 {totalVotes} votes</Text>}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function QuickAction({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quickCard} onPress={onPress} testID={`quick-${label}`}>
      <View style={styles.quickIcon}>
        <Feather name={icon} size={20} color={colors.brand} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flex: 1 },
  leaf: { fontSize: 20 },
  brandName: { fontFamily: fonts.display, fontSize: 18, color: colors.onSurface, flexShrink: 1 },
  socialRow: { flexDirection: "row", gap: 6 },
  socialBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  visitRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  visitPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  visitText: { fontFamily: fonts.text, fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: "600" },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EFF4EE",
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  liveText: { fontFamily: fonts.text, fontSize: 12, color: colors.success, fontWeight: "700" },
  alertCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: "#EFF4EE", borderWidth: 1, borderColor: colors.brand, marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md },
  alertIcon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  alertTitle: { fontFamily: fonts.text, fontWeight: "800", color: colors.onSurface, fontSize: 14 },
  alertSub: { fontFamily: fonts.text, color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 1 },
  hero: {
    height: 220,
    margin: spacing.lg,
    borderRadius: radius.lg,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  heroContent: { padding: spacing.xl, gap: spacing.sm },
  heroHi: { fontFamily: fonts.text, color: "rgba(255,255,255,0.92)", fontSize: 15, fontWeight: "600" },
  heroTitle: { fontFamily: fonts.display, color: "#fff", fontSize: 26, lineHeight: 30 },
  heroBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#fff",
    alignSelf: "flex-start",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  heroBtnText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 15 },
  quickRow: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg },
  quickCard: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: "#EFF4EE",
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: { fontFamily: fonts.text, fontSize: 12, fontWeight: "600", color: colors.onSurface },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  seeAll: { fontFamily: fonts.text, color: colors.brand, fontWeight: "700", fontSize: 14 },
  emptyBox: { alignItems: "center", padding: spacing.xl, marginHorizontal: spacing.lg, gap: spacing.sm },
  emptyEmoji: { fontSize: 34 },
  emptyText: { fontFamily: fonts.text, color: colors.muted, textAlign: "center" },
  projCard: { width: 160 },
  projImg: { width: 160, height: 120, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  projPlaceholder: { alignItems: "center", justifyContent: "center" },
  projTitle: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, marginTop: spacing.sm },
  projMeta: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(42,54,46,0.55)",
    justifyContent: "center",
    padding: spacing.xl,
  },
  pollCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl },
  pollClose: { position: "absolute", top: spacing.md, right: spacing.md, zIndex: 2, padding: 4 },
  pollBadge: { fontFamily: fonts.text, fontWeight: "800", color: colors.brandTertiary, fontSize: 12, letterSpacing: 1 },
  pollQuestion: { fontFamily: fonts.display, fontSize: 21, color: colors.onSurface, marginTop: spacing.sm, lineHeight: 26 },
  pollOption: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
  },
  pollFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "#DDE9DC" },
  pollOptText: { fontFamily: fonts.text, fontWeight: "600", color: colors.onSurface, flex: 1 },
  pollPct: { fontFamily: fonts.text, fontWeight: "800", color: colors.brand },
  pollThanks: { fontFamily: fonts.text, color: colors.success, textAlign: "center", marginTop: spacing.md, fontWeight: "600" },
});
