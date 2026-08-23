import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Contract = {
  id: string;
  project_title?: string;
  contractor_name: string;
  customer_name: string;
  status: string;
  price: string;
  progress_index: number;
  stages: { label: string }[];
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: colors.muted },
  awaiting_signatures: { label: "Awaiting signatures", color: colors.brandTertiary },
  active: { label: "In progress", color: colors.brand },
  completed: { label: "Completed", color: colors.success },
  cancelled: { label: "Cancelled", color: colors.error },
};

export default function ContractsList() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { loading } = useAuth();
  const [items, setItems] = useState<Contract[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ contracts: Contract[] }>("/contracts");
      setItems(r.contracts);
    } catch {}
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { if (!loading) load(); }, [load, loading]));

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="contracts-back" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>My Agreements 📜</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brand} />}
        ListEmptyComponent={loaded ? (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🤝</Text>
            <Text style={styles.emptyTitle}>No agreements yet</Text>
            <Text style={styles.emptyText}>Open a contractor&apos;s profile and tap Draft an agreement to get started.</Text>
            <Pressable style={styles.emptyBtn} onPress={() => router.push("/(tabs)/contractors")}>
              <Text style={styles.emptyBtnText}>Find a contractor</Text>
            </Pressable>
          </View>
        ) : null}
        renderItem={({ item }) => {
          const meta = STATUS_META[item.status] || STATUS_META.draft;
          const pct = item.stages?.length ? Math.round((item.progress_index / item.stages.length) * 100) : 0;
          return (
            <Pressable testID={`contract-${item.id}`} style={styles.card} onPress={() => router.push(`/contract/${item.id}`)}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.project_title || "Garden project"}</Text>
                <View style={[styles.pill, { backgroundColor: meta.color + "22" }]}>
                  <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
                </View>
              </View>
              <Text style={styles.cardSub}>{item.contractor_name} · {item.customer_name}</Text>
              <Text style={styles.cardPrice}>{item.price}</Text>
              {item.status === "active" || item.status === "completed" ? (
                <View style={styles.barBg}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
              ) : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surfaceSecondary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, textAlign: "center", fontFamily: fonts.display, fontSize: 18, color: colors.onSurface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  cardTitle: { flex: 1, fontFamily: fonts.display, fontSize: 17, color: colors.onSurface },
  pill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.text, fontWeight: "800", fontSize: 11 },
  cardSub: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  cardPrice: { fontFamily: fonts.text, fontWeight: "800", color: colors.brand, fontSize: 15 },
  barBg: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden", marginTop: spacing.xs },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.brand },
  empty: { alignItems: "center", padding: spacing.xl, marginTop: spacing["3xl"], gap: spacing.sm },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  emptyText: { fontFamily: fonts.text, color: colors.muted, textAlign: "center", lineHeight: 21 },
  emptyBtn: { backgroundColor: colors.brand, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, borderRadius: radius.pill, marginTop: spacing.md },
  emptyBtnText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700" },
});
