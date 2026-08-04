# ════════════════════════════════════════════════════════════════════════
# CG Toolbox — backend image (cg-toolbox-backend)
#
# Pure Node/Express REST API — no static frontend files here anymore (see
# frontend/Dockerfile for the nginx image that serves those and reverse
# proxies /api/* to this container). Talks to PostgreSQL (cg-toolbox-db, a
# separate container — see docker-compose.yml) over the network, so there is
# no native module to compile (no better-sqlite3 anymore) and no local
# database file/volume for this image.
#
# `postgresql-client` is installed for the Backup & Restore feature (Settings
# → System → Database), which shells out to `pg_dump`/`pg_restore` — see
# server/index.js.
# ════════════════════════════════════════════════════════════════════════
FROM node:20-bookworm-slim
WORKDIR /app/server

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/schema.sql server/db.js server/index.js server/seed.js ./

# Dedicated non-root user + a /app/backups folder for the Backup & Restore
# feature (mounted as a named volume in docker-compose.yml, so dumps survive
# image rebuilds/container recreation).
RUN useradd --system --no-create-home --shell /usr/sbin/nologin cgtoolbox \
    && mkdir -p /app/backups \
    && chown -R cgtoolbox:cgtoolbox /app
USER cgtoolbox

ENV PORT=3000
ENV BACKUP_DIR=/app/backups
# Uncomment (or set at "docker run"/compose level) if this host is not on a
# Windows domain — otherwise NTLM identification is attempted by default.
# ENV NTLM_DISABLED=1

EXPOSE 3000
VOLUME ["/app/backups"]

CMD ["node", "index.js"]
