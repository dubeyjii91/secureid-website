# SecureID off-site encrypted backup runbook

## Architecture and current status

SecureID keeps its primary encrypted backup on the Railway volume. A separate **private GitHub repository** (dubeyjii91/secureid-backup-vault) provides an additional off-platform copy using GitHub Actions artifacts.

The flow is:

1. The source repository workflow .github/workflows/scheduled-encrypted-backup.yml triggers the token-protected Railway backup endpoint at 09:05 Asia/Kolkata (03:35 UTC).
2. The source repository is public, so its privacy guard intentionally blocks any backup download or artifact upload there. The trigger can still create the encrypted on-volume backup before that guard runs.
3. The private vault repository workflow .github/workflows/offsite-encrypted-backup.yml runs at 09:25 Asia/Kolkata (03:55 UTC), downloads the newest encrypted backup from Railway, verifies the response SHA-256, and uploads the encrypted file plus a non-secret manifest as a GitHub Actions artifact.
4. The vault workflow can also be started manually from the private repository's Actions tab.

The first manual vault run succeeded on 2026-11-13. It uploaded artifact secureid-encrypted-backup-43358708649 (9,102,329 bytes), containing the 9,101,719-byte encrypted backup and its manifest. The backup file SHA-256 matched the Railway response digest and manifest. The ZIP archive passed its integrity test. This confirms the first off-site artifact upload; it does **not** yet prove a scheduled run while Railway is asleep or a full restore from this off-site artifact.

## Security and retention

- The destination repository must remain private. The workflow checks repository visibility and fails closed otherwise.
- The vault repository must contain the Actions secret SECUREID_BACKUP_TRIGGER_TOKEN, matching Railway's BACKUP_TRIGGER_TOKEN.
- BACKUP_ENCRYPTION_KEY remains only in Railway. Never add it to GitHub, the vault repository, workflow logs, or the artifact.
- The download endpoint requires the bearer token, streams only the encrypted AES-256-GCM backup, returns a SHA-256 digest header, and does not reveal a filesystem path or plaintext backup.
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

- A vault workflow run is successful only if the destination-private check, authenticated download, file-size and timestamp checks, SHA-256 comparison, and artifact upload all succeed.
- HTTP 401/404 indicates a token or endpoint configuration problem. Do not print or paste the secret to troubleshoot.
- HTTP 413 or a file above 400 MiB means no off-site artifact was stored.
- An upload quota failure means the off-site copy was not stored; the Railway-volume backup remains the confirmed recovery copy until a later successful vault run.
- A manual run while Railway is awake does not prove the scheduled run can wake a sleeping Railway service. Verify the first scheduled source trigger and the following scheduled vault export independently.
- Recheck artifact expiry and retention regularly. Do not treat the 30-day artifact as a permanent backup.
