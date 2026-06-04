# RentScan 🏠

**Aggregate rental listings from WhatsApp group chat exports — free, private, browser-based.**

## Live Demo

[View on GitHub Pages](#) ← add your URL after deploying

## How It Works

1. **Export** your WhatsApp group chat: Open group → ⋮ → Export Chat → Without Media → saves a `.txt` file
2. **Upload** the `.txt` file to RentScan (multiple groups supported)
3. **Browse** extracted listings with filters for price, bedrooms, furnished status, lease type

All processing happens locally in your browser. No data is ever sent to a server.

## Features

- 📲 Parses all WhatsApp export formats (Android & iOS, 12h/24h)
- 🏠 Extracts: price, bedrooms, availability date, location, furnished status, lease type, amenities
- 🔁 Deduplication — removes re-posts using fuzzy matching
- 🌙 Dark & Light mode toggle
- 🔍 Full-text search + multi-filter
- 📊 Stats bar (listing count, price range, groups, duplicates removed)
- ✨ Demo mode with realistic sample data

## Deployment (GitHub Pages — Free)

```bash
# 1. Create a new GitHub repo
# 2. Push all files in this directory:
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/rentscan.git
git push -u origin main

# 3. Go to repo Settings → Pages → Source: main branch / root
# 4. Your site is live at: https://YOUR_USERNAME.github.io/rentscan/
```

## File Structure

```
whatsapp-rentals/
├── index.html        # App shell + HTML structure
├── style.css         # Design system (dark/light, glassmorphism)
├── app.js            # Orchestrator + UI logic
├── parser.js         # WhatsApp .txt format parser
├── extractor.js      # Rental info extraction (regex + keywords)
├── deduplicator.js   # Fuzzy duplicate detection
├── sample-data.js    # Demo data
└── README.md
```

## How the Extraction Works

The extractor uses regex patterns and keyword dictionaries to identify and parse rental listings:

| Field | Method |
|---|---|
| Price | Regex: `$2,500/month`, `2500 per month`, etc. |
| Bedrooms | Regex: `2 bedroom`, `3BHK`, `2BR`, `studio` |
| Availability | Regex: dates, "available from Jan", "immediately" |
| Location | Pattern: "in [Location]", "at [Location]" |
| Furnished | Keywords: "fully furnished", "semi", "unfurnished" |
| Lease Type | Keywords: "short-term", "permanent", "12-month" |
| Amenities | 19 amenity keywords (parking, WiFi, gym, pool, etc.) |

Messages with a confidence score below 30% are discarded as non-rental messages.

## Privacy

- Zero backend — 100% client-side JavaScript
- Your WhatsApp data never leaves your device
- No cookies, no tracking, no analytics

## License

MIT
