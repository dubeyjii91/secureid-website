# SecureID off-site encrypted backup runbook

## What is stored

The scheduled GitHub Actions workflow is designed to call SecureID's token-protected backup trigger, download the newest AES-256-GCM encrypted backup over HTTPS, verify the SHA-256 digest of the exact downloaded file, and upload it as a private-repository Actions artifact. It first checks the repository visibility and fails closed unless the destination is private. **The current `dubeyjii91/secureid-website` repository is public, so the off-site transfer is intentionally blocked until the workflow runs from a private repository.**

- Artifact name: `secureid-encrypted-backup-<workflow-run-id>`
- Retention: 30 days
- Maximum transfer size: 400 MiB per backup
- GitHub Free artifact storage: shared repository/account quota; this workflow does not reserve capacity.
- The current public source repository is not an approved backup destination; no backup payload may be uploaded there.
- The artifact includes the encrypted backup and a non-secret manifest (filename, byte count, SHA-256, creation time, encryption type).
- `BACKUP_ENCRYPTION_KEY` is never sent to GitHub, written to the artifact, or included in workflow logs.
- The endpoint requires the existing `BACKUP_TRIGGER_TOKEN` bearer secret and is rate limited. It exposes no filesystem path or plaintext backup endpoint.

Until the workflow is hosted in a private repository, the GitHub off-site copy is not active. This is intended as an additional temporary off-site copy, not permanent disaster recovery. Artifacts expire after 30 days, can be deleted with workflow runs, and may fail to upload if the shared GitHub Actions storage quota is exhausted. Continue retaining the Railway-volume backup and monitoring workflow success.

## Restore from a GitHub artifact

Perform recovery only on an isolated machine or disposable environment. Never restore a test artifact over the live production database.

1. After the workflow has been moved to a private repository, open that repository's **Actions** tab and select a successful **SecureID scheduled encrypted backup** run.
2. Download the `secureid-encrypted-backup-<run-id>` artifact ZIP and extract it into a restricted local directory.
3. Verify the extracted encrypted backup against the `sha256` value in `secureid-backup-manifest.txt`:
   `sha256sum secureid-*.backup.json`.
4. Obtain the matching 32-byte base64 `BACKUP_ENCRYPTION_KEY` through the operator's approved secret-recovery process. It is stored separately in Railway; it is not recoverable from GitHub artifacts.
5. Choose new, empty, isolated paths for the database and document directory. Do not point either path at production.
6. Set `BACKUP_ENCRYPTION_KEY`, `DATABASE_PATH`, and `DOCUMENT_STORAGE_PATH` in the isolated shell environment, then run:
   `node scripts/secure-restore.mjs /absolute/path/to/secureid-<timestamp>.backup.json`.
7. Verify SQLite with `PRAGMA integrity_check`, verify expected tables, and confirm that approved test documents can be decrypted/read.
8. Record the artifact run URL, creation time, SHA-256, restore time, integrity result, and operator. Never record the key or personal data in the evidence.

The restore script creates a pre-restore recovery copy if the destination database already exists, but the preferred drill uses new empty destinations. Keep the encryption key separate from the artifact and restrict access to it.

## Operational limits and failure handling

- A workflow run is successful only if the backup trigger, authenticated download, byte-count check, SHA-256 comparison, and artifact upload all succeed.
- HTTP 401/404 means the trigger secret or endpoint configuration is wrong; do not print or paste the secret to troubleshoot.
- HTTP 413 means the artifact is over the 400 MiB safety cap. Do not raise the cap automatically; assess storage quota and choose an approved storage provider/plan first.
- An upload quota failure means the off-site copy was not stored. The Railway backup remains the only confirmed recovery copy until a later successful workflow run.
- Keep artifact retention at 30 days unless a separately reviewed retention decision is made.
- A successful manual run while Railway is awake does not prove the next scheduled run can wake a sleeping Railway service. Record the first scheduled execution separately.
