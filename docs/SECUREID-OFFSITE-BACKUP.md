# SecureID off-site encrypted backup runbook

## Architecture and current status

SecureID keeps its primary encrypted backup on the Railway volume. A separate **private GitHub repository** (dubeyjii91/secureid-backup-vault) provides an additional off-platform copy using GitHub Actions artifacts.

The private vault repository is the **single daily backup scheduler**:

1. The SecureID off-site encrypted backup vault workflow is configured to schedule daily at 09:25 Asia/Kolkata (03:55 UTC) and verifies that its destination repository is private before handling backup data. Observed scheduled run creation times on 13–19 November were approximately 11:05–12:39 UTC; investigate this delay and do not promise completion at 09:25.
2. It calls the token-protected Railway backup endpoint (/api/internal/backup/run) to create a fresh AES-256-GCM encrypted on-volume backup. The step retries while Railway wakes or the API becomes ready.
3. It downloads the encrypted backup from /api/internal/backup/download, verifies the SHA-256 against both the backup-trigger response and the download response, validates the filename and size, and requires the creation timestamp to be no older than 30 minutes.
4. It uploads the encrypted backup and a non-secret manifest as a GitHub Actions artifact with 30-day retention.

The public application repository does not run the backup scheduler and is not a backup destination. The same private workflow can be started manually from the vault repository's Actions tab; manual and scheduled runs follow the same trigger, verification, and export path.

The first manual vault run on 2026-11-13 successfully uploaded artifact secureid-encrypted-backup-43358708649 (9,102,329 bytes), containing an encrypted backup and manifest. Its ZIP integrity test passed. That was the initial download-and-upload path before the workflow was changed to create a fresh backup itself; the later verified run below now confirms the updated create-and-export path. Neither artifact upload alone nor that earlier manual run proves an off-site restore.

### Verified self-contained export (2026-11-13)

The updated private-vault workflow completed a full fresh-create → exact-file download → SHA-256 verification → off-site artifact upload run:

- Workflow run: [43364042250](https://github.com/dubeyjii91/secureid-backup-vault/actions/runs/43364042250), completed successfully on the private repository main branch.
- Backup creation response: 2026-11-13T04:13:03.875Z; encrypted artifact filename: `secureid-2026-11-13T04-13-03-768Z.backup.json`.
- Artifact: `secureid-encrypted-backup-43364042250`, artifact ID `14009741525`, ZIP size 9,102,329 bytes; retention expires 2026-12-13T04:13:05Z.
- Extracted encrypted file size: 9,101,719 bytes. Manifest SHA-256: `2854ef019c3186eb581983937f26c902371ba05a279dca080356da148a3fe339`.
- The trigger response SHA-256, download response SHA-256, manifest SHA-256, and locally recomputed SHA-256 of the extracted encrypted file all matched. The ZIP integrity test passed.
- All five operative workflow steps succeeded: private-repository check, fresh encrypted backup creation, exact filename-pinned download, digest/size/freshness validation, and artifact upload.

This was a push-triggered verification run after the workflow change, not a daily scheduled run. Subsequent scheduled executions are recorded separately below.

The Railway on-volume isolated restore drill associated with this 13 November evidence passed SQLite integrity, with 67 tables and 2 restored document blobs. This was an **on-volume** restore drill, not a restore from the GitHub off-site artifact.




### Latest scheduled backup evidence — 2026-11-19

- The last seven scheduled workflow runs (13–19 November) completed successfully.
- Latest run: [44522980025](https://github.com/dubeyjii91/secureid-backup-vault/actions/runs/44522980025), completed at `2026-11-19T12:20:44Z`.
- Encrypted backup: `secureid-2026-11-19T12-20-39-248Z.backup.json`; 3,080,487 bytes; SHA-256 `89325117f76faa27353ffae77ffbf448cc72df8a1383d176628a634e13485452`.
- Private GitHub Actions artifact: `secureid-encrypted-backup-44522980025`, artifact ID `14528981106`; ZIP size 3,081,097 bytes; ZIP SHA-256 `3bbc62a065449f01c2822fc101da03f32b3ff90c40007f3b7ba686cfadb31a85`; expires `2026-12-19T12:20:40Z`.
- Production on-volume restore drill at `2026-11-19T12:21:09Z` passed SQLite integrity and restored 109 tables, but both source and restored backup contained zero active document records and zero document blobs; `documentRestoreVerified=false`.
- **Not yet verified:** restoring the actual off-site GitHub artifact into a disposable isolated environment and decrypting/reading a synthetic document. The latest drill does not prove recovery of a real student document.
- Keep the artifact as a temporary additional copy only. Its 30-day retention, shared Actions quota and workflow-run deletion risk remain.

### Independent artifact retrieval check — 2026-11-20

- Downloaded the latest scheduled private GitHub Actions artifact `secureid-encrypted-backup-44522980025` (artifact ID `14528981106`) from the private vault repository.
- ZIP integrity test: passed. The archive contains the encrypted backup file (3,080,487 bytes) and `secureid-backup-manifest.txt` (258 bytes).
- Recomputed SHA-256 of the extracted encrypted backup: `89325117f76faa27353ffae77ffbf448cc72df8a1383d176628a634e13485452`; it exactly matches the manifest and the recorded 19 November export evidence.
- This verifies artifact retrieval, archive integrity, and encrypted-file hash consistency. It does **not** decrypt the backup, validate its AES-GCM authentication tag, or prove database/document recovery. The isolated off-site restore and synthetic-document read test remain outstanding.

## Security and retention

- The destination repository must remain private. The workflow checks repository visibility and fails closed otherwise.
- The vault repository must contain the Actions secret SECUREID_BACKUP_TRIGGER_TOKEN, matching Railway's BACKUP_TRIGGER_TOKEN.
- BACKUP_ENCRYPTION_KEY remains only in Railway. Never add it to GitHub, the vault repository, workflow logs, or the artifact.
- The trigger and download endpoints require the bearer token. The download endpoint streams only the encrypted AES-256-GCM backup, returns a SHA-256 digest header, and does not reveal a filesystem path or plaintext backup.
- The artifact contains the encrypted backup and a non-secret manifest (filename, byte count, SHA-256, creation time, encryption type).
- Artifact retention is 30 days. Artifacts can expire or be deleted, and GitHub Actions storage quotas can prevent uploads. This is a temporary additional off-site copy, not a permanent archive.
- Maximum transfer size is 400 MiB. Do not raise the cap automatically; review storage and recovery implications first.
- No paid storage provider or paid Railway resource is required by this workflow.

## Restore from a GitHub artifact

Perform recovery only on an isolated machine or disposable environment. Never restore a test artifact over the live production database.

1. In the private secureid-backup-vault repository, open Actions, select a successful run of **SecureID off-site encrypted backup vault**, and download its secureid-encrypted-backup-<run-id> artifact ZIP.
2. Extract the ZIP into a restricted local directory. It contains one secureid-*.backup.json encrypted file and secureid-backup-manifest.txt.
3. Verify the extracted encrypted backup against the manifest's sha256 value (for example, sha256sum secureid-*.backup.json).
4. Obtain the matching base64-encoded 32-byte BACKUP_ENCRYPTION_KEY through the operator's approved secret-recovery process. The key is stored separately in Railway and is not recoverable from GitHub artifacts.
5. Use a clean checkout of the matching SecureID source version. Set BACKUP_ENCRYPTION_KEY, DATABASE_PATH, and DOCUMENT_STORAGE_PATH in the isolated shell environment, with the database and document paths pointing to new, empty locations.
6. Run node scripts/secure-restore.mjs /absolute/path/to/secureid-<timestamp>.backup.json.
7. Verify SQLite with PRAGMA integrity_check, confirm expected tables, and confirm approved test documents can be decrypted/read.
8. Record the artifact run URL, creation time, SHA-256, restore time, integrity result, and operator. Never record the key or personal data in the evidence.

The restore script validates the AES-256-GCM authentication tag and snapshot digest before installing the restored database. Version-2 backups include document blobs. It creates a pre-restore recovery copy if the destination database already exists, but the drill should use new empty destinations.

## Operational monitoring and failure handling

- A vault workflow run is successful only if the private-repository check, fresh backup trigger, trigger-response digest validation, authenticated download, file-size and timestamp checks, both SHA-256 comparisons, and artifact upload all succeed.
- HTTP 401/404 indicates a token or endpoint configuration problem. Do not print or paste the secret to troubleshoot.
- HTTP 413 or a file above 400 MiB means no off-site artifact was stored.
- An upload quota failure means the off-site copy was not stored; the Railway-volume backup remains the confirmed recovery copy until a later successful vault run.
- Verify the first successful scheduled run of the self-contained private workflow, including whether retries were needed to wake Railway.
- A successful artifact upload does not prove that the artifact can be restored. Full off-site restore verification still requires the matching Railway encryption key to be handled securely in an isolated environment.
- Recheck artifact expiry and retention regularly. Do not treat the 30-day artifact as a permanent backup.
