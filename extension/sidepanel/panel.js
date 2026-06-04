/**
 * panel.js — Side Panel Dashboard Logic
 * Reads from chrome.storage, reacts to live changes, renders listing cards
 */

'use strict';

// ─── State ───────────────────────────────────────────────────────────
let allListings = [];
let filteredListings = [];
let currentTheme = 'dark';
let currentSort = 'date-desc';
let filters = { search: '', beds: '', furnished: '', lease: '' };
let seenCount = 0; // how many listings were seen when panel was last opened
let toastTimer = null;

// ─── DOM refs ────────────────────────────────────────────────────────
const listingsScroll = document.getElementById('listings-scroll');
const emptyState     = document.getElementById('empty-state');
const emptyMsg       = document.getElementById('empty-message');
const statCount      = document.getElementById('stat-count');
const statPrice      = document.getElementById('stat-price');
const statDupes      = document.getElementById('stat-dupes');
const statusDot      = document.getElementById('status-dot');
const themeBtn       = document.getElementById('theme-toggle');
const clearBtn       = document.getElementById('clear-btn');
const rescanBtn      = document.getElementById('rescan-btn');
const settingsBtn    = document.getElementById('settings-btn');
const dashboardBtn   = document.getElementById('dashboard-btn');
const searchInput    = document.getElementById('search-input');
const sortSelect     = document.getElementById('sort-select');
const chipBeds       = document.getElementById('chip-beds');
const chipFurnished  = document.getElementById('chip-furnished');
const chipLease      = document.getElementById('chip-lease');
const toast          = document.getElementById('toast');
const scanBar        = document.getElementById('scan-bar');
const scanText       = document.getElementById('scan-text');

// Settings Drawer DOM refs
const settingsDrawer   = document.getElementById('settings-drawer');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const saveSettingsBtn  = document.getElementById('save-settings-btn');
const geminiKeyInput   = document.getElementById('gemini-api-key');

// ─── Theme ───────────────────────────────────────────────────────────
function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
  chrome.storage.local.set({ theme });
}

themeBtn.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'));

dashboardBtn?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
});

// ─── Load Data ────────────────────────────────────────────────────────
async function loadData() {
  const data = await chrome.storage.local.get(['listings', 'theme', 'lastSeen', 'totalCaptured', 'geminiApiKey']);
  currentTheme = data.theme || 'dark';
  applyTheme(currentTheme);

  if (data.geminiApiKey) {
    geminiKeyInput.value = data.geminiApiKey;
  }

  allListings = (data.listings || []).map(l => ({
    ...l,
    date: new Date(l.date),
  }));

  seenCount = data.lastSeen || 0;
  updateStats();
  applyFiltersAndSort();

  // Mark current count as seen — badge cleared by service worker
  await chrome.storage.local.set({ lastSeen: allListings.length });
}

// ─── Live Updates via storage.onChanged ──────────────────────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.listings) {
    allListings = (changes.listings.newValue || []).map(l => ({
      ...l,
      date: new Date(l.date),
    }));

    // Mark new listings
    const newCount = allListings.length - seenCount;

    updateStats(newCount);
    applyFiltersAndSort(newCount > 0);

    // Update lastSeen
    seenCount = allListings.length;
    chrome.storage.local.set({ lastSeen: seenCount });
    // Badge clearing is handled by the background service worker

    if (newCount > 0) {
      showToast(`🏠 ${newCount} new listing${newCount > 1 ? 's' : ''} found!`, 'success');
    }
  }
});

// ─── Detect if WhatsApp Web is open ──────────────────────────────────
function checkWhatsAppStatus() {
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    const active = tabs && tabs.length > 0;
    statusDot.classList.toggle('active', active);
    statusDot.title = active
      ? `Watching ${tabs.length} WhatsApp Web tab${tabs.length > 1 ? 's' : ''}`
      : 'WhatsApp Web not open';
    emptyMsg.textContent = active
      ? 'Watching WhatsApp Web for rental messages…'
      : 'Open WhatsApp Web to start capturing listings automatically.';
  });
}

// ─── Filters & Sort ──────────────────────────────────────────────────
searchInput.addEventListener('input', e => { filters.search = e.target.value.toLowerCase(); applyFiltersAndSort(); });
sortSelect.addEventListener('change', e => { currentSort = e.target.value; applyFiltersAndSort(); });
chipBeds.addEventListener('change', e => { filters.beds = e.target.value; updateChipStyle(chipBeds); applyFiltersAndSort(); });
chipFurnished.addEventListener('change', e => { filters.furnished = e.target.value; updateChipStyle(chipFurnished); applyFiltersAndSort(); });
chipLease.addEventListener('change', e => { filters.lease = e.target.value; updateChipStyle(chipLease); applyFiltersAndSort(); });

function updateChipStyle(el) {
  el.classList.toggle('active', el.value !== '');
}

function applyFiltersAndSort(animateNew = false) {
  let filtered = [...allListings];

  if (filters.search) {
    filtered = filtered.filter(l =>
      l.rawMessage?.toLowerCase().includes(filters.search) ||
      (l.location || '').toLowerCase().includes(filters.search) ||
      l.sender?.toLowerCase().includes(filters.search)
    );
  }

  if (filters.beds !== '') {
    const n = parseInt(filters.beds);
    if (filters.beds === '0') filtered = filtered.filter(l => l.bedrooms === 0);
    else if (filters.beds === '4+') filtered = filtered.filter(l => l.bedrooms >= 4);
    else filtered = filtered.filter(l => l.bedrooms === n);
  }

  if (filters.furnished) filtered = filtered.filter(l => l.furnished === filters.furnished);
  if (filters.lease)     filtered = filtered.filter(l => l.leaseType === filters.lease);

  switch (currentSort) {
    case 'date-desc':    filtered.sort((a, b) => b.date - a.date); break;
    case 'price-asc':    filtered.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)); break;
    case 'price-desc':   filtered.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity)); break;
    case 'confidence':   filtered.sort((a, b) => b.confidence - a.confidence); break;
  }

  filteredListings = filtered;
  renderListings(animateNew);
}

// ─── Stats ────────────────────────────────────────────────────────────
function updateStats(newCount = 0) {
  statCount.textContent = allListings.length;

  const withPrice = allListings.filter(l => l.price);
  if (withPrice.length) {
    const min = Math.min(...withPrice.map(l => l.price));
    const max = Math.max(...withPrice.map(l => l.price));
    statPrice.textContent = min === max ? `$${min.toLocaleString()}` : `$${min.toLocaleString()}–$${max.toLocaleString()}`;
  } else {
    statPrice.textContent = '—';
  }

  const dupes = allListings.reduce((s, l) => s + (l.duplicateCount || 0), 0);
  statDupes.textContent = dupes;
}

// ─── Render ───────────────────────────────────────────────────────────
function renderListings(highlightNew = false) {
  const isEmpty = filteredListings.length === 0;
  emptyState.classList.toggle('hidden', !isEmpty || allListings.length > 0 && filteredListings.length === 0);
  listingsScroll.classList.toggle('hidden', isEmpty);

  if (isEmpty) {
    if (allListings.length > 0) {
      emptyState.classList.remove('hidden');
      emptyMsg.textContent = 'No listings match your current filters.';
    }
    listingsScroll.innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');
  listingsScroll.innerHTML = filteredListings.map((l, i) => renderCard(l, highlightNew && i < 3)).join('');

  // Expand toggle
  listingsScroll.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const card = e.target.closest('.listing-card');
      card.classList.toggle('expanded');
      btn.textContent = card.classList.contains('expanded') ? 'Less ▲' : 'More ▼';
    });
  });

  // Contact toggle
  listingsScroll.querySelectorAll('.contact-toggle-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const card = e.target.closest('.listing-card');
      const contactsBlock = card.querySelector('.card-contacts');
      contactsBlock.classList.toggle('hidden');
    });
  });

  // Copy phone click handler
  listingsScroll.querySelectorAll('.copy-phone-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const phone = e.target.getAttribute('data-phone');
      navigator.clipboard.writeText(phone).then(() => {
        showToast(`Copied ${phone}`, 'success');
      }).catch(err => {
        console.error('Failed to copy: ', err);
      });
    });
  });
}

function renderCard(l, isNew = false) {
  const price = l.price
    ? `$${l.price.toLocaleString()}<span class="price-unit">/mo</span>`
    : `<span class="price-none">Price TBD</span>`;

  const bedsStr = l.bedrooms === null ? '' : l.bedrooms === 0 ? 'Studio' : `${l.bedrooms}BR`;
  const bathsStr = l.bathrooms === null ? '' : `${l.bathrooms}BA`;
  const roomConfig = [bedsStr, bathsStr].filter(Boolean).join(' / ');
  const typeStr = [l.propertyType, roomConfig].filter(Boolean).join(' · ');

  const dateStr = l.date instanceof Date
    ? l.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  const leaseBadge = l.leaseType === 'short-term' ? '<span class="badge badge-short">⏱ Short</span>'
    : l.leaseType === 'long-term' ? '<span class="badge badge-long">📋 Long</span>' : '';

  const furnBadge = l.furnished
    ? `<span class="badge badge-furn">${l.furnished === 'fully furnished' ? '🛋' : l.furnished === 'semi-furnished' ? '🪑' : '📦'}</span>`
    : '';

  const dupBadge = l.duplicateCount > 0
    ? `<span class="badge badge-dup">🔁 ${l.duplicateCount}</span>`
    : '';

  const newLabel = isNew ? '<div class="new-label">New</div>' : '';

  const amenitiesHtml = l.amenities?.length
    ? `<div class="amenities">${l.amenities.slice(0, 4).map(a => `<span class="amenity">${amenityIcon(a)} ${a}</span>`).join('')}${l.amenities.length > 4 ? `<span class="amenity">+${l.amenities.length - 4}</span>` : ''}</div>`
    : '';

  const avatarLetter = (l.sender || '?').charAt(0).toUpperCase();
  const availability = l.availability || '';

  return `
    <div class="listing-card" role="listitem">
      ${newLabel}
      <div class="card-top">
        <div class="card-type">${typeStr || '🏠 Rental'}</div>
        <div class="card-badges">${leaseBadge}${furnBadge}${dupBadge}</div>
      </div>
      <div class="card-price">${price}</div>
      ${l.location ? `<div class="card-loc">📍 ${esc(l.location)}</div>` : ''}
      <div class="card-meta">
        ${availability ? `<span>📅 <strong>${esc(availability)}</strong></span>` : ''}
        ${dateStr ? `<span>📤 ${dateStr}</span>` : ''}
      </div>
      ${amenitiesHtml}
      <div class="card-footer">
        <div class="sender-row">
          <div class="avatar">${avatarLetter}</div>
          <div>
            <div class="sender-name">${esc(l.sender || 'Unknown')}</div>
            <div class="sender-group">${esc(l.group || '')}</div>
          </div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="contact-toggle-btn">📞 Contact</button>
          <button class="expand-btn">More ▼</button>
        </div>
      </div>
      <div class="card-contacts hidden">
        <div class="contact-header">Contact Info</div>
        ${l.contacts?.spocName ? `<div class="contact-detail"><span>SPOC:</span> <strong>${esc(l.contacts.spocName)}</strong></div>` : ''}
        ${l.contacts?.phoneNumbers?.length 
          ? l.contacts.phoneNumbers.map(n => {
              const cleaned = n.replace(/\D/g, '');
              return `
                <div class="contact-detail phone-row">
                  <span>📱 ${esc(n)}</span>
                  <div class="phone-actions">
                    <button class="copy-phone-btn" data-phone="${esc(n)}">📋 Copy</button>
                    ${cleaned ? `<a href="https://wa.me/${cleaned}" target="_blank" class="wa-link">💬 Chat</a>` : ''}
                  </div>
                </div>
              `;
            }).join('')
          : ''}
        ${!(l.contacts?.spocName) && !(l.contacts?.phoneNumbers?.length) 
          ? `<div class="contact-detail text-muted">No phone numbers or SPOC found in message text. Sender: <strong>${esc(l.sender || 'Unknown')}</strong></div>`
          : ''}
      </div>
      <div class="card-raw">${esc(l.rawMessage || '')}</div>
    </div>
  `;
}

function amenityIcon(a) {
  const m = { parking: '🚗', wifi: '📶', 'air conditioning': '❄️', gym: '💪', pool: '🏊', laundry: '🫧', dishwasher: '🍽️', balcony: '🌇', elevator: '🛗', security: '🔒', 'pet friendly': '🐾', 'utilities included': '⚡', garden: '🌿', rooftop: '🏙️' };
  return m[a] || '✓';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Settings Drawer Toggle & Save ────────────────────────────────────
settingsBtn?.addEventListener('click', () => {
  settingsDrawer.classList.toggle('hidden');
});

closeSettingsBtn?.addEventListener('click', () => {
  settingsDrawer.classList.add('hidden');
});

saveSettingsBtn?.addEventListener('click', async () => {
  const key = geminiKeyInput.value.trim();
  await chrome.storage.local.set({ geminiApiKey: key });
  showToast(key ? 'API Key saved!' : 'API Key removed.', 'success');
  settingsDrawer.classList.add('hidden');
});

// ─── Clear ────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', async () => {
  if (allListings.length === 0) return;
  if (confirm(`Clear all ${allListings.length} listings? This cannot be undone.`)) {
    await chrome.storage.local.set({ listings: [], lastSeen: 0, totalCaptured: 0 });
    showToast('All listings cleared.', '');
  }
});

// ─── Toast ────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3000);
}

// ─── Rescan Button ───────────────────────────────────────────────────
rescanBtn?.addEventListener('click', async () => {
  // Find the WhatsApp tab
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!tabs.length) {
    showToast('Open WhatsApp Web first!', 'error');
    return;
  }
  
  const tabId = tabs[0].id;
  
  // Clear scanned cache in storage
  await chrome.storage.local.set({ scannedGroups: {} });
  
  showToast('Rescanning… check WhatsApp Web tab', 'success');
  scanBar?.classList.remove('hidden');
  if (scanText) scanText.textContent = 'Rescanning history…';

  // Ping the content script to see if it is alive and valid
  let alive = false;
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (res?.ok) alive = true;
  } catch (err) {
    console.log('[RentScan] Content script ping failed (context invalidated or not loaded).', err);
  }

  if (alive) {
    // Content script is alive! Signal it to start scanning.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.dispatchEvent(new CustomEvent('rentscan-rescan'));
      },
    });
  } else {
    // Re-inject content script dynamically
    try {
      console.log('[RentScan] Injecting new content scripts...');
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['shared/extractor-cs.js', 'content.js']
      });
      console.log('[RentScan] Content scripts successfully injected.');
    } catch (injectErr) {
      console.error('[RentScan] Failed to inject content script:', injectErr);
      showToast('Failed to start scanner. Reload the WhatsApp page.', 'error');
    }
  }
});

// Hide scan bar when storage stops changing (scanning done)
let scanHideTimer = null;
chrome.storage.onChanged.addListener((changes) => {
  if (changes.listings) {
    // Show scan bar when listing count is actively changing
    if (scanBar) {
      scanBar.classList.remove('hidden');
      clearTimeout(scanHideTimer);
      scanHideTimer = setTimeout(() => scanBar?.classList.add('hidden'), 3000);
    }
  }
  if (changes.scannedGroups) {
    // A group scan just completed
    const groups = changes.scannedGroups.newValue || {};
    if (Object.keys(groups).length > 0) {
      setTimeout(() => scanBar?.classList.add('hidden'), 1500);
    }
  }
});

// ─── Init ─────────────────────────────────────────────────────────────
loadData();
checkWhatsAppStatus();

// Recheck status periodically (every 5s)
setInterval(checkWhatsAppStatus, 5000);
