/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Constants extracted from popup.js for better maintainability
 */

// Tab Categories
export const TAB_CATEGORIES = {
  UNCATEGORIZED: 0,
  CAN_CLOSE: 1,    // Ignore - Easy to refind (< 10 seconds)
  SAVE_LATER: 2,   // Useful - Moderate effort (10s - 2min)
  IMPORTANT: 3     // Important - Hard to refind (> 2 minutes)
};

// Test Environment Detection
export const TEST_MODE = {
  // Check if we're in a test environment (extension opened as tab with test-related URLs)
  isTestEnvironment: () => {
    return window.location.href.includes('popup.html') && 
           window.location.href.includes('chrome-extension://') &&
           (window.location.search.includes('test') || 
            document.title.includes('test') ||
            window.testMode === true);
  },
  
  // Enable test mode programmatically
  enable: () => {
    window.testMode = true;
  },
  
  // Disable test mode
  disable: () => {
    window.testMode = false;
  }
};

export const CATEGORY_NAMES = {
  [TAB_CATEGORIES.UNCATEGORIZED]: 'Uncategorized',
  [TAB_CATEGORIES.CAN_CLOSE]: 'Ignore',
  [TAB_CATEGORIES.SAVE_LATER]: 'Useful',
  [TAB_CATEGORIES.IMPORTANT]: 'Important'
};

// DOM Element IDs
export const DOM_IDS = {
  // Main containers
  TABS_CONTAINER: 'tabsContainer',
  CURRENT_CONTENT: 'currentContent',
  SAVED_CONTENT: 'savedContent',
  SAVED_TABS_CONTAINER: 'savedTabsContainer',
  
  // Tab navigation
  CATEGORIZE_TAB: 'categorizeTab',
  SAVED_TAB: 'savedTab',
  SETTINGS_TAB: 'settingsTab',
  
  // Buttons
  CATEGORIZE_BTN: 'categorizeBtn',
  CLOSE_ALL_TABS_BTN: 'closeAllTabsBtn',
  CLOSE_ALL_BTN2: 'closeAllBtn2',
  EXPORT_CSV_BTN: 'exportCSVBtn',
  IMPORT_CSV_BTN: 'importCSVBtn',
  SAVE_API_KEY_BTN: 'saveApiKeyBtn',
  RESET_PROMPT_BTN: 'resetPromptBtn',
  OPEN_SETTINGS_BTN: 'openSettingsBtn',
  TOGGLE_ALL_GROUPS_BTN: 'toggleAllGroupsBtn',
  TOGGLE_CATEGORIZE_GROUPS_BTN: 'toggleCategorizeGroupsBtn',
  CLEAR_SEARCH_BTN: 'clearSearchBtn',
  CLEAR_SAVED_SEARCH_BTN: 'clearSavedSearchBtn',
  
  // Input elements
  SEARCH_INPUT: 'searchInput',
  SAVED_SEARCH_INPUT: 'savedSearchInput',
  API_KEY_INPUT: 'apiKeyInput',
  MAX_TABS_INPUT: 'maxTabsInput',
  PROMPT_TEXTAREA: 'promptTextarea',
  CSV_FILE_INPUT: 'csvFileInput',
  
  // Select elements
  GROUPING_SELECT: 'groupingSelect',
  SAVED_GROUPING_SELECT: 'savedGroupingSelect',
  PROVIDER_SELECT: 'providerSelect',
  MODEL_SELECT: 'modelSelect',
  
  // Rule management
  RULES_CONTAINER: 'rulesContainer',
  ADD_RULE_BTN: 'addRuleBtn',
  
  // Sync settings
  SYNC_ENABLED_CHECKBOX: 'syncEnabledCheckbox',
  SYNC_NOW_BTN: 'syncNowBtn',
  SYNC_STATUS: 'syncStatus',
  SYNC_LAST_TIME: 'syncLastTime',
  
  // Other elements
  STATUS: 'status',
  API_KEY_PROMPT: 'apiKeyPrompt',
  SEARCH_CONTROLS: 'searchControls',
  SAVED_SEARCH_CONTROLS: 'savedSearchControls',
  CATEGORIZE_GROUPING_CONTROLS: 'categorizeGroupingControls',
  SAVED_GROUPING_CONTROLS: 'savedGroupingControls',
  PROMPT_STATUS: 'promptStatus',
  CATEGORIZE_BADGE: 'categorizeBadge',
  SAVED_BADGE: 'savedBadge',
  
  // Category sections
  CATEGORY_0: 'category0',
  CATEGORY_1: 'category1',
  CATEGORY_2: 'category2',
  CATEGORY_3: 'category3'
};

// CSS Classes
export const CSS_CLASSES = {
  // Status classes
  STATUS_SUCCESS: 'success',
  STATUS_ERROR: 'error',
  STATUS_WARNING: 'warning',
  STATUS_LOADING: 'loading',
  
  // Tab states
  TAB_PANE_ACTIVE: 'active',
  TAB_BTN: 'tab-btn',
  TAB_ITEM: 'tab-item',
  TAB_ITEM_HIDDEN: 'hidden',
  TAB_ALREADY_SAVED: 'already-saved',
  
  // Category classes
  CATEGORY_SECTION: 'category-section',
  CATEGORY_HEADER: 'category-header',
  CATEGORY_INFO: 'category-info',
  CATEGORY_ICON: 'category-icon',
  CATEGORY_NAME: 'category-name',
  CATEGORY_COUNT: 'category-count',
  CATEGORY_IMPORTANT: 'important',
  CATEGORY_SOMEWHAT_IMPORTANT: 'somewhat-important',
  CATEGORY_NOT_IMPORTANT: 'not-important',
  CATEGORY_EMPTY: 'empty',
  CATEGORY_COLLAPSED: 'collapsed',
  
  // Group classes
  GROUP_SECTION: 'group-section',
  GROUP_STATS: 'group-stats',
  GROUP_COLLAPSED: 'collapsed',
  GROUP_HIDDEN: 'group-hidden',
  
  // Button classes
  PRIMARY_BTN: 'primary-btn',
  SECONDARY_BTN: 'secondary-btn',
  DANGER_BTN: 'danger-btn',
  ICON_BTN: 'icon-btn',
  ICON_BTN_SMALL: 'icon-btn-small',
  THEME_BTN: 'theme-btn',
  
  // Other
  TABS_LIST: 'tabs-list',
  SEARCH_INPUT: 'search-input',
  INLINE_ACTION_BTN: 'inline-action-btn'
};

// Display States
export const DISPLAY = {
  NONE: 'none',
  BLOCK: 'block',
  FLEX: 'flex'
};

// Event Types
export const EVENTS = {
  CLICK: 'click',
  CHANGE: 'change',
  INPUT: 'input',
  SCROLL: 'scroll',
  BLUR: 'blur',
  DOM_CONTENT_LOADED: 'DOMContentLoaded'
};

// Grouping Options
export const GROUPING_OPTIONS = {
  CATEGORY: 'category',
  DOMAIN: 'domain',
  // Current tabs time-based groupings
  OPENED: 'opened',
  LAST_ACTIVE: 'lastActive',
  TIME_OPEN: 'timeOpen',
  // Saved tabs time-based groupings  
  ORIGINALLY_OPENED: 'originallyOpened',
  LAST_VIEWED: 'lastViewed',
  SAVED: 'saved',
  TOTAL_AGE: 'totalAge',
  TIME_SINCE_VIEWED: 'timeSinceViewed',
  // ML-based groupings
  PREDICTION_CONFIDENCE: 'predictionConfidence',
  PREDICTION_AGREEMENT: 'predictionAgreement',
  // Legacy options (kept for backward compatibility)
  SAVED_DATE: 'savedDate',
  SAVED_WEEK: 'savedWeek',
  SAVED_MONTH: 'savedMonth',
  LAST_ACCESSED_DATE: 'lastAccessedDate',
  LAST_ACCESSED_WEEK: 'lastAccessedWeek',
  LAST_ACCESSED_MONTH: 'lastAccessedMonth',
  CLOSE_TIME: 'closeTime'
};

// Tab Types
export const TAB_TYPES = {
  CATEGORIZE: 'categorize',
  SAVED: 'saved',
  SETTINGS: 'settings'
};

// Numeric Constants
export const LIMITS = {
  MAX_TABS_DEFAULT: 50,
  MAX_TABS_LIMIT: 200,
  MIN_TABS_LIMIT: 1,
  INITIAL_TAB_COUNT: 15,        // Number of tabs shown before "show more" button
  SCROLL_RESTORE_DELAY: 100,
  SCROLL_RESTORE_RETRY_1: 500,
  SCROLL_RESTORE_RETRY_2: 1000,
  BATCH_DELAY_MS: 100,
  BATCH_SIZE_DEFAULT: 100,      // Default batch size for categorization
  BATCH_SIZE_CSV: 100,          // Batch size for CSV imports
  BATCH_SIZE_MIN: 10,           // Minimum batch size
  BATCH_SIZE_MAX: 500           // Maximum batch size
};

// External URLs
export const URLS = {
  FAVICON_API: 'https://www.google.com/s2/favicons?domain={domain}&sz=32',
  DEFAULT_FAVICON: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIgc3Ryb2tlPSIjOTk5IiBzdHJva2Utd2lkdGg9IjEuNSIgZmlsbD0iI2Y1ZjVmNSIvPgogIDxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjMiIGZpbGw9IiM5OTkiLz4KPC9zdmc+',
  GITHUB_REPO: 'https://github.com/aitkn/ai-tab-manager'
};

// Storage Keys
export const STORAGE_KEYS = {
  POPUP_STATE: 'popupState',
  SETTINGS: 'settings',
  THEME: 'theme',
  SYNC_STATUS: 'syncStatus',
  SYNC_LAST_TIME: 'syncLastTime'
};

// Status Messages
export const STATUS_MESSAGES = {
  LOADING: 'Categorizing and saving tabs...',
  SUCCESS_CATEGORIZED: 'Tabs categorized and saved successfully!',
  SUCCESS_SAVED: 'tabs saved and closed successfully!',
  SUCCESS_CLOSED: 'tabs closed successfully!',
  ERROR_NO_API_KEY: 'Please configure your LLM provider and API key in Settings',
  ERROR_CATEGORIZATION: 'Error categorizing tabs:',
  WARNING_NO_TABS: 'No tabs to save',
  WARNING_CLOSE_UNCATEGORIZED: 'Are you sure you want to close all uncategorized tabs? They have not been saved yet.'
};

// Rule Types
export const RULE_TYPES = {
  DOMAIN: 'domain',
  URL_CONTAINS: 'url_contains',
  TITLE_CONTAINS: 'title_contains',
  REGEX: 'regex'
};

// Rule Fields
export const RULE_FIELDS = {
  URL: 'url',
  TITLE: 'title'
};