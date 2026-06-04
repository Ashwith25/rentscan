# 🏠 RentScan

> Aggregate rental listings from WhatsApp group chats — free, private, and browser-based.

RentScan comes in two flavours:

| | [Chrome Extension](#-chrome-extension) | [Web App](#-web-app) |
|---|---|---|
| **How it works** | Scans WhatsApp Web live, auto-captures listings in real-time | Upload a `.txt` WhatsApp chat export |
| **Setup** | Install extension → open WhatsApp Web | No install — just open the site |
| **Storage** | Local `chrome.storage` (never leaves your browser) | In-memory (cleared on refresh) |
| **Location** | [`/extension`](./extension) | [`/docs`](./docs) |

All processing is 100% client-side. No servers, no APIs, no tracking.

---

## 🔌 Chrome Extension

Automatically captures rental listings as you browse WhatsApp Web group chats.

### Features
- ⚡ Real-time scanning — captures new messages as they arrive
- 📜 History scan — auto-scrolls to load and scan the last 30 days of messages
- 🧠 Smart extraction — price, bedrooms, availability, location, furnished status, lease type, amenities, phone numbers
- 🚫 Sell/marketplace filter — rejects furniture sales, car ads, etc.
- 💬 Multi-currency — supports $, €, £
- 🔁 Deduplication — fuzzy matching prevents re-posts clogging your feed
- 🖥️ Full dashboard — premium dark/light UI with multi-sort, date filters, and contact reveal

### Install (Developer Mode)
1. Download or clone this repo
2. Open `chrome://extensions` → enable **Developer Mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Open [WhatsApp Web](https://web.whatsapp.com) — scanning starts automatically

---

## 🌐 Web App

A standalone browser tool for users who prefer not to install an extension.

### Features
- 📁 Upload one or more WhatsApp `.txt` chat exports
- 🔍 Full-text search + filters (bedrooms, furnished, lease type, price range, date)
- 📊 Stats panel, duplicate detection, dark/light mode
- 🚀 Deploy free on GitHub Pages

### How to export a WhatsApp chat
1. Open the group → tap ⋮ (Android) or group name (iOS)
2. **Export Chat → Without Media**
3. Upload the `.txt` file to RentScan

### Run locally
```bash
cd docs
python3 -m http.server 8080
# Then open http://localhost:8080
```

### Deploy to GitHub Pages
Go to **Settings → Pages → Source: main branch / `/docs` folder**

---

## 🗂️ Repository Structure

```
rentscan/
├── extension/          # Chrome Extension (MV3)
│   ├── manifest.json
│   ├── content.js      # WhatsApp Web scanner + DOM extractor
│   ├── background.js   # Service worker — storage & deduplication
│   ├── shared/
│   │   ├── extractor-cs.js   # Listing extractor (content script edition)
│   │   ├── extractor.js      # Listing extractor (ES module edition)
│   │   ├── deduplicator.js   # Fuzzy duplicate detection
│   │   └── parser.js         # WhatsApp .txt format parser
│   ├── sidepanel/      # Extension side panel UI
│   └── dashboard/      # Full-page dashboard (opens in new tab)
│
└── docs/                # Standalone web app (GitHub Pages)
    ├── index.html
    ├── style.css
    ├── app.js
    ├── extractor.js
    ├── deduplicator.js
    └── parser.js
```

---

## License

MIT — use freely, attribution appreciated.
