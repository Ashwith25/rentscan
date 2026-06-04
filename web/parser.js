/**
 * WhatsApp Chat Export Parser
 * Handles Android and iOS export formats, 12h/24h, multi-line messages
 */

const SYSTEM_MESSAGE_PATTERNS = [
  /messages and calls are end-to-end encrypted/i,
  /^.+ added .+$/i,
  /^.+ removed .+$/i,
  /^.+ left$/i,
  /^.+ joined using this group's invite link$/i,
  /^.+ changed the group name/i,
  /^.+ changed the group description/i,
  /^.+ changed this group's icon/i,
  /^.+ changed their phone number/i,
  /^.+ created group/i,
  /^\u200e/,  // Left-to-right mark (iOS system messages)
  /^<Media omitted>$/i,
  /^\[?\d{1,2}[/.]\d{1,2}[/.]\d{2,4},?\s*\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?\]?\s*-?\s*Messages and calls/i,
];

// Known WhatsApp export format regexes
// Group 1: date, Group 2: time, Group 3: sender, Group 4: message
const FORMAT_REGEXES = [
  // Android: "12/03/24, 9:42 am - Name: Message" or "12/03/2024, 9:42 AM - Name: Message"
  /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\s*[-–]\s*(.*?):\s*(.*)$/,
  // iOS bracketed: "[12.03.24, 09:42:00] Name: Message"
  /^\[(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*?):\s*(.*)$/,
  // iOS bracketed with AM/PM: "[12/03/24, 9:42:00 AM] Name: Message"
  /^\[(\d{1,2}[.\/\-]\d{1,2}[.\/\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\]\s*(.*?):\s*(.*)$/,
  // Format without comma: "12/03/24 9:42 AM - Name: Message"
  /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)\s*[-–]\s*(.*?):\s*(.*)$/,
];

function isSystemMessage(text) {
  return SYSTEM_MESSAGE_PATTERNS.some(p => p.test(text.trim()));
}

function parseTimestamp(dateStr, timeStr) {
  try {
    // Normalize date separators
    const normalizedDate = dateStr.replace(/\./g, '/');
    const combined = `${normalizedDate} ${timeStr}`.trim();
    const d = new Date(combined);
    if (!isNaN(d.getTime())) return d;

    // Try swapping month/day if first parse fails (DD/MM/YYYY)
    const parts = normalizedDate.split('/');
    if (parts.length === 3) {
      const swapped = `${parts[1]}/${parts[0]}/${parts[2]} ${timeStr}`.trim();
      const d2 = new Date(swapped);
      if (!isNaN(d2.getTime())) return d2;
    }
  } catch (e) {}
  return new Date();
}

/**
 * Parse a WhatsApp export text file into an array of message objects
 * @param {string} text - Raw content of the .txt file
 * @param {string} groupName - Name of the group (from filename)
 * @returns {Array<{date, sender, message, group}>}
 */
export function parseWhatsAppExport(text, groupName = 'Unknown Group') {
  const lines = text.split(/\r?\n/);
  const messages = [];
  let current = null;

  for (const line of lines) {
    let matched = false;

    for (const regex of FORMAT_REGEXES) {
      const m = line.match(regex);
      if (m) {
        // Save previous message
        if (current && !isSystemMessage(current.message)) {
          messages.push(current);
        }

        const [, dateStr, timeStr, sender, message] = m;
        current = {
          date: parseTimestamp(dateStr, timeStr),
          sender: sender.trim(),
          message: message.trim(),
          group: groupName,
        };
        matched = true;
        break;
      }
    }

    // Continuation line (no timestamp prefix)
    if (!matched && current && line.trim()) {
      current.message += '\n' + line.trim();
    }
  }

  // Push last message
  if (current && !isSystemMessage(current.message)) {
    messages.push(current);
  }

  return messages;
}
