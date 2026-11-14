const safe=(v)=>{let s=String(v??"");if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function registerInstitutionReports({app,database,requireAuth,requireMfaProduction,getInstitutionMembership,hasInstitutionFeature}){
 const reports={
  students:{feature:"student_management",sql:`SELECT u.email AS student_email,p.student_number AS student_number,p.department,p.program,p.academic_year,p.status FROM institution_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN institution_student_profiles p ON p.institution_id=m.institution_id AND p.user_id=m.user_id WHERE m.institution_id=? AND m.role='student' ORDER BY u.email`},
  attendance:{feature:"academics",sql:`SELECT c.course_code,c.title AS course,a.attendance_date,u.email AS student_email,a.status FROM institution_attendance a JOIN institution_courses c ON c.id=a.course_id JOIN users u ON u.id=a.student_user_id WHERE a.institution_id=? ORDER BY a.attendance_date DESC,c.course_code,u.email`},
  finance:{feature:"finance",sql:`SELECT i.id AS invoice_id,u.email AS student_email,i.fee_head,i.amount_paise,i.due_date,i.status,COALESCE(SUM(p.amount_paise),0) AS paid_paise,i.amount_paise-COALESCE(SUM(p.amount_paise),0) AS outstanding_paise FROM institution_fee_invoices i JOIN users u ON u.id=i.student_user_id LEFT JOIN institution_fee_payments p ON p.invoice_id=i.id WHERE i.institution_id=? GROUP BY i.id ORDER BY i.created_at DESC`},
  library:{feature:"library",sql:`SELECT b.accession_number,b.title,u.email AS student_email,l.issued_at,l.due_at,l.status,l.fine_paise,l.fine_status FROM institution_library_loans l JOIN institution_library_books b ON b.id=l.book_id JOIN users u ON u.id=l.student_user_id WHERE l.institution_id=? ORDER BY l.issued_at DESC`},
  examinations:{feature:"academics",sql:`SELECT e.title AS exam,e.academic_year,s.subject_code,s.title AS subject,r.roll_number,u.email AS student_email,m.marks_hundredths/100.0 AS marks,s.total_marks_hundredths/100.0 AS total_marks,e.status AS exam_status FROM institution_exams e JOIN institution_exam_subjects s ON s.exam_id=e.id JOIN institution_exam_registrations r ON r.exam_id=e.id JOIN users u ON u.id=r.student_user_id LEFT JOIN institution_exam_marks m ON m.subject_id=s.id AND m.student_user_id=r.student_user_id WHERE e.institution_id=? ORDER BY e.starts_at,s.exam_date,r.roll_number`},
  grievances:{feature:"student_management",sql:`SELECT g.ticket_number,g.category,g.subject,g.priority,g.status,u.email AS student_email,g.sla_due_at,g.created_at,g.updated_at,g.resolution FROM institution_grievances g JOIN users u ON u.id=g.student_user_id WHERE g.institution_id=? ORDER BY g.created_at DESC`}
 };
 app.get("/api/institutions/:institutionId/reports/:reportType.csv",requireAuth,requireMfaProduction,(req,res,next)=>{try{
  const institutionId=String(req.params.institutionId||"").trim(),type=String(req.params.reportType||"").trim(),member=getInstitutionMembership(req.user.id,institutionId);
  if(!member||member.status!=="active"||member.role!=="institution_admin")return res.status(403).json({success:false,message:"Institution administrator access is required for reports."});
  const report=reports[type];if(!report)return res.status(404).json({success:false,message:"Report type was not found."});
  if(!hasInstitutionFeature(institutionId,report.feature))return res.status(403).json({success:false,message:"This report module is not enabled."});
  const rows=database.prepare(report.sql).all(institutionId),headers=rows.length?Object.keys(rows[0]):[];
  const csv=[headers.map(safe).join(","),...rows.map(row=>headers.map(key=>safe(row[key])).join(","))].join("\r\n");
  const ts=new Date().toISOString().slice(0,10);res.setHeader("Cache-Control","private, no-store");res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="secureid-${type}-${ts}.csv"`);
  database.prepare("INSERT INTO institution_operations_audit(id,institution_id,actor_user_id,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,'report_exported','report',?,?,?)").run(cryptoId(),institutionId,req.user.id,type,JSON.stringify({rowCount:rows.length}),new Date().toISOString());
  return res.send("\uFEFF"+csv);
 }catch(e){next(e);}});
}
function cryptoId(){return globalThis.crypto?.randomUUID?.()||"report-"+Date.now()+"-"+Math.random().toString(16).slice(2);}
