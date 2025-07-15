/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Tab Data Source - Single source of truth for tab data
 */

import { CurrentTabsProcessor } from './current-tabs-processor.js';

let tabsProcessor = null;

/**
 * Initialize the tabs processor with database
 */
export function initializeTabDataSource(database) {
  tabsProcessor = new CurrentTabsProcessor(database);
}

/**
 * Get the current tabs processor instance
 * @returns {CurrentTabsProcessor|null} The tabs processor instance
 */
export function getCurrentTabsProcessor() {
  return tabsProcessor;
}

/**
 * Get current tabs from browser and match with database
 * @returns {Promise<Object>} Categorized tabs and duplicate info
 */
export async function getCurrentTabs() {
  if (!tabsProcessor) {
    console.error('Tab data source not initialized, returning empty state');
    // Return properly structured empty state
    return {
      categorizedTabs: {
        0: [], // uncategorized
        1: [], // can close
        2: [], // save later  
        3: []  // important
      },
      urlToDuplicateIds: {}
    };
  }
  
  try {
    return await tabsProcessor.getCurrentTabsWithCategories();
  } catch (error) {
    console.error('Error fetching current tabs:', error);
    // Return properly structured empty state
    return {
      categorizedTabs: {
        0: [], // uncategorized
        1: [], // can close
        2: [], // save later
        3: []  // important
      },
      urlToDuplicateIds: {}
    };
  }
}

/**
 * Get saved tabs from database
 * @param {Object} options - Query options
 * @returns {Promise<Object[]>} Array of saved tabs
 */
export async function getSavedTabs(options = {}) {
  try {
    // Use the database directly
    if (window.tabDatabase && window.tabDatabase.getAllSavedTabs) {
      return await window.tabDatabase.getAllSavedTabs(options);
    }
    return [];
  } catch (error) {
    console.error('Error fetching saved tabs:', error);
    return [];
  }
}

/**
 * Check if we have any current tabs
 * @returns {Promise<boolean>}
 */
export async function hasCurrentTabs() {
  const { categorizedTabs } = await getCurrentTabs();
  return Object.values(categorizedTabs).some(tabs => tabs.length > 0);
}

/**
 * Get current tabs by category
 * @param {number} category - Category ID
 * @returns {Promise<Array>} Tabs in that category
 */
export async function getCurrentTabsByCategory(category) {
  const { categorizedTabs } = await getCurrentTabs();
  return categorizedTabs[category] || [];
}

/**
 * Get all current tab categories with counts
 * @returns {Promise<Object>} Category counts
 */
export async function getCurrentTabCounts() {
  const { categorizedTabs } = await getCurrentTabs();
  const counts = {};
  
  for (const [category, tabs] of Object.entries(categorizedTabs)) {
    counts[category] = tabs.length;
  }
  
  return counts;
}

/**
 * Setup listeners for real-time tab updates
 * @param {Function} onTabChange - Callback for tab changes
 * @returns {Object} Port connection
 */
export function setupTabEventListeners(onTabChange) {
  if (!tabsProcessor) {
    console.error('Tab data source not initialized');
    return null;
  }
  
  return tabsProcessor.setupTabEventListeners(onTabChange);
}