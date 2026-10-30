# Nothing Island

An AirPods-style experience for Nothing and CMF earbuds on macOS and Windows. When your buds connect, a Dynamic Island grows out of the top of the screen and shows battery and noise control. Click **Customise** to open a resizable companion app in the style of Nothing X.

## Run

```bash
npm install
npm start        # watch Bluetooth for real Nothing / CMF buds
npm run demo     # simulate a connected CMF Buds 2a (macOS/Linux shell)
npm run demo:win # same, on Windows cmd
```

The app lives in the menu bar (macOS) or system tray (Windows). The tray menu can show the island again, turn it off, or switch the simulated device on and off.

## How it works

| Piece | File |
| --- | --- |
| Bluetooth detection (macOS `system_profiler`, Windows PnP via PowerShell), polled every 3 s | `src/main/detector.js` |
| Model catalog: Ear (1/2/3/a/stick/open), Headphone (1), CMF Buds family. Matched by name or by Nothing's `2C:BE:EE` MAC prefix | `src/main/devices.js` |
| Island window: transparent, always on top, click-through except on the pill | `src/renderer/island/` |
| Companion window: phone layout below 760 px wide, two columns above that, two card columns above 1180 px | `src/renderer/app/` |
| Per-device settings saved as JSON in the user-data folder | `src/main/store.js` |
| Earbud command channel (stub) | `src/main/protocol.js` |

## Current limits

- **Controls aren't sent to the buds yet.** Nothing buds take ANC, EQ and gesture commands over a vendor RFCOMM (Serial Port) channel. Reaching it needs a native bridge (IOBluetooth on macOS, `Windows.Devices.Bluetooth.Rfcomm` on Windows). For now `protocol.js` only saves the settings locally.
- **Battery:** macOS only reports battery for some third-party buds. Windows reports a single overall level. Per-bud and case battery levels will come through the RFCOMM link.
- The Windows detector has not been tested on Windows yet.
