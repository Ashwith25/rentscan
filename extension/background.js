/**
 * background.js — Service Worker
 * Handles storage management, deduplication, badge updates, notifications
 * NOTE: Service workers are ephemeral — NO global state. Use chrome.storage for everything.
 */

import { deduplicate } from './shared/deduplicator.js';

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

// ─── Add Listing ─────────────────────────────────────────────────────
async function addListing(newListing) {
  const { listings = [], totalCaptured = 0, lastSeen = 0 } = await chrome.storage.local.get(['listings', 'totalCaptured', 'lastSeen']);

  // Dedup against existing + new
  const combined = [...listings, newListing];
  const deduped = deduplicate(combined);

  // Did we actually add something new (not a dup of existing)?
  const isActuallyNew = deduped.length > listings.length;

  await chrome.storage.local.set({
    listings: deduped,
    totalCaptured: totalCaptured + 1,
    lastUpdated: Date.now(),
  });

  if (isActuallyNew) {
    // Update badge
    const unseenCount = deduped.length - lastSeen;
    if (unseenCount > 0) {
      await chrome.action.setBadgeText({ text: String(unseenCount) });
      await chrome.action.setBadgeBackgroundColor({ color: '#25D366' });
    }

  }
}
