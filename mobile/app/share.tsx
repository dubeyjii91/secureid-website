import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../src/theme";

export default function ShareScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.iconWrap}><Ionicons name="share-social-outline" size={29} color={colors.accent}/></View>
        <Text style={styles.title}>Secure sharing</Text>
        <Text style={styles.subtitle}>Share only the identity claims you choose, with clear expiry and the ability to revoke access.</Text>
        <View style={styles.card}>
          <View style={styles.cardIcon}><Ionicons name="options-outline" size={22} color={colors.accent}/></View>
          <Text style={styles.cardTitle}>Choose what to share</Text>
          <Text style={styles.cardBody}>Name, age, or other supported claims will be selectable after the mobile app is connected to SecureID's authenticated sharing API.</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.cardIcon}><Ionicons name="timer-outline" size={22} color={colors.accent}/></View>
          <Text style={styles.cardTitle}>Expiry and revocation</Text>
          <Text style={styles.cardBody}>The server must enforce expiry and revocation. Hiding a link in the app is not sufficient to protect shared data.</Text>
        </View>
        <View style={styles.notice}><Ionicons name="information-circle-outline" size={20} color={colors.warning}/><Text style={styles.noticeText}>Share-link creation is intentionally disabled until authenticated API and CSRF/session handling are ready for native clients.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},content:{padding:22,paddingBottom:40},back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:30},backText:{color:colors.text,fontSize:14},iconWrap:{width:58,height:58,borderRadius:18,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:17},title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:9,marginBottom:24},card:{padding:18,borderRadius:18,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,marginBottom:12},cardIcon:{width:42,height:42,borderRadius:13,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:13},cardTitle:{color:colors.text,fontSize:16,fontWeight:"800"},cardBody:{color:colors.muted,fontSize:13,lineHeight:20,marginTop:7},notice:{flexDirection:"row",alignItems:"flex-start",gap:10,backgroundColor:"#24251f",borderRadius:14,borderWidth:1,borderColor:"#51482c",padding:14,marginTop:5},noticeText:{flex:1,color:"#e8d7a7",fontSize:12,lineHeight:18}});
