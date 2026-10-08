import { useEffect, useState } from "react";
import "./document-vault.css";

async function api(path, options={}){
  const response=await fetch(path,{
    credentials:"include",
    ...options
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
  const [selected,setSelected]=useState([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [message,setMessage]=useState("");
  const [documentShares,setDocumentShares]=useState({});

  async function load(){
    setLoading(true);

    try{
      const [docs,identity]=await Promise.all([
        api("/api/documents"),
        api("/api/identity/profile")
      ]);

      setDocuments(docs.documents || []);
      setProfile(identity.profile || {});
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

  async function upload(){
    if(selected.length===0){
      setMessage("Select a PDF or image first.");
      return;
    }

    setUploading(true);
    setMessage("");

    try{
      const form=new FormData();

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
      const result=await api("/api/document-share",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({documentId:doc.id})});
      const link=new URL("/document-share/"+result.shareToken,window.location.origin).toString();
      setDocumentShares(current=>({...current,[doc.id]:{token:result.shareToken,link,expiresAt:result.shareExpiresAt}}));
      await navigator.clipboard?.writeText(link);
      setMessage("Secure document link created and copied. It expires in 15 minutes.");
    }catch(error){setMessage(error.message);}
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
      <h3>Add documents</h3>

      <input
        id="secureid-document-input"
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        multiple
        onChange={event=>setSelected(Array.from(event.target.files || []))}
      />

      <small>
        PDF/JPEG/PNG/WebP · maximum 10 MB per file · up to 5 files at once
      </small>

      <button
        className="primary"
        onClick={upload}
        disabled={uploading || selected.length===0}
      >
        {uploading ? "Encrypting & uploading…" : "Secure upload"}
      </button>
    </section>

    <section className="vaultBlock">
      <h3>Your documents</h3>

      {documents.length===0 ? (
        <p>No documents stored yet.</p>
      ) : (
        <div className="documentList">
          {documents.map(doc=>
            <article className="documentItem" key={doc.id}>
              <div>
                <strong>{doc.name}</strong>
                <small>
                  {doc.mimeType} · {(doc.sizeBytes / 1024 / 1024).toFixed(2)} MB
                </small>
              </div>

              <div className="documentActions">
                <button onClick={()=>download(doc.id,doc.name)}>Download</button>
                {!documentShares[doc.id] ? <button onClick={()=>shareDocument(doc)}>Share</button> : <button onClick={()=>revokeDocumentShare(doc.id)}>Revoke share</button>}
                <button onClick={()=>remove(doc.id)}>
                  Delete
                </button>
              </div>
            </article>
          )}
        </div>
      )}
    </section>

    {message && <div className="vaultMessage">{message}</div>}
  </section>;
}
