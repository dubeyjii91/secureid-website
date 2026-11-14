import { useEffect, useState } from "react";
import api from "./api.js";
import SecureIcon from "./SecureIcon.jsx";
import InstitutionStudents from "./institution-modules/InstitutionStudents.jsx";
import InstitutionStaff from "./institution-modules/InstitutionStaff.jsx";
import InstitutionFinance from "./institution-modules/InstitutionFinance.jsx";
import InstitutionAcademics from "./institution-modules/InstitutionAcademics.jsx";
import InstitutionQueue from "./institution-modules/InstitutionQueue.jsx";
import InstitutionLibrary from "./institution-modules/InstitutionLibrary.jsx";
import InstitutionExaminations from "./institution-modules/InstitutionExaminations.jsx";
import InstitutionGrievances from "./institution-modules/InstitutionGrievances.jsx";
import InstitutionCertificates from "./institution-modules/InstitutionCertificates.jsx";
import InstitutionReports from "./institution-modules/InstitutionReports.jsx";
import InstitutionHR from "./institution-modules/InstitutionHR.jsx";
import InstitutionCalendar from "./institution-modules/InstitutionCalendar.jsx";

const moduleCards = [
  { key:"Students", title:"Student Management", description:"Student directory, academic profiles and enrollment status.", icon:"graduation" },
  { key:"Staff", title:"Staff Management", description:"Employee directory, departments, designations and staff status.", icon:"users" },
  { key:"Academics", title:"Academics", description:"Courses, attendance, assessments and student results.", icon:"book" },
  { key:"Finance", title:"Finance & Fees", description:"Fee invoices, payment entries, outstanding balances and collection ledger.", icon:"wallet" },
  { key:"Queue", title:"Service Queue", description:"Digital tokens, department counters and live student service flow.", icon:"clock" },
  { key:"Library", title:"Library", description:"Catalogue, book circulation, overdue returns and reservations.", icon:"book-open" },
  { key:"Calendar", title:"Academic Calendar", description:"Academic dates, holidays, admissions, deadlines and campus events.", icon:"calendar-days" },
  { key:"Examinations", title:"Examinations", description:"Exam schedules, registration, roll numbers, marks and results.", icon:"graduation-cap" },
  { key:"Grievances", title:"Grievances & Helpdesk", description:"Student tickets, service deadlines, staff replies and resolution.", icon:"message-square" },
  { key:"Certificates", title:"Certificates", description:"Bonafide, character, transfer and fee-clearance certificate workflow.", icon:"file-check" },
  { key:"Reports", title:"Reports & Exports", description:"Download student, attendance, finance, library and examination reports.", icon:"file-spreadsheet" },
  { key:"HR", title:"HR & Staff Operations", description:"Staff account mapping, leave approvals and daily attendance.", icon:"users" }
];
const money = paise => "₹" + (Number(paise || 0) / 100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});

export default function InstitutionModules({ institutionId }) {
  const [tab,setTab]=useState("Overview");
  const [students,setStudents]=useState([]);
  const [staff,setStaff]=useState([]);
  const [invoices,setInvoices]=useState([]);
  const [courses,setCourses]=useState([]);
  const [enrollments,setEnrollments]=useState([]);
  const [sections,setSections]=useState([]);
  const [sectionForm,setSectionForm]=useState({courseId:"",sectionCode:"",sectionName:"",capacity:""});
  const [enrollmentForm,setEnrollmentForm]=useState({courseId:"",studentUserId:"",sectionId:""});
  const [assessments,setAssessments]=useState([]);
  const [timetable,setTimetable]=useState([]);
  const [timetableForm,setTimetableForm]=useState({courseId:"",weekday:"1",startsAt:"09:00",endsAt:"10:00",room:"",staffId:""});
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
      const [s,st,f,c,e,o,t,sec]=await Promise.all([
        api(`/api/institutions/${encodeURIComponent(institutionId)}/students`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/staff`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/finance`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/courses`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/enrollments`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/operations/overview`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/timetable`,{cache:"no-store"}),
        api(`/api/institutions/${encodeURIComponent(institutionId)}/sections`,{cache:"no-store"})
      ]);
      setStudents(s.students||[]);setProfileDrafts(Object.fromEntries((s.students||[]).map(item=>[item.userId,{studentNumber:item.studentNumber||"",department:item.department||"",program:item.program||"",academicYear:item.academicYear||"",status:item.status||"active"}])));setStaff(st.staff||[]);setInvoices(f.invoices||[]);setCourses(c.courses||[]);setEnrollments(e.enrollments||[]);setSections(sec.sections||[]);setOverview(o.overview||null);setTimetable(t.entries||[]);
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
  async function saveTimetableEntry(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/timetable`,{method:"POST",body:JSON.stringify({...timetableForm,weekday:Number(timetableForm.weekday)})}),"Timetable entry saved.");}
  async function saveSection(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/sections`,{method:"POST",body:JSON.stringify({...sectionForm,capacity:sectionForm.capacity||null})}),"Course section created.");setSectionForm(v=>({...v,sectionCode:"",sectionName:"",capacity:""}));}
  async function saveEnrollment(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/enrollments`,{method:"POST",body:JSON.stringify({...enrollmentForm,sectionId:enrollmentForm.sectionId||null})}),"Student enrolled in course section.");setEnrollmentForm(v=>({...v,studentUserId:"",sectionId:""}));}
  async function withdrawEnrollment(enrollmentId){if(!window.confirm("Withdraw this student from the course?"))return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/enrollments/${encodeURIComponent(enrollmentId)}`,{method:"DELETE"}),"Course enrollment withdrawn.");}
  async function deleteTimetableEntry(entryId){if(!window.confirm("Delete this timetable entry?"))return;await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/timetable/${encodeURIComponent(entryId)}`,{method:"DELETE"}),"Timetable entry deleted.");}
  async function receivePayment(e){e.preventDefault();const key=crypto.randomUUID();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/finance/invoices/${encodeURIComponent(paymentForm.invoiceId)}/payments`,{method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify({amountPaise:Math.round(Number(paymentForm.amount)*100),method:paymentForm.method,reference:paymentForm.reference,idempotencyKey:key})}),"Payment recorded.");setPaymentForm({invoiceId:"",amount:"",method:"upi",reference:""});}
  async function createOnlinePaymentLink(invoiceId){setBusy(true);setError("");setMessage("");try{const result=await api(`/api/institutions/${encodeURIComponent(institutionId)}/finance/invoices/${encodeURIComponent(invoiceId)}/payment-link`,{method:"POST",body:JSON.stringify({})});setMessage("Secure payment link created. Payment will be recorded only after verified provider confirmation.");await load();return result.paymentLink||null;}catch(err){setError(err.message||"Online payment link could not be created.");return null;}finally{setBusy(false);}}
  async function saveStudentProfile(userId){const draft=profileDrafts[userId]||{};await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/students/${encodeURIComponent(userId)}`,{method:"PUT",body:JSON.stringify(draft)}),"Student profile updated.");}
  async function loadAssessments(courseId){setAssessmentForm(v=>({...v,courseId}));try{const a=await api(`/api/institutions/${encodeURIComponent(institutionId)}/courses/${encodeURIComponent(courseId)}/assessments`,{cache:"no-store"});setAssessments(a.assessments||[]);}catch(err){setError(err.message||"Assessments could not be loaded.");}}
  async function saveAssessment(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/courses/${encodeURIComponent(assessmentForm.courseId)}/assessments`,{method:"POST",body:JSON.stringify(assessmentForm)}),"Assessment created.");setAssessmentForm(v=>({...v,title:"",totalMarks:"100"}));}
  async function saveResult(e){e.preventDefault();await run(()=>api(`/api/institutions/${encodeURIComponent(institutionId)}/assessments/${encodeURIComponent(resultForm.assessmentId)}/results/${encodeURIComponent(resultForm.studentUserId)}`,{method:"PUT",body:JSON.stringify({marksObtained:Number(resultForm.marksObtained)})}),"Student result saved.");}

  if(!institutionId)return <section className="panel"><h3>Institution modules</h3><p>Select an active institution administrator membership to manage its modules.</p></section>;
  return <section className="panel institutionModules">
    <div className="eyebrow dark">INSTITUTION OPERATIONS</div>
    <h2>{tab==="Overview"?"Institution Management":moduleCards.find(item=>item.key===tab)?.title||"Institution module"}</h2>
    {tab==="Overview"&&<>
      <p className="lead">Each department has its own workspace. The figures below are shared institution-wide summaries; open a module to manage its records separately.</p>
      {overview&&<div className="collegeValueGrid institutionAdminOverview">
        <article className="panel"><h3>Students</h3><p>{overview.students}</p></article>
        <article className="panel"><h3>Staff</h3><p>{overview.staff}</p></article>
        <article className="panel"><h3>Courses</h3><p>{overview.courses}</p></article>
        <article className="panel"><h3>Fees collected</h3><p>{money(overview.collectedPaise)}</p></article>
      </div>}
      <div className="institutionModuleLauncherGrid" aria-label="Separate institution workspaces">
        {moduleCards.map(item=><button key={item.key} type="button" className="institutionModuleLauncher" onClick={()=>{setMessage("");setError("");setTab(item.key);}}>
          <span className="institutionModuleLauncherIcon" aria-hidden="true"><SecureIcon name={item.icon} size={23} /></span>
          <span className="institutionModuleLauncherCopy"><strong>{item.title}</strong><small>{item.description}</small></span>
          <span className="institutionModuleLauncherAction">Open workspace <span aria-hidden="true">→</span></span>
        </button>)}
      </div>
      <p className="collegePrivacyNote">Staff account linking requires an exact matching email and active institution membership; linking does not grant additional permissions. Online fee links require configured Razorpay credentials and are settled only by signed webhooks. All writes remain institution-scoped and audited.</p>
    </>}
    {tab!=="Overview"&&<div className="institutionModuleHeader">
      <button type="button" className="secondary" onClick={()=>{setMessage("");setError("");setTab("Overview");}}>← All institution modules</button>
      <span>Separate workspace · Institution-scoped access</span>
    </div>}
    {busy&&<p>Loading / saving securely…</p>}
    {tab==="Students"&&<InstitutionStudents students={students} profileDrafts={profileDrafts} setProfileDrafts={setProfileDrafts} saveStudentProfile={saveStudentProfile} busy={busy}/>}
    {tab==="Staff"&&<InstitutionStaff institutionId={institutionId} staff={staff} staffForm={staffForm} setStaffForm={setStaffForm} saveStaff={saveStaff} busy={busy} run={run}/>}
    {tab==="Finance"&&<InstitutionFinance students={students} invoiceForm={invoiceForm} setInvoiceForm={setInvoiceForm} saveInvoice={saveInvoice} invoices={invoices} money={money} paymentForm={paymentForm} setPaymentForm={setPaymentForm} receivePayment={receivePayment} createOnlinePaymentLink={createOnlinePaymentLink} busy={busy}/>}
    {tab==="Academics"&&<InstitutionAcademics sections={sections} sectionForm={sectionForm} setSectionForm={setSectionForm} saveSection={saveSection} enrollments={enrollments} enrollmentForm={enrollmentForm} setEnrollmentForm={setEnrollmentForm} saveEnrollment={saveEnrollment} withdrawEnrollment={withdrawEnrollment} courses={courses} courseForm={courseForm} setCourseForm={setCourseForm} saveCourse={saveCourse} attendanceForm={attendanceForm} setAttendanceForm={setAttendanceForm} markAttendance={markAttendance} students={students} staff={staff} timetable={timetable} timetableForm={timetableForm} setTimetableForm={setTimetableForm} saveTimetableEntry={saveTimetableEntry} deleteTimetableEntry={deleteTimetableEntry} assessmentForm={assessmentForm} setAssessmentForm={setAssessmentForm} loadAssessments={loadAssessments} saveAssessment={saveAssessment} assessments={assessments} resultForm={resultForm} setResultForm={setResultForm} saveResult={saveResult} busy={busy}/>}
    {tab==="Queue"&&<InstitutionQueue institutionId={institutionId}/>}
    {tab==="Library"&&<InstitutionLibrary institutionId={institutionId} students={students}/>}
    {tab==="Calendar"&&<InstitutionCalendar institutionId={institutionId}/>}
    {tab==="Examinations"&&<InstitutionExaminations institutionId={institutionId} students={students}/>}
    {tab==="Grievances"&&<InstitutionGrievances institutionId={institutionId}/>}
    {tab==="Certificates"&&<InstitutionCertificates institutionId={institutionId}/>}
    {tab==="Reports"&&<InstitutionReports institutionId={institutionId}/>}
    {tab==="HR"&&<InstitutionHR institutionId={institutionId} staff={staff}/>}
    {error&&<p className="collegeAlert error" role="alert">{error}</p>}{message&&<p className="collegeAlert" role="status">{message}</p>}
  </section>;
}
