import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { apiFetch } from "@/src/lib/api";
import { colors, spacing, radius, fonts } from "@/src/theme";

const APP_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "https://glamupyourgarden.app";

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, logout, setUser } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [allowMsg, setAllowMsg] = useState(user?.allow_messages ?? true);
  const [qrOpen, setQrOpen] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [bio, setBio] = useState(user?.bio || "");
  const [saving, setSaving] = useState(false);

  const toggleMessages = async (v: boolean) => {
    setAllowMsg(v);
    try {
      const r = await apiFetch<{ user: any }>("/auth/profile", { method: "PUT", body: { allow_messages: v } });
      setUser(r.user);
    } catch {}
  };

  const saveBio = async () => {
    setSaving(true);
    try {
      const r = await apiFetch<{ user: any }>("/auth/profile", { method: "PUT", body: { bio } });
      setUser(r.user);
      setBioOpen(false);
      toast.show("Profile updated 🌿", "success");
    } catch (e: any) {
      toast.show(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    await Clipboard.setStringAsync(APP_URL);
    toast.show("App link copied! 🔗", "success");
  };

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.lg }]}>
          <View style={styles.avatar}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{(user?.name || "?")[0].toUpperCase()}</Text>
            )}
          </View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          <View style={styles.tierPill}>
            <Feather name="star" size={12} color={colors.brandTertiary} />
            <Text style={styles.tierText}>Free Member · {user?.role === "contractor" ? "Contractor" : "Garden Owner"}</Text>
          </View>
          {!!user?.bio && <Text style={styles.bioText}>{user.bio}</Text>}
        </View>

        <View style={styles.section}>
          <Row icon="edit-2" label="Edit bio" onPress={() => setBioOpen(true)} testID="edit-bio" />
          <Row icon="share-2" label="Share app (QR code)" onPress={() => setQrOpen(true)} testID="share-qr" />
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.rowIcon}><Feather name="message-square" size={17} color={colors.brand} /></View>
              <Text style={styles.rowLabel}>Allow member messages</Text>
            </View>
            <Switch
              testID="allow-messages-switch"
              value={allowMsg}
              onValueChange={toggleMessages}
              trackColor={{ true: colors.brand, false: colors.border }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <Text style={styles.groupTitle}>Connect</Text>
        <View style={styles.section}>
          <Row icon="mail" label="Direct Messages" onPress={() => router.push("/messages")} testID="profile-messages" />
          <Row icon="hash" label="Community Rooms" onPress={() => router.push("/rooms")} testID="profile-rooms" />
        </View>

        {user?.role === "admin" && (
          <>
            <Text style={styles.groupTitle}>Admin</Text>
            <View style={styles.section}>
              <Row icon="shield" label="Admin Dashboard" onPress={() => router.push("/admin")} testID="profile-admin" />
            </View>
          </>
        )}

        <Text style={styles.groupTitle}>Legal & Safety</Text>
        <View style={styles.section}>
          <Row icon="file-text" label="Terms & Conditions" onPress={() => toast.show("Terms coming soon", "info")} testID="terms" />
          <Row icon="shield" label="Privacy & Data Protection" onPress={() => toast.show("Privacy policy coming soon", "info")} testID="privacy" />
          <Row icon="lock" label="Chat & Data Safety" onPress={() => toast.show("Your chats are private & protected 🔒", "info")} testID="safety" />
        </View>

        <Pressable testID="logout-button" style={styles.logout} onPress={logout}>
          <Feather name="log-out" size={18} color={colors.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
        <Text style={styles.version}>Glam up your Garden 🌿 v1.0</Text>
      </ScrollView>

      {/* QR modal */}
      <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.qrCard}>
            <Pressable style={styles.qrClose} onPress={() => setQrOpen(false)}>
              <Feather name="x" size={20} color={colors.muted} />
            </Pressable>
            <Text style={styles.qrTitle}>Save the app 📱</Text>
            <Text style={styles.qrSub}>Scan to open, or copy the link to share</Text>
            <View style={styles.qrBox}>
              <QRCode value={APP_URL} size={190} color={colors.onSurface} backgroundColor="#fff" />
            </View>
            <Pressable testID="copy-link-button" style={styles.copyBtn} onPress={copyLink}>
              <Feather name="copy" size={16} color="#fff" />
              <Text style={styles.copyText}>Copy link</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Bio modal */}
      <Modal visible={bioOpen} transparent animationType="slide" onRequestClose={() => setBioOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.bioRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setBioOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.qrTitle}>Edit bio</Text>
            <TextInput
              testID="bio-input"
              style={styles.bioInput}
              placeholder="Tell the community about your garden dreams 🌸"
              placeholderTextColor={colors.muted}
              value={bio}
              onChangeText={setBio}
              multiline
            />
            <Pressable testID="save-bio-button" style={styles.copyBtn} onPress={saveBio} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.copyText}>Save</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Row({ icon, label, onPress, testID }: any) {
  return (
    <Pressable style={styles.row} onPress={onPress} testID={testID}>
      <View style={styles.rowLeft}>
        <View style={styles.rowIcon}><Feather name={icon} size={17} color={colors.brand} /></View>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { alignItems: "center", paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  avatar: { width: 88, height: 88, borderRadius: radius.pill, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImg: { width: 88, height: 88 },
  avatarText: { color: "#fff", fontFamily: fonts.display, fontSize: 36 },
  name: { fontFamily: fonts.display, fontSize: 24, color: colors.onSurface, marginTop: spacing.md },
  email: { fontFamily: fonts.text, color: colors.muted, fontSize: 14 },
  tierPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FBF3E2",
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  tierText: { fontFamily: fonts.text, fontWeight: "700", color: colors.onBrandTertiary, fontSize: 12 },
  bioText: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, textAlign: "center", marginTop: spacing.md, lineHeight: 20 },
  groupTitle: { fontFamily: fonts.text, fontWeight: "800", color: colors.muted, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", marginLeft: spacing.xl, marginTop: spacing.xl, marginBottom: spacing.sm },
  section: { backgroundColor: colors.surfaceSecondary, marginHorizontal: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: "#EFF4EE", alignItems: "center", justifyContent: "center" },
  rowLabel: { fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, fontWeight: "600" },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xl },
  logoutText: { fontFamily: fonts.text, color: colors.error, fontWeight: "700", fontSize: 15 },
  version: { fontFamily: fonts.text, color: colors.muted, textAlign: "center", marginTop: spacing.md, fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(42,54,46,0.55)", justifyContent: "center", padding: spacing.xl },
  qrCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", gap: spacing.md },
  qrClose: { position: "absolute", top: spacing.md, right: spacing.md, padding: 4 },
  qrTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.onSurface },
  qrSub: { fontFamily: fonts.text, color: colors.muted, textAlign: "center" },
  qrBox: { padding: spacing.lg, backgroundColor: "#fff", borderRadius: radius.md },
  copyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.brand, height: 50, borderRadius: radius.md, paddingHorizontal: spacing.xl, alignSelf: "stretch" },
  copyText: { color: "#fff", fontFamily: fonts.text, fontWeight: "700", fontSize: 15 },
  bioRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(42,54,46,0.5)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  sheetHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: "center" },
  bioInput: { minHeight: 90, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface, textAlignVertical: "top" },
});
