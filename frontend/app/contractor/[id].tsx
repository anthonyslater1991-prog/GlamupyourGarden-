import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  Linking,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { apiFetch } from "@/src/lib/api";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Contractor = { id: string; name: string; tagline: string; services: string[]; phone: string; rating: number; review_count: number; location: string; image: string };
type Review = { id: string; author_name: string; rating: number; text: string };

const CONTRACT_TERMS = [
  { label: "Scope of work", value: "Full garden landscaping as discussed in project" },
  { label: "Estimated price", value: "£2,400 (materials + labour)" },
  { label: "Timeline", value: "3–4 weeks from start date" },
  { label: "Payment terms", value: "30% deposit, balance on completion" },
];

const JOB_STAGES = ["Quote agreed", "Materials ordered", "Groundwork", "Planting & build", "Complete"];

export default function ContractorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  const [data, setData] = useState<Contractor | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ contractor: Contractor; reviews: Review[] }>(`/contractors/${id}`);
      setData(r.contractor);
      setReviews(r.reviews);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const submitReview = async () => {
    if (!text.trim()) {
      toast.show("Write a few words about the work", "error");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/contractors/${id}/reviews`, { method: "POST", body: { rating, text: text.trim() } });
      setText("");
      setRating(5);
      setReviewOpen(false);
      toast.show("Review posted — thank you! 🌟", "success");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.hero}>
          <Image source={{ uri: data.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={["rgba(42,54,46,0.15)", "rgba(42,54,46,0.85)"]} style={StyleSheet.absoluteFill} />
          <Pressable testID="back-contractor" style={[styles.back, { top: insets.top + spacing.sm }]} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color="#fff" />
          </Pressable>
          <View style={styles.heroContent}>
            <Text style={styles.name}>{data.name}</Text>
            <Text style={styles.tagline}>{data.tagline}</Text>
            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Feather key={i} name="star" size={15} color={colors.brandTertiary} style={{ opacity: i <= Math.round(data.rating) ? 1 : 0.35 }} />
              ))}
              <Text style={styles.ratingText}>{data.rating} · {data.review_count} reviews</Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* Contact */}
          <View style={styles.actionRow}>
            <Pressable testID="call-button" style={styles.callBtn} onPress={() => Linking.openURL(`tel:${data.phone.replace(/\s/g, "")}`)}>
              <Feather name="phone" size={18} color="#fff" />
              <Text style={styles.callText}>Call {data.phone}</Text>
            </Pressable>
          </View>

          {/* Services */}
          <Text style={styles.sectionTitle}>Services</Text>
          <View style={styles.chipsWrap}>
            {data.services.map((s) => (
              <View key={s} style={styles.serviceChip}>
                <Feather name="check" size={12} color={colors.brand} />
                <Text style={styles.serviceText}>{s}</Text>
              </View>
            ))}
          </View>

          {/* Job completion tracker */}
          <Text style={styles.sectionTitle}>Job progress 🌱</Text>
          <View style={styles.card}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: "60%" }]} />
            </View>
            <Text style={styles.progressLabel}>Stage 3 of 5 · Groundwork underway</Text>
            <View style={styles.stagesRow}>
              {JOB_STAGES.map((stage, i) => (
                <View key={stage} style={styles.stageItem}>
                  <View style={[styles.stageDot, i <= 2 && styles.stageDotDone]}>
                    {i <= 2 && <Feather name="check" size={10} color="#fff" />}
                  </View>
                  <Text style={styles.stageText} numberOfLines={2}>{stage}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Contract */}
          <Text style={styles.sectionTitle}>Contract</Text>
          <Pressable testID="view-contract" style={styles.contractCard} onPress={() => setContractOpen(true)}>
            <View style={styles.contractIcon}><Feather name="file-text" size={20} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contractTitle}>Auto-drafted agreement</Text>
              <Text style={styles.contractSub}>Review price, scope & sign digitally</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Pressable>

          {/* Reviews */}
          <View style={styles.reviewHead}>
            <Text style={styles.sectionTitle}>Reviews</Text>
            <Pressable testID="add-review-button" style={styles.addReview} onPress={() => setReviewOpen(true)}>
              <Feather name="edit-3" size={14} color={colors.brand} />
              <Text style={styles.addReviewText}>Write a review</Text>
            </Pressable>
          </View>

          {reviews.length === 0 ? (
            <Text style={styles.noReviews}>No reviews yet. Be the first to share your experience!</Text>
          ) : (
            reviews.map((r) => (
              <View key={r.id} style={styles.reviewCard} testID={`review-${r.id}`}>
                <View style={styles.reviewTop}>
                  <Text style={styles.reviewAuthor}>{r.author_name}</Text>
                  <View style={{ flexDirection: "row" }}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Feather key={i} name="star" size={12} color={colors.brandTertiary} style={{ opacity: i <= r.rating ? 1 : 0.3 }} />
                    ))}
                  </View>
                </View>
                <Text style={styles.reviewText}>{r.text}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Review modal */}
      <Modal visible={reviewOpen} transparent animationType="slide" onRequestClose={() => setReviewOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setReviewOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Rate {data.name}</Text>
            <View style={styles.starPick}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Pressable
                  key={i}
                  testID={`star-${i}`}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync();
                    setRating(i);
                  }}
                >
                  <Feather name="star" size={34} color={colors.brandTertiary} style={{ opacity: i <= rating ? 1 : 0.3 }} />
                </Pressable>
              ))}
            </View>
            <TextInput
              testID="review-input"
              style={styles.reviewInput}
              placeholder="How was the work? Share photos & details..."
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable testID="submit-review-button" style={styles.submitBtn} onPress={submitReview} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Post Review</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Contract modal */}
      <Modal visible={contractOpen} transparent animationType="slide" onRequestClose={() => setContractOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setContractOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Service Agreement 📜</Text>
            <Text style={styles.contractIntro}>Auto-drafted between you and {data.name}. Both parties review and sign.</Text>
            {CONTRACT_TERMS.map((t) => (
              <View key={t.label} style={styles.termRow}>
                <Text style={styles.termLabel}>{t.label}</Text>
                <Text style={styles.termValue}>{t.value}</Text>
              </View>
            ))}
            <Pressable testID="sign-contract-button" style={styles.submitBtn} onPress={() => { setContractOpen(false); toast.show("Signed! The contractor has been notified ✍️", "success"); }}>
              <Text style={styles.submitText}>Review & Sign</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  hero: { height: 260, justifyContent: "flex-end" },
  back: { position: "absolute", left: spacing.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center" },
  heroContent: { padding: spacing.xl, gap: spacing.xs },
  name: { fontFamily: fonts.display, fontSize: 28, color: "#fff" },
  tagline: { fontFamily: fonts.text, color: "rgba(255,255,255,0.9)", fontSize: 14 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: spacing.xs },
  ratingText: { fontFamily: fonts.text, color: "#fff", fontWeight: "700", fontSize: 13, marginLeft: spacing.sm },
  body: { padding: spacing.lg, gap: spacing.md },
  actionRow: { flexDirection: "row" },
  callBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, height: 52, borderRadius: radius.md },
  callText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 15 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, marginTop: spacing.sm },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  serviceChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EFF4EE", paddingVertical: 7, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  serviceText: { fontFamily: fonts.text, fontWeight: "600", color: colors.brand, fontSize: 13 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  progressBarBg: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progressBarFill: { height: 10, borderRadius: 5, backgroundColor: colors.brand },
  progressLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 13 },
  stagesRow: { flexDirection: "row", justifyContent: "space-between" },
  stageItem: { flex: 1, alignItems: "center", gap: 4 },
  stageDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  stageDotDone: { backgroundColor: colors.brand },
  stageText: { fontFamily: fonts.text, fontSize: 9, color: colors.muted, textAlign: "center" },
  contractCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  contractIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  contractTitle: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 15 },
  contractSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  reviewHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  addReview: { flexDirection: "row", alignItems: "center", gap: 5 },
  addReviewText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 13 },
  noReviews: { fontFamily: fonts.text, color: colors.muted },
  reviewCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  reviewTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reviewAuthor: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  reviewText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, lineHeight: 20 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,54,46,0.5)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center" },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  starPick: { flexDirection: "row", justifyContent: "center", gap: spacing.sm, marginVertical: spacing.sm },
  reviewInput: { minHeight: 90, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, textAlignVertical: "top" },
  submitBtn: { backgroundColor: colors.brand, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  submitText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 16 },
  contractIntro: { fontFamily: fonts.text, color: colors.muted, lineHeight: 20 },
  termRow: { gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, paddingBottom: spacing.sm },
  termLabel: { fontFamily: fonts.text, fontWeight: "800", color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  termValue: { fontFamily: fonts.text, color: colors.onSurface, fontSize: 15 },
});
