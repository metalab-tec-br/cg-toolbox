# ════════════════════════════════════════════════════════════════════════
# CG Toolbox — frontend image (cg-toolbox-frontend)
#
# Static files (index.html, css/, js/, img/) served by nginx, with a reverse
# proxy for /api/* to the backend container (cg-toolbox-backend) — see
# nginx.conf. This is the ONLY container exposed to the browser/host network
# (see docker-compose.yml: cg-toolbox-db and cg-toolbox-backend have no
# published ports).
#
# Build context is the repo root (same as the backend Dockerfile) — see
# docker-compose.yml: "dockerfile: frontend/Dockerfile".
# ════════════════════════════════════════════════════════════════════════
FROM nginx:1.27-alpine

COPY frontend/nginx.conf /etc/nginx/nginx.conf
COPY index.html /usr/share/nginx/html/index.html
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY img /usr/share/nginx/html/img

EXPOSE 80
