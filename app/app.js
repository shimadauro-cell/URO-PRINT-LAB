const $ = id => document.getElementById(id);
let file, originalUrl, dimensions, result, scale = 2, busy = false, jobId, token;
const api = async (url, options) => { const r = await fetch(url, options); const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; };
api('/api/config').then(data => { token = data.token; update(); }).catch(() => { $('status').textContent = 'ローカルサーバーに接続できません。起動用ファイルを実行してください。'; });
function invalidate() { result = null; $('after').disabled = true; $('download').removeAttribute('href'); $('download').classList.add('disabled'); $('download').setAttribute('aria-disabled', 'true'); if (originalUrl) { show(false); $('status').textContent = '現在の設定でアップスケールを実行してください。'; } }
function update() {
  $('run').disabled = !file || !token || busy;
  $('run').firstChild.textContent = `×${scale}でアップスケール `;
  const dpi = Number($('dpi').value);
  $('physicalLabel').textContent = `${dpi} ppiでの画像サイズ`;
  if (!dimensions) return;
  const w = dimensions.width * scale, h = dimensions.height * scale;
  $('pixels').textContent = `${w.toLocaleString()} × ${h.toLocaleString()} px`;
  $('physical').textContent = `${(w / dpi * 25.4).toFixed(1)} × ${(h / dpi * 25.4).toFixed(1)} mm`;
  $('estimate').textContent = result ? '完成' : '予定';
  let [pw, ph] = $('paper').value.split(',').map(Number);
  if ($('landscape').checked) [pw, ph] = [ph, pw];
  if ($('bleed').checked) { pw += 6; ph += 6; }
  const effective = Math.min(w / pw, h / ph) * 25.4;
  $('assessment').textContent = `${effective >= dpi ? '✓ 画素数は目標を満たしています' : '△ 画素数が目標に届きません'}\n全面配置時 約${Math.floor(effective)} ppi / 目標${dpi} ppi。必要サイズ ${Math.ceil(pw / 25.4 * dpi)} × ${Math.ceil(ph / 25.4 * dpi)} px。`;
  for (let n = 1; n <= 4; n++) $('step' + n).classList.toggle('current', n === (result ? 4 : 2));
}
async function loadFile(selected) {
  if (!selected || busy) return;
  try {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type)) throw new Error('PNG・JPEG・WebPの画像を選んでください。');
    if (selected.size > 20_000_000) throw new Error('画像は20MB以下にしてください。');
    const bitmap = await createImageBitmap(selected);
    const next = { width: bitmap.width, height: bitmap.height }; bitmap.close();
    if (next.width * next.height > 4_000_000) throw new Error('元画像は400万画素以下にしてください（例：2048 × 1792）。');
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    file = selected; dimensions = next; originalUrl = URL.createObjectURL(file);
    invalidate(); $('drop').hidden = true; $('previewArea').hidden = false;
    $('fileInfo').textContent = `${file.name} · ${next.width} × ${next.height} px`;
    $('guide').textContent = '画像をお預かりしました。倍率と処理モードを選びましょう。文字の多い画像には「通常補間」が向いています。';
    $('status').textContent = '準備ができました。倍率を選んで処理を開始してください。';
    update();
  } catch (e) { $('status').textContent = e.message; } finally { $('file').value = ''; }
}
function show(after) { $('preview').src = after ? result.url : originalUrl; $('previewLabel').textContent = after ? `UPSCALED ×${scale}` : 'ORIGINAL'; $('after').classList.toggle('selected', after); $('before').classList.toggle('selected', !after); }
$('file').onchange = e => loadFile(e.target.files[0]);
$('replace').onclick = () => $('file').click();
for (const event of ['dragenter', 'dragover']) $('drop').addEventListener(event, e => { e.preventDefault(); $('drop').classList.add('drag'); });
for (const event of ['dragleave', 'drop']) $('drop').addEventListener(event, e => { e.preventDefault(); $('drop').classList.remove('drag'); if (event === 'drop') loadFile(e.dataTransfer.files[0]); });
window.addEventListener('dragover', e => e.preventDefault()); window.addEventListener('drop', e => e.preventDefault());
document.querySelectorAll('[data-scale]').forEach(button => button.onclick = () => { scale = Number(button.dataset.scale); document.querySelectorAll('[data-scale]').forEach(b => b.classList.toggle('selected', b === button)); invalidate(); update(); });
for (const id of ['mode', 'dpi', 'sharpen']) $(id).onchange = () => { invalidate(); update(); };
for (const id of ['paper', 'landscape', 'bleed']) $(id).onchange = update;
$('before').onclick = () => show(false); $('after').onclick = () => show(true);
$('actual').onchange = () => $('viewport').classList.toggle('actual', $('actual').checked);
$('cancel').onclick = async () => { if (!jobId) return; $('cancel').disabled = true; try { await api(`/api/jobs/${jobId}/cancel`, { method: 'POST', headers: { 'X-Local-Token': token } }); $('status').textContent = '中止しています…'; } catch(e) { $('status').textContent = e.message; $('cancel').disabled = false; } };
$('run').onclick = async () => {
  busy = true; invalidate(); update(); $('settings').disabled = true; $('replace').disabled = true; $('progress').hidden = false; $('progress').removeAttribute('value'); $('status').textContent = '画像を準備しています…';
  try {
    const params = new URLSearchParams({ scale, dpi: $('dpi').value, mode: $('mode').value, sharpen: $('sharpen').checked });
    const started = await api(`/api/jobs?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Local-Token': token }, body: file });
    jobId = started.id; $('cancel').hidden = false; $('cancel').disabled = false;
    while (true) {
      const state = await api(`/api/jobs/${jobId}`);
      $('status').textContent = state.stage;
      if (state.progress > 0) $('progress').value = state.progress;
      if (state.status === 'error') throw new Error(state.error);
      if (state.status === 'done') {
        result = { url: `/api/jobs/${jobId}/image` };
        $('after').disabled = false; show(true);
        $('download').href = result.url + '?download=1'; $('download').download = file.name.replace(/\.[^.]+$/, '') + `_x${scale}_${$('dpi').value}ppi.png`;
        $('download').classList.remove('disabled'); $('download').setAttribute('aria-disabled', 'false');
        $('guide').textContent = '拡大が完了しました。100%表示で細部をご確認ください。印刷サイズを確かめたら、PNGで保存できます。';
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 900));
    }
  } catch (e) { $('status').textContent = e.message; $('guide').textContent = '処理を完了できませんでした。表示された内容を確認し、設定を変えて再実行してください。'; }
  finally { busy = false; jobId = null; $('settings').disabled = false; $('replace').disabled = false; $('cancel').hidden = true; $('progress').hidden = true; update(); }
};
