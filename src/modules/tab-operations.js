/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Tab Operations Module - handles all tab CRUD operations
 */

import { TAB_CATEGORIES, LIMITS } from '../utils/constants.js';
import { getRootDomain, smartConfirm } from '../utils/helpers.js';
import ChromeAPIService from '../services/ChromeAPIService.js';
import { state } from './state-manager.js';
import { showStatus, clearStatusByProcessKey, updateCategorizeBadge } from './ui-manager.js';
import { moveTabToCategory } from './categorization-service.js';
import { markContentDirty, syncHiddenTabContent } from './content-manager.js';
import { displayTabs } from './tab-display.js';
import { getUnifiedDatabase } from '../services/UnifiedDatabaseService.js';
import logger from '../utils/logger.js';
// Import database - using window.window.tabDatabase since it's a global

// ========== Helper Functions ==========

/**
 * Get current window information and tabs
 * @returns {Promise<{window: Object, tabs: Array, tabIds: Set}>}
 */
async function getCurrentWindowInfo() {
  const currentWindow = await ChromeAPIService.getCurrentWindow();
  const currentWindowTabs = await ChromeAPIService.queryTabs({ windowId: currentWindow.id });
  const currentWindowTabIds = new Set(currentWindowTabs.map(t => t.id));
  
  return {
    window: currentWindow,
    tabs: currentWindowTabs,
    tabIds: currentWindowTabIds
  };
}

/**
 * Separate tab IDs by window (current vs other)
 * @param {Array} tabIds - Array of tab IDs to separate
 * @param {Set} currentWindowTabIds - Set of current window tab IDs
 * @returns {{current: Array, other: Array}}
 */
function separateTabsByWindow(tabIds, currentWindowTabIds) {
  const current = [];
  const other = [];
  
  for (const tabId of tabIds) {
    if (currentWindowTabIds.has(tabId)) {
      current.push(tabId);
    } else {
      other.push(tabId);
    }
  }
  
  return { current, other };
}

/**
 * Check if closing tabs would close all tabs in current window
 * @param {Set} currentWindowTabIds - Set of all tab IDs in current window
 * @param {Array} tabsToClose - Array of tab IDs we want to close
 * @returns {boolean}
 */
function willCloseAllCurrentWindowTabs(currentWindowTabIds, tabsToClose) {
  if (currentWindowTabIds.size === 0) return false;
  
  // Check if every tab in current window is in the close list
  return Array.from(currentWindowTabIds).every(id => tabsToClose.includes(id));
}

/**
 * Close tabs with error handling and counting
 * @param {Array} tabIds - Array of tab IDs to close
 * @returns {Promise<number>} Number of successfully closed tabs
 */
async function closeTabsWithTracking(tabIds) {
  if (!tabIds || tabIds.length === 0) return 0;
  
  try {
    // Chrome API accepts either a single ID or an array of IDs
    // Using batch closing is more efficient and reliable
    await ChromeAPIService.removeTabs(tabIds);
    return tabIds.length;
  } catch (error) {
    logger.error('Error in batch closing, trying individual closes:', error);
    
    // Fallback to individual closing if batch fails
    let closedCount = 0;
    const failedTabs = [];
    
    for (const tabId of tabIds) {
      try {
        await ChromeAPIService.removeTabs(tabId);
        closedCount++;
      } catch (error) {
        logger.error(`Error closing tab ${tabId}:`, error.message);
        failedTabs.push({ id: tabId, error: error.message });
      }
    }
    
    if (failedTabs.length > 0) {
      logger.warn(`Failed to close ${failedTabs.length} tabs:`, failedTabs);
    }
    
    return closedCount;
  }
}

/**
 * Get all duplicate IDs for a tab
 * @param {Object} tab - Tab object
 * @param {Object} urlToDuplicateIds - URL to duplicate IDs mapping
 * @returns {Array} Array of tab IDs including duplicates
 */
function getTabIdsWithDuplicates(tab, urlToDuplicateIds = {}) {
  if (tab.duplicateIds && tab.duplicateIds.length > 0) {
    return tab.duplicateIds;
  }
  return urlToDuplicateIds[tab.url] || [tab.id];
}

/**
 * Handle the case where we're closing all tabs in current window
 * Keeps the active tab to prevent popup from closing
 * @param {Array} currentWindowTabsToClose - Tab IDs to close in current window
 * @returns {Promise<number|null>} Tab ID to keep and navigate to blank, or null
 */
async function handleAllTabsClosing(currentWindowTabsToClose) {
  // Get the current active tab to keep the popup open
  const [activeTab] = await ChromeAPIService.queryTabs({ active: true, currentWindow: true });
  
  if (activeTab && currentWindowTabsToClose.includes(activeTab.id)) {
    // Remove the current active tab from the close list
    const index = currentWindowTabsToClose.indexOf(activeTab.id);
    if (index > -1) {
      currentWindowTabsToClose.splice(index, 1);
      return activeTab.id;
    }
  } else if (currentWindowTabsToClose.length > 0) {
    // Fallback: if active tab not in list, just keep one tab
    return currentWindowTabsToClose.pop();
  }
  return null;
}

/**
 * Navigate a tab to a new tab page (cross-browser compatible)
 * @param {number} tabId - Tab ID to navigate
 */
async function navigateToNewTabPage(tabId) {
  const userAgent = navigator.userAgent.toLowerCase();
  let newTabUrl = 'about:blank';
  
  // Determine browser-specific new tab URL
  if (userAgent.includes('chrome') && !userAgent.includes('edg')) {
    newTabUrl = 'chrome://new-tab-page/';
  } else if (userAgent.includes('firefox')) {
    newTabUrl = 'about:newtab';
  } else if (userAgent.includes('edg')) {
    newTabUrl = 'edge://newtab/';
  }
  
  try {
    // Try browser-specific new tab page first
    await ChromeAPIService.updateTab(tabId, { url: newTabUrl });
  } catch (error) {
    logger.error('Failed to navigate to browser-specific new tab page:', error);
    // Fallback to about:blank if browser-specific URL fails
    try {
      await ChromeAPIService.updateTab(tabId, { url: 'about:blank' });
    } catch (fallbackError) {
      logger.error('Failed to navigate to about:blank:', fallbackError);
    }
  }
}

/**
 * Collect all tab IDs from tabs array, including duplicates
 * @param {Array} tabs - Array of tab objects
 * @param {Object} urlToDuplicateIds - URL to duplicate IDs mapping
 * @returns {Array} All tab IDs including duplicates
 */
function collectAllTabIds(tabs, urlToDuplicateIds = {}) {
  const allTabIds = [];
  
  for (const tab of tabs) {
    const tabIds = getTabIdsWithDuplicates(tab, urlToDuplicateIds);
    allTabIds.push(...tabIds);
  }
  
  return allTabIds;
}

/**
 * Smart tab opening that keeps popup open
 * Opens in another window or creates new window to prevent popup from closing
 * @param {string} url - URL to open
 * @param {boolean} focusWindow - Whether to focus the window
 * @param {boolean} checkExisting - Whether to check for existing tab first
 * @returns {Promise<Object>} Created or existing tab
 */
async function openTabKeepingPopupOpen(url, focusWindow = true, checkExisting = false) {
  // Check if tab is already open if requested
  if (checkExisting) {
    const existingTabs = await ChromeAPIService.queryTabs({ url });
    if (existingTabs && existingTabs.length > 0) {
      // Tab already exists, just activate it
      const existingTab = existingTabs[0];
      await ChromeAPIService.updateTab(existingTab.id, { active: true });
      if (focusWindow) {
        await browser.windows.update(existingTab.windowId, { focused: true });
      }
      return existingTab;
    }
  }
  
  // Get all windows
  const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
  const currentWindow = await browser.windows.getCurrent();
  
  // Find a window that's not the current one
  const otherWindow = windows.find(w => w.id !== currentWindow.id);
  
  if (otherWindow) {
    // Open in the other window
    const tab = await ChromeAPIService.createTab({ 
      url: url,
      active: true,
      windowId: otherWindow.id
    });
    
    if (focusWindow) {
      await browser.windows.update(otherWindow.id, { focused: true });
    }
    
    return tab;
  } else {
    // No other window, create a new one
    const newWindow = await browser.windows.create({
      url: url,
      focused: focusWindow
    });
    return newWindow.tabs[0];
  }
}

/**
 * Close a single tab
 */
export async function closeTab(tab, category) {
  try {
    // Get the latest tab data from background
    const { getCurrentTabs } = await import('./tab-data-source.js');
    const { categorizedTabs } = await getCurrentTabs();
    const categoryTabs = categorizedTabs[category] || [];
    const currentTab = categoryTabs.find(t => t.id === tab.id);
    
    // Use current tab data if available, otherwise fall back to passed tab
    const tabToClose = currentTab || tab;
    
    // Get all duplicate tabs - check both sources
    const duplicateIds = tabToClose.duplicateIds || [tabToClose.id];
    
    
    // Close all duplicate tabs
    for (const tabId of duplicateIds) {
      try {
        await ChromeAPIService.removeTabs(tabId);
      } catch (error) {
        logger.error(`Error closing tab ${tabId}:`, error);
      }
    }
    
    // Notify background to update its state
    await browser.runtime.sendMessage({
      action: 'tabClosed',
      data: {
        tabId: tab.id,
        category: category
      }
    });
    
    updateCategorizeBadge();
    
    // Update content using simple approach
    markContentDirty('all');
    const { updateCurrentTabContent } = await import('./content-manager.js');
    await updateCurrentTabContent(true); // Force refresh after tab close
    await syncHiddenTabContent();
    
  } catch (error) {
    logger.error('Error closing tab:', error);
    showStatus('Error closing tab', 'error');
  }
}

/**
 * Save and close all tabs in a category
 */
export async function saveAndCloseCategory(category) {
  try {
    // Saving is instant - no loading message needed
    
    // Get current tabs from background
    const { getCurrentTabs } = await import('./tab-data-source.js');
    const { categorizedTabs, urlToDuplicateIds } = await getCurrentTabs();
    const tabs = categorizedTabs[category] || [];
    
    if (tabs.length === 0) {
      showStatus('No tabs to save', 'warning', null, 'saving-tabs');
      return;
    }
    
    // Save unsaved tabs
    const tabsToSave = {
      [category]: tabs.filter(tab => !tab.alreadySaved)
    };
    
    let savedCount = 0;
    if (tabsToSave[category].length > 0) {
      // Use UnifiedDatabaseService for proper ML synchronization
      const unifiedDB = await getUnifiedDatabase();
      await unifiedDB.saveCategorizedTabs(tabsToSave, { 
        source: 'category_save', 
        savedAt: Date.now() 
      });
      savedCount = tabsToSave[category].length;
      
      // Update saved badge count
      const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
      await loadSavedTabsCount();
    }
    
    // Get current window info
    const windowInfo = await getCurrentWindowInfo();
    
    // Collect all tab IDs including duplicates
    const allTabIds = collectAllTabIds(tabs, urlToDuplicateIds);
    
    // Separate tabs by window
    const { current: currentWindowTabsToClose, other: otherWindowTabsToClose } = 
      separateTabsByWindow(allTabIds, windowInfo.tabIds);
    
    // Check if we're closing all tabs in current window
    if (willCloseAllCurrentWindowTabs(windowInfo.tabIds, currentWindowTabsToClose)) {
      await ChromeAPIService.createTab({ windowId: windowInfo.window.id });
    }
    
    // Close tabs in other windows first, then current window
    const otherClosed = await closeTabsWithTracking(otherWindowTabsToClose);
    const currentClosed = await closeTabsWithTracking(currentWindowTabsToClose);
    const closedCount = otherClosed + currentClosed;
    
    // Notify background to clear the category
    await browser.runtime.sendMessage({
      action: 'clearCategory',
      data: { category }
    });
    
    updateCategorizeBadge();
    
    showStatus(`Saved ${savedCount} tabs, closed ${closedCount} tabs`, 'success', null, 'saving-tabs');
    
    // Update display
    await displayTabs();
  } catch (error) {
    logger.error('Error saving and closing category:', error);
    showStatus('Error saving tabs', 'error', null, 'saving-tabs');
  }
}

/**
 * Close all categorized tabs
 */
export async function closeAllTabs() {
  try {
    // Get current tabs from background
    const { getCurrentTabs } = await import('./tab-data-source.js');
    const { categorizedTabs, urlToDuplicateIds } = await getCurrentTabs();
    
    // Check if there are uncategorized tabs
    const uncategorizedTabs = categorizedTabs[TAB_CATEGORIES.UNCATEGORIZED] || [];
    const savedTabs = [
      ...(categorizedTabs[TAB_CATEGORIES.CAN_CLOSE] || []),
      ...(categorizedTabs[TAB_CATEGORIES.SAVE_LATER] || []),
      ...(categorizedTabs[TAB_CATEGORIES.IMPORTANT] || [])
    ];
    
    if (uncategorizedTabs.length > 0) {
      // Choose the appropriate dialog
      const dialogId = savedTabs.length > 0 ? 'closeAllDialog' : 'closeUnsavedDialog';
      const dialog = document.getElementById(dialogId);
      
      return new Promise((resolve) => {
        // Set up button handlers
        const handleDialogClick = (e) => {
          const action = e.target.dataset.action;
          if (!action) return;
          
          dialog.close();
          
          // Remove event listeners
          dialog.removeEventListener('click', handleDialogClick);
          
          switch (action) {
            case 'saved-only':
              // Close only saved tabs (exclude uncategorized)
              closeAllTabsExceptUncategorized(categorizedTabs, urlToDuplicateIds).then(resolve);
              break;
            case 'all-tabs':
            case 'close':
              // Continue with closing all tabs
              closeAllTabsIncludingUncategorized(categorizedTabs, urlToDuplicateIds).then(resolve);
              break;
            case 'cancel':
              // Do nothing
              resolve();
              break;
          }
        };
        
        dialog.addEventListener('click', handleDialogClick);
        dialog.showModal();
      });
    } else {
      // No uncategorized tabs, proceed normally
      await closeAllTabsIncludingUncategorized(categorizedTabs, urlToDuplicateIds);
    }
  } catch (error) {
    logger.error('Error saving and closing all tabs:', error);
    showStatus('Error saving tabs', 'error', null, 'saving-tabs');
  }
}

/**
 * Helper function to close all tabs including uncategorized
 */
async function closeAllTabsIncludingUncategorized(categorizedTabs, urlToDuplicateIds) {
  // Closing is instant - no loading message needed
  // Get current window info
  const windowInfo = await getCurrentWindowInfo();
  
  // Collect all tab IDs we're about to close (including uncategorized)
  const allTabIds = [];
  for (const category of [TAB_CATEGORIES.UNCATEGORIZED, TAB_CATEGORIES.CAN_CLOSE, TAB_CATEGORIES.SAVE_LATER, TAB_CATEGORIES.IMPORTANT]) {
    const tabs = categorizedTabs[category] || [];
    const categoryTabIds = collectAllTabIds(tabs, urlToDuplicateIds);
    allTabIds.push(...categoryTabIds);
  }
  
  // Remove duplicates
  const uniqueTabIds = [...new Set(allTabIds)];
  
  // Separate tabs by window
  const { current: currentWindowTabsToClose, other: otherWindowTabsToClose } = 
    separateTabsByWindow(uniqueTabIds, windowInfo.tabIds);
  
  // Check if we're closing all tabs in the current window
  let tabToKeep = null;
  if (willCloseAllCurrentWindowTabs(windowInfo.tabIds, currentWindowTabsToClose)) {
    tabToKeep = await handleAllTabsClosing(currentWindowTabsToClose);
  }
  
  
  // Close tabs in other windows first, then current window
  const otherClosed = await closeTabsWithTracking(otherWindowTabsToClose);
  const currentClosed = await closeTabsWithTracking(currentWindowTabsToClose);
  const totalClosed = otherClosed + currentClosed;
  
  // Navigate the kept tab to new tab page (cross-browser compatible)
  if (tabToKeep) {
    await navigateToNewTabPage(tabToKeep);
  }
  
  // Clear tabs from state - background doesn't track categories anymore
  // Just update the UI state directly
  
  // Add small delay to ensure background has processed the changes
  await new Promise(resolve => setTimeout(resolve, 100));
  
  await updateCategorizeBadge();
  
  // UI already shows tabs are closed - no need for message
  
  // Update display
  await displayTabs();
}

/**
 * Helper function to close only saved tabs (exclude uncategorized)
 */
async function closeAllTabsExceptUncategorized(categorizedTabs, urlToDuplicateIds) {
  // Closing is instant - no loading message needed
  
  // Get current window info
  const windowInfo = await getCurrentWindowInfo();
  
  // Collect tab IDs excluding uncategorized
  const allTabIds = [];
  for (const category of [TAB_CATEGORIES.CAN_CLOSE, TAB_CATEGORIES.SAVE_LATER, TAB_CATEGORIES.IMPORTANT]) {
    const tabs = categorizedTabs[category] || [];
    const categoryTabIds = collectAllTabIds(tabs, urlToDuplicateIds);
    allTabIds.push(...categoryTabIds);
  }
  
  // Remove duplicates
  const uniqueTabIds = [...new Set(allTabIds)];
  
  // Separate tabs by window
  const { current: currentWindowTabsToClose, other: otherWindowTabsToClose } = 
    separateTabsByWindow(uniqueTabIds, windowInfo.tabIds);
  
  // Check if we're closing all tabs in the current window
  let tabToKeep = null;
  if (willCloseAllCurrentWindowTabs(windowInfo.tabIds, currentWindowTabsToClose)) {
    tabToKeep = await handleAllTabsClosing(currentWindowTabsToClose);
  }
  
  
  // Close tabs in other windows first, then current window
  const otherClosed = await closeTabsWithTracking(otherWindowTabsToClose);
  const currentClosed = await closeTabsWithTracking(currentWindowTabsToClose);
  const totalClosed = otherClosed + currentClosed;
  
  // Navigate the kept tab to new tab page (cross-browser compatible)
  if (tabToKeep) {
    await navigateToNewTabPage(tabToKeep);
  }
  
  // Clear saved categories from state - background doesn't track categories anymore
  // Just update the UI state directly
  
  // Add small delay to ensure background has processed the changes
  await new Promise(resolve => setTimeout(resolve, 100));
  
  await updateCategorizeBadge();
  
  showStatus(`Closed ${totalClosed} saved tabs`, 'success', null, 'closing-saved-tabs');
  
  // Update display
  await displayTabs();
}

/**
 * Close all tabs in a category without saving
 */
export async function closeAllInCategory(category) {
  try {
    // Get current tabs from background
    const { getCurrentTabs } = await import('./tab-data-source.js');
    const { categorizedTabs, urlToDuplicateIds } = await getCurrentTabs();
    const tabs = categorizedTabs[category] || [];
    
    if (tabs.length === 0) return;
    
    showStatus('Closing tabs...', 'loading', 0, 'closing-tabs');
    
    // Get current window info
    const windowInfo = await getCurrentWindowInfo();
    
    // Collect all tab IDs including duplicates
    const allTabIds = collectAllTabIds(tabs, urlToDuplicateIds);
    
    // Separate tabs by window
    const { current: currentWindowTabsToClose, other: otherWindowTabsToClose } = 
      separateTabsByWindow(allTabIds, windowInfo.tabIds);
    
    // Check if we're closing all tabs in current window
    if (willCloseAllCurrentWindowTabs(windowInfo.tabIds, currentWindowTabsToClose)) {
      await ChromeAPIService.createTab({ windowId: windowInfo.window.id });
    }
    
    // Close tabs in other windows first, then current window
    const otherClosed = await closeTabsWithTracking(otherWindowTabsToClose);
    const currentClosed = await closeTabsWithTracking(currentWindowTabsToClose);
    const closedCount = otherClosed + currentClosed;
    
    // Notify background to clear the category
    await browser.runtime.sendMessage({
      action: 'clearCategory',
      data: { category }
    });
    
    updateCategorizeBadge();
    
    showStatus(`Closed ${closedCount} tabs`, 'success', null, 'closing-tabs');
    
    // Trigger display update
    const { displayTabs } = await import('./tab-display.js');
    await displayTabs();
  } catch (error) {
    logger.error('Error closing category:', error);
    showStatus('Error closing tabs', 'error', null, 'closing-tabs');
  }
}

/**
 * Open all tabs in a category
 */
export async function openAllInCategory(category) {
  try {
    // Get current tabs from background
    const { getCurrentTabs } = await import('./tab-data-source.js');
    const { categorizedTabs } = await getCurrentTabs();
    const tabs = categorizedTabs[category] || [];
    
    if (tabs.length === 0) return;
    
    const maxTabs = state.settings.maxTabsToOpen || LIMITS.MAX_TABS_DEFAULT;
    
    if (tabs.length > maxTabs) {
      if (!await smartConfirm(`This will open ${tabs.length} tabs. Continue?`, { defaultAnswer: true, testId: 'open-many-tabs' })) {
        return;
      }
    }
    
    // Opening is instant - no loading message needed
    
    for (const tab of tabs.slice(0, maxTabs)) {
      try {
        await openTabKeepingPopupOpen(tab.url, false); // Don't focus each individual tab
      } catch (error) {
        logger.error('Error opening tab:', error);
      }
    }
    
    // Focus the window at the end
    const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
    const currentWindow = await browser.windows.getCurrent();
    const otherWindow = windows.find(w => w.id !== currentWindow.id);
    if (otherWindow) {
      await browser.windows.update(otherWindow.id, { focused: true });
    }
    
    // Only show message if many tabs opened
    if (tabs.length > 5) {
      showStatus(`Opened ${Math.min(tabs.length, maxTabs)} tabs`, 'success');
    }
  } catch (error) {
    logger.error('Error opening tabs:', error);
    showStatus(`Error opening tabs: ${error.message}`, 'error');
  }
}

/**
 * Close all tabs in a group
 */
export async function closeTabsInGroup(tabs) {
  try {
    if (!tabs || tabs.length === 0) return;
    
    showStatus('Closing tabs...', 'loading');
    
    // Get current window info
    const windowInfo = await getCurrentWindowInfo();
    
    // Collect all tab IDs including duplicates
    const allTabIds = collectAllTabIds(tabs);
    
    // Separate tabs by window
    const { current: currentWindowTabsToClose, other: otherWindowTabsToClose } = 
      separateTabsByWindow(allTabIds, windowInfo.tabIds);
    
    // Check if we're closing all tabs in current window
    if (willCloseAllCurrentWindowTabs(windowInfo.tabIds, currentWindowTabsToClose)) {
      await ChromeAPIService.createTab({ windowId: windowInfo.window.id });
    }
    
    // Close tabs in other windows first, then current window
    const otherClosed = await closeTabsWithTracking(otherWindowTabsToClose);
    const currentClosed = await closeTabsWithTracking(currentWindowTabsToClose);
    const closedCount = otherClosed + currentClosed;
    
    // Notify background about closed tabs
    for (const tab of tabs) {
      await browser.runtime.sendMessage({
        action: 'tabClosed',
        data: {
          tabId: tab.id,
          category: tab.category
        }
      });
    }
    
    updateCategorizeBadge();
    
    showStatus(`Closed ${closedCount} tabs`, 'success');
    
    // Trigger display update
    const { displayTabs } = await import('./tab-display.js');
    await displayTabs();
    
  } catch (error) {
    logger.error('Error closing group tabs:', error);
    showStatus('Error closing tabs', 'error');
  }
}

/**
 * Save and close all tabs in a group
 */
export async function saveAndCloseTabsInGroup(tabs) {
  try {
    if (!tabs || tabs.length === 0) return;
    
    showStatus('Saving tabs...', 'loading');
    
    // Get current window info
    const windowInfo = await getCurrentWindowInfo();
    
    // Group tabs by category for saving
    const tabsByCategory = {};
    let savedCount = 0;
    
    for (const tab of tabs) {
      if (!tab.alreadySaved) {
        const tabCategory = tab.category || TAB_CATEGORIES.SAVE_LATER;
        if (!tabsByCategory[tabCategory]) {
          tabsByCategory[tabCategory] = [];
        }
        tabsByCategory[tabCategory].push(tab);
        savedCount++;
      }
    }
    
    // Save all tabs at once
    if (savedCount > 0) {
      // Use UnifiedDatabaseService for proper ML synchronization
      const unifiedDB = await getUnifiedDatabase();
      await unifiedDB.saveCategorizedTabs(tabsByCategory, { 
        source: 'close_all_save', 
        savedAt: Date.now() 
      });
      
      // Update saved badge count
      const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
      await loadSavedTabsCount();
    }
    
    // Collect all tab IDs including duplicates
    const allTabIds = collectAllTabIds(tabs);
    
    // Separate tabs by window
    const { current: currentWindowTabsToClose, other: otherWindowTabsToClose } = 
      separateTabsByWindow(allTabIds, windowInfo.tabIds);
    
    // Check if we're closing all tabs in current window
    if (willCloseAllCurrentWindowTabs(windowInfo.tabIds, currentWindowTabsToClose)) {
      await ChromeAPIService.createTab({ windowId: windowInfo.window.id });
    }
    
    // Close tabs in other windows first, then current window
    const otherClosed = await closeTabsWithTracking(otherWindowTabsToClose);
    const currentClosed = await closeTabsWithTracking(currentWindowTabsToClose);
    const closedCount = otherClosed + currentClosed;
    
    // Notify background about closed tabs
    for (const tab of tabs) {
      await browser.runtime.sendMessage({
        action: 'tabClosed',
        data: {
          tabId: tab.id,
          category: tab.category
        }
      });
    }
    
    updateCategorizeBadge();
    
    showStatus(`Saved ${savedCount} tabs, closed ${closedCount} tabs`, 'success', null, 'saving-tabs');
    
    // Update saved tabs badge
    const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
    await loadSavedTabsCount();
    
    // Trigger display update
    const { displayTabs } = await import('./tab-display.js');
    await displayTabs();
    
  } catch (error) {
    logger.error('Error saving group tabs:', error);
    showStatus('Error saving tabs', 'error', null, 'saving-tabs');
  }
}

/**
 * Open all tabs in a group
 */
export async function openAllTabsInGroup(groupNameOrTabs) {
  try {
    let groupTabs = [];
    
    // Check if we received an array of tabs (from saved tabs) or a group name (from current tabs)
    if (Array.isArray(groupNameOrTabs)) {
      groupTabs = groupNameOrTabs;
    } else {
      // Get current tabs from background
      const { getCurrentTabs } = await import('./tab-data-source.js');
      const { categorizedTabs } = await getCurrentTabs();
      
      // Get all tabs in this group
      const allTabs = Object.values(categorizedTabs).flat();
      
      allTabs.forEach(tab => {
        const domain = getRootDomain(tab.domain);
        if (domain === groupNameOrTabs) {
          groupTabs.push(tab);
        }
      });
    }
    
    if (groupTabs.length === 0) return;
    
    const maxTabs = state.settings.maxTabsToOpen || LIMITS.MAX_TABS_DEFAULT;
    
    if (groupTabs.length > maxTabs) {
      if (!await smartConfirm(`This will open ${groupTabs.length} tabs. Continue?`, { defaultAnswer: true })) {
        return;
      }
    }
    
    // Opening is instant - no loading message needed
    
    // Get the current window to open tabs in
    const currentWindow = await browser.windows.getCurrent();
    
    for (const tab of groupTabs.slice(0, maxTabs)) {
      try {
        // Open tabs in the current window
        await ChromeAPIService.createTab({ 
          url: tab.url,
          active: false, // Don't switch to each tab as it opens
          windowId: currentWindow.id
        });
      } catch (error) {
        logger.error('Error opening tab:', error);
      }
    }
    
    // Only show message if many tabs opened
    if (groupTabs.length > 5) {
      showStatus(`Opened ${Math.min(groupTabs.length, maxTabs)} tabs`, 'success');
    }
  } catch (error) {
    logger.error('Error opening group tabs:', error);
    showStatus(`Error opening tabs: ${error.message}`, 'error');
  }
}

/**
 * Move tab between categories
 */
export function moveTab(tab, fromCategory, direction) {
  let toCategory = fromCategory;
  
  if (direction === 'up') {
    if (fromCategory === TAB_CATEGORIES.UNCATEGORIZED) {
      toCategory = TAB_CATEGORIES.CAN_CLOSE;
    } else if (fromCategory === TAB_CATEGORIES.CAN_CLOSE) {
      toCategory = TAB_CATEGORIES.SAVE_LATER;
    } else if (fromCategory === TAB_CATEGORIES.SAVE_LATER) {
      toCategory = TAB_CATEGORIES.IMPORTANT;
    }
  } else if (direction === 'down') {
    if (fromCategory === TAB_CATEGORIES.IMPORTANT) {
      toCategory = TAB_CATEGORIES.SAVE_LATER;
    } else if (fromCategory === TAB_CATEGORIES.SAVE_LATER) {
      toCategory = TAB_CATEGORIES.CAN_CLOSE;
    } else if (fromCategory === TAB_CATEGORIES.CAN_CLOSE) {
      toCategory = TAB_CATEGORIES.UNCATEGORIZED;
    }
  }
  
  if (toCategory !== fromCategory) {
    moveTabToCategory(tab, fromCategory, toCategory);
    
    // Trigger display update
    window.dispatchEvent(new CustomEvent('tabsChanged'));
  }
}

/**
 * Delete a saved tab
 */
export async function deleteSavedTab(urlId) {
  try {
    // Use unified database service to handle ML cleanup
    const unifiedDb = await getUnifiedDatabase();
    await unifiedDb.deleteTabs(urlId);
    
    // UI already shows tab is removed - no message needed
    
    // Update saved tab count
    const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
    await loadSavedTabsCount();
    
    // Mark current tab content as dirty so it refreshes when switching back
    // This ensures the categorize button counter updates correctly
    markContentDirty('current');
    
    
    // Force ML dashboard update after a delay to ensure all async operations complete
    setTimeout(async () => {
      try {
        // Check if settings tab is active
        const settingsTab = document.getElementById('settingsTab');
        if (settingsTab && settingsTab.classList.contains('active')) {
          const { updateMLStatus } = await import('./ml-dashboard.js');
          await updateMLStatus();
        }
      } catch (error) {
        logger.error('Error updating ML dashboard:', error);
      }
    }, 1000); // 1 second delay to ensure database operations complete
    
    // Mark saved content as dirty and update
    markContentDirty('saved');
    const { updateSavedTabContent } = await import('./content-manager.js');
    await updateSavedTabContent(true); // Force refresh after delete
    
    // Also trigger the event for any other listeners
    window.dispatchEvent(new CustomEvent('savedTabsChanged'));
  } catch (error) {
    logger.error('Error deleting saved tab:', error);
    showStatus('Error deleting tab', 'error');
  }
}

/**
 * Delete all tabs in a group (for saved tabs)
 */
/**
 * Open saved tabs (with duplicate check) 
 * @param {Array} tabs - Array of saved tab objects to open
 */
export async function openSavedTabs(tabs) {
  try {
    if (!tabs || tabs.length === 0) return;
    
    const maxTabs = state.settings.maxTabsToOpen || LIMITS.MAX_TABS_DEFAULT;
    
    if (tabs.length > maxTabs) {
      if (!await smartConfirm(`This will open ${tabs.length} tabs. Continue?`, { defaultAnswer: true, testId: 'open-many-tabs' })) {
        return;
      }
    }
    
    // Opening is instant - no loading message needed
    
    // Get the current window to open tabs in
    const currentWindow = await browser.windows.getCurrent();
    
    let openedCount = 0;
    for (const tab of tabs.slice(0, maxTabs)) {
      try {
        // First check if tab is already open
        const existingTabs = await ChromeAPIService.queryTabs({ url: tab.url });
        if (existingTabs && existingTabs.length > 0) {
          // Tab already exists, just activate it
          const existingTab = existingTabs[0];
          await ChromeAPIService.updateTab(existingTab.id, { active: true });
        } else {
          // Open new tab in current window
          await ChromeAPIService.createTab({ 
            url: tab.url,
            active: false, // Don't switch to each tab as it opens
            windowId: currentWindow.id
          });
        }
        openedCount++;
      } catch (error) {
        logger.error('Error opening tab:', error);
      }
    }
    
    // Only show message if many tabs opened
    if (openedCount > 5) {
      showStatus(`Opened ${openedCount} tabs`, 'success');
    }
  } catch (error) {
    logger.error('Error opening saved tabs:', error);
    showStatus(`Error opening tabs: ${error.message}`, 'error');
  }
}

export async function deleteTabsInGroup(tabsOrGroupName, groupDisplayName) {
  try {
    // Handle both old (groupName) and new (tabs array) signatures
    let tabs = [];
    let groupName = '';
    
    if (Array.isArray(tabsOrGroupName)) {
      // New signature: array of tabs
      tabs = tabsOrGroupName;
      groupName = groupDisplayName || 'this group';
    } else {
      // Old signature: group name (for backward compatibility)
      groupName = tabsOrGroupName;
      // Get tabs by domain for old behavior
      const savedTabs = await window.tabDatabase.getAllSavedTabs();
      tabs = savedTabs.filter(tab => getRootDomain(tab.domain) === groupName);
    }
    
    // Remove counter from group name if present (e.g., "amazon.com (3)" -> "amazon.com")
    const cleanGroupName = groupName.replace(/\s*\(\d+\)$/, '');
    
    if (!await smartConfirm(`Delete all ${tabs.length} tabs in "${cleanGroupName}"?`, { defaultAnswer: true })) {
      return;
    }
    
    // Only show loading if many tabs
    if (tabs.length > 5) {
      showStatus('Deleting tabs...', 'loading', 0, 'deleting-tabs');
    }
    
    // Use unified database service to handle ML cleanup
    const unifiedDb = await getUnifiedDatabase();
    const tabIds = tabs.map(tab => tab.id);
    await unifiedDb.deleteTabs(tabIds);
    const deletedCount = tabIds.length;
    
    // UI already shows tabs are removed - no message needed
    if (tabs.length > 5) {
      clearStatusByProcessKey('deleting-tabs');
    }
    
    // Update saved tab count
    const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
    await loadSavedTabsCount();
    
    // Mark current tab content as dirty so it refreshes when switching back
    // This ensures the categorize button counter updates correctly
    markContentDirty('current');
    
    // Force ML dashboard update after a delay to ensure all async operations complete
    setTimeout(async () => {
      try {
        // Check if settings tab is active
        const settingsTab = document.getElementById('settingsTab');
        if (settingsTab && settingsTab.classList.contains('active')) {
          const { updateMLStatus } = await import('./ml-dashboard.js');
          await updateMLStatus();
        }
      } catch (error) {
        logger.error('Error updating ML dashboard:', error);
      }
    }, 1000); // 1 second delay to ensure database operations complete
    
    // Refresh current tabs display if active to update categorize button counter
    const categorizeTab = document.getElementById('categorizeTab');
    if (categorizeTab && categorizeTab.classList.contains('active')) {
      // Force refresh of current tabs to recalculate which tabs are categorizable
      const { showCurrentTabsContent } = await import('./tab-display.js');
      const groupingType = state.popupState?.groupingSelections?.categorize || 'category';
      await showCurrentTabsContent(groupingType);
    }
    
    // Mark saved content as dirty and update
    markContentDirty('saved');
    const { updateSavedTabContent } = await import('./content-manager.js');
    await updateSavedTabContent(true); // Force refresh after delete
    
    // Trigger display update
    window.dispatchEvent(new CustomEvent('savedTabsChanged'));
  } catch (error) {
    logger.error('Error deleting group:', error);
    showStatus('Error deleting tabs', 'error');
  }
}


/**
 * Delete all tabs in a category (for saved tabs)
 */
export async function deleteTabsInCategory(tabs, categoryName) {
  try {
    if (!await smartConfirm(`Delete all ${tabs.length} tabs in category "${categoryName}"?`, { defaultAnswer: true })) {
      return;
    }
    
    // Only show loading if many tabs
    if (tabs.length > 5) {
      showStatus('Deleting tabs...', 'loading', 0, 'deleting-tabs');
    }
    
    // Use UnifiedDatabaseService for batch deletion with ML cleanup
    const { getUnifiedDatabase } = await import('../services/UnifiedDatabaseService.js');
    const dbService = await getUnifiedDatabase();
    
    // Collect all tab IDs
    const tabIds = tabs.filter(tab => tab.id).map(tab => tab.id);
    
    if (tabIds.length > 0) {
      // Batch delete with ML cleanup
      await dbService.deleteTabs(tabIds);
    }
    
    // UI already shows tabs are removed - no message needed
    if (tabs.length > 5) {
      clearStatusByProcessKey('deleting-tabs');
    }
    
    // Update saved tab count
    const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
    await loadSavedTabsCount();
    
    // Mark current tab content as dirty so it refreshes when switching back
    // This ensures the categorize button counter updates correctly
    markContentDirty('current');
    
    // Force ML dashboard update after a delay to ensure all async operations complete
    setTimeout(async () => {
      try {
        // Check if settings tab is active
        const settingsTab = document.getElementById('settingsTab');
        if (settingsTab && settingsTab.classList.contains('active')) {
          const { updateMLStatus } = await import('./ml-dashboard.js');
          await updateMLStatus();
        }
      } catch (error) {
        logger.error('Error updating ML dashboard:', error);
      }
    }, 1000); // 1 second delay to ensure database operations complete
    
    // Refresh current tabs display if active to update categorize button counter
    const categorizeTab = document.getElementById('categorizeTab');
    if (categorizeTab && categorizeTab.classList.contains('active')) {
      // Force refresh of current tabs to recalculate which tabs are categorizable
      const { showCurrentTabsContent } = await import('./tab-display.js');
      const groupingType = state.popupState?.groupingSelections?.categorize || 'category';
      await showCurrentTabsContent(groupingType);
    }
    
    // Mark saved content as dirty and update
    markContentDirty('saved');
    const { updateSavedTabContent } = await import('./content-manager.js');
    await updateSavedTabContent(true); // Force refresh after delete
    
    // Trigger display update
    window.dispatchEvent(new CustomEvent('savedTabsChanged'));
  } catch (error) {
    logger.error('Error deleting category:', error);
    showStatus('Error deleting tabs', 'error');
  }
}

/**
 * Restore a saved tab (open and optionally delete)
 */
export async function restoreSavedTab(tab, deleteAfterRestore = false) {
  try {
    const newTab = await openTabKeepingPopupOpen(tab.url);
    
    // Record open event in database
    if (window.tabDatabase) {
      const urlId = await window.tabDatabase.getOrCreateUrl(tab, tab.category);
      await window.tabDatabase.recordOpenEvent(urlId, newTab.id);
    }
    
    if (deleteAfterRestore) {
      // Use UnifiedDatabaseService for deletion with ML cleanup
      const { getUnifiedDatabase } = await import('../services/UnifiedDatabaseService.js');
      const dbService = await getUnifiedDatabase();
      await dbService.deleteTabs([tab.id]);
      
      // Update saved tab count
      const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
      await loadSavedTabsCount();
      
      // Force ML dashboard update after a delay to ensure all async operations complete
      setTimeout(async () => {
        try {
          const { updateMLStatus } = await import('./ml-dashboard.js');
          await updateMLStatus();
        } catch (error) {
          logger.error('Error updating ML dashboard:', error);
        }
      }, 500); // 500ms delay to ensure database operations complete
      
      // Keep message in case function is called programmatically
      showStatus('Tab restored and removed from saved', 'success');
    } else {
      // Keep message in case function is called programmatically
      showStatus('Tab restored', 'success');
    }
    
    // Trigger display update if deleted
    if (deleteAfterRestore) {
      window.dispatchEvent(new CustomEvent('savedTabsChanged'));
    }
  } catch (error) {
    logger.error('Error restoring tab:', error);
    showStatus('Error restoring tab', 'error');
  }
}

/**
 * Check for duplicate tabs and mark them
 */
export function markDuplicateTabs(tabs) {
  const urlCounts = {};
  
  // Count occurrences of each URL
  tabs.forEach(tab => {
    if (!urlCounts[tab.url]) {
      urlCounts[tab.url] = [];
    }
    urlCounts[tab.url].push(tab);
  });
  
  // Mark duplicates
  Object.entries(urlCounts).forEach(([, duplicates]) => {
    if (duplicates.length > 1) {
      duplicates.forEach(tab => {
        tab.duplicateCount = duplicates.length;
      });
    }
  });
  
  return tabs;
}

/**
 * Mute all audible tabs in current window
 * @returns {Promise<number>} Number of tabs muted
 */
export async function muteAllAudibleTabs() {
  const tabs = await ChromeAPIService.queryTabs({ audible: true });
  
  let mutedCount = 0;
  for (const tab of tabs) {
    try {
      await ChromeAPIService.updateTab(tab.id, { muted: true });
      mutedCount++;
    } catch (error) {
      console.error('Failed to mute tab:', tab.id, error);
    }
  }
  
  showStatus(`Muted ${mutedCount} tab${mutedCount !== 1 ? 's' : ''}`, 'success');
  
  // Update the mute button state after muting tabs with a small delay
  // to allow Chrome to process the mute changes
  setTimeout(async () => {
    const { updateMuteButtonState } = await import('./unified-toolbar.js');
    await updateMuteButtonState();
  }, 100);
  
  return mutedCount;
}

/**
 * Check if there are any audible tabs
 * @returns {Promise<boolean>} True if there are audible tabs
 */
export async function hasAudibleTabs() {
  const tabs = await ChromeAPIService.queryTabs({ audible: true });
  // Filter out muted tabs
  const unmutedAudibleTabs = tabs.filter(tab => !tab.mutedInfo?.muted);
  return unmutedAudibleTabs.length > 0;
}

// Export default object
export default {
  closeTab,
  saveAndCloseCategory,
  closeAllTabs,
  closeAllInCategory,
  openAllInCategory,
  openAllTabsInGroup,
  openSavedTabs,
  moveTab,
  deleteSavedTab,
  deleteTabsInGroup,
  deleteTabsInCategory,
  closeTabsInGroup,
  restoreSavedTab,
  markDuplicateTabs,
  muteAllAudibleTabs,
  hasAudibleTabs
};