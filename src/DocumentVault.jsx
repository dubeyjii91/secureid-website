import React, { useEffect, useState } from "react";

const CLAIMS = [
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

export default function DocumentVault() {
  const [open,setOpen] = useState(false);
  const [docs,setDocs] = useState([]);
  const [details,setDetails] = useState({});

  useEffect(() => {
    try {
      setDocs(JSON.parse(localStorage.getItem("secureid_documents") || "[]"));
      setDetails(JSON.parse(localStorage.getItem("secureid_claim_details") || "{}"));
    } catch {}
  }, []);

  const saveDocs = (next) => {
    setDocs(next);
    localStorage.setItem("secureid_documents",JSON.stringify(next));
  };

  const saveDetails = (next) => {
    setDetails(next);
    localStorage.setItem("secureid_claim_details",JSON.stringify(next));
  };

  const addFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    const added = [];

    for (const file of files) {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") continue;

      const data = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      added.push({
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random(),
        name:file.name,
        type:file.type,
        size:file.size,
        data,
        addedAt:new Date().toLocaleString()
      });
    }

    saveDocs([...docs,...added]);
    event.target.value="";
  };

  const removeDoc = (id) => {
    saveDocs(docs.filter((doc) => doc.id !== id));
  };

  return (
    <>
      <button
        className="documentVaultLauncher"
        onClick={() => setOpen(true)}
      >
        + Add Documents
      </button>

      {open && (
        <div className="documentVaultBackdrop">
          <section className="documentVault">
            <div className="documentVaultHeader">
              <div>
                <div className="eyebrow dark">SECURE DOCUMENT VAULT</div>
                <h2>Add your identity documents</h2>
                <p>
                  Select photos, scanned documents or PDF files from your device.
                </p>
              </div>

              <button
                className="documentVaultClose"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <label className="documentUploadBox">
              <div className="documentUploadIcon">+</div>
              <strong>Choose files</strong>
              <span>
                Gallery, camera files, JPG, PNG or PDF
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={addFiles}
              />
            </label>

            <div className="documentSection">
              <h3>Your documents</h3>

              {docs.length === 0 ? (
                <div className="documentEmpty">
                  No documents added yet.
                </div>
              ) : (
                <div className="documentList">
                  {docs.map((doc) => (
                    <div className="documentItem" key={doc.id}>
                      <div className="documentInfo">
                        <strong>{doc.name}</strong>
                        <span>
                          {doc.type === "application/pdf" ? "PDF" : "Image"} ·{" "}
                          {Math.round(doc.size / 1024)} KB
                        </span>
                      </div>

                      <button
                        className="documentRemove"
                        onClick={() => removeDoc(doc.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="documentSection">
              <h3>Identity details</h3>
              <p className="documentHint">
                Add the information connected to your SecureID documents.
              </p>

              <div className="documentClaimGrid">
                {CLAIMS.map(([key,label]) => (
                  <label className="documentField" key={key}>
                    <span>{label}</span>
                    <input
                      value={details[key] || ""}
                      onChange={(event) =>
                        saveDetails({
                          ...details,
                          [key]:event.target.value
                        })
                      }
                      placeholder={"Enter " + label}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="documentSecurityNote">
              Your selected files and details are currently stored locally in
              this browser. They are not uploaded to the SecureID server yet.
            </div>
          </section>
        </div>
      )}
    </>
  );
}
