import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../src/theme";

function SecurityRow({ icon, title, detail }: { icon: React.ComponentProps<typeof Ionicons>["name"]; title: string; detail: string }) {
  return <View style={styles.row}><View style={styles.rowIcon}><Ionicons name={icon} size={21} color={colors.accent}/></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.muted}/></View>;
}
export default function SecurityScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.iconWrap}><Ionicons name="shield-checkmark-outline" size={29} color={colors.accent}/></View>
        <Text style={styles.title}>Security center</Text>
        <Text style={styles.subtitle}>Security features will be connected to your SecureID account after the native authentication bridge is implemented.</Text>
        <View style={styles.card}>
          <SecurityRow icon="finger-print-outline" title="Biometric unlock" detail="Device capability only; not enabled for account access yet"/>
          <View style={styles.separator}/>
          <SecurityRow icon="phone-portrait-outline" title="Trusted devices" detail="Session list and revocation API integration pending"/>
          <View style={styles.separator}/>
          <SecurityRow icon="time-outline" title="Security activity" detail="Live account activity API integration pending"/>
          <View style={styles.separator}/>
          <SecurityRow icon="key-outline" title="Account recovery" detail="Use the existing website until native flows are implemented"/>
        </View>
        <View style={styles.notice}><Ionicons name="lock-closed-outline" size={19} color={colors.warning}/><Text style={styles.noticeText}>Never store identity documents or long-lived access tokens in plain local storage. Native authentication must preserve server-side authorization and session expiry.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},content:{padding:22,paddingBottom:40},back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:30},backText:{color:colors.text,fontSize:14},iconWrap:{width:58,height:58,borderRadius:18,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:17},title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:9,marginBottom:24},card:{paddingHorizontal:15,borderRadius:18,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},row:{flexDirection:"row",alignItems:"center",paddingVertical:16},rowIcon:{width:42,height:42,borderRadius:13,backgroundColor:"#153444",alignItems:"center",justifyContent:"center"},rowCopy:{flex:1,marginHorizontal:12},rowTitle:{color:colors.text,fontSize:14,fontWeight:"700"},rowDetail:{color:colors.muted,fontSize:11,lineHeight:16,marginTop:4},separator:{height:1,backgroundColor:colors.border},notice:{flexDirection:"row",alignItems:"flex-start",gap:10,backgroundColor:"#24251f",borderRadius:14,borderWidth:1,borderColor:"#51482c",padding:14,marginTop:18},noticeText:{flex:1,color:"#e8d7a7",fontSize:12,lineHeight:18}});
