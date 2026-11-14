const reports=[["students","Student directory"],["attendance","Attendance"],["finance","Fee ledger"],["library","Library circulation"],["examinations","Examination results"],["grievances","Grievance service levels"]];
export default function InstitutionReports({institutionId}){
 return <section className="institutionReportsWorkspace">
  <p className="lead">Export institution-scoped operational reports as CSV files. Access is restricted to active institution administrators and each export is recorded in the audit log.</p>
  <div className="collegeRequestList">{reports.map(([key,label])=><article className="collegeRequest" key={key}><strong>{label}</strong><small>CSV export · Current saved records</small><a className="secondary" href={`/api/institutions/${encodeURIComponent(institutionId)}/reports/${key}.csv`} download>Download report</a></article>)}</div>
 </section>;
}
