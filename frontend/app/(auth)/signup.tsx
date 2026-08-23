import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

const ROLES = [
  { key: "customer", label: "Garden Owner", icon: "home", desc: "Redesign my own garden" },
  { key: "contractor", label: "Contractor", icon: "tool", desc: "Offer my services" },
];

export default function Signup() {
  const { register } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [role, setRole] = useState("customer");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !email.trim() || password.length < 6) {
      toast.show("Fill all fields (password 6+ chars)", "error");
      return;
    }
    if (!postcode.trim() || !phone.trim()) {
      toast.show("Please add your postcode and phone number 📍", "error");
      return;
    }
    setBusy(true);
    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        role,
        phone: phone.trim(),
        address: address.trim(),
        postcode: postcode.trim(),
      });
      router.replace("/(tabs)");
    } catch (e: any) {
      toast.show(e.message || "Sign up failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinearGradient colors={[colors.surface, colors.surfaceTertiary]} style={styles.root}>
      <KeyboardAwareScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <Pressable testID="back-button" style={styles.back} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>

        <Text style={styles.emoji}>🌸</Text>
        <Text style={styles.title}>Join the garden</Text>
        <Text style={styles.subtitle}>Create your free account and start glamming up 🌿</Text>

        <View style={styles.card}>
          <View style={styles.inputWrap}>
            <Feather name="user" size={18} color={colors.muted} />
            <TextInput
              testID="signup-name-input"
              style={styles.input}
              placeholder="Full name"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />
          </View>
          <View style={styles.inputWrap}>
            <Feather name="mail" size={18} color={colors.muted} />
            <TextInput
              testID="signup-email-input"
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>
          <View style={styles.inputWrap}>
            <Feather name="lock" size={18} color={colors.muted} />
            <TextInput
              testID="signup-password-input"
              style={styles.input}
              placeholder="Password (6+ characters)"
              placeholderTextColor={colors.muted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <View style={styles.inputWrap}>
            <Feather name="phone" size={18} color={colors.muted} />
            <TextInput
              testID="signup-phone-input"
              style={styles.input}
              placeholder="Phone number"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
            />
          </View>

          <View style={styles.inputWrap}>
            <Feather name="map-pin" size={18} color={colors.muted} />
            <TextInput
              testID="signup-postcode-input"
              style={styles.input}
              placeholder="Postcode (e.g. SW1A 1AA)"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              value={postcode}
              onChangeText={setPostcode}
            />
          </View>

          <View style={styles.inputWrap}>
            <Feather name="home" size={18} color={colors.muted} />
            <TextInput
              testID="signup-address-input"
              style={styles.input}
              placeholder="Address (optional)"
              placeholderTextColor={colors.muted}
              value={address}
              onChangeText={setAddress}
            />
          </View>

          <Text style={styles.hint}>📍 We use your postcode to match you with contractors nearby.</Text>

          <Text style={styles.roleLabel}>I am a...</Text>
          <View style={styles.roleRow}>
            {ROLES.map((r) => {
              const active = role === r.key;
              return (
                <Pressable
                  key={r.key}
                  testID={`role-${r.key}`}
                  style={[styles.roleCard, active && styles.roleCardActive]}
                  onPress={() => setRole(r.key)}
                >
                  <Feather
                    name={r.icon as any}
                    size={20}
                    color={active ? colors.brand : colors.muted}
                  />
                  <Text style={[styles.roleTitle, active && { color: colors.brand }]}>{r.label}</Text>
                  <Text style={styles.roleDesc}>{r.desc}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable testID="signup-submit-button" style={styles.primaryBtn} onPress={submit} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create Account</Text>}
          </Pressable>

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href="/(auth)/login" asChild>
              <Pressable testID="go-to-login">
                <Text style={styles.footerLink}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.xl },
  back: { width: 40, height: 40, justifyContent: "center", marginBottom: spacing.sm },
  emoji: { fontSize: 34 },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.onSurface, marginTop: spacing.sm },
  subtitle: { fontFamily: fonts.text, fontSize: 15, color: colors.muted, marginTop: spacing.xs, marginBottom: spacing.xl },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    height: 54,
  },
  input: { flex: 1, fontFamily: fonts.text, fontSize: 15, color: colors.onSurface },
  hint: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, lineHeight: 17 },
  roleLabel: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, marginTop: spacing.xs },
  roleRow: { flexDirection: "row", gap: spacing.md },
  roleCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  roleCardActive: { borderColor: colors.brand, backgroundColor: "#EFF4EE" },
  roleTitle: { fontFamily: fonts.text, fontWeight: "700", color: colors.onSurface, fontSize: 14 },
  roleDesc: { fontFamily: fonts.text, color: colors.muted, fontSize: 12 },
  primaryBtn: {
    backgroundColor: colors.brand,
    height: 54,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  primaryBtnText: { fontFamily: fonts.text, fontSize: 16, fontWeight: "700", color: "#fff" },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.xs },
  footerText: { fontFamily: fonts.text, color: colors.muted },
  footerLink: { fontFamily: fonts.text, color: colors.brand, fontWeight: "700" },
});
