import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Link, useRouter } from "expo-router";
import { useAuth } from "@/src/context/AuthContext";
import { useToast } from "@/src/components/Toast";
import { colors, spacing, radius, fonts } from "@/src/theme";

const HERO =
  "https://images.pexels.com/photos/38080084/pexels-photo-38080084.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

export default function Login() {
  const { login, googleLogin } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast.show("Please enter your email and password", "error");
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      toast.show(e.message || "Login failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    try {
      await googleLogin();
      if (Platform.OS !== "web") router.replace("/(tabs)");
    } catch (e: any) {
      toast.show(e.message || "Google sign-in failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Image source={{ uri: HERO }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["rgba(42,54,46,0.35)", "rgba(42,54,46,0.55)", "rgba(42,54,46,0.94)"]}
        style={StyleSheet.absoluteFill}
      />
      <KeyboardAwareScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + spacing["2xl"], paddingBottom: insets.bottom + spacing.xl },
        ]}
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <Text style={styles.leaf}>🌿</Text>
          <Text style={styles.brandName}>Glam up your Garden</Text>
        </View>
        <Text style={styles.tagline}>Transform your outdoor space with a little AI magic ✨</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Welcome back</Text>

          <View style={styles.inputWrap}>
            <Feather name="mail" size={18} color={colors.muted} />
            <TextInput
              testID="login-email-input"
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
              testID="login-password-input"
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <Pressable testID="login-submit-button" style={styles.primaryBtn} onPress={submit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Sign In</Text>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.line} />
            <Text style={styles.orText}>or</Text>
            <View style={styles.line} />
          </View>

          <Pressable testID="google-login-button" style={styles.googleBtn} onPress={google} disabled={busy}>
            <Feather name="chrome" size={18} color={colors.onSurface} />
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </Pressable>

          <View style={styles.footerRow}>
            <Text style={styles.footerText}>New here? </Text>
            <Link href="/(auth)/signup" asChild>
              <Pressable testID="go-to-signup">
                <Text style={styles.footerLink}>Create an account</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceInverse },
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.xl },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, justifyContent: "center" },
  leaf: { fontSize: 26 },
  brandName: { fontFamily: fonts.display, fontSize: 26, color: "#fff" },
  tagline: {
    fontFamily: fonts.text,
    fontSize: 15,
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing["2xl"],
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  cardTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.onSurface, marginBottom: spacing.xs },
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
  primaryBtn: {
    backgroundColor: colors.brand,
    height: 54,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  primaryBtnText: { fontFamily: fonts.text, fontSize: 16, fontWeight: "700", color: "#fff" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.xs },
  line: { flex: 1, height: 1, backgroundColor: colors.divider },
  orText: { fontFamily: fonts.text, color: colors.muted, fontSize: 13 },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 54,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  googleBtnText: { fontFamily: fonts.text, fontSize: 15, fontWeight: "600", color: colors.onSurface },
  footerRow: { flexDirection: "row", justifyContent: "center", marginTop: spacing.sm },
  footerText: { fontFamily: fonts.text, color: colors.muted },
  footerLink: { fontFamily: fonts.text, color: colors.brand, fontWeight: "700" },
});
