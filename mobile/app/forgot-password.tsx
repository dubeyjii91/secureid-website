import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { requestPasswordReset } from "../src/api";
import { colors } from "../src/theme";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!email.trim()) {
      Alert.alert("Email required", "Enter the email address associated with your SecureID account.");
      return;
    }
    setBusy(true);
    try {
      const result = await requestPasswordReset(email);
      setSent(true);
      Alert.alert("Check your email", result.message || "If the account exists, a password reset email has been sent.");
    } catch (error: any) {
      Alert.alert("Request unavailable", error?.message || "Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.iconWrap}><Ionicons name="key-outline" size={29} color={colors.accent}/></View>
        <Text style={styles.title}>Reset your password</Text>
        <Text style={styles.subtitle}>Enter your SecureID email address. If an account exists, we will send a password reset link.</Text>
        <Text style={styles.label}>Email address</Text>
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" maxLength={254} placeholder="you@example.com" placeholderTextColor={colors.muted} style={styles.input}/>
        <Pressable onPress={submit} disabled={busy} style={[styles.button,busy&&{opacity:0.65}]}>
          {busy?<ActivityIndicator color={colors.background}/>:<Text style={styles.buttonText}>Send reset link</Text>}
        </Pressable>
        {sent&&<View style={styles.notice}><Ionicons name="mail-outline" size={18} color={colors.accent}/><Text style={styles.noticeText}>For security, SecureID shows the same confirmation whether or not the email address is registered.</Text></View>}
        <Pressable onPress={() => router.replace("/login")} style={styles.secondary}><Text style={styles.secondaryText}>Return to sign in</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},content:{flexGrow:1,justifyContent:"center",padding:24,paddingBottom:38},
  back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:30},backText:{color:colors.text,fontSize:14},
  iconWrap:{width:60,height:60,borderRadius:18,backgroundColor:colors.surface,alignItems:"center",justifyContent:"center",marginBottom:20},
  title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:10,marginBottom:27},
  label:{color:colors.text,fontSize:13,fontWeight:"700",marginBottom:8},input:{height:52,borderWidth:1,borderColor:colors.border,borderRadius:13,backgroundColor:colors.surface,color:colors.text,paddingHorizontal:14,fontSize:14},
  button:{height:54,borderRadius:14,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center",marginTop:22},buttonText:{color:colors.background,fontSize:14,fontWeight:"900"},
  notice:{flexDirection:"row",alignItems:"flex-start",gap:9,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,borderRadius:13,padding:13,marginTop:20},noticeText:{flex:1,color:colors.muted,fontSize:11,lineHeight:17},
  secondary:{alignItems:"center",padding:16,marginTop:6},secondaryText:{color:colors.accent,fontSize:12,fontWeight:"700"}
});
