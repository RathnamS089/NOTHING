// Builds the platform Bluetooth bridge. macOS: compiles the Swift helper as a
// universal binary (Apple Silicon + Intel). Linux uses a Python script and
// Windows has no bridge yet, so neither needs a build step.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') process.exit(0);

const root = path.join(__dirname, '..');
const out = path.join(root, 'native', 'bin');
const bin = path.join(out, 'nothing-link');
const ARCHS = ['arm64', 'x86_64'];
fs.mkdirSync(out, { recursive: true });

const compile = (arch) => {
  const dest = `${bin}-${arch}`;
  execFileSync('swiftc', [
    '-O', '-target', `${arch}-apple-macos12`,
    '-framework', 'IOBluetooth', '-framework', 'Foundation',
    path.join(root, 'native', 'macos', 'NothingLink.swift'),
    '-o', dest,
    // Embedded Info.plist carries the Bluetooth usage string macOS privacy checks require.
    '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist',
    '-Xlinker', path.join(root, 'native', 'macos', 'Info.plist'),
  ], { stdio: 'inherit' });
  return dest;
};

try {
  const parts = ARCHS.map(compile);
  execFileSync('lipo', ['-create', ...parts, '-output', bin], { stdio: 'inherit' });
  parts.forEach((p) => fs.rmSync(p));
  // macOS ties Bluetooth permission to the code-signing identifier. Without
  // this, each slice keeps its temp name ("nothing-link-arm64") and macOS
  // treats the helper as a new, unpermitted app. Same id as packaged builds.
  execFileSync('codesign', ['--force', '--sign', '-', '--identifier', 'app.nothingisland.link', bin], { stdio: 'inherit' });
  console.log(`built native/bin/nothing-link (${ARCHS.join(' + ')})`);
} catch {
  // In CI a missing helper would ship an app without earbud controls, so fail loudly.
  if (process.env.CI) {
    console.error('swiftc failed: refusing to package without the Bluetooth helper');
    process.exit(1);
  }
  console.warn('swiftc failed: earbud controls will be unavailable (install Xcode command line tools)');
}
