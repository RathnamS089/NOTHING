# How Nothing Island works

A one-page map of the project: what each part does, how data moves, and where to look when something breaks.

## The big picture

Nothing Island is an Electron app with three layers:

```
┌──────────────────────────────── Renderer windows (sandboxed, no Node) ─────────────┐
│  island/   the Dynamic Island pill        app/   the Nothing X-style settings app  │
│                 shared/  theme.css · ui.js · glyph.js (song + cover dots)          │
└───────────────────────────────▲───────────────────────────┬────────────────────────┘
                     state, island events            setDevice / ring / switchTo …
                                │   preload.js  (window.nx)  │
┌───────────────────────────────┴───────────────────────────▼────────────────────────┐
│ Main process   main.js — windows, tray, IPC checks, wires everything together      │
│                                                                                    │
│  detector.js ── "which Nothing buds are connected?"   (polls the OS)               │
│  store.js    ── settings.json per device + app prefs                               │
│  nt/bridge.js ─ talks to the native helper (JSON lines over stdin/stdout)          │
│  nt/controller.js ─ "set ANC to high" → frames → replies → device state            │
│  nt/features.js · nt/frame.js ─ the Nothing protocol: commands and byte framing    │
│  media/nowplaying.js ─ what song is playing     media/cover.js ─ cover → 24×24 dots │
└───────────────────────────────┬────────────────────────────────────────────────────┘
                                │ spawn
┌───────────────────────────────▼──────────── Native helper (one per OS) ────────────┐
│  macOS: native/macos/NothingLink.swift → native/bin/nothing-link (IOBluetooth)     │
│  Linux: native/linux/nothing_link.py   (Python RFCOMM sockets + bluetoothctl)      │
│  Windows: none yet → detection and island only, no earbud controls                 │
└───────────────────────────────┬────────────────────────────────────────────────────┘
                                │ Bluetooth RFCOMM (the CMF Buds 2a uses channel 6)
                           🎧 your buds
```

**Why a native helper?** Electron can't open classic-Bluetooth RFCOMM channels by itself. Each OS gets a small helper program that speaks one simple JSON protocol, so everything above it is shared code.

## Walkthrough 1: buds connect → island pops up

1. **`detector.js`** asks the OS which Bluetooth devices are connected every few seconds. macOS uses `system_profiler`, Windows PowerShell, and Linux `bluetoothctl` via the helper.
2. **`devices.js`** decides whether a device is "Nothing" by name ("Nothing Ear", "CMF Buds", …) or by Nothing's address prefix `2C:BE:EE`. It also picks the model, which sets the features and EQ presets shown.
3. The detector emits `connected`. **`main.js`** sends the new state to both windows and tells the island to play its "connected" animation.
4. In parallel, **`controller.attach()`** asks the helper to open the RFCOMM channel, then **`sync()`** reads battery, ANC, EQ, bass, low-lag and firmware from the buds.

## Walkthrough 2: you tap "ANC: High" in the app

```
app.js  →  nx.setDevice({anc:'high'})           (preload.js)
        →  ipcMain 'device:set'                  (main.js checks every field against an allowlist)
        →  store.save()  +  controller.applyDiff()
        →  features.js encodes   cmd 0x0F, payload [1, 1, 0]
        →  frame.js wraps it     55 | 60 01 | 0F F0 | len | seq | payload | CRC16
        →  bridge.js → helper → Bluetooth → buds
        ←  buds reply (ACK) → frame.js Decoder → controller updates state → windows re-render
```

The frame format, command numbers and replies are in [test/nt.test.js](test/nt.test.js). Those tests use real bytes captured from a CMF Buds 2a, so they're the best reference for the protocol.

## Walkthrough 3: a song plays → glyph / cover dots

1. **`nowplaying.js`** checks what's playing:
   - **macOS:** AppleScript for Music, Spotify and browser tabs (Safari, Chrome, Arc, Brave, Edge). Firefox can't be scripted.
   - **Windows:** the system media session via PowerShell.
   - **Linux:** `playerctl` (MPRIS).
2. **`glyph.js`** hashes the title and artist into a seed, so the same song always gets the same animated dot pattern.
3. If the track has artwork, **`cover.js`** fetches it, but only from the service already playing it, through an allowlist of hosts. It shrinks the image to 24×24 brightness values *in the main process*, so the windows never receive the image or its URL. `glyph.js` then draws those values as dots.

## Security model (short version)

- **Renderers are untrusted:** sandboxed, no Node, and isolated. They only see the small `window.nx` API in [src/preload.js](src/preload.js).
- **Every IPC message is checked in `main.js`:** settings keys and values against allowlists, ring sides, section names, and device switching limited to paired Nothing devices.
- **No navigation, pop-ups, webviews or browser permissions:** all are blocked.
- **Electron fuses in the packaged app:** no `ELECTRON_RUN_AS_NODE`, no `--inspect`, and the asar integrity check is on. People can still edit the code on their own machine, as with any desktop app, but a page or another app can't drive yours.
- **No telemetry or accounts.** The only network use is album-art fetches.

## File guide

| File | What it does |
|---|---|
| `src/main/main.js` | App entry: windows, tray, IPC handlers, demo mode, wiring |
| `src/main/detector.js` | Finds connected Nothing devices on each OS |
| `src/main/devices.js` | Model catalog: names → features, EQ family |
| `src/main/store.js` | Saves per-device settings and app prefs to `settings.json` |
| `src/main/nt/frame.js` | Byte framing + CRC16 for the Nothing protocol |
| `src/main/nt/features.js` | Command IDs, payload encode/decode per feature |
| `src/main/nt/controller.js` | Request/reply queue, sync, set, ring with auto-stop |
| `src/main/nt/bridge.js` | Starts and restarts the native helper; JSON lines |
| `src/main/media/nowplaying.js` | Current track on macOS / Windows / Linux |
| `src/main/media/cover.js` | Allowlisted cover fetch → 24×24 levels |
| `src/preload.js` | The only API renderers can use (`window.nx`) |
| `src/renderer/island/*` | The Dynamic Island pill |
| `src/renderer/app/*` | The resizable settings app |
| `src/renderer/shared/glyph.js` | Song glyphs and cover dot portraits |
| `native/macos/NothingLink.swift` | macOS Bluetooth helper |
| `native/linux/nothing_link.py` | Linux Bluetooth helper |
| `scripts/build-native.js` | Compiles the macOS helper (universal binary) |
| `.github/workflows/release.yml` | CI builds and draft releases, see [RELEASING.md](RELEASING.md) |

## Running it

```bash
npm install      # also compiles the macOS helper
npm start        # real mode
npm run demo     # fake buds + fake songs, no Bluetooth needed
npm test         # protocol, media and cover tests
```
