// Makes the images and videos for the README and the start page, with Clipglow itself.
//
//   npm run dev   (in another terminal)
//   PUPPETEER_PATH=/path/to/node_modules/puppeteer node scripts/showcase.cjs http://localhost:5173/
//
// Writes docs/home.png, docs/editor.png, docs/export.png, docs/demo.gif and public/demo.mp4. Needs ffmpeg.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');

const root = path.join(__dirname, '..');
const docs = path.join(root, 'docs');
const base = process.argv[2] || 'http://localhost:5173/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(docs, { recursive: true });
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(base, { waitUntil: 'networkidle0' });

  // 1. The demo video: the sample, exported by Clipglow.
  const video = await page.evaluate(async () => {
    const media = await import('/src/core/media.ts');
    const project = await import('/src/core/project.ts');
    const az = await import('/src/core/autozoom.ts');
    const meta = await fetch('sample/demo.json').then((r) => r.json());
    const screen = await media.remux(await fetch('sample/demo.webm').then((r) => r.blob()));
    const info = await media.probe(screen);
    const p = project.createProject({ name: 'demo', ...info, cursor: meta.cursor, clicks: meta.clicks });
    p.zooms = az.zoomsFromClicks(p.clicks, p.duration);
    p.style = { ...p.style, frame: 'browser', frameTitle: meta.title, padding: 0.07 };
    const blob = await media.exportVideo(p, { screen, assets: {} }, { format: 'mp4', size: 1080, fps: 60 }, () => {}, new AbortController().signal);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const full = path.join(docs, 'demo-full.mp4');
  fs.writeFileSync(full, Buffer.from(video, 'base64'));
  // A light copy for the start page, and a GIF for the README.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', full, '-vf', 'scale=1280:-2,fps=30', '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(root, 'public', 'demo.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.5', '-t', '14', '-i', full, '-vf', 'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', path.join(docs, 'demo.gif')]);

  // 2. Screenshots.
  await page.screenshot({ path: path.join(docs, 'home.png') });
  const [sample] = await page.$$('xpath/.//button[contains(., "Try it with a sample")]');
  await sample.click();
  await page.waitForSelector('.zoom-block', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('.filmstrip img').length > 10, { timeout: 60000 });
  // Pick the zoom on the typing and look at it.
  const zoom = await (await page.$$('.zoom-block'))[1].boundingBox();
  await page.mouse.click(zoom.x + zoom.width / 2, zoom.y + zoom.height / 2);
  const track = await (await page.$('.video-track')).boundingBox();
  await page.mouse.click(track.x + (7.3 / 24.3) * track.width, track.y + track.height / 2);
  await wait(1500);
  await page.screenshot({ path: path.join(docs, 'editor.png') });

  await page.click('.editor-bar .btn.primary');
  await wait(400);
  const [go] = await page.$$('xpath/.//div[@class="modal"]//button[contains(., "Export MP4")]');
  await go.click();
  await page.waitForSelector('.export-done', { timeout: 300000 });
  await wait(800);
  await page.screenshot({ path: path.join(docs, 'export.png') });

  await browser.close();
  fs.unlinkSync(full);
  for (const f of ['home.png', 'editor.png', 'export.png', 'demo.gif']) console.log(f, Math.round(fs.statSync(path.join(docs, f)).size / 1024) + ' KB');
  console.log('demo.mp4', Math.round(fs.statSync(path.join(root, 'public', 'demo.mp4')).size / 1024) + ' KB');
})();
