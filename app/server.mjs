import http from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const root = dirname(fileURLToPath(import.meta.url));
const engine = process.env.UPSCALER_ENGINE || join(root, '../vendor/realesrgan');
const workRoot = process.env.UPSCALER_WORK || join(root, '.work');
const mariPath = process.env.UPSCALER_MARI || join(root, '../src/assets/kurose-mari.png');
const jobs = new Map();
let port = Number(process.env.UPSCALER_PORT ?? 4318);
let origin = `http://127.0.0.1:${port}`;
const token = randomUUID();
let active = false;
let activeTask;
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };

export function validateOptions(url) {
  const scale = Number(url.searchParams.get('scale'));
  const dpi = Number(url.searchParams.get('dpi'));
  const mode = url.searchParams.get('mode');
  const sharpen = url.searchParams.get('sharpen') === 'true';
  if (![2, 3, 4].includes(scale) || ![300, 350, 600].includes(dpi) || !['general', 'illustration', 'lanczos'].includes(mode)) throw new Error('設定値が不正です。');
  return { scale, dpi, mode, sharpen };
}

async function run(job, input, options) {
  let work;
  try {
    await mkdir(workRoot, { recursive: true });
    work = await mkdtemp(join(workRoot, 'job-'));
    const metadata = await sharp(input, { limitInputPixels: 4_000_000 }).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error('静止画のPNG・JPEG・WebPを選んでください。');
    const normalized = await sharp(input).rotate().toColourspace('srgb').png().toBuffer();
    const { width, height, hasAlpha } = await sharp(normalized).metadata();
    const target = { width: width * options.scale, height: height * options.scale };
    job.stage = '元画像を整えています';
    let source = normalized;
    if (options.mode !== 'lanczos') {
      if (process.platform === 'win32') {
        try { await access(join(engine, 'vcomp140.dll')).catch(() => access(join(process.env.WINDIR || 'C:\\Windows', 'System32', 'vcomp140.dll'))); }
        catch { throw new Error('AI処理にはMicrosoft Visual C++ v14再頒布可能パッケージ（x64）が必要です。「はじめに.txt」のMicrosoft公式案内から導入してください。通常補間も選べます。'); }
      }
      const inputPath = join(work, 'input.png');
      const outputPath = join(work, 'ai.png');
      await writeFile(inputPath, await sharp(normalized).removeAlpha().png().toBuffer());
      job.stage = 'AIが細部を再構成しています';
      await new Promise((resolve, reject) => {
        const child = spawn(join(engine, 'realesrgan-ncnn-vulkan.exe'), ['-i', inputPath, '-o', outputPath, '-n', options.mode === 'illustration' ? 'realesrgan-x4plus-anime' : 'realesrgan-x4plus', '-s', '4', '-t', '128', '-m', join(engine, 'models')], { windowsHide: true });
        job.child = child;
        const timer = setTimeout(() => { child.kill(); reject(new Error('処理が20分を超えました。画像を小さくするか通常補間を選んでください。')); }, 20 * 60_000);
        child.stderr.on('data', data => { const values = data.toString().match(/(\d+(?:\.\d+)?)%/g); if (values) job.progress = Math.min(95, parseFloat(values.at(-1))); });
        child.on('error', () => { clearTimeout(timer); reject(new Error('AIエンジンを起動できません。vendorフォルダーを確認してください。')); });
        child.on('close', code => { clearTimeout(timer); job.child = null; code === 0 ? resolve() : reject(new Error(job.canceled ? '処理を中止しました。' : 'AI処理に失敗しました。Vulkan対応GPUを確認するか「通常補間」を選んでください。')); });
      });
      source = await readFile(outputPath);
    }
    if (job.canceled) throw new Error('処理を中止しました。');
    job.stage = '倍率・解像度情報を仕上げています';
    let result = sharp(source).resize(target.width, target.height, { kernel: 'lanczos3', fit: 'fill' });
    if (options.sharpen) result = result.sharpen({ sigma: 0.5 });
    let pixels = await result.removeAlpha().png().toBuffer();
    if (hasAlpha) {
      const alpha = await sharp(normalized).extractChannel('alpha').resize(target.width, target.height, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer();
      pixels = await sharp(pixels).joinChannel(alpha, { raw: { ...target, channels: 1 } }).png().toBuffer();
    }
    const output = await sharp(pixels).withMetadata({ density: options.dpi }).withIccProfile('srgb').png().toBuffer();
    if (job.canceled) throw new Error('処理を中止しました。');
    job.output = output;
    Object.assign(job, { status: 'done', progress: 100, stage: '書き出しの準備ができました', width: target.width, height: target.height });
  } catch (error) { job.status = 'error'; job.error = error.message; }
  finally { if (work) await rm(work, { recursive: true, force: true }).catch(console.error); active = false; }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) return json(res, 403, { error: '接続元が不正です。' });
  try {
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { token });
    if (req.method === 'POST') {
      if (req.headers['x-local-token'] !== token) return json(res, 403, { error: '画面を再読み込みしてください。' });
      if (url.pathname === '/api/jobs') {
        if (active) return json(res, 409, { error: '別の画像を処理中です。' });
        const options = validateOptions(url);
        active = true;
        const chunks = []; let size = 0;
        try { for await (const chunk of req) { size += chunk.length; if (size > 20_000_000) throw new Error('ファイルは20MB以下にしてください。'); chunks.push(chunk); } }
        catch (error) { active = false; throw error; }
        // Retain only the latest result; the UI invalidates earlier download links.
        jobs.clear();
        const job = { id: randomUUID(), status: 'running', progress: 0, stage: '画像を確認しています' };
        jobs.set(job.id, job);
        activeTask = run(job, Buffer.concat(chunks), options);
        return json(res, 202, { id: job.id });
      }
      const job = jobs.get(url.pathname.split('/')[3]);
      if (job && url.pathname.endsWith('/cancel')) { job.canceled = true; job.child?.kill(); return json(res, 200, { ok: true }); }
    }
    const match = url.pathname.match(/^\/api\/jobs\/([\w-]+)(\/image)?$/);
    if (req.method === 'GET' && match) {
      const job = jobs.get(match[1]);
      if (!job) return json(res, 404, { error: '処理結果がありません。再実行してください。' });
      if (match[2]) {
        if (!job.output) return json(res, 409, { error: 'まだ処理中です。' });
        res.writeHead(200, { 'Content-Type': 'image/png', ...(url.searchParams.has('download') ? { 'Content-Disposition': 'attachment' } : {}) });
        return res.end(job.output);
      }
      const { child, output, ...state } = job;
      return json(res, 200, state);
    }
    if (req.method === 'GET' && url.pathname === '/mari.png') { const data = await readFile(mariPath); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(data); }
    const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (req.method === 'GET' && files[url.pathname]) { const [path, type] = files[url.pathname]; const data = await readFile(join(root, path)); res.writeHead(200, { 'Content-Type': type }); return res.end(data); }
    json(res, 404, { error: '見つかりません。' });
  } catch (error) { json(res, 400, { error: error.message }); }
});
export const ready = new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => { port = server.address().port; origin = `http://127.0.0.1:${port}`; console.log(`URO PRINT LAB: ${origin}`); resolve(origin); });
});
export function isProcessing() { return active; }
export async function shutdown() {
  for (const job of jobs.values()) { job.canceled = true; job.child?.kill(); }
  const closed = new Promise(resolve => server.close(resolve));
  server.closeIdleConnections();
  await activeTask;
  await closed;
  jobs.clear();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
