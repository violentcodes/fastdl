const express = require('express');
const path = require('path');
const ytdlp = require('yt-dlp-exec');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));

const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/i;
const INSTAGRAM_REGEX = /^(https?:\/\/)?(www\.)?instagram\.com\/(reel|reels|p)\//i;

function detectPlatform(url) {
  if (YOUTUBE_REGEX.test(url)) return 'youtube';
  if (INSTAGRAM_REGEX.test(url)) return 'instagram';
  return null;
}

async function runYtdlpWithConfig(url, baseArgs, customSettings = {}) {
  const { cookies, cookiesFromBrowser, userAgent } = customSettings;
  const platform = detectPlatform(url);
  const args = { ...baseArgs };

  const defaultUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const ua = userAgent && userAgent.trim() ? userAgent.trim() : defaultUA;
  const headers = [`user-agent:${ua}`];

  if (platform === 'instagram') {
    headers.push('referer:https://www.instagram.com/');
  } else if (platform === 'youtube') {
    headers.push('referer:https://www.youtube.com/');
  }
  args.addHeader = headers;

  let tempCookiePath = null;
  let tempDir = null;

  try {
    if (cookies && cookies.trim()) {
      tempDir = path.join(os.tmpdir(), 'fastdl_cookies_' + crypto.randomBytes(6).toString('hex'));
      fs.mkdirSync(tempDir, { recursive: true });
      tempCookiePath = path.join(tempDir, 'cookies.txt');
      fs.writeFileSync(tempCookiePath, cookies.trim(), 'utf8');
      args.cookies = tempCookiePath;
    } else if (cookiesFromBrowser && cookiesFromBrowser !== 'none') {
      args.cookiesFromBrowser = cookiesFromBrowser;
    }

    return await ytdlp(url, args);
  } finally {
    if (tempCookiePath && fs.existsSync(tempCookiePath)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Error cleaning up cookies:', err.message || err);
      }
    }
  }
}

function parseYtdlpError(err, defaultMsg) {
  const rawError = (err.stderr || '') + '\n' + (err.message || '') + '\n' + (err.toString() || '');
  
  if (rawError.includes("confirm you're not a bot") || rawError.includes("confirm you are not a bot") || rawError.includes("confirm your identity")) {
    return "YouTube detected bot activity. Please click the Settings icon (cog) and paste a valid Netscape cookies.txt to bypass this block.";
  }
  if (rawError.includes('truncated_id') || rawError.includes('looks truncated') || rawError.includes('Incomplete YouTube ID')) {
    return 'The YouTube link appears to be truncated or incomplete. Please copy and paste the full URL.';
  }
  if (rawError.includes('Video unavailable') || rawError.includes('is unavailable')) {
    return 'This video is unavailable. It may be private, deleted, or region-restricted.';
  }
  if (rawError.includes('Private video')) {
    return 'This video is private. Please use the Settings icon (cog) to import cookies if you have access to it.';
  }
  if (rawError.includes('Failed to decrypt with DPAPI')) {
    return 'Failed to decrypt browser cookies due to Windows DPAPI security restrictions. Please use the "Paste Netscape cookies.txt" option in Settings instead.';
  }
  if (rawError.includes('Could not copy Chrome cookie database') || rawError.includes('locked')) {
    return 'Could not read Chrome/Edge cookies because the browser is open and locking the database. Please close your browser completely, or use the "Paste Netscape cookies.txt" option in Settings.';
  }
  if (rawError.includes('Unsupported URL')) {
    return 'Unsupported URL format. Please make sure the link is correct.';
  }
  if (rawError.includes('Requested format is not available')) {
    return 'The requested video format/quality is not available. Try another quality.';
  }
  if (rawError.includes('Sign in to confirm')) {
    return 'YouTube requires authentication. Please paste valid Netscape cookies.txt in Settings.';
  }
  
  const match = rawError.match(/ERROR:\s*(.+)/);
  if (match) {
    return `Error: ${match[1]}`;
  }
  
  return defaultMsg;
}

app.post('/api/info', async (req, res) => {
  const { url, cookies, cookiesFromBrowser, userAgent } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: 'Unsupported URL. Please provide a YouTube or Instagram Reel link.' });

  try {
    const info = await runYtdlpWithConfig(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
    }, { cookies, cookiesFromBrowser, userAgent });

    const qualities = [];
    const seen = new Set();

    if (info.formats) {
      const videoFormats = info.formats
        .filter(f => f.vcodec !== 'none' && f.height)
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      for (const f of videoFormats) {
        const label = `${f.height}p`;
        if (!seen.has(label)) {
          seen.add(label);
          qualities.push({
            label,
            height: f.height,
            formatId: f.format_id,
            ext: f.ext,
            filesize: f.filesize || f.filesize_approx || null,
          });
        }
      }
    }

    qualities.push({ label: 'Audio Only (MP3)', height: 0, formatId: 'audio', ext: 'mp3' });

    res.json({
      title: info.title || 'Untitled',
      thumbnail: info.thumbnail || '',
      duration: info.duration || 0,
      uploader: info.uploader || info.channel || 'Unknown',
      platform,
      qualities,
    });
  } catch (err) {
    console.error('Info error:', err.message || err);
    const friendlyError = parseYtdlpError(err, 'Failed to fetch video info. Make sure the link is valid and the video is public.');
    res.status(500).json({ error: friendlyError });
  }
});

const pendingDownloads = new Map();

app.post('/api/prepare', (req, res) => {
  const { url, quality, title, cookies, cookiesFromBrowser, userAgent } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: 'Unsupported URL.' });

  const token = crypto.randomBytes(16).toString('hex');

  const cleanTitle = (title || 'video')
    .replace(/[<>:"/\\|?*#%&{}!`'@\[\]\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100) || 'video';
  const ext = quality === 'audio' ? '.mp3' : '.mp4';
  const filename = cleanTitle + ext;

  pendingDownloads.set(token, { url, quality, platform, title, cookies, cookiesFromBrowser, userAgent });

  setTimeout(() => pendingDownloads.delete(token), 10 * 60 * 1000);

  res.json({ token, filename, downloadUrl: `/api/download/${token}/${filename}` });
});

app.get('/api/download/:token/:filename', async (req, res) => {
  const { token, filename } = req.params;
  const job = pendingDownloads.get(token);

  if (!job) {
    return res.status(410).json({ error: 'Download link expired. Please try again.' });
  }

  const { url, quality, cookies, cookiesFromBrowser, userAgent } = job;
  const tmpDir = path.join(os.tmpdir(), 'fastdl_' + crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(tmpDir, { recursive: true });

  const outputTemplate = path.join(tmpDir, 'video.%(ext)s');

  try {
    let args = {
      noWarnings: true,
      noCheckCertificates: true,
      output: outputTemplate,
      ffmpegLocation: ffmpegPath,
    };

    if (quality === 'audio') {
      args.extractAudio = true;
      args.audioFormat = 'mp3';
      args.audioQuality = '0';
    } else if (quality) {
      args.format = `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
      args.mergeOutputFormat = 'mp4';
    } else {
      args.format = 'best';
      args.mergeOutputFormat = 'mp4';
    }

    await runYtdlpWithConfig(url, args, { cookies, cookiesFromBrowser, userAgent });

    const files = fs.readdirSync(tmpDir);
    if (files.length === 0) throw new Error('Download failed - no file produced');

    const filePath = path.join(tmpDir, files[0]);
    const ext = path.extname(files[0]);
    const stat = fs.statSync(filePath);

    console.log('Download:', { filename, ext, fileSize: stat.size });

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('end', () => {
      pendingDownloads.delete(token);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    stream.on('error', () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  } catch (err) {
    console.error('Download error:', err.message || err);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (!res.headersSent) {
      const friendlyError = parseYtdlpError(err, 'Download failed. The video may be private or region-restricted.');
      res.status(500).json({ error: friendlyError });
    }
  }
});

app.get('/api/proxy-thumbnail', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Image URL is required');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.instagram.com/'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch image');

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (err) {
    console.error('Thumbnail proxy error:', err.message);
    res.status(500).send('Failed to load thumbnail');
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`⚡ FastDownload running at http://localhost:${PORT}`);
  });
}

module.exports = app;
