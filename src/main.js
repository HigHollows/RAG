'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, Tray, nativeImage } = require('electron');

const argv = process.argv.slice(1);
const dataDir = process.env.GRAPHRAG_DATA || path.join(app.getPath('appData'), 'GraphRAG Studio');

// ── Mode sans fenêtre : CLI (le serveur MCP passe par mcp-main.js avec ELECTRON_RUN_AS_NODE=1)
if (argv.includes('--cli')) {
  app.whenReady().then(async () => {
    try { await require('./cli').main(argv.slice(argv.indexOf('--cli') + 1)); } catch (e) { console.error('Erreur : ' + e.message); process.exitCode = 1; }
    app.exit(process.exitCode || 0);
  });
} else {
  startGui();
}

function startGui() {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const { Core } = require('./core/core');
  const { METHODS } = require('./methods');
  const { startHttp } = require('./http');

  let win = null;
  let core = null;
  let httpServer = null;
  let tray = null, quitting = false, watchers = [], timer = null, debounce = null;
  const hidden = argv.includes('--hidden');

  const secrets = {
    secure: true,
    encrypt: (s) => (safeStorage.isEncryptionAvailable() ? 'dpapi:' + safeStorage.encryptString(s).toString('base64') : 'b64:' + Buffer.from(s).toString('base64')),
    decrypt: (s) => (s.startsWith('dpapi:') ? safeStorage.decryptString(Buffer.from(s.slice(6), 'base64')) : Buffer.from(s.replace(/^b64:/, ''), 'base64').toString('utf8')),
  };

  const emit = (type, payload) => { if (win && !win.isDestroyed()) win.webContents.send('event', type, payload); };

  function syncHttp() {
    const s = core.config.data.server;
    if (httpServer) { httpServer.close(); httpServer = null; }
    if (s.http) {
      try { httpServer = startHttp(core, s.port); } catch (e) { emit('toast', { kind: 'error', text: 'API HTTP : ' + e.message }); }
    }
  }

  // Ingestion automatique : surveillance des fichiers, planification, démarrage avec Windows, zone de notification
  async function autoRun() {
    if (core.ingestor && core.ingestor._running) return;
    try {
      const r = await core.ingest({});
      if (r.added + r.modified + r.deleted > 0 || r.errors.length) emit('toast', { kind: r.errors.length ? '' : 'ok', text: `Ingestion automatique : +${r.added} ~${r.modified} −${r.deleted}` });
    } catch (e) { emit('toast', { kind: 'error', text: 'Ingestion automatique : ' + e.message }); }
  }
  function syncAuto() {
    watchers.forEach((w) => w.close()); watchers = []; clearInterval(timer);
    const a = core.config.data.auto;
    if (a.watch) {
      for (const v of core.config.data.vaults) {
        try {
          watchers.push(fs.watch(v.path, { recursive: true }, (_ev, f) => {
            if (!f || /(^|[\/])(.obsidian|_graph|.trash|.git)([\/]|$)/.test(f)) return;
            clearTimeout(debounce); debounce = setTimeout(autoRun, 20000);
          }));
        } catch { /* dossier indisponible */ }
      }
    }
    if (a.everyMinutes > 0) timer = setInterval(autoRun, a.everyMinutes * 60000);
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!a.startWithWindows, args: a.startWithWindows ? ['--hidden'] : [] });
    if (a.tray && !tray) {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 }));
      tray.setToolTip('GraphRAG Studio');
      tray.on('click', () => { win.show(); win.focus(); });
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Ouvrir', click: () => { win.show(); win.focus(); } },
        { label: 'Ingérer maintenant', click: autoRun },
        { type: 'separator' }, { label: 'Quitter', click: () => { quitting = true; app.quit(); } } ]));
    } else if (!a.tray && tray) { tray.destroy(); tray = null; }
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1320, height: 860, minWidth: 980, minHeight: 640, show: false,
      title: 'GraphRAG Studio', backgroundColor: '#14161a',
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    win.once('ready-to-show', () => { if (!(hidden && core.config.data.auto.tray)) win.show(); });
    win.on('close', (e) => { if (!quitting && core.config.data.auto.tray) { e.preventDefault(); win.hide(); } });
    win.loadFile(path.join(__dirname, 'ui', 'index.html'));
    win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openExternal(url); } });
  }

  function openExternal(url) {
    if (/^(obsidian|https?):\/\//i.test(url)) shell.openExternal(url);
  }

  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    core = new Core(dataDir, { onEvent: emit });
    core.config.setSecrets(secrets);
    syncHttp();
    syncAuto();

    ipcMain.handle('api', async (_e, method, args) => {
      const m = METHODS[method];
      if (!m) throw new Error('Méthode inconnue : ' + method);
      if (method === 'ask' && args[1] && args[1].stream) {
        args[1] = { ...args[1], onToken: (t) => emit('token', t) };
      }
      const r = await m.run(core, ...(args || []));
      if (method === 'setSettings') { syncHttp(); syncAuto(); }
      return r;
    });
    ipcMain.handle('pickFolder', async () => {
      const r = await dialog.showOpenDialog(win, { title: 'Choisir un coffre Obsidian', properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle('saveFile', async (_e, name, content, isBase64) => {
      const r = await dialog.showSaveDialog(win, { defaultPath: name });
      if (r.canceled) return null;
      fs.writeFileSync(r.filePath, isBase64 ? Buffer.from(content, 'base64') : content);
      return r.filePath;
    });
    ipcMain.handle('openFile', async (_e, filters) => {
      const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
      return r.canceled ? null : fs.readFileSync(r.filePaths[0], 'utf8');
    });
    ipcMain.handle('openExternal', (_e, url) => openExternal(url));
    ipcMain.handle('showItem', (_e, p) => shell.showItemInFolder(p));
    ipcMain.handle('appInfo', () => ({ exe: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, mcpScript: path.join(app.getAppPath(), 'src', 'mcp-main.js'), version: app.getVersion(), dataDir, packaged: app.isPackaged, portable: !!process.env.PORTABLE_EXECUTABLE_FILE }));

    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Fichier', submenu: [
        { label: 'Lancer l’ingestion', accelerator: 'CmdOrCtrl+I', click: () => emit('nav', 'ingest') },
        { label: 'Réglages', accelerator: 'CmdOrCtrl+,', click: () => emit('nav', 'settings') },
        { type: 'separator' }, { role: 'quit', label: 'Quitter' } ] },
      { label: 'Affichage', submenu: [
        { label: 'Poser une question', accelerator: 'CmdOrCtrl+K', click: () => emit('nav', 'chat') },
        { label: 'Graphe', accelerator: 'CmdOrCtrl+G', click: () => emit('nav', 'graph') },
        { type: 'separator' }, { role: 'resetZoom', label: 'Zoom normal' }, { role: 'zoomIn', label: 'Zoom +' }, { role: 'zoomOut', label: 'Zoom −' }, { role: 'togglefullscreen', label: 'Plein écran' } ] },
    ]));
    createWindow();
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (core) core.close(); app.quit(); });
}
