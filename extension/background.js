/**
 * background.js — Service Worker
 * Handles storage management, deduplication, badge updates, notifications
 * NOTE: Service workers are ephemeral — NO global state. Use chrome.storage for everything.
 */

import { deduplicate } from './shared/deduplicator.js';
import { extractListing, extractPhoneNumbers, extractSpoc } from './shared/extractor.js';

// ─── Gemini Queue State ──────────────────────────────────────────────
let batchQueue = [];
let batchTimeout = null;
let activeResolvers = [];

// ─── On Install ─────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  // Open side panel on action click
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Initialize storage
  const { listings } = await chrome.storage.local.get('listings');
  if (!listings) {
    await chrome.storage.local.set({ listings: [], lastSeen: 0, totalCaptured: 0 });
  }
  console.log('[RentScan] Extension installed/updated.');
});

// ─── Message Handler ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_AND_ADD') {
    queueMessageForExtraction(message.msg, sendResponse);
    return true;
  }

  if (message.type === 'NEW_LISTING') {
    (async () => {
      await addListing(message.listing);
      sendResponse({ ok: true });
    })();
    return true; // Keep channel open for async
  }

  if (message.type === 'CLEAR_LISTINGS') {
    (async () => {
      // Clear listings AND scannedGroups so re-opening a group triggers a fresh scan
      await chrome.storage.local.set({ listings: [], lastSeen: 0, totalCaptured: 0, scannedGroups: {} });
      await chrome.action.setBadgeText({ text: '' });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'GET_STATUS') {
    (async () => {
      const data = await chrome.storage.local.get(['listings', 'totalCaptured', 'lastSeen']);
      sendResponse(data);
    })();
    return true;
  }
});

// ─── 30-Day Pruning ──────────────────────────────────────────────────
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function pruneOldListings(listings) {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  return listings.filter(l => {
    const ts = l.date ? new Date(l.date).getTime() : 0;
    return ts >= cutoff;
  });
}

// ─── Add Listing ─────────────────────────────────────────────────────
async function addListing(newListing) {
  const { listings = [], totalCaptured = 0, lastSeen = 0 } = await chrome.storage.local.get(['listings', 'totalCaptured', 'lastSeen']);

  // Dedup against existing + new, then prune anything older than 30 days
  const combined = [...listings, newListing];
  const deduped = deduplicate(combined);
  const pruned = pruneOldListings(deduped);

  // Did we actually add something new (not a dup of existing)?
  const isActuallyNew = pruned.length > listings.length;

  await chrome.storage.local.set({
    listings: pruned,
    totalCaptured: totalCaptured + 1,
    lastUpdated: Date.now(),
  });

  if (isActuallyNew) {
    // Update badge
    const unseenCount = pruned.length - lastSeen;
    if (unseenCount > 0) {
      await chrome.action.setBadgeText({ text: String(unseenCount) });
      await chrome.action.setBadgeBackgroundColor({ color: '#25D366' });
    }
  }
}

// ─── Gemini API / Regex Batch Extractor Queue ─────────────────────────
function queueMessageForExtraction(msg, resolve) {
  batchQueue.push(msg);
  activeResolvers.push(resolve);

  if (batchTimeout) {
    clearTimeout(batchTimeout);
  }

  // Debounce processing to group incoming messages (e.g. from history scan)
  batchTimeout = setTimeout(processBatchQueue, 600);
}

async function runLocalRegexExtraction(msg) {
  try {
    const dateObj = new Date(msg.date);
    const listing = extractListing({ ...msg, date: dateObj });
    if (listing) {
      listing.date = dateObj.toISOString();
      await addListing(listing);
      return true;
    }
  } catch (e) {
    console.error('[RentScan] Local regex extraction failed for message:', e);
  }
  return false;
}

async function processBatchQueue() {
  const queueToProcess = [...batchQueue];
  const resolversToProcess = [...activeResolvers];
  batchQueue = [];
  activeResolvers = [];
  batchTimeout = null;

  if (queueToProcess.length === 0) return;

  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');

  if (geminiApiKey) {
    console.log(`[RentScan] Gemini API Key configured. Attempting Gemini AI extraction for ${queueToProcess.length} messages...`);
    
    // Chunk size increased to 50 to minimize total API calls
    const CHUNK_SIZE = 50;
    for (let i = 0; i < queueToProcess.length; i += CHUNK_SIZE) {
      const chunk = queueToProcess.slice(i, i + CHUNK_SIZE);
      
      // Delay subsequent chunk requests by 13s to stay under the 5 RPM free tier limit
      if (i > 0) {
        console.log(`[RentScan] Rate limit safety: waiting 13s before calling Gemini API for the next chunk...`);
        await new Promise(r => setTimeout(r, 13000));
      }

      try {
        await extractChunkWithGemini(chunk, geminiApiKey);
      } catch (err) {
        console.error(`[RentScan] Gemini API call failed for chunk (${i} to ${i + chunk.length}), falling back to local regex:`, err);
        let fallbackSuccessCount = 0;
        for (const msg of chunk) {
          const success = await runLocalRegexExtraction(msg);
          if (success) fallbackSuccessCount++;
        }
        console.log(`[RentScan] Fallback completed for chunk. Extracted ${fallbackSuccessCount} listings using local regex.`);
      }
    }
    
    resolversToProcess.forEach(resolve => resolve({ ok: true }));
    return;
  }

  // No API key configured: Fallback to local regex extractor for all
  console.log(`[RentScan] No Gemini API Key configured. Using local regex parser for ${queueToProcess.length} messages.`);
  let localExtractedCount = 0;
  for (const msg of queueToProcess) {
    const success = await runLocalRegexExtraction(msg);
    if (success) localExtractedCount++;
  }
  console.log(`[RentScan] Local regex parsing completed. Extracted ${localExtractedCount} listings from ${queueToProcess.length} messages.`);

  resolversToProcess.forEach(resolve => resolve({ ok: true }));
}

async function extractChunkWithGemini(chunk, apiKey) {
  console.log(`[RentScan] Calling Gemini API for a chunk of ${chunk.length} messages...`);
  const prompt = `Analyze the following WhatsApp messages and extract rental listing details for each one.
Ignore any messages that are clearly NOT rental listings (e.g. furniture sales, moving sales, electronics, parking-spot-only, chatter).

Messages to parse:
${chunk.map((msg, idx) => `[${idx}]: "${msg.message.replace(/"/g, '\\"')}"`).join('\n\n')}`;

  const schema = {
    "type": "ARRAY",
    "description": "Array of extracted rental listing results matching the input messages index-by-index",
    "items": {
      "type": "OBJECT",
      "properties": {
        "index": { "type": "INTEGER", "description": "The index of the message in the input list (0-based)" },
        "isRental": { "type": "BOOLEAN", "description": "True if this message represents a property/room/sublet for rent, false otherwise" },
        "price": { "type": "INTEGER", "description": "Monthly rent price (as a number), or null if not mentioned" },
        "bedrooms": { "type": "INTEGER", "description": "Number of bedrooms, or null (0 for Studio)" },
        "bathrooms": { "type": "NUMBER", "description": "Number of bathrooms (can be half e.g. 1.5, 2.5), or null if not mentioned" },
        "location": { "type": "STRING", "description": "Specific area, neighborhood, or city name, or null" },
        "furnished": { "type": "STRING", "enum": ["fully furnished", "semi-furnished", "unfurnished"], "description": "Furnishing state, or null" },
        "leaseType": { "type": "STRING", "enum": ["short-term", "long-term"], "description": "Short-term (sublets, summer subleases, temp) or long-term lease, or null" },
        "amenities": {
          "type": "ARRAY",
          "items": { "type": "STRING" },
          "description": "List of amenities (e.g. parking, wifi, air conditioning, gym, pool, laundry, dishwasher, balcony, security, pet friendly)"
        },
        "propertyType": { "type": "STRING", "description": "Property type, e.g. Apartment, Studio, House, Room, Condo, Townhouse" },
        "spocName": { "type": "STRING", "description": "Name of the SPOC (Single Point of Contact) if explicitly mentioned, or null" },
        "phoneNumbers": {
          "type": "ARRAY",
          "items": { "type": "STRING" },
          "description": "Phone numbers mentioned in the message text"
        }
      },
      "required": ["index", "isRental"]
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errorText}`);
  }

  const json = await response.json();
  const textResponse = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) {
    throw new Error('Empty response from Gemini API');
  }

  console.log(`[RentScan] Gemini API call successful. Parsing response...`);
  const results = JSON.parse(textResponse);
  let rentalFoundCount = 0;
  for (const res of results) {
    if (res.isRental) {
      const msg = chunk[res.index];
      if (!msg) continue;

      const listing = {
        id: generateId(msg.sender, msg.message, msg.date),
        sender: msg.sender,
        group: msg.group,
        date: msg.date,
        rawMessage: msg.message,
        confidence: 95,
        price: res.price,
        bedrooms: res.bedrooms,
        bathrooms: res.bathrooms,
        location: res.location,
        furnished: res.furnished,
        leaseType: res.leaseType,
        amenities: res.amenities || [],
        propertyType: res.propertyType || 'Apartment',
        contacts: {
          phoneNumbers: res.phoneNumbers?.length ? res.phoneNumbers : extractPhoneNumbers(msg.message),
          spocName: res.spocName || extractSpoc(msg.message)
        },
        isDuplicate: false,
        duplicateCount: 0
      };

      console.log(`[RentScan] Extracted listing using Gemini: ${listing.bedrooms || 0} Bed / ${listing.bathrooms || 0} Bath, Price: $${listing.price || 'TBD'}, Location: "${listing.location || 'Unknown'}"`);
      await addListing(listing);
      rentalFoundCount++;
    }
  }
  console.log(`[RentScan] Chunk processing complete. Found ${rentalFoundCount} rental listings out of ${chunk.length} messages.`);
}

function generateId(sender, message, dateStr) {
  const str = `${sender}::${message.slice(0, 50)}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return `listing_${Math.abs(hash)}_${new Date(dateStr).getTime()}`;
}
