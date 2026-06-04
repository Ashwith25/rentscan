/**
 * content.js — WhatsApp Web Full History Scanner + Real-time Observer
 *
 * Key insight: WhatsApp Web uses VIRTUAL SCROLLING — only ~50 messages are
 * in the DOM at once. To scan history, we must auto-scroll to the top,
 * letting WhatsApp load batches of older messages as we go.
 *
 * Flow when a group is opened:
 *   1. Immediately scan whatever messages are currently in the DOM
 *   2. Start scrolling to the top in batches (loading history)
 *   3. MutationObserver captures each new batch as it renders
 *   4. When scrolled to top (no more loads), switch to real-time watch mode
 *   5. Future new messages are captured as they arrive
 */

// ─── State ───────────────────────────────────────────────────────────
const processedIds  = new Set();   // message IDs already processed
let realtimeObserver = null;       // MutationObserver for new messages
let navObserver = null;            // MutationObserver for group changes
let currentGroupName = '';
let isScanning = false;            // guard: only one scan at a time
let extractorReady = null;         // cached extractor promise

// ─── Invalidation Cleanup ────────────────────────────────────────────
function cleanupOrphanedScript() {
  if (realtimeObserver) {
    try { realtimeObserver.disconnect(); } catch(e) {}
    realtimeObserver = null;
  }
  if (navObserver) {
    try { navObserver.disconnect(); } catch(e) {}
    navObserver = null;
  }
  window.removeEventListener('rentscan-rescan', handleRescanEvent);
  const badge = document.getElementById('rentscan-badge');
  if (badge) {
    try { badge.remove(); } catch(e) {}
  }
  console.warn('[RentScan] Extension context invalidated. Cleaned up orphaned content script.');
}

function checkContext() {
  if (!chrome.runtime?.id) {
    cleanupOrphanedScript();
    return false;
  }
  return true;
}

// ─── Status Badge ────────────────────────────────────────────────────
function setBadgeState(state, text) {
  let badge = document.getElementById('rentscan-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'rentscan-badge';
    badge.style.cssText = `
      position: fixed; bottom: 20px; right: 20px;
      background: linear-gradient(135deg, #25D366, #128C7E);
      color: white; padding: 8px 14px; border-radius: 999px;
      font-family: -apple-system, sans-serif; font-size: 12px; font-weight: 600;
      box-shadow: 0 4px 16px rgba(37,211,102,0.4); z-index: 99999;
      display: flex; align-items: center; gap: 6px; user-select: none;
      transition: all 0.3s ease;
    `;
    document.body.appendChild(badge);
  }

  const icons = { scanning: '⏳', watching: '👁', idle: '🏠' };
  const colors = {
    scanning: 'linear-gradient(135deg, #f59e0b, #d97706)',
    watching: 'linear-gradient(135deg, #25D366, #128C7E)',
    idle:     'linear-gradient(135deg, #475569, #334155)',
  };

  badge.style.background = colors[state] || colors.idle;
  badge.innerHTML = `${icons[state] || '🏠'} <span id="rentscan-status-text">${text}</span>`;
}

function updateBadgeText(text) {
  const el = document.getElementById('rentscan-status-text');
  if (el) el.textContent = text;
}

// Extractor is now pre-loaded via manifest content_scripts (extractor-cs.js)

// ─── DOM Helpers ─────────────────────────────────────────────────────
function getCurrentGroupName() {
  const selectors = [
    '[data-testid="conversation-info-header-chat-title"]',
    '[data-testid="conversation-header"] span[dir="auto"]',
    '#main header span[title]',
    '#main header span[dir="auto"]',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent.trim()) return el.textContent.trim();
  }
  return document.title.replace(/WhatsApp\s*[–-]?\s*/i, '').trim() || 'WhatsApp Group';
}

function getScrollContainer() {
  // The scrollable message pane in WhatsApp Web
  return (
    document.querySelector('#main [data-testid="conversation-panel-messages"]') ||
    document.querySelector('#main .copyable-area') ||
    document.querySelector('#main [role="application"]') ||
    document.getElementById('main')
  );
}

function extractMessageText(node) {
  // Helper to get text safely (using textContent if innerText is empty or detached)
  const getSafeText = (el) => el ? (el.innerText?.trim() || el.textContent?.trim() || '') : '';

  // Preferred: copyable balloon text container directly (gets all child text/emojis/nested spans)
  const balloon = node.querySelector('[data-testid="balloon-text-copyable"]');
  const balloonText = getSafeText(balloon);
  if (balloonText) return balloonText;

  // data-pre-plain-text is set on .copyable-text wrappers
  const copyable = node.querySelector('.copyable-text');
  if (copyable) {
    const inner = copyable.querySelector('span[dir]');
    const copyableText = getSafeText(inner);
    if (copyableText) return copyableText;

    const plainText = getSafeText(copyable);
    if (plainText) return plainText;
  }

  // Fallback: any span text
  for (const span of node.querySelectorAll('span[dir="ltr"],span[dir="rtl"],span[dir="auto"]')) {
    const t = getSafeText(span);
    if (t && t.length > 10) return t;
  }

  // Last resort: text content of node itself
  const nodeText = getSafeText(node);
  if (nodeText && nodeText.length > 10) return nodeText;

  return null;
}

function extractSenderName(node) {
  // data-pre-plain-text format: "[HH:MM, DD/MM/YYYY] Sender Name: "
  const copyable = node.querySelector('.copyable-text[data-pre-plain-text]');
  if (copyable) {
    const raw = copyable.getAttribute('data-pre-plain-text') || '';
    const m = raw.match(/\]\s*(.+?):\s*$/);
    if (m) return m[1].trim();
  }
  const author = node.querySelector('[data-testid="author"]');
  if (author?.textContent.trim()) return author.textContent.trim();
  return 'Unknown';
}

function parseWhatsAppDate(str) {
  if (!str) return null;
  // Clean up and split by comma
  const parts = str.split(',').map(s => s.trim());
  if (parts.length < 2) return null;

  // We have two parts: one is time (contains :), one is date (contains / or - or .)
  let datePart = '';
  let timePart = '';
  if (parts[0].includes(':')) {
    timePart = parts[0];
    datePart = parts[1];
  } else {
    datePart = parts[0];
    timePart = parts[1];
  }

  // Parse date components
  const dateSplit = datePart.split(/[\/\-\.]/).map(s => parseInt(s.trim(), 10));
  if (dateSplit.length !== 3) return null;

  // Parse time components
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  const timeMatch = timePart.match(/(\d+):(\d+)(?::(\d+))?\s*(AM|PM)?/i);
  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10);
    minutes = parseInt(timeMatch[2], 10);
    if (timeMatch[3]) seconds = parseInt(timeMatch[3], 10);
    const ampm = timeMatch[4];
    if (ampm) {
      if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
      if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
    }
  }

  let day = 1;
  let month = 0;
  let year = new Date().getFullYear();

  if (dateSplit[0] > 1000) {
    year = dateSplit[0];
    month = dateSplit[1] - 1;
    day = dateSplit[2];
  } else {
    // Check ambiguous date formats
    const native = new Date(str);
    if (!isNaN(native.getTime())) return native;

    if (dateSplit[0] > 12) {
      day = dateSplit[0];
      month = dateSplit[1] - 1;
      year = dateSplit[2];
    } else if (dateSplit[1] > 12) {
      month = dateSplit[0] - 1;
      day = dateSplit[1];
      year = dateSplit[2];
    } else {
      month = dateSplit[0] - 1;
      day = dateSplit[1];
      year = dateSplit[2];
    }
  }

  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }

  const d = new Date(year, month, day, hours, minutes, seconds);
  return isNaN(d.getTime()) ? null : d;
}

function extractTimestamp(node) {
  // Try data-pre-plain-text: "[HH:MM, DD/MM/YYYY] ..."
  const copyable = node.querySelector('.copyable-text[data-pre-plain-text]');
  if (copyable) {
    const raw = copyable.getAttribute('data-pre-plain-text') || '';
    const m = raw.match(/\[([^\]]+)\]/);
    if (m) {
      const parsed = parseWhatsAppDate(m[1]);
      if (parsed) return parsed;
    }
  }
  // Fallback: msg-meta time
  const timeEl = node.querySelector('[data-testid="msg-meta"] span[dir="auto"]');
  if (timeEl) {
    const d = parseWhatsAppDate(`${new Date().toLocaleDateString()}, ${timeEl.textContent.trim()}`);
    if (d) return d;
  }
  return new Date();
}

function getEarliestRenderedDate() {
  const nodes = document.querySelectorAll('[data-testid="msg-container"],[data-id]');
  let earliest = null;
  nodes.forEach(node => {
    const d = extractTimestamp(node);
    if (d && !isNaN(d.getTime())) {
      if (!earliest || d < earliest) {
        earliest = d;
      }
    }
  });
  return earliest;
}

// ─── Process a Single Message Node ───────────────────────────────────
async function processMessageNode(node, retryOnEmpty = true) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

  const msgId =
    node.getAttribute('data-id') ||
    node.querySelector('[data-id]')?.getAttribute('data-id') ||
    null;

  if (msgId && processedIds.has(msgId)) return;

  const text = extractMessageText(node);
  if (!text || text.length < 10) {
    // If the node is still attached but does not have text loaded, retry once in 80ms
    if (retryOnEmpty && node.isConnected) {
      setTimeout(() => {
        if (!checkContext()) return;
        processMessageNode(node, false);
      }, 80);
    }
    return;
  }

  // Text extracted successfully! Cache the ID to prevent double processing
  if (msgId) {
    processedIds.add(msgId);
  }

  const group = getCurrentGroupName() || currentGroupName;
  const sender = extractSenderName(node);
  const dateObj = extractTimestamp(node);
  const dateStr = (dateObj instanceof Date ? dateObj : new Date()).toISOString();

  if (!checkContext()) return;
  chrome.runtime.sendMessage({
    type: 'EXTRACT_AND_ADD',
    msg: { sender, message: text, group, date: dateStr }
  }, (res) => {
    if (!checkContext()) return;
    if (chrome.runtime.lastError) return; // SW asleep, will retry on next wake
    if (res?.ok) {
      chrome.storage.local.get('listings', ({ listings = [] }) => {
        if (!checkContext()) return;
        updateBadgeText(`${listings.length} listing${listings.length !== 1 ? 's' : ''} found`);
      });
    }
  });
}

// ─── Scan currently-rendered messages ────────────────────────────────
function snapCurrentMessages() {
  const nodes = document.querySelectorAll('[data-testid="msg-container"],[data-id]');
  nodes.forEach(n => processMessageNode(n));
  return nodes.length;
}

// ─── Full History Scan via auto-scroll ───────────────────────────────
/**
 * Scrolls to the very top of the conversation, letting WhatsApp load
 * batches of older messages along the way. Captures each batch.
 *
 * WhatsApp Web virtualises messages — only ~50 rendered at a time.
 * Auto-scrolling to top triggers WhatsApp to load older batches.
 * We detect completion when scroll position stops changing.
 */
async function scanFullHistory() {
  if (isScanning) return;
  isScanning = true;

  const container = getScrollContainer();
  if (!container) { isScanning = false; return; }

  const groupName = getCurrentGroupName();
  currentGroupName = groupName;

  setBadgeState('scanning', `Scanning history…`);

  // Snap currently visible messages immediately so they are never missed
  snapCurrentMessages();

  if (!checkContext()) return;
  // Check if already in storage for this group (skip full rescan)
  const { scannedGroups = {} } = await chrome.storage.local.get('scannedGroups');
  if (!checkContext()) return;
  if (scannedGroups[groupName]) {
    const finalCount = await getListingCount();
    setBadgeState('watching', `${finalCount} listings · Live`);
    startRealtimeObserver();
    isScanning = false;
    return;
  }

  let prevScrollTop = -1;
  let unchangedRounds = 0;
  const MAX_UNCHANGED = 4;  // stop when scroll position stops changing for 4 checks
  let totalScanned = 0;
  let round = 0;

  // Start real-time observer now so we don't miss messages while scrolling
  startRealtimeObserver();

  while (unchangedRounds < MAX_UNCHANGED) {
    if (!checkContext()) return;
    round++;

    const startScrollHeight = container.scrollHeight;

    // Scroll to absolute top
    container.scrollTop = 0;

    // Wait dynamically for WhatsApp Web to prepend older messages
    let loaded = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 2500) {
      await sleep(150);
      if (!checkContext()) return;
      // Scroll position pushed down or total scroll height increased indicates loaded batch
      if (container.scrollTop > 10 || container.scrollHeight > startScrollHeight) {
        loaded = true;
        break;
      }
    }

    const current = container.scrollTop;

    if (!loaded && Math.abs(current - prevScrollTop) < 5) {
      unchangedRounds++;
    } else {
      unchangedRounds = 0;
      prevScrollTop = current;
    }

    // Capture everything newly rendered
    const count = snapCurrentMessages();
    totalScanned += count;

    // Stop scrolling if we've reached messages older than 30 days (1 month)
    const earliestDate = getEarliestRenderedDate();
    const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    if (earliestDate && (Date.now() - earliestDate.getTime() > ONE_MONTH_MS)) {
      console.log(`[RentScan] Reached messages older than 1 month (${earliestDate.toLocaleDateString()}). Stopping history scan.`);
      break;
    }

    const found = await getListingCount();
    updateBadgeText(`Scanning… ${found} found`);
  }

  if (!checkContext()) return;
  // Mark this group as scanned
  const { scannedGroups: sg = {} } = await chrome.storage.local.get('scannedGroups');
  if (!checkContext()) return;
  sg[groupName] = Date.now();
  await chrome.storage.local.set({ scannedGroups: sg });

  if (!checkContext()) return;
  const finalCount = await getListingCount();
  setBadgeState('watching', `${finalCount} listings · Live`);
  isScanning = false;

  console.log(`[RentScan] Scan complete for "${groupName}": ${finalCount} listings found`);
}

// ─── Real-time Observer for new incoming messages ─────────────────────
function startRealtimeObserver() {
  if (realtimeObserver) realtimeObserver.disconnect();

  const target = getScrollContainer() || document.getElementById('main') || document.body;

  realtimeObserver = new MutationObserver((mutations) => {
    if (!checkContext()) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const candidates = [
          ...(node.matches?.('[data-testid="msg-container"],[data-id]') ? [node] : []),
          ...(node.querySelectorAll?.('[data-testid="msg-container"],[data-id]') || []),
        ];
        candidates.forEach(n => setTimeout(() => {
          if (!checkContext()) return;
          processMessageNode(n, true);
        }, 20));
      }
    }
  });

  realtimeObserver.observe(target, { childList: true, subtree: true });
}

// ─── Watch for navigation (group switches) ───────────────────────────
function watchForGroupSwitch() {
  let lastGroup = '';
  if (navObserver) navObserver.disconnect();

  navObserver = new MutationObserver(() => {
    if (!checkContext()) return;
    const g = getCurrentGroupName();
    if (g && g !== lastGroup) {
      lastGroup = g;
      // New group opened — start fresh scan after short delay
      setTimeout(() => {
        if (!checkContext()) return;
        processedIds.clear(); // allow reprocessing for new group
        scanFullHistory();
      }, 700);
    }
  });

  // Watch the header where the group title lives
  const header = document.querySelector('#main header') ||
                 document.querySelector('[data-testid="conversation-header"]') ||
                 document.getElementById('app');

  if (header) navObserver.observe(header, { childList: true, subtree: true, characterData: true });
}

// ─── Utilities ───────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getListingCount() {
  return new Promise(resolve => {
    if (!checkContext()) { resolve(0); return; }
    chrome.storage.local.get('listings', ({ listings = [] }) => resolve(listings.length));
  });
}

// ─── Initialize ──────────────────────────────────────────────────────
function init() {
  if (!checkContext()) return;
  setBadgeState('scanning', 'Starting…');
  watchForGroupSwitch();
  scanFullHistory();  // This also starts the realtime observer internally
}

// Listen for rescan trigger from panel
function handleRescanEvent() {
  if (!checkContext()) return;
  processedIds.clear();
  isScanning = false;
  chrome.storage.local.set({ scannedGroups: {} }).then(() => {
    if (!checkContext()) return;
    scanFullHistory();
  });
}
window.addEventListener('rentscan-rescan', handleRescanEvent);

// Listen for ping messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!checkContext()) return;
  if (message.type === 'PING') {
    sendResponse({ ok: true });
  }
});

// Wait for WhatsApp Web SPA to fully load
const waitForApp = setInterval(() => {
  const appReady =
    document.getElementById('main') ||
    document.querySelector('[data-testid="default-user"]') ||
    document.querySelector('[data-testid="conversation-panel-messages"]');

  if (appReady) {
    clearInterval(waitForApp);
    setTimeout(init, 1800);
  }
}, 600);
