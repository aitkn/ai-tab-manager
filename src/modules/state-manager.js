/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * State management module - handles all state persistence and restoration
 */

import { TAB_CATEGORIES } from '../utils/constants.js';
import StorageService from '../services/StorageService.js';
import logger from '../utils/logger.js';

// Global state object
export const state = {
  isViewingSaved: false,
  searchQuery: '',
  isInitializing: true,
  popupState: {
    isViewingSaved: false,
    searchQuery: '',
    activeTab: 'categorize',
    groupingSelections: {
      categorize: 'category',
      saved: 'category'
    },
    scrollPositions: {},
    categoryFilters: {
      current: {
        important: true,   // Category 3 - pressed by default
        useful: true,      // Category 2 - pressed by default  
        ignore: true       // Category 1 - pressed by default (visible on current tabs)
      },
      saved: {
        important: true,   // Category 3 - pressed by default
        useful: true,      // Category 2 - pressed by default  
        ignore: false      // Category 1 - unpressed by default
      }
    },
    groupCollapseStates: {
      categorize: {},    // Stores collapse states for current tabs view
      saved: {}          // Stores collapse states for saved tabs view
    },
    globalCollapseStatus: {
      categorize: 'undefined',  // 'collapsed', 'expanded', or 'undefined'
      saved: 'undefined'        // 'collapsed', 'expanded', or 'undefined'
    }
  },
  settings: {
    provider: 'Claude',
    model: '',
    apiKeys: {},
    selectedModels: {},
    customPrompt: '',
    promptVersion: 1,
    isPromptCustomized: false,
    maxTabsToOpen: 50,
    rules: [],  // Array of rule objects
    useLLM: true,  // Whether to use LLM for categorization
    useML: true,  // Whether to use ML categorization
    mlEarlyStoppingPatience: 100,  // Stop after N epochs without improvement
    mlBatchSize: 64,  // Training batch size
    mlLearningRate: 0.001,  // Learning rate for training
    hasConfiguredSettings: false,  // First-time use flag
    defaultRulesApplied: false,  // Whether default rules have been added
    openInFullWindow: false  // Whether to open extension in full window by default
  }
};

// State change listeners
const stateListeners = [];

/**
 * Subscribe to state changes
 * @param {Function} listener - Callback function
 * @returns {Function} Unsubscribe function
 */
export function subscribeToState(listener) {
  stateListeners.push(listener);
  return () => {
    const index = stateListeners.indexOf(listener);
    if (index > -1) {
      stateListeners.splice(index, 1);
    }
  };
}

/**
 * Notify all state listeners
 */
function notifyStateListeners() {
  stateListeners.forEach(listener => listener(state));
}

/**
 * Update state and notify listeners
 * @param {string} key - State key to update
 * @param {any} value - New value
 */
export function updateState(key, value) {
  if (Object.prototype.hasOwnProperty.call(state, key)) {
    state[key] = value;
    notifyStateListeners();
  }
}

/**
 * Update nested state
 * @param {string} path - Dot notation path (e.g., 'popupState.isViewingSaved')
 * @param {any} value - New value
 */
export function updateNestedState(path, value) {
  const keys = path.split('.');
  let obj = state;
  
  for (let i = 0; i < keys.length - 1; i++) {
    obj = obj[keys[i]];
  }
  
  obj[keys[keys.length - 1]] = value;
  notifyStateListeners();
}

/**
 * Save current popup state to storage
 */
export async function savePopupState() {
  if (state.isInitializing) {
    logger.uiState('Skipping state save during initialization');
    return;
  }

  // Update popup state object
  state.popupState.isViewingSaved = state.isViewingSaved;
  state.popupState.searchQuery = state.searchQuery;
  
  // Get current scroll positions for all scrollable containers
  const tabsContainer = document.getElementById('tabsContainer');
  const savedContent = document.getElementById('savedContent');
  
  if (tabsContainer && tabsContainer.scrollTop > 0) {
    state.popupState.scrollPositions.categorize = tabsContainer.scrollTop;
  }
  if (savedContent && savedContent.scrollTop > 0) {
    state.popupState.scrollPositions.saved = savedContent.scrollTop;
  }

  try {
    await StorageService.savePopupState(state.popupState);
    } catch (error) {
    logger.error('Error saving popup state:', error);
  }
}

/**
 * Load saved state from storage
 */
export async function loadSavedState() {
  try {
    // Load popup state
    const savedPopupState = await StorageService.loadPopupState();
    if (savedPopupState) {
      Object.assign(state.popupState, savedPopupState);
      
      state.isViewingSaved = savedPopupState.isViewingSaved || false;
      state.searchQuery = savedPopupState.searchQuery || '';
    }
    
    // Always ensure categoryFilters has the correct structure (whether state was loaded or not)
    if (!state.popupState.categoryFilters || 
        !state.popupState.categoryFilters.current || 
        !state.popupState.categoryFilters.saved) {
      
      // Check if we have old format to migrate
      const oldFilters = (savedPopupState && savedPopupState.categoryFilters && 
                         !savedPopupState.categoryFilters.current && 
                         !savedPopupState.categoryFilters.saved) ? 
                         savedPopupState.categoryFilters : null;
      
      // Set up new structure
      state.popupState.categoryFilters = {
        current: {
          important: true,   // Default to visible for current tabs
          useful: true,      // Default to visible for current tabs
          ignore: true       // Default to visible for current tabs (as requested)
        },
        saved: {
          important: oldFilters ? (oldFilters.important !== undefined ? oldFilters.important : true) : true,
          useful: oldFilters ? (oldFilters.useful !== undefined ? oldFilters.useful : true) : true,
          ignore: oldFilters ? (oldFilters.ignore !== undefined ? oldFilters.ignore : false) : false
        }
      };
      
      // Save the updated state
      await savePopupState();
    }
    
    // Load settings
    const savedSettings = await StorageService.loadSettings();
    if (savedSettings) {
      Object.assign(state.settings, savedSettings);
      
      // Ensure rules array exists even if loaded settings don't have it
      if (!Array.isArray(state.settings.rules)) {
        state.settings.rules = [];
      }
    }
    
    // Apply defaults from CONFIG if available and not already set
    if (typeof CONFIG !== 'undefined') {
      if (!state.settings.provider || state.settings.provider === '') {
        state.settings.provider = CONFIG.DEFAULT_PROVIDER || 'Claude';
      }
      if (!state.settings.customPrompt || state.settings.customPrompt === '') {
        state.settings.customPrompt = CONFIG.DEFAULT_PROMPT || '';
      }
      if (!state.settings.promptVersion || state.settings.promptVersion === 1) {
        state.settings.promptVersion = CONFIG.PROMPT_VERSION || 1;
      }
    } else {
      logger.warn('CONFIG not available when loading settings');
    }
    
    // Apply default rules if not already applied or if rules array is empty
    // More robust check - apply default rules if:
    // 1. defaultRulesApplied flag is not true, OR
    // 2. rules array doesn't exist, OR  
    // 3. rules array is empty
    const shouldApplyDefaultRules = 
      state.settings.defaultRulesApplied !== true || 
      !Array.isArray(state.settings.rules) || 
      state.settings.rules.length === 0;
    
    if (shouldApplyDefaultRules) {
      const defaultRules = getDefaultRules();
      
      // Ensure rules array exists
      if (!state.settings.rules) {
        state.settings.rules = [];
      }
      
      // If rules is still not an array at this point, initialize it
      if (!Array.isArray(state.settings.rules)) {
        state.settings.rules = [];
      }
      
      // Only add rules that don't already exist (check by id)
      const existingIds = new Set(state.settings.rules.map(r => r.id));
      const newRules = defaultRules.filter(rule => !existingIds.has(rule.id));
      
      if (newRules.length > 0) {
        // Add new default rules at the beginning
        state.settings.rules = [...newRules, ...state.settings.rules];
        logger.uiState('Added', newRules.length, 'new default rules');
      } else if (state.settings.rules.length === 0) {
        // If no new rules were added but rules is empty, force add all defaults
        state.settings.rules = [...defaultRules];
      }
      
      state.settings.defaultRulesApplied = true;
      // Also mark as configured since we've set up default rules
      state.settings.hasConfiguredSettings = true;
      
      await StorageService.saveSettings(state.settings);
      logger.uiState('Default rules initialization complete. Total rules:', state.settings.rules.length);
    }
    
    return true;
  } catch (error) {
    logger.error('Error loading saved state:', error);
    return false;
  }
}

/**
 * Restore scroll position for a container
 * @param {string} containerId - ID of the container
 * @param {number} scrollTop - Scroll position
 * @param {number} retryCount - Number of retries
 */
export function restoreScrollPosition(containerId, scrollTop, retryCount = 0) {
  const container = document.getElementById(containerId);
  
  if (container && scrollTop > 0) {
    // Check if content is ready (has height)
    if (container.scrollHeight > container.clientHeight) {
      logger.uiState(`Restoring scroll position for ${containerId}: ${scrollTop}`);
      container.scrollTop = scrollTop;
      
      // Verify it was set (sometimes needs a delay)
      setTimeout(() => {
        if (container.scrollTop !== scrollTop && retryCount < 2) {
          logger.uiState(`Retrying scroll restoration for ${containerId}`);
          restoreScrollPosition(containerId, scrollTop, retryCount + 1);
        }
      }, 100);
    } else if (retryCount < 3) {
      // Content not ready yet, retry
      setTimeout(() => {
        restoreScrollPosition(containerId, scrollTop, retryCount + 1);
      }, retryCount === 0 ? 100 : 500);
    }
  }
}

/**
 * Get default categorization rules
 * @returns {Array} Default rules
 */
export function getDefaultRules() {
  return [
    // Essential rules covering most common patterns - let ML learn user preferences over time
    
    // Category 3: Important - Specific content that's hard to find again
    {
      id: 'default-1',
      type: 'url_contains',
      value: '/checkout',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-2',
      type: 'url_contains',
      value: '/payment',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-3',
      type: 'title_contains',
      value: 'Unsaved',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-4',
      type: 'title_contains',
      value: 'Draft',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    // Specific articles and posts
    {
      id: 'default-5',
      type: 'url_contains',
      value: 'youtube.com/watch',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-6',
      type: 'url_contains',
      value: 'x.com/status/',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-7',
      type: 'url_contains',
      value: 'twitter.com/status/',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-8',
      type: 'url_contains',
      value: 'reddit.com/r/',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-9',
      type: 'url_contains',
      value: '/article',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-10',
      type: 'url_contains',
      value: '/news/',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-11',
      type: 'url_contains',
      value: 'techcrunch.com/',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    {
      id: 'default-12',
      type: 'url_contains',
      value: 'arstechnica.com/',
      category: TAB_CATEGORIES.IMPORTANT,
      enabled: true
    },
    
    // Category 2: Useful - LLM conversations and useful content
    {
      id: 'default-13',
      type: 'url_contains',
      value: 'claude.ai/chat/',
      category: TAB_CATEGORIES.SAVE_LATER,
      enabled: true
    },
    {
      id: 'default-14',
      type: 'url_contains',
      value: 'chatgpt.com/c/',
      category: TAB_CATEGORIES.SAVE_LATER,
      enabled: true
    },
    {
      id: 'default-15',
      type: 'url_contains',
      value: 'gemini.google.com/app/',
      category: TAB_CATEGORIES.SAVE_LATER,
      enabled: true
    },
    {
      id: 'default-16',
      type: 'url_contains',
      value: 'poe.com/chat/',
      category: TAB_CATEGORIES.SAVE_LATER,
      enabled: true
    },
    
    // Category 1: Ignore (Can Close) - Homepages that are easy to find again
    {
      id: 'default-17',
      type: 'title_contains',
      value: 'New Tab',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-18',
      type: 'title_contains',
      value: 'Google Search',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    // Top 10 sites homepages
    {
      id: 'default-19',
      type: 'regex',
      value: '^https?://(www\\.)?google\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-20',
      type: 'regex',
      value: '^https?://(www\\.)?youtube\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-21',
      type: 'regex',
      value: '^https?://(www\\.)?facebook\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-22',
      type: 'regex',
      value: '^https?://(www\\.)?amazon\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-23',
      type: 'regex',
      value: '^https?://(www\\.)?wikipedia\\.org/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-24',
      type: 'regex',
      value: '^https?://(www\\.)?twitter\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-25',
      type: 'regex',
      value: '^https?://(www\\.)?x\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-26',
      type: 'regex',
      value: '^https?://(www\\.)?instagram\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-27',
      type: 'regex',
      value: '^https?://(www\\.)?linkedin\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-28',
      type: 'regex',
      value: '^https?://(www\\.)?reddit\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    // Email homepages
    {
      id: 'default-29',
      type: 'regex',
      value: '^https?://(mail\\.)?google\\.com/(mail/?)?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-30',
      type: 'regex',
      value: '^https?://(www\\.)?outlook\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-31',
      type: 'regex',
      value: '^https?://(www\\.)?yahoo\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    // Bank homepages
    {
      id: 'default-32',
      type: 'regex',
      value: '^https?://(www\\.)?bankofamerica\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-33',
      type: 'regex',
      value: '^https?://(www\\.)?chase\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-34',
      type: 'regex',
      value: '^https?://(www\\.)?wellsfargo\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    // News homepages
    {
      id: 'default-35',
      type: 'regex',
      value: '^https?://(www\\.)?cnn\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-36',
      type: 'regex',
      value: '^https?://(www\\.)?bbc\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-37',
      type: 'regex',
      value: '^https?://(www\\.)?nytimes\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    },
    {
      id: 'default-38',
      type: 'regex',
      value: '^https?://(www\\.)?washingtonpost\\.com/?$',
      field: 'url',
      category: TAB_CATEGORIES.CAN_CLOSE,
      enabled: true
    }
  ];
}

/**
 * Clear categorized tabs state
 */
export function clearCategorizedTabs() {
  state.categorizedTabs = {
    [TAB_CATEGORIES.UNCATEGORIZED]: [],
    [TAB_CATEGORIES.CAN_CLOSE]: [],
    [TAB_CATEGORIES.SAVE_LATER]: [],
    [TAB_CATEGORIES.IMPORTANT]: []
  };
  state.urlToDuplicateIds = {};
  notifyStateListeners();
}

/**
 * Reset group collapse states for new session
 * Called on popup initialization to start with all groups expanded
 */
export function resetGroupCollapseStates() {
  state.popupState.groupCollapseStates = {
    categorize: {},
    saved: {}
  };
  state.popupState.globalCollapseStatus = {
    categorize: 'undefined',
    saved: 'undefined'
  };
}

/**
 * Set initialization complete
 */
export function setInitializationComplete() {
  state.isInitializing = false;
}

/**
 * Get current state (read-only)
 * @returns {Object} Current state
 */
export function getState() {
  return JSON.parse(JSON.stringify(state)); // Deep clone to prevent mutations
}

/**
 * Check if currently viewing saved tabs
 * @returns {boolean}
 */
export function isViewingSavedTabs() {
  return state.isViewingSaved;
}

/**
 * Set viewing saved tabs state
 * @param {boolean} viewing
 */
export function setViewingSavedTabs(viewing) {
  state.isViewingSaved = viewing;
  state.popupState.isViewingSaved = viewing;
  notifyStateListeners();
}

// Auto-save state on changes
let saveTimeout;
export function debouncedSaveState() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    savePopupState();
  }, 500);
}

/**
 * Save current group collapse states before UI re-render
 * Stores which groups/categories are collapsed so they can be restored after search
 */
export function saveGroupCollapseStates() {
  // Use activeTab from popupState to determine current tab
  const currentTab = (state.popupState.activeTab === 'saved') ? 'saved' : 'categorize';
  // Preserve existing states for groups that might be filtered out
  const existingStates = state.popupState.groupCollapseStates[currentTab] || {};
  const currentStates = {};
  
  // Find all group and category sections in the active tab only
  const container = currentTab === 'saved' 
    ? document.getElementById('savedContent') 
    : document.getElementById('tabsContainer');
  
  if (!container) {
    logger.warn('⚠️ No container found for tab:', currentTab);
    return;
  }
  
  const sections = container.querySelectorAll('.group-section, .category-section');
  
  sections.forEach(section => {
    // Generate a unique key for this section
    let sectionKey = '';
    
    if (section.classList.contains('category-section')) {
      // For category sections, use the category number/ID
      const categoryId = section.id || section.dataset.category;
      if (categoryId) {
        sectionKey = `category-${categoryId}`;
      }
    } else if (section.classList.contains('group-section')) {
      // For group sections, use the group title text without the count
      const groupTitle = section.querySelector('.group-title span');
      if (groupTitle) {
        // Remove the count in parentheses at the end
        const titleText = groupTitle.textContent.trim();
        const titleWithoutCount = titleText.replace(/\s*\(\d+\)$/, '');
        sectionKey = `group-${titleWithoutCount}`;
      }
    }
    
    if (sectionKey) {
      const isCollapsed = section.classList.contains('collapsed');
      // Only store if collapsed, otherwise remove from current states
      if (isCollapsed) {
        currentStates[sectionKey] = true;
      } else {
        // Explicitly track as expanded for currently visible groups
        currentStates[sectionKey] = false;
      }
    }
  });
  
  // Merge with existing states: keep old states for groups not currently visible,
  // update states for groups that are currently visible
  const mergedStates = { ...existingStates };
  Object.entries(currentStates).forEach(([key, value]) => {
    if (value) {
      mergedStates[key] = true; // Collapsed
    } else {
      delete mergedStates[key]; // Expanded (remove from stored states)
    }
  });
  
  // Store merged states in popup state
  state.popupState.groupCollapseStates[currentTab] = mergedStates;
}

/**
 * Check if a group/category should be rendered in collapsed state
 * @param {string|number} groupIdentifier - Category number or group name
 * @param {string} sectionType - 'category' or 'group'
 * @param {string} context - Optional context ('current' or 'saved'). If not provided, will determine from state
 * @returns {boolean} True if should be collapsed
 */
export function shouldGroupBeCollapsed(groupIdentifier, sectionType, context = null) {
  // If context is explicitly provided, use it. Otherwise determine from state
  let currentTab;
  if (context === 'current') {
    currentTab = 'categorize';
  } else if (context === 'saved') {
    currentTab = 'saved';
  } else {
    // Fallback to state-based determination
    currentTab = (state.popupState.activeTab === 'saved') ? 'saved' : 'categorize';
  }
  
  // Check global collapse status first
  const globalStatus = getGlobalCollapseStatus(currentTab);
  if (globalStatus === 'collapsed') {
    return true;
  } else if (globalStatus === 'expanded') {
    return false;
  }
  
  // If global status is 'undefined', check individual collapse states
  const collapseStates = state.popupState.groupCollapseStates[currentTab] || {};
  
  let sectionKey = '';
  if (sectionType === 'category') {
    // Match the ID format used in unified-group-renderer.js
    // Current tabs use "category" prefix, saved tabs use "savedCategory" prefix
    const prefix = (context === 'saved' || currentTab === 'saved') ? 'savedCategory' : 'category';
    sectionKey = `category-${prefix}${groupIdentifier}`;
  } else {
    // For groups, remove any count in parentheses from the identifier
    const groupNameWithoutCount = String(groupIdentifier).replace(/\s*\(\d+\)$/, '');
    sectionKey = `group-${groupNameWithoutCount}`;
  }
  
  const result = collapseStates[sectionKey] === true;
  return result;
}

/**
 * Legacy restore function - now unused since collapse states are applied during rendering
 * @deprecated Groups now get collapse state applied during creation, not after
 */
export function restoreGroupCollapseStates() {
  // This function is now deprecated - collapse states are applied during rendering
  // in unified-group-renderer.js to prevent visual flicker
}

/**
 * Get global collapse status for current tab
 * @param {string} context - 'categorize' or 'saved'
 * @returns {string} 'collapsed', 'expanded', or 'undefined'
 */
export function getGlobalCollapseStatus(context = null) {
  // Ensure the status exists
  if (!state.popupState.globalCollapseStatus) {
    state.popupState.globalCollapseStatus = {
      categorize: 'undefined',
      saved: 'undefined'
    };
  }
  
  // Determine context if not provided
  if (!context) {
    context = state.popupState.activeTab === 'saved' ? 'saved' : 'categorize';
  }
  
  return state.popupState.globalCollapseStatus[context] || 'undefined';
}

/**
 * Set global collapse status
 * @param {string} status - 'collapsed', 'expanded', or 'undefined'
 * @param {string} context - 'categorize' or 'saved'
 */
export function setGlobalCollapseStatus(status, context = null) {
  // Ensure the status exists
  if (!state.popupState.globalCollapseStatus) {
    state.popupState.globalCollapseStatus = {
      categorize: 'undefined',
      saved: 'undefined'
    };
  }
  
  // Determine context if not provided
  if (!context) {
    context = state.popupState.activeTab === 'saved' ? 'saved' : 'categorize';
  }
  
  state.popupState.globalCollapseStatus[context] = status;
  
  // If setting to collapsed or expanded, clear individual states
  if (status === 'collapsed' || status === 'expanded') {
    state.popupState.groupCollapseStates[context] = {};
  }
  
  // Save state
  debouncedSaveState();
}

// Export default object for convenience
export default {
  state,
  subscribeToState,
  updateState,
  updateNestedState,
  savePopupState,
  loadSavedState,
  restoreScrollPosition,
  clearCategorizedTabs,
  setInitializationComplete,
  getState,
  isViewingSavedTabs,
  setViewingSavedTabs,
  debouncedSaveState,
  getDefaultRules,
  saveGroupCollapseStates,
  restoreGroupCollapseStates,
  shouldGroupBeCollapsed,
  resetGroupCollapseStates,
  getGlobalCollapseStatus,
  setGlobalCollapseStatus
};