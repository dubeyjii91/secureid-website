import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../src/theme";
import { API_BASE_URL, createDocumentShare, listDocuments, listShares, revokeShare, type DocumentRecord, type ShareRecord } from "../src/api";

export default function ShareScreen() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      const [docs, links] = await Promise.all([listDocuments(), listShares()]);
      setDocuments(docs.documents || []);
      setShares(links.shares || []);
    } catch (error: any) {
      if (error?.status === 401) router.replace("/login");
      else if (error?.status === 403) router.replace("/mfa");
      else Alert.alert("Sharing unavailable", error?.message || "Unable to load your secure shares.");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createShare(document: DocumentRecord) {
    setBusyId(document.id);
    try {
      const result = await createDocumentShare(document.id, "Shared from SecureID mobile");
      const url = `${API_BASE_URL}/api/document-share/${result.shareToken}`;
      await Share.share({ title: `SecureID document: ${document.name}`, message: `Secure, time-limited document link (expires ${new Date(result.shareExpiresAt).toLocaleString()}):\n${url}` });
      await load();
    } catch (error: any) {
      Alert.alert("Share creation failed", error?.message || "Please try again.");
    } finally { setBusyId(""); }
  }

  function confirmRevoke(share: ShareRecord) {
    Alert.alert("Revoke this share?", "Anyone using this link will immediately lose access.", [
      { text: "Cancel", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: async () => {
        setBusyId(share.id);
        try { await revokeShare(share.type, share.id); await load(); }
        catch (error: any) { Alert.alert("Could not revoke", error?.message || "Please try again."); }
        finally { setBusyId(""); }
      }},
    ]);
  }

  const activeShares = shares.filter(s => !s.revokedAt && Date.parse(s.expiresAt) > Date.now());

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {setRefreshing(true);void load();}} tintColor={colors.accent}/>}>
        <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.iconWrap}><Ionicons name="share-social-outline" size={29} color={colors.accent}/></View>
        <Text style={styles.title}>Secure sharing</Text>
        <Text style={styles.subtitle}>Create expiring links for your documents and revoke access whenever you need to. The server enforces expiry and ownership.</Text>
        <Text style={styles.sectionTitle}>Create a document link</Text>
        {loading ? <ActivityIndicator color={colors.accent} style={{margin:22}}/> : documents.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyText}>Upload a document to your vault before sharing it.</Text></View>
        ) : documents.map(document => (
          <View key={document.id} style={styles.document}>
            <View style={styles.fileIcon}><Ionicons name="document-text-outline" size={20} color={colors.accent}/></View>
            <View style={styles.copy}><Text numberOfLines={1} style={styles.documentName}>{document.name}</Text><Text style={styles.documentMeta}>Private document</Text></View>
            <Pressable disabled={!!busyId} onPress={() => createShare(document)} style={styles.shareButton}>
              {busyId === document.id ? <ActivityIndicator color={colors.background}/> : <Ionicons name="share-outline" size={19} color={colors.background}/>}
            </Pressable>
          </View>
        ))}
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Active share links</Text><Text style={styles.count}>{activeShares.length}</Text></View>
        {shares.length === 0 && !loading ? <View style={styles.empty}><Text style={styles.emptyText}>No share links have been created yet.</Text></View> : shares.map(share => {
          const active = !share.revokedAt && Date.parse(share.expiresAt) > Date.now();
          return <View key={`${share.type}-${share.id}`} style={styles.shareRow}>
            <View style={styles.shareIcon}><Ionicons name={share.type === "document" ? "document-outline" : "id-card-outline"} size={20} color={colors.accent}/></View>
            <View style={styles.copy}><Text style={styles.documentName} numberOfLines={1}>{share.name || (share.type === "identity" ? "Identity share" : "Document share")}</Text><Text style={styles.documentMeta}>{active ? `Expires ${new Date(share.expiresAt).toLocaleDateString()}` : share.revokedAt ? "Revoked" : "Expired"}</Text></View>
            {active ? <Pressable disabled={!!busyId} onPress={() => confirmRevoke(share)} style={styles.revoke}><Text style={styles.revokeText}>{busyId === share.id ? "…" : "Revoke"}</Text></Pressable> : <Text style={styles.inactive}>Inactive</Text>}
          </View>;
        })}
        <View style={styles.notice}><Ionicons name="time-outline" size={18} color={colors.accent}/><Text style={styles.noticeText}>Document share links expire automatically after the server-defined time limit. Revocation takes effect on the server, not just in this app.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},content:{padding:22,paddingBottom:40},back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:30},backText:{color:colors.text,fontSize:14},
  iconWrap:{width:58,height:58,borderRadius:18,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:17},title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:9,marginBottom:24},
  sectionHeader:{flexDirection:"row",alignItems:"center",marginTop:28,marginBottom:12},sectionTitle:{color:colors.text,fontSize:16,fontWeight:"800",flex:1},count:{color:colors.accent,fontSize:13,fontWeight:"800"},
  document:{flexDirection:"row",alignItems:"center",padding:12,borderRadius:15,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,marginBottom:9},fileIcon:{width:40,height:40,borderRadius:12,backgroundColor:"#153444",alignItems:"center",justifyContent:"center"},copy:{flex:1,marginHorizontal:10},documentName:{color:colors.text,fontSize:13,fontWeight:"700"},documentMeta:{color:colors.muted,fontSize:11,marginTop:4},shareButton:{width:40,height:40,borderRadius:12,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center"},
  empty:{padding:18,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},emptyText:{color:colors.muted,fontSize:12,lineHeight:18},
  shareRow:{flexDirection:"row",alignItems:"center",padding:12,borderRadius:14,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,marginBottom:8},shareIcon:{width:39,height:39,borderRadius:12,backgroundColor:"#153444",alignItems:"center",justifyContent:"center"},revoke:{paddingHorizontal:10,paddingVertical:8,borderRadius:9,borderWidth:1,borderColor:"#704040"},revokeText:{color:colors.danger,fontSize:11,fontWeight:"800"},inactive:{color:colors.muted,fontSize:10,fontWeight:"700"},
  notice:{flexDirection:"row",alignItems:"flex-start",gap:10,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.border,padding:14,marginTop:18},noticeText:{flex:1,color:colors.muted,fontSize:12,lineHeight:18}
});
