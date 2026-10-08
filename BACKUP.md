# SecureID encrypted backup and recovery

## Backup
Set BACKUP_ENCRYPTION_KEY to a base64-encoded 32-byte key and run:

npm run backup

Backups are written to BACKUP_DIR (default data/backups), encrypted with AES-256-GCM and integrity-checked with SHA-256.

## Recovery
Stop the SecureID server first, then run:

npm run restore -- ./data/backups/secureid-YYYY-MM-DD.backup.json

The existing database is renamed with a .pre-restore-* suffix before the validated backup is restored.

Keep the encryption key separately from backup files. Never commit backup files or the encryption key to Git.
