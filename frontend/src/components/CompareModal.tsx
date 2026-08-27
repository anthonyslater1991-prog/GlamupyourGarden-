import React from "react";
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { colors, spacing, radius, fonts } from "@/src/theme";

export type CompareItem = { uri?: string; label: string; caption?: string };
export type Segment = { key: string; label: string };

export default function CompareModal({
  visible,
  onClose,
  title = "Compare",
  left,
  right,
  segments,
  activeSegment,
  onSegment,
  onShare,
  sharing,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  left: CompareItem;
  right: CompareItem;
  segments?: Segment[];
  activeSegment?: string;
  onSegment?: (key: string) => void;
  onShare?: () => void;
  sharing?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {onShare && (
            <Pressable testID="compare-share" style={styles.shareBtn} onPress={onShare} disabled={sharing} hitSlop={8}>
              {sharing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="share-2" size={15} color="#fff" />
                  <Text style={styles.shareBtnText}>Share</Text>
                </>
              )}
            </Pressable>
          )}
          <Pressable testID="compare-close" style={styles.closeBtn} onPress={onClose} hitSlop={10}>
            <Feather name="x" size={22} color="#fff" />
          </Pressable>
        </View>

        {segments && segments.length > 1 && (
          <View style={styles.segmentRow}>
            {segments.map((s) => {
              const on = s.key === activeSegment;
              return (
                <Pressable
                  key={s.key}
                  testID={`compare-seg-${s.key}`}
                  style={[styles.segment, on && styles.segmentOn]}
                  onPress={() => onSegment?.(s.key)}
                >
                  <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.pair}>
          <CompareCol item={left} testID="compare-left" />
          <View style={styles.vs}><Text style={styles.vsText}>vs</Text></View>
          <CompareCol item={right} testID="compare-right" />
        </View>
      </View>
    </Modal>
  );
}

function CompareCol({ item, testID }: { item: CompareItem; testID: string }) {
  return (
    <View style={styles.col} testID={testID}>
      <View style={styles.labelPill}>
        <Text style={styles.labelText} numberOfLines={1}>{item.label}</Text>
      </View>
      <View style={styles.imgWrap}>
        {item.uri ? (
          <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.imgPlaceholder]}>
            <Feather name="image" size={30} color="rgba(255,255,255,0.5)" />
          </View>
        )}
      </View>
      {!!item.caption && (
        <ScrollView style={styles.captionBox} contentContainerStyle={{ padding: spacing.sm }}>
          <Text style={styles.captionText}>{item.caption}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#1B241E", paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 20, color: "#fff" },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: spacing.md, marginRight: spacing.sm, minWidth: 44, minHeight: 36, justifyContent: "center" },
  shareBtnText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 13 },
  segmentRow: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: radius.pill, padding: 4, marginVertical: spacing.sm, alignSelf: "center" },
  segment: { paddingVertical: 8, paddingHorizontal: spacing.lg, borderRadius: radius.pill },
  segmentOn: { backgroundColor: colors.brand },
  segmentText: { fontFamily: fonts.text, fontWeight: "700", color: "rgba(255,255,255,0.7)", fontSize: 13 },
  segmentTextOn: { color: "#fff" },
  pair: { flex: 1, flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm, alignItems: "stretch" },
  col: { flex: 1 },
  vs: { width: 24, alignItems: "center", justifyContent: "center" },
  vsText: { fontFamily: fonts.display, color: "rgba(255,255,255,0.6)", fontSize: 14 },
  labelPill: { alignSelf: "center", backgroundColor: "rgba(255,255,255,0.12)", paddingVertical: 5, paddingHorizontal: spacing.md, borderRadius: radius.pill, marginBottom: spacing.sm },
  labelText: { fontFamily: fonts.text, fontWeight: "800", color: "#fff", fontSize: 12, letterSpacing: 0.5 },
  imgWrap: { flex: 1, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#0F150F", minHeight: 180 },
  imgPlaceholder: { alignItems: "center", justifyContent: "center" },
  captionBox: { maxHeight: 96, marginTop: spacing.sm, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radius.sm },
  captionText: { fontFamily: fonts.text, color: "rgba(255,255,255,0.8)", fontSize: 11, lineHeight: 16 },
});
