const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  getPlaylistInfo: (url, opts) => ipcRenderer.invoke('get-playlist-info', url, opts),
  download: (opts) => ipcRenderer.invoke('download', opts),
  onDownloadStarted: (cb) => ipcRenderer.on('download-started', () => cb()),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (e, p) => cb(p)),
  onDownloadFile: (cb) => ipcRenderer.on('download-file', (e, f) => cb(f)),
  onDownloadLog: (cb) => ipcRenderer.on('download-log', (e, m) => cb(m)),
  onDownloadComplete: (cb) => ipcRenderer.on('download-complete', () => cb()),
  onDownloadError: (cb) => ipcRenderer.on('download-error', (e, m) => cb(m))
});
