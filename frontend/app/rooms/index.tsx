import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Room = { key: string; name: string; emoji: string; desc: string; message_count: number; last_text?: string };

export default function Rooms() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ rooms: Room[] }>("/rooms");
      setRooms(r.rooms);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-rooms" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Community Rooms</Text>
        <View style={{ width: 40 }} />
      </View>
      <Text style={styles.subtitle}>Jump into a live chat with fellow gardeners 🌿</Text>

      <FlatList
        data={rooms}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brand} />}
        renderItem={({ item }) => (
          <Pressable testID={`room-${item.key}`} style={styles.card} onPress={() => router.push(`/rooms/${item.key}`)}>
            <View style={styles.emojiBox}><Text style={styles.emoji}>{item.emoji}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.desc} numberOfLines={1}>{item.last_text || item.desc}</Text>
            </View>
            <View style={styles.countPill}>
              <Feather name="message-square" size={12} color={colors.brand} />
              <Text style={styles.countText}>{item.message_count}</Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  subtitle: { fontFamily: fonts.text, color: colors.muted, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  emojiBox: { width: 50, height: 50, borderRadius: radius.md, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 24 },
  name: { fontFamily: fonts.display, fontSize: 18, color: colors.onSurface },
  desc: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  countPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EFF4EE", paddingVertical: 5, paddingHorizontal: spacing.sm, borderRadius: radius.pill },
  countText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 12 },
});
