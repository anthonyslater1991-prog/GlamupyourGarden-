import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput, ActivityIndicator, Platform, Linking,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter, useFocusEffect } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Contractor = { id: string; name: string; tagline?: string; services?: string[]; phone?: string; location?: string; coverage_miles?: number; image?: string; rating?: number; review_count?: number };
type Review = { id: string; author_name: string; rating: number; text: string; reply?: string };

export default function ContractorHub() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, loading } = useAuth();

  const [mine, setMine] = useState<Contractor | null>(null);
  const [pending, setPending] = useState<Contractor | null>(null);
  const [directory, setDirectory] = useState<Contractor[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [replyFor, setReplyFor] = useState<Review | null>(null);
  const [replyText, setReplyText] = useState("");
  const [connect, setConnect] = useState<{ payouts_enabled: boolean; onboarded: boolean; connected: boolean } | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ contractor: Contractor | null; pending: Contractor | null }>("/my-contractor");
      setMine(r.contractor);
      setPending(r.pending);
      if (r.contractor) {
        const d = await apiFetch<{ contractor: Contractor; reviews: Review[] }>(`/contractors/${r.contractor.id}`);
        setReviews(d.reviews);
        try {
          const cs = await apiFetch<{ payouts_enabled: boolean; onboarded: boolean; connected: boolean }>("/connect/status");
          setConnect(cs);
        } catch {}
      } else if (!r.pending) {
        const dir = await apiFetch<{ contractors: Contractor[] }>("/contractors");
        setDirectory(dir.contractors.filter((c: any) => c.claim_status !== "approved"));
      }
    } catch (e: any) {
      toast.show(e.message, "error");
    }
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { if (!loading) load(); }, [load, loading]));
  useEffect(() => {
    if (loading) return;
    if (user && user.role !== "contractor") router.replace("/(tabs)/profile");
  }, [user, loading]);

  const claim = async (id: string) => {
    setBusy(true);
    try {
      await apiFetch(`/contractors/${id}/claim`, { method: "POST" });
      toast.show("Claim sent — an admin will review it shortly ⏳", "success");
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setBusy(false); }
  };

  const openEdit = () => {
    if (!mine) return;
    setForm({
      tagline: mine.tagline || "", phone: mine.phone || "", location: mine.location || "",
      services: (mine.services || []).join(", "), coverage_miles: String(mine.coverage_miles ?? 25),
    });
    setEditOpen(true);
  };

  const saveProfile = async () => {
    if (!mine) return;
    setBusy(true);
    try {
      const body: any = {
        tagline: form.tagline, phone: form.phone, location: form.location,
        services: form.services.split(",").map((s: string) => s.trim()).filter(Boolean),
        coverage_miles: parseInt(form.coverage_miles, 10) || 25,
      };
      const r = await apiFetch<{ contractor: Contractor }>(`/contractors/${mine.id}/profile`, { method: "PUT", body });
      setMine(r.contractor);
      setEditOpen(false);
      toast.show("Profile updated 🌿", "success");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setBusy(false); }
  };

  const startOnboard = async () => {
    setConnectBusy(true);
    try {
      const origin = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "https://outdoor-uplift.preview.emergentagent.com";
      const r = await apiFetch<{ url: string }>("/connect/onboard", { method: "POST", body: { origin } });
      if (Platform.OS === "web" && typeof window !== "undefined") window.location.href = r.url;
      else await Linking.openURL(r.url);
    } catch (e: any) {
      toast.show(e.message, "error");
      setConnectBusy(false);
    }
  };

  const sendReply = async () => {
    if (!mine || !replyFor || !replyText.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/contractors/${mine.id}/reviews/${replyFor.id}/reply`, { method: "POST", body: { text: replyText.trim() } });
      setReplyFor(null); setReplyText("");
      toast.show("Reply posted 💬", "success");
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="hub-back" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>Contractor Hub 🔧</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40, gap: spacing.md }}>
        {!loaded ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
        ) : pending ? (
          <View style={styles.card}>
            <Feather name="clock" size={26} color={colors.brandTertiary} />
            <Text style={styles.cardTitle}>Claim pending ⏳</Text>
            <Text style={styles.cardBody}>You&apos;ve requested to claim <Text style={styles.b}>{pending.name}</Text>. An admin will approve it soon — check back shortly.</Text>
          </View>
        ) : !mine ? (
          <>
            <View style={styles.card}>
              <Feather name="award" size={26} color={colors.brand} />
              <Text style={styles.cardTitle}>Claim your listing</Text>
              <Text style={styles.cardBody}>Pick your business from the directory to claim it. An admin approves the claim, then you can manage your profile, agreements and reviews.</Text>
            </View>
            {directory.map((c) => (
              <View key={c.id} style={styles.dirRow}>
                {c.image ? <Image source={{ uri: c.image }} style={styles.dirImg} contentFit="cover" /> : <View style={[styles.dirImg, styles.dirPlaceholder]}><Feather name="tool" size={18} color={colors.muted} /></View>}
                <View style={{ flex: 1 }}>
                  <Text style={styles.dirName} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.dirLoc} numberOfLines={1}>{c.location}</Text>
                </View>
                <Pressable testID={`claim-${c.id}`} style={styles.claimBtn} disabled={busy} onPress={() => claim(c.id)}>
                  <Text style={styles.claimBtnText}>Claim</Text>
                </Pressable>
              </View>
            ))}
          </>
        ) : (
          <>
            {/* My listing */}
            <View style={styles.card}>
              <View style={styles.listingTop}>
                {mine.image ? <Image source={{ uri: mine.image }} style={styles.listingImg} contentFit="cover" /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{mine.name}</Text>
                  <Text style={styles.cardBody}>{mine.tagline}</Text>
                  <Text style={styles.metaLine}>⭐ {mine.rating ?? 0} · {mine.review_count ?? 0} reviews · up to {mine.coverage_miles ?? 25} mi</Text>
                </View>
              </View>
              <View style={styles.chipsWrap}>
                {(mine.services || []).map((s) => <View key={s} style={styles.chip}><Text style={styles.chipText}>{s}</Text></View>)}
              </View>
              <Pressable testID="edit-profile" style={styles.primaryBtn} onPress={openEdit}>
                <Feather name="edit-2" size={15} color="#fff" />
                <Text style={styles.primaryText}>Edit my profile</Text>
              </Pressable>
            </View>

            <Pressable testID="hub-agreements" style={styles.linkCard} onPress={() => router.push("/contracts")}>
              <Feather name="file-text" size={18} color={colors.brand} />
              <Text style={styles.linkText}>My agreements & job tracker</Text>
              <Feather name="chevron-right" size={18} color={colors.muted} />
            </Pressable>

            {/* Payouts */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Payouts 💷</Text>
              {connect?.payouts_enabled ? (
                <View style={styles.payoutOk}>
                  <Feather name="check-circle" size={16} color={colors.success} />
                  <Text style={styles.cardBody}>Your payout account is connected. Released deposits will land in your bank.</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.cardBody}>Connect a Stripe payout account so the admin can release customer deposits to you once a job is done{connect?.onboarded ? " (finishing verification)" : ""}.</Text>
                  <Pressable testID="connect-payouts" style={styles.primaryBtn} onPress={startOnboard} disabled={connectBusy}>
                    {connectBusy ? <ActivityIndicator color="#fff" /> : (<><Feather name="link" size={15} color="#fff" /><Text style={styles.primaryText}>{connect?.connected ? "Finish payout setup" : "Set up payouts"}</Text></>)}
                  </Pressable>
                </>
              )}
            </View>

            {/* Reviews with reply */}
            <Text style={styles.sectionTitle}>Reviews</Text>
            {reviews.length === 0 ? (
              <Text style={styles.cardBody}>No reviews yet.</Text>
            ) : reviews.map((r) => (
              <View key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewTop}>
                  <Text style={styles.reviewAuthor}>{r.author_name}</Text>
                  <View style={{ flexDirection: "row" }}>
                    {[1, 2, 3, 4, 5].map((i) => <Feather key={i} name="star" size={12} color={colors.brandTertiary} style={{ opacity: i <= r.rating ? 1 : 0.3 }} />)}
                  </View>
                </View>
                <Text style={styles.reviewText}>{r.text}</Text>
                {r.reply ? (
                  <View style={styles.replyBox}>
                    <Text style={styles.replyLabel}>Your reply</Text>
                    <Text style={styles.replyText}>{r.reply}</Text>
                  </View>
                ) : (
                  <Pressable testID={`reply-${r.id}`} style={styles.replyBtn} onPress={() => { setReplyFor(r); setReplyText(""); }}>
                    <Feather name="corner-up-left" size={13} color={colors.brand} />
                    <Text style={styles.replyBtnText}>Reply</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Edit profile modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Edit profile</Text>
            {[
              { k: "tagline", label: "Tagline" },
              { k: "services", label: "Services (comma separated)" },
              { k: "phone", label: "Phone" },
              { k: "location", label: "Location" },
              { k: "coverage_miles", label: "Coverage (miles)", num: true },
            ].map((f) => (
              <View key={f.k} style={{ marginBottom: spacing.sm }}>
                <Text style={styles.fieldLabel}>{f.label}</Text>
                <TextInput
                  testID={`profile-${f.k}`}
                  style={styles.input}
                  value={String(form[f.k] ?? "")}
                  onChangeText={(t) => setForm((s: any) => ({ ...s, [f.k]: t }))}
                  keyboardType={f.num ? "number-pad" : "default"}
                  placeholderTextColor={colors.muted}
                />
              </View>
            ))}
            <Pressable testID="save-profile" style={styles.primaryBtn} onPress={saveProfile} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Reply modal */}
      <Modal visible={!!replyFor} transparent animationType="slide" onRequestClose={() => setReplyFor(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setReplyFor(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Reply to {replyFor?.author_name}</Text>
            <TextInput
              testID="reply-input"
              style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]}
              value={replyText}
              onChangeText={setReplyText}
              multiline
              placeholder="Thanks for your review…"
              placeholderTextColor={colors.muted}
            />
            <Pressable testID="send-reply" style={styles.primaryBtn} onPress={sendReply} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Post reply</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surfaceSecondary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, textAlign: "center", fontFamily: fonts.display, fontSize: 18, color: colors.onSurface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.onSurface },
  cardBody: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  b: { fontWeight: "800", color: colors.onSurface },
  metaLine: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: 2 },
  payoutOk: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#F0F6F1", padding: spacing.md, borderRadius: radius.md },
  listingTop: { flexDirection: "row", gap: spacing.md },
  listingImg: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { backgroundColor: "#EFF4EE", paddingVertical: 5, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  chipText: { fontFamily: fonts.text, fontWeight: "600", color: colors.brand, fontSize: 12 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, height: 50, borderRadius: radius.md, marginTop: spacing.xs },
  primaryText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 15 },
  linkCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  linkText: { flex: 1, fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 15 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.onSurface, marginTop: spacing.sm },
  dirRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  dirImg: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  dirPlaceholder: { alignItems: "center", justifyContent: "center" },
  dirName: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  dirLoc: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  claimBtn: { borderWidth: 1.5, borderColor: colors.brand, paddingVertical: 7, paddingHorizontal: spacing.lg, borderRadius: radius.pill },
  claimBtnText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 13 },
  reviewCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  reviewTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reviewAuthor: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  reviewText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, lineHeight: 20 },
  replyBox: { backgroundColor: "#EFF4EE", borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.xs },
  replyLabel: { fontFamily: fonts.text, fontWeight: "800", color: colors.brand, fontSize: 11, textTransform: "uppercase" },
  replyText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14, marginTop: 2 },
  replyBtn: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: spacing.xs },
  replyBtnText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 13 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,54,46,0.5)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center" },
  sheetTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  fieldLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurfaceSecondary, fontSize: 13, marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
});
