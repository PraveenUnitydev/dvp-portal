#!/usr/bin/env bash
# Update the DVP portal on the server: pull the code, install, build the screens for /dvp/, restart, check.
#   bash deploy/deploy.sh                 (the branch that is checked out)
#   bash deploy/deploy.sh admin-catalog-programs
# Uploaded files (UPLOAD_DIR) and the database are not touched.
set -euo pipefail
cd "$(dirname "$0")/.."

# The settings file must exist first (see DEPLOY.md, step 2)
if [ ! -f backend/.env ]; then
  echo "!! backend/.env is missing. Create it first:  cp backend/.env.example backend/.env  and fill it in (see DEPLOY.md)."
  exit 1
fi
for key in JWT_SECRET SSO_APP_SECRET; do
  if ! grep -qE "^${key}=.{32,}" backend/.env; then
    echo "!! ${key} in backend/.env is empty or shorter than 32 characters (see DEPLOY.md)."
    exit 1
  fi
done

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
echo "== Updating to origin/$BRANCH"
git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "== Server packages"
(cd backend && npm ci --omit=dev)

echo "== Screens (built for https://vrc.mahindra.com/dvp/)"
(cd frontend && npm ci && npm run build:vrc)
# Swap the new build in at once, so nobody gets half of the old one and half of the new one
rm -rf backend/build.new
cp -r frontend/dist backend/build.new
rm -rf backend/build.old
[ -d backend/build ] && mv backend/build backend/build.old
mv backend/build.new backend/build
rm -rf backend/build.old

echo "== Restart"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

PORT="$( (grep -E '^PORT=' backend/.env || true) | cut -d= -f2)"
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if out="$(curl -fsS "http://127.0.0.1:${PORT:-7100}/api/health" 2>/dev/null)"; then
    echo "== Running: $out"
    case "$out" in *'"connected"'*) exit 0 ;; *) echo "!! The portal is up but the database is not connected. Check MONGO_URI and: pm2 logs dvp-portal"; exit 1 ;; esac
  fi
done
echo "!! The portal did not answer. Check: pm2 logs dvp-portal"
exit 1
