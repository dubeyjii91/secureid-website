import { useEffect, useState, type ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { colors } from "../src/theme";
import { getSession } from "../src/api";

type IconName = ComponentProps<typeof Ionicons>["name"];

function ActionCard({ icon, title, description, onPress }: {
  icon: IconName; title: string; description: string; onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}>
      <View style={styles.actionIcon}><Ionicons name={icon} size={23} color={colors.accent} /></View>
      <View style={styles.actionCopy}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionDescription}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={19} color={colors.muted} />
    </Pressable>
  );
}

export default function DashboardScreen() {
  const [activeTab, setActiveTab] = useState("Home");
  const [authChecking, setAuthChecking] = useState(true);

  useEffect(() => {
    let active = true;
    getSession().then((result) => {
      if (!active) return;
      if (!result.user?.mfaVerified) router.replace("/mfa");
    }).catch(() => {
      if (active) router.replace("/login");
    }).finally(() => {
      if (active) setAuthChecking(false);
    });
    return () => { active = false; };
  }, []);

  if (authChecking) {
    return <SafeAreaView style={styles.safe}><View style={{flex:1,alignItems:"center",justifyContent:"center"}}><Ionicons name="shield-checkmark" size={34} color={colors.accent}/><Text style={{color:colors.muted,marginTop:12}}>Connecting securely…</Text></View></SafeAreaView>;
  }
  const tabs: { label: string; icon: IconName; route: "/" | "/vault" | "/share" | "/security" }[] = [
    { label: "Home", icon: "grid-outline", route: "/" },
    { label: "Vault", icon: "folder-outline", route: "/vault" },
    { label: "Share", icon: "share-social-outline", route: "/share" },
    { label: "Security", icon: "shield-checkmark-outline", route: "/security" },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandMark}><Ionicons name="shield-checkmark" size={24} color={colors.background} /></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brand}>SecureID</Text>
            <Text style={styles.brandSub}>YOUR IDENTITY, IN YOUR CONTROL</Text>
          </View>
          <Pressable accessibilityLabel="Security center" onPress={() => router.push("/security")} style={styles.headerButton}>
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroGlow} />
          <Text style={styles.eyebrow}>SECURE IDENTITY WALLET</Text>
          <Text style={styles.heroTitle}>Your identity.{ "\n" }Your control.</Text>
          <Text style={styles.heroBody}>A private space for your documents and the identity details you choose to share.</Text>
          <View style={styles.previewBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.previewText}>APP FOUNDATION · BACKEND NOT CONNECTED</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your workspace</Text>
          <Text style={styles.sectionHint}>Quick access</Text>
        </View>
        <ActionCard icon="folder-open-outline" title="Document vault" description="Your private document space" onPress={() => router.push("/vault")} />
        <ActionCard icon="share-social-outline" title="Secure sharing" description="Share only the details you select" onPress={() => router.push("/share")} />
        <ActionCard icon="shield-checkmark-outline" title="Security center" description="Account and device protection" onPress={() => router.push("/security")} />

        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={20} color={colors.warning} />
          <Text style={styles.noticeText}>This first mobile build is a UI foundation. No real account, document upload, or share link is connected yet.</Text>
        </View>
        <Text style={styles.footer}>Secure by design. Built for your control.</Text>
      </ScrollView>

      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <Pressable key={tab.label} accessibilityRole="button" onPress={() => { setActiveTab(tab.label); router.replace(tab.route); }} style={styles.tab}>
            <Ionicons name={tab.icon} size={21} color={activeTab === tab.label ? colors.accent : colors.muted} />
            <Text style={[styles.tabLabel, activeTab === tab.label && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 25 },
  brandMark: { width: 46, height: 46, borderRadius: 15, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  brandCopy: { marginLeft: 12, flex: 1 },
  brand: { color: colors.text, fontSize: 21, fontWeight: "800", letterSpacing: 0.2 },
  brandSub: { color: colors.muted, fontSize: 9, letterSpacing: 1.1, marginTop: 3, fontWeight: "700" },
  headerButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  hero: { backgroundColor: colors.surface, borderRadius: 25, borderWidth: 1, borderColor: colors.border, padding: 23, overflow: "hidden", marginBottom: 28 },
  heroGlow: { position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: "#123f4b", right: -80, top: -75, opacity: 0.8 },
  eyebrow: { color: colors.accent, fontSize: 10, letterSpacing: 1.7, fontWeight: "800", marginBottom: 13 },
  heroTitle: { color: colors.text, fontSize: 34, lineHeight: 40, fontWeight: "800", letterSpacing: -0.8 },
  heroBody: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 12, maxWidth: 285 },
  previewBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", marginTop: 22, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: "#2b2a22", borderWidth: 1, borderColor: "#645333" },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning, marginRight: 7 },
  previewText: { color: colors.warning, fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  sectionHint: { color: colors.muted, fontSize: 12 },
  actionCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 14, marginBottom: 10 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  actionIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: "#153444", alignItems: "center", justifyContent: "center" },
  actionCopy: { flex: 1, marginLeft: 13, marginRight: 8 },
  actionTitle: { color: colors.text, fontWeight: "700", fontSize: 15 },
  actionDescription: { color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  notice: { flexDirection: "row", alignItems: "flex-start", backgroundColor: "#24251f", borderRadius: 14, borderWidth: 1, borderColor: "#51482c", padding: 13, marginTop: 10 },
  noticeText: { color: "#e8d7a7", fontSize: 12, lineHeight: 18, flex: 1, marginLeft: 9 },
  footer: { textAlign: "center", color: "#637792", fontSize: 11, marginTop: 24, marginBottom: 5 },
  tabBar: { flexDirection: "row", backgroundColor: "#0b1727", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11, paddingBottom: 9, paddingHorizontal: 8 },
  tab: { flex: 1, alignItems: "center", gap: 4 },
  tabLabel: { fontSize: 10, color: colors.muted, fontWeight: "600" },
  tabLabelActive: { color: colors.accent },
});
