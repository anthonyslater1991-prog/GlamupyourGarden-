import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, spacing, radius, fonts } from "@/src/theme";

type Section = { heading: string; body: string };
type Doc = { title: string; emoji: string; intro: string; sections: Section[] };

const DOCS: Record<string, Doc> = {
  terms: {
    title: "Terms & Conditions",
    emoji: "📜",
    intro:
      "Welcome to Glam up your Garden. By creating an account and using the app you agree to these terms. Please read them carefully.",
    sections: [
      { heading: "1. Using the app", body: "You must be 18 or over to create an account. Keep your login details secure and don't share your account. Use the app lawfully and respectfully towards other members and contractors." },
      { heading: "2. AI garden redesigns", body: "AI-generated designs and product suggestions are for inspiration only. Appearance, availability, prices and suitability of real products or plants may differ. Always check measurements, materials and planting conditions before buying or building." },
      { heading: "3. Shopping & retailer links", body: "Product links take you to third-party retailers (e.g. B&Q). We are not the seller and are not responsible for their products, prices, delivery or returns. Some links may become affiliate links in future, which never changes the price you pay." },
      { heading: "4. Contractors & agreements", body: "Contractors listed in the directory are independent businesses, not employees of Glam up your Garden. Any agreement, quote, work and payment is strictly between you and the contractor. The in-app agreement is a convenient record — you are responsible for reading it before you sign." },
      { heading: "5. Community content", body: "You own what you post but grant us a licence to display it in the app. Don't post anything unlawful, offensive, misleading or that infringes someone else's rights. We may remove content and suspend accounts that break these rules." },
      { heading: "6. Membership", body: "The current membership tier is free. We may introduce paid tiers in future with clear notice. We may change or withdraw features to improve the service." },
      { heading: "7. Liability", body: "The app is provided 'as is'. To the extent permitted by law we are not liable for losses arising from AI suggestions, third-party products, or work carried out by contractors. Nothing here limits liability that cannot be limited by law, or your statutory consumer rights." },
      { heading: "8. Changes & contact", body: "We may update these terms; continued use means you accept the changes. Governed by the laws of England & Wales. Questions? Contact us via the in-app support options." },
    ],
  },
  privacy: {
    title: "Privacy & Data Protection",
    emoji: "🛡️",
    intro:
      "We take your privacy seriously and handle your data in line with UK GDPR and the Data Protection Act 2018. This explains what we collect and why.",
    sections: [
      { heading: "What we collect", body: "Account details (name, email, and optionally phone, address and postcode), your garden photos and AI redesigns, projects and wishlists, messages you send, community posts, contractor reviews, and basic usage/visit statistics." },
      { heading: "Why we use it", body: "To provide the app: create your account, generate and store your redesigns, connect you with the community and contractors, calculate contractor distance from your postcode, and keep the service safe and improving." },
      { heading: "Your postcode & location", body: "Your postcode is used only to estimate distances to contractors and to show nearby alerts. We use the free, keyless postcodes.io service and never sell your location." },
      { heading: "Photos & storage", body: "Photos you upload are stored securely and served only to authenticated requests. Only share photos you're happy to have in the app." },
      { heading: "Sharing", body: "We don't sell your personal data. We share only what's necessary to run the app (e.g. secure image storage and AI processing) and never share your contact details with contractors unless you choose to." },
      { heading: "Your rights", body: "You can access, correct or delete your data. You can edit your details in Profile, delete projects, and request account deletion via support. You can also object to or restrict certain processing." },
      { heading: "Retention & security", body: "We keep your data for as long as your account is active. Sessions expire after 7 days and passwords are stored hashed. We apply reasonable technical measures to protect your information." },
    ],
  },
  safety: {
    title: "Chat & Data Safety",
    emoji: "🔒",
    intro:
      "Your safety in the community and messages matters. Here's how we keep things respectful and what you can do.",
    sections: [
      { heading: "Private messages", body: "Direct messages are visible only to you and the person you're chatting with. You can turn member messages off in Profile at any time." },
      { heading: "Block & report", body: "If someone is bothering you, block them to hide their messages and posts, or report them so our admins can review. Blocking works both ways instantly." },
      { heading: "Community rules", body: "Be kind, stay on topic, and don't share personal contact details publicly. No harassment, spam, scams or offensive content. Admins can warn, suspend or remove accounts." },
      { heading: "Staying safe with contractors", body: "Check reviews and ratings, agree scope and price in writing (use the in-app agreement), and never pay large sums up front. Meet and verify before major work begins." },
      { heading: "Protecting your info", body: "Never share passwords or payment card details in chat. We will never ask for your password. If something feels off, report it." },
    ],
  },
};

export default function LegalDoc() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const content = DOCS[doc || "terms"] || DOCS.terms;

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="legal-back" style={styles.iconBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>{content.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48, gap: spacing.md }}>
        <Text style={styles.hero}>{content.emoji}</Text>
        <Text style={styles.intro}>{content.intro}</Text>
        {content.sections.map((s) => (
          <View key={s.heading} style={styles.card}>
            <Text style={styles.heading}>{s.heading}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
        <Text style={styles.updated}>Last updated: June 2026</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.surfaceSecondary, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  topTitle: { flex: 1, textAlign: "center", fontFamily: fonts.display, fontSize: 18, color: colors.onSurface },
  hero: { fontSize: 40, textAlign: "center" },
  intro: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 15, lineHeight: 22, textAlign: "center" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  heading: { fontFamily: fonts.display, fontSize: 16, color: colors.onSurface },
  body: { fontFamily: fonts.text, color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21 },
  updated: { fontFamily: fonts.text, color: colors.muted, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
});
