import { useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { registerAccount } from "../src/api";
import { colors } from "../src/theme";

export default function RegisterScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit() {
    if (!email.trim() || !password || !confirmPassword) {
      Alert.alert("Missing details", "Enter your email and both password fields.");
      return;
    }
    if (password.length < 12 || new TextEncoder().encode(password).length > 72) {
      Alert.alert("Password requirements", "Use a password between 12 and 72 bytes long.");
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Passwords do not match", "Re-enter the same password in both fields.");
      return;
    }
    setBusy(true);
    try {
      const result = await registerAccount(email, password);
      setPassword("");
      setConfirmPassword("");
      Alert.alert("Check your email", result.message || "Your account has been created. Verify your email before signing in.", [
        { text: "Continue to sign in", onPress: () => router.replace("/login") },
      ]);
    } catch (error: any) {
      Alert.alert("Could not create account", error?.message || "Please check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={styles.backText}>Back</Text></Pressable>
          <View style={styles.iconWrap}><Ionicons name="person-add-outline" size={28} color={colors.accent}/></View>
          <Text style={styles.title}>Create your SecureID account</Text>
          <Text style={styles.subtitle}>Use your email address to create an account. SecureID will send an email verification link before you can sign in.</Text>
          <Text style={styles.label}>Email address</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" maxLength={254} placeholder="you@example.com" placeholderTextColor={colors.muted} style={styles.input}/>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordWrap}>
            <TextInput value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" textContentType="newPassword" autoComplete="new-password" placeholder="At least 12 characters" placeholderTextColor={colors.muted} style={styles.passwordInput}/>
            <Pressable onPress={() => setShowPassword(v => !v)} accessibilityLabel={showPassword ? "Hide password" : "Show password"}><Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={21} color={colors.muted}/></Pressable>
          </View>
          <Text style={styles.label}>Confirm password</Text>
          <TextInput value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry={!showPassword} autoCapitalize="none" textContentType="newPassword" autoComplete="new-password" placeholder="Re-enter your password" placeholderTextColor={colors.muted} style={styles.input}/>
          <Text style={styles.hint}>Use 12–72 bytes. Never reuse a password from another service.</Text>
          <Pressable onPress={submit} disabled={busy} style={[styles.button,busy&&{opacity:0.65}]}>
            {busy?<ActivityIndicator color={colors.background}/>:<Text style={styles.buttonText}>Create account securely</Text>}
          </Pressable>
          <Pressable onPress={() => router.replace("/login")} style={styles.secondary}><Text style={styles.secondaryText}>Already have an account? Sign in</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},content:{flexGrow:1,justifyContent:"center",padding:24,paddingBottom:38},
  back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:28},backText:{color:colors.text,fontSize:14},
  iconWrap:{width:58,height:58,borderRadius:18,backgroundColor:colors.surface,alignItems:"center",justifyContent:"center",marginBottom:20},
  title:{color:colors.text,fontSize:28,fontWeight:"800",letterSpacing:-0.5},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:10,marginBottom:24},
  label:{color:colors.text,fontSize:13,fontWeight:"700",marginBottom:8,marginTop:13},
  input:{height:52,borderWidth:1,borderColor:colors.border,borderRadius:13,backgroundColor:colors.surface,color:colors.text,paddingHorizontal:14,fontSize:14},
  passwordWrap:{height:52,borderWidth:1,borderColor:colors.border,borderRadius:13,backgroundColor:colors.surface,paddingHorizontal:14,flexDirection:"row",alignItems:"center"},
  passwordInput:{flex:1,color:colors.text,fontSize:14},hint:{color:colors.muted,fontSize:10,lineHeight:15,marginTop:9},
  button:{height:54,borderRadius:14,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center",marginTop:24},buttonText:{color:colors.background,fontSize:14,fontWeight:"900"},
  secondary:{alignItems:"center",padding:16,marginTop:6},secondaryText:{color:colors.accent,fontSize:12,fontWeight:"700"}
});
