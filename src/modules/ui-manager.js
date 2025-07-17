/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * UI Manager - handles theme, navigation, status messages, and general UI state
 */

import { DOM_IDS, CSS_CLASSES, TAB_TYPES } from '../utils/constants.js';
import { $id, show, hide, classes } from '../utils/dom-helpers.js';
import StorageService from '../services/StorageService.js';
import { state, updateState, savePopupState } from './state-manager.js';
import logger from '../utils/logger.js';

// Status message management
const statusMessages = new Map(); // Map of message ID to {timeoutId, endTime}
let messageIdCounter = 0;
const MAX_VISIBLE_MESSAGES = 5;
const processMessages = new Map(); // Map of process key to message ID
const MESSAGE_OVERLAP_TIME = 1000; // Time window for cumulative timing (1 second)

// Duration by message type (in milliseconds)
const MESSAGE_DURATIONS = {
  success: 5000,
  info: 5000,
  loading: 5000,
  warning: 10000,
  error: 12000
};

// Version info for testing

/**
 * Initialize theme system
 */
export function initializeTheme() {
  // Load saved theme or use system default
  StorageService.loadTheme().then(savedTheme => {
    applyTheme(savedTheme);
    updateThemeButtons(savedTheme);
    
    // For Safari: Listen for system theme changes when using system theme
    if (savedTheme === 'system' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      console.log('🔍 DEBUG_SAFARI_THEME: Setting up system theme change listener');
      
      const handleSystemThemeChange = (e) => {
        console.log('🔍 DEBUG_SAFARI_THEME: System theme changed:', e.matches ? 'dark' : 'light');
        
        // Re-apply system theme when system preference changes
        StorageService.loadTheme().then(currentTheme => {
          if (currentTheme === 'system') {
            applyTheme('system');
          }
        });
      };
      
      // Modern browsers
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleSystemThemeChange);
      } else {
        // Legacy browsers
        mediaQuery.addListener(handleSystemThemeChange);
      }
    }
  });
}

/**
 * Set and save theme
 * @param {string} theme - Theme name (system, light, dark)
 */
export function setTheme(theme) {
  applyTheme(theme);
  updateThemeButtons(theme);
  StorageService.saveTheme(theme);
}

/**
 * Apply theme to document
 * @param {string} theme - Theme name
 */
function applyTheme(theme) {
  const body = document.body;
  
  if (theme === 'system') {
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Detect Safari popup context
    const isSafariPopup = window.location.href.includes('safari-web-extension://') && 
                         (window.location.search.includes('popup') || 
                          window.location.search.includes('safariPopup') ||
                          window.outerWidth < 500);
    
    if (isSafariPopup) {
      // Safari popup workaround: Use browser storage to sync theme between popup and tab contexts
      // This ensures consistent theme across all extension contexts
      browser.storage.local.get(['systemThemeCache']).then(result => {
        let themeToApply = systemPrefersDark ? 'dark' : 'light';
        
        if (result.systemThemeCache) {
          // Use cached theme if available and recent (within 30 seconds)
          const cache = result.systemThemeCache;
          const isRecent = Date.now() - cache.timestamp < 30000;
          if (isRecent) {
            themeToApply = cache.theme;
          }
        }
        
        // Apply theme
        body.setAttribute('data-theme', themeToApply);
        
        // Update cache for other contexts
        browser.storage.local.set({
          systemThemeCache: {
            theme: themeToApply,
            timestamp: Date.now()
          }
        });
      }).catch(() => {
        // Fallback if storage fails
        body.setAttribute('data-theme', systemPrefersDark ? 'dark' : 'light');
      });
    } else {
      // Normal tab context - use detected system preference and cache it
      const themeToApply = systemPrefersDark ? 'dark' : 'light';
      body.setAttribute('data-theme', themeToApply);
      
      // Cache for popup context
      browser.storage.local.set({
        systemThemeCache: {
          theme: themeToApply,
          timestamp: Date.now()
        }
      }).catch(() => {
        // Ignore storage errors
      });
    }
  } else {
    body.setAttribute('data-theme', theme);
  }
}

/**
 * Update theme button states
 * @param {string} activeTheme - Currently active theme
 */
function updateThemeButtons(activeTheme) {
  document.querySelectorAll('.theme-btn').forEach(btn => {
    classes.toggle(btn, CSS_CLASSES.TAB_PANE_ACTIVE, btn.dataset.theme === activeTheme);
  });
}

/**
 * Initialize tab navigation system
 */
export function initializeTabNavigation() {
  // Add click listeners to tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchToTab(tabName);
    });
  });
}

/**
 * Switch to a specific tab
 * @param {string} tabName - Tab to switch to
 */
export async function switchToTab(tabName) {
  
  // Save current scroll position before switching
  const savedContent = document.getElementById('savedContent');
  if (savedContent && state.popupState.activeTab === 'saved') {
    const scrollPos = savedContent.scrollTop;
    state.popupState.scrollPositions.saved = scrollPos;
    // Save immediately
    savePopupState();
  }
  
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const shouldBeActive = btn.dataset.tab === tabName;
    
    if (shouldBeActive) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Update tab panes
  document.querySelectorAll('.tab-pane').forEach(pane => {
    const shouldBeActive = pane.id === `${tabName}Tab`;
    
    if (shouldBeActive) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });
  
  // Clear status message when switching tabs (except saved which sets its own)
  if (tabName !== TAB_TYPES.SAVED) {
    clearStatus();
  }
  
  // Update active tab in state
  updateState('activeTab', tabName);
  state.popupState.activeTab = tabName;
  
  // Handle tab-specific actions
  if (tabName === TAB_TYPES.SAVED) {
    updateState('isViewingSaved', true);
    
    // Trigger saved tab content loading/restoration
    // This will handle scroll position restoration properly
    const { updateSavedTabContent } = await import('./content-manager.js');
    await updateSavedTabContent();
  } else {
    updateState('isViewingSaved', false);
    
    if (tabName === TAB_TYPES.SETTINGS) {
      hideApiKeyPrompt();
    } else if (tabName === TAB_TYPES.CATEGORIZE) {
      // When switching back to Current tab, refresh content to ensure accuracy
      const { markContentDirty, updateCurrentTabContent } = await import('./content-manager.js');
      markContentDirty('current');
      await updateCurrentTabContent(true); // Force refresh when switching to Current tab
    }
  }
  
  // Update unified toolbar visibility
  const { updateToolbarVisibility } = await import('./unified-toolbar.js');
  await updateToolbarVisibility(tabName);
}

// Internal message storage
const messageStore = new Map(); // Map of messageId to {message, type, isEntering, isExiting}
let renderTimeout = null;

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render all status messages at once to prevent flickering
 * Uses requestAnimationFrame for smooth rendering
 */
function renderStatusMessages() {
  // Cancel any pending render
  if (renderTimeout) {
    cancelAnimationFrame(renderTimeout);
  }
  
  // Schedule render on next frame
  renderTimeout = requestAnimationFrame(() => {
    const containerEl = $id('statusContainer');
    if (!containerEl) return;
    
    // Build HTML for all messages
    const fragments = [];
    messageStore.forEach((msgData, messageId) => {
      const classes = ['status-message', msgData.type];
      
      if (msgData.isEntering) {
        classes.push('entering');
      }
      if (msgData.isExiting) {
        classes.push('exiting');
      }
      
      fragments.push(`<div class="${classes.join(' ')}" data-message-id="${messageId}">${escapeHtml(msgData.message)}</div>`);
    });
    
    // Update container in one operation
    containerEl.innerHTML = fragments.join('');
    renderTimeout = null;
  });
}

/**
 * Show status message
 * @param {string} message - Message to display
 * @param {string} type - Message type (success, error, warning, loading, info)
 * @param {number|null} duration - Duration in ms (0 = permanent, null = use default for type)
 * @param {string|null} processKey - Optional key to identify process messages that should replace each other
 */
export function showStatus(message, type = 'success', duration = null, processKey = null) {
  // Always log status messages to console for debugging
  const timestamp = new Date().toISOString();
  
  // Log all status messages with appropriate log level
  if (type === 'error') {
    logger.error('🚨 STATUS ERROR:', message);
    logger.error('🚨 ERROR DETAILS:', {
      message,
      timestamp,
      duration,
      stackTrace: new Error().stack.split('\n').slice(1, 4) // Show relevant stack frames
    });
  } else if (type === 'warning') {
    logger.warn('⚠️ STATUS WARNING:', message, { timestamp, duration });
  } else if (type === 'loading') {
    logger.uiState('⏳ STATUS LOADING:', message, { timestamp, duration });
  } else if (type === 'success') {
    logger.uiState('✅ STATUS SUCCESS:', message, { timestamp, duration });
  } else {
    // Default/unknown type
    logger.uiState('ℹ️ STATUS INFO:', message, { timestamp, duration, type });
  }
  
  // Check if this is a replacement message
  if (processKey) {
    const existingMessageId = processMessages.get(processKey);
    if (existingMessageId && messageStore.has(existingMessageId)) {
      // Just update the existing message content
      const existingMsg = messageStore.get(existingMessageId);
      existingMsg.message = message;
      existingMsg.type = type;
      
      // Update or clear the timeout
      const timerData = statusMessages.get(existingMessageId);
      if (timerData && timerData.timeoutId) {
        clearTimeout(timerData.timeoutId);
      }
      
      // Set new duration
      let effectiveDuration = duration !== null ? duration : MESSAGE_DURATIONS[type] || 5000;
      if (effectiveDuration > 0) {
        const now = Date.now();
        const endTime = now + effectiveDuration;
        const timeoutId = setTimeout(() => {
          removeStatusMessage(existingMessageId);
          if (processMessages.get(processKey) === existingMessageId) {
            processMessages.delete(processKey);
          }
        }, effectiveDuration);
        
        statusMessages.set(existingMessageId, { timeoutId, endTime });
      } else {
        statusMessages.delete(existingMessageId);
      }
      
      // Render the update
      renderStatusMessages();
      return;
    }
  }
  
  // Limit number of visible messages
  const nonExitingMessages = Array.from(messageStore.entries())
    .filter(([_, msgData]) => !msgData.isExiting);
  
  if (nonExitingMessages.length >= MAX_VISIBLE_MESSAGES) {
    // Remove oldest message
    const [oldestId] = nonExitingMessages[0];
    removeStatusMessage(oldestId, true); // Skip render
  }
  
  // Create new message
  const messageId = `msg-${++messageIdCounter}`;
  messageStore.set(messageId, {
    message,
    type,
    isEntering: true,
    isExiting: false
  });
  
  // Store process message reference
  if (processKey) {
    processMessages.set(processKey, messageId);
  }
  
  // Render all messages at once
  renderStatusMessages();
  
  // Remove entering class after animation
  setTimeout(() => {
    const msgData = messageStore.get(messageId);
    if (msgData) {
      msgData.isEntering = false;
      // Only render if this message is still visible and not exiting
      if (!msgData.isExiting) {
        renderStatusMessages();
      }
    }
  }, 250);
  
  // Use type-specific duration if not specified
  let effectiveDuration = duration !== null ? duration : MESSAGE_DURATIONS[type] || 5000;
  
  // Calculate cumulative timing for better readability
  if (effectiveDuration > 0) {
    const now = Date.now();
    let maxEndTime = now;
    
    // Find the latest end time among current messages
    statusMessages.forEach((msgData) => {
      if (msgData.endTime > maxEndTime) {
        maxEndTime = msgData.endTime;
      }
    });
    
    // If messages are overlapping (within 1 second), extend duration
    if (maxEndTime > now && (maxEndTime - now) < effectiveDuration + MESSAGE_OVERLAP_TIME) {
      effectiveDuration = (maxEndTime - now) + effectiveDuration;
    }
    
    const endTime = now + effectiveDuration;
    const timeoutId = setTimeout(() => {
      removeStatusMessage(messageId);
      // Clean up process message reference
      if (processKey && processMessages.get(processKey) === messageId) {
        processMessages.delete(processKey);
      }
    }, effectiveDuration);
    
    statusMessages.set(messageId, { timeoutId, endTime });
  }
}

/**
 * Remove a specific status message
 * @param {string} messageId - ID of the message to remove
 * @param {boolean} skipRender - Skip rendering (useful when batching operations)
 */
function removeStatusMessage(messageId, skipRender = false) {
  const msgData = messageStore.get(messageId);
  if (!msgData) return;
  
  // Clear timeout if exists
  const timerData = statusMessages.get(messageId);
  if (timerData && timerData.timeoutId) {
    clearTimeout(timerData.timeoutId);
    statusMessages.delete(messageId);
  }
  
  // Clean up process message reference
  processMessages.forEach((value, key) => {
    if (value === messageId) {
      processMessages.delete(key);
    }
  });
  
  // Mark as exiting
  msgData.isExiting = true;
  
  if (!skipRender) {
    renderStatusMessages();
  }
  
  // Remove after animation completes
  setTimeout(() => {
    messageStore.delete(messageId);
    if (!skipRender) {
      renderStatusMessages();
    }
  }, 150);
}

/**
 * Clear all status messages
 */
export function clearStatus() {
  // Clear all timeouts
  statusMessages.forEach((msgData) => {
    if (msgData && msgData.timeoutId) {
      clearTimeout(msgData.timeoutId);
    }
  });
  
  // Clear all data
  statusMessages.clear();
  messageStore.clear();
  processMessages.clear();
  
  // Clear container
  renderStatusMessages();
}

/**
 * Clear status messages by process key
 * @param {string} processKey - The process key to clear messages for
 */
export function clearStatusByProcessKey(processKey) {
  if (!processKey) return;
  
  // Get the message ID associated with this process key
  const messageId = processMessages.get(processKey);
  if (!messageId) return;
  
  // Remove the message
  removeStatusMessage(messageId, false);
}

/**
 * Update badge on categorize tab
 */
export async function updateCategorizeBadge() {
  const badge = $id(DOM_IDS.CATEGORIZE_BADGE);
  if (!badge) return;
  
  // Get actual tab count from Chrome API (not deduplicated)
  try {
    const tabs = await browser.tabs.query({});
    
    // Exclude extension popup tab
    const extensionId = browser.runtime.id;
    const extensionPopupUrl = browser.runtime.getURL('popup.html');
    
    const actualTabCount = tabs.filter(tab => {
      // Use startsWith to handle query parameters like ?popup=false
      return !(extensionId && extensionPopupUrl && tab.url && tab.url.startsWith(extensionPopupUrl));
    }).length;
    
    if (actualTabCount > 0) {
      badge.textContent = actualTabCount;
      show(badge);
    } else {
      hide(badge);
    }
  } catch (error) {
    logger.error('Error counting tabs:', error);
    hide(badge);
  }
  
  // Also update categorize button state
  await updateLegacyCategorizeButtonState();
}

/**
 * Update categorize button enable/disable state (compatibility function)
 */
export async function updateLegacyCategorizeButtonState() {
  const categorizeBtn = $id(DOM_IDS.CATEGORIZE_BTN);
  if (!categorizeBtn) return;
  
  // Check if categorization is in progress
  const categorizationService = await import('./categorization-service.js');
  if (categorizationService.default.isCategorizationInProgress) {
    // Keep button disabled during processing
    return;
  }
  
  // Get current tabs from background
  const { getCurrentTabs } = await import('./tab-data-source.js');
  const { categorizedTabs } = await getCurrentTabs();
  
  const uncategorizedCount = categorizedTabs && categorizedTabs[0] 
    ? categorizedTabs[0].length 
    : 0;
  
  const hasUncategorized = uncategorizedCount > 0;
  
  // Update button text to show count
  const buttonText = categorizeBtn.querySelector('text') || categorizeBtn.lastChild;
  if (buttonText && buttonText.nodeType === Node.TEXT_NODE) {
    buttonText.textContent = hasUncategorized 
      ? ` Categorize (${uncategorizedCount})`
      : ' Categorize';
  }
  
  categorizeBtn.disabled = !hasUncategorized;
  categorizeBtn.title = hasUncategorized ? 
    `Categorize ${uncategorizedCount} uncategorized tabs using AI` : 
    'No uncategorized tabs';
}

/**
 * Update badge on saved tab
 * @param {number} count - Number of saved tabs
 */
export function updateSavedBadge(count) {
  const badge = $id(DOM_IDS.SAVED_BADGE);
  if (!badge) return;
  
  if (count > 0) {
    badge.textContent = count;
    show(badge);
  } else {
    hide(badge);
  }
}

/**
 * Show API key prompt
 */
export function showApiKeyPrompt() {
  show($id(DOM_IDS.API_KEY_PROMPT));
}

/**
 * Hide API key prompt
 */
export function hideApiKeyPrompt() {
  hide($id(DOM_IDS.API_KEY_PROMPT));
}

/**
 * Download data as file
 * @param {string} content - File content
 * @param {string} filename - Filename to save as
 * @param {string} mimeType - MIME type
 */
export function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
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
 * Generate markdown for tabs
 * @param {Array} tabs - Tabs to generate markdown for
 * @param {string} categoryName - Category name
 * @returns {string} Markdown content
 */
export function generateMarkdown(tabs, categoryName) {
  let markdown = `# ${categoryName}\n\n`;
  
  tabs.forEach(tab => {
    const title = tab.title || 'Untitled';
    const url = tab.url;
    markdown += `- [${title}](${url})\n`;
  });
  
  return markdown;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showStatus('Copied to clipboard!', 'success', 3000);
  } catch (error) {
    logger.error('Failed to copy:', error);
    showStatus('Failed to copy to clipboard', 'error');
  }
}

/**
 * Check if dark mode is active
 * @returns {boolean}
 */
export function isDarkMode() {
  const theme = document.body.getAttribute('data-theme');
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  
  // System theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Toggle element visibility
 * @param {string} elementId - Element ID
 * @param {boolean} show - Force show/hide
 */
export function toggleElement(elementId, show) {
  const element = $id(elementId);
  if (!element) return;
  
  if (show !== undefined) {
    show ? show(element) : hide(element);
  } else {
    element.style.display === 'none' ? show(element) : hide(element);
  }
}

// Export default object
export default {
  initializeTheme,
  setTheme,
  initializeTabNavigation,
  switchToTab,
  showStatus,
  clearStatus,
  updateCategorizeBadge,
  updateSavedBadge,
  showApiKeyPrompt,
  hideApiKeyPrompt,
  downloadFile,
  generateMarkdown,
  copyToClipboard,
  isDarkMode,
  toggleElement
};