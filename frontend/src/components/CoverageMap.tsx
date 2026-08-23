import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Circle, Line, G, Text as SvgText } from "react-native-svg";
import { colors, spacing, fonts, radius } from "@/src/theme";

type C = { name: string; lat?: number | null; lng?: number | null; coverage_miles?: number; distance_km?: number | null; reachable?: boolean };

const SIZE = 300;
const CENTER = SIZE / 2;
const PAD = 30;

export default function CoverageMap({ me, contractors }: { me: { lat: number; lng: number } | null; contractors: C[] }) {
  if (!me) return null;
  const pts = contractors.filter((c) => c.lat != null && c.lng != null);
  const cosLat = Math.cos((me.lat * Math.PI) / 180);

  const rel = pts.map((c) => {
    const dx = ((c.lng as number) - me.lng) * 111.32 * cosLat;
    const dy = ((c.lat as number) - me.lat) * 110.57;
    const dist = c.distance_km ?? Math.sqrt(dx * dx + dy * dy);
    return { c, dx, dy, dist };
  });

  const maxDist = Math.max(1, ...rel.map((r) => r.dist));
  const scale = (CENTER - PAD) / maxDist; // px per km

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE}>
        {/* range rings */}
        {[0.25, 0.5, 0.75, 1].map((f, i) => (
          <Circle key={i} cx={CENTER} cy={CENTER} r={(CENTER - PAD) * f} stroke={colors.divider} strokeWidth={1} fill="none" strokeDasharray="4 4" />
        ))}
        <Line x1={CENTER} y1={PAD} x2={CENTER} y2={SIZE - PAD} stroke={colors.divider} strokeWidth={1} />
        <Line x1={PAD} y1={CENTER} x2={SIZE - PAD} y2={CENTER} stroke={colors.divider} strokeWidth={1} />

        {/* contractor coverage rings + pins */}
        {rel.map((r, i) => {
          const px = CENTER + r.dx * scale;
          const py = CENTER - r.dy * scale;
          const coverageKm = (r.c.coverage_miles ?? 25) * 1.60934;
          const cr = Math.max(6, coverageKm * scale);
          const reach = r.c.reachable;
          const stroke = reach ? colors.success : colors.muted;
          const fill = reach ? "rgba(89,138,102,0.12)" : "rgba(122,133,124,0.08)";
          return (
            <G key={i}>
              <Circle cx={px} cy={py} r={cr} stroke={stroke} strokeWidth={1.5} fill={fill} />
              <Circle cx={px} cy={py} r={5} fill={reach ? colors.success : colors.muted} />
            </G>
          );
        })}

        {/* you */}
        <Circle cx={CENTER} cy={CENTER} r={8} fill={colors.error} stroke="#fff" strokeWidth={2} />
        <SvgText x={CENTER} y={CENTER - 14} fontSize={11} fill={colors.onSurface} textAnchor="middle" fontWeight="700">You</SvgText>
      </Svg>
      <Text style={styles.caption}>
        Rings show each pro's travel radius — green rings reach you 🌿
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.lg },
  caption: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, marginTop: spacing.sm, textAlign: "center", paddingHorizontal: spacing.lg },
});
