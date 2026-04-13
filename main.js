const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Spider Solitaire – Mountfield Edition',
    backgroundColor: '#1a5c2a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Fetch a URL with redirects, returns text
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const module_ = url.startsWith('https') ? https : require('http');
    const req = module_.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8'
      },
      timeout: 10000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchUrl(res.headers.location));
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Extract product image URLs from JSON-LD structured data
function extractImagesFromJsonLd(html) {
  const images = [];
  const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'ItemList' && item.itemListElement) {
          for (const el of item.itemListElement) {
            if (el.image && el.name) {
              images.push({ url: el.image, name: el.name });
            }
          }
        }
      }
    } catch {}
  }
  return images;
}

// Fetch product images from multiple mountfield.cz categories
async function fetchMountfieldImages() {
  const categories = [
    'https://www.mountfield.cz/sekacky-na-travu',
    'https://www.mountfield.cz/bazeny',
    'https://www.mountfield.cz/zahradni-nabytek',
    'https://www.mountfield.cz/roboticke-sekacky'
  ];

  const allImages = [];

  for (const url of categories) {
    try {
      const html = await fetchUrl(url);
      const imgs = extractImagesFromJsonLd(html);
      allImages.push(...imgs);
      if (allImages.length >= 20) break;
    } catch (err) {
      console.warn('Failed to fetch', url, err.message);
    }
  }

  // Deduplicate
  const seen = new Set();
  return allImages.filter(img => {
    if (seen.has(img.url)) return false;
    seen.add(img.url);
    return true;
  });
}

// Fallback image IDs gathered from the mountfield.cz website
const FALLBACK_IMAGES = [
  { url: 'https://cdn.mountfield.cz/content/images/product/original/8122.jpg',   name: 'Greenworks G40LM35 – aku sekačka' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/18542.jpg',  name: 'Greenworks G40LM41 – aku sekačka' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/42112.jpg',  name: 'Greenworks GD24LM33 – aku sekačka' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/118953.jpg', name: 'MTF LMA 32-40N – aku sekačka' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/13820.jpg',  name: 'Bazén Swing4KIDS 3,05×0,76 m' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/21674.jpg',  name: 'Bazén SWING Splash 3,66×0,76 m' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/12978.jpg',  name: 'Balkonové křeslo AMBRA – teak' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/13900.jpg',  name: 'Balkonový stůl AMBRA – teak' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/9500.jpg',   name: 'Zahradní sekačka SP 46 B' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/15000.jpg',  name: 'Zahradní bazén Steel Pro' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/25000.jpg',  name: 'Zahradní nábytek – sestava' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/33000.jpg',  name: 'Zahradní grilu Broil King' },
  { url: 'https://cdn.mountfield.cz/content/images/product/original/50000.jpg',  name: 'Zahradní nůžky na živý plot' }
];

ipcMain.handle('get-mountfield-images', async () => {
  try {
    const images = await fetchMountfieldImages();
    if (images.length >= 8) {
      // Ensure we have exactly 13 (pad with fallbacks if needed)
      const result = [...images];
      for (const fb of FALLBACK_IMAGES) {
        if (result.length >= 13) break;
        if (!result.find(r => r.url === fb.url)) result.push(fb);
      }
      return result.slice(0, 13);
    }
  } catch {}
  return FALLBACK_IMAGES.slice(0, 13);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
