import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../src/theme";
import { getSecurityDashboard, listSessions, revokeSession, signOut } from "../src/api";

type SessionRecord = { id: string; current: boolean; createdAt: number; lastSeenAt: number; expiresAt: number; userAgent: string };

function Stat({label,value,icon}:{label:string;value:number|string;icon: keyof typeof Ionicons.glyphMap}) {
  return <View style={styles.stat}><Ionicons name={icon} size={20} color={colors.accent}/><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

export default function SecurityScreen() {
  const [dashboard,setDashboard]=useState<any>(null);
  const [sessions,setSessions]=useState<SessionRecord[]>([]);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState("");

  const load=useCallback(async()=>{
    try {
      const [summary,active]=await Promise.all([getSecurityDashboard(),listSessions()]);
      setDashboard(summary);
      setSessions(active.sessions||[]);
    } catch(error:any) {
      if(error?.status===401) router.replace("/login");
      else if(error?.status===403) router.replace("/mfa");
      else Alert.alert("Security center unavailable",error?.message||"Please try again.");
    } finally {setLoading(false);}
  },[]);

  useEffect(()=>{void load();},[load]);

  async function verifyBiometric() {
    try {
      const hardware=await LocalAuthentication.hasHardwareAsync();
      const enrolled=await LocalAuthentication.isEnrolledAsync();
      if(!hardware||!enrolled) {
        Alert.alert("Biometrics unavailable","Set up fingerprint or face unlock in your Android device settings first.");
        return;
      }
      const result=await LocalAuthentication.authenticateAsync({promptMessage:"Verify your identity for SecureID",cancelLabel:"Cancel",disableDeviceFallback:false});
      if(result.success) Alert.alert("Biometric verified","Your device verified this biometric locally. Server authentication and MFA remain required for account actions.");
    } catch {Alert.alert("Biometric check failed","Your device could not complete biometric verification.");}
  }

  function confirmRevoke(session:SessionRecord) {
    Alert.alert("Revoke device session?","This device will be signed out from that session.",[
      {text:"Cancel",style:"cancel"},
      {text:"Revoke",style:"destructive",onPress:async()=>{
        setBusyId(session.id);
        try{await revokeSession(session.id);await load();}
        catch(error:any){Alert.alert("Could not revoke",error?.message||"Please try again.");}
        finally{setBusyId("");}
      }},
    ]);
  }

  async function logout() {
    Alert.alert("Sign out of SecureID?","This ends your current server session on this device.",[
      {text:"Cancel",style:"cancel"},
      {text:"Sign out",style:"destructive",onPress:async()=>{
        try{await signOut();}catch{}
        router.replace("/login");
      }},
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={()=>{setLoading(true);void load();}} tintColor={colors.accent}/>}>
        <Pressable onPress={()=>router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.iconWrap}><Ionicons name="shield-checkmark-outline" size={29} color={colors.accent}/></View>
        <Text style={styles.title}>Security center</Text>
        <Text style={styles.subtitle}>Live security information from your SecureID account. Refresh to check current sessions and recovery readiness.</Text>
        {loading&&!dashboard?<ActivityIndicator color={colors.accent} style={{margin:28}}/>:dashboard?<>
          <View style={styles.scoreCard}><Text style={styles.scoreLabel}>SECURITY SCORE</Text><Text style={styles.score}>{dashboard.score ?? "—"}<Text style={styles.scoreSmall}> / 100</Text></Text><Text style={styles.scoreHint}>{dashboard.scoreLabel||"Account security"}</Text></View>
          <View style={styles.stats}>
            <Stat label="Documents" value={dashboard.stats?.documents??0} icon="document-text-outline"/>
            <Stat label="Active shares" value={dashboard.stats?.activeShares??0} icon="share-social-outline"/>
            <Stat label="Sessions" value={dashboard.stats?.activeSessions??0} icon="phone-portrait-outline"/>
            <Stat label="Recovery codes" value={dashboard.stats?.recoveryCodesRemaining??0} icon="key-outline"/>
          </View>
        </>:null}
        <Text style={styles.sectionTitle}>Device protection</Text>
        <Pressable onPress={verifyBiometric} style={styles.action}><View style={styles.actionIcon}><Ionicons name="finger-print-outline" size={22} color={colors.accent}/></View><View style={styles.actionCopy}><Text style={styles.actionTitle}>Verify with biometrics</Text><Text style={styles.actionDetail}>Test fingerprint or face authentication on this device</Text></View><Ionicons name="chevron-forward" size={18} color={colors.muted}/></Pressable>
        <Text style={styles.sectionTitle}>Active sessions</Text>
        {sessions.map(session=><View key={session.id} style={styles.session}><View style={styles.sessionIcon}><Ionicons name="phone-portrait-outline" size={20} color={colors.accent}/></View><View style={styles.actionCopy}><Text style={styles.actionTitle}>{session.current?"This device":(session.userAgent||"Other device").slice(0,38)}</Text><Text style={styles.actionDetail}>{session.current?"Current trusted session":`Last active ${new Date(session.lastSeenAt).toLocaleString()}`}</Text></View>{session.current?<Text style={styles.current}>CURRENT</Text>:<Pressable disabled={!!busyId} onPress={()=>confirmRevoke(session)} style={styles.revoke}><Text style={styles.revokeText}>{busyId===session.id?"…":"Revoke"}</Text></Pressable>}</View>)}
        <Pressable onPress={logout} style={styles.logout}><Ionicons name="log-out-outline" size={19} color={colors.danger}/><Text style={styles.logoutText}>Sign out</Text></Pressable>
        <View style={styles.notice}><Ionicons name="lock-closed-outline" size={18} color={colors.accent}/><Text style={styles.noticeText}>Authentication, MFA, document ownership, share expiry and session revocation are enforced by the SecureID server. Biometric verification is performed locally by Android.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
 safe:{flex:1,backgroundColor:colors.background},content:{padding:22,paddingBottom:40},back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:30},backText:{color:colors.text,fontSize:14},
 iconWrap:{width:58,height:58,borderRadius:18,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:17},title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:9,marginBottom:22},
 scoreCard:{padding:19,borderRadius:18,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},scoreLabel:{color:colors.muted,fontSize:10,fontWeight:"800",letterSpacing:1.4},score:{color:colors.accent,fontSize:38,fontWeight:"900",marginTop:6},scoreSmall:{color:colors.muted,fontSize:14,fontWeight:"600"},scoreHint:{color:colors.text,fontSize:13,marginTop:3},
 stats:{flexDirection:"row",flexWrap:"wrap",gap:9,marginTop:10},stat:{width:"48%",flexGrow:1,padding:13,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},statValue:{color:colors.text,fontSize:22,fontWeight:"800",marginTop:8},statLabel:{color:colors.muted,fontSize:11,marginTop:2},
 sectionTitle:{color:colors.text,fontSize:16,fontWeight:"800",marginTop:26,marginBottom:11},action:{flexDirection:"row",alignItems:"center",padding:13,borderRadius:15,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},actionIcon:{width:42,height:42,borderRadius:12,backgroundColor:"#153444",alignItems:"center",justifyContent:"center"},actionCopy:{flex:1,marginHorizontal:11},actionTitle:{color:colors.text,fontSize:13,fontWeight:"700"},actionDetail:{color:colors.muted,fontSize:11,lineHeight:16,marginTop:4},
 session:{flexDirection:"row",alignItems:"center",padding:12,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,marginBottom:8},sessionIcon:{width:38,height:38,borderRadius:11,backgroundColor:"#153444",alignItems:"center",justifyContent:"center"},current:{color:colors.accent,fontSize:9,fontWeight:"900"},revoke:{paddingHorizontal:10,paddingVertical:7,borderWidth:1,borderColor:"#704040",borderRadius:8},revokeText:{color:colors.danger,fontSize:10,fontWeight:"800"},
 logout:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,padding:15,borderRadius:13,borderWidth:1,borderColor:"#704040",marginTop:24},logoutText:{color:colors.danger,fontSize:14,fontWeight:"800"},
 notice:{flexDirection:"row",alignItems:"flex-start",gap:10,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.border,padding:14,marginTop:18},noticeText:{flex:1,color:colors.muted,fontSize:12,lineHeight:18}
});
