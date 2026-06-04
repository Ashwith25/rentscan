/**
 * Deduplication Engine
 * Detects and removes/flags duplicate rental listings
 */

/**
 * Normalize text for comparison (lowercase, remove punctuation, collapse spaces)
 */
function normalize(text = '') {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute similarity ratio between two strings (Jaccard similarity on word sets)
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(normalize(a).split(' ').filter(w => w.length > 2 || /^\d+$/.test(w)));
  const wordsB = new Set(normalize(b).split(' ').filter(w => w.length > 2 || /^\d+$/.test(w)));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Check if two listings are likely duplicates
 */
function areDuplicates(a, b) {
  // 1. Exact message body match (same text, possibly from different groups)
  if (normalize(a.rawMessage) === normalize(b.rawMessage)) return true;

  // 2. Same sender + very similar message (re-post)
  if (a.sender === b.sender && similarity(a.rawMessage, b.rawMessage) > 0.85) return true;

  // 3. Same price + same bedrooms + highly similar message (different sender, same property re-listed)
  if (
    a.price === b.price &&
    a.bedrooms === b.bedrooms &&
    a.price !== null &&
    similarity(a.rawMessage, b.rawMessage) > 0.88
  ) return true;

  // 4. Same location + same price + similar message
  if (
    a.location && b.location &&
    normalize(a.location) === normalize(b.location) &&
    a.price === b.price &&
    similarity(a.rawMessage, b.rawMessage) > 0.85
  ) return true;

  return false;
}

/**
 * Deduplicate an array of listings.
 * Keeps the most recent version of duplicates, flags others.
 * @param {Array} listings
 * @returns {Array} - listings with isDuplicate and duplicateCount set
 */
export function deduplicate(listings) {
  if (!listings.length) return [];

  // Sort by date descending (newest first)
  const sorted = [...listings].sort((a, b) => b.date - a.date);

  const kept = [];
  const duplicateOf = new Map(); // id -> canonical id

  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i];
    let foundDuplicate = false;

    for (const canonical of kept) {
      if (areDuplicates(candidate, canonical)) {
        duplicateOf.set(candidate.id, canonical.id);
        canonical.duplicateCount = (canonical.duplicateCount || 0) + 1;
        foundDuplicate = true;
        break;
      }
    }

    if (!foundDuplicate) {
      kept.push({ ...candidate, duplicateCount: 0, isDuplicate: false });
    }
  }

  return kept;
}
