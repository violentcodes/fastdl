const $ = (s) => document.querySelector(s);

const urlInput = $('#urlInput');
const fetchBtn = $('#fetchBtn');
const btnLabel = $('.btn-label');
const btnSpinner = $('.btn-spinner');
const errorMsg = $('#errorMsg');
const resultCard = $('#resultCard');
const platformIcon = $('#platformIcon');

const YT_RE = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/i;
const IG_RE = /^(https?:\/\/)?(www\.)?instagram\.com\/(reel|reels|p)\//i;

let currentInfo = null;

urlInput.addEventListener('input', () => {
  const v = urlInput.value.trim();
  platformIcon.classList.remove('youtube', 'instagram');

  if (YT_RE.test(v)) {
    platformIcon.classList.add('youtube');
    platformIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31.4 31.4 0 000 12a31.4 31.4 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1A31.4 31.4 0 0024 12a31.4 31.4 0 00-.5-5.8zM9.6 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>`;
  } else if (IG_RE.test(v)) {
    platformIcon.classList.add('instagram');
    platformIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>`;
  } else {
    platformIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>`;
  }
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchBtn.click();
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.hidden = false;
  errorMsg.style.animation = 'none';
  errorMsg.offsetHeight;
  errorMsg.style.animation = '';
}

function hideError() { errorMsg.hidden = true; }

function setLoading(on) {
  fetchBtn.disabled = on;
  btnLabel.style.display = on ? 'none' : '';
  btnSpinner.style.display = on ? 'block' : 'none';
}

function formatDuration(s) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

fetchBtn.addEventListener('click', async () => {
  hideError();
  resultCard.hidden = true;
  const url = urlInput.value.trim();

  if (!url) { showError('Please paste a video link first.'); return; }
  if (!YT_RE.test(url) && !IG_RE.test(url)) {
    showError('Unsupported link — use a YouTube or Instagram Reel URL.');
    return;
  }

  setLoading(true);
  try {
    const res = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        ...getRequestPayloadOptions()
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    currentInfo = { ...data, url };
    renderResult(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

function renderResult(data) {
  // Load thumbnail directly since hotlinking is allowed by platforms, saving serverless bandwidth
  $('#thumbnail').src = data.thumbnail || '';
  $('#videoTitle').textContent = data.title;
  $('#videoUploader').textContent = data.uploader;

  const dur = $('#durationBadge');
  if (data.duration) {
    dur.textContent = formatDuration(data.duration);
    dur.style.display = '';
  } else {
    dur.style.display = 'none';
  }

  const pb = $('#platformBadge');
  pb.className = 'result-platform ' + data.platform;
  pb.textContent = data.platform === 'youtube' ? 'YouTube' : 'Instagram';

  const sel = $('#qualitySelect');
  sel.innerHTML = '';
  for (const q of data.qualities) {
    const opt = document.createElement('option');
    opt.value = q.height === 0 ? 'audio' : q.height;
    let label = q.label;
    if (q.filesize) label += ` (~${formatBytes(q.filesize)})`;
    opt.textContent = label;
    sel.appendChild(opt);
  }

  resultCard.hidden = false;
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

$('#downloadBtn').addEventListener('click', async () => {
  if (!currentInfo) return;

  const quality = $('#qualitySelect').value;
  const progressArea = $('#progressArea');
  const progressBar = $('#progressBar');
  const progressLabel = $('#progressLabel');

  progressArea.hidden = false;
  progressBar.classList.add('indeterminate');
  progressLabel.textContent = 'Resolving media links via Cloud Proxy...';
  $('#downloadBtn').style.display = 'none';

  try {
    const prepRes = await fetch('/api/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentInfo.url,
        quality,
        title: currentInfo.title || 'video',
        ...getRequestPayloadOptions()
      }),
    });

    if (!prepRes.ok) {
      const err = await prepRes.json();
      throw new Error(err.error || 'Failed to prepare download');
    }

    const { downloadUrl, filename } = await prepRes.json();

    progressLabel.textContent = '✓ Starting download...';
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = '100%';
    progressBar.style.background = '#34c759';

    // Trigger download via new tab navigation. The Cobalt CDN returns direct Content-Disposition: attachment headers,
    // which prompts a standard file download immediately.
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    a.target = '_blank';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      progressArea.hidden = true;
      progressBar.style.width = '0%';
      progressBar.style.background = '';
      $('#downloadBtn').style.display = '';
    }, 4000);
  } catch (err) {
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = '100%';
    progressBar.style.background = '#d32f2f';
    progressLabel.textContent = err.message;

    setTimeout(() => {
      progressArea.hidden = true;
      progressBar.style.width = '0%';
      progressBar.style.background = '';
      $('#downloadBtn').style.display = '';
    }, 4500);
  }
});

const TRAIL_ASSETS = [
  'https://framerusercontent.com/images/MQ5OgaArayXPtshvbXK3krAdpRE.png',
  'https://framerusercontent.com/images/5onYqEeKeJ17oyUaLyCmrJK3X9A.png',
  'https://framerusercontent.com/images/2h0CWZJ8TO1HbA81UHB5GOU17tU.png',
  'https://framerusercontent.com/images/Gj9HX14xDbFrq9mr8kZRSzqZCAY.png',
  'https://framerusercontent.com/images/GOTdryRVhkXOzVsx4MsFzlPeQb8.png',
  'https://framerusercontent.com/images/PObDEM7qLPbIPUZKkGtFxSFYQ.png',
  'https://framerusercontent.com/images/dEW4lgd2CcTvA2bYYD47lLbXvg.png',
  'https://framerusercontent.com/images/9vhCiOQKTRjrTg49ylLI3XS9WA.png',
  'https://framerusercontent.com/images/2985SC7VGUyip6n5OeaM0eEIAnQ.png',
  'https://framerusercontent.com/images/YRU6ViMgaNMbqajLXp2ohmwWyY.png'
];

let lastX = 0;
let lastY = 0;
let assetIndex = 0;
let lastSpawnTime = 0;

const SPAWN_THRESHOLD = 50;   
const COOLDOWN = 50;          
const DISPLAY_TIME = 1200;    

let trailContainer = document.querySelector('.trail-container');
if (!trailContainer) {
  trailContainer = document.createElement('div');
  trailContainer.className = 'trail-container';
  document.body.appendChild(trailContainer);
}

window.addEventListener('mousemove', (e) => {
  const currentX = e.clientX;
  const currentY = e.clientY;

  const now = Date.now();
  if (now - lastSpawnTime < COOLDOWN) return;

  const nav = document.querySelector('nav');
  if (nav) {
    const navRect = nav.getBoundingClientRect();
    if (currentY >= navRect.top && currentY <= navRect.bottom) {
      return; 
    }
  }

  const inputArea = document.querySelector('.input-area');
  if (inputArea) {
    const inputRect = inputArea.getBoundingClientRect();
    const bufferX = 30; 
    const bufferY = 20; 
    if (currentX >= (inputRect.left - bufferX) && currentX <= (inputRect.right + bufferX) &&
        currentY >= (inputRect.top - bufferY) && currentY <= (inputRect.bottom + bufferY)) {
      return; 
    }
  }

  const distance = Math.hypot(currentX - lastX, currentY - lastY);

  if (distance > SPAWN_THRESHOLD) {
    spawnTrailItem(currentX, currentY);
    lastX = currentX;
    lastY = currentY;
    lastSpawnTime = now;
  }
});

function spawnTrailItem(x, y) {
  const item = document.createElement('div');
  item.className = 'trail-item';
  item.style.left = `${x}px`;
  item.style.top = `${y}px`;

  const size = Math.floor(Math.random() * (380 - 250) + 250);
  item.style.width = `${size}px`;
  item.style.height = `${size}px`;

  const rotation = Math.floor(Math.random() * 70) - 35;
  item.style.transform = `translate(-50%, -50%) scale(1) rotate(${rotation}deg)`;
  
  const zIdx = Math.floor(Math.random() * 80) + 1;
  item.style.zIndex = zIdx;

  let blurVal = 0;
  const depthRand = Math.random();
  if (depthRand < 0.18) {
    blurVal = Math.floor(Math.random() * 3) + 4; 
  } else if (depthRand < 0.38) {
    blurVal = 2; 
  }
  item.style.filter = `blur(${blurVal}px)`;
  item.style.opacity = '1';

  const img = document.createElement('img');
  img.src = TRAIL_ASSETS[assetIndex];
  img.alt = 'Happn 3D Asset';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  
  item.appendChild(img);
  assetIndex = (assetIndex + 1) % TRAIL_ASSETS.length;

  trailContainer.appendChild(item);

  setTimeout(() => {
    item.style.transition = 'transform 0.8s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), filter 0.8s cubic-bezier(0.16, 1, 0.3, 1)';
    
    requestAnimationFrame(() => {
      const exitRot = rotation + (Math.random() > 0.5 ? 12 : -12);
      item.style.transform = `translate(-50%, -50%) scale(0.35) rotate(${exitRot}deg) translateY(35px)`;
      item.style.opacity = '0';
      item.style.filter = `blur(${blurVal + 6}px)`;
    });

    setTimeout(() => {
      item.remove();
    }, 800);

  }, DISPLAY_TIME);
}

let userSettings = {
  cookieSource: 'none',
  customCookies: '',
  customUserAgent: ''
};

function loadSettings() {
  const saved = localStorage.getItem('fastdl_settings');
  if (saved) {
    try {
      userSettings = { ...userSettings, ...JSON.parse(saved) };
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
  }

  const cs = $('#cookieSource');
  const cc = $('#customCookies');
  const cua = $('#customUserAgent');

  if (cs) cs.value = userSettings.cookieSource;
  if (cc) cc.value = userSettings.customCookies;
  if (cua) cua.value = userSettings.customUserAgent;

  toggleCustomCookiesVisibility();
}

function saveSettings() {
  const cs = $('#cookieSource');
  const cc = $('#customCookies');
  const cua = $('#customUserAgent');

  if (cs) userSettings.cookieSource = cs.value;
  if (cc) userSettings.customCookies = cc.value;
  if (cua) userSettings.customUserAgent = cua.value;

  localStorage.setItem('fastdl_settings', JSON.stringify(userSettings));
}

function toggleCustomCookiesVisibility() {
  const cs = $('#cookieSource');
  const ccg = $('#customCookiesGroup');
  if (cs && ccg) {
    const isCustom = cs.value === 'custom';
    ccg.hidden = !isCustom;
  }
}

function getRequestPayloadOptions() {
  const options = {};
  if (userSettings.cookieSource === 'custom') {
    options.cookies = userSettings.customCookies;
  } else if (userSettings.cookieSource !== 'none') {
    options.cookiesFromBrowser = userSettings.cookieSource;
  }
  if (userSettings.customUserAgent) {
    options.userAgent = userSettings.customUserAgent;
  }
  return options;
}

const settingsBtn = $('#settingsBtn');
const drawerOverlay = $('#drawerOverlay');
const settingsDrawer = $('#settingsDrawer');
const drawerCloseBtn = $('#drawerCloseBtn');
const saveSettingsBtn = $('#saveSettingsBtn');
const cookieSourceSelect = $('#cookieSource');

if (settingsBtn && drawerOverlay && settingsDrawer) {
  settingsBtn.addEventListener('click', () => {
    drawerOverlay.classList.add('active');
    settingsDrawer.classList.add('active');
  });

  const closeDrawer = () => {
    drawerOverlay.classList.remove('active');
    settingsDrawer.classList.remove('active');
  };

  drawerOverlay.addEventListener('click', closeDrawer);
  if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', closeDrawer);

  if (cookieSourceSelect) {
    cookieSourceSelect.addEventListener('change', toggleCustomCookiesVisibility);
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
      saveSettings();
      closeDrawer();

      const originalText = saveSettingsBtn.textContent;
      saveSettingsBtn.textContent = '✓ Saved Successfully!';
      saveSettingsBtn.style.background = '#34c759';
      saveSettingsBtn.style.color = '#fff';

      setTimeout(() => {
        saveSettingsBtn.textContent = originalText;
        saveSettingsBtn.style.background = '';
        saveSettingsBtn.style.color = '';
      }, 1500);
    });
  }
}

document.addEventListener('DOMContentLoaded', loadSettings);
