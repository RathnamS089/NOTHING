**Early alpha for testers.** It works on the developer's CMF Buds 2a on macOS. Windows and Linux builds are untested on real hardware. Please report what works and what doesn't in an issue.

## Downloads

| System | File |
|---|---|
| macOS, Apple Silicon (M1 or later) | `Nothing-Island-*-arm64.dmg` |
| macOS, Intel | `Nothing-Island-*-x64.dmg` |
| Windows 10/11 | `Nothing-Island-Setup-*.exe` |
| Ubuntu 22.04 / 24.04 / 25.x, Debian 12+, Linux Mint 21+, Pop!_OS | `Nothing-Island-*-amd64.deb` |
| Fedora 40+, RHEL/Rocky/Alma 9+, openSUSE | `Nothing-Island-*-x86_64.rpm` |
| Any other 64-bit Linux (Arch, …) | `Nothing-Island-*-x86_64.AppImage` |

`SHA256SUMS.txt` lets you check that a download wasn't tampered with.

## These builds are unsigned

- **macOS:** the first time, right-click the app, choose **Open**, then **Open** again. If macOS says the app is "damaged", run `xattr -dr com.apple.quarantine "/Applications/Nothing Island.app"`. Allow Bluetooth when asked.
- **Windows:** SmartScreen shows "Windows protected your PC". Click **More info**, then **Run anyway**.
- **Linux:** no warnings, but install from the terminal:
  - Ubuntu/Debian: `sudo apt install ./Nothing-Island-*-amd64.deb`
  - Fedora: `sudo dnf install ./Nothing-Island-*-x86_64.rpm`
  - AppImage: `chmod +x Nothing-Island-*.AppImage`, then run it. Ubuntu 24.04+ also needs `sudo apt install libfuse2t64`.

  The `.deb` and `.rpm` pull in BlueZ and Python 3 for earbud controls.

## GNOME (Ubuntu and Fedora desktops)

- **Tray icon:** stock GNOME hides tray icons. Ubuntu already includes the AppIndicator extension. On Fedora, install it with `sudo dnf install gnome-shell-extension-appindicator`, log out and in, and enable it in the Extensions app. Without it, open the app from the app grid.
- **Wayland:** the island runs through XWayland, because Wayland doesn't let apps place their own windows. This happens automatically and needs nothing from you.
- KDE, Cinnamon, XFCE and other desktops show the tray icon out of the box.

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
- On some Linux desktops without a compositor, the island may draw a black box instead of a transparent pill.
- Only CMF Buds 2a has been tested. Other Nothing and CMF models may show wrong or missing settings.

## Privacy

Nothing Island has no accounts, analytics or telemetry. It only goes online to fetch album art from the service already playing the song (Spotify's or YouTube's image servers), and covers are never saved to disk.
