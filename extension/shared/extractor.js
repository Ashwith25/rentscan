/**
 * Rental Listing Extractor
 * Uses regex + keyword matching to extract structured rental data from WhatsApp messages
 */

// --- Keyword Dictionaries ---

const RENTAL_TRIGGER_KEYWORDS = [
  'rent', 'rental', 'lease', 'apartment', 'apt', 'flat', 'house', 'studio',
  'bhk', 'bedroom', 'room', 'available', 'vacancy', 'looking for tenant',
  'for rent', 'to let', 'letting', 'tenant wanted', 'condo', 'townhouse',
  'sublet', 'sublease', '1br', '2br', '3br', '4br', '1bed', '2bed', '3bed', '4bed',
  '1b1b', '2b1b', '2b2b', '3b2b', '3b1b',
  'per month', '/month', 'monthly rent', '$/', 'sq ft', 'sqft',
  'accommodation', 'flatmate', 'roommate', 'roommates', 'housemate', 'subletting', 'subleasing',
  'community', 'gated community', 'apartment complex', 'housing',
];

const AMENITIES_MAP = {
  'parking': ['parking', 'car park', 'garage', 'covered parking', 'reserved parking'],
  'wifi': ['wifi', 'wi-fi', 'internet', 'broadband', 'fiber'],
  'air conditioning': ['ac', 'a/c', 'air conditioning', 'air conditioned', 'central air', 'hvac'],
  'gym': ['gym', 'fitness center', 'fitness room', 'workout room'],
  'pool': ['pool', 'swimming pool', 'rooftop pool'],
  'laundry': ['laundry', 'washer', 'dryer', 'in-unit laundry', 'washer/dryer', 'washing machine'],
  'dishwasher': ['dishwasher'],
  'balcony': ['balcony', 'terrace', 'patio', 'deck'],
  'elevator': ['elevator', 'lift', 'accessible'],
  'security': ['security', 'gated', 'doorman', 'secured', '24/7 security', 'cctv'],
  'utilities included': ['utilities included', 'all bills included', 'all utilities', 'water included', 'electricity included'],
  'pet friendly': ['pet friendly', 'pets allowed', 'pet ok', 'cats ok', 'dogs ok', 'pets welcome'],
  'furnished': ['fully furnished', 'furnished'],
  'hardwood floors': ['hardwood', 'hardwood floors'],
  'storage': ['storage', 'extra storage', 'storage unit'],
  'rooftop': ['rooftop', 'roof deck', 'roof access'],
  'concierge': ['concierge', 'doorman'],
  'natural light': ['natural light', 'sunny', 'bright', 'large windows'],
  'garden': ['garden', 'yard', 'backyard', 'courtyard'],
  'bike storage': ['bike storage', 'bicycle storage', 'bike room'],
};

const FURNISHED_KEYWORDS = {
  'fully furnished': ['fully furnished', 'completely furnished', 'fully-furnished', 'all furnished'],
  'semi-furnished': ['semi furnished', 'semi-furnished', 'partially furnished'],
  'unfurnished': ['unfurnished', 'un-furnished', 'bare', 'empty', 'not furnished'],
};

const LEASE_TYPE_KEYWORDS = {
  'short-term': ['short term', 'short-term', 'temporary', 'temp', 'airbnb', 'month to month', 'monthly', 'vacation rental', 'holiday rental', 'sublease', 'sublet'],
  'long-term': ['long term', 'long-term', 'permanent', 'annual', 'year lease', '12 month', '11 month'],
};

// --- Extraction Functions ---

function extractPrice(text) {
  const patterns = [
    // $2,500/month or €2500/mo or £2500/m
    /[$€£]\s*([\d,]+(?:\.\d{2})?)\s*(?:\/\s*(?:month|mo|mth|m))?/gi,
    // 2500/month or 2500€/month or 2500 per month
    /([\d,]+)\s*[$€£]?\s*\/\s*(?:month|mo|mth|m)/gi,
    // "rent is $2500" or "rent: €2500"
    /rent(?:\s+is|:)?\s*[$€£]?\s*([\d,]+)/gi,
    // "$2,500 per month" or "€2,500 per month"
    /[$€£]\s*([\d,]+(?:\.\d{2})?)\s+per\s+month/gi,
    // "2500 a month" or "2500€ a month"
    /([\d,]+)\s*[$€£]?\s+(?:a|per)\s+month/gi,
    // "monthly rent $2500" or "monthly: €2500"
    /monthly\s+(?:rent)?:?\s*[$€£]?\s*([\d,]+)/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const raw = match[1].replace(/,/g, '');
      const num = parseInt(raw, 10);
      // Sanity check: rent between 50 and 50,000
      if (num >= 50 && num <= 50000) {
        return num;
      }
    }
  }
  return null;
}

function extractBedrooms(text) {
  // Try 2b2b style first
  const b2bMatch = /(\d+)\s*b\s*(\d+(?:\.\d+)?)\s*b/i.exec(text);
  if (b2bMatch) {
    const n = parseInt(b2bMatch[1], 10);
    if (n >= 0 && n <= 10) return n;
  }

  const patterns = [
    /(\d+)\s*(?:bhk|bed(?:room)?s?|br|bdr|bdrm)/gi,
    /(\d+)[-\s]bed(?:room)?/gi,
    /studio/gi,
    /efficiency/gi,
    /(\d+)br\b/gi,
    /(\d+)\s*(?:bedroom|bed)\s*apartment/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      if (!match[1]) return 0; // studio
      const n = parseInt(match[1], 10);
      if (n >= 0 && n <= 10) return n;
    }
  }
  return null;
}

function extractBathrooms(text) {
  // Try 2b2b style first
  const b2bMatch = /(\d+)\s*b\s*(\d+(?:\.\d+)?)\s*b/i.exec(text);
  if (b2bMatch) {
    const n = parseFloat(b2bMatch[2]);
    if (n >= 0 && n <= 10) return n;
  }

  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|ba\b)/gi,
    /(\d+(?:\.\d+)?)[-\s]bath(?:room)?s?/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const n = parseFloat(match[1]);
      if (n >= 0 && n <= 10) return n;
    }
  }
  return null;
}


function extractAvailability(text) {
  const patterns = [
    // "available from January 1" or "available from 01/01/25"
    /available\s+(?:from\s+)?([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)/gi,
    /available\s+(?:from\s+)?(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]?\d{0,4})/gi,
    // "from January 2025" or "from next month"
    /from\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*(\d{4})?/gi,
    // "immediately" or "right away"
    /available\s+(?:immediately|now|right away|asap|today)/gi,
    // "move in: date"
    /move[- ]in:?\s*([A-Za-z]+\s+\d{1,2}|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/gi,
    // "from 1st Jan" or "1st January"
    /from\s+(\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*,?\s*\d{0,4})/gi,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      if (!match[1]) return 'Immediately';
      return match[1].trim();
    }
  }
  return null;
}

function extractLocation(text) {
  // Look for "in [Location]", "at [Location]", "near [Location]", "located in [Location]"
  const patterns = [
    /(?:located\s+in|in\s+the|in|at|near|area:|location:|neighborhood:)\s+([A-Z][a-zA-Z\s]+?)(?:\.|,|;|\n|$)/g,
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\s+(?:area|neighborhood|district|neighborhood|zip)/gi,
    /address:?\s*(.+?)(?:\.|,|\n|$)/gi,
  ];

  const stopWords = new Set(['The', 'This', 'That', 'Please', 'Call', 'Text', 'More', 'Info', 'Contact', 'For', 'Rent', 'Available', 'Fully', 'Semi', 'New']);

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match && match[1]) {
      const loc = match[1].trim();
      const firstWord = loc.split(' ')[0];
      if (!stopWords.has(firstWord) && loc.length > 2 && loc.length < 60) {
        return loc;
      }
    }
  }
  return null;
}

function extractFurnishedStatus(text) {
  const lowerText = text.toLowerCase();
  for (const [status, keywords] of Object.entries(FURNISHED_KEYWORDS)) {
    if (keywords.some(kw => lowerText.includes(kw))) {
      return status;
    }
  }
  return null;
}

function extractLeaseType(text) {
  const lowerText = text.toLowerCase();
  for (const [type, keywords] of Object.entries(LEASE_TYPE_KEYWORDS)) {
    if (keywords.some(kw => lowerText.includes(kw))) {
      return type;
    }
  }
  return null;
}

function extractAmenities(text) {
  const lowerText = text.toLowerCase();
  const found = [];
  for (const [amenity, keywords] of Object.entries(AMENITIES_MAP)) {
    if (keywords.some(kw => lowerText.includes(kw))) {
      // Don't double-add furnished as amenity (already its own field)
      if (amenity !== 'furnished') {
        found.push(amenity);
      }
    }
  }
  return found;
}

function extractPropertyType(text) {
  const lowerText = text.toLowerCase();
  if (/studio|efficiency apartment/.test(lowerText)) return 'Studio';
  if (/\d+\s*bhk/.test(lowerText)) {
    const match = lowerText.match(/(\d+)\s*bhk/);
    return match ? `${match[1]}BHK` : 'Apartment';
  }
  if (/condo/.test(lowerText)) return 'Condo';
  if (/townhouse|town house/.test(lowerText)) return 'Townhouse';
  if (/house|home/.test(lowerText)) return 'House';
  if (/flat/.test(lowerText)) return 'Flat';
  if (/room(?:\s+in)?/.test(lowerText)) return 'Room';
  if (/apartment|apt/.test(lowerText)) return 'Apartment';
  return 'Property';
}

/**
 * Compute a confidence score that this message is a rental listing (0-100)
 */
function computeConfidence(text, extracted) {
  let score = 0;
  const lowerText = text.toLowerCase();

  // Differentiate from marketplace selling posts (furniture, cars, electronics, etc.)
  const SELL_TRIGGER_KEYWORDS = [
    'selling', 'for sale', 'sale', 'moving sale', 'garage sale', 'buy', 
    'selling my', 'selling a', 'selling various', 'selling furniture', 
    'items for sale', 'selling items', 'selling electronics', 'selling car',
    'giving away', 'give away', 'selling desk', 'selling table', 'selling chair',
    'selling bed', 'selling mattress', 'selling sofa', 'selling couch', 'selling fridge',
    'sofa for sale', 'bed for sale', 'chair for sale', 'fridge for sale', 'desk for sale'
  ];

  const STRONG_RENTAL_KEYWORDS = [
    'rent', 'rental', 'lease', 'sublet', 'sublease', 'flatmate', 'roommate', 
    'accommodation', 'housemate', 'looking for flatmate', 'looking for roommate',
    '1bhk', '2bhk', '3bhk', 'studio apartment', 'to let', 'letting', 'tenant wanted',
    'looking for tenant', 'apartment for rent', 'room for rent', 'house for rent'
  ];

  const matchesSell = SELL_TRIGGER_KEYWORDS.some(kw => lowerText.includes(kw));
  const matchesStrongRental = STRONG_RENTAL_KEYWORDS.some(kw => lowerText.includes(kw));

  if (matchesSell && !matchesStrongRental) {
    return 0; // Rejected immediately
  }

  if (matchesStrongRental) {
    score += 30;
  }

  // Strong signals
  if (extracted.price) score += 35;
  if (extracted.bedrooms !== null) score += 20;
  if (lowerText.includes('for rent') || lowerText.includes('to let')) score += 25;
  if (lowerText.includes('available')) score += 10;
  if (extracted.availability) score += 10;
  if (extracted.amenities.length > 0) score += 10;

  // Count trigger keywords
  const triggerCount = RENTAL_TRIGGER_KEYWORDS.filter(kw => lowerText.includes(kw)).length;
  score += Math.min(triggerCount * 5, 20);

  // Penalty for very short messages unlikely to be listings
  if (text.length < 30) score -= 20;

  return Math.min(100, Math.max(0, score));
}

export function extractPhoneNumbers(text) {
  const phoneRegex = /(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
  const matches = text.match(phoneRegex) || [];
  const validNumbers = [];

  for (let m of matches) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
      if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(m) || /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(m)) {
        continue;
      }
      if (m.toLowerCase().includes('sqft') || m.toLowerCase().includes('sq ft')) {
        continue;
      }
      if (digits.length <= 4) {
        continue;
      }
      validNumbers.push(m.trim());
    }
  }
  return [...new Set(validNumbers)];
}

export function extractSpoc(text) {
  const patterns = [
    /(?:spoc|poc|contact)(?:\s*name)?\s*[:-]\s*([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/i,
    /(?:ping|contact|call|reach\s+out\s+to)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,1})(?:\s+at|\s+on|\s*[,.\n]|$)/i,
    /(?:spoc|poc|contact)\s+is\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/i,
  ];
  for (const p of patterns) {
    p.lastIndex = 0;
    const m = p.exec(text);
    if (m && m[1]) {
      const name = m[1].trim();
      const stopWords = new Set(['Me', 'Us', 'Now', 'Immediately', 'If', 'For', 'Any', 'Please']);
      if (!stopWords.has(name) && name.length > 2) {
        return name;
      }
    }
  }
  return null;
}

/**
 * Extract rental listing data from a WhatsApp message object
 * @param {Object} msg - {date, sender, message, group}
 * @returns {Object|null} - structured listing or null if not a rental
 */
export function extractListing(msg) {
  const text = msg.message;

  const extracted = {
    price: extractPrice(text),
    bedrooms: extractBedrooms(text),
    bathrooms: extractBathrooms(text),
    availability: extractAvailability(text),
    location: extractLocation(text),
    furnished: extractFurnishedStatus(text),
    leaseType: extractLeaseType(text),
    amenities: extractAmenities(text),
    propertyType: extractPropertyType(text),
  };

  const confidence = computeConfidence(text, extracted);

  // Only consider messages with confidence >= 30
  if (confidence < 30) return null;

  return {
    id: generateId(msg),
    sender: msg.sender,
    group: msg.group,
    date: msg.date,
    rawMessage: text,
    confidence,
    ...extracted,
    contacts: {
      phoneNumbers: extractPhoneNumbers(text),
      spocName: extractSpoc(text),
    },
    isDuplicate: false,
    duplicateCount: 0,
  };
}

function generateId(msg) {
  // Simple hash from sender + first 50 chars of message
  const str = `${msg.sender}::${msg.message.slice(0, 50)}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return `listing_${Math.abs(hash)}_${msg.date.getTime()}`;
}
