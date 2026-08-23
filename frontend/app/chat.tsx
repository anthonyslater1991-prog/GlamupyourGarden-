import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { storage } from "@/src/utils/storage";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Msg = { role: "user" | "assistant"; text: string; id?: string };

const SUGGESTIONS = [
  "How do I attract more bees? 🐝",
  "Best low-maintenance plants?",
  "Ideas for a small patio",
  "When should I prune roses?",
];

export default function Chat() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const listRef = useRef<FlatList>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [products, setProducts] = useState<string[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const suggestProducts = async () => {
    setLoadingProducts(true);
    try {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const r = await apiFetch<{ products: string[] }>("/assistant/products", {
        method: "POST",
        body: { prompt: lastUser?.text || "" },
      });
      setProducts(r.products);
    } catch {
      toast.show("Couldn't fetch ideas, try again", "error");
    } finally {
      setLoadingProducts(false);
    }
  };

  const addToWishlist = async (name: string) => {
    const pending = (await storage.getItem<string[]>("glam_pending_wishlist", [])) || [];
    if (!pending.includes(name)) pending.push(name);
    await storage.setItem("glam_pending_wishlist", pending);
    setProducts((prev) => prev.filter((p) => p !== name));
    toast.show(`Added "${name}" — open a project to use it 🛍️`, "success");
  };

  useEffect(() => {
    (async () => {
      let sid = await storage.getItem<string>("glam_chat_session", "");
      if (!sid) {
        sid = `chat_${Date.now()}`;
        await storage.setItem("glam_chat_session", sid);
      }
      setSessionId(sid);
      try {
        const r = await apiFetch<{ messages: Msg[] }>(`/chat/${sid}`);
        setMessages(r.messages);
      } catch {}
    })();
  }, []);

  const send = async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!text || !sessionId || sending) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setSending(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const r = await apiFetch<{ reply: string }>("/chat", {
        method: "POST",
        body: { session_id: sessionId, message: text },
      });
      setMessages((prev) => [...prev, { role: "assistant", text: r.reply }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Sorry, I couldn't respond. Please try again. 🌱" }]);
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="close-chat" style={styles.close} onPress={() => router.back()}>
          <Feather name="chevron-down" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>🌿 Bloom</Text>
          <Text style={styles.headerSub}>Your AI Garden Assistant</Text>
        </View>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
        style={{ flex: 1 }}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            messages.length === 0 ? (
              <View style={styles.welcome}>
                <Text style={styles.welcomeEmoji}>🌸</Text>
                <Text style={styles.welcomeTitle}>{"Hi, I'm Bloom!"}</Text>
                <Text style={styles.welcomeText}>Ask me anything about your garden — plants, design, or your project ideas.</Text>
                <View style={styles.suggWrap}>
                  {SUGGESTIONS.map((s) => (
                    <Pressable key={s} testID={`suggestion-${s}`} style={styles.sugg} onPress={() => send(s)}>
                      <Text style={styles.suggText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.bubbleRow, item.role === "user" ? styles.userRow : styles.botRow]}>
              <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.botBubble]}>
                <Text style={[styles.bubbleText, item.role === "user" && { color: "#fff" }]}>{item.text}</Text>
              </View>
            </View>
          )}
          ListFooterComponent={
            sending ? (
              <View style={[styles.bubbleRow, styles.botRow]}>
                <View style={[styles.bubble, styles.botBubble]}>
                  <ActivityIndicator size="small" color={colors.brand} />
                </View>
              </View>
            ) : null
          }
        />

        {products.length > 0 && (
          <View style={styles.prodPanel}>
            <Text style={styles.prodTitle}>Tap to add to your redesign wishlist 🛍️</Text>
            <View style={styles.prodWrap}>
              {products.map((p) => (
                <Pressable key={p} testID={`add-product-${p}`} style={styles.prodChip} onPress={() => addToWishlist(p)}>
                  <Feather name="plus" size={13} color={colors.brand} />
                  <Text style={styles.prodChipText}>{p}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable testID="suggest-products-button" style={styles.ideasBtn} onPress={suggestProducts} disabled={loadingProducts}>
            {loadingProducts ? <ActivityIndicator size="small" color={colors.brand} /> : <Feather name="shopping-bag" size={18} color={colors.brand} />}
          </Pressable>
          <TextInput
            testID="chat-input"
            style={styles.input}
            placeholder="Ask Bloom anything... 🌱"
            placeholderTextColor={colors.muted}
            value={input}
            onChangeText={setInput}
            multiline
            onSubmitEditing={() => send()}
          />
          <Pressable testID="send-button" style={styles.sendBtn} onPress={() => send()} disabled={sending}>
            <Feather name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter: { alignItems: "center" },
  headerTitle: { fontFamily: fonts.display, fontSize: 20, color: "#fff" },
  headerSub: { fontFamily: fonts.text, color: "rgba(255,255,255,0.9)", fontSize: 12 },
  welcome: { alignItems: "center", padding: spacing.lg, gap: spacing.sm },
  welcomeEmoji: { fontSize: 42 },
  welcomeTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.onSurface },
  welcomeText: { fontFamily: fonts.text, color: colors.muted, textAlign: "center", lineHeight: 21 },
  suggWrap: { gap: spacing.sm, marginTop: spacing.md, alignSelf: "stretch" },
  sugg: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  suggText: { fontFamily: fonts.text, color: colors.onSurface, fontWeight: "600" },
  bubbleRow: { flexDirection: "row" },
  userRow: { justifyContent: "flex-end" },
  botRow: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", padding: spacing.md, borderRadius: radius.lg },
  userBubble: { backgroundColor: colors.brand, borderBottomRightRadius: radius.sm },
  botBubble: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: radius.sm },
  bubbleText: { fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, lineHeight: 21 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surfaceSecondary },
  ideasBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  prodPanel: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  prodTitle: { fontFamily: fonts.text, fontWeight: "700", color: colors.muted, fontSize: 12 },
  prodWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  prodChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EFF4EE", borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: spacing.md },
  prodChipText: { fontFamily: fonts.text, fontWeight: "600", color: colors.brand, fontSize: 13 },
  input: { flex: 1, maxHeight: 110, minHeight: 46, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
});
