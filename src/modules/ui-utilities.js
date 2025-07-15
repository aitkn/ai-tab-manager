/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * UI Utilities - helper functions for UI operations
 */

import { DOM_IDS, TAB_CATEGORIES } from '../utils/constants.js';
import { $id, classes } from '../utils/dom-helpers.js';
import { state, savePopupState, saveGroupCollapseStates, setGlobalCollapseStatus, getGlobalCollapseStatus } from './state-manager.js';
import logger from '../utils/logger.js';
import { displayTabs } from './tab-display.js';
import { showSavedTabsContent } from './saved-tabs-manager.js';
import { getCurrentTabs } from './tab-data-source.js';

/**
 * Find first visible tab in viewport
 */
export function findFirstVisibleTab(tabType) {
  let container, tabSelector;
  
  if (tabType === 'categorize') {
    container = $id(DOM_IDS.CURRENT_CONTENT);
    tabSelector = '.tab-item:not(.hidden)';
  } else if (tabType === 'saved') {
    container = $id(DOM_IDS.SAVED_CONTENT);
    tabSelector = '.tab-item:not(.hidden)';
  }
  
  if (!container) return null;
  
  const tabs = container.querySelectorAll(tabSelector);
  const containerRect = container.getBoundingClientRect();
  
  // Find the scroll container's actual content area (accounting for padding)
  const containerStyles = window.getComputedStyle(container);
  const paddingTop = parseFloat(containerStyles.paddingTop) || 0;
  const contentTop = containerRect.top + paddingTop;
  
  let closestTab = null;
  let closestDistance = Infinity;
  
  for (const tab of tabs) {
    const tabRect = tab.getBoundingClientRect();
    
    // Calculate distance from the top of the content area
    const distance = Math.abs(tabRect.top - contentTop);
    
    // Find the tab closest to the top of the viewport
    if (distance < closestDistance && tabRect.bottom > contentTop) {
      closestDistance = distance;
      const urlElement = tab.querySelector('.tab-url');
      if (urlElement) {
        // Store the exact offset from the container top
        const offsetFromTop = tab.offsetTop - container.scrollTop;
        closestTab = {
          url: urlElement.textContent,
          element: tab,
          offsetFromTop: offsetFromTop
        };
      }
    }
  }
  
  return closestTab;
}

/**
 * Scroll to a specific tab by URL
 */
export function scrollToTab(url, tabType, targetOffset = null) {
  let container, tabSelector;
  
  if (tabType === 'categorize') {
    container = $id(DOM_IDS.CURRENT_CONTENT);
    tabSelector = '.tab-item:not(.hidden)';
  } else if (tabType === 'saved') {
    container = $id(DOM_IDS.SAVED_CONTENT);
    tabSelector = '.tab-item:not(.hidden)';
  }
  
  if (!container) {
    logger.uiState('Container not found for tab type:', tabType);
    return;
  }
  
  const tabs = container.querySelectorAll(tabSelector);
  
  for (const tab of tabs) {
    const urlElement = tab.querySelector('.tab-url');
    if (urlElement && urlElement.textContent === url) {
      logger.uiState('Found tab to scroll to:', url);
      
      if (targetOffset !== null) {
        // Use the saved offset
        container.scrollTop = tab.offsetTop - targetOffset;
      } else {
        // Center the tab in view
        const containerHeight = container.clientHeight;
        const tabHeight = tab.offsetHeight;
        const scrollTop = tab.offsetTop - (containerHeight / 2) + (tabHeight / 2);
        container.scrollTop = Math.max(0, scrollTop);
      }
      
      // Highlight briefly
      tab.style.backgroundColor = 'var(--highlight-color)';
      setTimeout(() => {
        tab.style.backgroundColor = '';
      }, 300);
      
      break;
    }
  }
}

/**
 * Handle grouping change for categorize tab
 */
export function onGroupingChange(e) {
  // Wait a moment for any pending scroll to settle
  setTimeout(() => {
    const currentContent = $id(DOM_IDS.CURRENT_CONTENT);
    const currentScrollTop = currentContent ? currentContent.scrollTop : 0;
    
    // Only find first visible tab if not at top
    let firstVisibleTab = null;
    if (currentScrollTop > 0) {
      firstVisibleTab = findFirstVisibleTab('categorize');
      logger.uiState('First visible tab before grouping change:', firstVisibleTab);
    }
    
    const newGrouping = e.target.value;
    state.popupState.groupingSelections.categorize = newGrouping;
    savePopupState();
    displayTabs();
    
    // Only restore scroll if we weren't at the top
    if (firstVisibleTab && currentScrollTop > 0) {
      setTimeout(() => {
        scrollToTab(firstVisibleTab.url, 'categorize');
      }, 150);
    }
  }, 50);
}

/**
 * Toggle all groups expanded/collapsed
 */
export function toggleAllGroups() {
  // Use activeTab from popupState for determining current tab
  const isSavedTab = state.popupState.activeTab === 'saved';
  const context = isSavedTab ? 'saved' : 'categorize';
  const container = isSavedTab ? $id(DOM_IDS.SAVED_CONTENT) : $id(DOM_IDS.CURRENT_CONTENT);
  if (!container) {
    return;
  }
  
  const groupSections = container.querySelectorAll('.group-section, .category-section');
  if (groupSections.length === 0) return;
  
  // Get current global status
  const currentGlobalStatus = getGlobalCollapseStatus(context);
  
  // Determine new status based on current state
  let newStatus;
  if (currentGlobalStatus === 'collapsed') {
    // If currently all collapsed, expand all
    newStatus = 'expanded';
  } else {
    // If expanded or undefined, collapse all
    newStatus = 'collapsed';
  }
  
  // Set the global status (this will also clear individual states)
  setGlobalCollapseStatus(newStatus, context);
  
  // Apply the new state to all groups
  groupSections.forEach(section => {
    if (newStatus === 'collapsed') {
      section.classList.add('collapsed');
    } else {
      section.classList.remove('collapsed');
    }
  });
  
  // Update button icon based on new status
  updateToggleButtonIcon(newStatus);
}

/**
 * Update toggle button icon based on global collapse status
 * @param {string} status - 'collapsed', 'expanded', or 'undefined'
 */
export function updateToggleButtonIcon(status = null) {
  // Get current status if not provided
  if (!status) {
    const context = state.popupState.activeTab === 'saved' ? 'saved' : 'categorize';
    status = getGlobalCollapseStatus(context);
  }
  
  const btn = $id('toggleGroupsBtn');
  if (!btn) return;
  
  const toggleArrow = btn.querySelector('.toggle-arrow');
  if (!toggleArrow) return;
  
  // Only two visual states: collapsed or not collapsed
  if (status === 'collapsed') {
    toggleArrow.textContent = '▶';  // Right arrow when collapsed
    btn.title = 'Expand all groups';
  } else {
    // For both 'expanded' and 'undefined', show the down arrow
    toggleArrow.textContent = '▼';  // Down arrow
    btn.title = 'Collapse all groups';
  }
}

/**
 * Handle grouping change for saved tabs
 */
export function onSavedGroupingChange(e) {
  // Wait a moment for any pending scroll to settle
  setTimeout(() => {
    const savedContent = $id(DOM_IDS.SAVED_CONTENT);
    const currentScrollTop = savedContent ? savedContent.scrollTop : 0;
    
    // Only find first visible tab if not at top
    let firstVisibleTab = null;
    if (currentScrollTop > 0) {
      firstVisibleTab = findFirstVisibleTab('saved');
      logger.uiState('First visible tab before saved grouping change:', firstVisibleTab);
    }
    
    const newGrouping = e.target.value;
    state.popupState.groupingSelections.saved = newGrouping;
    savePopupState();
    showSavedTabsContent(newGrouping);
    
    // Only restore scroll if we weren't at the top
    if (firstVisibleTab && currentScrollTop > 0) {
      setTimeout(() => {
        scrollToTab(firstVisibleTab.url, 'saved');
      }, 150);
    }
  }, 50);
}

/**
 * Create markdown content from tabs
 */
export function createMarkdownContent(tabs, title) {
  let content = `# ${title}\n\n`;
  content += `Generated on: ${new Date().toLocaleString()}\n\n`;
  
  // Group by domain
  const grouped = {};
  tabs.forEach(tab => {
    if (!grouped[tab.domain]) {
      grouped[tab.domain] = [];
    }
    grouped[tab.domain].push(tab);
  });
  
  // Create content
  Object.keys(grouped).sort().forEach(domain => {
    content += `## ${domain}\n\n`;
    grouped[domain].forEach(tab => {
      content += `- [${tab.title}](${tab.url})\n`;
    });
    content += '\n';
  });
  
  return content;
}

/**
 * Download file utility
 */
export function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Update Close All button color based on uncategorized tabs
 */
export async function updateCloseAllButtonColor() {
  // Check both old and new button IDs
  let closeAllBtn = $id(DOM_IDS.CLOSE_ALL_BTN2) || $id(DOM_IDS.SAVE_AND_CLOSE_ALL_BTN);
  if (!closeAllBtn) return;
  
  // Fetch current tabs from background
  const { categorizedTabs } = await getCurrentTabs();
  
  // Count total tabs across all categories
  const totalTabs = Object.values(categorizedTabs).reduce((sum, tabs) => sum + tabs.length, 0);
  
  // Disable button if no tabs to close
  if (totalTabs === 0) {
    closeAllBtn.disabled = true;
    closeAllBtn.title = 'No tabs to close';
    classes.add(closeAllBtn, 'disabled');
    return;
  }
  
  // Enable button if there are tabs
  closeAllBtn.disabled = false;
  classes.remove(closeAllBtn, 'disabled');
  
  const hasUncategorized = categorizedTabs[TAB_CATEGORIES.UNCATEGORIZED] && 
                          categorizedTabs[TAB_CATEGORIES.UNCATEGORIZED].length > 0;
  
  if (hasUncategorized) {
    classes.add(closeAllBtn, 'has-uncategorized');
    closeAllBtn.title = 'Close all tabs (WARNING: Includes uncategorized tabs)';
  } else {
    classes.remove(closeAllBtn, 'has-uncategorized');
    closeAllBtn.title = 'Close all categorized tabs';
  }
}

// Export default object
export default {
  findFirstVisibleTab,
  scrollToTab,
  onGroupingChange,
  toggleAllGroups,
  updateToggleButtonIcon,
  onSavedGroupingChange,
  createMarkdownContent,
  downloadFile,
  updateCloseAllButtonColor
};