import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Contractor = { id: string; name: string; tagline: string; postcode?: string; distance_km: number | null; lat?: number; image: string };

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<{ me: any; contractors: Contractor[]; map_url: string | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mapError, setMapError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ me: any; contractors: Contractor[]; map_url: string | null }>("/map/contractors");
      setData(r);
      setMapError(false);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-map" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Contractors near you 📍</Text>
        <View style={{ width: 40 }} />
      </View>

      {!data ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brand} />}
        >
          {/* Map */}
          <View style={styles.mapWrap}>
            {data.map_url && !mapError ? (
              <Image
                testID="map-image"
                source={{ uri: data.map_url }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                onError={() => setMapError(true)}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.mapFallback]}>
                <Feather name="map" size={40} color={colors.brandSecondary} />
                <Text style={styles.mapFallbackText}>Map preview unavailable — distances shown below</Text>
              </View>
            )}
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.error }]} /><Text style={styles.legendText}>You</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.success }]} /><Text style={styles.legendText}>Contractors</Text></View>
          </View>

          {!data.me && (
            <Pressable testID="add-postcode-hint" style={styles.hintCard} onPress={() => router.push("/(tabs)/profile")}>
              <Feather name="alert-circle" size={18} color={colors.warning} />
              <Text style={styles.hintText}>Add your postcode in Profile to see exact distances.</Text>
            </Pressable>
          )}

          <Text style={styles.sectionTitle}>Sorted by distance</Text>
          {data.contractors.map((c) => (
            <Pressable key={c.id} testID={`map-contractor-${c.id}`} style={styles.row} onPress={() => router.push(`/contractor/${c.id}`)}>
              <Image source={{ uri: c.image }} style={styles.avatar} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.name}</Text>
                <Text style={styles.tagline} numberOfLines={1}>{c.tagline}</Text>
              </View>
              {c.distance_km != null ? (
                <View style={[styles.distPill, c.distance_km <= 15 && styles.distNear]}>
                  <Feather name="navigation" size={12} color={c.distance_km <= 15 ? "#fff" : colors.brand} />
                  <Text style={[styles.distText, c.distance_km <= 15 && { color: "#fff" }]}>{c.distance_km} km</Text>
                </View>
              ) : (
                <Text style={styles.noDist}>—</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.onSurface },
  mapWrap: { height: 240, marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  mapFallback: { alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  mapFallbackText: { fontFamily: fonts.text, color: colors.muted, textAlign: "center" },
  legendRow: { flexDirection: "row", gap: spacing.lg, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  hintCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "#FBF3E2", marginHorizontal: spacing.lg, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md },
  hintText: { fontFamily: fonts.text, color: colors.onBrandTertiary, flex: 1, fontSize: 13 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  name: { fontFamily: fonts.display, fontSize: 16, color: colors.onSurface },
  tagline: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  distPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EFF4EE", paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.pill },
  distNear: { backgroundColor: colors.brand },
  distText: { fontFamily: fonts.text, fontWeight: "800", color: colors.brand, fontSize: 12 },
  noDist: { fontFamily: fonts.text, color: colors.muted },
});
