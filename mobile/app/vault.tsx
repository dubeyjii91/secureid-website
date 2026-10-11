import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../src/theme";

export default function VaultScreen() {
  const [pickedName, setPickedName] = useState("");
  async function chooseDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png"],
        copyToCacheDirectory: false,
        multiple: false,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      setPickedName(file.name);
      Alert.alert("File selected", "The file is selected on this device only. Secure upload will be enabled after the authenticated API integration is complete.");
    } catch {
      Alert.alert("Unable to select file", "Please try again.");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.iconWrap}><Ionicons name="folder-open-outline" size={29} color={colors.accent}/></View>
        <Text style={styles.title}>Document vault</Text>
        <Text style={styles.subtitle}>A private home for important documents. Your files must stay private and accessible only to your account.</Text>
        <View style={styles.empty}>
          <Ionicons name="file-tray-outline" size={44} color={colors.muted}/>
          <Text style={styles.emptyTitle}>Your vault is not connected yet</Text>
          <Text style={styles.emptyText}>No server documents are shown in this foundation build. Connect the authenticated API before uploading or downloading real documents.</Text>
          <Pressable onPress={chooseDocument} style={styles.button}><Ionicons name="document-attach-outline" size={19} color={colors.background}/><Text style={styles.buttonText}>Choose a test document</Text></Pressable>
          {pickedName ? <Text style={styles.fileName}>Selected locally: {pickedName}</Text> : null}
        </View>
        <View style={styles.securityNote}><Ionicons name="lock-closed-outline" size={18} color={colors.warning}/><Text style={styles.noteText}>Selecting a file does not upload it. Uploads will require authentication, server-side ownership checks, type/size validation, and private storage.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},content:{padding:22,paddingBottom:40},back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:30},backText:{color:colors.text,fontSize:14},iconWrap:{width:58,height:58,borderRadius:18,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:17},title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:9,marginBottom:25},empty:{alignItems:"center",padding:22,borderRadius:22,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},emptyTitle:{color:colors.text,fontSize:17,fontWeight:"700",textAlign:"center",marginTop:15},emptyText:{color:colors.muted,fontSize:13,lineHeight:20,textAlign:"center",marginTop:8},button:{marginTop:20,backgroundColor:colors.accent,borderRadius:13,paddingVertical:13,paddingHorizontal:17,flexDirection:"row",alignItems:"center",gap:8},buttonText:{color:colors.background,fontSize:14,fontWeight:"800"},fileName:{color:colors.accent,fontSize:12,marginTop:14,textAlign:"center"},securityNote:{flexDirection:"row",alignItems:"flex-start",gap:10,backgroundColor:"#24251f",borderRadius:14,borderWidth:1,borderColor:"#51482c",padding:14,marginTop:18},noteText:{flex:1,color:"#e8d7a7",fontSize:12,lineHeight:18}
});
