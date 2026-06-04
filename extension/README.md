# RentScan Chrome Extension 🏠

**Real-time rental listing aggregator for WhatsApp Web — no uploads, no hassle.**

## How It Works

1. You open `web.whatsapp.com` in Chrome (as you normally do)
2. The extension watches for new messages in the background
3. When a rental listing message arrives → automatically extracted and stored
4. Click the 🏠 extension icon to open the side panel and browse listings live

No exports. No uploads. No manual work.

## Install (Takes 2 minutes)

### Step 1: Load the extension in Chrome

1. Open Chrome and go to: `chrome://extensions`
2. Turn on **Developer mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select this folder: `rentscan-extension/`
5. The RentScan 🏠 icon should appear in your Chrome toolbar

### Step 2: Open WhatsApp Web

1. Go to `https://web.whatsapp.com`
2. Scan the QR code if needed (or it'll already be logged in)
3. You'll see a small **"🏠 RentScan Active"** badge in the bottom-right corner of WhatsApp Web

### Step 3: Open the Side Panel

1. Click the **🏠 RentScan** icon in the Chrome toolbar
2. The side panel opens on the right side
3. Browse your rental groups — listings appear **automatically as messages come in!**

## Features

- 🔴 **Live capture**: MutationObserver watches WhatsApp Web DOM in real-time
- 🔔 **Notifications**: Get a Chrome notification when a high-confidence listing arrives
- 🔢 **Badge counter**: Extension icon shows how many new listings since you last opened the panel
- 🌙 **Dark/light mode**: Toggle in the side panel header
- 🔍 **Filters**: Beds, furnished status, lease type, full-text search
- 🔁 **Deduplication**: Re-posts are automatically merged

## Important Notes

- **WhatsApp Web must be open** in a Chrome tab for live capture to work
- The extension only captures messages that arrive **while WhatsApp Web is open**
- All data is stored **locally** in `chrome.storage.local` — never sent anywhere
- If WhatsApp updates their DOM structure, selectors may need updating (rare)

## File Structure

```
rentscan-extension/
├── manifest.json           ← Extension config (MV3)
├── background.js           ← Service worker: storage + notifications
├── content.js              ← WhatsApp Web observer (MutationObserver)
├── sidepanel/
│   ├── panel.html          ← Dashboard UI
│   ├── panel.js            ← Live-updating dashboard logic
│   └── panel.css           ← Compact panel styles
└── shared/
    ├── extractor.js        ← Rental info extractor (ES module, background script)
    ├── extractor-cs.js     ← Rental info extractor (IIFE, content script)
    └── deduplicator.js     ← Fuzzy duplicate detection (ES module)
```

## Privacy

- Zero external requests — no servers, no analytics, no telemetry
- All data stored in `chrome.storage.local` on your device only
- The extension only runs on `web.whatsapp.com`
