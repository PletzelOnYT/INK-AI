#!/bin/bash
# Launch INK AI with Apple's built-in, on-device Vision OCR on macOS.
# Source code is in this repository. No pip/npm/Ollama/server account.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ "$(uname -s)" != "Darwin" ]; then
  echo "This optional OCR engine uses macOS Vision and requires a Mac."
  exit 1
fi
if ! command -v swiftc >/dev/null 2>&1; then
  echo "Swift compiler missing. Install Apple's Command Line Tools:"
  echo "  xcode-select --install"
  exit 1
fi
mkdir -p ".ink-build"
HELPER="$ROOT/.ink-build/ink-vision-local"
if [ ! -x "$HELPER" ] || [ "$ROOT/mac/InkVisionServer.swift" -nt "$HELPER" ]; then
  echo "Compiling INK AI's local macOS Vision helper..."
  swiftc -O "$ROOT/mac/InkVisionServer.swift" \
    -framework Vision -framework AppKit -framework ImageIO \
    -o "$HELPER"
fi
TOKEN="$(uuidgen | tr -d '-')$(uuidgen | tr -d '-')"
export INK_VISION_TOKEN="$TOKEN"
"$HELPER" &
VISION_PID=$!
cleanup() {
  kill "$VISION_PID" 2>/dev/null || true
  wait "$VISION_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
for i in $(seq 1 30); do
  if ! kill -0 "$VISION_PID" 2>/dev/null; then
    echo "Vision helper did not start (possibly already running on port 17861)."
    exit 1
  fi
  if curl --silent --fail --max-time 1 -H "X-Ink-Token: $TOKEN" \
    http://127.0.0.1:17861/health >/dev/null; then
    break
  fi
  sleep 0.15
done
URL="file://\${ROOT// /%20}/index.html#ink-vision-token=$TOKEN"
if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "$URL"
else
  open "$URL"
fi
echo ""
echo "INK AI is open. Click the Camera button."
echo "Recognized text stays on this Mac and is processed with macOS Vision."
echo "Keep this terminal open while using camera mode."
echo "Press Control-C to stop the local companion."
echo ""
wait "$VISION_PID"
