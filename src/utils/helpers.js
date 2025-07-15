/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Pure helper functions extracted from popup.js
 */

import { TEST_MODE } from './constants.js';

/**
 * Dialog testing utilities for programmatic control
 */
export const DialogTesting = {
  // Storage for dialog interactions
  dialogHistory: [],
  programmaticAnswers: [], // Queue of programmatic answers
  
  /**
   * Setup programmatic dialog answers for testing
   * @param {Array} answers - Array of {message: string/regex, answer: boolean} objects
   */
  setupAnswers: function(answers) {
    this.programmaticAnswers = [...answers];
    console.log(`[DIALOG TESTING] Setup ${answers.length} programmatic answers`);
  },
  
  /**
   * Clear all programmatic answers
   */
  clearAnswers: function() {
    this.programmaticAnswers = [];
    this.dialogHistory = [];
    console.log(`[DIALOG TESTING] Cleared all programmatic answers and history`);
  },
  
  /**
   * Get dialog history for verification
   */
  getHistory: function() {
    return [...this.dialogHistory];
  },
  
  /**
   * Check if a specific dialog was shown
   */
  wasDialogShown: function(messagePattern) {
    return this.dialogHistory.some(entry => {
      if (typeof messagePattern === 'string') {
        return entry.message === messagePattern;
      } else if (messagePattern instanceof RegExp) {
        return messagePattern.test(entry.message);
      }
      return false;
    });
  }
};

/**
 * Show a demo dialog window in test mode for visual feedback
 * @param {string} message - The dialog message
 * @param {boolean} answer - The programmatic answer
 * @param {string} testId - Optional test identifier
 */
function showDemoDialog(message, answer, testId) {
  try {
    // Create demo dialog overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease-out;
    `;
    
    // Create demo dialog box
    const dialogBox = document.createElement('div');
    dialogBox.style.cssText = `
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      max-width: 400px;
      min-width: 300px;
      padding: 0;
      animation: slideIn 0.3s ease-out;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    
    // Create dialog content
    dialogBox.innerHTML = `
      <div style="padding: 20px 24px 16px; border-bottom: 1px solid #e0e0e0;">
        <div style="font-size: 16px; font-weight: 500; color: #333; margin-bottom: 4px;">
          ${testId ? `[${testId}] ` : ''}Confirm Dialog
        </div>
        <div style="font-size: 14px; color: #666; line-height: 1.4;">
          ${message}
        </div>
      </div>
      <div style="padding: 16px 24px; display: flex; justify-content: flex-end; gap: 12px; background: #f9f9f9;">
        <button class="demo-cancel" style="
          padding: 8px 16px;
          border: 1px solid #d0d0d0;
          background: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          color: #666;
          ${!answer ? 'background: #f44336; color: white; border-color: #f44336;' : ''}
        ">Cancel</button>
        <button class="demo-ok" style="
          padding: 8px 16px;
          border: 1px solid #1976d2;
          background: #1976d2;
          color: white;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          ${answer ? 'background: #4caf50; border-color: #4caf50;' : 'opacity: 0.6;'}
        ">OK</button>
      </div>
    `;
    
    // Add CSS animations if not already present
    if (!document.getElementById('demo-dialog-styles')) {
      const style = document.createElement('style');
      style.id = 'demo-dialog-styles';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from { transform: scale(0.9) translateY(-10px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes slideOut {
          from { transform: scale(1) translateY(0); opacity: 1; }
          to { transform: scale(0.9) translateY(-10px); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
    
    overlay.appendChild(dialogBox);
    document.body.appendChild(overlay);
    
    // Highlight the chosen answer
    const answerText = answer ? 'OK' : 'Cancel';
    console.log(`[DEMO] Showing dialog: "${message}" -> Auto-answering with ${answerText}`);
    
    // Auto-remove dialog after a short delay
    setTimeout(() => {
      dialogBox.style.animation = 'slideOut 0.2s ease-in';
      overlay.style.opacity = '0';
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, 200);
    }, (typeof window !== 'undefined' ? window.demoDialogDuration : undefined) || 1500); // Use configurable duration
    
  } catch (error) {
    console.warn('[DEMO] Failed to show demo dialog:', error.message);
  }
}

/**
 * Smart confirm dialog that can be controlled programmatically in test mode
 * @param {string} message - The confirmation message
 * @param {Object} options - Configuration options
 * @param {boolean} options.defaultAnswer - Default answer when no programmatic answer is set
 * @param {string} options.testId - Optional test identifier for easier tracking
 * @returns {Promise<boolean>} User's choice (or programmatic answer in test mode)
 */
export async function smartConfirm(message, options = {}) {
  const { defaultAnswer = true, testId } = options;
  
  // Always record dialog attempts for testing verification
  const dialogEntry = {
    message,
    testId,
    timestamp: new Date().toISOString(),
    answer: null,
    mode: TEST_MODE.isTestEnvironment() ? 'test' : 'normal'
  };
  
  if (TEST_MODE.isTestEnvironment()) {
    // Show demo dialog if in demo mode
    if (typeof window !== 'undefined' && window.demoMode) {
      showDemoDialog(message, defaultAnswer, testId);
    }
    
    // Check for programmatic answers first
    const programmaticIndex = DialogTesting.programmaticAnswers.findIndex(entry => {
      if (typeof entry.message === 'string') {
        return entry.message === message;
      } else if (entry.message instanceof RegExp) {
        return entry.message.test(message);
      }
      return false;
    });
    
    if (programmaticIndex !== -1) {
      // Use programmatic answer and remove it from queue
      const programmaticAnswer = DialogTesting.programmaticAnswers.splice(programmaticIndex, 1)[0];
      dialogEntry.answer = programmaticAnswer.answer;
      dialogEntry.source = 'programmatic';
      
      DialogTesting.dialogHistory.push(dialogEntry);
      console.log(`[TEST MODE] Programmatic answer for dialog: "${message}" -> ${programmaticAnswer.answer}`);
      return programmaticAnswer.answer;
    }
    
    // Fall back to default answer
    dialogEntry.answer = defaultAnswer;
    dialogEntry.source = 'default';
    
    DialogTesting.dialogHistory.push(dialogEntry);
    console.log(`[TEST MODE] Auto-answering confirm dialog: "${message}" with default ${defaultAnswer}`);
    return defaultAnswer;
  }
  
  // Normal mode - use HTML dialog instead of native confirm
  const { showConfirm } = await import('./dialog-utils.js');
  const userAnswer = await showConfirm(message, {
    confirmType: 'primary',
    ...options
  });
  dialogEntry.answer = userAnswer;
  dialogEntry.source = 'user';
  
  DialogTesting.dialogHistory.push(dialogEntry);
  return userAnswer;
}

/**
 * Extract root domain from a full domain
 * @param {string} domain - Full domain (e.g., 'sub.example.co.uk')
 * @returns {string} Root domain (e.g., 'example.co.uk')
 */
export function getRootDomain(domain) {
  if (!domain) return 'unknown';
  
  // Handle special cases
  if (domain.startsWith('chrome://')) return 'chrome';
  if (domain.startsWith('file://')) return 'local-file';
  if (domain.startsWith('chrome-extension://')) return 'extension';
  
  // Remove www. prefix
  domain = domain.replace(/^www\./, '');
  
  // Handle special TLDs (could be expanded)
  const specialTLDs = ['co.uk', 'com.au', 'co.jp', 'co.in', 'com.br'];
  for (const tld of specialTLDs) {
    if (domain.endsWith('.' + tld)) {
      const parts = domain.split('.');
      // For special TLDs, we want to keep the last 3 parts (domain.co.uk)
      if (parts.length >= 3) {
        return parts.slice(-3).join('.');
      }
      return domain;
    }
  }
  
  // Default: last two parts
  const parts = domain.split('.');
  if (parts.length > 2) {
    return parts.slice(-2).join('.');
  }
  return domain;
}

/**
 * Extract subdomain from a full domain
 * @param {string} fullDomain - Full domain
 * @param {string} rootDomain - Root domain
 * @returns {string} Subdomain or empty string
 */
export function getSubdomain(fullDomain, rootDomain) {
  // Handle undefined or null domains
  if (!fullDomain || !rootDomain) return '';
  if (fullDomain === rootDomain) return '';
  const subdomain = fullDomain.replace(`.${rootDomain}`, '');
  return subdomain === fullDomain ? '' : subdomain;
}

/**
 * Extract date from various group name formats
 * @param {string} groupName - Group name containing date info
 * @returns {Date} Parsed date or current date if parsing fails
 */
export function extractDateFromGroupName(groupName) {
  // Handle relative dates
  if (groupName === 'Today') {
    return new Date();
  }
  if (groupName === 'Yesterday') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date;
  }
  if (groupName === 'This Week') {
    return new Date(); // Current week
  }
  if (groupName === 'Last Week') {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date;
  }
  
  // Handle "X days ago" format
  const daysAgoMatch = groupName.match(/(\d+) days ago/);
  if (daysAgoMatch) {
    const daysAgo = parseInt(daysAgoMatch[1]);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date;
  }
  
  // Handle "Week of Mon DD" format
  const weekOfMatch = groupName.match(/Week of (\w+) (\d+)/);
  if (weekOfMatch) {
    const currentYear = new Date().getFullYear();
    const monthName = weekOfMatch[1];
    const day = parseInt(weekOfMatch[2]);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames.indexOf(monthName);
    if (month !== -1) {
      return new Date(currentYear, month, day);
    }
  }
  
  // Handle month names
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  for (let i = 0; i < monthNames.length; i++) {
    if (groupName.includes(monthNames[i])) {
      return new Date(new Date().getFullYear(), i, 1);
    }
  }
  
  // Default to current date
  return new Date();
}

/**
 * Sort tabs within a group based on grouping type
 * @param {Array} tabs - Array of tabs to sort
 * @param {string} groupingType - Type of grouping
 * @returns {Array} Sorted array of tabs
 */
export function sortTabsInGroup(tabs, groupingType) {
  return tabs.sort((a, b) => {
    // Define category order: Uncategorized (0), Important (3), Useful (2), Ignore (1)
    const categoryOrder = [0, 3, 2, 1];
    
    switch (groupingType) {
      case 'category': {
        // Sort by domain, then by title
        const domainCompare = (a.domain || '').localeCompare(b.domain || '');
        if (domainCompare !== 0) return domainCompare;
        return (a.title || '').localeCompare(b.title || '');
      }
        
      case 'domain': {
        // Sort by category order, then by title
        const categoryA = a.category !== undefined ? a.category : 0;
        const categoryB = b.category !== undefined ? b.category : 0;
        const orderA = categoryOrder.indexOf(categoryA);
        const orderB = categoryOrder.indexOf(categoryB);
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return (a.title || '').localeCompare(b.title || '');
      }
      
      // Time-based groupings for current tabs
      case 'opened': {
        // Within same time group, sort by actual opened time (newest first)
        const timeA = a.firstOpened ? new Date(a.firstOpened).getTime() : 0;
        const timeB = b.firstOpened ? new Date(b.firstOpened).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return (a.title || '').localeCompare(b.title || '');
      }
      
      case 'lastActive': {
        // Within same time group, sort by last accessed (most recent first)
        const timeA = a.lastAccessed || 0;
        const timeB = b.lastAccessed || 0;
        if (timeA !== timeB) return timeB - timeA;
        return (a.title || '').localeCompare(b.title || '');
      }
      
      case 'timeOpen': {
        // Within same duration group, sort by actual duration (longest open first)
        const now = Date.now();
        const durationA = a.firstOpened ? now - new Date(a.firstOpened).getTime() : 0;
        const durationB = b.firstOpened ? now - new Date(b.firstOpened).getTime() : 0;
        if (durationA !== durationB) return durationB - durationA;
        return (a.title || '').localeCompare(b.title || '');
      }
      
      // Time-based groupings for saved tabs
      case 'originallyOpened': {
        // Sort by original opened time (newest first)
        const timeA = a.firstOpened ? new Date(a.firstOpened).getTime() : 0;
        const timeB = b.firstOpened ? new Date(b.firstOpened).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return (a.title || '').localeCompare(b.title || '');
      }
      
      case 'lastViewed': {
        // Sort by last accessed time (most recent first)
        const timeA = a.lastAccessed ? new Date(a.lastAccessed).getTime() : 0;
        const timeB = b.lastAccessed ? new Date(b.lastAccessed).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return (a.title || '').localeCompare(b.title || '');
      }
      
      case 'saved': {
        // Sort by saved date (newest first)
        const timeA = a.savedDate ? new Date(a.savedDate).getTime() : 0;
        const timeB = b.savedDate ? new Date(b.savedDate).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return (a.title || '').localeCompare(b.title || '');
      }
      
      case 'totalAge': {
        // Within same age group, sort by actual age (oldest first)
        const now = Date.now();
        const ageA = a.firstOpened ? now - new Date(a.firstOpened).getTime() : 0;
        const ageB = b.firstOpened ? now - new Date(b.firstOpened).getTime() : 0;
        if (ageA !== ageB) return ageB - ageA;
        return (a.title || '').localeCompare(b.title || '');
      }
      
      case 'timeSinceViewed': {
        // Within same group, sort by time since viewed (longest time first)
        const now = Date.now();
        const timeSinceA = a.lastAccessed ? now - new Date(a.lastAccessed).getTime() : Number.MAX_SAFE_INTEGER;
        const timeSinceB = b.lastAccessed ? now - new Date(b.lastAccessed).getTime() : Number.MAX_SAFE_INTEGER;
        if (timeSinceA !== timeSinceB) return timeSinceB - timeSinceA;
        return (a.title || '').localeCompare(b.title || '');
      }
      
      // ML-based groupings
      case 'predictionConfidence': {
        // Within same confidence group, sort by actual confidence (highest first)
        const confA = a.mlMetadata?.confidence || 0;
        const confB = b.mlMetadata?.confidence || 0;
        if (confA !== confB) return confB - confA;
        // Then by category importance
        const catA = a.category !== undefined ? a.category : 0;
        const catB = b.category !== undefined ? b.category : 0;
        const ordA = categoryOrder.indexOf(catA);
        const ordB = categoryOrder.indexOf(catB);
        if (ordA !== ordB) return ordA - ordB;
        return (a.title || '').localeCompare(b.title || '');
      }
      
      case 'predictionAgreement': {
        // Within same agreement group, sort by confidence (highest first)
        const confA = a.mlMetadata?.confidence || 0;
        const confB = b.mlMetadata?.confidence || 0;
        if (confA !== confB) return confB - confA;
        // Then by agreement score
        const agreeA = a.mlMetadata?.agreement || 0;
        const agreeB = b.mlMetadata?.agreement || 0;
        if (agreeA !== agreeB) return agreeB - agreeA;
        return (a.title || '').localeCompare(b.title || '');
      }
        
      case 'savedDate':
      case 'savedWeek':
      case 'savedMonth':
      case 'lastAccessedDate':
      case 'lastAccessedWeek':
      case 'lastAccessedMonth':
      case 'closeTime': {
        // Sort by category order, then domain, then title
        const catA = a.category !== undefined ? a.category : 0;
        const catB = b.category !== undefined ? b.category : 0;
        const ordA = categoryOrder.indexOf(catA);
        const ordB = categoryOrder.indexOf(catB);
        if (ordA !== ordB) {
          return ordA - ordB;
        }
        const domainCmp = (a.domain || '').localeCompare(b.domain || '');
        if (domainCmp !== 0) return domainCmp;
        return (a.title || '').localeCompare(b.title || '');
      }
        
      default:
        // Default: sort by title
        return (a.title || '').localeCompare(b.title || '');
    }
  });
}

/**
 * Sort sections/groups based on grouping type
 * @param {Array} groups - Array of [groupName, groupData] entries
 * @param {string} groupingType - Type of grouping
 * @returns {Array} Sorted array of groups
 */
export function sortGroups(groups, groupingType) {
  // Define category order: Uncategorized (0), Important (3), Useful (2), Ignore (1)
  const categoryOrder = {
    'Uncategorized': 0,
    'Important': 1,
    'Save Later': 2,
    'Useful': 2,  // Alias for Save Later
    'Can Close': 3,
    'Ignore': 3   // Alias for Can Close
  };
  
  return groups.sort((a, b) => {
    const [nameA] = a;
    const [nameB] = b;
    
    switch (groupingType) {
      case 'category': {
        // Sort by predefined category order
        const orderA = categoryOrder[nameA] !== undefined ? categoryOrder[nameA] : 999;
        const orderB = categoryOrder[nameB] !== undefined ? categoryOrder[nameB] : 999;
        return orderA - orderB;
      }
        
      case 'domain':
        // Sort alphabetically by domain name
        return nameA.localeCompare(nameB);
        
      case 'savedDate':
      case 'savedWeek':
      case 'savedMonth':
      case 'lastAccessedDate':
      case 'lastAccessedWeek':
      case 'lastAccessedMonth':
      case 'closeTime':
        // These are already sorted by date (newest first) in tab-display.js
        return 0;
        
      default:
        // Default alphabetical sort
        return nameA.localeCompare(nameB);
    }
  });
}

/**
 * Get ISO week number for a date
 * @param {Date} date - Date to get week number for
 * @returns {number} ISO week number (1-53)
 */
export function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Get the Monday of the week for a given date
 * @param {Date} date - Date to get week start for
 * @returns {Date} Monday of that week
 */
export function getWeekStartDate(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  return new Date(d.setDate(diff));
}

/**
 * Fallback categorization when API is unavailable
 * @param {Array} tabs - Array of tabs to categorize
 * @returns {Object} Categorized tabs {1: [], 2: [], 3: []}
 */
export function fallbackCategorization(tabs) {
  const categorized = { 1: [], 2: [], 3: [] };
  
  const frequentDomains = CONFIG?.FREQUENT_DOMAINS || [
    'mail.google.com', 'gmail.com', 'x.com', 'twitter.com', 
    'youtube.com', 'google.com', 'facebook.com', 'instagram.com', 
    'linkedin.com', 'reddit.com', 'github.com'
  ];
  
  tabs.forEach(tab => {
    const url = tab.url.toLowerCase();
    const title = tab.title.toLowerCase();
    
    // Category 1: Can be closed
    if (url.includes('chrome://') || 
        url.includes('chrome-extension://') ||
        url === 'about:blank' ||
        title.includes('404') ||
        title.includes('error') ||
        title.includes('not found') ||
        url.includes('/login') ||
        url.includes('/signin') ||
        url.includes('/auth') ||
        frequentDomains.some(domain => url.includes(domain) && !url.includes('/status/'))) {
      categorized[1].push(tab);
    }
    // Category 3: Important
    else if (url.includes('claude.ai/chat/') ||
             url.includes('chatgpt.com/') ||
             url.includes('chat.openai.com/') ||
             url.includes('grok.com/chat/') ||
             url.includes('github.com/') && !url.endsWith('github.com/') ||
             url.includes('/docs/') ||
             url.includes('/documentation/') ||
             url.includes('/api/') ||
             title.includes('documentation')) {
      categorized[3].push(tab);
    }
    // Category 2: Save for later (default)
    else {
      categorized[2].push(tab);
    }
  });
  
  return categorized;
}

/**
 * Extract domain from URL
 * @param {string} url - URL to extract domain from
 * @returns {string} Domain or 'unknown'
 */
export function extractDomain(url) {
  try {
    // Handle special URL schemes before using URL constructor
    if (url.startsWith('about:')) return 'about';
    if (url.startsWith('chrome://')) return 'chrome';
    if (url.startsWith('chrome-extension://')) return 'extension';
    if (url.startsWith('file://')) return 'local-file';
    if (url.startsWith('moz-extension://')) return 'extension';
    if (url.startsWith('data:')) return 'data';
    
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/^www\./, '');
    
    // Use getRootDomain to extract the primary domain
    return getRootDomain(hostname);
  } catch {
    return 'unknown';
  }
}

/**
 * Format timestamp to readable date
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Formatted date string
 */
export function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Format timestamp to readable date and time
 * @param {number} timestamp - Unix timestamp
 * @returns {string} Formatted date and time string
 */
export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString();
}

/**
 * Check if URL is valid
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
export function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'file:', 'chrome:', 'chrome-extension:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Truncate text to specified length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text with ellipsis if needed
 */
export function truncateText(text, maxLength = 50) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Group array items by a key function
 * @param {Array} items - Items to group
 * @param {Function} keyFn - Function to get group key from item
 * @returns {Object} Grouped items
 */
export function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
    return groups;
  }, {});
}

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Parse a CSV line handling quoted fields with commas
 * @param {string} line - CSV line to parse
 * @returns {string[]} Array of parsed values
 */
export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  
  return result;
}