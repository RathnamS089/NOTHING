# Nothing Island

An AirPods-style experience for Nothing and CMF earbuds on macOS, Windows and Linux. When your buds connect, a Dynamic Island grows out of the top of the screen and shows battery and noise control. Click **Customise** to open a resizable companion app in the style of Nothing X.

**Download:** [Releases](https://github.com/RathnamS089/NOTHING/releases). The release notes cover which file to pick and first-launch steps.

## Run from source

```bash
npm install      # on macOS this also builds the Bluetooth helper
npm start        # watch Bluetooth for real Nothing / CMF buds (npm run dev does the same)
npm run demo     # simulate a connected CMF Buds 2a (macOS/Linux shell)
npm run demo:win # same, on Windows cmd
npm test
```

The app lives in the menu bar (macOS) or system tray (Windows/Linux).

## What works

| | macOS | Linux | Windows |
|---|---|---|---|
| Detect Nothing/CMF buds, island pop-up | ✅ | ⚠️ untested | ⚠️ untested |
| Battery (per bud), ANC, EQ, Ultra Bass, low lag, find my buds | ✅ | ⚠️ untested | ❌ not yet |
| Quick-switch between Nothing devices | ✅ | ⚠️ untested | ❌ not yet |
| Song glyphs / album cover dots | ✅ | ⚠️ untested | glyphs only, untested |

Controls are sent to the buds over Nothing's RFCOMM channel through a small native helper: Swift/IOBluetooth on macOS, Python/BlueZ on Linux. They're tested on a CMF Buds 2a. Windows has no helper yet, so it only detects the buds and shows the island.

## Compatibility

Which buds have been tried on which system. Have a pair that's untested here? A [compatibility report](https://github.com/RathnamS089/NOTHING/issues/new?template=compatibility.yml) fills in a gap, even when it says "doesn't work".

| Model | macOS | Linux | Windows |
|---|---|---|---|
| CMF Buds 2a | ✅ | ❔ | ❔ |
| CMF Buds 2 | 🟡 detected, controls unconfirmed | ❔ | ❔ |
| CMF Buds 2 Plus | ❔ | ❔ | ❔ |
| CMF Buds Pro 2 | ❔ | ❔ | ❔ |
| CMF Buds Pro, CMF Buds, CMF Neckband Pro | ❔ | ❔ | ❔ |
| Ear (1), Ear (2), Ear (3) | ❔ | ❔ | ❔ |
| Ear, Ear (a), Ear (open), Ear (stick) | ❔ | ❔ | ❔ |
| Headphone (1) | ❔ | ❔ | ❔ |

✅ works (island, battery, ANC and EQ) · 🟡 partly works · ❌ doesn't work · ❔ not tested yet. On Windows only the island and battery are expected for now.

## Updates

Installed builds check this repo's GitHub Releases a few seconds after launch and every 6 hours. You can switch this off in **Settings → Island & app**.

- **Windows, Linux (.deb, .rpm, AppImage):** the new version downloads in the background and installs when you quit, or right away with **Restart to update**. On .deb and .rpm, Linux asks for your password to install it.
- **macOS:** shows **Download** with a link to the new release. macOS only lets an app replace itself when it's signed with an Apple Developer ID, so you install the new .dmg yourself for now.

The only requests go to github.com; nothing about you, your buds or what's playing is sent. Running from source (`npm start`) never updates itself: use `git pull`.

## Current limits

- Only CMF Buds 2a has been tested with real hardware. Other models may show wrong or missing settings.
- No Windows Bluetooth helper yet (needs `Windows.Devices.Bluetooth.Rfcomm`).
- Songs playing in Firefox on macOS aren't detected.
- Release builds are ad-hoc signed but not notarized, so macOS asks once for **Open Anyway**.

## More

- [ARCHITECTURE.md](ARCHITECTURE.md): how the pieces fit together
- [RELEASING.md](RELEASING.md): CI builds, releases and signing
- `scripts/mac-diagnose.sh`: collects info for macOS bug reports
