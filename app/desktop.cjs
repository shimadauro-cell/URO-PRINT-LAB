const { app, BrowserWindow, dialog, session } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { writeFile } = require('node:fs/promises');
app.setName('URO PRINT LAB');
app.setAppUserModelId('jp.uro.printlab');
let backend, win, exiting = false;
const smoke = process.argv.includes('--smoke-test');
if (smoke) {
  const testProfile = join(app.getPath('temp'), `uro-printlab-smoke-${process.pid}`);
  require('node:fs').mkdirSync(testProfile, { recursive: true });
  app.setPath('userData', testProfile);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    try {
      process.env.UPSCALER_PORT = '0';
      process.env.UPSCALER_ENGINE = join(__dirname, 'vendor/realesrgan');
      process.env.UPSCALER_MARI = join(__dirname, 'assets/mari.png');
      process.env.UPSCALER_WORK = join(app.getPath('userData'), 'work');
      backend = await import(pathToFileURL(join(__dirname, 'server.mjs')).href);
      const url = await backend.ready;
      if (smoke) {
        process.env.UPSCALER_TEST_URL = url;
        await import(pathToFileURL(join(__dirname, 'verify.mjs')).href);
        for (const route of ['/', '/app.js', '/style.css', '/mari.png']) {
          const response = await fetch(url + route);
          if (!response.ok || !(await response.arrayBuffer()).byteLength) throw new Error(`Missing asset: ${route}`);
        }
        await writeFile(process.env.UPSCALER_SMOKE_REPORT, JSON.stringify({ ok: true, electron: process.versions.electron, node: process.versions.node, arch: process.arch, application: 'resources/app', tests: '7 image conversions, alpha, density, ICC, input validation, same-origin security, 4 UI assets' }, null, 2));
        await backend.shutdown(); exiting = true; app.quit(); return;
      }
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.defaultSession.on('will-download', (_event, item) => {
        item.setSaveDialogOptions({ title: '拡大画像を保存', filters: [{ name: 'PNG画像', extensions: ['png'] }] });
      });
      win = new BrowserWindow({ title: 'URO PRINT LAB', width: 1280, height: 940, minWidth: 760, minHeight: 600, backgroundColor: '#15191b', autoHideMenuBar: true, icon: join(__dirname, 'assets/icon.png'), webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
      win.on('close', event => {
        if (!exiting && backend.isProcessing() && dialog.showMessageBoxSync(win, { type: 'question', title: 'URO PRINT LAB', message: '画像を処理中です。中止して終了しますか？', buttons: ['処理を続ける', '中止して終了'], defaultId: 0, cancelId: 0 }) !== 1) event.preventDefault();
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, destination) => { if (new URL(destination).origin !== url) event.preventDefault(); });
      await win.loadURL(url);
    } catch (error) {
      if (smoke) await writeFile(process.env.UPSCALER_SMOKE_REPORT, JSON.stringify({ ok: false, error: error.stack }, null, 2));
      else dialog.showErrorBox('URO PRINT LABを起動できません', error.message);
      if (backend) await backend.shutdown().catch(() => {});
      exiting = true; app.exit(1);
    }
  });
  app.on('before-quit', event => {
    if (exiting) return;
    event.preventDefault();
    exiting = true;
    Promise.resolve(backend?.shutdown()).finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
