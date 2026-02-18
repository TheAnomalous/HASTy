const { app, BrowserWindow, Tray, Menu, screen, nativeImage, nativeTheme, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

// Default configuration
const DEFAULT_URL = 'http://homeassistant.local:8123';

// Default phone-like dimensions
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 600;

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
let currentTheme = 'medium';
let startWithWindows = true;
let dashboardUrl = DEFAULT_URL;
let allowResize = false;
let autoHide = true;
let windowWidth = DEFAULT_WIDTH;
let windowHeight = DEFAULT_HEIGHT;
let hotkey = ''; // e.g., 'CommandOrControl+Shift+H'

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
            currentTheme = data.theme || 'medium';
            startWithWindows = data.startWithWindows !== undefined ? data.startWithWindows : true;
            dashboardUrl = data.dashboardUrl || DEFAULT_URL;
            allowResize = data.allowResize || false;
            windowWidth = data.windowWidth || DEFAULT_WIDTH;
            windowHeight = data.windowHeight || DEFAULT_HEIGHT;
            hotkey = data.hotkey || '';
            autoHide = data.autoHide !== undefined ? data.autoHide : true;
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify({
            theme: currentTheme,
            startWithWindows: startWithWindows,
            dashboardUrl: dashboardUrl,
            allowResize: allowResize,
            windowWidth: windowWidth,
            windowHeight: windowHeight,
            hotkey: hotkey,
            autoHide: autoHide
        }), 'utf8');
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

function registerHotkey(newHotkey) {
    // Unregister existing hotkey
    globalShortcut.unregisterAll();

    if (newHotkey && newHotkey.trim()) {
        try {
            const success = globalShortcut.register(newHotkey, () => {
                if (tray) {
                    toggleWindow(tray.getBounds());
                }
            });
            if (!success) {
                console.error('[Hotkey] Registration failed for:', newHotkey);
                return false;
            }
            return true;
        } catch (e) {
            console.error('[Hotkey] Invalid hotkey error:', e);
            return false;
        }
    }
    return true;
}

function applyStartupSetting() {
    const settings = {
        openAtLogin: startWithWindows,
        path: process.execPath
    };

    // In dev mode, electron.exe needs the app directory as an argument
    // In packaged builds, the exe already knows its app path
    if (!app.isPackaged) {
        settings.args = [path.resolve(__dirname)];
    }

    app.setLoginItemSettings(settings);
}

function getEffectiveTheme() {
    if (currentTheme === 'system') {
        return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    }
    return currentTheme;
}

function applyTheme() {
    const effectiveTheme = getEffectiveTheme();
    const bgColor = THEME_BACKGROUNDS[effectiveTheme] || THEME_BACKGROUNDS.dark;

    if (mainWindow) {
        mainWindow.setBackgroundColor(bgColor);
        const css = THEME_CSS[effectiveTheme];
        if (css) {
            mainWindow.webContents.insertCSS(css).catch(() => { });
        }

        // Hide scrollbar but keep scroll functionality
        mainWindow.webContents.insertCSS(`
            *::-webkit-scrollbar { display: none; }
        `).catch(() => { });
    }

    if (settingsWindow) {
        settingsWindow.webContents.send('theme-updated', effectiveTheme);
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

    console.log(`[Window] Creating with size: ${windowWidth}x${windowHeight} (Resizable: ${allowResize})`);
    mainWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        useContentSize: true,
        show: false,
        frame: false,
        resizable: allowResize,
        skipTaskbar: true,
        alwaysOnTop: true,
        transparent: false,
        backgroundColor: bgColor,
        minWidth: 280,
        minHeight: 400,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    // Save window size when resized with debounce and jitter guard
    let resizeTimeout;
    mainWindow.on('resize', () => {
        if (allowResize && !mainWindow.isMinimized()) {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const [w, h] = mainWindow.getContentSize();

                // Jitter guard: Only save if changed by more than 2 pixels
                // This prevents the "2px creep" on Windows frameless windows
                const widthDiff = Math.abs(w - windowWidth);
                const heightDiff = Math.abs(h - windowHeight);

                if (widthDiff > 2 || heightDiff > 2) {
                    console.log(`[Size] Significant change detected: ${windowWidth}x${windowHeight} -> ${w}x${h}`);
                    windowWidth = w;
                    windowHeight = h;
                    saveSettings();

                    // Notify settings window if open so it can update its display
                    if (settingsWindow) {
                        settingsWindow.webContents.send('window-resized', { width: w, height: h });
                    }
                } else if (widthDiff > 0 || heightDiff > 0) {
                    console.log(`[Size] Ignoring minor jitter: ${w}x${h} (Current: ${windowWidth}x${windowHeight})`);
                }
            }, 500); // 500ms debounce
        }
    });

    // Show setup page if URL not configured, otherwise load dashboard
    if (!dashboardUrl || dashboardUrl === DEFAULT_URL) {
        mainWindow.loadFile('setup.html');
    } else {
        mainWindow.loadURL(dashboardUrl);
    }

    mainWindow.webContents.on('did-finish-load', () => {
        // Only apply theme to actual dashboard, not setup page
        if (dashboardUrl && dashboardUrl !== DEFAULT_URL) {
            applyTheme();
        }


    });

    // Escape to hide
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape' && input.type === 'keyDown') {
            hideWindow();
        }
    });

    mainWindow.on('blur', () => {
        // Don't hide if autoHide is disabled
        if (!autoHide) return;
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
            label: 'Quit',
            click: () => { app.isQuitting = true; app.quit(); }
        },
        {
            label: 'Reload',
            click: () => { if (mainWindow) mainWindow.webContents.reload(); }
        },
        { type: 'separator' },
        {
            label: 'Settings',
            click: () => openSettings()
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

    // Re-enforce correct content size to prevent OS-level shifting on show
    mainWindow.setContentSize(windowWidth, windowHeight);

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
        width: 500,
        height: 450, // Initial, will adjust to content
        resizable: false,
        minimizable: false,
        maximizable: false,
        alwaysOnTop: true,
        frame: false,
        show: false,
        useContentSize: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    settingsWindow.loadFile('settings.html');

    // Window will be resized by settings.html after it loads and determines content

    settingsWindow.on('blur', () => {
        // If autoHide is enabled, hide the main window when settings also loses focus
        // We wait a tick to see if focus went back to the main window
        if (autoHide) {
            setTimeout(() => {
                if (mainWindow && !mainWindow.isFocused() && (!settingsWindow || !settingsWindow.isFocused())) {
                    hideWindow();
                }
            }, 100);
        }
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

// IPC handlers for settings
ipcMain.handle('get-settings', () => {
    return {
        dashboardUrl: dashboardUrl,
        theme: currentTheme,
        effectiveTheme: getEffectiveTheme(),
        startWithWindows: startWithWindows,
        allowResize: allowResize,
        windowWidth: windowWidth,
        windowHeight: windowHeight,
        defaultWidth: DEFAULT_WIDTH,
        defaultHeight: DEFAULT_HEIGHT,
        hotkey: hotkey,
        autoHide: autoHide
    };
});

ipcMain.handle('save-settings', (event, settings) => {
    const urlChanged = settings.dashboardUrl && settings.dashboardUrl !== dashboardUrl;
    const themeChanged = settings.theme && settings.theme !== currentTheme;
    const resizeChanged = settings.allowResize !== undefined && settings.allowResize !== allowResize;

    if (settings.dashboardUrl) {
        dashboardUrl = settings.dashboardUrl;
    }
    if (settings.theme) {
        currentTheme = settings.theme;
    }
    if (settings.startWithWindows !== undefined) {
        startWithWindows = settings.startWithWindows;
    }
    if (settings.allowResize !== undefined) {
        allowResize = settings.allowResize;
    }
    if (settings.autoHide !== undefined) {
        autoHide = settings.autoHide;
    }

    saveSettings();
    applyStartupSetting();

    // Apply theme if changed
    if (themeChanged) {
        applyTheme();
    }

    // Reload dashboard if URL changed
    if (urlChanged && mainWindow) {
        mainWindow.loadURL(dashboardUrl);
    }

    // Update resizable state
    if (resizeChanged && mainWindow) {
        mainWindow.setResizable(allowResize);

        // Re-enforce clean size (turning on resizable on Windows adds frames)
        mainWindow.setContentSize(windowWidth, windowHeight);
    }

    return true;
});

// Restore default window size
ipcMain.handle('restore-window-defaults', () => {
    windowWidth = DEFAULT_WIDTH;
    windowHeight = DEFAULT_HEIGHT;
    saveSettings();
    if (mainWindow) {
        mainWindow.setContentSize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    }
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
});

// Resize settings window to fit content and show it
ipcMain.handle('resize-settings-window', async (event, andShow = false) => {
    if (!settingsWindow) return;
    try {
        const height = await settingsWindow.webContents.executeJavaScript(
            'document.body.scrollHeight'
        );
        settingsWindow.setContentSize(500, Math.min(height + 20, 600));
        if (andShow && !settingsWindow.isVisible()) {
            settingsWindow.show();
        }
    } catch (e) { }
});

// Real-time toggle for resize mode
ipcMain.handle('set-allow-resize', (event, enabled) => {
    allowResize = enabled;
    saveSettings();

    if (mainWindow) {
        mainWindow.setResizable(enabled);

        // Remove any leftover resize grip
        mainWindow.webContents.executeJavaScript(`
            const grip = document.querySelector('.ha-systray-resize-grip');
            if (grip) grip.remove();
        `).catch(() => { });
    }
    return true;
});

// Real-time hotkey registration
ipcMain.handle('set-hotkey', (event, newHotkey) => {
    const success = registerHotkey(newHotkey);
    if (success) {
        hotkey = newHotkey;
        saveSettings();
    }
    return success;
});

// Handle open-settings from setup page
ipcMain.on('open-settings', () => {
    openSettings();
});

app.whenReady().then(() => {
    loadSettings();
    applyStartupSetting();
    createWindow();
    createTray();
    registerHotkey(hotkey);

    // Listen for system theme changes
    nativeTheme.on('updated', () => {
        if (currentTheme === 'system') {
            applyTheme();
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => { });
app.on('before-quit', () => {
    globalShortcut.unregisterAll();
    app.isQuitting = true;
});
