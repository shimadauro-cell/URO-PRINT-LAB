import assert from 'node:assert/strict';
import sharp from 'sharp';
const base = process.env.UPSCALER_TEST_URL || 'http://127.0.0.1:4318';
const { token } = await (await fetch(`${base}/api/config`)).json();
const input = await sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 120, g: 40, b: 200, alpha: 0.5 } } }).png().toBuffer();
async function processImage(mode, scale, dpi) {
  const response = await fetch(`${base}/api/jobs?mode=${mode}&scale=${scale}&dpi=${dpi}&sharpen=true`, { method: 'POST', headers: { 'X-Local-Token': token }, body: input });
  assert.equal(response.status, 202);
  const { id } = await response.json();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const state = await (await fetch(`${base}/api/jobs/${id}`)).json();
    assert.notEqual(state.status, 'error', state.error);
    if (state.status === 'done') {
      const bytes = Buffer.from(await (await fetch(`${base}/api/jobs/${id}/image`)).arrayBuffer());
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.width, 32 * scale); assert.equal(metadata.height, 24 * scale);
      assert.equal(metadata.density, dpi); assert.equal(metadata.hasAlpha, true); assert.ok(metadata.icc);
      const alpha = await sharp(bytes).extractChannel('alpha').raw().toBuffer();
      assert.ok(alpha.every(value => value >= 126 && value <= 129));
      console.log(`PASS ${mode} x${scale}: ${metadata.width}x${metadata.height}, ${dpi}ppi, ICC, alpha`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Timed out');
}
for (const scale of [2, 3, 4]) await processImage('lanczos', scale, scale === 3 ? 600 : 350);
for (const scale of [2, 3, 4]) await processImage('general', scale, 350);
await processImage('illustration', 2, 300);
assert.equal((await fetch(`${base}/api/jobs?mode=lanczos&scale=9&dpi=350`, { method: 'POST', headers: { 'X-Local-Token': token }, body: input })).status, 400);
assert.equal((await fetch(`${base}/api/jobs?mode=lanczos&scale=2&dpi=350`, { method: 'POST', body: input })).status, 403);
assert.equal((await fetch(`${base}/api/config`, { headers: { Origin: 'https://example.org' } })).status, 403);
const bad = await (await fetch(`${base}/api/jobs?mode=lanczos&scale=2&dpi=350`, { method: 'POST', headers: { 'X-Local-Token': token }, body: 'not an image' })).json();
await new Promise(resolve => setTimeout(resolve, 300));
assert.equal((await (await fetch(`${base}/api/jobs/${bad.id}`)).json()).status, 'error');
console.log('PASS invalid options, missing token, foreign origin, corrupt image');
