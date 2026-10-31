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

## Current limits

- Only CMF Buds 2a has been tested with real hardware. Other models may show wrong or missing settings.
- No Windows Bluetooth helper yet (needs `Windows.Devices.Bluetooth.Rfcomm`).
- Songs playing in Firefox on macOS aren't detected.
- Release builds are ad-hoc signed but not notarized, so macOS asks once for **Open Anyway**.

## More

- [ARCHITECTURE.md](ARCHITECTURE.md): how the pieces fit together
- [RELEASING.md](RELEASING.md): CI builds, releases and signing
- `scripts/mac-diagnose.sh`: collects info for macOS bug reports
