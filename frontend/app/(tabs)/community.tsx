import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  TextInput,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { apiFetch, fileUrl } from "@/src/lib/api";
import { uploadImage, pickFromLibrary } from "@/src/lib/upload";
import { useToast } from "@/src/components/Toast";
import ChatFab from "@/src/components/ChatFab";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Post = {
  id: string;
  author_name: string;
  author_picture?: string;
  caption: string;
  image_path?: string;
  likes: number;
  created_at: string;
};

export default function Community() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ posts: Post[] }>("/wall");
      setPosts(r.posts);
    } catch {}
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const like = async (id: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, likes: p.likes + 1 } : p)));
    try {
      await apiFetch(`/wall/${id}/like`, { method: "POST" });
    } catch {}
  };

  const pickImage = async () => {
    const uri = await pickFromLibrary();
    if (uri) setImageUri(uri);
  };

  const submit = async () => {
    if (!caption.trim()) {
      toast.show("Add a caption first 🌸", "error");
      return;
    }
    setPosting(true);
    try {
      let path: string | undefined;
      if (imageUri) path = await uploadImage(imageUri);
      const r = await apiFetch<{ post: Post }>("/wall", {
        method: "POST",
        body: { caption: caption.trim(), image_path: path },
      });
      setPosts((prev) => [r.post, ...prev]);
      setCaption("");
      setImageUri(null);
      setComposerOpen(false);
      toast.show("Shared to the wall! 🌿", "success");
    } catch (e: any) {
      toast.show(e.message || "Failed to post", "error");
    } finally {
      setPosting(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Community Wall 🌻</Text>
          <Text style={styles.subtitle}>Share ideas, get inspired</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable testID="open-rooms" style={styles.headerBtn} onPress={() => router.push("/rooms")}>
            <Feather name="hash" size={20} color={colors.brand} />
          </Pressable>
          <Pressable testID="open-messages" style={styles.headerBtn} onPress={() => router.push("/messages")}>
            <Feather name="mail" size={20} color={colors.brand} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingBottom: 150, paddingHorizontal: spacing.lg, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loaded ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🪑</Text>
              <Text style={styles.emptyTitle}>Quiet in here</Text>
              <Text style={styles.emptyText}>Be the first to share a garden idea!</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const img = fileUrl(item.image_path);
          return (
            <View style={styles.card} testID={`wall-post-${item.id}`}>
              <View style={styles.postHead}>
                <View style={styles.avatar}>
                  {item.author_picture ? (
                    <Image source={{ uri: item.author_picture }} style={styles.avatarImg} />
                  ) : (
                    <Text style={styles.avatarText}>{(item.author_name || "?")[0].toUpperCase()}</Text>
                  )}
                </View>
                <Text style={styles.authorName}>{item.author_name}</Text>
              </View>
              {img && <Image source={{ uri: img }} style={styles.postImg} contentFit="cover" />}
              <Text style={styles.caption}>{item.caption}</Text>
              <Pressable testID={`like-${item.id}`} style={styles.likeRow} onPress={() => like(item.id)}>
                <Feather name="heart" size={17} color={colors.error} />
                <Text style={styles.likeText}>{item.likes}</Text>
              </Pressable>
            </View>
          );
        }}
      />

      <Pressable
        testID="share-to-wall-fab"
        style={[styles.shareFab, { bottom: insets.bottom + 80 }]}
        onPress={() => setComposerOpen(true)}
      >
        <Feather name="edit-3" size={18} color="#fff" />
        <Text style={styles.shareFabText}>Share</Text>
      </Pressable>

      <ChatFab bottom={insets.bottom + 148} />

      <Modal visible={composerOpen} transparent animationType="slide" onRequestClose={() => setComposerOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalRoot}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setComposerOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Share an idea 🌸</Text>
            <TextInput
              testID="wall-caption-input"
              style={styles.captionInput}
              placeholder="What's on your mind about your garden?"
              placeholderTextColor={colors.muted}
              value={caption}
              onChangeText={setCaption}
              multiline
            />
            {imageUri ? (
              <View>
                <Image source={{ uri: imageUri }} style={styles.previewImg} contentFit="cover" />
                <Pressable style={styles.removeImg} onPress={() => setImageUri(null)}>
                  <Feather name="x" size={16} color="#fff" />
                </Pressable>
              </View>
            ) : (
              <Pressable testID="add-photo-button" style={styles.addPhoto} onPress={pickImage}>
                <Feather name="image" size={18} color={colors.brand} />
                <Text style={styles.addPhotoText}>Add a photo (optional)</Text>
              </Pressable>
            )}
            <Pressable testID="submit-post-button" style={styles.postBtn} onPress={submit} disabled={posting}>
              {posting ? <ActivityIndicator color="#fff" /> : <Text style={styles.postBtnText}>Post to Wall</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  headerActions: { flexDirection: "row", gap: spacing.sm },
  headerBtn: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.onSurface },
  subtitle: { fontFamily: fonts.text, color: colors.muted, fontSize: 14 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  postHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  avatar: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImg: { width: 34, height: 34 },
  avatarText: { color: "#fff", fontFamily: fonts.text, fontWeight: "800" },
  authorName: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface },
  postImg: { width: "100%", height: 200, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  caption: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 15, lineHeight: 21 },
  likeRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4 },
  likeText: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurfaceTertiary },
  empty: { alignItems: "center", padding: spacing.xl, marginTop: spacing["3xl"], gap: spacing.sm },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  emptyText: { fontFamily: fonts.text, color: colors.muted },
  shareFab: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    shadowColor: "#2A362E",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  shareFabText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 15 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,54,46,0.5)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center", marginBottom: spacing.xs },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  captionInput: {
    minHeight: 90,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    fontFamily: fonts.text,
    fontSize: 15,
    color: colors.onSurface,
    textAlignVertical: "top",
  },
  addPhoto: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderStyle: "dashed",
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  addPhotoText: { fontFamily: fonts.text, fontWeight: "600", color: colors.brand },
  previewImg: { width: "100%", height: 180, borderRadius: radius.md },
  removeImg: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: radius.pill, padding: 6 },
  postBtn: { backgroundColor: colors.brand, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  postBtnText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 16 },
});
