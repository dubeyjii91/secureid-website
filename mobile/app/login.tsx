import { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { signIn } from "../src/api";
import { colors } from "../src/theme";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      Alert.alert("Missing details", "Enter your SecureID email and password.");
      return;
    }
    setBusy(true);
    try {
      const result = await signIn(email, password);
      if (result.mfaRequired) router.replace("/mfa");
      else router.replace("/");
    } catch (error: any) {
      Alert.alert("Sign-in failed", error?.message || "Please check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandMark}><Ionicons name="shield-checkmark" size={30} color={colors.background}/></View>
          <Text style={styles.brand}>SecureID</Text>
          <Text style={styles.eyebrow}>YOUR IDENTITY, IN YOUR CONTROL</Text>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in with your existing SecureID account. Your session is protected by the SecureID server.</Text>
          <Text style={styles.label}>Email address</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" placeholderTextColor={colors.muted} style={styles.input}/>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordWrap}>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" textContentType="password" placeholder="Enter your password" placeholderTextColor={colors.muted} style={styles.passwordInput}/>
            <Pressable onPress={() => setShowPassword(v => !v)} accessibilityLabel={showPassword ? "Hide password" : "Show password"}><Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={21} color={colors.muted}/></Pressable>
          </View>
          <Pressable onPress={submit} disabled={busy} style={[styles.button, busy && { opacity: 0.65 }]}>
            {busy ? <ActivityIndicator color={colors.background}/> : <Text style={styles.buttonText}>Continue securely</Text>}
          </Pressable>
          <View style={styles.security}><Ionicons name="lock-closed-outline" size={17} color={colors.accent}/><Text style={styles.securityText}>Passwords are sent only over HTTPS and are never stored on this device.</Text></View>
          <Text style={styles.footer}>New account registration and password recovery remain available through the SecureID website.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},content:{flexGrow:1,justifyContent:"center",padding:25,paddingBottom:40},
  brandMark:{width:62,height:62,borderRadius:19,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center",marginBottom:15},
  brand:{color:colors.text,fontSize:27,fontWeight:"900"},eyebrow:{color:colors.accent,fontSize:9,letterSpacing:1.5,fontWeight:"800",marginTop:4,marginBottom:38},
  title:{color:colors.text,fontSize:30,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:9,marginBottom:28},
  label:{color:colors.text,fontSize:13,fontWeight:"700",marginBottom:8,marginTop:13},
  input:{height:52,borderWidth:1,borderColor:colors.border,borderRadius:13,backgroundColor:colors.surface,color:colors.text,paddingHorizontal:15,fontSize:15},
  passwordWrap:{height:52,borderWidth:1,borderColor:colors.border,borderRadius:13,backgroundColor:colors.surface,paddingHorizontal:15,flexDirection:"row",alignItems:"center"},
  passwordInput:{flex:1,color:colors.text,fontSize:15},button:{height:54,borderRadius:14,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center",marginTop:26},buttonText:{color:colors.background,fontSize:15,fontWeight:"900"},
  security:{flexDirection:"row",alignItems:"center",gap:9,marginTop:22},securityText:{flex:1,color:colors.muted,fontSize:11,lineHeight:17},footer:{color:colors.muted,fontSize:11,lineHeight:17,marginTop:30}
});
