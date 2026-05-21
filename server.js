const express = require('express');
const path = require('path');

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

const COBALT_INSTANCES = [
  'https://cobaltapi.kittycat.boo/',
  'https://dog.kittycat.boo/'
];

// Helper to make POST request to Cobalt with fallback
async function fetchFromCobalt(payload) {
  let lastError = null;
  
  for (const baseUrl of COBALT_INSTANCES) {
    try {
      console.log(`[Cobalt] Trying instance: ${baseUrl}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 seconds timeout per instance
      
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.url) {
          console.log(`[Cobalt] Success using instance: ${baseUrl}`);
          return { data, baseUrl };
        } else if (data && data.status === 'error') {
          throw new Error(data.error?.code || 'Cobalt returned error status');
        }
      }
      
      const text = await response.text();
      throw new Error(`Status ${response.status}: ${text.slice(0, 150)}`);
    } catch (err) {
      console.error(`[Cobalt] Failed instance ${baseUrl}:`, err.message || err);
      lastError = err;
    }
  }
  
  throw lastError || new Error('All Cobalt instances failed to resolve download link.');
}

app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: 'Unsupported URL. Please provide a YouTube or Instagram Reel link.' });

  try {
    if (platform === 'youtube') {
      // Fast, free YouTube oEmbed lookup
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const response = await fetch(oembedUrl);
      
      let title = 'YouTube Video';
      let uploader = 'YouTube Creator';
      let thumbnail = '';
      
      if (response.ok) {
        const data = await response.json();
        title = data.title || title;
        uploader = data.author_name || uploader;
        thumbnail = data.thumbnail_url || thumbnail;
      }
      
      const qualities = [
        { label: '1080p (Full HD)', height: 1080, formatId: '1080' },
        { label: '720p (HD)', height: 720, formatId: '720' },
        { label: '480p (SD)', height: 480, formatId: '480' },
        { label: '360p (Medium)', height: 360, formatId: '360' },
        { label: 'Audio Only (MP3)', height: 0, formatId: 'audio', ext: 'mp3' }
      ];
      
      return res.json({
        title,
        thumbnail,
        duration: 0,
        uploader,
        platform,
        qualities
      });
    } else if (platform === 'instagram') {
      // Instagram premium placeholders
      let reelId = 'Reel';
      const reelMatch = url.match(/\/reel(?:s)?\/([A-Za-z0-9_-]+)/i);
      if (reelMatch && reelMatch[1]) {
        reelId = reelMatch[1];
      }
      
      const qualities = [
        { label: 'High Quality Video', height: 1080, formatId: 'max' },
        { label: 'Audio Only (MP3)', height: 0, formatId: 'audio', ext: 'mp3' }
      ];
      
      return res.json({
        title: `Instagram Reel (${reelId})`,
        thumbnail: 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=600&auto=format&fit=crop&q=80',
        duration: 0,
        uploader: 'Instagram Creator',
        platform,
        qualities
      });
    }
  } catch (err) {
    console.error('Info endpoint error:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch video details. Ensure the link is public and valid.' });
  }
});

app.post('/api/prepare', async (req, res) => {
  const { url, quality } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  const platform = detectPlatform(url);
  if (!platform) return res.status(400).json({ error: 'Unsupported URL.' });

  try {
    const isAudio = quality === 'audio';
    
    // Prepare standard Cobalt parameters
    const cobaltPayload = {
      url: url,
      videoQuality: isAudio ? '720' : (quality || '1080'),
      audioFormat: 'mp3',
      downloadMode: isAudio ? 'audio' : 'auto'
    };

    const { data: cobaltRes } = await fetchFromCobalt(cobaltPayload);
    
    const downloadUrl = cobaltRes.url;
    const filename = cobaltRes.filename || (isAudio ? 'audio.mp3' : 'video.mp4');

    res.json({
      token: 'cloud',
      filename,
      downloadUrl: downloadUrl
    });
  } catch (err) {
    console.error('Prepare error:', err.message || err);
    res.status(500).json({ error: `Download failed: ${err.message || 'Unable to connect to download servers.'}` });
  }
});

// Pass-through proxy helper in case client needs it, optimized for high speed
app.get('/api/proxy-thumbnail', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Image URL is required');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/'
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
