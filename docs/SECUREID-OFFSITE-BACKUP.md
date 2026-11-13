# SecureID off-site encrypted backup runbook

## Architecture and current status

SecureID keeps its primary encrypted backup on the Railway volume. A separate **private GitHub repository** (dubeyjii91/secureid-backup-vault) provides an additional off-platform copy using GitHub Actions artifacts.

The private vault repository is the **single daily backup scheduler**:

1. The SecureID off-site encrypted backup vault workflow runs daily at 09:25 Asia/Kolkata (03:55 UTC) and verifies that its destination repository is private before handling backup data.
2. It calls the token-protected Railway backup endpoint (/api/internal/backup/run) to create a fresh AES-256-GCM encrypted on-volume backup. The step retries while Railway wakes or the API becomes ready.
3. It downloads the encrypted backup from /api/internal/backup/download, verifies the SHA-256 against both the backup-trigger response and the download response, validates the filename and size, and requires the creation timestamp to be no older than 30 minutes.
4. It uploads the encrypted backup and a non-secret manifest as a GitHub Actions artifact with 30-day retention.

The public application repository does not run the backup scheduler and is not a backup destination. The same private workflow can be started manually from the vault repository's Actions tab; manual and scheduled runs follow the same trigger, verification, and export path.

The first manual vault run on 2026-11-13 successfully uploaded artifact secureid-encrypted-backup-43358708649 (9,102,329 bytes), containing the encrypted backup and manifest. Its ZIP integrity test passed. That was the initial download-and-upload path before the workflow was changed to create a fresh backup itself. The updated self-contained trigger-plus-export workflow must still have its first successful execution verified; a prior manual artifact does not prove that new end-to-end path or an off-site restore.

### Verified self-contained export (2026-11-13)

The updated private-vault workflow completed a full fresh-create → exact-file download → SHA-256 verification → off-site artifact upload run:

- Workflow run: [43364042250](https://github.com/dubeyjii91/secureid-backup-vault/actions/runs/43364042250), completed successfully on the private repository main branch.
- Backup creation response: 2026-11-13T04:13:03.875Z; encrypted artifact filename: `secureid-2026-11-13T04-13-03-768Z.backup.json`.
- Artifact: `secureid-encrypted-backup-43364042250`, artifact ID `14009741525`, ZIP size 9,102,329 bytes; retention expires 2026-12-13T04:13:05Z.
- Extracted encrypted file size: 9,101,719 bytes. Manifest SHA-256: `2854ef019c3186eb581983937f26c902371ba05a279dca080356da148a3fe339`.
- The trigger response SHA-256, download response SHA-256, manifest SHA-256, and locally recomputed SHA-256 of the extracted encrypted file all matched. The ZIP integrity test passed.
- All five operative workflow steps succeeded: private-repository check, fresh encrypted backup creation, exact filename-pinned download, digest/size/freshness validation, and artifact upload.

This was a push-triggered verification run after the workflow change, not the daily scheduled run. Because the private scheduler was merged after the 2026-11-13 09:25 Asia/Kolkata schedule time, the first scheduled execution is due 2026-11-14 at 09:25 Asia/Kolkata. The daily monitor should verify it separately.

The Railway on-volume isolated restore drill also passed after the latest production deployment: SQLite integrity `ok`, 67 tables, and 2 restored document blobs. This remains an **on-volume** restore drill. A restore from the GitHub off-site artifact has **not** yet been performed and must not be represented as complete.


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
