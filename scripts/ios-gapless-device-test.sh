#!/usr/bin/env bash
#
# Physical-device verification for the iOS gapless chunk rotation.
#
# The Simulator already proves the algorithm is lossless and that the old
# -11861 / -12651 failure was an illegal AAC bit rate (64 kbps at a 16 kHz
# output rate) rather than a Simulator limitation. What a device adds:
#
#   1. its hardware AAC encoder may advertise a different bit-rate ceiling
#   2. a real microphone tap, real route changes, real background execution
#   3. enough runtime to actually cross two 5-minute chunk boundaries
#
# Usage:
#   scripts/ios-gapless-device-test.sh probe     # encoder matrix on the device
#   scripts/ios-gapless-device-test.sh install   # build + install the app
#   scripts/ios-gapless-device-test.sh pull DIR  # copy recorded chunks off the device
#   scripts/ios-gapless-device-test.sh verify DIR
#
set -euo pipefail

TEAM="${DEVELOPMENT_TEAM:-3CRVFMWSZ5}"
BUNDLE_ID="com.msecretary.app"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE="$REPO_ROOT/apps/mobile"
PROBE_DIR="${AWPROBE_DIR:-$REPO_ROOT/scripts/ios-audio-probe}"

die() { echo "error: $*" >&2; exit 1; }

device_udid() {
  local udid
  udid="$(xcrun xctrace list devices 2>/dev/null \
    | awk '/^== Devices ==/{d=1;next} /^== Devices Offline ==/{d=0} /^== Simulators ==/{exit} d && /\(([0-9A-F-]{25,})\)/ {print}' \
    | grep -v 'MacBook\|iMac\|Mac mini\|Mac Studio' \
    | sed -n 's/.*(\([0-9A-Fa-f-]\{25,\}\)).*/\1/p' | head -1)"
  [ -n "$udid" ] || die "no connected iPhone. Plug it in, unlock it, and trust this Mac.
    Currently visible:
$(xcrun xctrace list devices 2>/dev/null | sed -n '1,12p' | sed 's/^/      /')"
  echo "$udid"
}

cmd_probe() {
  [ -n "$PROBE_DIR" ] || die "set AWPROBE_DIR to the AWProbe package directory"
  local udid; udid="$(device_udid)"
  echo "==> running encoder/rotation probe on device $udid"
  cd "$PROBE_DIR"
  xcodebuild test \
    -scheme AWProbe \
    -destination "platform=iOS,id=$udid" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" \
    CODE_SIGN_STYLE=Automatic 2>&1 | grep -E '^===|error:|\*\* TEST'
}

cmd_install() {
  local udid; udid="$(device_udid)"
  echo "==> building MSecretary for device $udid"
  cd "$MOBILE/ios"
  xcodebuild \
    -workspace MSecretary.xcworkspace \
    -scheme MSecretary \
    -configuration Debug \
    -destination "platform=iOS,id=$udid" \
    -derivedDataPath build/device \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" \
    CODE_SIGN_STYLE=Automatic \
    build
  local app="build/device/Build/Products/Debug-iphoneos/MSecretary.app"
  [ -d "$app" ] || die "build produced no .app at $app"
  echo "==> installing"
  xcrun devicectl device install app --device "$udid" "$app"
  echo
  echo "Now, on the phone:"
  echo "  1. start a recording and leave it running for at least 11 minutes"
  echo "     (5-min chunks -> 2 rotations; speak continuously, or play"
  echo "      continuous speech/music near the mic so boundaries are audible)"
  echo "  2. stop the recording"
  echo "  3. run:  $0 pull ./device-chunks"
}

cmd_pull() {
  local dest="${1:-./device-chunks}"
  local udid; udid="$(device_udid)"
  mkdir -p "$dest"
  echo "==> copying Documents/meetings from $BUNDLE_ID"
  xcrun devicectl device copy from \
    --device "$udid" \
    --domain-type appDataContainer \
    --domain-identifier "$BUNDLE_ID" \
    --source Documents/meetings \
    --destination "$dest"
  echo "==> pulled:"
  find "$dest" -name '*.m4a' | sort
}

cmd_verify() {
  local dir="${1:-./device-chunks}"
  [ -d "$dir" ] || die "no such directory: $dir"
  echo "==> chunk report for $dir"
  python3 - "$dir" <<'PY'
import os, re, subprocess, sys

d = sys.argv[1]
files = []
for root, _, names in os.walk(d):
    for n in names:
        if n.endswith(".m4a"):
            files.append(os.path.join(root, n))

def key(p):
    m = re.search(r'_(\d+)\.m4a$', os.path.basename(p))
    return int(m.group(1)) if m else 0

files.sort(key=key)
if not files:
    sys.exit("no .m4a chunks found")

total = 0.0
rows = []
for p in files:
    out = subprocess.run(["afinfo", p], capture_output=True, text=True).stdout
    dur = re.search(r'estimated duration:\s*([0-9.]+)', out)
    rate = re.search(r'([0-9.]+) Hz', out)
    fmt = re.search(r'Data format:\s*(.+)', out)
    br = re.search(r'bit rate:\s*(\d+)', out)
    d_ = float(dur.group(1)) if dur else 0.0
    total += d_
    rows.append((os.path.basename(p), d_, os.path.getsize(p),
                 rate.group(1) if rate else "?",
                 br.group(1) if br else "?",
                 (fmt.group(1).strip() if fmt else "?")))

w = max(len(r[0]) for r in rows)
print(f"{'chunk'.ljust(w)}  {'duration':>9}  {'bytes':>9}  {'rate':>7}  {'bitrate':>8}")
for name, d_, size, rate, br, fmt in rows:
    print(f"{name.ljust(w)}  {d_:9.3f}  {size:9d}  {rate:>7}  {br:>8}")

print()
print(f"chunks: {len(rows)}   total: {total:.3f}s ({total/60:.2f} min)")

full = [r[1] for r in rows[:-1]]
if full:
    lo, hi = min(full), max(full)
    print(f"non-final chunk durations: {lo:.3f}s .. {hi:.3f}s (spread {(hi-lo)*1000:.1f} ms)")
    print()
    print("Reminder: AVURLAsset/afinfo report ~132 ms short per chunk because of the")
    print("AAC priming edit list. That is a labelling artifact, not lost audio — the")
    print("decoded frame count matches the input exactly. Judge gaplessness by")
    print("listening across a boundary, not by summing these durations.")
PY
}

case "${1:-}" in
  probe)   shift; cmd_probe "$@" ;;
  install) shift; cmd_install "$@" ;;
  pull)    shift; cmd_pull "$@" ;;
  verify)  shift; cmd_verify "$@" ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
