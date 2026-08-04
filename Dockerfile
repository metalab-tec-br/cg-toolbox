# ════════════════════════════════════════════════════════════════════════
# CG Toolbox — Docker image
#
# Multi-stage build:
#   1) "deps"    — installs server/node_modules with compilers available
#                  (better-sqlite3 has a native binary; if no prebuilt
#                  matches this image's OS/arch it compiles from source here)
#   2) final     — copies only the app + compiled node_modules into a lean
#                  runtime image, no compilers left behind, runs as a
#                  non-root user
#
# The SQLite database is NOT baked into the image — DB_PATH (below) points
# at /app/data, meant to be a mounted volume (see docker-compose.yml) so
# your command catalog survives image rebuilds/container recreation.
# ════════════════════════════════════════════════════════════════════════

# ---- stage 1: install dependencies ----------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app/server

# python3/make/g++ are only actually exercised if npm can't find a prebuilt
# better-sqlite3 binary for this exact OS/arch and has to compile it itself.
#
# The sed below forces Debian's apt sources to HTTPS instead of HTTP. Some
# networks (corporate proxy/DPI in the path) let small plain-HTTP responses
# through but stall/mangle larger ones — deb.debian.org's InRelease/Packages
# downloads hang forever with "Connection timed out" while the exact same
# host has no trouble reaching the internet over HTTPS. Rewriting to https://
# sidesteps that without needing to touch anything outside the image.
RUN find /etc/apt -name '*.list' -o -name '*.sources' 2>/dev/null | xargs -r sed -i \
      -e 's|http://deb.debian.org|https://deb.debian.org|g' \
      -e 's|http://security.debian.org|https://security.debian.org|g' \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- stage 2: runtime image -------------------------------------------
FROM node:20-bookworm-slim
WORKDIR /app

# Frontend (static files served by Express — see server/index.js, FRONTEND_ROOT)
COPY index.html ./index.html
COPY css ./css
COPY js ./js
COPY img ./img

# Server source (schema.sql, index.js, db.js, seed.js, package.json — NOT
# commands.db or node_modules, both excluded via .dockerignore)
COPY server ./server

# Compiled dependencies from the "deps" stage — keeps python3/make/g++ out
# of the final image entirely.
COPY --from=deps /app/server/node_modules ./server/node_modules

# Dedicated non-root user, same spirit as install-cgtoolbox.sh's systemd service
# user — and a /app/data folder for the persistent-volume database.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin cgtoolbox \
    && mkdir -p /app/data \
    && chown -R cgtoolbox:cgtoolbox /app
USER cgtoolbox

ENV PORT=3000
# HTTPS_PORT defaults to 443 in server/index.js — explicitly pinned to the
# same value as PORT here so the container only opens ONE listener by
# default. Binding a port <1024 as this non-root user would fail (EACCES);
# reaching the app on 80/443 from outside is done via the HOST port mapping
# in docker-compose.yml ("80:3000"), not by binding low ports in-container.
# To terminate real TLS inside the container instead, override HTTPS_PORT to
# a high port (e.g. 3443) + TLS_CERT_PATH/TLS_KEY_PATH, and map that port on
# the host — see the commented block in docker-compose.yml.
ENV HTTPS_PORT=3000
ENV DB_PATH=/app/data/commands.db
# Uncomment (or set at "docker run"/compose level) if this host is not on a
# Windows domain — otherwise NTLM identification is attempted by default,
# same as the bare-metal/systemd deployment (see server/index.js).
# ENV NTLM_DISABLED=1

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
