import { useEffect, useState } from "react";
import api from "./api.js";
import InstitutionStudents from "./institution-modules/InstitutionStudents.jsx";
import InstitutionStaff from "./institution-modules/InstitutionStaff.jsx";
import InstitutionFinance from "./institution-modules/InstitutionFinance.jsx";
import InstitutionAcademics from "./institution-modules/InstitutionAcademics.jsx";

const tabs = ["Students","Staff","Finance","Academics"];
const money = paise => "₹" + (Number(paise || 0) / 100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});

export default function InstitutionModules({ institutionId }) {
  const [tab,setTab]=useState("Students");
  const [students,setStudents]=useState([]);
  const [staff,setStaff]=useState([]);
  const [invoices,setInvoices]=useState([]);
  const [courses,setCourses]=useState([]);
  const [assessments,setAssessments]=useState([]);
  const [profileDrafts,setProfileDrafts]=useState({});
  const [overview,setOverview]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [staffForm,setStaffForm]=useState({fullName:"",email:"",employeeCode:"",department:"",designation:""});
  const [invoiceForm,setInvoiceForm]=useState({studentUserId:"",feeHead:"Tuition fee",description:"",amount:"",dueDate:""});
  const [courseForm,setCourseForm]=useState({courseCode:"",title:"",department:"",academicYear:"2026-2027"});
  const [attendanceForm,setAttendanceForm]=useState({courseId:"",studentUserId:"",date:new Date().toISOString().slice(0,10),status:"present"});
  const [paymentForm,setPaymentForm]=useState({invoiceId:"",amount:"",method:"upi",reference:""});
  const [assessmentForm,setAssessmentForm]=useState({courseId:"",title:"",examDate:new Date().toISOString().slice(0,10),totalMarks:"100"});
  const [resultForm,setResultForm]=useState({assessmentId:"",studentUserId:"",marksObtained:""});

  async function load() {
    if(!institutionId)return;
    setBusy(true);setError("");
    try {
      const [s,st,f,c,o]=await Promise.all([
        api(`/api/institutions/${encodeURIComponent(institutionId)}/students`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/staff`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/finance`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/courses`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/operations/overview`,{cache:"no-store"})
      ]);
      setStudents(s.students||[]);setProfileDrafts(Object.fromEntries((s.students||[]).map(item=>[item.userId,{studentNumber:item.studentNumber||"",department:item.department||"",program:item.program||"",academicYear:item.academicYear||"",status:item.status||"active"}])));setStaff(st.staff||[]);setInvoices(f.invoices||[]);setCourses(c.courses||[]);setOverview(o.overview||null);
      const firstCourse=(c.courses||[])[0];
      if(firstCourse){setAssessmentForm(v=>({...v,courseId:v.courseId||firstCourse.id}));const a=await api(`/api/institutions/${encodeURIComponent(institutionId)}/courses/${encodeURIComponent(firstCourse.id)}/assessments`,{cache:"no-store"});setAssessments(a.assessments||[]);}else setAssessments([]);
    } catch(err){setError(err.message||"Institution modules could not be loaded.");}
    finally{setBusy(false);}
  }
  useEffect(()=>{load();},[institutionId]);

  async function run(action,success) {
    setBusy(true);setError("");setMessage("");
    try{await action();setMessage(success);await load();}
    catch(err){setError(err.message||"The operation could not be saved.");}
    finally{setBusy(false);}
  }
  async function saveStaff(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/staff`,{method:"POST",body:JSON.stringify(staffForm)}),"Staff record saved.");setStaffForm({fullName:"",email:"",employeeCode:"",department:"",designation:""});}
  async function saveInvoice(e){e.preventDefault();const student=students.find(s=>s.userId===invoiceForm.studentUserId);if(!student){setError("Choose a student from the directory.");return;}await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/finance/invoices`,{method:"POST",body:JSON.stringify({studentUserId:student.userId,feeHead:invoiceForm.feeHead,description:invoiceForm.description,amountPaise:Math.round(Number(invoiceForm.amount)*100),dueDate:invoiceForm.dueDate})}),"Fee invoice created.");setInvoiceForm(v=>({...v,amount:"",description:"",dueDate:""}));}
  async function saveCourse(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/courses`,{method:"POST",body:JSON.stringify(courseForm)}),"Course created.");setCourseForm(v=>({...v,courseCode:"",title:"",department:""}));}
  async function markAttendance(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/courses/${encodeURIComponent(attendanceForm.courseId)}/attendance`,{method:"POST",body:JSON.stringify(attendanceForm)}),"Attendance saved.");}
  async function receivePayment(e){e.preventDefault();const key=crypto.randomUUID();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/finance/invoices/${encodeURIComponent(paymentForm.invoiceId)}/payments`,{method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify({amountPaise:Math.round(Number(paymentForm.amount)*100),method:paymentForm.method,reference:paymentForm.reference,idempotencyKey:key})}),"Payment recorded.");setPaymentForm({invoiceId:"",amount:"",method:"upi",reference:""});}
  async function saveStudentProfile(userId){const draft=profileDrafts[userId]||{};await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/students/${encodeURIComponent(userId)}`,{method:"PUT",body:JSON.stringify(draft)}),"Student profile updated.");}
  async function loadAssessments(courseId){setAssessmentForm(v=>({...v,courseId}));try{const a=await api(`/api/institutions/${encodeURIComponent(institutionId)}/courses/${encodeURIComponent(courseId)}/assessments`,{cache:"no-store"});setAssessments(a.assessments||[]);}catch(err){setError(err.message||"Assessments could not be loaded.");}}
  async function saveAssessment(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/courses/${encodeURIComponent(assessmentForm.courseId)}/assessments`,{method:"POST",body:JSON.stringify(assessmentForm)}),"Assessment created.");setAssessmentForm(v=>({...v,title:"",totalMarks:"100"}));}
  async function saveResult(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/assessments/${encodeURIComponent(resultForm.assessmentId)}/results/${encodeURIComponent(resultForm.studentUserId)}`,{method:"PUT",body:JSON.stringify({marksObtained:Number(resultForm.marksObtained)})}),"Student result saved.");}

  if(!institutionId)return <section className="panel"><h3>Institution modules</h3><p>Select an active institution administrator membership to manage its modules.</p></section>;
  return <section className="panel institutionModules">
    <div className="eyebrow dark">INSTITUTION OPERATIONS</div><h2>Institution management modules</h2>
    {overview&&<div className="collegeValueGrid institutionAdminOverview">
      <article className="panel"><h3>Students</h3><p>{overview.students}</p></article><article className="panel"><h3>Staff</h3><p>{overview.staff}</p></article><article className="panel"><h3>Courses</h3><p>{overview.courses}</p></article><article className="panel"><h3>Fees collected</h3><p>{money(overview.collectedPaise)}</p></article>
    </div>}
    <div className="collegeReviewButtons" role="tablist" aria-label="Institution modules">{tabs.map(item=><button type="button" key={item} className={tab===item?"primary":"secondary"} onClick={()=>setTab(item)} role="tab" aria-selected={tab===item}>{item}</button>)}</div>
    {busy&&<p>Loading / saving securely…</p>}
    {tab==="Students"&&<InstitutionStudents students={students} profileDrafts={profileDrafts} setProfileDrafts={setProfileDrafts} saveStudentProfile={saveStudentProfile} busy={busy}/>}
    {tab==="Staff"&&<InstitutionStaff institutionId={institutionId} staff={staff} staffForm={staffForm} setStaffForm={setStaffForm} saveStaff={saveStaff} busy={busy} run={run}/>}
    {tab==="Finance"&&<InstitutionFinance students={students} invoiceForm={invoiceForm} setInvoiceForm={setInvoiceForm} saveInvoice={saveInvoice} invoices={invoices} money={money} paymentForm={paymentForm} setPaymentForm={setPaymentForm} receivePayment={receivePayment} busy={busy}/>}
    {tab==="Academics"&&<InstitutionAcademics courses={courses} courseForm={courseForm} setCourseForm={setCourseForm} saveCourse={saveCourse} attendanceForm={attendanceForm} setAttendanceForm={setAttendanceForm} markAttendance={markAttendance} students={students} assessmentForm={assessmentForm} setAssessmentForm={setAssessmentForm} loadAssessments={loadAssessments} saveAssessment={saveAssessment} assessments={assessments} resultForm={resultForm} setResultForm={setResultForm} saveResult={saveResult} busy={busy}/>}
    {error&&<p className="collegeAlert error" role="alert">{error}</p>}{message&&<p className="collegeAlert" role="status">{message}</p>}
    <p className="collegePrivacyNote">Finance records are manual entries; no payment gateway is connected. Staff directory entries do not create SecureID accounts or grant permissions. Every write is institution-scoped and audited.</p>
  </section>;
}
