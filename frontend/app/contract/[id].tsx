import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { apiFetch, API, getMemToken } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Stage = { label: string; done: boolean; note: string; updated_at: string | null };
type Msg = { id: string; sender_id: string; sender_name: string; sender_role: string; text: string; created_at: string };
type Contract = {
  id: string;
  project_title?: string;
  contractor_name: string;
  contractor_phone?: string;
  customer_name: string;
  customer_phone?: string;
  status: string;
  scope: string;
  price: string;
  start_date: string;
  end_date: string;
  deposit_percent: number;
  payment_terms: string;
  materials: string;
  warranty: string;
  site_address: string;
  notes: string;
  customer_signed: boolean;
  customer_signature?: string;
  customer_signed_at?: string;
  contractor_signed: boolean;
  contractor_signature?: string;
  contractor_signed_at?: string;
  deposit_paid?: boolean;
  deposit_amount?: number | null;
  quote_status?: string;
  quote_amount?: number | null;
  quote_items?: { label: string; amount: number }[];
  quote_note?: string;
  messages?: Msg[];
  stages: Stage[];
  progress_index: number;
};
type Clause = { label: string; text: string };

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: colors.muted },
  awaiting_signatures: { label: "Awaiting signatures", color: colors.brandTertiary },
  active: { label: "In progress", color: colors.brand },
  completed: { label: "Completed", color: colors.success },
  cancelled: { label: "Cancelled", color: colors.error },
};

const EDIT_FIELDS: { key: keyof Contract; label: string; multiline?: boolean; keyboard?: "default" | "numeric" }[] = [
  { key: "scope", label: "Scope of work", multiline: true },
  { key: "price", label: "Total price" },
  { key: "start_date", label: "Start date" },
  { key: "end_date", label: "Completion date" },
  { key: "deposit_percent", label: "Deposit %", keyboard: "numeric" },
  { key: "payment_terms", label: "Payment terms", multiline: true },
  { key: "materials", label: "Materials", multiline: true },
  { key: "warranty", label: "Workmanship guarantee" },
  { key: "site_address", label: "Site address" },
  { key: "notes", label: "Extra notes", multiline: true },
];

export default function ContractScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, loading } = useAuth();
  const scrollRef = useRef<ScrollView>(null);

  const [c, setC] = useState<Contract | null>(null);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Contract>>({});
  const [signName, setSignName] = useState("");
  const [chat, setChat] = useState("");
  const [busy, setBusy] = useState(false);
  const [showClauses, setShowClauses] = useState(false);

  const amProSide = !!user && (user.role === "contractor" || user.role === "admin");
  const fullySigned = !!c && c.customer_signed && c.contractor_signed;
  const mySignatureDone = c ? (amProSide ? c.contractor_signed : c.customer_signed) : false;

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ contract: Contract; clauses: Clause[] }>(`/contracts/${id}`);
      setC(r.contract);
      setClauses(r.clauses);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  }, [id]);

  useEffect(() => { if (!loading) load(); }, [load, loading]);

  const openEdit = () => {
    if (!c) return;
    setDraft({
      scope: c.scope, price: c.price, start_date: c.start_date, end_date: c.end_date,
      deposit_percent: c.deposit_percent, payment_terms: c.payment_terms, materials: c.materials,
      warranty: c.warranty, site_address: c.site_address, notes: c.notes,
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      const body: any = { ...draft };
      if (body.deposit_percent !== undefined) body.deposit_percent = parseInt(String(body.deposit_percent), 10) || 0;
      const r = await apiFetch<{ contract: Contract }>(`/contracts/${id}`, { method: "PUT", body });
      setC(r.contract);
      setEditOpen(false);
      toast.show("Agreement updated — signatures reset for both parties", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally { setBusy(false); }
  };

  const sign = async () => {
    if (!signName.trim()) { toast.show("Type your full name to sign", "error"); return; }
    setBusy(true);
    try {
      const r = await apiFetch<{ contract: Contract }>(`/contracts/${id}/sign`, { method: "POST", body: { full_name: signName.trim(), agree: true } });
      setC(r.contract);
      setSignOpen(false);
      setSignName("");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show(r.contract.customer_signed && r.contract.contractor_signed ? "Signed by both — the job is now live! 🌱" : "Signed ✍️ Waiting for the other party.", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally { setBusy(false); }
  };

  const setStage = async (idx: number) => {
    setBusy(true);
    try {
      const r = await apiFetch<{ contract: Contract }>(`/contracts/${id}/stage`, { method: "POST", body: { stage_index: idx } });
      setC(r.contract);
      toast.show(idx + 1 >= r.contract.stages.length ? "Job marked complete 🎉" : "Progress updated 🌿", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally { setBusy(false); }
  };

  const sendMsg = async () => {
    if (!chat.trim()) return;
    const text = chat.trim();
    setChat("");
    try {
      await apiFetch(`/contracts/${id}/messages`, { method: "POST", body: { text } });
      await load();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const params = useLocalSearchParams<{ deposit?: string; session_id?: string }>();
  const [payBusy, setPayBusy] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteItems, setQuoteItems] = useState<{ label: string; amount: string }[]>([{ label: "Materials", amount: "" }, { label: "Labour", amount: "" }]);
  const [quoteNote, setQuoteNote] = useState("");
  const [quoteBusy, setQuoteBusy] = useState(false);

  const quoteTotal = quoteItems.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);

  const openQuote = () => {
    if (c?.quote_items?.length) {
      setQuoteItems(c.quote_items.map((i) => ({ label: i.label, amount: String(i.amount) })));
      setQuoteNote(c.quote_note || "");
    }
    setQuoteOpen(true);
  };

  const submitQuote = async () => {
    const items = quoteItems
      .filter((i) => i.label.trim() && parseFloat(i.amount) > 0)
      .map((i) => ({ label: i.label.trim(), amount: parseFloat(i.amount) }));
    if (items.length === 0) { toast.show("Add at least one line item with an amount", "error"); return; }
    setQuoteBusy(true);
    try {
      const r = await apiFetch<{ contract: Contract }>(`/contracts/${id}/quote`, { method: "POST", body: { items, note: quoteNote.trim() } });
      setC(r.contract);
      setQuoteOpen(false);
      toast.show("Quote sent to the customer 📩", "success");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setQuoteBusy(false); }
  };

  const respondQuote = async (accept: boolean) => {
    setQuoteBusy(true);
    try {
      const r = await apiFetch<{ contract: Contract }>(`/contracts/${id}/quote/respond`, { method: "POST", body: { accept } });
      setC(r.contract);
      toast.show(accept ? "Quote accepted — you can pay the deposit now 🌱" : "Quote declined. Your contractor can send a new one.", accept ? "success" : "info");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setQuoteBusy(false); }
  };

  // Handle return from Stripe Checkout
  useEffect(() => {
    if (params.deposit === "success" && params.session_id) {
      (async () => {
        try {
          const r = await apiFetch<{ payment_status: string }>(`/payments/status/${params.session_id}`);
          if (r.payment_status === "paid") {
            toast.show("Deposit paid — thank you! 🎉", "success");
          } else {
            toast.show("Payment received, confirming…", "info");
          }
          load();
        } catch {}
      })();
    } else if (params.deposit === "cancel") {
      toast.show("Payment cancelled", "info");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.deposit, params.session_id]);

  const payDeposit = async () => {
    setPayBusy(true);
    try {
      const origin = Platform.OS === "web" && typeof window !== "undefined"
        ? window.location.origin
        : (API.replace(/\/api$/, ""));
      const r = await apiFetch<{ url: string }>(`/contracts/${id}/deposit`, { method: "POST", body: { origin } });
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.href = r.url;
      } else {
        await Linking.openURL(r.url);
      }
    } catch (e: any) {
      toast.show(e.message, "error");
      setPayBusy(false);
    }
  };

  const openPdf = async () => {
    const url = `${API}/contracts/${id}/pdf?token=${encodeURIComponent(getMemToken() || "")}`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(url, "_blank");
    } else {
      await Linking.openURL(url);
    }
  };

  if (!c) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>;
  }

  const meta = STATUS_META[c.status] || STATUS_META.draft;
  const canEdit = !fullySigned;
  const depositReady = c.quote_status === "accepted" || fullySigned;
  const progressPct = c.stages.length ? Math.round((c.progress_index / c.stages.length) * 100) : 0;

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="contract-back" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>Service Agreement</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40, gap: spacing.md }}>
        {/* Status */}
        <View style={styles.headerCard}>
          <Feather name="file-text" size={22} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.docTitle}>{c.project_title || "Garden project"}</Text>
            <Text style={styles.docSub}>{c.contractor_name} · {c.customer_name}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: meta.color + "22" }]}>
            <View style={[styles.dot, { backgroundColor: meta.color }]} />
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>

        {/* Parties */}
        <View style={styles.card}>
          <Text style={styles.cardHead}>Parties</Text>
          <View style={styles.partyRow}>
            <Feather name="user" size={15} color={colors.muted} />
            <Text style={styles.partyText}><Text style={styles.b}>Customer:</Text> {c.customer_name}{c.customer_phone ? ` · ${c.customer_phone}` : ""}</Text>
          </View>
          <View style={styles.partyRow}>
            <Feather name="tool" size={15} color={colors.muted} />
            <Text style={styles.partyText}><Text style={styles.b}>Contractor:</Text> {c.contractor_name}{c.contractor_phone ? ` · ${c.contractor_phone}` : ""}</Text>
          </View>
          {!!c.site_address && (
            <View style={styles.partyRow}>
              <Feather name="map-pin" size={15} color={colors.muted} />
              <Text style={styles.partyText}><Text style={styles.b}>Site:</Text> {c.site_address}</Text>
            </View>
          )}
        </View>

        {/* Terms */}
        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardHead}>Agreed terms</Text>
            {canEdit && (
              <Pressable testID="edit-terms" style={styles.editBtn} onPress={openEdit}>
                <Feather name="edit-2" size={13} color={colors.brand} />
                <Text style={styles.editText}>Edit</Text>
              </Pressable>
            )}
          </View>
          <Term label="Scope of work" value={c.scope} />
          <Term label="Total price" value={c.price} />
          <Term label="Timeline" value={`${c.start_date} → ${c.end_date}`} />
          <Term label="Deposit" value={`${c.deposit_percent}% up front`} />
          <Term label="Payment terms" value={c.payment_terms} />
          <Term label="Materials" value={c.materials} />
          <Term label="Guarantee" value={c.warranty} />
          {!!c.notes && <Term label="Extra notes" value={c.notes} />}
        </View>

        {/* Quote */}
        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardHead}>Quote 💷</Text>
            {c.quote_status && c.quote_status !== "none" && (
              <View style={[styles.statusPill, { backgroundColor: (c.quote_status === "accepted" ? colors.success : c.quote_status === "declined" ? colors.error : colors.brandTertiary) + "22" }]}>
                <Text style={[styles.statusText, { color: c.quote_status === "accepted" ? colors.success : c.quote_status === "declined" ? colors.error : colors.brandTertiary }]}>
                  {c.quote_status === "accepted" ? "Accepted" : c.quote_status === "declined" ? "Declined" : "Awaiting response"}
                </Text>
              </View>
            )}
          </View>

          {c.quote_status && c.quote_status !== "none" && c.quote_items?.length ? (
            <>
              {c.quote_items.map((it, i) => (
                <View key={i} style={styles.quoteRow}>
                  <Text style={styles.quoteLabel}>{it.label}</Text>
                  <Text style={styles.quoteAmt}>£{it.amount.toLocaleString()}</Text>
                </View>
              ))}
              <View style={[styles.quoteRow, styles.quoteTotalRow]}>
                <Text style={styles.quoteTotalLabel}>Total</Text>
                <Text style={styles.quoteTotalAmt}>£{(c.quote_amount || 0).toLocaleString()}</Text>
              </View>
              {!!c.quote_note && <Text style={styles.quoteNote}>{c.quote_note}</Text>}
            </>
          ) : (
            <Text style={styles.clauseHint}>{amProSide ? "Send the customer a quote with your price breakdown. Once they accept, they can pay the deposit." : "Your contractor hasn't sent a quote yet."}</Text>
          )}

          {/* Pro actions */}
          {amProSide && c.quote_status !== "accepted" && !c.deposit_paid && (
            <Pressable testID="submit-quote-btn" style={styles.primaryBtn} onPress={openQuote}>
              <Feather name="edit-3" size={16} color="#fff" />
              <Text style={styles.primaryText}>{c.quote_status === "proposed" || c.quote_status === "declined" ? "Update quote" : "Submit a quote"}</Text>
            </Pressable>
          )}

          {/* Customer actions */}
          {!amProSide && c.quote_status === "proposed" && (
            <View style={styles.quoteBtnRow}>
              <Pressable testID="decline-quote" style={[styles.quoteBtn, styles.declineBtn]} disabled={quoteBusy} onPress={() => respondQuote(false)}>
                <Feather name="x" size={15} color={colors.error} />
                <Text style={[styles.quoteBtnText, { color: colors.error }]}>Decline</Text>
              </Pressable>
              <Pressable testID="accept-quote" style={[styles.quoteBtn, styles.acceptBtn]} disabled={quoteBusy} onPress={() => respondQuote(true)}>
                {quoteBusy ? <ActivityIndicator color="#fff" /> : (<><Feather name="check" size={15} color="#fff" /><Text style={[styles.quoteBtnText, { color: "#fff" }]}>Accept quote</Text></>)}
              </Pressable>
            </View>
          )}
          {!amProSide && c.quote_status === "accepted" && !c.deposit_paid && (
            <Text style={styles.quoteNote}>You accepted this quote — pay the deposit below to get started.</Text>
          )}
        </View>

        {/* Standard clauses */}
        <Pressable style={styles.card} onPress={() => setShowClauses((s) => !s)}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardHead}>Standard terms & protections</Text>
            <Feather name={showClauses ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
          </View>
          {!showClauses ? (
            <Text style={styles.clauseHint}>Fair, plain-English terms that protect both the customer and the contractor. Tap to read.</Text>
          ) : (
            <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
              {clauses.map((cl) => (
                <View key={cl.label}>
                  <Text style={styles.clauseLabel}>{cl.label}</Text>
                  <Text style={styles.clauseText}>{cl.text}</Text>
                </View>
              ))}
            </View>
          )}
        </Pressable>

        {/* Signatures */}
        <View style={styles.card}>
          <Text style={styles.cardHead}>Signatures</Text>
          <View style={styles.signRow}>
            <SignBox title="Customer" signed={c.customer_signed} name={c.customer_signature} when={c.customer_signed_at} />
            <SignBox title="Contractor" signed={c.contractor_signed} name={c.contractor_signature} when={c.contractor_signed_at} />
          </View>
          {!mySignatureDone ? (
            <Pressable testID="open-sign" style={styles.primaryBtn} onPress={() => { setSignName(amProSide ? c.contractor_name : c.customer_name); setSignOpen(true); }}>
              <Feather name="edit-3" size={16} color="#fff" />
              <Text style={styles.primaryText}>Review & sign as {amProSide ? "contractor" : "customer"}</Text>
            </Pressable>
          ) : (
            <View style={styles.signedNote}>
              <Feather name="check-circle" size={16} color={colors.success} />
              <Text style={styles.signedNoteText}>You've signed. {fullySigned ? "Agreement is fully in effect." : "Waiting for the other party to sign."}</Text>
            </View>
          )}
        </View>

        {/* Deposit payment (customer, once quote accepted) */}
        {depositReady && !amProSide && (
          <View style={styles.card}>
            <Text style={styles.cardHead}>Deposit</Text>
            {c.deposit_paid ? (
              <View style={styles.signedNote}>
                <Feather name="check-circle" size={16} color={colors.success} />
                <Text style={styles.signedNoteText}>Deposit{c.deposit_amount ? ` of £${c.deposit_amount.toFixed(2)}` : ""} paid — your contractor can crack on! 🌱</Text>
              </View>
            ) : (
              <>
                <Text style={styles.clauseHint}>Pay the agreed {c.deposit_percent}% deposit securely to get the job started. Test mode — use card 4242 4242 4242 4242.</Text>
                <Pressable testID="pay-deposit" style={styles.primaryBtn} onPress={payDeposit} disabled={payBusy}>
                  {payBusy ? <ActivityIndicator color="#fff" /> : (<><Feather name="credit-card" size={16} color="#fff" /><Text style={styles.primaryText}>Pay deposit</Text></>)}
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* Download PDF (once fully signed) */}
        {fullySigned && (
          <Pressable testID="download-pdf" style={styles.pdfBtn} onPress={openPdf}>
            <Feather name="download" size={16} color={colors.brand} />
            <Text style={styles.pdfText}>Download signed agreement (PDF)</Text>
          </Pressable>
        )}

        {/* Job tracker */}
        {fullySigned && (
          <View style={styles.card}>
            <Text style={styles.cardHead}>Job progress {c.status === "completed" ? "🎉" : "🌱"}</Text>
            <View style={styles.progressBarBg}><View style={[styles.progressBarFill, { width: `${progressPct}%` }]} /></View>
            <Text style={styles.progressLabel}>{c.progress_index} of {c.stages.length} stages · {progressPct}%</Text>
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              {c.stages.map((s, i) => (
                <Pressable
                  key={s.label}
                  testID={`stage-${i}`}
                  disabled={!amProSide || busy}
                  onPress={() => amProSide && setStage(i)}
                  style={styles.stageRow}
                >
                  <View style={[styles.stageDot, s.done && styles.stageDotDone]}>
                    {s.done && <Feather name="check" size={11} color="#fff" />}
                  </View>
                  <Text style={[styles.stageLabel, s.done && styles.stageLabelDone]}>{s.label}</Text>
                  {amProSide && <Feather name="chevron-right" size={16} color={colors.muted} />}
                </Pressable>
              ))}
            </View>
            {amProSide ? (
              <Text style={styles.hintSmall}>Tap a stage to mark progress up to that point. Your customer sees updates instantly.</Text>
            ) : (
              <Text style={styles.hintSmall}>Your contractor updates these stages as the work progresses.</Text>
            )}
          </View>
        )}

        {/* Discussion */}
        <View style={styles.card}>
          <Text style={styles.cardHead}>Discussion</Text>
          {(c.messages || []).length === 0 ? (
            <Text style={styles.clauseHint}>Discuss the terms here before signing — everything stays on record.</Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {(c.messages || []).map((m) => {
                const mine = m.sender_id === (user?.user_id as any) || (amProSide && m.sender_role === "contractor") || (!amProSide && m.sender_role === "customer");
                return (
                  <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={styles.bubbleName}>{m.sender_name} · {m.sender_role}</Text>
                    <Text style={styles.bubbleText}>{m.text}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Discussion composer */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <TextInput
            testID="contract-chat-input"
            style={styles.composerInput}
            placeholder="Message the other party…"
            placeholderTextColor={colors.muted}
            value={chat}
            onChangeText={setChat}
          />
          <Pressable testID="contract-send" style={styles.sendBtn} onPress={sendMsg}>
            <Feather name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Edit modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setEditOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Edit terms</Text>
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {EDIT_FIELDS.map((f) => (
                <View key={f.key as string} style={{ marginBottom: spacing.md }}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  <TextInput
                    testID={`edit-${f.key as string}`}
                    style={[styles.input, f.multiline && styles.inputMultiline]}
                    value={String((draft as any)[f.key] ?? "")}
                    onChangeText={(t) => setDraft((d) => ({ ...d, [f.key]: t }))}
                    multiline={f.multiline}
                    keyboardType={f.keyboard || "default"}
                    placeholderTextColor={colors.muted}
                  />
                </View>
              ))}
            </ScrollView>
            <Pressable testID="save-terms" style={styles.primaryBtn} onPress={saveEdit} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save terms</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Sign modal */}
      <Modal visible={signOpen} transparent animationType="slide" onRequestClose={() => setSignOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setSignOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Sign the agreement ✍️</Text>
            <Text style={styles.clauseHint}>By typing your full name and signing, you confirm you've read and agree to the terms and the standard protections above.</Text>
            <Text style={styles.fieldLabel}>Full name</Text>
            <TextInput
              testID="sign-name-input"
              style={styles.input}
              value={signName}
              onChangeText={setSignName}
              placeholder="e.g. Jane Smith"
              placeholderTextColor={colors.muted}
            />
            <Pressable testID="confirm-sign" style={styles.primaryBtn} onPress={sign} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Agree & sign</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Quote modal (contractor) */}
      <Modal visible={quoteOpen} transparent animationType="slide" onRequestClose={() => setQuoteOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setQuoteOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Send a quote 💷</Text>
            <Text style={styles.clauseHint}>Add your price breakdown. The customer accepts before paying the deposit.</Text>
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {quoteItems.map((it, i) => (
                <View key={i} style={styles.qItemRow}>
                  <TextInput
                    testID={`quote-label-${i}`}
                    style={[styles.input, { flex: 1 }]}
                    value={it.label}
                    onChangeText={(t) => setQuoteItems((arr) => arr.map((x, j) => j === i ? { ...x, label: t } : x))}
                    placeholder="e.g. Materials"
                    placeholderTextColor={colors.muted}
                  />
                  <TextInput
                    testID={`quote-amount-${i}`}
                    style={[styles.input, { width: 100 }]}
                    value={it.amount}
                    onChangeText={(t) => setQuoteItems((arr) => arr.map((x, j) => j === i ? { ...x, amount: t.replace(/[^0-9.]/g, "") } : x))}
                    placeholder="£0"
                    keyboardType="numeric"
                    placeholderTextColor={colors.muted}
                  />
                  {quoteItems.length > 1 && (
                    <Pressable testID={`quote-remove-${i}`} onPress={() => setQuoteItems((arr) => arr.filter((_, j) => j !== i))}>
                      <Feather name="x-circle" size={22} color={colors.muted} />
                    </Pressable>
                  )}
                </View>
              ))}
              <Pressable testID="quote-add-item" style={styles.addItemBtn} onPress={() => setQuoteItems((arr) => [...arr, { label: "", amount: "" }])}>
                <Feather name="plus" size={15} color={colors.brand} />
                <Text style={styles.addItemText}>Add line item</Text>
              </Pressable>
              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                testID="quote-note"
                style={[styles.input, styles.inputMultiline]}
                value={quoteNote}
                onChangeText={setQuoteNote}
                multiline
                placeholder="What's included, timings, anything else…"
                placeholderTextColor={colors.muted}
              />
            </ScrollView>
            <View style={styles.quoteTotalPreview}>
              <Text style={styles.quoteTotalLabel}>Quote total</Text>
              <Text style={styles.quoteTotalAmt}>£{quoteTotal.toLocaleString()}</Text>
            </View>
            <Pressable testID="send-quote" style={styles.primaryBtn} onPress={submitQuote} disabled={quoteBusy}>
              {quoteBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Send quote to customer</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.termRow}>
      <Text style={styles.termLabel}>{label}</Text>
      <Text style={styles.termValue}>{value}</Text>
    </View>
  );
}

function SignBox({ title, signed, name, when }: { title: string; signed: boolean; name?: string; when?: string }) {
  return (
    <View style={[styles.signBox, signed && styles.signBoxDone]}>
      <Text style={styles.signBoxTitle}>{title}</Text>
      {signed ? (
        <>
          <Text style={styles.signName}>{name}</Text>
          <View style={styles.signedRow}>
            <Feather name="check-circle" size={13} color={colors.success} />
            <Text style={styles.signedTxt}>Signed</Text>
          </View>
        </>
      ) : (
        <Text style={styles.pending}>Not signed yet</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surfaceSecondary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, textAlign: "center", fontFamily: fonts.display, fontSize: 18, color: colors.onSurface },
  headerCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  docTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.onSurface },
  docSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.pill },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontFamily: fonts.text, fontWeight: "800", fontSize: 11 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardHead: { fontFamily: fonts.display, fontSize: 17, color: colors.onSurface },
  cardHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1.5, borderColor: colors.brand, paddingVertical: 5, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  editText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 12 },
  partyRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  partyText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14, flex: 1 },
  b: { fontWeight: "800", color: colors.onSurface },
  termRow: { gap: 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, paddingBottom: spacing.sm },
  termLabel: { fontFamily: fonts.text, fontWeight: "800", color: colors.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  termValue: { fontFamily: fonts.text, color: colors.onSurface, fontSize: 15, lineHeight: 21 },
  clauseHint: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, lineHeight: 19 },
  clauseLabel: { fontFamily: fonts.text, fontWeight: "800", color: colors.onSurface, fontSize: 13 },
  clauseText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
  signRow: { flexDirection: "row", gap: spacing.md },
  signBox: { flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, borderStyle: "dashed", gap: 4, minHeight: 78, justifyContent: "center" },
  signBoxDone: { borderStyle: "solid", borderColor: colors.success, backgroundColor: "#F0F6F1" },
  signBoxTitle: { fontFamily: fonts.text, fontWeight: "800", color: colors.muted, fontSize: 11, textTransform: "uppercase" },
  signName: { fontFamily: fonts.display, fontSize: 18, color: colors.onSurface },
  signedRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  signedTxt: { fontFamily: fonts.text, fontWeight: "700", color: colors.success, fontSize: 12 },
  pending: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, height: 52, borderRadius: radius.md, marginTop: spacing.xs },
  primaryText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 15 },
  signedNote: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#F0F6F1", padding: spacing.md, borderRadius: radius.md },
  signedNoteText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 13, flex: 1 },
  pdfBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderWidth: 1.5, borderColor: colors.brand, height: 50, borderRadius: radius.md },
  pdfText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 14 },
  progressBarBg: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  progressBarFill: { height: 10, borderRadius: 5, backgroundColor: colors.brand },
  progressLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 13 },
  stageRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  stageDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  stageDotDone: { backgroundColor: colors.brand },
  stageLabel: { flex: 1, fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14 },
  stageLabelDone: { color: colors.onSurface, fontWeight: "700" },
  hintSmall: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: spacing.xs, lineHeight: 17 },
  bubble: { padding: spacing.md, borderRadius: radius.md, maxWidth: "90%" },
  bubbleMine: { backgroundColor: "#E7F0EA", alignSelf: "flex-end" },
  bubbleTheirs: { backgroundColor: colors.surfaceTertiary, alignSelf: "flex-start" },
  bubbleName: { fontFamily: fonts.text, fontWeight: "800", color: colors.muted, fontSize: 10, textTransform: "capitalize", marginBottom: 2 },
  bubbleText: { fontFamily: fonts.text, color: colors.onSurface, fontSize: 14, lineHeight: 20 },
  composer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.surfaceSecondary, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  composerInput: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, height: 44, fontFamily: fonts.text, color: colors.onSurface },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,54,46,0.5)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center" },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  fieldLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurfaceSecondary, fontSize: 13, marginBottom: 4 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  quoteRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  quoteLabel: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14 },
  quoteAmt: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  quoteTotalRow: { borderBottomWidth: 0, borderTopWidth: 2, borderTopColor: colors.brand, marginTop: 2, paddingTop: 8 },
  quoteTotalLabel: { fontFamily: fonts.text, fontWeight: "800", color: colors.onSurface, fontSize: 15 },
  quoteTotalAmt: { fontFamily: fonts.display, color: colors.brand, fontSize: 18 },
  quoteNote: { fontFamily: fonts.text, color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs, fontStyle: "italic" },
  quoteBtnRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  quoteBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: radius.md },
  acceptBtn: { backgroundColor: colors.brand },
  declineBtn: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.error },
  quoteBtnText: { fontFamily: fonts.text, fontWeight: "700", fontSize: 14 },
  qItemRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  addItemBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: spacing.sm },
  addItemText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 14 },
  quoteTotalPreview: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, borderTopWidth: 2, borderTopColor: colors.brand, marginTop: spacing.xs },
});
