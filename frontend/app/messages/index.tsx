import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Conv = { other_id: string; name: string; picture?: string; last_text: string; last_at: string; unread: number };
type Member = { user_id: string; name: string; picture?: string; role: string; allow_messages: boolean };

function Avatar({ name, picture, size = 48 }: { name?: string; picture?: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {picture ? (
        <Image source={{ uri: picture }} style={{ width: size, height: size }} />
      ) : (
        <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{(name || "?")[0].toUpperCase()}</Text>
      )}
    </View>
  );
}

export default function Messages() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await apiFetch<{ conversations: Conv[] }>("/conversations");
      setConvs(c.conversations);
      const m = await apiFetch<{ members: Member[] }>("/members");
      setMembers(m.members);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const startedIds = new Set(convs.map((c) => c.other_id));
  const newMembers = members.filter((m) => !startedIds.has(m.user_id));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-messages" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Messages 💬</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={convs}
        keyExtractor={(i) => i.other_id}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brand} />
        }
        ListHeaderComponent={
          convs.length > 0 ? <Text style={styles.sectionLabel}>Conversations</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`conversation-${item.other_id}`}
            style={styles.convRow}
            onPress={() => router.push(`/messages/${item.other_id}`)}
          >
            <Avatar name={item.name} picture={item.picture} />
            <View style={{ flex: 1 }}>
              <Text style={styles.convName}>{item.name}</Text>
              <Text style={styles.convLast} numberOfLines={1}>{item.last_text}</Text>
            </View>
            {item.unread > 0 && (
              <View style={styles.unread}><Text style={styles.unreadText}>{item.unread}</Text></View>
            )}
          </Pressable>
        )}
        ListFooterComponent={
          <View>
            <Text style={styles.sectionLabel}>Start a new chat</Text>
            {newMembers.length === 0 ? (
              <Text style={styles.empty}>No other members yet — invite friends! 🌱</Text>
            ) : (
              newMembers.map((m) => (
                <Pressable
                  key={m.user_id}
                  testID={`member-${m.user_id}`}
                  style={styles.convRow}
                  disabled={!m.allow_messages}
                  onPress={() => router.push(`/messages/${m.user_id}`)}
                >
                  <Avatar name={m.name} picture={m.picture} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.convName}>{m.name}</Text>
                    <Text style={styles.convLast}>{m.role === "contractor" ? "Contractor 🛠️" : "Garden Owner"}</Text>
                  </View>
                  {m.allow_messages ? (
                    <Feather name="message-circle" size={20} color={colors.brand} />
                  ) : (
                    <View style={styles.optOut}>
                      <Feather name="slash" size={12} color={colors.muted} />
                      <Text style={styles.optOutText}>Off</Text>
                    </View>
                  )}
                </Pressable>
              ))
            )}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  sectionLabel: { fontFamily: fonts.text, fontWeight: "800", color: colors.muted, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  convRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  avatar: { backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { color: "#fff", fontFamily: fonts.display },
  convName: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 15 },
  convLast: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  unreadText: { color: "#fff", fontFamily: fonts.text, fontWeight: "800", fontSize: 11 },
  optOut: { flexDirection: "row", alignItems: "center", gap: 3 },
  optOutText: { fontFamily: fonts.text, color: colors.muted, fontSize: 11 },
  empty: { fontFamily: fonts.text, color: colors.muted, paddingHorizontal: spacing.lg },
});
