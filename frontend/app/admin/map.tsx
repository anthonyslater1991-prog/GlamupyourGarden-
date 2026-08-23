import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { apiFetch } from "@/src/lib/api";
import { useAuth } from "@/src/context/AuthContext";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Person = { name: string; postcode?: string; phone?: string; lat?: number | null; project_count?: number };

export default function AdminMap() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<{ customers: Person[]; contractors: Person[]; map_url: string | null } | null>(null);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") router.replace("/(tabs)");
  }, [user]);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<any>("/admin/map");
      setData(r);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="back-admin-map" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Location Map 🗺️</Text>
        <View style={{ width: 40 }} />
      </View>

      {!data ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.mapWrap}>
            {data.map_url && !mapError ? (
              <Image testID="admin-map-image" source={{ uri: data.map_url }} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setMapError(true)} />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.fallback]}>
                <Feather name="map" size={40} color={colors.brandSecondary} />
                <Text style={styles.fallbackText}>Map preview unavailable — lists shown below</Text>
              </View>
            )}
          </View>
          <View style={styles.legendRow}>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.error }]} /><Text style={styles.legendText}>Customers ({data.customers.length})</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: colors.success }]} /><Text style={styles.legendText}>Contractors ({data.contractors.length})</Text></View>
          </View>

          <Text style={styles.sectionTitle}>Customers with projects</Text>
          {data.customers.map((c, i) => (
            <View key={i} style={styles.row} testID={`admin-map-customer-${i}`}>
              <View style={[styles.pin, { backgroundColor: colors.error }]}><Feather name="user" size={14} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.name}</Text>
                <Text style={styles.meta}>{c.postcode || "No postcode"} · {c.project_count} project{c.project_count === 1 ? "" : "s"}</Text>
              </View>
              {c.lat == null && <Text style={styles.noGeo}>no location</Text>}
            </View>
          ))}
          {data.customers.length === 0 && <Text style={styles.empty}>No customer projects yet.</Text>}

          <Text style={styles.sectionTitle}>Contractors</Text>
          {data.contractors.map((c, i) => (
            <View key={i} style={styles.row} testID={`admin-map-contractor-${i}`}>
              <View style={[styles.pin, { backgroundColor: colors.success }]}><Feather name="tool" size={14} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.name}</Text>
                <Text style={styles.meta}>{c.postcode || "No postcode"}</Text>
              </View>
            </View>
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
  headerTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface },
  mapWrap: { height: 260, marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceTertiary },
  fallback: { alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  fallbackText: { fontFamily: fonts.text, color: colors.muted, textAlign: "center" },
  legendRow: { flexDirection: "row", gap: spacing.lg, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  sectionTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.onSurface, paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, marginHorizontal: spacing.lg, marginBottom: spacing.sm, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  pin: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  name: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  meta: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  noGeo: { fontFamily: fonts.text, color: colors.warning, fontSize: 11 },
  empty: { fontFamily: fonts.text, color: colors.muted, paddingHorizontal: spacing.lg },
});
