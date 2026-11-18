// Records the sample video for "Try it with a sample recording": a scripted session in a made-up app, plus the
// cursor path and clicks, like a recording with cursor data.
//
//   PUPPETEER_PATH=/path/to/node_modules/puppeteer node scripts/make-sample.cjs
//
// Needs ffmpeg on the PATH. Frames come straight from Chrome's screencast with their timestamps and are encoded
// afterwards, so the video and the cursor log share one clock and no frame is lost.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer');

const out = path.join(__dirname, '..', 'public', 'sample');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The page is laid out at 1280 x 800 and zoomed to 1920 x 1200, so text stays sharp when Clipglow zooms in.
const W = 1920;
const H = 1200;
const FPS = 30;
const clock = () => Date.now() / 1000;
const log = { moves: [], clicks: [] };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--hide-scrollbars'] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'sample', 'taskly.html').replace(/\\/g, '/'));
  await page.addStyleTag({ content: 'html { zoom: 1.5 }' });
  await wait(300);

  let pos = { x: W * 0.55, y: H * 0.6 };
  await page.mouse.move(pos.x, pos.y);

  /** Moves like a person: eases in and out along a slight curve. */
  const move = async (x, y, ms = 700) => {
    const from = pos;
    const dx = x - from.x;
    const dy = y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = 0.12 * len;
    const cx = from.x + dx / 2 - (dy / len) * bend;
    const cy = from.y + dy / 2 + (dx / len) * bend;
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const px = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * x;
      const py = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * y;
      await page.mouse.move(px, py);
      log.moves.push([clock(), px / W, py / H]);
      await wait(16);
    }
    pos = { x, y };
  };
  const click = async (selector, ms) => {
    const box = await (await page.$(selector)).boundingBox();
    const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await move(c.x, c.y, ms);
    await wait(120);
    log.clicks.push([clock(), c.x / W, c.y / H]);
    await page.mouse.down();
    await wait(70);
    await page.mouse.up();
  };

  // ---- Record ----
  const cdp = await page.createCDPSession();
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ data: f.data, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await wait(1500);

  // 1. New task
  await click('#new', 1100);
  await wait(700);
  await click('#title', 800);
  await wait(250);
  await page.keyboard.type('Record the launch video', { delay: 65 });
  await wait(500);
  await click('#p-high', 650);
  await wait(600);
  await click('#create', 700);
  await wait(2200);

  // 2. Tick a task off
  await click('.task:nth-child(3) .check', 900);
  await wait(1300);

  // 3. Another page
  await click('#nav-upcoming', 1300);
  await wait(1600);
  await move(W * 0.55, H * 0.55, 1000);
  await wait(1200);
  const end = clock();
  await cdp.send('Page.stopScreencast');
  await browser.close();

  // ---- Encode: output frame k shows whatever was on screen at k / FPS ----
  const start = frames[0].t;
  const images = frames.map((f) => Buffer.from(f.data, 'base64'));
  const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-vf', 'format=yuv420p',
    '-c:v', 'libvpx-vp9', '-crf', '38', '-b:v', '0', '-g', '60', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', path.join(out, 'demo.webm')], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed')))));
  let i = 0;
  for (let k = 0; start + k / FPS <= end; k++) {
    while (i + 1 < frames.length && frames[i + 1].t <= start + k / FPS) i++;
    if (!ffmpeg.stdin.write(images[i])) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  }
  ffmpeg.stdin.end();
  await done;

  const round = (n) => Math.round(n * 10000) / 10000;
  const cursor = [{ t: 0, x: 0.55, y: 0.6 }];
  for (const [t, x, y] of log.moves) {
    const s = t - start;
    if (s <= 0 || s - cursor[cursor.length - 1].t < 1 / 60) continue;
    cursor.push({ t: round(s), x: round(x), y: round(y) });
  }
  const clicks = log.clicks.map(([t, x, y]) => ({ t: round(t - start), x: round(x), y: round(y) }));
  fs.writeFileSync(path.join(out, 'demo.json'), JSON.stringify({ title: 'app.taskly.example', cursor, clicks }));
  console.log(`${frames.length} frames over ${(end - start).toFixed(1)}s, ${cursor.length} cursor samples, ${clicks.length} clicks`);
})();
