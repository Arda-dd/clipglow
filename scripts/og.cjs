// Renders scripts/og.html to public/og.png, the image shown when a link to Clipglow is shared.
//
//   PUPPETEER_PATH=/path/to/node_modules/puppeteer node scripts/og.cjs
//
// Uses a frame of public/demo.mp4 (made by scripts/showcase.cjs). Needs ffmpeg.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');

const root = path.join(__dirname, '..');
const frame = path.join(__dirname, 'og-frame.png');

(async () => {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '7.6', '-i', path.join(root, 'public', 'demo.mp4'), '-frames:v', '1', frame]);
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630 });
  await page.goto('file://' + path.join(__dirname, 'og.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.screenshot({ path: path.join(root, 'public', 'og.png') });
  await browser.close();
  fs.unlinkSync(frame);
  console.log('public/og.png');
})();
