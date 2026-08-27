// main.js
require('dotenv').config(); // فعال‌سازی متغیرهای محیطی

const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// غیرفعال کردن کش HTTP برای اطمینان از دریافت آخرین نسخه سایت
app.commandLine.appendSwitch('disable-http-cache');

// سوییچ هوشمند URL: اولویت با .env است، اگر نبود از آدرس اصلی استفاده می‌کند
const TARGET_URL = process.env.APP_URL || 'https://app.yaran.info';

const OFFLINE_HTML = path.join(__dirname, 'offline', 'index.html');
const CHECK_TIMEOUT_MS = 8000;
const OFFLINE_AFTER_MS = 2500;

let mainWindow = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function getAppIcon() {
  const iconPath =
    process.platform === 'win32'
      ? path.join(__dirname, 'build', 'icon.ico')
      : path.join(__dirname, 'build', 'icon.png');

  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 420,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#003ece',
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // اگر لود سایت به هر دلیلی شکست خورد، صفحه آفلاین را نشان بده
  mainWindow.webContents.on(
    'did-fail-load',
    (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3) return; // ERR_ABORTED را نادیده بگیر

      if (typeof validatedURL === 'string' && validatedURL.startsWith('http')) {
        loadOffline(mainWindow);
      }
    }
  );

  // لینک‌های خارجی را در مرورگر سیستم باز کن
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(TARGET_URL)) {
      return { action: 'allow' };
    }

    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url).catch(() => {});
    }

    return { action: 'deny' };
  });

  loadBest(mainWindow);
}

async function canReachTarget() {
  if (!net.isOnline()) {
    return false;
  }

  return new Promise((resolve) => {
    let finished = false;
    let request;

    const finish = (ok) => {
      if (finished) return;
      finished = true;

      try {
        if (request) request.abort();
      } catch {}

      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), CHECK_TIMEOUT_MS);

    try {
      request = net.request({
        method: 'HEAD',
        url: TARGET_URL
      });

      request.on('response', (response) => {
        clearTimeout(timer);
        const ok = response.statusCode >= 200 && response.statusCode < 500;
        finish(ok);
      });

      request.on('error', () => {
        clearTimeout(timer);
        finish(false);
      });

      request.end();
    } catch {
      clearTimeout(timer);
      finish(false);
    }
  });
}

async function loadBest(win) {
  if (!win || win.isDestroyed()) return;

  const fallbackTimer = setTimeout(() => {
    if (!win.isDestroyed()) {
      loadOffline(win);
    }
  }, OFFLINE_AFTER_MS);

  const reachable = await canReachTarget();

  clearTimeout(fallbackTimer);

  if (!win || win.isDestroyed()) return;

  if (reachable) {
    await loadOnline(win);
  } else {
    loadOffline(win);
  }
}

async function loadOnline(win) {
  if (!win || win.isDestroyed()) return;

  try {
    await win.webContents.session.clearCache();

    const cacheBuster = `${TARGET_URL.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
    const url = `${TARGET_URL}${cacheBuster}`;

    await win.loadURL(url, {
      extraHeaders: [
        'Cache-Control: no-cache, no-store, must-revalidate',
        'Pragma: no-cache',
        'Expires: 0'
      ].join('\n')
    });
  } catch {
    loadOffline(win);
  }
}

function loadOffline(win) {
  if (!win || win.isDestroyed()) return;
  win.loadFile(OFFLINE_HTML).catch(() => {});
}

// دکمه تلاش مجدد در صفحه آفلاین
ipcMain.on('retry-online', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    loadBest(win);
  }
});