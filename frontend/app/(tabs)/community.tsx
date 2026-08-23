import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  TextInput,
  ScrollView,
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

type Comment = { id: string; author_name: string; author_picture?: string; text: string; created_at: string };
type Post = {
  id: string;
  author_name: string;
  author_picture?: string;
  caption: string;
  image_path?: string;
  likes: number;
  reactions?: Record<string, number>;
  comments?: Comment[];
  created_at: string;
};

const REACTIONS = ["❤️", "🌿", "😍", "👏", "🐝"];

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
  const [activePost, setActivePost] = useState<Post | null>(null);
  const [commentText, setCommentText] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ posts: Post[] }>("/wall");
      setPosts(r.posts);
      setActivePost((prev) => (prev ? r.posts.find((p) => p.id === prev.id) || prev : prev));
    } catch {}
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const react = async (id: string, emoji: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPosts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, reactions: { ...(p.reactions || {}), [emoji]: ((p.reactions || {})[emoji] || 0) + 1 } } : p
      )
    );
    try {
      await apiFetch(`/wall/${id}/react`, { method: "POST", body: { emoji } });
    } catch {}
  };

  const addComment = async () => {
    if (!activePost || !commentText.trim()) return;
    const text = commentText.trim();
    setCommentText("");
    try {
      const r = await apiFetch<{ post: Post }>(`/wall/${activePost.id}/comment`, { method: "POST", body: { text } });
      setActivePost(r.post);
      setPosts((prev) => prev.map((p) => (p.id === r.post.id ? r.post : p)));
    } catch (e: any) {
      toast.show(e.message || "Failed to comment", "error");
    }
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
              <View style={styles.reactionBar}>
                {REACTIONS.map((e) => {
                  const count = item.reactions?.[e] || 0;
                  return (
                    <Pressable key={e} testID={`react-${item.id}-${e}`} style={styles.reactBtn} onPress={() => react(item.id, e)}>
                      <Text style={styles.reactEmoji}>{e}</Text>
                      {count > 0 && <Text style={styles.reactCount}>{count}</Text>}
                    </Pressable>
                  );
                })}
                <Pressable testID={`comments-${item.id}`} style={styles.commentBtn} onPress={() => setActivePost(item)}>
                  <Feather name="message-circle" size={16} color={colors.brand} />
                  <Text style={styles.commentBtnText}>{item.comments?.length || 0}</Text>
                </Pressable>
              </View>
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

      {/* Comments modal */}
      <Modal visible={!!activePost} transparent animationType="slide" onRequestClose={() => setActivePost(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setActivePost(null)} />
          <View style={[styles.commentSheet, { paddingBottom: insets.bottom + spacing.sm }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Comments 💬</Text>
            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {(activePost?.comments || []).length === 0 ? (
                <Text style={styles.noComments}>No comments yet — be the first! 🌸</Text>
              ) : (
                (activePost?.comments || []).map((c) => (
                  <View key={c.id} style={styles.commentItem} testID={`comment-${c.id}`}>
                    <View style={styles.cAvatar}><Text style={styles.cAvatarText}>{(c.author_name || "?")[0].toUpperCase()}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cName}>{c.author_name}</Text>
                      <Text style={styles.cText}>{c.text}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.emojiRow}>
              {REACTIONS.map((e) => (
                <Pressable key={e} testID={`emoji-insert-${e}`} onPress={() => setCommentText((t) => t + e)}>
                  <Text style={styles.emojiInsert}>{e}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.commentInputRow}>
              <TextInput
                testID="comment-input"
                style={styles.commentInput}
                placeholder="Add a comment..."
                placeholderTextColor={colors.muted}
                value={commentText}
                onChangeText={setCommentText}
                multiline
              />
              <Pressable testID="send-comment" style={styles.commentSend} onPress={addComment}>
                <Feather name="send" size={18} color="#fff" />
              </Pressable>
            </View>
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
  reactionBar: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap", marginTop: spacing.xs },
  reactBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 9 },
  reactEmoji: { fontSize: 15 },
  reactCount: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurfaceTertiary, fontSize: 12 },
  commentBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto", backgroundColor: "#EFF4EE", borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 10 },
  commentBtnText: { fontFamily: fonts.text, fontWeight: "700", color: colors.brand, fontSize: 12 },
  commentSheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  noComments: { fontFamily: fonts.text, color: colors.muted, paddingVertical: spacing.lg, textAlign: "center" },
  commentItem: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm },
  cAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" },
  cAvatarText: { color: "#fff", fontFamily: fonts.text, fontWeight: "800", fontSize: 13 },
  cName: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 13 },
  cText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 19 },
  emojiRow: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.xs },
  emojiInsert: { fontSize: 22 },
  commentInputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  commentInput: { flex: 1, maxHeight: 100, minHeight: 46, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  commentSend: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
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
