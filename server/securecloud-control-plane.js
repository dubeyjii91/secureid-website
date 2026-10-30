import { randomUUID } from "node:crypto";

const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

function cleanText(value, max) {
  return String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

function validGitUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "github.com" || url.hostname === "www.github.com") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function registerSecureCloudControlPlane({ app, database, requireAuth, requireMfa, requireOwner, enforceSameOrigin }) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS securecloud_projects (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_securecloud_projects_owner ON securecloud_projects(owner_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS securecloud_services (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      repository_url TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      runtime TEXT NOT NULL CHECK (runtime IN ('node','docker')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES securecloud_projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_securecloud_services_project ON securecloud_services(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS securecloud_deployments (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','building','deploying','live','failed','cancelled','blocked')),
      commit_ref TEXT,
      build_log TEXT NOT NULL DEFAULT '',
      error_code TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(service_id) REFERENCES securecloud_services(id),
      FOREIGN KEY(project_id) REFERENCES securecloud_projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_securecloud_deployments_service ON securecloud_deployments(service_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS securecloud_audit_events (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_securecloud_audit_created ON securecloud_audit_events(created_at DESC);
  `);

  const audit = database.prepare(`
    INSERT INTO securecloud_audit_events (id, actor_user_id, action, resource_type, resource_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  app.get("/api/securecloud/overview", requireAuth, requireMfa, requireOwner, (req, res) => {
    const projects = Number(database.prepare("SELECT COUNT(*) AS count FROM securecloud_projects WHERE owner_user_id=?").get(req.user.id).count);
    const services = Number(database.prepare("SELECT COUNT(*) AS count FROM securecloud_services WHERE owner_user_id=?").get(req.user.id).count);
    const deployments = Number(database.prepare("SELECT COUNT(*) AS count FROM securecloud_deployments WHERE owner_user_id=?").get(req.user.id).count);
    const latest = database.prepare(`
      SELECT d.id, d.status, d.created_at AS createdAt, s.name AS serviceName, p.name AS projectName
      FROM securecloud_deployments d
      JOIN securecloud_services s ON s.id=d.service_id
      JOIN securecloud_projects p ON p.id=d.project_id
      WHERE d.owner_user_id=? ORDER BY d.created_at DESC LIMIT 10
    `).all(req.user.id);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      success: true,
      platform: "SecureCloud",
      phase: "control-plane-foundation",
      workerConfigured: process.env.SECURECLOUD_WORKER_ENABLED === "true",
      projects, services, deployments, latest
    });
  });

  app.get("/api/securecloud/projects", requireAuth, requireMfa, requireOwner, (req, res) => {
    const projects = database.prepare(`
      SELECT p.id, p.name, p.description, p.created_at AS createdAt, p.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM securecloud_services s WHERE s.project_id=p.id) AS serviceCount
      FROM securecloud_projects p WHERE p.owner_user_id=? ORDER BY p.created_at DESC
    `).all(req.user.id);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, projects });
  });

  app.post("/api/securecloud/projects", enforceSameOrigin, requireAuth, requireMfa, requireOwner, (req, res) => {
    const name = cleanText(req.body?.name, MAX_NAME);
    const description = cleanText(req.body?.description, MAX_DESCRIPTION);
    if (name.length < 2) return res.status(400).json({ success: false, message: "Project name must contain at least 2 characters." });
    const id = randomUUID();
    const now = Date.now();
    database.transaction(() => {
      database.prepare("INSERT INTO securecloud_projects (id, owner_user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, req.user.id, name, description, now, now);
      audit.run(randomUUID(), req.user.id, "PROJECT_CREATED", "project", id, JSON.stringify({ name }), now);
    })();
    res.status(201).json({ success: true, project: { id, name, description, createdAt: now, serviceCount: 0 } });
  });

  app.get("/api/securecloud/projects/:projectId/services", requireAuth, requireMfa, requireOwner, (req, res) => {
    const project = database.prepare("SELECT id FROM securecloud_projects WHERE id=? AND owner_user_id=?").get(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ success: false, message: "Project not found." });
    const services = database.prepare(`
      SELECT s.id, s.name, s.repository_url AS repositoryUrl, s.branch, s.runtime, s.created_at AS createdAt,
        (SELECT d.status FROM securecloud_deployments d WHERE d.service_id=s.id ORDER BY d.created_at DESC LIMIT 1) AS latestDeploymentStatus
      FROM securecloud_services s WHERE s.project_id=? AND s.owner_user_id=? ORDER BY s.created_at DESC
    `).all(project.id, req.user.id);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, services });
  });

  app.post("/api/securecloud/projects/:projectId/services", enforceSameOrigin, requireAuth, requireMfa, requireOwner, (req, res) => {
    const project = database.prepare("SELECT id FROM securecloud_projects WHERE id=? AND owner_user_id=?").get(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ success: false, message: "Project not found." });
    const name = cleanText(req.body?.name, MAX_NAME);
    const repositoryUrl = cleanText(req.body?.repositoryUrl, 300);
    const branch = cleanText(req.body?.branch || "main", 120);
    const runtime = req.body?.runtime === "docker" ? "docker" : req.body?.runtime === "node" ? "node" : "";
    if (name.length < 2) return res.status(400).json({ success: false, message: "Service name must contain at least 2 characters." });
    if (!validGitUrl(repositoryUrl)) return res.status(400).json({ success: false, message: "Connect a valid HTTPS GitHub repository URL." });
    if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch)) return res.status(400).json({ success: false, message: "Branch name is invalid." });
    if (!runtime) return res.status(400).json({ success: false, message: "Choose Node.js or Docker runtime." });
    const id = randomUUID();
    const now = Date.now();
    database.transaction(() => {
      database.prepare("INSERT INTO securecloud_services (id, project_id, owner_user_id, name, repository_url, branch, runtime, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, project.id, req.user.id, name, repositoryUrl, branch, runtime, now, now);
      audit.run(randomUUID(), req.user.id, "SERVICE_CREATED", "service", id, JSON.stringify({ projectId: project.id, runtime }), now);
    })();
    res.status(201).json({ success: true, service: { id, projectId: project.id, name, repositoryUrl, branch, runtime, createdAt: now } });
  });

  app.post("/api/securecloud/services/:serviceId/deployments", enforceSameOrigin, requireAuth, requireMfa, requireOwner, (req, res) => {
    const service = database.prepare("SELECT id, project_id AS projectId FROM securecloud_services WHERE id=? AND owner_user_id=?").get(req.params.serviceId, req.user.id);
    if (!service) return res.status(404).json({ success: false, message: "Service not found." });
    if (process.env.SECURECLOUD_WORKER_ENABLED !== "true") {
      return res.status(503).json({ success: false, code: "DEPLOYMENT_WORKER_NOT_CONFIGURED", message: "Deployment worker is not connected yet. The service is saved; no build has been started." });
    }
    // The worker integration will claim this durable queue record in a later release.
    const id = randomUUID();
    const now = Date.now();
    database.transaction(() => {
      database.prepare("INSERT INTO securecloud_deployments (id, service_id, project_id, owner_user_id, status, commit_ref, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)")
        .run(id, service.id, service.projectId, req.user.id, cleanText(req.body?.commitRef, 80), now, now);
      audit.run(randomUUID(), req.user.id, "DEPLOYMENT_QUEUED", "deployment", id, JSON.stringify({ serviceId: service.id }), now);
    })();
    res.status(202).json({ success: true, deployment: { id, status: "queued", createdAt: now } });
  });

  app.get("/api/securecloud/deployments/:deploymentId", requireAuth, requireMfa, requireOwner, (req, res) => {
    const deployment = database.prepare(`
      SELECT d.id, d.status, d.commit_ref AS commitRef, d.build_log AS buildLog, d.error_code AS errorCode,
        d.created_at AS createdAt, d.updated_at AS updatedAt, s.name AS serviceName
      FROM securecloud_deployments d JOIN securecloud_services s ON s.id=d.service_id
      WHERE d.id=? AND d.owner_user_id=?
    `).get(req.params.deploymentId, req.user.id);
    if (!deployment) return res.status(404).json({ success: false, message: "Deployment not found." });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, deployment });
  });
}
