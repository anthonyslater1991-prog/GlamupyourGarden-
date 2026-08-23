import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, FlatList, Platform } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Msg = { id: string; sender_id: string; recipient_id: string; text: string; created_at: string };

export default function DMThread() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const listRef = useRef<FlatList>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [other, setOther] = useState<{ name?: string } | null>(null);
  const [input, setInput] = useState("");
  const [blocked, setBlocked] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ messages: Msg[]; other: any }>(`/messages/${userId}`);
      setMessages(r.messages);
      setOther(r.other);
    } catch {}
  }, [userId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((prev) => [...prev, { id: `tmp_${Date.now()}`, sender_id: user!.user_id, recipient_id: userId!, text, created_at: new Date().toISOString() }]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      await apiFetch("/messages", { method: "POST", body: { recipient_id: userId, text } });
      load();
    } catch (e: any) {
      if (e.message?.includes("turned off")) {
        setBlocked(true);
        toast.show("This member has messages turned off 🔒", "error");
      } else {
        toast.show(e.message || "Failed to send", "error");
      }
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-dm" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>{other?.name || "Chat"}</Text>
        <View style={{ width: 40 }} />
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
                <View style={[styles.bubble, mine ? styles.mine : styles.otherB]}>
                  <Text style={[styles.bubbleText, mine && { color: "#fff" }]}>{item.text}</Text>
                </View>
              </View>
            );
          }}
        />
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
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
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: radius.sm },
  otherB: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.sm },
  bubbleText: { fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, lineHeight: 21 },
  emptyWrap: { alignItems: "center", paddingTop: spacing["3xl"], gap: spacing.sm },
  emptyEmoji: { fontSize: 40 },
  emptyText: { fontFamily: fonts.text, color: colors.muted },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surfaceSecondary },
  input: { flex: 1, maxHeight: 110, minHeight: 46, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
});
