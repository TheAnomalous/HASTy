const { app, BrowserWindow, Tray, Menu, screen, nativeImage, nativeTheme, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Configuration
const TARGET_URL = 'http://aiboard-73c4.local:8123/adam-s-dashboard/0';

// Phone-like dimensions
const WINDOW_WIDTH = 320;
const WINDOW_HEIGHT = 600;

// Animation settings
const FADE_DURATION = 25; // ms
const FADE_STEPS = 10;

// Settings file path
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

let tray = null;
let mainWindow = null;
let settingsWindow = null;
let isVisible = false;
let isAnimating = false;
let currentTheme = 'system';
let startWithWindows = false;

// Theme definitions - CSS to inject into the page
const THEME_CSS = {
    light: `
    :root {
      --primary-background-color: #fafafa !important;
      --secondary-background-color: #ffffff !important;
      --card-background-color: #ffffff !important;
      --primary-text-color: #212121 !important;
      --secondary-text-color: #727272 !important;
      --divider-color: rgba(0,0,0,0.12) !important;
    }
    body, html, home-assistant {
      background-color: #fafafa !important;
    }
  `,
    medium: `
    :root {
      --primary-background-color: #37474f !important;
      --secondary-background-color: #455a64 !important;
      --card-background-color: #455a64 !important;
      --primary-text-color: #ffffff !important;
      --secondary-text-color: #b0bec5 !important;
      --divider-color: rgba(255,255,255,0.12) !important;
    }
    body, html, home-assistant {
      background-color: #37474f !important;
    }
  `,
    dark: `
    :root {
      --primary-background-color: #111111 !important;
      --secondary-background-color: #1c1c1c !important;
      --card-background-color: #1c1c1c !important;
      --primary-text-color: #e1e1e1 !important;
      --secondary-text-color: #9e9e9e !important;
      --divider-color: rgba(255,255,255,0.12) !important;
    }
    body, html, home-assistant {
      background-color: #111111 !important;
    }
  `
};

const THEME_BACKGROUNDS = {
    light: '#fafafa',
    medium: '#37474f',
    dark: '#111111',
    system: null
};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            currentTheme = data.theme || 'system';
            startWithWindows = data.startWithWindows || false;
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify({
            theme: currentTheme,
            startWithWindows: startWithWindows
        }), 'utf8');
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

function applyStartupSetting() {
    app.setLoginItemSettings({
        openAtLogin: startWithWindows,
        path: process.execPath,
        args: []
    });
}

function getEffectiveTheme() {
    if (currentTheme === 'system') {
        return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    }
    return currentTheme;
}

function applyTheme() {
    if (!mainWindow) return;
    const effectiveTheme = getEffectiveTheme();
    const bgColor = THEME_BACKGROUNDS[effectiveTheme] || THEME_BACKGROUNDS.dark;
    mainWindow.setBackgroundColor(bgColor);
    const css = THEME_CSS[effectiveTheme];
    if (css) {
        mainWindow.webContents.insertCSS(css).catch(() => { });
    }
}

function setTheme(theme) {
    currentTheme = theme;
    saveSettings();
    applyTheme();
    updateTrayMenu();
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) toggleWindow();
    });
}

function createWindow() {
    const effectiveTheme = getEffectiveTheme();
    const bgColor = THEME_BACKGROUNDS[effectiveTheme] || THEME_BACKGROUNDS.dark;

    mainWindow = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        show: false,
        frame: false,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        transparent: false,
        backgroundColor: bgColor,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    mainWindow.loadURL(TARGET_URL);

    mainWindow.webContents.on('did-finish-load', () => {
        applyTheme();
    });

    // Escape to hide
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape' && input.type === 'keyDown') {
            hideWindow();
        }
    });

    mainWindow.on('blur', () => {
        hideWindow();
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            hideWindow();
        }
    });
}

function updateTrayMenu() {
    if (!tray) return;
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Dashboard',
            click: () => { if (!isVisible) toggleWindow(tray.getBounds()); }
        },
        {
            label: 'Reload',
            click: () => { if (mainWindow) mainWindow.webContents.reload(); }
        },
        { type: 'separator' },
        {
            label: 'Theme',
            submenu: [
                { label: 'System', type: 'radio', checked: currentTheme === 'system', click: () => setTheme('system') },
                { label: 'Light', type: 'radio', checked: currentTheme === 'light', click: () => setTheme('light') },
                { label: 'Medium', type: 'radio', checked: currentTheme === 'medium', click: () => setTheme('medium') },
                { label: 'Dark', type: 'radio', checked: currentTheme === 'dark', click: () => setTheme('dark') }
            ]
        },
        { type: 'separator' },
        {
            label: 'Settings',
            click: () => openSettings()
        },
        {
            label: 'Quit',
            click: () => { app.isQuitting = true; app.quit(); }
        }
    ]);
    tray.setContextMenu(contextMenu);
}

function createTray() {
    const iconPath = path.join(__dirname, '128 House.ico');
    if (fs.existsSync(iconPath)) {
        tray = new Tray(iconPath);
    } else {
        tray = new Tray(createIconImage());
    }
    tray.setToolTip('Home Assistant Dashboard');
    tray.on('click', (event, bounds) => toggleWindow(bounds));
    updateTrayMenu();
}

function createIconImage() {
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);
    // Home Assistant cyan: #41BDF5 - BGRA order for Windows
    const b = 245, g = 189, r = 65, a = 255;

    // Draw a simple house shape
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            let draw = false;

            // Roof (triangle) - top half
            if (y >= 2 && y <= 7) {
                const roofWidth = (y - 1) * 2;
                const roofStart = 8 - (y - 1);
                const roofEnd = 8 + (y - 1);
                if (x >= roofStart && x <= roofEnd) draw = true;
            }

            // House body - bottom half
            if (y >= 8 && y <= 13) {
                if (x >= 3 && x <= 12) draw = true;
            }

            // Door cutout (transparent)
            if (y >= 10 && y <= 13 && x >= 6 && x <= 9) draw = false;

            if (draw) {
                buffer[idx] = b; buffer[idx + 1] = g; buffer[idx + 2] = r; buffer[idx + 3] = a;
            } else {
                buffer[idx] = 0; buffer[idx + 1] = 0; buffer[idx + 2] = 0; buffer[idx + 3] = 0;
            }
        }
    }
    return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function toggleWindow(trayBounds) {
    if (isAnimating) return;
    if (isVisible) {
        hideWindow();
    } else {
        showWindow(trayBounds);
    }
}

function showWindow(trayBounds) {
    if (!mainWindow || isVisible || isAnimating) return;

    const bounds = trayBounds || tray.getBounds();
    const windowBounds = mainWindow.getBounds();
    const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
    const workArea = display.workArea;

    let x = Math.round(bounds.x + bounds.width / 2 - windowBounds.width / 2);
    let y = Math.round(bounds.y - windowBounds.height);

    if (x + windowBounds.width > workArea.x + workArea.width) {
        x = workArea.x + workArea.width - windowBounds.width;
    }
    if (x < workArea.x) x = workArea.x;
    if (y < workArea.y) y = bounds.y + bounds.height;

    mainWindow.setPosition(x, y, false);
    mainWindow.setOpacity(0);
    mainWindow.show();
    mainWindow.focus();
    isVisible = true;
    isAnimating = true;

    // Fade in
    let step = 0;
    const interval = setInterval(() => {
        step++;
        const opacity = step / FADE_STEPS;
        mainWindow.setOpacity(opacity);
        if (step >= FADE_STEPS) {
            clearInterval(interval);
            mainWindow.setOpacity(1);
            isAnimating = false;
        }
    }, FADE_DURATION / FADE_STEPS);
}

function hideWindow() {
    if (!mainWindow || !isVisible || isAnimating) return;

    isAnimating = true;
    isVisible = false;

    // Fade out
    let step = FADE_STEPS;
    const interval = setInterval(() => {
        step--;
        const opacity = step / FADE_STEPS;
        mainWindow.setOpacity(opacity);
        if (step <= 0) {
            clearInterval(interval);
            mainWindow.setOpacity(0);
            mainWindow.hide();
            isAnimating = false;
        }
    }, FADE_DURATION / FADE_STEPS);
}

nativeTheme.on('updated', () => {
    if (currentTheme === 'system') applyTheme();
});

// Settings window
function openSettings() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 360,
        height: 280,
        resizable: false,
        minimizable: false,
        maximizable: false,
        alwaysOnTop: true,
        frame: false,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    settingsWindow.loadFile('settings.html');

    settingsWindow.once('ready-to-show', () => {
        settingsWindow.show();
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

// IPC handlers for settings
ipcMain.handle('get-settings', () => {
    return {
        startWithWindows: startWithWindows
    };
});

ipcMain.handle('save-settings', (event, settings) => {
    startWithWindows = settings.startWithWindows;
    saveSettings();
    applyStartupSetting();
    return true;
});

app.whenReady().then(() => {
    loadSettings();
    applyStartupSetting();
    createWindow();
    createTray();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => { });
app.on('before-quit', () => { app.isQuitting = true; });
