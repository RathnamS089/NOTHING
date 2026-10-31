#!/bin/bash
# Collects what's needed to debug a packaged Nothing Island on macOS
# (e.g. a blank window). Prints only app/system facts and the app's own log:
# no personal files, no song titles, nothing is sent anywhere.
#
#   bash scripts/mac-diagnose.sh                 # checks /Applications/Nothing Island.app
#   bash scripts/mac-diagnose.sh "/path/to/Nothing Island.app"

APP="${1:-/Applications/Nothing Island.app}"
EXE="$APP/Contents/MacOS/Nothing Island"
LOG="$(mktemp -t nothing-island).log"

echo "== System"
sw_vers | tr '\n' ' '; echo
echo "cpu: $(uname -m)  translated: $(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)"

echo; echo "== App"
if [ ! -x "$EXE" ]; then echo "not found: $APP"; exit 1; fi
echo "path: $APP"
echo "version: $(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>&1)"
echo "binary: $(file -b "$EXE")"
echo "quarantine: $(xattr -p com.apple.quarantine "$APP" 2>/dev/null || echo none)"
echo "signature: $(codesign --verify --deep --strict "$APP" 2>&1 && echo valid)"

echo; echo "== Already running copies (these take over when you open the app)"
pgrep -fl "Nothing Island.app/Contents/MacOS/Nothing Island$" || echo none
for p in $(pgrep -f "Nothing Island.app/Contents/MacOS/Nothing Island$"); do
  echo "  pid $p runs from: $(ps -o comm= -p "$p")"
done

echo; echo "== Launch test (15 s)"
pkill -f "Nothing Island.app/Contents/MacOS/Nothing Island" 2>/dev/null && sleep 2
ELECTRON_ENABLE_LOGGING=1 "$EXE" > "$LOG" 2>&1 &
sleep 8
"$EXE" > /dev/null 2>&1   # second launch opens the app window
sleep 7
pkill -f "$EXE"
grep -iE "error|fail|crash|denied|not_found" "$LOG" | grep -viE "btm_database|task_policy_set" | tail -25
echo "(full log: $LOG)"
