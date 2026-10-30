import { useCallback, useEffect, useState } from "react";
import api from "./api.js";

export default function SecureCloudPanel() {
  const [overview, setOverview] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [services, setServices] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [runtime, setRuntime] = useState("node");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [summary, projectResult] = await Promise.all([api("/api/securecloud/overview"), api("/api/securecloud/projects")]);
      setOverview(summary);
      setProjects(projectResult.projects || []);
      setSelectedProject((current) => current || projectResult.projects?.[0]?.id || "");
    } catch (err) { setError(err?.message || "SecureCloud status could not be loaded."); }
  }, []);

  const loadServices = useCallback(async (projectId) => {
    if (!projectId) { setServices([]); return; }
    try {
      const result = await api("/api/securecloud/projects/" + encodeURIComponent(projectId) + "/services");
      setServices(result.services || []);
    } catch (err) { setError(err?.message || "Services could not be loaded."); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadServices(selectedProject); }, [selectedProject, loadServices]);

  async function createProject(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/api/securecloud/projects", { method: "POST", body: JSON.stringify({ name: projectName, description: projectDescription }) });
      setProjectName(""); setProjectDescription(""); setSelectedProject(result.project.id);
      setNotice("Project created successfully."); await load();
    } catch (err) { setError(err?.message || "Project could not be created."); }
    finally { setBusy(false); }
  }

  async function createService(event) {
    event.preventDefault(); if (busy || !selectedProject) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/securecloud/projects/" + encodeURIComponent(selectedProject) + "/services", { method: "POST", body: JSON.stringify({ name: serviceName, repositoryUrl, branch, runtime }) });
      setServiceName(""); setRepositoryUrl(""); setNotice("Repository details saved. Deployment is not available yet.");
      await loadServices(selectedProject); await load();
    } catch (err) { setError(err?.message || "Service could not be added."); }
    finally { setBusy(false); }
  }

  async function requestDeployment(service) {
    if (busy || !overview?.workerConfigured) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api("/api/securecloud/services/" + encodeURIComponent(service.id) + "/deployments", { method: "POST", body: JSON.stringify({}) });
      setNotice("Deployment queued: " + result.deployment.id); await load();
    } catch (err) { setError(err?.message || "Deployment could not be queued."); }
    finally { setBusy(false); }
  }

  return <section className="panel securecloudPanel" aria-labelledby="securecloud-heading">
    <div className="eyebrow dark">HOSTING PLATFORM · SECURECLOUD</div>
    <h3 id="securecloud-heading">SecureCloud control plane</h3>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="dashboardGrid">
      <article className="panel"><div className="eyebrow dark">PROJECTS</div><h3>{overview?.projects ?? "—"}</h3></article>
      <article className="panel"><div className="eyebrow dark">REGISTERED SERVICES</div><h3>{overview?.services ?? "—"}</h3></article>
      <article className="panel"><div className="eyebrow dark">DEPLOYMENT RECORDS</div><h3>{overview?.deployments ?? "—"}</h3></article>
      <article className="panel"><div className="eyebrow dark">BUILD WORKER</div><h3>{overview?.workerConfigured ? "Configured" : "Not connected"}</h3></article>
    </div>
    <div className="panel securecloudFormPanel">
      <h3>Create hosting project</h3>
      <form className="securecloudForm" onSubmit={createProject}>
        <label>Project name
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} minLength={2} maxLength={80} required placeholder="My application" />
        </label>
        <label>Description <span className="formOptional">(optional)</span>
          <input value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} maxLength={500} placeholder="What is this project for?" />
        </label>
        <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Create project"}</button>
      </form>
    </div>
    <div className="panel securecloudFormPanel">
      <h3>Connect GitHub repository</h3>
      <p className="securecloudFormHint">Repository details are saved now. Builds and deployments remain unavailable until the isolated worker is ready.</p>
      {projects.length === 0 ? <p>Create a project first.</p> : <form className="securecloudForm" onSubmit={createService}>
        <label>Project
          <select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        </label>
        <label>Service name
          <input value={serviceName} onChange={(event) => setServiceName(event.target.value)} minLength={2} maxLength={80} required placeholder="web-app" />
        </label>
        <label>GitHub repository URL
          <input type="url" value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} required placeholder="https://github.com/owner/repository" />
        </label>
        <label>Branch
          <input value={branch} onChange={(event) => setBranch(event.target.value)} maxLength={120} required />
        </label>
        <label>Runtime
          <select value={runtime} onChange={(event) => setRuntime(event.target.value)}><option value="node">Node.js</option><option value="docker">Docker</option></select>
        </label>
        <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save repository"}</button>
      </form>}
    </div>
    <div className="panel securecloudFormPanel">
      <h3>Registered services</h3>
      {!selectedProject ? <p>Select a project to view its services.</p> : services.length === 0 ? <p>No services registered in this project yet.</p> : <div className="securecloudServiceList">{services.map((service) => <article className="panel securecloudService" key={service.id}>
        <strong>{service.name}</strong>
        <p><small>{service.repositoryUrl} · {service.branch} · {service.runtime}</small></p>
        <p><small>Latest deployment: {service.latestDeploymentStatus || "Not deployed"}</small></p>
        <button className="primary" type="button" disabled={!overview?.workerConfigured || busy} onClick={() => requestDeployment(service)}>{overview?.workerConfigured ? "Deploy" : "Deployment worker not installed"}</button>
      </article>)}</div>}
    </div>
    <p className="securecloudSecurityNote"><small>Owner and verified MFA required. Only HTTPS GitHub repository URLs are accepted.</small></p>
    <button type="button" className="primary" onClick={load} disabled={busy}>Refresh SecureCloud</button>
  </section>;
}
