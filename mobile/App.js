import React, { useState } from "react";
import { BackHandler, Platform, SafeAreaView, StatusBar, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { WebView } from "react-native-webview";

const SECUREID_URL = "https://secureid-production-b732.up.railway.app";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const webViewRef = React.useRef(null);

  React.useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <ExpoStatusBar style="light" backgroundColor="#07172f" />
      <View style={styles.header}>
        <View style={styles.logo}><Text style={styles.logoText}>S</Text></View>
        <View style={styles.brandBlock}>
          <Text style={styles.brand}>SecureID</Text>
          <Text style={styles.subtitle}>YOUR IDENTITY. YOUR CONTROL.</Text>
        </View>
        <View style={styles.secureBadge}><Text style={styles.lock}>●</Text><Text style={styles.secureText}>SECURE</Text></View>
      </View>
      {failed ? (
        <View style={styles.error}>
          <Text style={styles.errorTitle}>SecureID is temporarily unavailable</Text>
          <Text style={styles.errorText}>Check your internet connection and try again.</Text>
          <Text style={styles.retry} onPress={() => { setFailed(false); setLoading(true); webViewRef.current?.reload(); }}>Try again</Text>
        </View>
      ) : (
        <View style={styles.webContainer}>
          <WebView
            ref={webViewRef}
            source={{ uri: SECUREID_URL }}
            style={styles.web}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            originWhitelist={["https://*"]}
            setSupportMultipleWindows={false}
            startInLoadingState
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setFailed(true); }}
            onHttpError={(event) => { if (event.nativeEvent.statusCode >= 500) setFailed(true); }}
            renderLoading={() => (
              <View style={styles.loading}>
                <View style={styles.loadingLogo}><Text style={styles.loadingLogoText}>S</Text></View>
                <Text style={styles.loadingTitle}>SecureID</Text>
                <ActivityIndicator color="#65d6c4" size="large" />
                <Text style={styles.loadingText}>Preparing your secure identity vault…</Text>
              </View>
            )}
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            contentInsetAdjustmentBehavior="automatic"
          />
          {loading && <View pointerEvents="none" style={styles.loadingOverlay}><ActivityIndicator color="#65d6c4" /></View>}
        </View>
      )}
      <View style={styles.footer}><View style={styles.footerDot} /><Text style={styles.footerText}>Encrypted connection · HTTPS</Text></View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#07172f", paddingTop: Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0 },
  header: { minHeight: 70, paddingHorizontal: 18, flexDirection: "row", alignItems: "center", backgroundColor: "#07172f", borderBottomWidth: 1, borderBottomColor: "#193557" },
  logo: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#65d6c4", alignItems: "center", justifyContent: "center", marginRight: 11 },
  logoText: { fontSize: 25, fontWeight: "900", color: "#07172f" },
  brandBlock: { flex: 1 },
  brand: { color: "#f4f8ff", fontSize: 21, fontWeight: "800", letterSpacing: 0.2 },
  subtitle: { color: "#9bb4d3", fontSize: 8, letterSpacing: 1.35, marginTop: 3, fontWeight: "700" },
  secureBadge: { flexDirection: "row", alignItems: "center", backgroundColor: "#102b43", borderColor: "#28536a", borderWidth: 1, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6 },
  lock: { color: "#65d6c4", fontSize: 10, marginRight: 5 },
  secureText: { color: "#b5f2e8", fontSize: 9, fontWeight: "800", letterSpacing: 0.7 },
  webContainer: { flex: 1, backgroundColor: "#f7f9fc" },
  web: { flex: 1, backgroundColor: "#f7f9fc" },
  loading: { ...StyleSheet.absoluteFillObject, backgroundColor: "#07172f", alignItems: "center", justifyContent: "center", gap: 18 },
  loadingLogo: { width: 70, height: 70, borderRadius: 24, backgroundColor: "#65d6c4", alignItems: "center", justifyContent: "center" },
  loadingLogoText: { color: "#07172f", fontWeight: "900", fontSize: 42 },
  loadingTitle: { color: "#f4f8ff", fontSize: 28, fontWeight: "800" },
  loadingText: { color: "#a9bdd6", fontSize: 13, marginTop: 3 },
  loadingOverlay: { position: "absolute", top: 12, right: 12, backgroundColor: "#07172fdd", borderRadius: 18, padding: 8 },
  error: { flex: 1, backgroundColor: "#f7f9fc", alignItems: "center", justifyContent: "center", padding: 28 },
  errorTitle: { color: "#10233e", fontSize: 20, fontWeight: "800", textAlign: "center", marginBottom: 10 },
  errorText: { color: "#5e6f84", fontSize: 14, textAlign: "center", lineHeight: 22 },
  retry: { marginTop: 22, backgroundColor: "#07172f", color: "#ffffff", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, overflow: "hidden", fontWeight: "700" },
  footer: { minHeight: 30, backgroundColor: "#07172f", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  footerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#65d6c4" },
  footerText: { color: "#9bb4d3", fontSize: 10, letterSpacing: 0.3 }
});