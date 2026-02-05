# HASysTray - Home Assistant System Tray Dashboard

A lightweight system tray application that displays your Home Assistant dashboard in a phone-sized popup window.

## Features

- **System Tray Integration**: Lives in your system tray, always accessible
- **Phone Form Factor**: 19:6 aspect ratio (~320x1013px) mimics a mobile device
- **One-Click Access**: Left-click the tray icon to toggle the dashboard
- **Auto-Hide**: Window hides when you click outside
- **Always on Top**: Dashboard stays above other windows when open

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

Or double-click `run.bat`

## Configuration

Edit `main.js` to change:
- `TARGET_URL` - Your Home Assistant dashboard URL
- `WINDOW_WIDTH` - Adjust the phone width (height auto-calculated from 19:6 ratio)

## Tray Menu (Right-click)

- **Show Dashboard** - Opens the popup
- **Reload** - Refreshes the embedded page
- **Quit** - Exits the application

## Customization

Place a `icon.png` file (16x16 or 32x32 pixels) in the root folder to use a custom tray icon.
