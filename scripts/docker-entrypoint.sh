#!/bin/sh
set -eu

# Railway mounts persistent volumes as root. When Railway starts this entrypoint
# as root (RAILWAY_RUN_UID=0), grant the app user access to persistent data and
# then drop privileges before starting the server.
if [ "$(id -u)" -eq 0 ]; then
  volume_path="${RAILWAY_VOLUME_MOUNT_PATH:-}"
  if [ -n "$volume_path" ] && [ -d "$volume_path" ]; then
    chown -R node:node "$volume_path"
  fi
  exec su-exec node "$@"
fi

exec "$@"
