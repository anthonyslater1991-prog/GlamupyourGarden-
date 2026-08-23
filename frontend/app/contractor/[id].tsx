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
import { apiFetch, fileUrl } from "@/src/lib/api";
import { uploadImage, pickFromLibrary } from "@/src/lib/upload";
import ImageViewer from "@/src/components/ImageViewer";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Contractor = { id: string; name: string; tagline: string; services: string[]; phone: string; rating: number; review_count: number; location: string; image: string; coverage_miles?: number };
type Review = { id: string; author_name: string; rating: number; text: string; image_paths?: string[] };
type Project = { id: string; title: string };

export default function ContractorDetail() {
  const { id, review: reviewParam, contract_id: contractIdParam } = useLocalSearchParams<{ id: string; review?: string; contract_id?: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();

  const [data, setData] = useState<Contractor | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [projectPickOpen, setProjectPickOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [creatingContract, setCreatingContract] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [coverageVal, setCoverageVal] = useState("25");
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [reviewPhotos, setReviewPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const canEditCoverage = user?.role === "admin" || user?.role === "contractor";

  const saveCoverage = async () => {
    const miles = parseInt(coverageVal, 10);
    if (!miles || miles < 1) {
      toast.show("Enter a valid mileage", "error");
      return;
    }
    try {
      const r = await apiFetch<{ contractor: Contractor }>(`/contractors/${id}/coverage`, { method: "PUT", body: { miles } });
      setData((prev) => (prev ? { ...prev, coverage_miles: r.contractor.coverage_miles } : prev));
      setCoverageOpen(false);
      toast.show("Coverage updated 🚗", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const openDraft = async () => {
    try {
      const p = await apiFetch<{ projects: Project[] }>("/projects");
      setProjects(p.projects || []);
    } catch { setProjects([]); }
    setProjectPickOpen(true);
  };

  const createContract = async (projectId?: string) => {
    setCreatingContract(true);
    try {
      const r = await apiFetch<{ contract: { id: string } }>("/contracts", {
        method: "POST",
        body: { contractor_id: id, project_id: projectId || null },
      });
      setProjectPickOpen(false);
      router.push(`/contract/${r.contract.id}`);
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally { setCreatingContract(false); }
  };

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

  useEffect(() => {
    if (reviewParam === "1") setReviewOpen(true);
  }, [reviewParam]);

  const addReviewPhoto = async () => {
    if (reviewPhotos.length >= 6) { toast.show("Up to 6 photos", "error"); return; }
    const uri = await pickFromLibrary();
    if (!uri) return;
    setUploadingPhoto(true);
    try {
      const path = await uploadImage(uri);
      setReviewPhotos((p) => [...p, path]);
    } catch {
      toast.show("Photo upload failed", "error");
    } finally { setUploadingPhoto(false); }
  };

  const submitReview = async () => {
    if (!text.trim()) {
      toast.show("Write a few words about the work", "error");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/contractors/${id}/reviews`, { method: "POST", body: { rating, text: text.trim(), image_paths: reviewPhotos, contract_id: contractIdParam || null } });
      setText("");
      setRating(5);
      setReviewPhotos([]);
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

          {/* Coverage */}
          <View style={styles.coverageCard}>
            <View style={styles.coverageIcon}><Feather name="navigation" size={18} color={colors.brandSecondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.coverageTitle}>Travels up to {data.coverage_miles ?? 25} miles</Text>
              <Text style={styles.coverageSub}>Service area from {data.location}</Text>
            </View>
            {canEditCoverage && (
              <Pressable
                testID="edit-coverage-button"
                style={styles.coverageEdit}
                onPress={() => { setCoverageVal(String(data.coverage_miles ?? 25)); setCoverageOpen(true); }}
              >
                <Feather name="edit-2" size={14} color={colors.brand} />
                <Text style={styles.coverageEditText}>Edit</Text>
              </Pressable>
            )}
          </View>

          {/* Agreement + Job tracker */}
          <Text style={styles.sectionTitle}>Agreement & job tracker</Text>
          <Pressable testID="draft-contract" style={styles.contractCard} onPress={openDraft}>
            <View style={styles.contractIcon}><Feather name="file-text" size={20} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contractTitle}>Draft an agreement</Text>
              <Text style={styles.contractSub}>Auto-filled scope, price & timeline · discuss, sign & track the job</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
          <Pressable testID="my-agreements" style={styles.linkRow} onPress={() => router.push("/contracts")}>
            <Feather name="folder" size={15} color={colors.brand} />
            <Text style={styles.linkText}>View my agreements</Text>
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
                {!!r.image_paths?.length && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.xs }}>
                    {r.image_paths.map((p) => (
                      <Pressable key={p} testID={`review-photo-${r.id}`} onPress={() => setViewerUri(fileUrl(p))}>
                        <Image source={{ uri: fileUrl(p) }} style={styles.reviewPhoto} contentFit="cover" />
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
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
            <View style={styles.photoStrip}>
              {reviewPhotos.map((p) => (
                <View key={p} style={styles.thumbWrap}>
                  <Image source={{ uri: fileUrl(p) }} style={styles.thumb} contentFit="cover" />
                  <Pressable testID={`remove-photo-${p}`} style={styles.thumbRemove} onPress={() => setReviewPhotos((arr) => arr.filter((x) => x !== p))}>
                    <Feather name="x" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {reviewPhotos.length < 6 && (
                <Pressable testID="add-review-photo" style={styles.addPhoto} onPress={addReviewPhoto} disabled={uploadingPhoto}>
                  {uploadingPhoto ? <ActivityIndicator color={colors.brand} /> : <Feather name="camera" size={20} color={colors.brand} />}
                </Pressable>
              )}
            </View>
            <Pressable testID="submit-review-button" style={styles.submitBtn} onPress={submitReview} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Post Review</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Draft-contract project chooser */}
      <Modal visible={projectPickOpen} transparent animationType="slide" onRequestClose={() => setProjectPickOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setProjectPickOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Draft an agreement 📜</Text>
            <Text style={styles.contractIntro}>Link this to a garden project (optional). We'll auto-fill a fair agreement you can edit, discuss and sign.</Text>
            {projects.length > 0 && (
              <ScrollView style={{ maxHeight: 240 }}>
                {projects.map((p) => (
                  <Pressable
                    key={p.id}
                    testID={`pick-project-${p.id}`}
                    style={styles.projectRow}
                    disabled={creatingContract}
                    onPress={() => createContract(p.id)}
                  >
                    <Feather name="image" size={16} color={colors.brand} />
                    <Text style={styles.projectRowText} numberOfLines={1}>{p.title}</Text>
                    <Feather name="chevron-right" size={16} color={colors.muted} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable testID="draft-no-project" style={styles.submitBtn} onPress={() => createContract()} disabled={creatingContract}>
              {creatingContract ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{projects.length > 0 ? "Continue without a project" : "Create agreement"}</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
      {/* Coverage editor */}
      <Modal visible={coverageOpen} transparent animationType="slide" onRequestClose={() => setCoverageOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setCoverageOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Travel distance 🚗</Text>
            <Text style={styles.contractIntro}>How many miles will this contractor travel for a job?</Text>
            <TextInput
              testID="coverage-input"
              style={styles.reviewInput}
              placeholder="e.g. 25"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              value={coverageVal}
              onChangeText={setCoverageVal}
            />
            <Pressable testID="save-coverage-button" style={styles.submitBtn} onPress={saveCoverage}>
              <Text style={styles.submitText}>Save coverage</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ImageViewer uri={viewerUri} visible={!!viewerUri} onClose={() => setViewerUri(undefined)} />
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
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  linkText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 14 },
  projectRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  projectRowText: { flex: 1, fontFamily: fonts.text, fontWeight: "600", color: colors.onSurface, fontSize: 15 },
  reviewHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  addReview: { flexDirection: "row", alignItems: "center", gap: 5 },
  addReviewText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 13 },
  noReviews: { fontFamily: fonts.text, color: colors.muted },
  reviewCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  reviewTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reviewAuthor: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  reviewText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, lineHeight: 20 },
  reviewPhoto: { width: 92, height: 92, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  photoStrip: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  thumbWrap: { width: 64, height: 64 },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  thumbRemove: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" },
  addPhoto: { width: 64, height: 64, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.brand, alignItems: "center", justifyContent: "center" },
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
  coverageCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  coverageIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: "#E7F0F4", alignItems: "center", justifyContent: "center" },
  coverageTitle: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 15 },
  coverageSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  coverageEdit: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderColor: colors.brand, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  coverageEditText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 12 },
  termRow: { gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, paddingBottom: spacing.sm },
  termLabel: { fontFamily: fonts.text, fontWeight: "800", color: colors.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  termValue: { fontFamily: fonts.text, color: colors.onSurface, fontSize: 15 },
});
