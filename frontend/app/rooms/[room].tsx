import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, FlatList, Platform } from "react-native";
import { Image } from "expo-image";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Msg = { id: string; sender_id: string; sender_name: string; sender_picture?: string; text: string; created_at: string };

const ROOM_NAMES: Record<string, string> = { general: "General 🌿", design: "Design 🎨", plants: "Plants 🌸", help: "Help 🆘" };

export default function RoomChat() {
  const { room } = useLocalSearchParams<{ room: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const listRef = useRef<FlatList>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");

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
              <View style={[styles.msgRow, mine && { flexDirection: "row-reverse" }]}>
                <View style={styles.avatar}>
                  {item.sender_picture ? (
                    <Image source={{ uri: item.sender_picture }} style={{ width: 30, height: 30 }} />
                  ) : (
                    <Text style={styles.avatarText}>{(item.sender_name || "?")[0].toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1, alignItems: mine ? "flex-end" : "flex-start" }}>
                  {!mine && <Text style={styles.sender}>{item.sender_name}</Text>}
                  <View style={[styles.bubble, mine ? styles.mine : styles.otherB]}>
                    <Text style={[styles.bubbleText, mine && { color: "#fff" }]}>{item.text}</Text>
                  </View>
                </View>
              </View>
            );
          }}
        />
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
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
