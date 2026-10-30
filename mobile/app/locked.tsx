import { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { requireBiometricUnlock } from "../src/biometric";
import { colors } from "../src/theme";

export default function LockedScreen() {
  const [busy,setBusy]=useState(false);

  useEffect(() => {
    // Never let Android's system Back action reveal a screen underneath the lock.
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, []);
  async function unlock() {
    setBusy(true);
    try {
      const success=await requireBiometricUnlock();
      if(success) router.replace("/");
    } catch(error:any) {
      // Keep the app locked if the device authentication prompt fails.
    } finally {setBusy(false);}
  }
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <View style={styles.icon}><Ionicons name="finger-print-outline" size={39} color={colors.accent}/></View>
        <Text style={styles.title}>SecureID is locked</Text>
        <Text style={styles.subtitle}>Verify with your device fingerprint, face unlock or screen lock to continue to your private identity wallet.</Text>
        <Pressable onPress={unlock} disabled={busy} style={[styles.button,busy&&{opacity:0.65}]}>
          {busy?<ActivityIndicator color={colors.background}/>:<><Ionicons name="lock-open-outline" size={19} color={colors.background}/><Text style={styles.buttonText}>Unlock SecureID</Text></>}
        </Pressable>
        <Pressable onPress={()=>router.replace("/login")} style={styles.signin}><Text style={styles.signinText}>Sign in with account credentials</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},content:{flex:1,justifyContent:"center",alignItems:"center",padding:28},icon:{width:82,height:82,borderRadius:26,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:25},title:{color:colors.text,fontSize:27,fontWeight:"900",textAlign:"center"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,textAlign:"center",marginTop:12,marginBottom:28},button:{height:54,width:"100%",borderRadius:14,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center",flexDirection:"row",gap:9},buttonText:{color:colors.background,fontSize:15,fontWeight:"900"},signin:{padding:16,marginTop:12},signinText:{color:colors.muted,fontSize:12,fontWeight:"700"}});
