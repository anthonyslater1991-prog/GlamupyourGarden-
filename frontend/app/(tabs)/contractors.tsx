import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import ChatFab from "@/src/components/ChatFab";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Contractor = {
  id: string;
  name: string;
  tagline: string;
  services: string[];
  phone: string;
  rating: number;
  review_count: number;
  location: string;
  image: string;
  distance_km?: number | null;
};

function Stars({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Feather
          key={i}
          name="star"
          size={13}
          color={colors.brandTertiary}
          style={{ opacity: i <= Math.round(rating) ? 1 : 0.3 }}
        />
      ))}
    </View>
  );
}

export default function Contractors() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Contractor[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ contractors: Contractor[] }>("/map/contractors");
      setItems(r.contractors);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Find a Pro 🛠️</Text>
          <Text style={styles.subtitle}>Trusted local garden contractors</Text>
        </View>
        <Pressable testID="open-map" style={styles.mapBtn} onPress={() => router.push("/map")}>
          <Feather name="map" size={18} color="#fff" />
          <Text style={styles.mapBtnText}>Map</Text>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingBottom: 140, paddingHorizontal: spacing.lg, gap: spacing.md }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={colors.brand}
          />
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`contractor-${item.id}`}
            style={styles.card}
            onPress={() => router.push(`/contractor/${item.id}`)}
          >
            <Image source={{ uri: item.image }} style={styles.avatar} contentFit="cover" />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.tagline} numberOfLines={1}>{item.tagline}</Text>
              <View style={styles.ratingRow}>
                <Stars rating={item.rating} />
                <Text style={styles.ratingText}>
                  {item.rating} · {item.review_count} review{item.review_count === 1 ? "" : "s"}
                </Text>
              </View>
              <View style={styles.locRow}>
                <Feather name="map-pin" size={12} color={colors.muted} />
                <Text style={styles.loc}>{item.location}</Text>
                {item.distance_km != null && (
                  <View style={[styles.distTag, item.distance_km <= 15 && styles.distTagNear]}>
                    <Text style={[styles.distTagText, item.distance_km <= 15 && { color: "#fff" }]}>
                      {item.distance_km <= 15 ? "📍 " : ""}{item.distance_km} km
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <Feather name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        )}
      />
      <ChatFab bottom={insets.bottom + 80} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  mapBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.brand, paddingVertical: 9, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  mapBtnText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 13 },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.onSurface },
  subtitle: { fontFamily: fonts.text, color: colors.muted, fontSize: 14 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  name: { fontFamily: fonts.display, fontSize: 17, color: colors.onSurface },
  tagline: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 },
  ratingText: { fontFamily: fonts.text, fontSize: 12, color: colors.onSurfaceTertiary, fontWeight: "600" },
  locRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  loc: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  distTag: { marginLeft: spacing.sm, backgroundColor: "#EFF4EE", paddingVertical: 2, paddingHorizontal: 8, borderRadius: radius.pill },
  distTagNear: { backgroundColor: colors.brand },
  distTagText: { fontFamily: fonts.text, fontWeight: "800", color: colors.brand, fontSize: 11 },
});
