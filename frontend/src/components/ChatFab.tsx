import React from "react";
import { Pressable, StyleSheet, Platform, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { colors, radius } from "@/src/theme";

export default function ChatFab({ bottom = 96 }: { bottom?: number }) {
  const router = useRouter();
  return (
    <Pressable
      testID="ai-assistant-fab"
      onPress={() => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push("/chat");
      }}
      style={[styles.fab, { bottom }]}
    >
      <LinearGradient
        colors={[colors.brandSecondary, colors.brand]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.grad}
      >
        <Feather name="message-circle" size={24} color="#fff" />
        <View style={styles.badge} />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 18,
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    shadowColor: "#2A362E",
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  grad: {
    flex: 1,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 12,
    right: 14,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.brandTertiary,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
});
