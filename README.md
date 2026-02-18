# HASTy - Home Assistant System Tray Dashboard

A premium, lightweight system tray application that displays your Home Assistant dashboard in a sleek, customizable popup window.

![HASTy v1.0.1](https://img.shields.io/badge/version-1.0.1-blue.svg)

## Features

- **System Tray Orchestration**: Lives in your system tray for instant, one-click access.
- **Premium UI/UX**: High-fidelity settings menu with custom themes (System, Light, Medium, Dark).
- **Global Hotkeys**: Robust keyboard shortcut support (e.g., `Alt + /`) to toggle the dashboard from anywhere.
- **Smart Accessibility**:
  - **Auto-hide**: Automatically tucks away when you click other windows (optional).
  - **Resizable**: Drag edges to customize your dashboard size with precise content-pixel preservation.
  - **Always on Top**: Stays above other windows for quick glances.
- **Startup Integration**: Option to launch automatically when Windows starts.
- **Zero-Config Landing**: Interactive setup page for your first-time installation.

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

Or run the development environment:

```bash
npm run dev
```

## Configuration

Configuring HASTy is easy—no code editing required:
1. Right-click the HASTy tray icon.
2. Select **Settings**.
3. Point to your Home Assistant URL and set your preferred hotkey and theme.

## Tray Menu (Right-click)

- **Quit**: Exit the application.
- **Reload**: Refresh the dashboard content.
- **---**
- **Settings**: Open the configuration panel.

## License

MIT - by [TheAnomalous](https://github.com/TheAnomalous)
