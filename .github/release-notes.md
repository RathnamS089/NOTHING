**Early alpha for testers.** It works on the developer's CMF Buds 2a on macOS. Windows and Linux builds are untested on real hardware. Please report what works and what doesn't in an issue.

## Downloads

| System | File |
|---|---|
| macOS, Apple Silicon (M1 or later) | `Nothing-Island-*-arm64.dmg` |
| macOS, Intel | `Nothing-Island-*-x64.dmg` |
| Windows 10/11 | `Nothing-Island-Setup-*.exe` |
| Linux (Debian/Ubuntu) | `*.deb` |
| Linux (any) | `*.AppImage` |

`SHA256SUMS.txt` lets you check that a download wasn't tampered with.

## These builds are unsigned

- **macOS:** the first time, right-click the app, choose **Open**, then **Open** again. If macOS says the app is "damaged", run `xattr -dr com.apple.quarantine "/Applications/Nothing Island.app"`. Allow Bluetooth when asked.
- **Windows:** SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway**.
- **Linux:** for the AppImage, run `chmod +x Nothing-Island-*.AppImage` and start it. BlueZ and Python 3 are needed for earbud controls.

## What works where

| | macOS | Linux | Windows |
|---|---|---|---|
| Detect Nothing/CMF buds, island pop-up | ✅ | ⚠️ untested | ⚠️ untested |
| Battery, ANC, EQ, bass, find my buds | ✅ | ⚠️ untested | ❌ not yet |
| Quick-switch between Nothing devices | ✅ | ⚠️ untested | ❌ not yet |
| Song glyphs | ✅ | ⚠️ untested | ⚠️ untested |
| Album cover dots | ✅ | ⚠️ untested | ❌ not yet |

## Known issues

- Songs playing in Firefox on macOS aren't detected. Safari, Chrome, Arc, Brave, Edge, the Spotify app and the Music app are.
- On some Linux Wayland desktops the island may draw an opaque box instead of a transparent pill.
- Only CMF Buds 2a has been tested. Other Nothing and CMF models may show wrong or missing settings.

## Privacy

Nothing Island has no accounts, analytics or telemetry. It only goes online to fetch album art from the service already playing the song (Spotify's or YouTube's image servers), and covers are never saved to disk.
