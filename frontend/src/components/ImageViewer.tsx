import React from "react";
import { Modal, StyleSheet, Pressable, View, Text, Dimensions } from "react-native";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const { width, height } = Dimensions.get("window");

export default function ImageViewer({ uri, visible, onClose, onSave }: { uri?: string; visible: boolean; onClose: () => void; onSave?: () => void }) {
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const reset = () => {
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(savedScale.value * e.scale, 5));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(2.5);
        savedScale.value = 2.5;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.root}>
        <Pressable testID="close-image-viewer" style={[styles.close, { top: insets.top + 12 }]} onPress={handleClose}>
          <Feather name="x" size={26} color="#fff" />
        </Pressable>
        <GestureDetector gesture={composed}>
          <Animated.View style={[styles.imgWrap, animStyle]}>
            {uri && <Image source={{ uri }} style={styles.img} contentFit="contain" />}
          </Animated.View>
        </GestureDetector>
        <View pointerEvents="box-none" style={[styles.hint, { bottom: insets.bottom + 20 }]}>
          {onSave && (
            <Pressable testID="save-photo-to-project" style={styles.saveBtn} onPress={onSave}>
              <Feather name="bookmark" size={16} color="#fff" />
              <Text style={styles.saveText}>Save to project</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", alignItems: "center", justifyContent: "center" },
  close: { position: "absolute", right: 16, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  imgWrap: { width, height: height * 0.8, alignItems: "center", justifyContent: "center" },
  img: { width, height: height * 0.8 },
  hint: { position: "absolute", alignSelf: "center", alignItems: "center" },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(74,124,89,0.95)", paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999 },
  saveText: { color: "#fff", fontFamily: "Nunito", fontWeight: "700", fontSize: 15 },
});
