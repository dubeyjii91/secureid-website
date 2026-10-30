import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../src/theme";
import { deleteDocument, listDocuments, uploadDocument, type DocumentRecord } from "../src/api";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function VaultScreen() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const result = await listDocuments();
      setDocuments(result.documents || []);
    } catch (error: any) {
      if (error?.status === 401) router.replace("/login");
      else if (error?.status === 403) router.replace("/mfa");
      else Alert.alert("Vault unavailable", error?.message || "Unable to load your documents.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  async function chooseDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      setUploading(true);
      await uploadDocument({ uri: file.uri, name: file.name, mimeType: file.mimeType });
      Alert.alert("Upload complete", "Your document was encrypted and saved to your private SecureID vault.");
      await loadDocuments();
    } catch (error: any) {
      Alert.alert("Upload failed", error?.message || "The document could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }

  function removeDocument(document: DocumentRecord) {
    Alert.alert("Delete document?", `Delete ${document.name} from your vault? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await deleteDocument(document.id); await loadDocuments(); }
        catch (error: any) { Alert.alert("Delete failed", error?.message || "Please try again."); }
      }},
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {setRefreshing(true);void loadDocuments();}} tintColor={colors.accent}/>}>
        <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.iconWrap}><Ionicons name="folder-open-outline" size={29} color={colors.accent}/></View>
        <Text style={styles.title}>Document vault</Text>
        <Text style={styles.subtitle}>Your private documents, encrypted at rest and accessible only through your authenticated SecureID account.</Text>
        <Pressable onPress={chooseDocument} disabled={uploading} style={[styles.button,uploading && {opacity:0.65}]}>
          {uploading ? <ActivityIndicator color={colors.background}/> : <><Ionicons name="cloud-upload-outline" size={19} color={colors.background}/><Text style={styles.buttonText}>Upload a document</Text></>}
        </Pressable>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Your documents</Text><Text style={styles.count}>{documents.length}</Text></View>
        {loading ? <ActivityIndicator color={colors.accent} style={{marginTop:30}}/> : documents.length === 0 ? (
          <View style={styles.empty}><Ionicons name="file-tray-outline" size={42} color={colors.muted}/><Text style={styles.emptyTitle}>Your vault is empty</Text><Text style={styles.emptyText}>Upload a PDF, JPG or PNG to store it in your private vault.</Text></View>
        ) : documents.map((document) => (
          <View key={document.id} style={styles.document}>
            <View style={styles.fileIcon}><Ionicons name={document.mimeType === "application/pdf" ? "document-text-outline" : "image-outline"} size={22} color={colors.accent}/></View>
            <View style={styles.fileCopy}><Text style={styles.fileName} numberOfLines={1}>{document.name}</Text><Text style={styles.fileMeta}>{formatSize(document.sizeBytes)} · {document.category || "Private document"}</Text></View>
            <Pressable onPress={() => removeDocument(document)} accessibilityLabel={`Delete ${document.name}`} style={styles.delete}><Ionicons name="trash-outline" size={19} color={colors.danger}/></Pressable>
          </View>
        ))}
        <View style={styles.securityNote}><Ionicons name="lock-closed-outline" size={18} color={colors.accent}/><Text style={styles.noteText}>Files are validated by content type, encrypted by the server and protected by account ownership and MFA checks.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},content:{padding:22,paddingBottom:40},back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:30},backText:{color:colors.text,fontSize:14},
  iconWrap:{width:58,height:58,borderRadius:18,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:17},title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:9,marginBottom:22},
  button:{height:52,borderRadius:13,backgroundColor:colors.accent,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9},buttonText:{color:colors.background,fontSize:14,fontWeight:"900"},
  sectionHeader:{flexDirection:"row",alignItems:"center",marginTop:29,marginBottom:12},sectionTitle:{color:colors.text,fontSize:17,fontWeight:"800",flex:1},count:{color:colors.accent,fontSize:13,fontWeight:"800"},
  empty:{alignItems:"center",padding:24,borderRadius:18,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},emptyTitle:{color:colors.text,fontSize:16,fontWeight:"700",marginTop:13},emptyText:{color:colors.muted,fontSize:12,lineHeight:18,textAlign:"center",marginTop:7},
  document:{flexDirection:"row",alignItems:"center",padding:13,borderRadius:15,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,marginBottom:9},fileIcon:{width:42,height:42,borderRadius:12,backgroundColor:"#153444",alignItems:"center",justifyContent:"center"},fileCopy:{flex:1,marginHorizontal:11},fileName:{color:colors.text,fontSize:13,fontWeight:"700"},fileMeta:{color:colors.muted,fontSize:11,marginTop:4},delete:{padding:9},
  securityNote:{flexDirection:"row",alignItems:"flex-start",gap:10,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.border,padding:14,marginTop:18},noteText:{flex:1,color:colors.muted,fontSize:12,lineHeight:18}
});
