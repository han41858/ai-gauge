import { execFileSync } from 'node:child_process';

// Regenerate local app assets only when the supplied logo changes. Ordinary
// extension builds copy these prepared PNGs and do not require ImageMagick.
for (const size of [16, 32, 48, 128]) {
  execFileSync('magick', ['assets/logo.png', '-filter', 'Lanczos', '-resize', `${size}x${size}`,
    '-strip', `PNG32:assets/icon${size}.png`], { stdio: 'inherit' });
}
console.log('Prepared transparent 16/32/48/128px app icons from assets/logo.png');
