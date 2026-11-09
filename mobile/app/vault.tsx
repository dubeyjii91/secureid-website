import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../src/theme";
import { areExpiryRemindersEnabled, disableExpiryReminders, enableExpiryReminders, syncAllDocumentExpiryReminders, syncDocumentExpiryReminder } from "../src/expiry-reminders";
import { deleteDocument, downloadDocument, listDocuments, updateDocumentExpiry, uploadDocument, type DocumentRecord } from "../src/api";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function categoryLabel(category?: string) {
  const labels: Record<string, string> = {
    general: "General",
    aadhaar: "Aadhaar",
    pan: "PAN",
    passport: "Passport",
    voter_id: "Voter ID",
    driving_licence: "Driving licence",
    student_id: "Student ID",
    institution_proof: "Institution proof",
  };
  return category ? labels[category] || category.replace(/_/g, " ") : "General";
}

function localDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function expiryStatus(expiryDate?: string | null) {
  if (!expiryDate) return null;
  const today = localDateString();
  const days = Math.floor((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days < 0) return { label: "Expired", tone: "danger" as const };
  if (days <= 30) return { label: days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}`, tone: "warning" as const };
  return { label: `Expires ${expiryDate}`, tone: "normal" as const };
}

export default function VaultScreen() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const [savingExpiryId, setSavingExpiryId] = useState("");
  const [expiryDrafts, setExpiryDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const result = await listDocuments();
      const nextDocuments = result.documents || [];
      setDocuments(nextDocuments);
      await syncAllDocumentExpiryReminders(nextDocuments);
    } catch (error: any) {
      if (error?.status === 401) router.replace("/login");
      else if (error?.status === 403) router.replace("/mfa");
      else Alert.alert("Vault unavailable", error?.message || "Unable to load your documents.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void areExpiryRemindersEnabled().then(setRemindersEnabled).catch(() => setRemindersEnabled(false));
    void loadDocuments();
  }, [loadDocuments]);

  const categories = useMemo(() => {
    const found = Array.from(new Set(documents.map((document) => document.category || "general")));
    return ["all", ...found.sort()];
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return documents.filter((document) => {
      const category = document.category || "general";
      const matchesCategory = selectedCategory === "all" || category === selectedCategory;
      const matchesSearch = !normalizedSearch
        || document.name.toLocaleLowerCase().includes(normalizedSearch)
        || categoryLabel(category).toLocaleLowerCase().includes(normalizedSearch)
        || (document.expiryDate || "").includes(normalizedSearch);
      return matchesCategory && matchesSearch;
    });
  }, [documents, search, selectedCategory]);

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

  async function openDocument(document: DocumentRecord) {
    setDownloadingId(document.id);
    try { await downloadDocument(document.id, document.name, document.mimeType); }
    catch (error: any) { Alert.alert("Download failed",error?.message||"The document could not be downloaded."); }
    finally { setDownloadingId(""); }
  }

  async function saveExpiry(document: DocumentRecord) {
    const raw = (expiryDrafts[document.id] ?? document.expiryDate ?? "").trim();
    if (raw && !/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) {
      Alert.alert("Invalid date", "Use YYYY-MM-DD format, for example 2030-12-31.");
      return;
    }
    setSavingExpiryId(document.id);
    try {
      const result = await updateDocumentExpiry(document.id, raw || null);
      setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, expiryDate: result.expiryDate } : item));
      setExpiryDrafts((current) => ({ ...current, [document.id]: result.expiryDate || "" }));
      await syncDocumentExpiryReminder({ ...document, expiryDate: result.expiryDate });
      Alert.alert("Expiry date saved", result.expiryDate ? `Expiry date set to ${result.expiryDate}.` : "Expiry date removed.");
    } catch (error: any) {
      Alert.alert("Could not save expiry date", error?.message || "Please try again.");
    } finally {
      setSavingExpiryId("");
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
        <Pressable disabled={reminderBusy} onPress={async () => { setReminderBusy(true); try { if (remindersEnabled) { await disableExpiryReminders(); setRemindersEnabled(false); Alert.alert("Reminders disabled", "Scheduled document expiry reminders have been cancelled."); } else { const granted = await enableExpiryReminders(); if (!granted) { Alert.alert("Permission not granted", "Enable notifications in Android settings to receive expiry reminders."); } else { setRemindersEnabled(true); await syncAllDocumentExpiryReminders(documents); Alert.alert("Reminders enabled", "SecureID will remind you 30, 7 and 1 day before a document expires."); } } } catch (error: any) { Alert.alert("Reminder setting unavailable", error?.message || "Please try again."); } finally { setReminderBusy(false); } }} style={styles.reminderToggle}><Ionicons name={remindersEnabled ? "notifications" : "notifications-outline"} size={18} color={colors.accent}/><View style={{flex:1}}><Text style={styles.reminderTitle}>Expiry notifications</Text><Text style={styles.reminderSubtitle}>{remindersEnabled ? "On · reminders 30, 7 and 1 day before expiry" : "Off · enable optional local reminders"}</Text></View>{reminderBusy ? <ActivityIndicator color={colors.accent}/> : <Text style={styles.reminderAction}>{remindersEnabled ? "Turn off" : "Turn on"}</Text>}</Pressable>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Your documents</Text><Text style={styles.count}>{documents.length}</Text></View>
        {documents.length > 0 && (
          <View style={styles.filters}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color={colors.muted}/>
              <TextInput accessibilityLabel="Search documents" placeholder="Search name, type or expiry" placeholderTextColor={colors.muted} value={search} onChangeText={setSearch} style={styles.searchInput} returnKeyType="search" clearButtonMode="while-editing"/>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>
              {categories.map((category) => {
                const active = selectedCategory === category;
                return <Pressable key={category} onPress={() => setSelectedCategory(category)} style={[styles.categoryChip, active && styles.categoryChipActive]}><Text style={[styles.categoryText, active && styles.categoryTextActive]}>{category === "all" ? "All types" : categoryLabel(category)}</Text></Pressable>;
              })}
            </ScrollView>
          </View>
        )}
        {loading ? <ActivityIndicator color={colors.accent} style={{marginTop:30}}/> : documents.length === 0 ? (
          <View style={styles.empty}><Ionicons name="file-tray-outline" size={42} color={colors.muted}/><Text style={styles.emptyTitle}>Your vault is empty</Text><Text style={styles.emptyText}>Upload a PDF, JPG or PNG to store it in your private vault.</Text></View>
        ) : filteredDocuments.length === 0 ? (
          <View style={styles.empty}><Ionicons name="search-outline" size={38} color={colors.muted}/><Text style={styles.emptyTitle}>No matching documents</Text><Text style={styles.emptyText}>Try another search or choose a different document type.</Text><Pressable onPress={() => {setSearch("");setSelectedCategory("all");}} style={styles.clearFilters}><Text style={styles.clearFiltersText}>Clear filters</Text></Pressable></View>
        ) : filteredDocuments.map((document) => {
          const currentExpiry = expiryDrafts[document.id] ?? document.expiryDate ?? "";
          const status = expiryStatus(document.expiryDate);
          return (
            <View key={document.id} style={styles.document}>
              <View style={styles.documentTop}>
                <View style={styles.fileIcon}><Ionicons name={document.mimeType === "application/pdf" ? "document-text-outline" : "image-outline"} size={22} color={colors.accent}/></View>
                <View style={styles.fileCopy}><Text style={styles.fileName} numberOfLines={1}>{document.name}</Text><Text style={styles.fileMeta}>{formatSize(document.sizeBytes)} · {categoryLabel(document.category)}</Text></View>
                <Pressable onPress={() => openDocument(document)} disabled={!!downloadingId} accessibilityLabel={`Download ${document.name}`} style={styles.actionIcon}>{downloadingId===document.id?<ActivityIndicator color={colors.accent}/>:<Ionicons name="download-outline" size={19} color={colors.accent}/>}</Pressable>
                <Pressable onPress={() => removeDocument(document)} disabled={!!downloadingId} accessibilityLabel={`Delete ${document.name}`} style={styles.actionIcon}><Ionicons name="trash-outline" size={19} color={colors.danger}/></Pressable>
              </View>
              <View style={styles.expiryArea}>
                <View style={styles.expiryLabelRow}><Text style={styles.expiryLabel}>Expiry date (optional)</Text>{status && <Text style={[styles.expiryStatus, status.tone === "danger" ? styles.expiryDanger : status.tone === "warning" ? styles.expiryWarning : styles.expiryNormal]}>{status.label}</Text>}</View>
                <View style={styles.expiryEditRow}>
                  <TextInput accessibilityLabel={`Expiry date for ${document.name}`} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} value={currentExpiry} onChangeText={(value) => setExpiryDrafts((current) => ({ ...current, [document.id]: value }))} style={styles.expiryInput} autoCapitalize="none" keyboardType="numbers-and-punctuation" maxLength={10}/>
                  <Pressable onPress={() => void saveExpiry(document)} disabled={savingExpiryId === document.id} style={[styles.saveExpiry, savingExpiryId === document.id && {opacity:0.6}]}>{savingExpiryId === document.id ? <ActivityIndicator color={colors.background} size="small"/> : <Text style={styles.saveExpiryText}>Save</Text>}</Pressable>
                </View>
                <Text style={styles.expiryHint}>Expiry status is a reminder only; it does not verify document authenticity.</Text>
              </View>
            </View>
          );
        })}
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
  filters:{marginBottom:13,gap:11},searchBox:{height:46,flexDirection:"row",alignItems:"center",gap:9,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,borderRadius:13,paddingHorizontal:12},searchInput:{flex:1,color:colors.text,fontSize:13,paddingVertical:0},categoryList:{gap:8,paddingBottom:2},categoryChip:{borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,borderRadius:20,paddingHorizontal:13,paddingVertical:8},categoryChipActive:{borderColor:colors.accent,backgroundColor:"#153444"},categoryText:{color:colors.muted,fontSize:12,fontWeight:"700"},categoryTextActive:{color:colors.accent},clearFilters:{marginTop:14,paddingHorizontal:15,paddingVertical:9,borderRadius:10,backgroundColor:"#153444"},clearFiltersText:{color:colors.accent,fontSize:13,fontWeight:"800"},
  reminderToggle:{flexDirection:"row",alignItems:"center",gap:11,padding:13,borderRadius:13,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,marginTop:13},reminderTitle:{color:colors.text,fontSize:13,fontWeight:"800"},reminderSubtitle:{color:colors.muted,fontSize:10,marginTop:3},reminderAction:{color:colors.accent,fontSize:12,fontWeight:"900"},
  empty:{alignItems:"center",padding:24,borderRadius:18,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},emptyTitle:{color:colors.text,fontSize:16,fontWeight:"700",marginTop:13},emptyText:{color:colors.muted,fontSize:12,lineHeight:18,textAlign:"center",marginTop:7},
  document:{borderRadius:15,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,marginBottom:10,padding:12},documentTop:{flexDirection:"row",alignItems:"center"},fileIcon:{width:42,height:42,borderRadius:12,backgroundColor:"#153444",alignItems:"center",justifyContent:"center"},fileCopy:{flex:1,minWidth:0,marginHorizontal:10},fileName:{color:colors.text,fontSize:13,fontWeight:"700"},fileMeta:{color:colors.muted,fontSize:11,marginTop:4},actionIcon:{padding:8},
  expiryArea:{marginTop:13,paddingTop:12,borderTopWidth:1,borderTopColor:colors.border},expiryLabelRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:8},expiryLabel:{color:colors.text,fontSize:12,fontWeight:"700"},expiryStatus:{fontSize:11,fontWeight:"800"},expiryDanger:{color:colors.danger},expiryWarning:{color:"#E6A23C"},expiryNormal:{color:colors.muted},expiryEditRow:{flexDirection:"row",alignItems:"center",gap:8,marginTop:8},expiryInput:{flex:1,minWidth:0,height:40,borderWidth:1,borderColor:colors.border,borderRadius:10,paddingHorizontal:11,color:colors.text,fontSize:13},saveExpiry:{minWidth:62,height:40,borderRadius:10,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center",paddingHorizontal:12},saveExpiryText:{color:colors.background,fontSize:12,fontWeight:"900"},expiryHint:{color:colors.muted,fontSize:10,lineHeight:15,marginTop:6},
  securityNote:{flexDirection:"row",alignItems:"flex-start",gap:10,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.border,padding:14,marginTop:18},noteText:{flex:1,color:colors.muted,fontSize:12,lineHeight:18}
});
