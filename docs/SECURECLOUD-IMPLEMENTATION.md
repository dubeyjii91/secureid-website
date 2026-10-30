# SecureCloud implementation status

SecureCloud is integrated into the existing SecureID application. The existing React/Vite interface, Express API, authentication, owner authorization, and SQLite account data remain the application foundation.

## Implemented in the control-plane foundation

- Owner-only, MFA-gated project and service APIs.
- CSRF/same-origin enforcement on state-changing routes.
- SQLite records for projects, services, deployments, and audit events.
- GitHub HTTPS repository URL validation and Node.js/Docker runtime selection.
- SecureCloud controls embedded in the existing SecureID owner console.
- Deployment requests fail closed until an isolated worker is configured.

## Terminology: SecureCloud projects vs hosting infrastructure

A SecureCloud project is currently a logical workspace record stored in SecureID's SQLite database. It groups service metadata such as a website repository and an API repository. It is not a Railway project, cloud account, virtual machine, database, public website, or paid hosting resource.

Adding a GitHub repository currently stores its HTTPS URL, branch, and selected runtime as metadata. It does not install a GitHub App, verify that SecureCloud can read the repository, fetch source code, build an image, or deploy a workload. The owner UI must continue to state these limitations until those integrations exist.

Creating a workspace or registering repository metadata does not provision external infrastructure or intentionally create a new hosting charge.

## Not yet production-enabled

The current control plane does not execute repository code and does not yet build or run customer workloads. A deployment request returns `DEPLOYMENT_WORKER_NOT_CONFIGURED` unless a future worker integration is installed. Do not set `SECURECLOUD_WORKER_ENABLED=true` until the worker is implemented, isolated, tested, and connected to the durable queue.

## Required next milestones

1. GitHub App installation flow with minimum repository permissions; store installation credentials encrypted and never ask users to paste private keys into the dashboard.
2. Signed webhook verification and repository event processing.
3. Durable worker claim/lease protocol, retries, cancellation, and stale-job recovery.
4. Isolated build workers on disposable VMs or microVMs; never mount the host Docker socket into the SecureID API or dashboard.
5. Build resource limits, outbound network controls, image scanning, artifact retention, and registry authentication.
6. Separate runtime hosts for deployed workloads with per-service CPU, memory, disk, process, and network limits.
7. Deployment health checks, logs, rollback, environment-variable encryption, and secret redaction.
8. Custom domains, automated TLS, DNS validation, and routing.
9. Metering, quotas, usage reporting, spend limits, backups, alerts, and abuse controls.
10. Security review and load testing before enabling public self-service deployments.

## Production safety

- Keep SecureID production serving users while SecureCloud is developed behind owner-only access.
- Merge changes only after CI passes and the production deployment has been reviewed.
- Do not run untrusted builds on the API host.
- Do not expose Docker, container-runtime, cloud, GitHub App, or database credentials to browser code.
- Keep deployment workers and workload runtimes on separate trust boundaries.
- Maintain an operator-controlled kill switch and hard usage limits.
