import { useEffect, useState } from "react";
import "./document-vault.css";

function csrfToken(){
  const m=document.cookie.match(/(?:^|; )(?:__Host-secureid\.csrf|secureid\.csrf)=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function api(path, options={}){
  const response=await fetch(path,{
    credentials:"include",
    ...options,
    headers: { ...(options.headers || {}), ...(["POST","PUT","PATCH","DELETE"].includes(String(options.method||"GET").toUpperCase()) && csrfToken() ? {"X-CSRF-Token":csrfToken()} : {}) }
  });

  const contentType=response.headers.get("content-type") || "";

  if(contentType.includes("application/json")){
    const data=await response.json();

    if(!response.ok || data.success===false){
      throw new Error(data.message || "Request failed.");
    }

    return data;
  }

  if(!response.ok){
    throw new Error("Request failed.");
  }

  return response;
}

const fields=[
  ["name","Name"],
  ["age","Age"],
  ["dateOfBirth","Date of Birth"],
  ["address","Address"],
  ["email","Email"],
  ["phone","Phone Number"],
  ["identityId","Identity ID"],
  ["college","College / Institution"],
  ["studentId","Student ID"],
  ["governmentId","Government ID (masked)"],
  ["verificationStatus","Verification Status"]
];

export default function DocumentVault(){
  const [documents,setDocuments]=useState([]);
  const [profile,setProfile]=useState({});
  const [proofFiles,setProofFiles]=useState({student_id:null,institution_proof:null});
  const [proofUploading,setProofUploading]=useState("");
  const [selected,setSelected]=useState([]);
  const [uploadCategory,setUploadCategory]=useState("general");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [message,setMessage]=useState("");
  const [documentShares,setDocumentShares]=useState({});
  const [docContext,setDocContext]=useState("");
  const [verificationStatus,setVerificationStatus]=useState(null);
  const [governmentReadiness,setGovernmentReadiness]=useState(null);

  async function load(){
    setLoading(true);

    try{
      const [docs,identity,verification,government]=await Promise.all([
        api("/api/documents"),
        api("/api/identity/profile"),
        api("/api/identity/verification-status"),
        api("/api/identity/government-verification/readiness").catch(()=>null)
      ]);

      setDocuments(docs.documents || []);
      setProfile(identity.profile || {});
      setVerificationStatus(verification || null);
      setGovernmentReadiness(government || null);
    }catch(error){
      setMessage(error.message);
    }finally{
      setLoading(false);
    }
  }

  useEffect(()=>{
    load();
  },[]);

  function updateField(field,value){
    setProfile(current=>({
      ...current,
      [field]:value
    }));
  }

  async function saveProfile(event){
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try{
      const body=new URLSearchParams();

      for(const [key] of fields){
        body.set(key,profile[key] || "");
      }

      const result=await api("/api/identity/profile",{
        method:"PUT",
        headers:{
          "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"
        },
        body
      });

      setProfile(result.profile || {});
      setMessage("Identity details saved securely.");
    }catch(error){
      setMessage(error.message);
    }finally{
      setSaving(false);
    }
  }

  async function uploadProof(category){
    const file=proofFiles[category];
    if(!file){ setMessage("Select a PDF or image first."); return; }
    setProofUploading(category); setMessage("");
    try{
      const form=new FormData(); form.append("category",category); form.append("document",file);
      const result=await api("/api/identity/proof",{method:"POST",body:form});
      setDocuments(current=>[result.document,...current.filter(doc=>doc.category!==category)]);
      setProofFiles(current=>({...current,[category]:null}));
      setMessage(category==="student_id"?"Student ID proof uploaded securely.":"College / Institution proof uploaded securely.");
    }catch(error){ setMessage(error.message); } finally{ setProofUploading(""); }
  }

  async function upload(){
    if(selected.length===0){
      setMessage("Select a PDF or image first.");
      return;
    }

    setUploading(true);
    setMessage("");

    try{
      const form=new FormData();

      form.append("category",uploadCategory);
      for(const file of selected){
        form.append("documents",file);
      }

      const result=await api("/api/documents",{
        method:"POST",
        body:form
      });

      setDocuments(current=>[
        ...result.documents,
        ...current
      ]);

      setSelected([]);
      document.getElementById("secureid-document-input").value="";
      setMessage("Document encrypted and stored securely.");
    }catch(error){
      setMessage(error.message);
    }finally{
      setUploading(false);
    }
  }

  async function download(id,name){
    try{
      const response=await api(`/api/documents/${encodeURIComponent(id)}`);

      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement("a");

      anchor.href=url;
      anchor.download=name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      URL.revokeObjectURL(url);
    }catch(error){
      setMessage(error.message);
    }
  }

  async function shareDocument(doc){
    try{
      const result=await api("/api/document-share",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({documentId:doc.id,share_reason:docContext})});
      const link=new URL("/document-share/"+result.shareToken,window.location.origin).toString();
      setDocumentShares(current=>({...current,[doc.id]:{token:result.shareToken,link,expiresAt:result.shareExpiresAt}}));
      try{
        if(!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(link);
        setMessage("Secure document link created and copied. It expires in 15 minutes.");
      }catch{
        setMessage("Secure document link created. Copy it from the document card below; it expires in 15 minutes.");
      }
    }catch(error){setMessage(error.message);}
  }

  async function copyDocumentShare(docId){
    const share=documentShares[docId];
    if(!share?.link) return;
    try{
      if(!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(share.link);
      setMessage("Secure document link copied.");
    }catch{
      setMessage("Clipboard access is unavailable. Select and copy the link shown on the document card.");
    }
  }

  async function revokeDocumentShare(docId){
    const share=documentShares[docId]; if(!share)return;
    try{
      await api("/api/document-share/revoke",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({shareToken:share.token})});
      setDocumentShares(current=>{const next={...current};delete next[docId];return next;});
      setMessage("Document share revoked.");
    }catch(error){setMessage(error.message);}
  }

  async function remove(id){
    if(!window.confirm("Delete this document permanently?")){
      return;
    }

    try{
      await api(`/api/documents/${encodeURIComponent(id)}`,{
        method:"DELETE"
      });

      setDocuments(current=>current.filter(doc=>doc.id!==id));
      setMessage("Document deleted.");
    }catch(error){
      setMessage(error.message);
    }
  }

  const aadhaarCount = documents.filter(doc => doc.category === "aadhaar").length;
  const panCount = documents.filter(doc => doc.category === "pan").length;

  if(loading){
    return <section className="documentVault panel">
      <div className="eyebrow dark">SECURE DOCUMENT VAULT</div>
      <h2>Loading secure storage…</h2>
    </section>;
  }

  return <section className="documentVault panel">
    <div className="eyebrow dark">SECURE DOCUMENT VAULT</div>
    <h2>Documents & Identity</h2>
    <p className="lead">
      Your documents are encrypted before being stored on the SecureID server.
      Access is protected by your authenticated session.
    </p>

    <div className="vaultSecurityNotice">
      <strong>Production storage active</strong>
      <span>Files are not stored in browser localStorage and are not publicly accessible.</span>
    </div>

    <section className="verificationStatusCard">
      <div>
        <div className="eyebrow dark">STUDENT / INSTITUTION PROOF STATUS</div>
        <h3>{verificationStatus?.status || "Not submitted"}</h3>
        <p>{verificationStatus?.status === "Pending review" ? "Both proof files are uploaded. This is a submission status only, not an independent college or government verification." : verificationStatus?.status === "Partially submitted" ? "Upload both Student ID and College / Institution proof to complete your proof set. This does not confirm authenticity." : "Add your Student ID and College / Institution proof to start the proof-submission process. SecureID has not verified these files independently."}</p>
      </div>
      <div className="verificationChecks">
        <span className={verificationStatus?.proofs?.studentId ? "complete" : ""}>✓ Student ID</span>
        <span className={verificationStatus?.proofs?.institution ? "complete" : ""}>✓ Institution proof</span>
      </div>
    </section>

    <section className="vaultBlock">
      <h3>Identity details</h3>

      <form onSubmit={saveProfile} className="identityForm">
        {fields.map(([key,label])=>
          <label key={key}>
            {label}
            <input
              value={profile[key] || ""}
              maxLength={500}
              onChange={event=>updateField(key,event.target.value)}
            />
          </label>
        )}

        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : "Save identity details"}
        </button>
      </form>
    </section>

    <section className="vaultBlock">
      <h3>Identity proof documents</h3>
      <p className="lead">Attach the actual Student ID card and College / Institution proof as a photo or PDF. Each proof is encrypted and linked to its identity field.</p>
      {[["student_id","Student ID Card"],["institution_proof","College / Institution Proof"]].map(([category,label])=>{
        const existing=documents.find(doc=>doc.category===category);
        return <div className="proofUpload" key={category}>
          <div><strong>{label}</strong><small>{existing ? "Current: "+existing.name : "No proof uploaded yet."}</small></div>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event=>setProofFiles(current=>({...current,[category]:event.target.files?.[0] || null}))}/>
          <button className="primary" onClick={()=>uploadProof(category)} disabled={proofUploading===category || !proofFiles[category]}>{proofUploading===category ? "Encrypting…" : existing ? "Replace proof" : "Upload proof"}</button>
        </div>;
      })}
      <small>PDF/JPEG/PNG/WebP · maximum 10 MB per file. Uploading a replacement securely invalidates the previous proof.</small>
    </section>

    <section className="vaultBlock">
      <h3>PAN & Aadhaar documents</h3>
      <p className="lead">Choose the identity document you want to add. Upload a clear photo or PDF; SecureID stores the file in your private vault. This does not verify the document with UIDAI or the Income Tax Department.</p>
      <div className="officialVerificationPanel">
        <div className="eyebrow dark">OFFICIAL GOVERNMENT VERIFICATION</div>
        <h4>{governmentReadiness?.officialVerificationConnected ? "Official verification connection enabled" : "Government verification is not connected yet"}</h4>
        <p>Saving a PAN or Aadhaar file only stores it in your vault. SecureID must not label it government-verified until an authorized verification service returns a genuine result.</p>
        <div className="governmentReadinessList" aria-label="Government integration readiness">
          <div><strong>PAN service</strong><span>{governmentReadiness?.pan?.live ? "Live verification enabled" : governmentReadiness?.pan?.approved && governmentReadiness?.pan?.configured ? "Approved configuration detected; live verification not enabled" : governmentReadiness?.pan?.configured ? "Configuration present; provider approval not confirmed" : "Provider configuration required"}</span></div>
          <div><strong>Aadhaar service</strong><span>{governmentReadiness?.aadhaar?.live ? "Live verification enabled" : governmentReadiness?.aadhaar?.approved && governmentReadiness?.aadhaar?.configured ? "Approved configuration detected; live verification not enabled" : governmentReadiness?.aadhaar?.configured ? "Configuration present; provider approval not confirmed" : "Authorized provider configuration required"}</span></div>
        </div>
        <div className="officialVerificationActions">
          <a href="https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/verify-your-pan" target="_blank" rel="noreferrer">Open official PAN verification ↗</a>
          <a href="https://uidai.gov.in/hi/authentication-requesting-agency" target="_blank" rel="noreferrer">UIDAI agency / integration requirements ↗</a>
        </div>
        <small>PAN online verification is performed on the Income Tax Department portal. Direct API access for an organization requires the applicable registration/approval. Aadhaar authentication requires UIDAI authorization or an approved requesting-entity partner. SecureID has not yet been approved or connected to either service.</small>
      </div>
      <div className="identityDocumentChoices" role="group" aria-label="Choose identity document type">
        <button type="button" className={uploadCategory === "aadhaar" ? "identityDocumentChoice selected" : "identityDocumentChoice"} aria-pressed={uploadCategory === "aadhaar"} onClick={() => setUploadCategory("aadhaar")}>
          <span className="identityDocumentIcon" aria-hidden="true">🪪</span>
          <span className="identityDocumentCopy"><strong>AADHAAR CARD</strong><small>Identity and address document · masked Aadhaar recommended</small><small className={aadhaarCount ? "identityDocumentStatus stored" : "identityDocumentStatus"}>{aadhaarCount ? `Saved in vault · ${aadhaarCount} file${aadhaarCount === 1 ? "" : "s"}` : "No Aadhaar file saved yet"}</small></span>
          <span className="identityDocumentAction">{uploadCategory === "aadhaar" ? "Selected ✓" : "Choose"}</span>
        </button>
        <button type="button" className={uploadCategory === "pan" ? "identityDocumentChoice selected" : "identityDocumentChoice"} aria-pressed={uploadCategory === "pan"} onClick={() => setUploadCategory("pan")}>
          <span className="identityDocumentIcon" aria-hidden="true">📄</span>
          <span className="identityDocumentCopy"><strong>PAN CARD</strong><small>Tax identity document · keep your PAN details private</small><small className={panCount ? "identityDocumentStatus stored" : "identityDocumentStatus"}>{panCount ? `Saved in vault · ${panCount} file${panCount === 1 ? "" : "s"}` : "No PAN file saved yet"}</small></span>
          <span className="identityDocumentAction">{uploadCategory === "pan" ? "Selected ✓" : "Choose"}</span>
        </button>
      </div>
      <h3>{uploadCategory === "aadhaar" ? "Upload Aadhaar document" : uploadCategory === "pan" ? "Upload PAN document" : "Add other identity documents"}</h3>
      <label className="documentCategoryField">Document category
        <select value={uploadCategory} onChange={event=>setUploadCategory(event.target.value)}>
          <option value="general">Other document</option>
          <option value="aadhaar">Aadhaar Card</option>
          <option value="pan">PAN Card</option>
          <option value="passport">Passport</option>
          <option value="voter_id">Voter ID</option>
          <option value="driving_licence">Driving Licence</option>
        </select>
      </label>
      <input id="secureid-document-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple onChange={event=>setSelected(Array.from(event.target.files || []))}/>
      <small>PDF/JPEG/PNG/WebP · maximum 10 MB per file · up to 5 files at once</small>
      <button className="primary" onClick={upload} disabled={uploading || selected.length===0}>{uploading ? "Encrypting & uploading…" : uploadCategory === "aadhaar" ? "Securely save Aadhaar" : uploadCategory === "pan" ? "Securely save PAN" : "Secure upload"}</button>
    </section>

    <section className="vaultBlock">
      <h3>Your documents</h3><label className="documentShareContext"><span>Share purpose (optional)</span><input maxLength={160} value={docContext} onChange={e=>setDocContext(e.target.value)} placeholder="e.g. College verification" /></label>

      {documents.length===0 ? (
        <p>No documents stored yet.</p>
      ) : (
        <div className="documentList">
          {documents.map(doc=>
            <article className="documentItem" key={doc.id}>
              <div>
                <strong>{doc.name}</strong>
                <small>{({"aadhaar":"Aadhaar Card","pan":"PAN Card","passport":"Passport","voter_id":"Voter ID","driving_licence":"Driving Licence","student_id":"Student ID","institution_proof":"Institution Proof","general":"Other Document"}[doc.category] || "Other Document")}</small>
                <small>{doc.mimeType} · {(doc.sizeBytes / 1024 / 1024).toFixed(2)} MB</small>
              </div>

              <div className="documentActions">
                <button onClick={()=>download(doc.id,doc.name)}>Download</button>
                {!documentShares[doc.id] ? <button onClick={()=>shareDocument(doc)}>Share</button> : <button onClick={()=>revokeDocumentShare(doc.id)}>Revoke share</button>}
                <button onClick={()=>remove(doc.id)}>
                  Delete
                </button>
              </div>
              {documentShares[doc.id] && <div className="documentShareLink">
                <label>
                  <span>Active share link</span>
                  <input aria-label={`Share link for ${doc.name}`} readOnly value={documentShares[doc.id].link} onFocus={event=>event.currentTarget.select()} />
                </label>
                <small>Expires {documentShares[doc.id].expiresAt ? new Date(documentShares[doc.id].expiresAt).toLocaleString() : "soon"}.</small>
                <button type="button" onClick={()=>copyDocumentShare(doc.id)}>Copy link</button>
              </div>}
            </article>
          )}
        </div>
      )}
    </section>

    {message && <div className="vaultMessage">{message}</div>}
  </section>;
}
