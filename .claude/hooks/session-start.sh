#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: installs dependencies and
# works around two quirks of the cloud container so the full CI suite
# (unit, rules and E2E tests) runs offline. Does nothing on local machines.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
repo="$(pwd)"

export PUPPETEER_SKIP_DOWNLOAD=1
pnpm install --frozen-lockfile
pnpm --filter @ops/shared build

# Emulator jars: fetch once now so the first rules/E2E run doesn't have to.
pnpm exec firebase setup:emulators:firestore >/dev/null
pnpm exec firebase setup:emulators:storage >/dev/null

# Playwright: the container ships one Chromium build in /opt/pw-browsers and
# downloads are discouraged. When the pinned @playwright/test expects a
# different revision, expose the installed build under the expected names in
# a private browsers dir.
pw_dir="$HOME/.cache/ops-pw-browsers"
if [ -d /opt/pw-browsers ]; then
  browsers_json="$(ls -d node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json | sort -V | tail -1)"
  want="$(node -e 'const b=require(process.argv[1]).browsers.find(x=>x.name==="chromium");console.log(b.revision)' "$repo/$browsers_json")"
  have_full="$(ls -d /opt/pw-browsers/chromium-[0-9]* | sort -V | tail -1)"
  have_shell="$(ls -d /opt/pw-browsers/chromium_headless_shell-[0-9]* | sort -V | tail -1)"
  if [ -d "/opt/pw-browsers/chromium-$want" ]; then
    pw_dir=/opt/pw-browsers
  else
    rm -rf "$pw_dir"
    mkdir -p "$pw_dir"
    full="$pw_dir/chromium-$want"
    shell="$pw_dir/chromium_headless_shell-$want/chrome-headless-shell-linux64"
    mkdir -p "$full" "$shell"
    ln -s "$(ls -d "$have_full"/chrome-linux* | head -1)" "$full/chrome-linux64"
    src_shell="$(ls -d "$have_shell"/chrome-* | head -1)"
    for f in "$src_shell"/*; do ln -s "$f" "$shell/"; done
    [ -e "$shell/chrome-headless-shell" ] || ln -s "$src_shell/headless_shell" "$shell/chrome-headless-shell"
    for d in "$full" "$(dirname "$shell")"; do
      touch "$d/INSTALLATION_COMPLETE" "$d/DEPENDENCIES_VALIDATED"
    done
    for f in /opt/pw-browsers/ffmpeg-*; do ln -s "$f" "$pw_dir/"; done
  fi
fi

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  {
    echo "export PUPPETEER_SKIP_DOWNLOAD=1"
    [ -d "$pw_dir" ] && echo "export PLAYWRIGHT_BROWSERS_PATH=$pw_dir"
    echo "export NODE_OPTIONS=\"--max-old-space-size=8192 --import $repo/scripts/cloud/firebase-no-proxy-shim.mjs\""
  } >> "$CLAUDE_ENV_FILE"
fi
