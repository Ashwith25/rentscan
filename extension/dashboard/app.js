/**
 * RentScan Dashboard Application JS
 * Handles data loading, filters, sorting, and modal overlays
 */

import { parseWhatsAppExport } from '../shared/parser.js';
import { extractListing } from '../shared/extractor.js';
import { deduplicate } from '../shared/deduplicator.js';

// ─── State ───────────────────────────────────────────────────────────
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function pruneOldListings(listings) {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  return listings.filter(l => {
    const ts = l.date ? new Date(l.date).getTime() : 0;
    return ts >= cutoff;
  });
}

let allListings = [];
let filteredListings = [];
let currentTheme = 'dark';
let activeSorts = ['date']; // default priority queue
let filters = { search: '', beds: '', furnished: '', lease: '', date: '', dateFrom: '' };
let activeInspectListing = null;

// ─── DOM References ──────────────────────────────────────────────────
const gridContainer       = document.getElementById('grid-container');
const emptyState          = document.getElementById('dashboard-empty-state');
const statTotal           = document.getElementById('stat-total');
const statDupes           = document.getElementById('stat-dupes');
const statPrice           = document.getElementById('stat-price');
const searchInput         = document.getElementById('search-input');
const filterBeds          = document.getElementById('filter-beds');
const filterFurnished     = document.getElementById('filter-furnished');
const filterLease         = document.getElementById('filter-lease');
const filterDate          = document.getElementById('filter-date');
const customDateGroup     = document.getElementById('custom-date-group');
const filterDateFrom      = document.getElementById('filter-date-from');
const clearFiltersBtn     = document.getElementById('clear-filters-btn');
const geminiApiKeyInput   = document.getElementById('gemini-api-key');
const saveApiKeyBtn       = document.getElementById('save-api-key-btn');

const themeToggleBtn      = document.getElementById('theme-toggle-btn');
const clearDataBtn        = document.getElementById('clear-data-btn');
const whatsappIndicator   = document.getElementById('whatsapp-indicator');
const whatsappStatusText  = document.getElementById('whatsapp-status-text');

const sortChipEls = document.querySelectorAll('.sort-chip');

// Modals
const contactModal        = document.getElementById('contact-modal');
const contactModalBody    = document.getElementById('contact-modal-body');
const closeContactModal   = document.getElementById('close-contact-modal');

const inspectModal        = document.getElementById('inspect-modal');
const inspectSender       = document.getElementById('inspect-sender');
const inspectGroup        = document.getElementById('inspect-group');
const inspectDate         = document.getElementById('inspect-date');
const inspectText         = document.getElementById('inspect-text');
const closeInspectModal   = document.getElementById('close-inspect-modal');
const copyRawBtn          = document.getElementById('copy-raw-btn');

// Settings Modal
const settingsBtn         = document.getElementById('settings-btn');
const settingsModal       = document.getElementById('dashboard-settings-modal');
const closeSettingsModal  = document.getElementById('close-settings-modal');

const toast               = document.getElementById('toast');

// Notification Banner
const notificationBanner = document.getElementById('notification-banner');
const bannerText         = document.getElementById('banner-text');
const bannerCloseBtn     = document.getElementById('banner-close-btn');

// ─── Theme Implementation ────────────────────────────────────────────
function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
  chrome.storage.local.set({ theme });
}

themeToggleBtn.addEventListener('click', () => {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// ─── Load Storage Data ────────────────────────────────────────────────
async function loadData() {
  const data = await chrome.storage.local.get(['listings', 'theme', 'geminiApiKey']);
  currentTheme = data.theme || 'dark';
  applyTheme(currentTheme);

  if (data.geminiApiKey) {
    geminiApiKeyInput.value = data.geminiApiKey;
  }

  const raw = (data.listings || []).map(l => ({ ...l, date: new Date(l.date) }));
  // Prune listings older than 30 days on load
  allListings = pruneOldListings(raw);
  if (allListings.length < raw.length) {
    // Persist the pruned list back so stale entries don't linger in storage
    await chrome.storage.local.set({ listings: allListings });
  }

  updateStats();
  updateSortUI();
  applyFiltersAndSort();
}

// Listen to storage changes live
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.listings) {
    const oldVal = changes.listings.oldValue || [];
    const rawNew = (changes.listings.newValue || []).map(l => ({ ...l, date: new Date(l.date) }));

    // Prune on live update too
    allListings = pruneOldListings(rawNew);
    updateStats();
    applyFiltersAndSort();

    const diff = allListings.length - oldVal.length;
    if (diff > 0) {
      showNotificationBanner(diff);
    }
  }
});

// ─── Stats Calculator ────────────────────────────────────────────────
function updateStats() {
  statTotal.textContent = allListings.length;

  const dupes = allListings.reduce((sum, l) => sum + (l.duplicateCount || 0), 0);
  statDupes.textContent = dupes;

  const priced = allListings.filter(l => l.price);
  if (priced.length) {
    const prices = priced.map(l => l.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    statPrice.textContent = min === max ? `$${min.toLocaleString()}` : `$${min.toLocaleString()}–$${max.toLocaleString()}`;
  } else {
    statPrice.textContent = '—';
  }
}

// ─── WhatsApp Status Check ───────────────────────────────────────────
function checkWhatsAppStatus() {
  chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
    const active = tabs && tabs.length > 0;
    whatsappIndicator.classList.toggle('active', active);
    whatsappStatusText.textContent = active ? 'WhatsApp Web Connected' : 'WhatsApp Web Inactive';
    whatsappStatusText.title = active ? `RentScan is listening to ${tabs.length} open tab(s).` : 'Open WhatsApp Web to capture listings.';
  });
}
setInterval(checkWhatsAppStatus, 5000);
checkWhatsAppStatus();

// ─── Filters & Sorter ────────────────────────────────────────────────
searchInput.addEventListener('input', (e) => {
  filters.search = e.target.value.toLowerCase();
  applyFiltersAndSort();
});

filterBeds.addEventListener('change', (e) => {
  filters.beds = e.target.value;
  applyFiltersAndSort();
});

filterFurnished.addEventListener('change', (e) => {
  filters.furnished = e.target.value;
  applyFiltersAndSort();
});

filterLease.addEventListener('change', (e) => {
  filters.lease = e.target.value;
  applyFiltersAndSort();
});

filterDate.addEventListener('change', (e) => {
  filters.date = e.target.value;
  if (filters.date === 'custom') {
    customDateGroup.classList.remove('hidden');
  } else {
    customDateGroup.classList.add('hidden');
    filters.dateFrom = '';
    filterDateFrom.value = '';
  }
  applyFiltersAndSort();
});

filterDateFrom.addEventListener('change', (e) => {
  filters.dateFrom = e.target.value;
  applyFiltersAndSort();
});

// ─── Sort Chip Logic ──────────────────────────────────────────────────
function updateSortUI() {
  sortChipEls.forEach(chip => {
    const sortType = chip.dataset.sort;
    const idx = activeSorts.indexOf(sortType);
    if (idx !== -1) {
      chip.classList.add('active');
      chip.setAttribute('data-priority', idx + 1);
    } else {
      chip.classList.remove('active');
      chip.removeAttribute('data-priority');
    }
  });
}

sortChipEls.forEach(chip => {
  chip.addEventListener('click', () => {
    const sortType = chip.dataset.sort;
    if (activeSorts.includes(sortType)) {
      // Already active — remove from queue and renumber remaining
      activeSorts = activeSorts.filter(s => s !== sortType);
    } else {
      // Not active — append to priority queue
      activeSorts.push(sortType);
    }
    updateSortUI();
    applyFiltersAndSort();
  });
});


clearFiltersBtn.addEventListener('click', () => {
  searchInput.value = '';
  filterBeds.value = '';
  filterFurnished.value = '';
  filterLease.value = '';
  filterDate.value = '';
  filterDateFrom.value = '';
  customDateGroup.classList.add('hidden');

  filters = { search: '', beds: '', furnished: '', lease: '', date: '', dateFrom: '' };
  activeSorts = ['date'];
  updateSortUI();
  applyFiltersAndSort();
  showToast('Filters reset successfully', 'success');
});

function applyFiltersAndSort() {
  let filtered = [...allListings];

  // 1. Text Search
  if (filters.search) {
    filtered = filtered.filter(l => 
      (l.rawMessage || '').toLowerCase().includes(filters.search) ||
      (l.location || '').toLowerCase().includes(filters.search) ||
      (l.sender || '').toLowerCase().includes(filters.search) ||
      (l.group || '').toLowerCase().includes(filters.search)
    );
  }

  // 2. Bedrooms Filter
  if (filters.beds !== '') {
    if (filters.beds === '0') {
      filtered = filtered.filter(l => l.bedrooms === 0);
    } else if (filters.beds === '4+') {
      filtered = filtered.filter(l => l.bedrooms >= 4);
    } else {
      const b = parseInt(filters.beds, 10);
      filtered = filtered.filter(l => l.bedrooms === b);
    }
  }

  // 3. Furnished Status
  if (filters.furnished) {
    filtered = filtered.filter(l => l.furnished === filters.furnished);
  }

  // 4. Lease Type
  if (filters.lease) {
    filtered = filtered.filter(l => l.leaseType === filters.lease);
  }

  // 5. Date Posted Filter
  if (filters.date) {
    const now = new Date();
    if (filters.date === '30') {
      const limit = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(l => l.date >= limit);
    } else if (filters.date === '60') {
      const limit = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(l => l.date >= limit);
    } else if (filters.date === 'custom' && filters.dateFrom) {
      // Set to start of the selected day
      const limit = new Date(filters.dateFrom + 'T00:00:00');
      filtered = filtered.filter(l => l.date >= limit);
    }
  }

  // 6. Multi-Sort Priority Engine
  if (activeSorts.length > 0) {
    filtered.sort((a, b) => {
      for (const sortType of activeSorts) {
        let diff = 0;
        if (sortType === 'date') {
          // Normalise to day level for equality checks to allow secondary sorting tie-breakers
          const d1 = a.date;
          const d2 = b.date;
          const sameDay = d1.getFullYear() === d2.getFullYear() &&
                          d1.getMonth() === d2.getMonth() &&
                          d1.getDate() === d2.getDate();
          if (!sameDay) {
            diff = d2 - d1; // Newest first
          }
        } else if (sortType === 'price') {
          const p1 = a.price ?? Infinity;
          const p2 = b.price ?? Infinity;
          diff = p1 - p2; // Cheapest first
        } else if (sortType === 'confidence') {
          diff = b.confidence - a.confidence; // Best match first
        }
        if (diff !== 0) return diff;
      }
      return 0;
    });
  } else {
    // Default fallback: newest first
    filtered.sort((a, b) => b.date - a.date);
  }

  filteredListings = filtered;
  renderGrid();
}

// ─── Render Listing Grid ─────────────────────────────────────────────
function renderGrid() {
  const isEmpty = filteredListings.length === 0;
  gridContainer.classList.toggle('hidden', isEmpty);
  emptyState.classList.toggle('hidden', !isEmpty);

  gridContainer.innerHTML = '';
  filteredListings.forEach(l => {
    const card = document.createElement('div');
    card.className = 'listing-card';
    card.innerHTML = buildCardHtml(l);
    
    // Wire up buttons inside card
    card.querySelector('.view-contacts-btn').addEventListener('click', () => openContactModalFor(l));
    card.querySelector('.inspect-msg-btn').addEventListener('click', () => openInspectModalFor(l));

    gridContainer.appendChild(card);
  });
}

function buildCardHtml(l) {
  const price = l.price
    ? `$${l.price.toLocaleString()}<span>/mo</span>`
    : '<span>Price TBD</span>';

  const bedsStr = l.bedrooms === null ? '' : l.bedrooms === 0 ? 'Studio' : `${l.bedrooms} Bed`;
  const bathsStr = l.bathrooms === null ? '' : `${l.bathrooms} Bath`;
  const roomConfig = [bedsStr, bathsStr].filter(Boolean).join(' / ');
  const typeStr = [l.propertyType, roomConfig].filter(Boolean).join(' · ');

  const dateStr = l.date instanceof Date
    ? l.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const leaseBadge = l.leaseType === 'short-term' ? '<span class="badge badge-short">⏱ Short-Term</span>'
    : l.leaseType === 'long-term' ? '<span class="badge badge-long">📋 Long-Term</span>' : '';

  const furnBadge = l.furnished
    ? `<span class="badge badge-furn">${l.furnished === 'fully furnished' ? '🛋 Furnished' : l.furnished === 'semi-furnished' ? '🪑 Semi-Furnished' : '📦 Unfurnished'}</span>`
    : '';

  const dupBadge = l.duplicateCount > 0
    ? `<span class="badge badge-dup">🔁 ${l.duplicateCount} Re-posts</span>`
    : '';

  const amenitiesHtml = l.amenities?.length
    ? `<div class="card-amenities">${l.amenities.map(a => `<span class="amenity-tag">${amenityIcon(a)} ${a}</span>`).join('')}</div>`
    : '';

  const avatarLetter = (l.sender || '?').charAt(0).toUpperCase();

  return `
    <div class="card-header">
      <span class="card-title">${esc(typeStr || 'Rental Property')}</span>
      <div class="card-badges">${leaseBadge}${furnBadge}${dupBadge}</div>
    </div>
    <div class="card-price">${price}</div>
    ${l.location ? `<div class="card-loc">📍 ${esc(l.location)}</div>` : ''}
    <div class="card-meta">
      ${l.availability ? `<span>📅 Available: <strong>${esc(l.availability)}</strong></span>` : ''}
      <span>📤 Extracted: <strong>${dateStr}</strong></span>
    </div>
    ${amenitiesHtml}
    <div class="card-footer">
      <div class="sender-profile">
        <div class="avatar">${avatarLetter}</div>
        <div class="sender-info">
          <span class="sender-name">${esc(l.sender || 'Unknown Sender')}</span>
          <span class="sender-group">${esc(l.group || 'WhatsApp Group')}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="action-btn inspect-msg-btn">Inspect</button>
        <button class="action-btn primary view-contacts-btn">📞 Contact</button>
      </div>
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

// ─── Modal Implementation ────────────────────────────────────────────
function openContactModalFor(l) {
  contactModal.classList.remove('hidden');

  let bodyHtml = '';

  const hasSpoc = l.contacts?.spocName;
  const hasPhones = l.contacts?.phoneNumbers && l.contacts.phoneNumbers.length > 0;

  if (hasSpoc) {
    bodyHtml += `
      <div class="contact-spoc-section">
        <div class="spoc-left">
          <span class="title">SPOC Name</span>
          <span class="name">${esc(l.contacts.spocName)}</span>
        </div>
        <button class="modal-copy-btn" id="copy-spoc-name-btn" data-name="${esc(l.contacts.spocName)}">📋 Copy Name</button>
      </div>
    `;
  }

  if (hasPhones) {
    bodyHtml += `
      <h3 class="phone-list-title">Contact Numbers</h3>
      <div class="phone-list">
        ${l.contacts.phoneNumbers.map(n => {
          const cleaned = n.replace(/\D/g, '');
          return `
            <div class="phone-item">
              <span class="phone-item-left">📱 ${esc(n)}</span>
              <div class="phone-item-actions">
                <button class="modal-copy-btn copy-modal-phone" data-phone="${esc(n)}">📋 Copy</button>
                ${cleaned ? `<a href="https://wa.me/${cleaned}" target="_blank" class="modal-wa-btn">💬 Chat</a>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // Fallback: If no SPOC or phone numbers were extracted, show the message sender.
  if (!hasSpoc && !hasPhones) {
    bodyHtml += `
      <div class="no-contacts-message">
        <p>No phone numbers or SPOC (Single Point of Contact) names were detected inside the message text.</p>
        <p style="margin-top: 12px;">Message Sender: <strong>${esc(l.sender || 'Unknown')}</strong></p>
        <p style="margin-top: 6px;">WhatsApp Group: <strong>${esc(l.group || 'Unknown')}</strong></p>
      </div>
    `;
  }

  contactModalBody.innerHTML = bodyHtml;

  // Wire up modal copy buttons
  const copySpoc = document.getElementById('copy-spoc-name-btn');
  copySpoc?.addEventListener('click', () => {
    navigator.clipboard.writeText(copySpoc.getAttribute('data-name')).then(() => {
      showToast('Copied name to clipboard', 'success');
    });
  });

  contactModalBody.querySelectorAll('.copy-modal-phone').forEach(btn => {
    btn.addEventListener('click', () => {
      const phone = btn.getAttribute('data-phone');
      navigator.clipboard.writeText(phone).then(() => {
        showToast(`Copied ${phone}`, 'success');
      });
    });
  });
}

function openInspectModalFor(l) {
  inspectModal.classList.remove('hidden');
  activeInspectListing = l;
  inspectSender.textContent = l.sender || 'Unknown';
  inspectGroup.textContent = l.group || 'Unknown';
  inspectDate.textContent = l.date.toLocaleString();
  inspectText.textContent = l.rawMessage || '';
}

closeContactModal.addEventListener('click', () => contactModal.classList.add('hidden'));
closeInspectModal.addEventListener('click', () => inspectModal.classList.add('hidden'));
closeSettingsModal.addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsBtn?.addEventListener('click', () => settingsModal.classList.remove('hidden'));

// Close modal when clicking background
window.addEventListener('click', (e) => {
  if (e.target === contactModal) contactModal.classList.add('hidden');
  if (e.target === inspectModal) inspectModal.classList.add('hidden');
  if (e.target === settingsModal) settingsModal.classList.add('hidden');
});

// Copy Raw Message Text
copyRawBtn.addEventListener('click', () => {
  if (activeInspectListing) {
    navigator.clipboard.writeText(activeInspectListing.rawMessage).then(() => {
      showToast('Raw message copied to clipboard', 'success');
    });
  }
});

// ─── Data Clean Up ───────────────────────────────────────────────────
clearDataBtn.addEventListener('click', async () => {
  const count = allListings.length;
  if (count === 0) {
    showToast('No listings to clear', 'error');
    return;
  }
  if (confirm(`Are you sure you want to clear all ${count} rental listings? This is permanent.`)) {
    await chrome.storage.local.set({ listings: [], totalCaptured: 0, lastSeen: 0, scannedGroups: {} });
    await chrome.action.setBadgeText({ text: '' });
    showToast('Database wiped successfully', 'success');
  }
});

// ─── Toast System ────────────────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, 2500);
}

// ─── Notification Banner ──────────────────────────────────────────────
let bannerTimer = null;
function showNotificationBanner(count) {
  clearTimeout(bannerTimer);
  bannerText.textContent = `RentScan successfully captured ${count} new rental listing${count > 1 ? 's' : ''}!`;
  notificationBanner.classList.remove('hidden');
  // Trigger transition
  setTimeout(() => notificationBanner.classList.add('show'), 50);

  bannerTimer = setTimeout(() => {
    notificationBanner.classList.remove('show');
    setTimeout(() => notificationBanner.classList.add('hidden'), 400);
  }, 6000);
}

bannerCloseBtn?.addEventListener('click', () => {
  notificationBanner.classList.remove('show');
  setTimeout(() => notificationBanner.classList.add('hidden'), 400);
});

// ─── Chat Import Handler ─────────────────────────────────────────────
const importBtn = document.getElementById('import-btn');
const importFileInput = document.getElementById('import-file-input');

importBtn?.addEventListener('click', () => {
  importFileInput?.click();
});

importFileInput?.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target.result;
    
    // Extract group name from filename: e.g. "WhatsApp Chat with GroupName.txt" -> "GroupName"
    let groupName = file.name.replace(/\.txt$/i, '');
    const prefixMatch = groupName.match(/WhatsApp Chat with\s+(.+)/i);
    if (prefixMatch) {
      groupName = prefixMatch[1].trim();
    }

    showToast('Parsing export file...', 'success');

    try {
      // 1. Parse .txt export file to messages
      const messages = parseWhatsAppExport(text, groupName);
      if (!messages.length) {
        showToast('No messages found in the file. Check the format.', 'error');
        importFileInput.value = '';
        return;
      }

      // 2. Extract listings from messages
      const newListings = [];
      for (const msg of messages) {
        const listing = extractListing(msg);
        if (listing) {
          newListings.push(listing);
        }
      }

      if (!newListings.length) {
        showToast('No rental listings detected in this chat export.', 'error');
        importFileInput.value = '';
        return;
      }

      // 3. Retrieve existing listings, merge, deduplicate, and prune to 30 days
      const data = await chrome.storage.local.get('listings');
      const existingListings = data.listings || [];

      const combined = [...existingListings, ...newListings];
      const deduped = deduplicate(combined);
      const pruned = pruneOldListings(deduped);

      // 4. Save back to local storage
      await chrome.storage.local.set({ listings: pruned });

      const addedCount = pruned.length - existingListings.length;
      const skippedOld = deduped.length - pruned.length;
      const skippedMsg = skippedOld > 0 ? ` (${skippedOld} older than 30 days skipped)` : '';
      showToast(`Imported! Found ${newListings.length} listings (${addedCount} new${skippedMsg})`, 'success');
    } catch (err) {
      console.error('[RentScan] Failed to import chat export:', err);
      showToast('Error parsing file: ' + err.message, 'error');
    }

    importFileInput.value = '';
  };

  reader.readAsText(file);
});

// ─── Save API Key listener ──────────────────────────────────────────
saveApiKeyBtn?.addEventListener('click', async () => {
  const key = geminiApiKeyInput.value.trim();
  await chrome.storage.local.set({ geminiApiKey: key });
  showToast(key ? 'Gemini API Key saved successfully!' : 'Gemini API Key removed.', 'success');
  settingsModal.classList.add('hidden');
});

// ─── Initialize ──────────────────────────────────────────────────────
loadData();
