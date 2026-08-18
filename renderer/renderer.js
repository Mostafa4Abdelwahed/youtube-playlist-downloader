const $ = (id) => document.getElementById(id);

const els = {
  url: $('url'),
  type: $('type'),
  quality: $('quality'),
  qualityField: $('qualityField'),
  folder: $('folder'),
  browse: $('browse'),
  cookiesBrowser: $('cookiesBrowser'),
  cookiesFile: $('cookiesFile'),
  browseCookies: $('browseCookies'),
  fetch: $('fetch'),
  start: $('start'),
  infoCard: $('infoCard'),
  playlistTitle: $('playlistTitle'),
  playlistMeta: $('playlistMeta'),
  itemCount: $('itemCount'),
  itemList: $('itemList'),
  progressCard: $('progressCard'),
  progressBar: $('progressBar'),
  progressText: $('progressText'),
  currentFile: $('currentFile'),
  log: $('log')
};

let playlist = null;
let downloading = false;

els.type.addEventListener('change', () => {
  els.qualityField.hidden = els.type.value === 'audio';
});

els.browse.addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    els.folder.value = folder;
    if (playlist) els.start.disabled = !els.folder.value;
  }
});

els.browseCookies.addEventListener('click', async () => {
  const result = await window.api.selectFile();
  if (result) els.cookiesFile.value = result;
});

function cookieFlags() {
  return {
    cookiesBrowser: els.cookiesBrowser.value || null,
    cookiesFile: els.cookiesFile.value.trim() || null
  };
}

els.fetch.addEventListener('click', async () => {
  const url = els.url.value.trim();
  if (!url) return alert('أدخل رابط القائمة أولاً');
  els.fetch.disabled = true;
  els.fetch.textContent = 'جارِ التحميل...';
  const res = await window.api.getPlaylistInfo(url, cookieFlags());
  els.fetch.disabled = false;
  els.fetch.textContent = 'عرض القائمة';

  if (!res.ok) {
    alert('تعذّر جلب القائمة: ' + res.error);
    return;
  }

  playlist = res;
  renderPlaylist(res);
  els.start.disabled = !els.folder.value;
});

function renderPlaylist(res) {
  els.playlistTitle.textContent = res.title;
  els.playlistMeta.textContent = res.uploader
    ? `${res.uploader} • ${res.count} عنصر`
    : `${res.count} عنصر`;
  els.itemCount.textContent = res.count;
  els.itemList.innerHTML = '';
  res.entries.forEach((e) => {
    const li = document.createElement('li');
    li.textContent = e.title;
    els.itemList.appendChild(li);
  });
  els.infoCard.hidden = false;
}

els.folder.addEventListener('change', () => {
  if (playlist) els.start.disabled = !els.folder.value;
});

els.start.addEventListener('click', async () => {
  if (downloading || !playlist) return;
  const outputDir = els.folder.value;
  if (!outputDir) return alert('اختر مجلد الحفظ');

  downloading = true;
  els.start.disabled = true;
  els.progressCard.hidden = false;
  resetProgress();
  log('بدء التحميل...');

  const res = await window.api.download({
    url: els.url.value.trim(),
    outputDir,
    type: els.type.value,
    quality: els.quality.value,
    ...cookieFlags()
  });

  downloading = false;
  if (!res.ok) {
    log('فشل التحميل: ' + res.error);
    els.start.disabled = false;
  }
});

function resetProgress() {
  els.progressBar.style.width = '0%';
  els.progressText.textContent = '0%';
  els.currentFile.textContent = '';
  els.log.innerHTML = '';
}

function log(msg) {
  const div = document.createElement('div');
  div.textContent = msg;
  els.log.appendChild(div);
  els.log.scrollTop = els.log.scrollHeight;
}

window.api.onDownloadStarted(() => log('تم بدء العملية'));
window.api.onDownloadFile((f) => { els.currentFile.textContent = 'الآن: ' + f; });
window.api.onDownloadProgress((p) => {
  const percent = typeof p === 'number' ? p : p.percent;
  els.progressBar.style.width = percent + '%';
  els.progressText.textContent = percent.toFixed(1) + '%';
});
window.api.onDownloadLog((m) => log(m));
window.api.onDownloadComplete(() => {
  log('✅ اكتمل التحميل');
  els.start.disabled = false;
});
window.api.onDownloadError((m) => {
  log('❌ ' + m);
  els.start.disabled = false;
});
