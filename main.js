const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const youtubeDl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');

const YTDL_BIN = youtubeDl.constants.YOUTUBE_DL_PATH;

// yt-dlp is a PyInstaller bundle that extracts its Python runtime into
// %TEMP%. We force extraction onto a writable temp dir. In dev this is a
// folder next to the project; in the packaged app we use userData (the
// asar archive is read-only, so __dirname can't be used).
const YT_TMP = path.join(app.getPath('userData'), '.yt-tmp');
if (!fs.existsSync(YT_TMP)) fs.mkdirSync(YT_TMP, { recursive: true });

// Spawn yt-dlp directly with an argument ARRAY (shell:false) so Windows
// passes arguments literally. This avoids cmd.exe mangling `%`-based
// output templates and dropping flags when the binary path contains spaces.
function spawnYtDl(url, flags, tempDir = YT_TMP) {
  const fullArgs = [url, ...youtubeDl.args(flags)].filter(Boolean);
  return spawn(YTDL_BIN, fullArgs, {
    shell: false,
    windowsHide: true,
    env: { ...process.env, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir }
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function cookieArgs(cookies = {}) {
  const a = {};
  if (cookies.cookiesFile) a.cookies = cookies.cookiesFile;
  else if (cookies.cookiesBrowser) a.cookiesFromBrowser = cookies.cookiesBrowser;
  return a;
}

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-playlist-info', async (event, url, cookies = {}) => {
  return new Promise((resolve) => {
    const cp = spawnYtDl(url, {
      dumpSingleJson: true,
      flatPlaylist: true,
      noWarnings: true,
      simulate: true,
      ffmpegLocation: ffmpegPath,
      jsRuntimes: 'node',
      ...cookieArgs(cookies)
    });
    let out = '';
    let err = '';
    cp.stdout.on('data', (d) => (out += d.toString()));
    cp.stderr.on('data', (d) => (err += d.toString()));
    cp.on('error', (e) => resolve({ ok: false, error: 'تعذّر تشغيل yt-dlp: ' + e.message }));
    cp.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: err.trim() || `Exit code ${code}` });
        return;
      }
      try {
        const res = JSON.parse(out);
        const entries = res.entries || (res.thumbnail ? [res] : []);
        resolve({
          ok: true,
          title: res.title || 'Playlist',
          uploader: res.uploader || '',
          count: entries.length,
          entries: entries.map((e, i) => ({
            index: i,
            id: e.id,
            title: e.title || `Item ${i + 1}`,
            url: e.url || `https://www.youtube.com/watch?v=${e.id}`
          }))
        });
      } catch (e) {
        resolve({ ok: false, error: 'Failed to parse playlist info' });
      }
    });
  });
});

ipcMain.handle('download', async (event, { url, outputDir, type, quality, cookiesBrowser, cookiesFile, startItem, endItem }) => {
  if (!outputDir) return { ok: false, error: 'No output folder selected' };
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const baseTemplate = path.join(outputDir, '%(playlist_index)02d - %(title)s.%(ext)s');

  let playlistItems = '';
  if (startItem && endItem) playlistItems = `${startItem}-${endItem}`;
  else if (startItem) playlistItems = `${startItem}-`;
  else if (endItem) playlistItems = `-${endItem}`;

  const args = {
    ...cookieArgs({ cookiesBrowser, cookiesFile }),
    ...(playlistItems ? { playlistItems } : {}),
    output: baseTemplate,
    noWarnings: true,
    continue: true,
    restrictFilenames: true,
    progress: true,
    newline: true,
    ffmpegLocation: ffmpegPath,
    jsRuntimes: 'node',
    paths: ['temp:' + outputDir]
  };

  if (type === 'audio') {
    args.extractAudio = true;
    args.audioFormat = 'mp3';
    args.audioQuality = '0';
    args.format = 'bestaudio/best';
  } else {
    let fmt = 'bestvideo+bestaudio/best';
    if (quality === '1080') fmt = 'bv[height<=1080]+ba/best[height<=1080]';
    else if (quality === '720') fmt = 'bv[height<=720]+ba/best[height<=720]';
    else if (quality === '480') fmt = 'bv[height<=480]+ba/best[height<=480]';
    else if (quality === '360') fmt = 'bv[height<=360]+ba/best[height<=360]';
    args.format = fmt;
    args.mergeOutputFormat = 'mp4';
  }

  send('download-started');
  return new Promise((resolve) => {
    const proc = spawnYtDl(url, args, outputDir);

    let buffer = '';
    let errBuffer = '';
    const handleLine = (line) => {
      const m = line.match(/\[download\]\s+(\d+\.\d+)%/);
      if (m) send('download-progress', { percent: parseFloat(m[1]) });
      if (line.includes('[download] Destination:')) {
        const file = line.split('Destination:')[1].trim();
        send('download-file', path.basename(file));
      }
    };
    const onData = (d) => {
      buffer += d.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) handleLine(line);
    };
    proc.stdout.on('data', onData);
    proc.on('error', (e) => {
      send('download-error', 'تعذّر تشغيل yt-dlp: ' + e.message);
      resolve({ ok: false, error: e.message });
    });
    proc.stderr.on('data', (d) => {
      const text = d.toString();
      errBuffer += text;
      for (const line of text.split(/\r?\n/)) {
        if (/ERROR|Error/.test(line)) send('download-log', line.trim());
      }
      onData(d);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const detail = errBuffer.trim().split(/\r?\n/).slice(-5).join('\n');
        send('download-error', `yt-dlp exited with code ${code}\n${detail}`);
        resolve({ ok: false, error: `Exit code ${code}: ${detail}` });
        return;
      }
      send('download-complete');
      resolve({ ok: true });
    });
  });
});
