#!/usr/bin/env bash
# Copies the live Let's Encrypt pair into a directory both Caddy and the
# WebTransport listener can read.
#
# The backend container runs as uid 10001 and certbot writes privkey.pem as
# 0600 root, so a direct mount of /etc/letsencrypt fails with EACCES and the
# server silently falls back to a self-signed certificate that browsers only
# trust for 14 days.
#
#   sudo deploy/sync-certs.sh api.example.com [/opt/asteron/certs]
#
# Re-run after every renewal, then restart the stack so both processes reload:
#   docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml \
#     --env-file deploy/.env restart backend caddy
set -euo pipefail

DOMAIN="${1:?usage: sync-certs.sh <domain> [cert-dir]}"
CERT_DIR="${2:-/opt/asteron/certs}"
SOURCE="/etc/letsencrypt/live/${DOMAIN}"

if [[ ! -d "${SOURCE}" ]]; then
  echo "No certificate at ${SOURCE}. Issue one first:" >&2
  echo "  sudo certbot certonly --standalone -d ${DOMAIN}" >&2
  exit 1
fi

mkdir -p "${CERT_DIR}"
chmod 0755 "${CERT_DIR}"
# Dereferenced on purpose: live/ holds symlinks into archive/, which is not
# mounted into the containers.
cp -L "${SOURCE}/fullchain.pem" "${CERT_DIR}/fullchain.pem"
cp -L "${SOURCE}/privkey.pem" "${CERT_DIR}/privkey.pem"
# Numeric ids: the backend's uid 10001 has no passwd entry on the host, so
# `install -o 10001` is rejected while chown takes it fine.
chown 10001:10001 "${CERT_DIR}/fullchain.pem" "${CERT_DIR}/privkey.pem"
chmod 0644 "${CERT_DIR}/fullchain.pem"
chmod 0640 "${CERT_DIR}/privkey.pem"

echo "Synced ${DOMAIN} certificate into ${CERT_DIR}."
