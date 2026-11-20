import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { colors } from "../src/theme";
import { API_BASE_URL } from "../src/api";

const features = [
  { icon: "folder-open-outline" as const, title: "Document vault", description: "Manage your documents and expiry reminders in your private account." },
  { icon: "id-card-outline" as const, title: "Identity profile", description: "Keep your own identity details organised and choose what to share." },
  { icon: "share-social-outline" as const, title: "Secure sharing", description: "Create time-limited document links and revoke access when needed." },
  { icon: "shield-checkmark-outline" as const, title: "Security center", description: "Review sessions, biometric app lock and account controls." },
];

async function openPublicPage(path: string) {
  try {
    await Linking.openURL(`${API_BASE_URL}${path}`);
  } catch {
    Alert.alert("Unable to open page", "Please try again or open the SecureID website in your browser.");
  }
}

export default function AboutScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={styles.brandMark}>
          <Ionicons name="shield-checkmark" size={32} color={colors.background} />
        </View>
        <Text style={styles.brand}>SecureID</Text>
        <Text style={styles.eyebrow}>YOUR IDENTITY, IN YOUR CONTROL</Text>
        <Text style={styles.title}>A more organised way to manage your identity.</Text>
        <Text style={styles.subtitle}>SecureID brings your identity details, documents, sharing controls and account security tools together in one digital workspace.</Text>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>What you can do</Text>
          <Text style={styles.sectionHint}>Your workspace</Text>
        </View>
        {features.map((feature) => (
          <View key={feature.title} style={styles.feature}>
            <View style={styles.featureIcon}><Ionicons name={feature.icon} size={22} color={colors.accent} /></View>
            <View style={styles.featureCopy}>
              <Text style={styles.featureTitle}>{feature.title}</Text>
              <Text style={styles.featureDescription}>{feature.description}</Text>
            </View>
          </View>
        ))}

        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={19} color={colors.warning} />
          <Text style={styles.noticeText}>Identity details you enter are user-provided. SecureID does not claim that a saved document or profile is automatically verified by a government authority.</Text>
        </View>

        <Text style={styles.sectionTitle}>Website & account information</Text>
        <Pressable onPress={() => void openPublicPage("/about.html")} style={styles.linkRow}>
          <View style={styles.linkIcon}><Ionicons name="globe-outline" size={20} color={colors.accent} /></View>
          <View style={styles.linkCopy}><Text style={styles.linkTitle}>SecureID website</Text><Text style={styles.linkDescription}>Read about the platform and its features.</Text></View>
          <Ionicons name="open-outline" size={18} color={colors.muted} />
        </Pressable>
        <Pressable onPress={() => void openPublicPage("/delete-account.html")} style={styles.linkRow}>
          <View style={styles.linkIcon}><Ionicons name="person-remove-outline" size={20} color={colors.accent} /></View>
          <View style={styles.linkCopy}><Text style={styles.linkTitle}>Account deletion information</Text><Text style={styles.linkDescription}>Review the steps to request permanent account deletion.</Text></View>
          <Ionicons name="open-outline" size={18} color={colors.muted} />
        </Pressable>
        <Text style={styles.footer}>SecureID · Digital identity and document workspace</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 22, paddingBottom: 42 },
  back: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 28 },
  backText: { color: colors.text, fontSize: 14 },
  brandMark: { width: 62, height: 62, borderRadius: 19, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  brand: { color: colors.text, fontSize: 27, fontWeight: "900" },
  eyebrow: { color: colors.accent, fontSize: 9, letterSpacing: 1.6, fontWeight: "800", marginTop: 5, marginBottom: 30 },
  title: { color: colors.text, fontSize: 28, lineHeight: 35, fontWeight: "850", letterSpacing: -0.6 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 12, marginBottom: 27 },
  sectionHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "800", flex: 1, marginTop: 22, marginBottom: 12 },
  sectionHint: { color: colors.muted, fontSize: 11 },
  feature: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 15, padding: 14, marginBottom: 9 },
  featureIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#153444", alignItems: "center", justifyContent: "center" },
  featureCopy: { flex: 1 },
  featureTitle: { color: colors.text, fontSize: 13, fontWeight: "800" },
  featureDescription: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 4 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 9, backgroundColor: "#24251f", borderWidth: 1, borderColor: "#51482c", borderRadius: 13, padding: 13, marginTop: 16, marginBottom: 20 },
  noticeText: { flex: 1, color: "#e8d7a7", fontSize: 11, lineHeight: 17 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, padding: 13, marginBottom: 9 },
  linkIcon: { width: 39, height: 39, borderRadius: 12, backgroundColor: "#153444", alignItems: "center", justifyContent: "center" },
  linkCopy: { flex: 1 },
  linkTitle: { color: colors.text, fontSize: 12, fontWeight: "800" },
  linkDescription: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  footer: { color: colors.muted, fontSize: 10, textAlign: "center", marginTop: 28 },
});
