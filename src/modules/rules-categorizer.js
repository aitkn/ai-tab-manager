/*
 * AI Tab Manager - Rules-Based Categorizer
 * Handles rule-based categorization without bias
 */

import { TAB_CATEGORIES } from '../utils/constants.js';

/**
 * Apply rules to categorize tabs without defaulting to any category
 * @param {Array} tabs - Array of tabs to categorize
 * @param {Array} rules - Array of rules to apply
 * @returns {Object} Object with categorized tabs and remaining uncategorized tabs
 */
export function applyRulesToTabs(tabs, rules) {
  const categorizedByRules = {
    [TAB_CATEGORIES.CAN_CLOSE]: [],
    [TAB_CATEGORIES.SAVE_LATER]: [],
    [TAB_CATEGORIES.IMPORTANT]: []
  };
  const uncategorizedTabs = [];
  
  tabs.forEach(tab => {
    let categorized = false;
    
    // Check each rule
    for (const rule of rules) {
      if (rule.enabled && matchesRule(tab, rule)) {
        const categoryKey = getCategoryKey(rule.category);
        if (categoryKey) {
          categorizedByRules[categoryKey].push(tab);
          categorized = true;
          break; // First matching rule wins
        }
      }
    }
    
    // If no rule matched, keep as uncategorized
    if (!categorized) {
      uncategorizedTabs.push(tab);
    }
  });
  
  return { categorizedByRules, uncategorizedTabs };
}

/**
 * Check if a tab matches a rule
 * @param {Object} tab - Tab to check
 * @param {Object} rule - Rule to check against
 * @returns {boolean} True if tab matches rule
 */
function matchesRule(tab, rule) {
  const url = tab.url.toLowerCase();
  const title = (tab.title || '').toLowerCase();
  const pattern = (rule.pattern || '').toLowerCase();
  
  if (!pattern) return false;
  
  switch (rule.type) {
    case 'domain':
      // Extract domain from URL
      try {
        const tabDomain = new URL(tab.url).hostname.toLowerCase();
        return tabDomain === pattern || tabDomain.endsWith('.' + pattern);
      } catch (e) {
        return false;
      }
      
    case 'url':
      return url.includes(pattern);
      
    case 'title':
      return title.includes(pattern);
      
    case 'regex':
      try {
        const regex = new RegExp(rule.pattern, 'i');
        return regex.test(url) || regex.test(title);
      } catch (e) {
        console.error('Invalid regex pattern:', rule.pattern);
        return false;
      }
      
    default:
      return false;
  }
}

/**
 * Get category key from category number
 * @param {number} category - Category number
 * @returns {string|null} Category key or null if invalid
 */
function getCategoryKey(category) {
  switch (category) {
    case 1: return TAB_CATEGORIES.CAN_CLOSE;
    case 2: return TAB_CATEGORIES.SAVE_LATER;
    case 3: return TAB_CATEGORIES.IMPORTANT;
    default: return null;
  }
}

/**
 * Create a rule prediction result
 * @param {Object} tab - Tab that was categorized
 * @param {Object} rule - Rule that matched
 * @param {number} category - Category assigned
 * @returns {Object} Rule prediction result
 */
export function createRulePrediction(tab, rule, category) {
  return {
    method: 'rules',
    category,
    confidence: 0.95, // High confidence for explicit rules
    rule: {
      id: rule.id,
      type: rule.type,
      pattern: rule.pattern
    },
    timestamp: Date.now()
  };
}

/**
 * Fallback categorization without default bias
 * Returns null for uncategorized tabs instead of defaulting to "Useful"
 * @param {Array} tabs - Array of tabs to categorize
 * @returns {Object} Categorized tabs with nulls for uncategorized
 */
export function unbiasedFallbackCategorization(tabs) {
  const categorized = { 
    [TAB_CATEGORIES.CAN_CLOSE]: [], 
    [TAB_CATEGORIES.SAVE_LATER]: [], 
    [TAB_CATEGORIES.IMPORTANT]: [],
    uncategorized: []
  };
  
  const canClosePatterns = [
    'chrome://', 'chrome-extension://', 'about:blank',
    '/login', '/signin', '/auth', '404', 'error', 'not found'
  ];
  
  const importantPatterns = [
    'claude.ai/chat/', 'chatgpt.com/', 'chat.openai.com/',
    '/docs/', '/documentation/', '/api/'
  ];
  
  tabs.forEach(tab => {
    const url = tab.url.toLowerCase();
    const title = (tab.title || '').toLowerCase();
    
    // Check for can close patterns
    if (canClosePatterns.some(pattern => 
      url.includes(pattern) || title.includes(pattern)
    )) {
      categorized[TAB_CATEGORIES.CAN_CLOSE].push(tab);
    }
    // Check for important patterns
    else if (importantPatterns.some(pattern => 
      url.includes(pattern) || title.includes(pattern)
    )) {
      categorized[TAB_CATEGORIES.IMPORTANT].push(tab);
    }
    // Don't default to "Useful" - keep as uncategorized
    else {
      categorized.uncategorized.push(tab);
    }
  });
  
  return categorized;
}

export default {
  applyRulesToTabs,
  createRulePrediction,
  unbiasedFallbackCategorization
};