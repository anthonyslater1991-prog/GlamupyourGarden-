import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, FlatList, Platform, Modal, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiFetch, fileUrl } from "@/src/lib/api";
import { pickFromLibrary, uploadImage } from "@/src/lib/upload";
import { useAuth } from "@/src/context/AuthContext";
import { useUnread } from "@/src/context/UnreadContext";
import { useToast } from "@/src/components/Toast";
import ImageViewer from "@/src/components/ImageViewer";
import SavePhotoSheet from "@/src/components/SavePhotoSheet";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Msg = { id: string; sender_id: string; recipient_id: string; text: string; image_path?: string; read?: boolean; created_at: string };

const REASONS = ["Spam or scam", "Harassment or bullying", "Inappropriate content", "Other"];

export default function DMThread() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const unread = useUnread();
  const listRef = useRef<FlatList>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [other, setOther] = useState<{ name?: string } | null>(null);
  const [input, setInput] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | undefined>(undefined);
  const [savePath, setSavePath] = useState<string | undefined>(undefined);
  const [saveOpen, setSaveOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ messages: Msg[]; other: any }>(`/messages/${userId}`);
      setMessages(r.messages);
      setOther(r.other);
      unread.refresh();
    } catch {}
  }, [userId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const doSend = async (body: any, optimistic: Msg) => {
    setMessages((prev) => [...prev, optimistic]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      await apiFetch("/messages", { method: "POST", body });
      load();
    } catch (e: any) {
      if (e.message?.includes("turned off") || e.message?.includes("can't message")) {
        setBlocked(true);
        toast.show(e.message, "error");
      } else {
        toast.show(e.message || "Failed to send", "error");
      }
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    doSend(
      { recipient_id: userId, text },
      { id: `tmp_${Date.now()}`, sender_id: user!.user_id, recipient_id: userId!, text, created_at: new Date().toISOString() }
    );
  };

  const sendPhoto = async () => {
    const uri = await pickFromLibrary();
    if (!uri) return;
    setUploading(true);
    try {
      const path = await uploadImage(uri);
      await doSend(
        { recipient_id: userId, text: "", image_path: path },
        { id: `tmp_${Date.now()}`, sender_id: user!.user_id, recipient_id: userId!, text: "", image_path: path, created_at: new Date().toISOString() }
      );
    } catch (e: any) {
      toast.show(e.message || "Failed to send photo", "error");
    } finally {
      setUploading(false);
    }
  };

  const blockUser = async () => {
    setMenuOpen(false);
    try {
      await apiFetch("/block", { method: "POST", body: { user_id: userId } });
      toast.show("Member blocked 🔒", "success");
      router.back();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const submitReport = async (reason: string) => {
    try {
      await apiFetch("/report", { method: "POST", body: { reported_id: userId, reason, context: "direct message" } });
      setReportOpen(false);
      toast.show("Report sent to our team. Thank you 💚", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-dm" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{other?.name || "Chat"}</Text>
        <Pressable testID="dm-menu" style={styles.iconBtn} onPress={() => setMenuOpen(true)}>
          <Feather name="more-vertical" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>👋</Text>
              <Text style={styles.emptyText}>Say hello and start the conversation 🌿</Text>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.sender_id === user?.user_id;
            return (
              <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
                <View style={[styles.bubble, mine ? styles.mine : styles.otherB, item.image_path && styles.imgBubble]}>
                  {item.image_path && (
                    <Pressable testID={`dm-image-${item.id}`} onPress={() => { setViewerUri(fileUrl(item.image_path)); setSavePath(item.image_path); }}>
                      <Image source={{ uri: fileUrl(item.image_path) }} style={styles.msgImage} contentFit="cover" />
                    </Pressable>
                  )}
                  {!!item.text && (
                    <Text style={[styles.bubbleText, mine && { color: "#fff" }, item.image_path && { marginTop: spacing.xs }]}>{item.text}</Text>
                  )}
                  {mine && (
                    <View style={styles.receiptRow}>
                      <Feather name={item.read ? "check-circle" : "check"} size={12} color={item.read ? "#BFE3C6" : "rgba(255,255,255,0.65)"} />
                      <Text style={styles.receiptText}>{item.read ? "Seen" : "Sent"}</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          }}
        />
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable testID="dm-attach" style={styles.attachBtn} onPress={sendPhoto} disabled={blocked || uploading}>
            {uploading ? <ActivityIndicator size="small" color={colors.brand} /> : <Feather name="image" size={22} color={colors.brand} />}
          </Pressable>
          <TextInput
            testID="dm-input"
            style={styles.input}
            placeholder={blocked ? "Messages are turned off" : "Message..."}
            placeholderTextColor={colors.muted}
            value={input}
            onChangeText={setInput}
            editable={!blocked}
            multiline
          />
          <Pressable testID="dm-send" style={styles.sendBtn} onPress={send} disabled={blocked}>
            <Feather name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Menu: report / block */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Pressable testID="menu-report" style={styles.menuRow} onPress={() => { setMenuOpen(false); setReportOpen(true); }}>
              <Feather name="flag" size={18} color={colors.warning} />
              <Text style={styles.menuText}>Report this member</Text>
            </Pressable>
            <Pressable testID="menu-block" style={styles.menuRow} onPress={blockUser}>
              <Feather name="slash" size={18} color={colors.error} />
              <Text style={[styles.menuText, { color: colors.error }]}>Block this member</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Report reasons */}
      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <View style={styles.menuOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReportOpen(false)} />
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.reportTitle}>Why are you reporting?</Text>
            {REASONS.map((r) => (
              <Pressable key={r} testID={`report-${r}`} style={styles.reasonRow} onPress={() => submitReport(r)}>
                <Text style={styles.reasonText}>{r}</Text>
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      <ImageViewer
        uri={viewerUri}
        visible={!!viewerUri}
        onClose={() => setViewerUri(undefined)}
        onSave={() => { setViewerUri(undefined); setSaveOpen(true); }}
      />
      <SavePhotoSheet visible={saveOpen} imagePath={savePath} onClose={() => setSaveOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  row: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", padding: spacing.md, borderRadius: radius.lg },
  imgBubble: { padding: spacing.xs },
  msgImage: { width: 200, height: 200, borderRadius: radius.md },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: radius.sm },
  otherB: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.sm },
  bubbleText: { fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, lineHeight: 21 },
  receiptRow: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-end", marginTop: 3 },
  receiptText: { fontFamily: fonts.text, fontSize: 10, color: "rgba(255,255,255,0.75)", fontWeight: "600" },
  emptyWrap: { alignItems: "center", paddingTop: spacing["3xl"], gap: spacing.sm },
  emptyEmoji: { fontSize: 40 },
  emptyText: { fontFamily: fonts.text, color: colors.muted },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surfaceSecondary },
  attachBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  input: { flex: 1, maxHeight: 110, minHeight: 46, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  menuOverlay: { flex: 1, backgroundColor: "rgba(42,54,46,0.5)", justifyContent: "flex-end" },
  menuSheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.sm },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  menuText: { fontFamily: fonts.text, fontSize: 16, fontWeight: "600", color: colors.onSurface },
  reportTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, marginBottom: spacing.sm },
  reasonRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  reasonText: { fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
});
