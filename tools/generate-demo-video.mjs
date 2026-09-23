// Generates an original animated WebM locally. No third-party media is downloaded.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DOOH_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d'); const stream = canvas.captureStream(24);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 1600000 });
    const chunks = []; recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    const start = performance.now();
    const render = () => {
      const t = (performance.now() - start) / 1000;
      ctx.fillStyle = '#26213d'; ctx.fillRect(0, 0, 1280, 720);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ['#675296', '#c6b5ec', '#e0a775'][i];
        ctx.beginPath(); ctx.arc(1040 + Math.sin(t * 1.2 + i * 2) * 100, 350 + Math.cos(t + i * 2) * 160, [170, 120, 70][i], 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#c6b5ec'; ctx.font = '26px Arial'; ctx.fillText('DOOH LAB / MOTION', 70, 90);
      ctx.fillStyle = '#f7eff4'; ctx.font = 'bold 110px Arial'; ctx.fillText('Идеи', 65, 280); ctx.fillText('в движении.', 65, 410);
      ctx.fillStyle = '#c6b5ec'; ctx.font = '30px Arial'; ctx.fillText('Контент меняется. Показ продолжается.', 70, 495);
      ctx.fillStyle = '#c6b5ec'; ctx.fillRect(70, 560, 500, 4);
      ctx.fillStyle = '#e0a775'; ctx.fillRect(70, 560, Math.min(500, t / 6 * 500), 4);
      ctx.fillStyle = '#bcaed3'; ctx.font = '18px Arial'; ctx.fillText('Оригинальный тестовый ролик · WebM / VP8 · без звука', 70, 670);
    };
    render(); recorder.start(); const interval = setInterval(render, 1000 / 24);
    await new Promise(resolve => setTimeout(resolve, 6000)); recorder.stop(); await stopped;
    clearInterval(interval); stream.getTracks().forEach(track => track.stop());
    const blob = new Blob(chunks, { type: 'video/webm' });
    return await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
  });
  const destination = path.resolve('public/media/motion.webm');
  writeFileSync(destination, Buffer.from(base64, 'base64'));
  console.log(`Generated ${destination}`);
} finally { await browser.close(); }
