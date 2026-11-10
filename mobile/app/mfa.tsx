import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { requestMfaCode, verifyMfa } from "../src/api";
import { colors } from "../src/theme";

export default function MfaScreen() {
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [trustDevice, setTrustDevice] = useState(false);

  async function sendCode() {
    setLoading(true);
    try {
      const result = await requestMfaCode();
      setChallengeId(result.challengeId);
      setResendIn(result.resendAvailableIn);
    } catch (error: any) {
      Alert.alert("Could not send code", error?.message || "Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void sendCode(); }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function submit() {
    if (!challengeId || !/^\d{6}$/.test(code.trim())) {
      Alert.alert("Enter verification code", "Enter the six-digit code sent to your registered email.");
      return;
    }
    setBusy(true);
    try {
      await verifyMfa(code, challengeId, trustDevice);
      router.replace("/");
    } catch (error: any) {
      Alert.alert("Verification failed", error?.message || "Check the code and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.iconWrap}><Ionicons name="mail-unread-outline" size={31} color={colors.accent}/></View>
        <Text style={styles.title}>Verify it's you</Text>
        <Text style={styles.subtitle}>SecureID sent a one-time verification code to your registered email address. Enter it below to finish signing in.</Text>
        {loading ? <ActivityIndicator color={colors.accent}/> : <>
          <Text style={styles.label}>6-digit verification code</Text>
          <TextInput value={code} onChangeText={v => setCode(v.replace(/\D/g,"").slice(0,6))} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} placeholder="000000" placeholderTextColor={colors.muted} style={styles.code}/>
          <Pressable onPress={submit} disabled={busy || !challengeId} style={[styles.button,(busy || !challengeId) && {opacity:0.6}]}>
            {busy ? <ActivityIndicator color={colors.background}/> : <Text style={styles.buttonText}>Verify and continue</Text>}
          </Pressable>
          <Pressable onPress={sendCode} disabled={loading || resendIn > 0} style={[styles.resend,(loading || resendIn > 0) && {opacity:0.55}]}><Text style={styles.resendText}>{resendIn > 0 ? `Request another code in ${resendIn}s` : "Request another code"}</Text></Pressable>
        </>}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: trustDevice }} onPress={() => setTrustDevice(value => !value)} style={styles.trustOption}>
          <View style={[styles.trustCheckbox, trustDevice && styles.trustCheckboxChecked]}>{trustDevice && <Ionicons name="checkmark" size={15} color={colors.background}/>}</View>
          <View style={styles.trustCopy}><Text style={styles.trustTitle}>Trust this device for 30 days</Text><Text style={styles.trustSubtitle}>Only select this on your personal device. You can leave it unchecked for extra security.</Text></View>
        </Pressable>
        <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={18} color={colors.accent}/><Text style={styles.noticeText}>Your sign-in still requires this verification code. Trusting a device is optional.</Text></View>
        <Pressable onPress={() => router.replace("/login")} style={styles.back}><Text style={styles.backText}>Back to sign in</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},content:{flexGrow:1,justifyContent:"center",padding:25},
  iconWrap:{width:62,height:62,borderRadius:19,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:22},
  title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:10,marginBottom:30},
  label:{color:colors.text,fontSize:13,fontWeight:"700",marginBottom:9},code:{height:60,borderWidth:1,borderColor:colors.border,borderRadius:14,backgroundColor:colors.surface,color:colors.text,fontSize:25,fontWeight:"800",letterSpacing:9,textAlign:"center"},
  button:{height:54,borderRadius:14,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center",marginTop:22},buttonText:{color:colors.background,fontSize:15,fontWeight:"900"},
  resend:{alignSelf:"center",padding:15},resendText:{color:colors.accent,fontSize:13,fontWeight:"700"},
  trustOption:{flexDirection:"row",alignItems:"flex-start",gap:11,padding:14,borderRadius:14,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,marginTop:18},trustCheckbox:{width:22,height:22,borderRadius:6,borderWidth:1.5,borderColor:colors.muted,alignItems:"center",justifyContent:"center"},trustCheckboxChecked:{backgroundColor:colors.accent,borderColor:colors.accent},trustCopy:{flex:1,gap:4},trustTitle:{color:colors.text,fontSize:13,fontWeight:"800"},trustSubtitle:{color:colors.muted,fontSize:11,lineHeight:16},
  notice:{flexDirection:"row",gap:10,alignItems:"flex-start",padding:15,borderRadius:14,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,marginTop:12},noticeText:{flex:1,color:colors.muted,fontSize:12,lineHeight:18},
  back:{alignSelf:"center",padding:14,marginTop:12},backText:{color:colors.muted,fontSize:13}
});
