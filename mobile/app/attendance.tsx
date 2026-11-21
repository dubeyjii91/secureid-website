import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../src/theme";
import {
  closeAttendanceSession,
  checkInWithAttendanceQr,
  getAttendanceRecords,
  getAttendanceSessions,
  listInstitutionMemberships,
  listMyStaffAttendance,
  rotateAttendanceQr,
  startAttendanceSession,
  type InstitutionMembership,
  type StaffAttendanceRecord,
  type StaffAttendanceSession,
} from "../src/api";

const STAFF_ROLES = new Set(["institution_admin", "reviewer", "warden"]);
type Mode = "home" | "scan" | "qr" | "result";

function parseAttendanceQr(value: string) {
  return /^secureid:\/\/attendance\/[A-Za-z0-9_-]{40,64}$/.test(value);
}

function formatDate(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "";
}

export default function AttendanceScreen() {
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [memberships, setMemberships] = useState<InstitutionMembership[]>([]);
  const [institutionId, setInstitutionId] = useState("");
  const [sessions, setSessions] = useState<StaffAttendanceSession[]>([]);
  const [myAttendance, setMyAttendance] = useState<StaffAttendanceRecord[]>([]);
  const [session, setSession] = useState<StaffAttendanceSession | null>(null);
  const [qrData, setQrData] = useState("");
  const [qrExpiresAt, setQrExpiresAt] = useState("");
  const [sessionTitle, setSessionTitle] = useState("Staff attendance");
  const [mode, setMode] = useState<Mode>("home");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sessionRecords, setSessionRecords] = useState<Record<string, StaffAttendanceRecord[]>>({});
  const scanning = useRef(false);
  const rotation = useRef(false);

  const activeMemberships = useMemo(() => memberships.filter(
    (membership) => membership.status === "active" && STAFF_ROLES.has(membership.role),
  ), [memberships]);
  const selectedMembership = activeMemberships.find((item) => item.institutionId === institutionId);
  const canManage = Boolean(selectedMembership);

  const loadWorkspace = useCallback(async () => {
    setError("");
    try {
      const result = await listInstitutionMemberships();
      const rows = result.memberships || [];
      setMemberships(rows);
      const activeStaff = rows.filter((item) => item.status === "active" && STAFF_ROLES.has(item.role));
      setInstitutionId((current) => activeStaff.some((item) => item.institutionId === current) ? current : activeStaff[0]?.institutionId || "");
    } catch (requestError: any) {
      if (requestError?.status === 401) router.replace("/login");
      else if (requestError?.status === 403) router.replace("/mfa");
      else setError(requestError?.message || "Could not load your institution access.");
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadWorkspace(); }, [loadWorkspace]));

  const loadAttendance = useCallback(async () => {
    if (!institutionId) { setSessions([]); setMyAttendance([]); return; }
    try {
      const [mine, sessionList] = await Promise.all([
        listMyStaffAttendance(institutionId),
        getAttendanceSessions(institutionId).catch(() => ({ success: true, sessions: [] as StaffAttendanceSession[] })),
      ]);
      setMyAttendance(mine.attendance || []);
      setSessions(sessionList.sessions || []);
    } catch (requestError: any) {
      setError(requestError?.message || "Could not load attendance records.");
    }
  }, [institutionId]);

  useEffect(() => { void loadAttendance(); }, [loadAttendance]);

  const rotateQr = useCallback(async (target: StaffAttendanceSession) => {
    if (!institutionId || rotation.current) return;
    rotation.current = true;
    try {
      const result = await rotateAttendanceQr(institutionId, target.id);
      setQrData(result.challenge.qrCodeDataUrl);
      setQrExpiresAt(result.challenge.expiresAt);
      setError("");
    } catch (requestError: any) {
      setError(requestError?.message || "Could not refresh the attendance code.");
    } finally { rotation.current = false; }
  }, [institutionId]);

  useEffect(() => {
    if (mode !== "qr" || !session || !focused) return;
    void rotateQr(session);
    const timer = setInterval(() => { void rotateQr(session); }, 12_000);
    return () => clearInterval(timer);
  }, [focused, mode, rotateQr, session]);

  useEffect(() => {
    if (mode !== "qr") return;
    const updateCountdown = () => setCountdown(Math.max(0, Math.ceil((Date.parse(qrExpiresAt) - Date.now()) / 1000)) || 0);
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [mode, qrExpiresAt]);

  async function beginSession() {
    if (!institutionId || sessionTitle.trim().length < 2) {
      setError("Choose an institution and enter a session name.");
      return;
    }
    setBusy(true); setError("");
    try {
      const result = await startAttendanceSession(institutionId, sessionTitle.trim());
      setSession(result.session);
      setQrData("");
      setMode("qr");
      setMessage("");
      await loadAttendance();
    } catch (requestError: any) {
      setError(requestError?.message || "Could not start the attendance session.");
    } finally { setBusy(false); }
  }

  async function endSession() {
    if (!session || !institutionId) return;
    setBusy(true); setError("");
    try {
      await closeAttendanceSession(institutionId, session.id);
      setSession(null); setQrData(""); setMode("home");
      await loadAttendance();
    } catch (requestError: any) {
      setError(requestError?.message || "Could not close this attendance session.");
    } finally { setBusy(false); }
  }

  async function openScanner() {
    setError(""); setMessage(""); scanning.current = false;
    if (!permission?.granted) {
      const response = await requestPermission();
      if (!response.granted) {
        setError("Camera permission is required. Enable camera access in your device settings to scan attendance QR codes.");
        return;
      }
    }
    setMode("scan");
  }

  async function handleCameraScan(value: string) {
    if (scanning.current) return;
    if (!parseAttendanceQr(value)) {
      setError("This is not a SecureID attendance code. Keep the live camera open and scan the current institution QR.");
      return;
    }
    scanning.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await checkInWithAttendanceQr(value);
      setMessage(`Attendance recorded for ${result.attendance.sessionTitle} at ${formatDate(result.attendance.checkedInAt)}.`);
      setMode("result");
      await loadAttendance();
    } catch (requestError: any) {
      setError(requestError?.message || "The QR could not be accepted. Scan the current code and try again.");
      scanning.current = false;
    } finally { setBusy(false); }
  }

  async function toggleSessionRecords(target: StaffAttendanceSession) {
    if (!institutionId) return;
    setBusy(true); setError("");
    try {
      if (sessionRecords[target.id]) {
        setSessionRecords((current) => { const next = { ...current }; delete next[target.id]; return next; });
      } else {
        const result = await getAttendanceRecords(institutionId, target.id);
        setSessionRecords((current) => ({ ...current, [target.id]: result.records || [] }));
      }
    } catch (requestError: any) { setError(requestError?.message || "Could not load this session's attendance."); }
    finally { setBusy(false); }
  }

  const scanningActive = mode === "scan" && focused && !scanning.current && !busy;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Ionicons name="arrow-back" size={20} color={colors.text} /><Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.heroIcon}><Ionicons name="scan-outline" size={29} color={colors.accent} /></View>
        <Text style={styles.title}>Staff attendance</Text>
        <Text style={styles.subtitle}>Teachers and institution staff can check in using their SecureID app and the live camera scanner.</Text>

        {error ? <View accessibilityRole="alert" style={styles.errorBox}><Ionicons name="alert-circle-outline" size={19} color={colors.danger}/><Text style={styles.errorText}>{error}</Text></View> : null}
        {message ? <View style={styles.successBox}><Ionicons name="checkmark-circle-outline" size={20} color={colors.accent}/><Text style={styles.successText}>{message}</Text></View> : null}

        {mode !== "qr" && mode !== "scan" && activeMemberships.length > 1 ? <>
          <Text style={styles.sectionTitle}>Your institution</Text>
          {activeMemberships.map((membership) => (
            <Pressable key={membership.institutionId} onPress={() => { setInstitutionId(membership.institutionId); setMessage(""); setError(""); }} style={[styles.institution, membership.institutionId === institutionId && styles.institutionSelected]}>
              <View style={styles.institutionIcon}><Ionicons name="school-outline" size={20} color={colors.accent}/></View>
              <View style={styles.copy}><Text style={styles.cardTitle}>{membership.institutionName}</Text><Text style={styles.meta}>{membership.role.replaceAll("_", " ")}</Text></View>
              <Ionicons name={membership.institutionId === institutionId ? "radio-button-on" : "radio-button-off"} size={20} color={colors.accent}/>
            </Pressable>
          ))}
        </> : null}
        {selectedMembership && activeMemberships.length === 1 && mode !== "qr" && mode !== "scan" ? (
          <View style={styles.selectedInstitution}><Ionicons name="school-outline" size={19} color={colors.accent}/><Text style={styles.selectedInstitutionText}>{selectedMembership.institutionName}</Text><Text style={styles.roleTag}>{selectedMembership.role.replaceAll("_", " ")}</Text></View>
        ) : null}

        {!selectedMembership && mode === "home" ? <View style={styles.empty}>
          <Ionicons name="business-outline" size={26} color={colors.muted}/>
          <Text style={styles.emptyTitle}>No staff access found</Text>
          <Text style={styles.emptyText}>Ask your institution administrator to activate your SecureID staff membership before using attendance.</Text>
        </View> : null}

        {selectedMembership && mode === "home" ? <>
          <View style={styles.infoCard}><Ionicons name="lock-closed-outline" size={19} color={colors.accent}/><Text style={styles.infoText}>Attendance is tied to your active institution role and MFA-protected SecureID account.</Text></View>
          <Text style={styles.sectionTitle}>Take attendance</Text>
          <TextInput value={sessionTitle} onChangeText={setSessionTitle} maxLength={100} placeholder="Session name, for example Morning check-in" placeholderTextColor={colors.muted} style={styles.input}/>
          <Pressable accessibilityRole="button" disabled={busy || sessionTitle.trim().length < 2} onPress={() => void beginSession()} style={[styles.primaryButton,(busy || sessionTitle.trim().length < 2) && styles.disabled]}>
            {busy ? <ActivityIndicator color={colors.background}/> : <Ionicons name="qr-code-outline" size={20} color={colors.background}/>}
            <Text style={styles.primaryText}>Start session and show QR</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void openScanner()} style={styles.secondaryButton}>
            <Ionicons name="camera-outline" size={20} color={colors.accent}/><Text style={styles.secondaryText}>Scan attendance QR</Text>
          </Pressable>
          <View style={styles.notice}><Ionicons name="shield-checkmark-outline" size={18} color={colors.warning}/><Text style={styles.noticeText}>Scanning is camera-only; SecureID provides no gallery or image-upload route for attendance. Codes rotate every 12 seconds and each account can check in once per session. A photo of a current code could still be scanned before it expires, so display it where staff can supervise it.</Text></View>

          <Text style={[styles.sectionTitle,styles.sectionGap]}>My recent check-ins</Text>
          {myAttendance.length ? myAttendance.slice(0,8).map((record) => <View key={record.id} style={styles.recordRow}>
            <View style={styles.recordIcon}><Ionicons name="checkmark" size={18} color={colors.accent}/></View><View style={styles.copy}><Text style={styles.cardTitle}>{record.sessionTitle}</Text><Text style={styles.meta}>{formatDate(record.checkedInAt)}</Text></View>
          </View>) : <Text style={styles.emptyInline}>No attendance records for this institution yet.</Text>}

          <Text style={[styles.sectionTitle,styles.sectionGap]}>Recent institution sessions</Text>
          {sessions.length ? sessions.slice(0,10).map((item) => <View key={item.id}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void toggleSessionRecords(item)} style={styles.recordRow}>
              <View style={styles.recordIcon}><Ionicons name={item.status === "open" ? "radio-button-on" : "time-outline"} size={18} color={item.status === "open" ? colors.accent : colors.muted}/></View>
              <View style={styles.copy}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.meta}>{formatDate(item.createdAt)} · {item.checkInCount || 0} check-ins · {item.status}</Text></View>
              <Ionicons name={sessionRecords[item.id] ? "chevron-up" : "chevron-down"} size={18} color={colors.muted}/>
            </Pressable>
            {sessionRecords[item.id]?.map((record) => <View key={record.id} style={styles.sessionRecord}><Text style={styles.meta}>{record.email || record.userId} · {formatDate(record.checkedInAt)}</Text></View>)}
          </View>) : <Text style={styles.emptyInline}>No institution sessions yet.</Text>}
        </> : null}

        {mode === "qr" && session ? <>
          <View style={styles.sessionHeader}><View style={styles.liveDot}/><Text style={styles.liveText}>LIVE SESSION</Text></View>
          <Text style={styles.sessionTitle}>{session.title}</Text>
          <Text style={styles.sessionSub}>Let each staff member scan this code using SecureID on their own phone.</Text>
          <View style={styles.qrFrame}>
            {qrData ? <Image source={{uri:qrData}} resizeMode="contain" style={styles.qrImage}/> : <View style={styles.qrLoading}><ActivityIndicator size="large" color={colors.accent}/><Text style={styles.meta}>Creating secure QR…</Text></View>}
          </View>
          <View style={styles.timerPill}><Ionicons name="refresh-outline" size={17} color={colors.accent}/><Text style={styles.timerText}>{countdown > 0 ? `Refreshing in ${countdown}s` : "Refreshing code…"}</Text></View>
          <Text style={styles.finePrint}>This QR expires automatically. Keep the screen visible only during supervised check-in.</Text>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void endSession()} style={styles.dangerButton}><Ionicons name="stop-circle-outline" size={20} color={colors.danger}/><Text style={styles.dangerText}>{busy ? "Closing…" : "End attendance session"}</Text></Pressable>
        </> : null}

        {mode === "scan" ? <>
          <View style={styles.scanHeader}><Text style={styles.sectionTitle}>Scan live QR</Text><Pressable accessibilityRole="button" onPress={() => { setMode("home"); scanning.current = false; setError(""); }}><Text style={styles.cancelText}>Cancel</Text></Pressable></View>
          <Text style={styles.sessionSub}>Point the back camera at the current SecureID attendance code.</Text>
          {!permission ? <View style={styles.cameraPlaceholder}><ActivityIndicator color={colors.accent}/></View> : !permission.granted ? <View style={styles.cameraPermission}><Ionicons name="camera-outline" size={26} color={colors.accent}/><Text style={styles.emptyText}>Allow camera access to scan the live code.</Text><Pressable accessibilityRole="button" onPress={() => void openScanner()} style={styles.primaryButton}><Text style={styles.primaryText}>Allow camera</Text></Pressable></View> : scanningActive ? <View style={styles.cameraFrame}>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{barcodeTypes:["qr"]}} onBarcodeScanned={({data}) => void handleCameraScan(data)}/>
            <View pointerEvents="none" style={styles.scanGuide}><View style={styles.scanCornerTopLeft}/><View style={styles.scanCornerTopRight}/><View style={styles.scanCornerBottomLeft}/><View style={styles.scanCornerBottomRight}/></View>
            <View pointerEvents="none" style={styles.scanHint}><Text style={styles.scanHintText}>Align the current QR inside the frame</Text></View>
          </View> : <View style={styles.cameraPlaceholder}><ActivityIndicator color={colors.accent}/><Text style={styles.meta}>Checking attendance…</Text></View>}
          <View style={styles.infoCard}><Ionicons name="camera-outline" size={19} color={colors.accent}/><Text style={styles.infoText}>Only the live camera preview is used. Select a current, on-screen SecureID attendance QR.</Text></View>
        </> : null}

        {mode === "result" ? <View style={styles.resultCard}>
          <View style={styles.resultIcon}><Ionicons name={message ? "checkmark" : "alert"} size={30} color={message ? colors.background : colors.danger}/></View>
          <Text style={styles.resultTitle}>{message ? "Check-in complete" : "Check-in status"}</Text>
          <Text style={styles.resultText}>{message || error}</Text>
          <Pressable accessibilityRole="button" onPress={() => { setMode("home"); setError(""); setMessage(""); }} style={styles.primaryButton}><Text style={styles.primaryText}>Done</Text></Pressable>
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.background},content:{padding:22,paddingBottom:42},back:{flexDirection:"row",alignItems:"center",gap:7,marginBottom:24},backText:{color:colors.text,fontSize:14},
  heroIcon:{width:58,height:58,borderRadius:18,backgroundColor:"#153444",alignItems:"center",justifyContent:"center",marginBottom:16},title:{color:colors.text,fontSize:29,fontWeight:"800"},subtitle:{color:colors.muted,fontSize:14,lineHeight:21,marginTop:8,marginBottom:21},
  sectionTitle:{color:colors.text,fontSize:16,fontWeight:"800",marginBottom:11},sectionGap:{marginTop:27},institution:{flexDirection:"row",alignItems:"center",backgroundColor:colors.surface,borderRadius:15,borderWidth:1,borderColor:colors.border,padding:12,marginBottom:9},institutionSelected:{borderColor:colors.accent},institutionIcon:{width:40,height:40,borderRadius:12,backgroundColor:"#153444",alignItems:"center",justifyContent:"center"},copy:{flex:1,marginHorizontal:11},cardTitle:{color:colors.text,fontSize:13,fontWeight:"700"},meta:{color:colors.muted,fontSize:11,marginTop:4,lineHeight:16},selectedInstitution:{flexDirection:"row",alignItems:"center",gap:9,backgroundColor:colors.surface,borderRadius:13,borderWidth:1,borderColor:colors.border,padding:12,marginBottom:18},selectedInstitutionText:{color:colors.text,fontWeight:"700",fontSize:13,flex:1},roleTag:{color:colors.accent,fontSize:10,fontWeight:"800",textTransform:"uppercase"},
  input:{minHeight:50,borderRadius:13,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,color:colors.text,paddingHorizontal:14,fontSize:14,marginBottom:10},primaryButton:{minHeight:50,backgroundColor:colors.accent,borderRadius:13,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,paddingHorizontal:16,marginTop:8},primaryText:{color:colors.background,fontSize:14,fontWeight:"800"},disabled:{opacity:0.5},secondaryButton:{minHeight:50,borderRadius:13,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9,marginTop:10},secondaryText:{color:colors.accent,fontSize:14,fontWeight:"700"},
  infoCard:{flexDirection:"row",alignItems:"flex-start",gap:10,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.border,padding:13,marginTop:16},infoText:{flex:1,color:colors.muted,fontSize:12,lineHeight:18},notice:{flexDirection:"row",alignItems:"flex-start",gap:9,backgroundColor:"#24251f",borderRadius:14,borderWidth:1,borderColor:"#51482c",padding:13,marginTop:12},noticeText:{flex:1,color:"#e8d7a7",fontSize:11,lineHeight:17},
  empty:{alignItems:"center",backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:21,marginTop:8},emptyTitle:{color:colors.text,fontWeight:"800",fontSize:15,marginTop:12},emptyText:{color:colors.muted,fontSize:12,lineHeight:18,textAlign:"center",marginTop:8},emptyInline:{color:colors.muted,fontSize:12,lineHeight:18,padding:13,backgroundColor:colors.surface,borderRadius:13},
  recordRow:{flexDirection:"row",alignItems:"center",minHeight:64,padding:10,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:14,marginBottom:8},recordIcon:{width:38,height:38,borderRadius:12,backgroundColor:"#153444",alignItems:"center",justifyContent:"center"},sessionRecord:{marginTop:-5,marginBottom:8,marginLeft:14,paddingHorizontal:13,paddingVertical:9,borderLeftWidth:2,borderLeftColor:colors.accent},
  sessionHeader:{flexDirection:"row",alignItems:"center",gap:8,marginTop:10},liveDot:{width:8,height:8,borderRadius:4,backgroundColor:colors.accent},liveText:{color:colors.accent,fontSize:10,fontWeight:"900",letterSpacing:1.4},sessionTitle:{color:colors.text,fontSize:23,fontWeight:"800",marginTop:13},sessionSub:{color:colors.muted,fontSize:13,lineHeight:19,marginTop:7},qrFrame:{width:"100%",aspectRatio:1,marginTop:20,borderRadius:18,backgroundColor:"#fff",alignItems:"center",justifyContent:"center",padding:16},qrImage:{width:"100%",height:"100%"},qrLoading:{alignItems:"center",gap:12},timerPill:{alignSelf:"center",flexDirection:"row",alignItems:"center",gap:7,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:20,paddingHorizontal:14,paddingVertical:9,marginTop:14},timerText:{color:colors.accent,fontSize:12,fontWeight:"700"},finePrint:{textAlign:"center",color:colors.muted,fontSize:11,lineHeight:17,marginTop:12},dangerButton:{minHeight:48,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,borderWidth:1,borderColor:"#704040",borderRadius:13,marginTop:19},dangerText:{color:colors.danger,fontSize:13,fontWeight:"700"},
  scanHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:7},cancelText:{color:colors.accent,fontWeight:"700",fontSize:13},cameraFrame:{height:360,borderRadius:18,overflow:"hidden",marginTop:17,backgroundColor:"#000"},cameraPlaceholder:{height:260,borderRadius:18,backgroundColor:colors.surface,alignItems:"center",justifyContent:"center",gap:12,marginTop:17},cameraPermission:{alignItems:"center",gap:12,backgroundColor:colors.surface,borderRadius:16,padding:20,marginTop:16},scanGuide:{position:"absolute",width:226,height:226,top:67,left:"50%",marginLeft:-113},scanCornerTopLeft:{position:"absolute",left:0,top:0,width:34,height:34,borderTopWidth:4,borderLeftWidth:4,borderColor:colors.accent,borderTopLeftRadius:10},scanCornerTopRight:{position:"absolute",right:0,top:0,width:34,height:34,borderTopWidth:4,borderRightWidth:4,borderColor:colors.accent,borderTopRightRadius:10},scanCornerBottomLeft:{position:"absolute",left:0,bottom:0,width:34,height:34,borderBottomWidth:4,borderLeftWidth:4,borderColor:colors.accent,borderBottomLeftRadius:10},scanCornerBottomRight:{position:"absolute",right:0,bottom:0,width:34,height:34,borderBottomWidth:4,borderRightWidth:4,borderColor:colors.accent,borderBottomRightRadius:10},scanHint:{position:"absolute",alignSelf:"center",bottom:18,backgroundColor:"rgba(4,12,22,0.8)",paddingHorizontal:13,paddingVertical:9,borderRadius:20},scanHintText:{color:"#fff",fontSize:11,fontWeight:"700"},
  resultCard:{alignItems:"center",backgroundColor:colors.surface,borderRadius:18,borderWidth:1,borderColor:colors.border,padding:20,marginTop:22},resultIcon:{width:62,height:62,borderRadius:31,backgroundColor:colors.accent,alignItems:"center",justifyContent:"center"},resultTitle:{color:colors.text,fontSize:20,fontWeight:"800",marginTop:14},resultText:{color:colors.muted,fontSize:13,lineHeight:20,textAlign:"center",marginTop:8},
  errorBox:{flexDirection:"row",alignItems:"flex-start",gap:9,backgroundColor:"#301e26",borderColor:"#704040",borderWidth:1,borderRadius:13,padding:12,marginBottom:12},errorText:{color:"#ffd2d2",flex:1,fontSize:12,lineHeight:18},successBox:{flexDirection:"row",alignItems:"flex-start",gap:9,backgroundColor:"#132c2c",borderColor:"#2a5b55",borderWidth:1,borderRadius:13,padding:12,marginBottom:12},successText:{color:"#c6f3df",flex:1,fontSize:12,lineHeight:18},
});
