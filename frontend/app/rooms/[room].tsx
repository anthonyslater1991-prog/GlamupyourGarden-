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
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Msg = { id: string; sender_id: string; sender_name: string; sender_picture?: string; text: string; image_path?: string; created_at: string };

const ROOM_NAMES: Record<string, string> = { general: "General 🌿", design: "Design 🎨", plants: "Plants 🌸", help: "Help 🆘" };
const REASONS = ["Spam or scam", "Harassment or bullying", "Inappropriate content", "Other"];

export default function RoomChat() {
  const { room } = useLocalSearchParams<{ room: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const listRef = useRef<FlatList>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [target, setTarget] = useState<Msg | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ messages: Msg[] }>(`/rooms/${room}/messages`);
      setMessages(r.messages);
    } catch {}
  }, [room]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    try {
      await apiFetch(`/rooms/${room}/messages`, { method: "POST", body: { text } });
      load();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } catch {}
  };

  const sendPhoto = async () => {
    const uri = await pickFromLibrary();
    if (!uri) return;
    setUploading(true);
    try {
      const path = await uploadImage(uri);
      await apiFetch(`/rooms/${room}/messages`, { method: "POST", body: { text: "", image_path: path } });
      load();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e: any) {
      toast.show(e.message || "Failed to send photo", "error");
    } finally {
      setUploading(false);
    }
  };

  const blockSender = async () => {
    if (!target) return;
    const id = target.sender_id;
    setTarget(null);
    try {
      await apiFetch("/block", { method: "POST", body: { user_id: id } });
      toast.show("Member blocked — you won't see their messages 🔒", "success");
      load();
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  const submitReport = async (reason: string) => {
    if (!target) return;
    try {
      await apiFetch("/report", { method: "POST", body: { reported_id: target.sender_id, reason, context: `room:${room}` } });
      setReportOpen(false);
      setTarget(null);
      toast.show("Report sent. Thank you 💚", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-room" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{ROOM_NAMES[room!] || "Room"}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>🌱</Text>
              <Text style={styles.emptyText}>No messages yet. Be the first to say hello!</Text>
            </View>
          }
          renderItem={({ item }) => {
            const mine = item.sender_id === user?.user_id;
            return (
              <Pressable
                testID={`room-msg-${item.id}`}
                onLongPress={() => { if (!mine) setTarget(item); }}
                style={[styles.msgRow, mine && { flexDirection: "row-reverse" }]}
              >
                <View style={styles.avatar}>
                  {item.sender_picture ? (
                    <Image source={{ uri: item.sender_picture }} style={{ width: 30, height: 30 }} />
                  ) : (
                    <Text style={styles.avatarText}>{(item.sender_name || "?")[0].toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1, alignItems: mine ? "flex-end" : "flex-start" }}>
                  {!mine && <Text style={styles.sender}>{item.sender_name}</Text>}
                  <View style={[styles.bubble, mine ? styles.mine : styles.otherB, item.image_path && styles.imgBubble]}>
                    {item.image_path && (
                      <Image source={{ uri: fileUrl(item.image_path) }} style={styles.msgImage} contentFit="cover" />
                    )}
                    {!!item.text && (
                      <Text style={[styles.bubbleText, mine && { color: "#fff" }, item.image_path && { marginTop: spacing.xs }]}>{item.text}</Text>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable testID="room-attach" style={styles.attachBtn} onPress={sendPhoto} disabled={uploading}>
            {uploading ? <ActivityIndicator size="small" color={colors.brand} /> : <Feather name="image" size={22} color={colors.brand} />}
          </Pressable>
          <TextInput
            testID="room-input"
            style={styles.input}
            placeholder="Message the room..."
            placeholderTextColor={colors.muted}
            value={input}
            onChangeText={setInput}
            multiline
          />
          <Pressable testID="room-send" style={styles.sendBtn} onPress={send}>
            <Feather name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Long-press: report / block sender */}
      <Modal visible={!!target && !reportOpen} transparent animationType="fade" onRequestClose={() => setTarget(null)}>
        <Pressable style={styles.menuOverlay} onPress={() => setTarget(null)}>
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.menuHeader}>{target?.sender_name}</Text>
            <Pressable testID="room-report" style={styles.menuRow} onPress={() => setReportOpen(true)}>
              <Feather name="flag" size={18} color={colors.warning} />
              <Text style={styles.menuText}>Report member</Text>
            </Pressable>
            <Pressable testID="room-block" style={styles.menuRow} onPress={blockSender}>
              <Feather name="slash" size={18} color={colors.error} />
              <Text style={[styles.menuText, { color: colors.error }]}>Block member</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <View style={styles.menuOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { setReportOpen(false); setTarget(null); }} />
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.menuHeader}>Why are you reporting?</Text>
            {REASONS.map((r) => (
              <Pressable key={r} testID={`room-report-${r}`} style={styles.reasonRow} onPress={() => submitReport(r)}>
                <Text style={styles.reasonText}>{r}</Text>
                <Feather name="chevron-right" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  msgRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { color: "#fff", fontFamily: fonts.text, fontWeight: "800", fontSize: 13 },
  sender: { fontFamily: fonts.text, fontSize: 11, color: colors.muted, marginBottom: 2, marginLeft: 4 },
  bubble: { maxWidth: "88%", padding: spacing.md, borderRadius: radius.lg },
  imgBubble: { padding: spacing.xs },
  msgImage: { width: 200, height: 200, borderRadius: radius.md },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: radius.sm },
  otherB: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.sm },
  bubbleText: { fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, lineHeight: 21 },
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
  menuHeader: { fontFamily: fonts.display, fontSize: 18, color: colors.onSurface, marginBottom: spacing.xs },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  menuText: { fontFamily: fonts.text, fontSize: 16, fontWeight: "600", color: colors.onSurface },
  reasonRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  reasonText: { fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
});
