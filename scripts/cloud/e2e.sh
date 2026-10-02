#!/bin/bash
# Runs the Playwright E2E suite against the emulator suite, offline, the same
# way the `e2e` job in .github/workflows/ci.yml does. Meant for Claude Code
# cloud sessions (the session-start hook sets up the browser and proxy
# workarounds), but works anywhere Java 21 and a Playwright Chromium exist.
#
# Writes the same dummy, gitignored env files CI writes. If you already have
# a real apps/web/.env.local it is moved aside and restored afterwards.
set -euo pipefail

cd "$(dirname "$0")/../.."

export FIREBASE_PROJECT_ID=demo-ops
export CI="${CI:-1}"

pnpm --filter @ops/shared build
pnpm --filter @ops/functions build

cat > apps/functions/lib/.env.local <<'ENV'
DRIVE_PARENT_FOLDER_ID=
GOOGLE_OAUTH_CLIENT_ID=
MASTER_LOG_SHEET_ID=
PDF_RENDERER_URL=
ENV
cat > apps/functions/lib/.secret.local <<'ENV'
GEMINI_API_KEY=demo-gemini-key
GOOGLE_OAUTH_CLIENT_SECRET=demo-oauth-secret
DRIVE_OAUTH_REFRESH_TOKEN=
ENV

web_env=apps/web/.env.local
if [ -f "$web_env" ] && ! grep -q '^VITE_FIREBASE_PROJECT_ID=demo-ops$' "$web_env"; then
  mv "$web_env" "$web_env.e2e-backup"
  trap 'mv "$web_env.e2e-backup" "$web_env"' EXIT
fi
cat > "$web_env" <<'ENV'
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=demo-ops.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-ops
VITE_FIREBASE_STORAGE_BUCKET=demo-ops.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000
VITE_USE_EMULATORS=true
VITE_DEV_AUTH_SERVER=http://127.0.0.1:8787
ENV

pnpm exec firebase emulators:exec \
  --project demo-ops \
  --only firestore,auth,functions,storage \
  "node scripts/dev-auth-server.mjs & node scripts/wait-for-dev-auth-server.mjs && pnpm seed:dev && pnpm test:e2e $*"
