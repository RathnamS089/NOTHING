# Releasing

Builds run on GitHub Actions ([.github/workflows/release.yml](.github/workflows/release.yml)).

## Test builds (every push)

Every push to a `feature/**` or `fix/**` branch, and every PR, runs the tests and builds all three platforms. Download the installers from the run page under **Artifacts**. They're kept for 14 days and are not public.

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

## Signing (later)

Builds are unsigned, so testers see Gatekeeper/SmartScreen warnings. When you want those gone:
- **macOS:** an Apple Developer ID certificate plus notarization. Add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` as repo secrets, and remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'`.
- **Windows:** a code-signing certificate (or Azure Trusted Signing), added as `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`.
