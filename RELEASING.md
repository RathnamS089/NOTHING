# Releasing

Builds run on GitHub Actions ([.github/workflows/release.yml](.github/workflows/release.yml)).

## Test builds (every PR)

Every pull request runs the tests and builds all three platforms, and so does **Actions → Build & release → Run workflow**. Pushing a branch without a PR doesn't build, which saves Actions minutes (macOS minutes count 10× on private repos). Download the installers from the run page under **Artifacts**. They're kept for 14 days and are not public.

## A tester release

1. Pick a version. While it's early, use pre-release tags such as `v0.1.0-alpha.1`, `v0.1.0-alpha.2`, …
2. Tag the commit you want and push the tag:
   ```bash
   git tag v0.1.0-alpha.1
   git push origin v0.1.0-alpha.1
   ```
3. Wait for the **Build & release** run to finish (about 10 minutes).
4. Open **Releases** on GitHub. A **draft pre-release** is waiting with the installers and `SHA256SUMS.txt`. Edit the notes if needed, then press **Publish**.

Nothing becomes visible to anyone until you publish it. To scrap a release, delete the draft and the tag:
```bash
git push --delete origin v0.1.0-alpha.1
```

The version shown in the app comes from the tag. `package.json` doesn't need editing.

## The repo is private

Only people with access to the repo can download releases from a private repo. To share with testers, either add them as collaborators (read access is enough) or make the repo public when you're ready.

## macOS signing

### Now: ad-hoc signing

`package.json` → `build.mac` has `"identity": "-"` and `"hardenedRuntime": false`. electron-builder then signs every piece of the app in the right order (Electron framework, the four helper apps, the `nothing-link` Bluetooth helper, then the app itself). CI runs `codesign --verify --deep --strict` on both Mac builds and fails if anything is wrong.

**Don't turn signing off.** The `electronFuses` setting patches bytes inside `Electron Framework`. That invalidates Electron's original signature, so the framework has to be re-signed afterwards. An unsigned build (for example with `CSC_IDENTITY_AUTO_DISCOVERY=false`) has a broken framework signature. On Apple Silicon the kernel then kills the app at launch (`zsh: killed`) and Finder says it's "damaged". No `xattr` or `codesign --deep` run afterwards fixes that properly.

Ad-hoc apps still aren't trusted by Gatekeeper: testers use **Privacy & Security → Open Anyway** once. Each build also has a new identity, so macOS may ask for Bluetooth permission again after an update.

### Later: Developer ID + notarization (no warnings for anyone)

1. Join the Apple Developer Program ($99/year). Create a **Developer ID Application** certificate and export it as a `.p12` file.
2. Add repo secrets:
   - `CSC_LINK` (the base64 `.p12`)
   - `CSC_KEY_PASSWORD`
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD` (from appleid.apple.com)
   - `APPLE_TEAM_ID`

   Pass them to the Package step as `env`.
3. In `build.mac`:
   - remove `"identity": "-"`
   - set `"hardenedRuntime": true` and `"notarize": true`
   - add `"entitlements"` and `"entitlementsInherit"` pointing at a plist with:
     - `com.apple.security.cs.allow-jit` (V8 needs it)
     - `com.apple.security.device.bluetooth` (the helper talks to the buds under the hardened runtime)
4. Notarization adds roughly 2–10 minutes per build. The `.dmg` then opens with no warnings, and Bluetooth permission survives updates because the identity stays the same.

## Windows signing (later)

A code-signing certificate (or Azure Trusted Signing), added as `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`. Until then, SmartScreen shows a warning.
