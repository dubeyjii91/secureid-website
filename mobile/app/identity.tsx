import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { colors } from "../src/theme";
import { getIdentityProfile, saveIdentityProfile, type IdentityProfile } from "../src/api";

const fields: Array<{ key: keyof IdentityProfile; label: string; placeholder: string; keyboardType?: "default" | "email-address" | "phone-pad" | "numeric"; secure?: boolean; multiline?: boolean }> = [
  { key: "name", label: "Full name", placeholder: "Enter your name" },
  { key: "dateOfBirth", label: "Date of birth", placeholder: "YYYY-MM-DD" },
  { key: "age", label: "Age", placeholder: "Age", keyboardType: "numeric" },
  { key: "address", label: "Address", placeholder: "Enter address", multiline: true },
  { key: "email", label: "Email", placeholder: "name@example.com", keyboardType: "email-address" },
  { key: "phone", label: "Phone number", placeholder: "Phone number", keyboardType: "phone-pad" },
  { key: "identityId", label: "Identity ID (optional)", placeholder: "Enter an ID reference" },
  { key: "college", label: "College / Institution", placeholder: "Institution name" },
  { key: "studentId", label: "Student ID", placeholder: "Student ID reference" },
  { key: "governmentId", label: "Government ID (optional)", placeholder: "Avoid storing full sensitive numbers unless necessary", secure: true },
];

export default function IdentityProfileScreen() {
  const [profile, setProfile] = useState<IdentityProfile>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await getIdentityProfile();
        if (!active) return;
        setProfile(result.profile || {});
        setUpdatedAt(result.updatedAt);
      } catch (error: any) {
        if (error?.status === 401) router.replace("/login");
        else if (error?.status === 403) router.replace("/mfa");
        else Alert.alert("Profile unavailable", error?.message || "Could not load your identity profile.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  function updateField(key: keyof IdentityProfile, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveIdentityProfile(profile);
      setProfile(result.profile || profile);
      setUpdatedAt(result.updatedAt);
      Alert.alert("Saved securely", "Your identity details were saved. They are user-entered details, not official verification.");
    } catch (error: any) {
      Alert.alert("Could not save profile", error?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.back}><Ionicons name="arrow-back" size={20} color={colors.text}/><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.iconWrap}><Ionicons name="id-card-outline" size={28} color={colors.accent}/></View>
        <Text style={styles.title}>Identity profile</Text>
        <Text style={styles.subtitle}>Keep your identity details together in one profile. You control what you enter and what you share.</Text>
        <View style={styles.notice}><Ionicons name="information-circle-outline" size={19} color={colors.warning}/><Text style={styles.noticeText}>These details are user-provided. Saving a profile does not verify your identity with a government or institution.</Text></View>
        {loading ? <ActivityIndicator color={colors.accent} style={{marginTop:30}}/> : (
          <View style={styles.form}>
            {fields.map((field) => (
              <View key={field.key} style={styles.field}>
                <Text style={styles.label}>{field.label}</Text>
                <TextInput
                  accessibilityLabel={field.label}
                  value={String(profile[field.key] || "")}
                  onChangeText={(value) => updateField(field.key, value)}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.muted}
                  keyboardType={field.keyboardType || "default"}
                  secureTextEntry={field.secure}
                  multiline={field.multiline}
                  maxLength={500}
                  autoCapitalize={field.keyboardType === "email-address" ? "none" : "sentences"}
                  style={[styles.input, field.multiline && styles.multiline]}
                />
              </View>
            ))}
            <Pressable onPress={save} disabled={saving} style={[styles.button, saving && {opacity:0.65}]}>
              {saving ? <ActivityIndicator color={colors.background}/> : <><Ionicons name="save-outline" size={18} color={colors.background}/><Text style={styles.buttonText}>Save identity profile</Text></>}
            </Pressable>
            {updatedAt && <Text style={styles.updated}>Last saved {new Date(updatedAt).toLocaleString()}</Text>}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},content:{padding:22,paddingBottom:40},back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:26},backText:{color:colors.text,fontSize:14},
  iconWrap:{width:58,height:58,borderRadius:18,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:16},title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:9,marginBottom:18},
  notice:{flexDirection:"row",alignItems:"flex-start",gap:9,borderWidth:1,borderColor:"#51482c",backgroundColor:"#24251f",borderRadius:13,padding:13,marginBottom:18},noticeText:{flex:1,color:"#e8d7a7",fontSize:12,lineHeight:18},
  form:{gap:14},field:{gap:7},label:{color:colors.text,fontSize:13,fontWeight:"700"},input:{minHeight:46,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,borderRadius:12,paddingHorizontal:13,paddingVertical:11,color:colors.text,fontSize:14},multiline:{minHeight:90,textAlignVertical:"top"},
  button:{height:52,borderRadius:13,backgroundColor:colors.accent,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,marginTop:6},buttonText:{color:colors.background,fontSize:14,fontWeight:"900"},updated:{color:colors.muted,fontSize:11,textAlign:"center",marginTop:3}
});
