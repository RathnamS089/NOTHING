// Builds the platform Bluetooth bridge. macOS: compiles the Swift helper.
// Windows uses a PowerShell bridge script and needs no build step.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') process.exit(0);

const root = path.join(__dirname, '..');
const out = path.join(root, 'native', 'bin');
fs.mkdirSync(out, { recursive: true });
try {
  execFileSync('swiftc', [
    '-O', '-framework', 'IOBluetooth', '-framework', 'Foundation',
    path.join(root, 'native', 'macos', 'NothingLink.swift'),
    '-o', path.join(out, 'nothing-link'),
    // Embedded Info.plist carries the Bluetooth usage string macOS privacy checks require.
    '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist',
    '-Xlinker', path.join(root, 'native', 'macos', 'Info.plist'),
  ], { stdio: 'inherit' });
  console.log('built native/bin/nothing-link');
} catch {
  console.warn('swiftc failed: earbud controls will be unavailable (install Xcode command line tools)');
}
