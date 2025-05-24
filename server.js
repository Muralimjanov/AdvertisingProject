import express from 'express';
import { chromium } from 'playwright';  // импортируем Playwright
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

// Для __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Константы
const app = express();
const PORT = 3000;
const CACHE_FILE = path.join(__dirname, 'video_cache.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CACHE_EXPIRY = 3600000; // 1 час

app.use(cors());
app.use(express.json());

// JSON config o‘qish
function readConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
  return { defaultVideoUrl: '' };
}

// JSON config yozish
function writeConfig(newConfig) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
}

// Cache o‘qish
function readCache() {
  if (fs.existsSync(CACHE_FILE)) {
    return JSON.parse(fs.readFileSync(CACHE_FILE));
  }
  return {};
}

// Cache yozish
function writeCacheEntry(videoUrl, iframeUrl) {
  const cache = readCache();
  cache[videoUrl] = {
    url: iframeUrl,
    timestamp: Date.now()
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Playwright orqali iframe olish
async function parseVideoUrl(videoPageUrl) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    timeout: 30000
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Блокируем все запросы, кроме документа и iframe (аналог setRequestInterception)
  await page.route('**/*', route => {
    const resourceType = route.request().resourceType();
    if (resourceType === 'document' || resourceType === 'iframe') {
      route.continue();
    } else {
      route.abort();
    }
  });

  try {
    await page.goto(videoPageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000
    });

    // Выбираем iframe с src содержащим "rutube"
    const iframeHandle = await page.$('iframe[src*="rutube"]');
    if (!iframeHandle) {
      throw new Error('Rutube iframe topilmadi');
    }

    const iframeUrl = await iframeHandle.getAttribute('src');

    await browser.close();
    return iframeUrl;
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// GET - Hozirgi URL
app.get('/current-url', (req, res) => {
  const config = readConfig();
  res.json({ url: config.defaultVideoUrl });
});

// POST - URL yangilash
app.post('/update-url', (req, res) => {
  const { newUrl } = req.body;
  if (!newUrl || !newUrl.startsWith('https://yandex.ru/video/preview/')) {
    return res.status(400).json({ error: 'Yaroqsiz URL format' });
  }

  const config = readConfig();
  config.defaultVideoUrl = newUrl;
  writeConfig(config);

  res.json({ message: 'URL yangilandi', url: newUrl });
});

// HTML sahifa
app.get('/', async (req, res) => {
  const { defaultVideoUrl } = readConfig();

  try {
    const cache = readCache();
    const entry = cache[defaultVideoUrl];
    let iframeUrl;

    if (entry && (Date.now() - entry.timestamp < CACHE_EXPIRY)) {
      iframeUrl = entry.url;
    } else {
      iframeUrl = await parseVideoUrl(defaultVideoUrl);
      writeCacheEntry(defaultVideoUrl, iframeUrl);
    }

    res.set('Content-Type', 'text/html');
    res.send(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Rutube iframe</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: #f0f0f0;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
            padding: 40px 20px;
          }

          h3 {
            font-weight: 600;
            margin-bottom: 20px;
            text-shadow: 0 2px 6px rgba(0,0,0,0.3);
          }

          .iframe-container {
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            border-radius: 12px;
            overflow: hidden;
            width: 90%;
            max-width: 800px;
            transition: box-shadow 0.3s ease;
          }

          .iframe-container:hover {
            box-shadow: 0 12px 40px rgba(0,0,0,0.6);
          }

          iframe {
            width: 100%;
            height: 450px;
            border: none;
            display: block;
          }

          p {
            margin-top: 20px;
            font-size: 1rem;
            text-align: center;
            user-select: text;
          }

          p a {
            color: #ffd369;
            text-decoration: none;
            font-weight: 600;
            transition: color 0.2s ease;
          }

          p a:hover {
            color: #ffb347;
            text-decoration: underline;
          }

          @media (max-width: 600px) {
            iframe {
              height: 280px;
            }
          }
        </style>
      </head>
      <body>
        <h3>Rutube iframe:</h3>
        <div class="iframe-container">
          <iframe src="${iframeUrl}" allowfullscreen></iframe>
        </div>
        <p>Video manzili: <a href="${defaultVideoUrl}" target="_blank" rel="noopener noreferrer">${defaultVideoUrl}</a></p>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`<h1>Xato: ${err.message}</h1>`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server http://localhost:${PORT} da ishlayapti`);
});
