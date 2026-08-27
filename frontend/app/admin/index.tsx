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
type Report = { id: string; reporter_name: string; reported_name: string; reported_id: string; reason: string; context: string; created_at: string; status?: string; resolution?: string; reported_status?: string };

export default function AdminDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [claims, setClaims] = useState<any[]>([]);
  const [releases, setReleases] = useState<any[]>([]);
  const [feePercent, setFeePercent] = useState<string>("10");
  const [connectEnabled, setConnectEnabled] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState<string | null>(null);
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
      const cl = await apiFetch<{ claims: any[] }>("/admin/claims");
      setClaims(cl.claims);
      const rel = await apiFetch<{ releases: any[]; fee_percent: number; connect_enabled: boolean }>("/admin/releases");
      setReleases(rel.releases);
      setFeePercent(String(rel.fee_percent));
      setConnectEnabled(rel.connect_enabled);
    } catch (e: any) {
      toast.show(e.message || "Failed to load", "error");
    }
  }, []);

  useEffect(() => { if (user?.role === "admin") load(); }, [load, user]);

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

  const reportAction = async (id: string, action: string) => {
    try {
      await apiFetch(`/admin/reports/${id}/action`, { method: "POST", body: { action } });
      const label = action === "warn" ? "Member warned ⚠️" : action === "suspend" ? "Member suspended 🚫" : "Report cleared ✅";
      toast.show(label, "success");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const actOnClaim = async (contractorId: string, action: string) => {
    try {
      await apiFetch(`/admin/claims/${contractorId}/action`, { method: "POST", body: { action } });
      toast.show(action === "approve" ? "Claim approved ✅" : "Claim rejected", "success");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const saveFee = async () => {
    try {
      const r = await apiFetch<{ platform_fee_percent: number }>("/admin/settings", { method: "POST", body: { platform_fee_percent: parseFloat(feePercent) || 0 } });
      setFeePercent(String(r.platform_fee_percent));
      toast.show(`Commission set to ${r.platform_fee_percent}%`, "success");
    } catch (e: any) { toast.show(e.message, "error"); }
  };

  const releaseFunds = async (contractId: string) => {
    setReleaseBusy(contractId);
    try {
      const r = await apiFetch<{ net_to_contractor: number }>(`/admin/contracts/${contractId}/release`, { method: "POST", body: {} });
      toast.show(`Released £${r.net_to_contractor} to the contractor ✅`, "success");
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setReleaseBusy(null); }
  };

  const [cleanupConfirm, setCleanupConfirm] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const cleanupDemo = async () => {
    if (!cleanupConfirm) { setCleanupConfirm(true); return; }
    setCleanupBusy(true);
    try {
      const r = await apiFetch<{ removed: any }>("/admin/cleanup-demo", { method: "POST", body: { confirm: true } });
      const rm = r.removed || {};
      toast.show(`Cleaned: ${rm.users || 0} test users, ${rm.wall_posts || 0} posts, ${rm.contracts || 0} agreements removed ✅`, "success");
      setCleanupConfirm(false);
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setCleanupBusy(false); }
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

        <Pressable testID="open-admin-sandbox" style={styles.mapLink} onPress={() => router.push("/admin/sandbox")}>
          <View style={styles.mapLinkIcon}><Feather name="zap" size={18} color={colors.brand} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mapLinkTitle}>AI Redesign Sandbox 🧪</Text>
            <Text style={styles.mapLinkSub}>Test AI output & prompts — nothing is saved</Text>
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

        {/* Contractor claims */}
        <Text style={styles.sectionTitle}>Contractor claims 🔧</Text>
        {claims.length === 0 ? (
          <Text style={styles.empty}>No pending claims</Text>
        ) : (
          claims.map((c) => (
            <View key={c.id} style={styles.reportCard} testID={`claim-${c.id}`}>
              <View style={styles.reportTop}>
                <Text style={styles.reportName}>{c.name}</Text>
              </View>
              <Text style={styles.reportMeta}>Requested by {c.claim_user_name || "a contractor"} · {c.location}</Text>
              <View style={styles.actionRow}>
                <Pressable testID={`approve-claim-${c.id}`} style={[styles.actionBtn, styles.clearBtn]} onPress={() => actOnClaim(c.id, "approve")}>
                  <Feather name="check" size={13} color={colors.brand} />
                  <Text style={styles.clearText}>Approve</Text>
                </Pressable>
                <Pressable testID={`reject-claim-${c.id}`} style={[styles.actionBtn, styles.suspendBtn]} onPress={() => actOnClaim(c.id, "reject")}>
                  <Feather name="x" size={13} color="#fff" />
                  <Text style={styles.suspendText}>Reject</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}

        {/* Deposit releases */}
        <Text style={styles.sectionTitle}>Deposit releases 💷</Text>
        <View style={styles.feeRow}>
          <Text style={styles.feeLabel}>Platform commission</Text>
          <TextInput
            testID="fee-input"
            style={styles.feeInput}
            value={feePercent}
            onChangeText={setFeePercent}
            keyboardType="numeric"
          />
          <Text style={styles.feePct}>%</Text>
          <Pressable testID="save-fee" style={styles.feeSave} onPress={saveFee}>
            <Text style={styles.feeSaveText}>Save</Text>
          </Pressable>
        </View>
        {!connectEnabled && (
          <Text style={styles.connectNote}>⚠️ Add a real Stripe test key (STRIPE_CONNECT_SECRET_KEY) to enable contractor onboarding & payouts.</Text>
        )}
        {releases.length === 0 ? (
          <Text style={styles.empty}>No deposits awaiting release</Text>
        ) : (
          releases.map((r) => (
            <View key={r.contract_id} style={styles.reportCard} testID={`release-${r.contract_id}`}>
              <View style={styles.reportTop}>
                <Text style={styles.reportName}>{r.project_title || "Garden project"}</Text>
                <Text style={styles.releaseAmt}>£{r.deposit_amount}</Text>
              </View>
              <Text style={styles.reportMeta}>{r.customer_name} → {r.contractor_name} · job {r.job_status}</Text>
              <Text style={styles.reportMeta}>Net to contractor £{r.net_to_contractor} (fee £{r.platform_fee})</Text>
              {!r.payouts_enabled && <Text style={styles.connectNote}>Contractor payouts not set up yet.</Text>}
              <Pressable
                testID={`release-btn-${r.contract_id}`}
                style={[styles.actionBtn, styles.clearBtn, { alignSelf: "flex-start", opacity: (!r.payouts_enabled || releaseBusy === r.contract_id) ? 0.5 : 1 }]}
                disabled={!r.payouts_enabled || releaseBusy === r.contract_id}
                onPress={() => releaseFunds(r.contract_id)}
              >
                {releaseBusy === r.contract_id ? <ActivityIndicator size="small" color={colors.brand} /> : (<><Feather name="send" size={13} color={colors.brand} /><Text style={styles.clearText}>Release funds</Text></>)}
              </Pressable>
            </View>
          ))
        )}

        {/* Go live — remove demo/test data */}
        <Text style={styles.sectionTitle}>Launch tools 🚀</Text>
        <View style={styles.reportCard}>
          <Text style={styles.reportName}>Clean demo &amp; test data</Text>
          <Text style={styles.reportMeta}>Removes all seeded test accounts (@example.com) and their posts, chats, projects &amp; agreements. Real customers and this admin account are never touched.</Text>
          <Pressable testID="cleanup-demo" style={[styles.actionBtn, styles.suspendBtn, { alignSelf: "flex-start" }]} onPress={cleanupDemo} disabled={cleanupBusy}>
            {cleanupBusy ? <ActivityIndicator size="small" color="#fff" /> : (<><Feather name={cleanupConfirm ? "alert-triangle" : "trash-2"} size={13} color="#fff" /><Text style={styles.suspendText}>{cleanupConfirm ? "Tap again to confirm" : "Clean demo data"}</Text></>)}
          </Pressable>
        </View>

        {/* Reports */}
        <Text style={styles.sectionTitle}>Member reports 🚩</Text>
        {reports.length === 0 ? (
          <Text style={styles.empty}>No reports — all calm in the garden 🌿</Text>
        ) : (
          reports.map((r) => (
            <View key={r.id} style={styles.reportCard} testID={`report-${r.id}`}>
              <View style={styles.reportTop}>
                <Text style={styles.reportName}>{r.reported_name}</Text>
                <View style={[styles.statusBadge, r.reported_status === "suspended" ? styles.stSuspended : r.reported_status === "warned" ? styles.stWarned : styles.stActive]}>
                  <Text style={styles.statusText}>{(r.reported_status || "active").toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.reportReason}>{r.reason}</Text>
              <Text style={styles.reportMeta}>Reported by {r.reporter_name} · {r.context} · {r.created_at?.slice(0, 10)}</Text>
              {r.status === "resolved" ? (
                <Text style={styles.resolvedText}>✓ Resolved — {r.resolution}</Text>
              ) : (
                <View style={styles.actionRow}>
                  <Pressable testID={`warn-${r.id}`} style={[styles.actionBtn, styles.warnBtn]} onPress={() => reportAction(r.id, "warn")}>
                    <Feather name="alert-triangle" size={13} color={colors.onBrandTertiary} />
                    <Text style={styles.warnText}>Warn</Text>
                  </Pressable>
                  <Pressable testID={`suspend-${r.id}`} style={[styles.actionBtn, styles.suspendBtn]} onPress={() => reportAction(r.id, "suspend")}>
                    <Feather name="slash" size={13} color="#fff" />
                    <Text style={styles.suspendText}>Suspend</Text>
                  </Pressable>
                  <Pressable testID={`clear-${r.id}`} style={[styles.actionBtn, styles.clearBtn]} onPress={() => reportAction(r.id, "clear")}>
                    <Feather name="check" size={13} color={colors.brand} />
                    <Text style={styles.clearText}>Clear</Text>
                  </Pressable>
                </View>
              )}
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
  feeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  feeLabel: { flex: 1, fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  feeInput: { width: 60, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, paddingVertical: 6, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, textAlign: "center" },
  feePct: { fontFamily: fonts.text, fontWeight: "700", color: colors.muted },
  feeSave: { backgroundColor: colors.brand, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.sm },
  feeSaveText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 13 },
  connectNote: { fontFamily: fonts.text, color: colors.error, fontSize: 12, lineHeight: 17 },
  releaseAmt: { fontFamily: fonts.display, color: colors.brand, fontSize: 16 },
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
  statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: radius.pill },
  stActive: { backgroundColor: "#EFF4EE" },
  stWarned: { backgroundColor: "#FBF3E2" },
  stSuspended: { backgroundColor: "#FBEAEA" },
  statusText: { fontFamily: fonts.text, fontWeight: "800", fontSize: 10, color: colors.onSurfaceTertiary },
  resolvedText: { fontFamily: fonts.text, color: colors.success, fontWeight: "700", fontSize: 13, marginTop: spacing.xs },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 38, borderRadius: radius.md },
  warnBtn: { backgroundColor: colors.brandTertiary },
  warnText: { fontFamily: fonts.text, fontWeight: "700", color: colors.onBrandTertiary, fontSize: 13 },
  suspendBtn: { backgroundColor: colors.error },
  suspendText: { fontFamily: fonts.text, fontWeight: "700", color: "#fff", fontSize: 13 },
  clearBtn: { borderWidth: 1.5, borderColor: colors.brand },
  clearText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 13 },
  inputLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, marginTop: spacing.md, marginBottom: spacing.xs },
  pollInput: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, marginBottom: spacing.sm },
  submitBtn: { backgroundColor: colors.brand, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  submitText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 16 },
});
