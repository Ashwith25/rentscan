/**
 * Main Application Logic
 * Orchestrates parsing, extraction, deduplication, and rendering
 */

import { parseWhatsAppExport } from './parser.js';
import { extractListing } from './extractor.js';
import { deduplicate } from './deduplicator.js';
import { getSampleChatAsFile } from './sample-data.js';

// --- State ---
let allListings = [];
let filteredListings = [];
let currentTheme = localStorage.getItem('theme') || 'dark';
let currentSort = 'date-desc';
let activeFilters = {
  minPrice: '',
  maxPrice: '',
  bedrooms: '',
  furnished: '',
  leaseType: '',
  search: '',
};

// --- DOM References ---
const listingsGrid = document.getElementById('listings-grid');
const emptyState = document.getElementById('empty-state');
const statsBar = document.getElementById('stats-bar');
const filterPanel = document.getElementById('filter-panel');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const themeToggle = document.getElementById('theme-toggle');
const sortSelect = document.getElementById('sort-select');
const loadingOverlay = document.getElementById('loading-overlay');
const totalCount = document.getElementById('total-count');
const priceRangeEl = document.getElementById('price-range');
const groupsCount = document.getElementById('groups-count');
const dedupCount = document.getElementById('dedup-count');
const toastEl = document.getElementById('toast');

// --- Theme Management ---
function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  themeToggle.innerHTML = theme === 'dark'
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}

themeToggle.addEventListener('click', () => {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// --- File Upload ---
uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.txt'));
  if (files.length) processFiles(files);
  else showToast('Please drop WhatsApp .txt export files', 'error');
});

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length) processFiles(files);
  e.target.value = ''; // reset so same file can be re-uploaded
});

// --- Demo Button ---
document.getElementById('load-demo').addEventListener('click', () => {
  processFiles([getSampleChatAsFile()]);
});

// --- Process Uploaded Files ---
async function processFiles(files) {
  showLoading(true);

  // Small delay to let loading show
  await new Promise(r => setTimeout(r, 100));

  const newListings = [];
  const processedGroups = new Set();

  for (const file of files) {
    try {
      const text = await file.text();
      const groupName = file.name.replace(/WhatsApp Chat(?: with| -| –)?\s*/i, '').replace('.txt', '').trim() || 'Unknown Group';
      processedGroups.add(groupName);

      const messages = parseWhatsAppExport(text, groupName);
      for (const msg of messages) {
        const listing = extractListing(msg);
        if (listing) newListings.push(listing);
      }
    } catch (err) {
      console.error('Error processing file:', file.name, err);
      showToast(`Error reading ${file.name}`, 'error');
    }
  }

  // Merge with existing listings
  const combined = [...allListings, ...newListings];
  allListings = deduplicate(combined);

  applyFiltersAndSort();
  updateStats();
  showLoading(false);

  const count = newListings.length;
  showToast(`Found ${count} listing${count !== 1 ? 's' : ''} from ${files.length} file${files.length !== 1 ? 's' : ''}!`, 'success');
}

// --- Filters ---
document.getElementById('filter-search').addEventListener('input', (e) => {
  activeFilters.search = e.target.value.toLowerCase();
  applyFiltersAndSort();
});

document.getElementById('filter-min-price').addEventListener('input', (e) => {
  activeFilters.minPrice = e.target.value;
  applyFiltersAndSort();
});

document.getElementById('filter-max-price').addEventListener('input', (e) => {
  activeFilters.maxPrice = e.target.value;
  applyFiltersAndSort();
});

document.getElementById('filter-bedrooms').addEventListener('change', (e) => {
  activeFilters.bedrooms = e.target.value;
  applyFiltersAndSort();
});

document.getElementById('filter-furnished').addEventListener('change', (e) => {
  activeFilters.furnished = e.target.value;
  applyFiltersAndSort();
});

document.getElementById('filter-lease-type').addEventListener('change', (e) => {
  activeFilters.leaseType = e.target.value;
  applyFiltersAndSort();
});

document.getElementById('clear-filters').addEventListener('click', () => {
  activeFilters = { minPrice: '', maxPrice: '', bedrooms: '', furnished: '', leaseType: '', search: '' };
  document.getElementById('filter-search').value = '';
  document.getElementById('filter-min-price').value = '';
  document.getElementById('filter-max-price').value = '';
  document.getElementById('filter-bedrooms').value = '';
  document.getElementById('filter-furnished').value = '';
  document.getElementById('filter-lease-type').value = '';
  applyFiltersAndSort();
});

sortSelect.addEventListener('change', (e) => {
  currentSort = e.target.value;
  applyFiltersAndSort();
});

function applyFiltersAndSort() {
  let filtered = [...allListings];

  // Search
  if (activeFilters.search) {
    filtered = filtered.filter(l =>
      l.rawMessage.toLowerCase().includes(activeFilters.search) ||
      (l.location || '').toLowerCase().includes(activeFilters.search) ||
      l.sender.toLowerCase().includes(activeFilters.search) ||
      l.group.toLowerCase().includes(activeFilters.search)
    );
  }

  // Price
  if (activeFilters.minPrice) {
    filtered = filtered.filter(l => l.price === null || l.price >= parseInt(activeFilters.minPrice));
  }
  if (activeFilters.maxPrice) {
    filtered = filtered.filter(l => l.price === null || l.price <= parseInt(activeFilters.maxPrice));
  }

  // Bedrooms
  if (activeFilters.bedrooms !== '') {
    const beds = parseInt(activeFilters.bedrooms);
    if (activeFilters.bedrooms === '0') {
      filtered = filtered.filter(l => l.bedrooms === 0);
    } else if (activeFilters.bedrooms === '4+') {
      filtered = filtered.filter(l => l.bedrooms >= 4);
    } else {
      filtered = filtered.filter(l => l.bedrooms === beds);
    }
  }

  // Furnished
  if (activeFilters.furnished) {
    filtered = filtered.filter(l => l.furnished === activeFilters.furnished);
  }

  // Lease type
  if (activeFilters.leaseType) {
    filtered = filtered.filter(l => l.leaseType === activeFilters.leaseType);
  }

  // Sort
  switch (currentSort) {
    case 'date-desc':
      filtered.sort((a, b) => b.date - a.date);
      break;
    case 'date-asc':
      filtered.sort((a, b) => a.date - b.date);
      break;
    case 'price-asc':
      filtered.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      break;
    case 'price-desc':
      filtered.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
      break;
    case 'confidence':
      filtered.sort((a, b) => b.confidence - a.confidence);
      break;
  }

  filteredListings = filtered;
  renderListings();
  updateFilteredCount();
}

// --- Stats ---
function updateStats() {
  const listings = allListings;
  totalCount.textContent = listings.length;

  const withPrices = listings.filter(l => l.price);
  if (withPrices.length) {
    const min = Math.min(...withPrices.map(l => l.price));
    const max = Math.max(...withPrices.map(l => l.price));
    priceRangeEl.textContent = `$${min.toLocaleString()} – $${max.toLocaleString()}`;
  } else {
    priceRangeEl.textContent = 'N/A';
  }

  const groups = new Set(listings.map(l => l.group));
  groupsCount.textContent = groups.size;

  const dupes = allListings.reduce((sum, l) => sum + (l.duplicateCount || 0), 0);
  dedupCount.textContent = dupes;

  statsBar.classList.toggle('hidden', listings.length === 0);
}

function updateFilteredCount() {
  const el = document.getElementById('filtered-count');
  if (el) {
    el.textContent = filteredListings.length !== allListings.length
      ? `Showing ${filteredListings.length} of ${allListings.length}`
      : `${allListings.length} listings`;
  }
}

// --- Render Listings ---
function renderListings() {
  if (!filteredListings.length) {
    listingsGrid.innerHTML = '';
    emptyState.classList.remove('hidden');
    emptyState.innerHTML = allListings.length
      ? `<div class="empty-icon">🔍</div><p>No listings match your filters.</p><button class="btn btn-secondary" onclick="document.getElementById('clear-filters').click()">Clear Filters</button>`
      : `<div class="empty-icon">📲</div><p>Upload a WhatsApp chat export to see rental listings.</p><button class="btn btn-primary" id="empty-demo-btn">Load Demo</button>`;

    if (!allListings.length) {
      document.getElementById('empty-demo-btn')?.addEventListener('click', () => {
        processFiles([getSampleChatAsFile()]);
      });
    }
    return;
  }

  emptyState.classList.add('hidden');
  listingsGrid.innerHTML = filteredListings.map(renderCard).join('');

  // Add click handlers for expand
  document.querySelectorAll('.card-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.listing-card');
      card.classList.toggle('expanded');
      btn.textContent = card.classList.contains('expanded') ? 'Show less ▲' : 'Show more ▼';
    });
  });
}

function renderCard(listing) {
  const price = listing.price ? `$${listing.price.toLocaleString()}<span class="price-unit">/mo</span>` : '<span class="price-unknown">Price not listed</span>';
  const bedsLabel = listing.bedrooms === null ? '' : listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} Bed`;
  const dateStr = listing.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const availStr = listing.availability || 'Contact for details';

  const leaseBadge = listing.leaseType
    ? `<span class="badge badge-lease ${listing.leaseType === 'short-term' ? 'badge-short' : 'badge-long'}">${listing.leaseType === 'short-term' ? '⏱ Short-term' : '📋 Long-term'}</span>`
    : '';

  const furnishedBadge = listing.furnished
    ? `<span class="badge badge-furnished">${listing.furnished === 'fully furnished' ? '🛋 Fully Furnished' : listing.furnished === 'semi-furnished' ? '🪑 Semi-Furnished' : '📦 Unfurnished'}</span>`
    : '';

  const dupBadge = listing.duplicateCount > 0
    ? `<span class="badge badge-dup">🔁 ${listing.duplicateCount} re-post${listing.duplicateCount > 1 ? 's' : ''}</span>`
    : '';

  const amenitiesHtml = listing.amenities.length
    ? `<div class="amenities">${listing.amenities.slice(0, 6).map(a => `<span class="amenity-chip">${amenityIcon(a)} ${a}</span>`).join('')}${listing.amenities.length > 6 ? `<span class="amenity-chip amenity-more">+${listing.amenities.length - 6} more</span>` : ''}</div>`
    : '';

  const confidenceColor = listing.confidence >= 70 ? 'var(--success)' : listing.confidence >= 50 ? 'var(--warning)' : 'var(--text-muted)';

  return `
    <article class="listing-card" data-id="${listing.id}">
      <div class="card-header">
        <div class="card-type">${propertyIcon(listing.propertyType)} ${listing.propertyType}${bedsLabel ? ' · ' + bedsLabel : ''}</div>
        <div class="card-badges">${leaseBadge}${furnishedBadge}${dupBadge}</div>
      </div>

      <div class="card-price">${price}</div>

      ${listing.location ? `<div class="card-location">📍 ${listing.location}</div>` : ''}

      <div class="card-meta">
        <span>📅 Available: <strong>${availStr}</strong></span>
        <span>📤 Posted: ${dateStr}</span>
      </div>

      ${amenitiesHtml}

      <div class="card-footer">
        <div class="card-sender">
          <div class="sender-avatar">${listing.sender.charAt(0).toUpperCase()}</div>
          <div class="sender-info">
            <div class="sender-name">${escapeHtml(listing.sender)}</div>
            <div class="sender-group">via ${escapeHtml(listing.group)}</div>
          </div>
        </div>
        <div class="card-confidence" title="Extraction confidence: ${listing.confidence}%">
          <span style="color:${confidenceColor}">●</span>
        </div>
      </div>

      <div class="card-raw">
        <div class="raw-message">${escapeHtml(listing.rawMessage)}</div>
      </div>
      <button class="card-expand-btn">Show more ▼</button>
    </article>
  `;
}

function amenityIcon(amenity) {
  const icons = {
    'parking': '🚗', 'wifi': '📶', 'air conditioning': '❄️', 'gym': '💪',
    'pool': '🏊', 'laundry': '🫧', 'dishwasher': '🍽️', 'balcony': '🌇',
    'elevator': '🛗', 'security': '🔒', 'utilities included': '⚡',
    'pet friendly': '🐾', 'hardwood floors': '🪵', 'storage': '📦',
    'rooftop': '🏙️', 'concierge': '🎩', 'natural light': '☀️',
    'garden': '🌿', 'bike storage': '🚲',
  };
  return icons[amenity] || '✓';
}

function propertyIcon(type) {
  const icons = {
    'Apartment': '🏢', 'Studio': '🏠', 'House': '🏡', 'Room': '🚪',
    'Condo': '🏬', 'Townhouse': '🏘️', 'Flat': '🏢', 'Property': '🏠',
  };
  return icons[type] || '🏠';
}

function escapeHtml(text) {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Loading & Toast ---
function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show);
}

let toastTimeout;
function showToast(message, type = 'info') {
  clearTimeout(toastTimeout);
  toastEl.textContent = message;
  toastEl.className = `toast toast-${type} show`;
  toastTimeout = setTimeout(() => toastEl.className = 'toast', 3000);
}

// --- Clear All ---
document.getElementById('clear-all').addEventListener('click', () => {
  if (!allListings.length) return;
  if (confirm('Clear all listings? This cannot be undone.')) {
    allListings = [];
    filteredListings = [];
    renderListings();
    updateStats();
    showToast('All listings cleared.', 'info');
  }
});

// --- Filter panel toggle (mobile) ---
document.getElementById('filter-toggle').addEventListener('click', () => {
  filterPanel.classList.toggle('open');
});

// --- Initialize ---
applyTheme(currentTheme);
renderListings();
updateStats();
