/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * App Initializer - handles application initialization
 */

import { DOM_IDS, EVENTS, TAB_TYPES, TAB_CATEGORIES, CATEGORY_NAMES } from '../utils/constants.js';
import { $id, show } from '../utils/dom-helpers.js';
import { initializeTheme, showStatus, updateCategorizeBadge } from './ui-manager.js';
import { state, loadSavedState, setInitializationComplete, savePopupState, updateState, resetGroupCollapseStates } from './state-manager.js';
import { setupEventListeners } from './event-handlers.js';
import { displayTabs } from './tab-display.js';
import { loadSavedTabsCount } from './saved-tabs-manager.js';
import { initializeTabDataSource, getCurrentTabs, setupTabEventListeners } from './tab-data-source.js';
import logger from '../utils/logger.js';
// Database is available as window.window.tabDatabase
import StorageService from '../services/StorageService.js';
import { getBackgroundMLService } from '../services/BackgroundMLService.js';
import { initializeAllTabContent, markContentDirty } from './content-manager.js';
import { dataManager } from './data-manager.js';
import { initializeTabRenderer } from './unified-tab-renderer.js';

// Flicker-free UI system removed - using simple approach

// Flag to track initialization state
let isInitializing = true;

/**
 * Check if app is still initializing
 */
export function isAppInitializing() {
  return isInitializing;
}

/**
 * Initialize category names from constants
 */
function initializeCategoryNames() {
  // Update category names in the DOM from constants
  const categoryElements = [
    { id: DOM_IDS.CATEGORY_1, category: TAB_CATEGORIES.CAN_CLOSE },
    { id: DOM_IDS.CATEGORY_2, category: TAB_CATEGORIES.SAVE_LATER },
    { id: DOM_IDS.CATEGORY_3, category: TAB_CATEGORIES.IMPORTANT }
  ];
  
  categoryElements.forEach(({ id, category }) => {
    const categorySection = $id(id);
    if (categorySection) {
      const nameElement = categorySection.querySelector('.category-name');
      if (nameElement) {
        nameElement.textContent = CATEGORY_NAMES[category];
      }
    }
  });
}

/**
 * Wait for database to be loaded
 */
async function waitForDatabase() {
  const maxAttempts = 50; // 5 seconds max
  let attempts = 0;
  
  while (!window.tabDatabase && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
    if (attempts % 10 === 0) {
      logger.uiState(`Waiting for database: attempt ${attempts}/${maxAttempts}`);
    }
  }
  
  if (!window.tabDatabase) {
    logger.error('❌ APP INIT: Database failed to load after 5 seconds');
    throw new Error('Database failed to load after 5 seconds');
  }
  
  
}

/**
 * Main initialization function
 */
export async function initializeApp() {
  
  
  try {
    // Check if we're in popup mode
    const urlParams = new URLSearchParams(window.location.search);
    const isPopup = !urlParams.has('popup') || urlParams.get('popup') !== 'false';
    const isSafariPopup = urlParams.has('safariPopup');
    const isChromePopup = urlParams.has('chromePopup');
    const isSafari = !browser.management || !browser.management.getSelf;
    // isPopup determined    
    if (isPopup) {
      document.body.classList.add('popup-mode');
      
      // For non-Safari browsers, check if we should redirect to tab mode
      if (!isSafari) {
        const result = await browser.storage.local.get('preferredMode');
        if (result.preferredMode === 'tab') {
          // Redirect to tab mode - keep it simple like the original
          const extensionUrl = browser.runtime.getURL('popup.html?popup=false');
          try {
            await browser.tabs.create({
              url: extensionUrl,
              active: true
            });
            window.close();
            return; // Stop initialization
          } catch (error) {
            console.error('Error opening in tab mode:', error);
          }
        }
      }
      
      // Show "Open in Tab" button for all browsers
      const openInTabBtn = $id('openInTabBtn');
      if (openInTabBtn) {
        openInTabBtn.style.display = 'inline-flex';
        openInTabBtn.disabled = false; // Ensure button is not disabled
        // openInTabBtn found

        openInTabBtn.addEventListener('click', async (e) => {
          // Button click event
          logger.uiEvents('[DEBUG] Button click handler START');
          e.preventDefault(); // Prevent any default behavior
          e.stopPropagation(); // Stop event propagation
          
          // Try to prevent any navigation
          e.stopImmediatePropagation();
          
          logger.uiEvents('[DEBUG] Open in Tab clicked');
          logger.uiEvents('[DEBUG] Current URL:', window.location.href);
          logger.uiEvents('[DEBUG] isSafari:', isSafari);
          logger.uiEvents('[DEBUG] isSafariPopup:', isSafariPopup);
          logger.uiEvents('[DEBUG] isChromePopup:', isChromePopup);
          
          const extensionUrl = browser.runtime.getURL('popup.html?popup=false');

          try {
            // Save preference for non-Safari browsers
            if (!isSafari) {
              await browser.storage.local.set({ preferredMode: 'tab' });
            }
            
            // For Safari, always clean up existing tabs when opening in tab mode
            if (isSafari) {
              logger.uiEvents('[DEBUG] Safari detected - cleaning up existing tabs first');
              
              try {
                // Find all extension tabs to close
                const allTabs = await browser.tabs.query({});
                const extensionBaseUrl = browser.runtime.getURL('popup.html');
                let currentWindowId = null;
                
                try {
                  currentWindowId = (await browser.windows.getCurrent()).id;
                  logger.uiEvents('[DEBUG] Current window ID:', currentWindowId);
                } catch (e) {
                  logger.uiEvents('[DEBUG] Could not get current window:', e);
                }
                
                const tabsToClose = allTabs.filter(tab => {
                  if (!tab.url || !tab.url.startsWith(extensionBaseUrl)) {
                    return false;
                  }
                  // Don't close tabs in our current window (if we have one)
                  if (currentWindowId && tab.windowId === currentWindowId) {
                    logger.uiEvents('[DEBUG] Skipping tab in current window:', tab.id, tab.url);
                    return false;
                  }
                  logger.uiEvents('[DEBUG] Found tab to close:', tab.id, tab.url);
                  return true;
                });
                
                logger.uiEvents(`[DEBUG] Found ${tabsToClose.length} tabs to close`);
                
                // Close all existing extension tabs
                for (const tab of tabsToClose) {
                  try {
                    logger.uiEvents('[DEBUG] Closing tab:', tab.id);
                    await browser.tabs.remove(tab.id);
                  } catch (e) {
                    logger.uiEvents('[DEBUG] Could not close tab:', tab.id, e);
                  }
                }
                
                // Small delay to ensure tabs are closed
                if (tabsToClose.length > 0) {
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
              } catch (error) {
                logger.error('[DEBUG] Error during cleanup:', error);
              }
              
              // Now create the new tab
              logger.uiEvents('[DEBUG] Creating new tab');
              const newTab = await browser.tabs.create({
                url: extensionUrl,
                active: true
              });
              logger.uiEvents('[DEBUG] New tab created:', newTab.id, newTab.url);
            } else if (isSafariPopup || isChromePopup) {
              // This is for popup windows created by browser.windows.create
              logger.uiEvents('[DEBUG] Safari/Chrome popup window - creating tab without cleanup');
              await browser.tabs.create({
                url: extensionUrl,
                active: true
              });
            } else {
              // Check if extension is already open in a tab
              const existingTabs = await browser.tabs.query({ 
                url: [
                  browser.runtime.getURL('popup.html'),
                  browser.runtime.getURL('popup.html?popup=false')
                ]
              });
              
              if (existingTabs && existingTabs.length > 0) {
                // Extension tab already exists - activate and reload it
                const existingTab = existingTabs[0];
                await browser.tabs.update(existingTab.id, { active: true });
                
                // Focus the window containing the tab
                if (existingTab.windowId) {
                  try {
                    await browser.windows.update(existingTab.windowId, { focused: true });
                  } catch (e) {
                    logger.uiEvents('Window focus failed:', e);
                  }
                }
                
                // Reload to ensure fresh state
                await browser.tabs.reload(existingTab.id);
              } else {
                // Create new tab
                await browser.tabs.create({
                  url: extensionUrl,
                  active: true
                });
              }
            }
            
            // Show status immediately for Safari
            if (isSafari) {
              showStatus('Opening in new tab...', 'info', 2000);
            }
            
            // Close the popup window
            window.close();
          } catch (error) {
            logger.error('Error opening in tab:', error);
            showStatus('Failed to open in tab: ' + error.message, 'error', 3000);
            
            // Fallback: try simple tab creation
            try {
              await browser.tabs.create({
                url: browser.runtime.getURL('popup.html?popup=false'),
                active: true
              });
              window.close();
            } catch (fallbackError) {
              logger.error('Fallback also failed:', fallbackError);
            }
          }
        });
      }
    } else {
      // We're in tab mode
      // Show "Switch to Popup" button for all browsers
      const switchToPopupBtn = $id('switchToPopupBtn');
      if (switchToPopupBtn) {
        switchToPopupBtn.style.display = 'inline-flex';
        switchToPopupBtn.addEventListener('click', async () => {
            try {
              // Save preference for non-Safari browsers
              if (!isSafari) {
                await browser.storage.local.set({ preferredMode: 'popup' });
              }
              
              // Handle popup creation differently for Safari vs other browsers
              if (!isSafari) {
                // Try to create a popup-like window for Chrome/other browsers
                const popupUrl = browser.runtime.getURL('popup.html?chromePopup=true');
                try {
                // Try creating a popup-style window
                const popupWindow = await browser.windows.create({
                  url: popupUrl,
                  type: 'popup',  // This might not work in Chrome, but worth trying
                  width: 800,
                  height: 600,
                  left: 100,
                  top: 100
                });
                
                // If successful, close the current tab
                setTimeout(async () => {
                  const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
                  if (currentTab && currentTab.url.includes('popup.html?popup=false')) {
                    await browser.tabs.remove(currentTab.id);
                  }
                }, 500);
                
              } catch (windowError) {
                logger.uiEvents('Popup window creation failed, trying normal window:', windowError);
                
                // Fallback: Try creating a normal window that looks like a popup
                try {
                  const normalWindow = await browser.windows.create({
                    url: popupUrl,
                    type: 'normal',  // Use normal type
                    width: 800,
                    height: 600,
                    left: 100,
                    top: 100
                  });
                  
                  // Close the current tab after window opens
                  setTimeout(async () => {
                    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
                    if (currentTab && currentTab.url.includes('popup.html?popup=false')) {
                      await browser.tabs.remove(currentTab.id);
                    }
                  }, 500);
                  
                } catch (normalWindowError) {
                  logger.uiEvents('Normal window also failed:', normalWindowError);
                  
                  // Final fallback: Show instructions
                  const instructionDiv = document.createElement('div');
                  instructionDiv.className = 'popup-instruction-overlay';
                  instructionDiv.innerHTML = `
                    <div class="popup-instruction-content">
                      <h2>Switching to Popup Mode</h2>
                      <p>To use the extension in popup mode:</p>
                      <ol>
                        <li>Close this tab</li>
                        <li>Click the AI Tab Manager extension icon in your browser toolbar</li>
                      </ol>
                      <p>The extension will now open in popup mode by default.</p>
                      <button class="primary-btn" id="closeTabBtn">Close This Tab</button>
                    </div>
                  `;
                  document.body.appendChild(instructionDiv);
                  
                  // Add event listener to close button
                  const closeBtn = document.getElementById('closeTabBtn');
                  if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                      window.close();
                    });
                  }
                  
                  showStatus('Chrome requires manual switching to popup mode', 'info', 5000);
                }
              }
            } else {
                // Safari: Try to create a popup window
                // Use a special parameter to distinguish this from the extension popup
                const popupUrl = browser.runtime.getURL('popup.html?safariPopup=true');
                try {
                  await browser.windows.create({
                    url: popupUrl,
                    type: 'popup',
                    width: 800,
                    height: 600,
                    left: 100,
                    top: 100
                  });
                  
                  // Close the current tab after popup opens
                  setTimeout(async () => {
                    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
                    if (currentTab && currentTab.url.includes('popup.html?popup=false')) {
                      await browser.tabs.remove(currentTab.id);
                    }
                  }, 500);
                  
                } catch (windowError) {
                  // If popup window fails, inform the user
                  showStatus('Click the extension icon to open in popup mode', 'info', 4000);
                  
                  // Ask if they want to close the tab
                  const response = confirm('Close this tab and use the extension icon to open in popup mode?');
                  if (response) {
                    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
                    if (currentTab) {
                      await browser.tabs.remove(currentTab.id);
                    }
                  }
                }
              }
            } catch (error) {
              logger.error('Error switching to popup:', error);
              showStatus('Failed to switch modes', 'error', 3000);
            }
          });
        }
      }
    // Wait for database to be available
    if (!window.tabDatabase) {
      await waitForDatabase();
    } else {
      logger.uiState('Database already available');
    }
    
    // Check for unauthorized copies
    checkExtensionIntegrity();
    
    // Initialize theme
    initializeTheme();
    
    // Initialize category names from constants
    initializeCategoryNames();
    
    // Initialize database
    await window.tabDatabase.init();
    
    // Run URL cleanup asynchronously (don't block app startup)
    window.tabDatabase.cleanupOldUrls().catch(error => {
      logger.error('URL cleanup failed:', error);
    });
    
    // Initialize tab renderer strategies
    await initializeTabRenderer();
    
    // Initialize tab data source with database
    initializeTabDataSource(window.tabDatabase);
    
    // Initialize DataManager with clean architecture
    try {
      // Get the current tabs processor from tab-data-source
      const { getCurrentTabsProcessor } = await import('./tab-data-source.js');
      const currentTabsProcessor = getCurrentTabsProcessor();
      
      if (currentTabsProcessor) {
        await dataManager.initialize(currentTabsProcessor, window.tabDatabase);
        
        // Expose DataManager globally for debugging and access from other modules
        window.dataManager = dataManager;
      } else {
        logger.error('❌ APP INIT: Could not get current tabs processor for DataManager');
        throw new Error('Current tabs processor is null');
      }
    } catch (error) {
      logger.error('❌ APP INIT: Failed to initialize DataManager:', error);
      logger.error('❌ APP INIT: Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      // Set a flag to indicate DataManager failed to initialize
      window.dataManagerFailed = true;
      window.dataManagerError = error;
      
      // Don't throw the error - continue with legacy fallbacks
      logger.warn('⚠️ APP INIT: Continuing without DataManager - will use legacy fallbacks');
    }
    
    // Only load saved state if not already pre-loaded OR if default rules are needed
    if (!window._targetTab || window._needsDefaultRules) {
      await loadSavedState();
      delete window._needsDefaultRules; // Clean up flag
    } else {
      logger.uiState('State already pre-loaded');
    }
    
    // Reset group collapse states for new session
    resetGroupCollapseStates();
    
    // Check if default prompt needs updating
    if (!state.settings.isPromptCustomized && 
        state.settings.promptVersion < CONFIG.PROMPT_VERSION) {
      state.settings.customPrompt = CONFIG.DEFAULT_PROMPT;
      state.settings.promptVersion = CONFIG.PROMPT_VERSION;
      await StorageService.saveSettings(state.settings);
    }
    
    // Don't show API key prompt on startup - only when user tries to categorize
    
    // Set up event listeners early
    setupEventListeners();
    
    // Initialize tab navigation
    initializeTabNavigation();
    
    // Initialize settings UI
    try {
      const { initializeSettings } = await import('./settings-manager.js');
      await initializeSettings();
    } catch (error) {
      logger.error('❌ APP INIT: Error initializing settings:', error);
      // Continue with initialization even if settings fail
    }
    
    // Use the pre-determined target tab (DOM classes already set by preInitialize)
    let targetTab = window._targetTab || state.popupState?.activeTab || 'categorize';
    
    
    // Update state to match (DOM classes already set)
    state.popupState.activeTab = targetTab;
    updateState('activeTab', targetTab);
    
    
    // Initialize unified toolbar with correct active tab
    const { initializeUnifiedToolbar, updateToolbarVisibility } = await import('./unified-toolbar.js');
    initializeUnifiedToolbar();
    
    
    // Update toolbar visibility for the correct tab (pass true for isInitializing)
    await updateToolbarVisibility(targetTab, true);
    
    
    // Show the toolbar now that state is loaded and controls are set correctly
    const toolbar = $id('unifiedToolbar');
    if (toolbar) {
      toolbar.classList.add('state-loaded');
    }
    
    // Initialize flicker-free UI system - TEMPORARILY DISABLED
    // try {
    //   const ffUI = await getFlickerFreeUI();
    //   await ffUI.initialize();
    // } catch (error) {
    //   console.error('❌ APP INIT: Failed to initialize flicker-free UI:', error);
    //   // Continue without flicker-free UI - will fallback to DataManager
    // }
    
    // Tab is already set as active by popup.js preInitialize
    
    // Initialize all tab content at startup (this loads everything once)
    await initializeAllTabContent();
    
    // Restore UI state (search, grouping, etc) for current tab
    if (targetTab === 'categorize') {
      await restoreUIState();
      
      // Restore scroll position for categorize tab
      const currentContent = $id(DOM_IDS.CURRENT_CONTENT);
      if (state.popupState?.scrollPositions?.categorize && currentContent) {
        currentContent.scrollTop = state.popupState.scrollPositions.categorize;
      }
      
      // Always show the unified toolbar on categorize tab
      const { showToolbar } = await import('./unified-toolbar.js');
      showToolbar();
    }
    
    
    // Mark initialization complete
    setInitializationComplete();
    isInitializing = false;
    
    // Update badges
    await updateCategorizeBadge();
    await loadSavedTabsCount();
    
    // Set up tab change listener
    setupTabChangeListener();
    
    // Focus search input if opened via keyboard shortcut
    if (window._shouldFocusSearch) {
      // Multiple attempts to ensure focus works in popup mode
      const attemptFocus = (attempts = 0) => {
        const searchInput = $id('unifiedSearchInput');
        if (searchInput) {
          // Force visibility and focus
          searchInput.style.visibility = 'visible';
          searchInput.style.display = 'block';
          searchInput.tabIndex = 1;
          
          // Use requestAnimationFrame for better timing in popup
          requestAnimationFrame(() => {
            searchInput.focus();
            searchInput.select();
            
            // Verify focus was successful
            setTimeout(() => {
              if (document.activeElement === searchInput) {
                // Search input focused
              } else if (attempts < 3) {
                // Focus attempt failed, retrying
                attemptFocus(attempts + 1);
              } else {
                // Could not focus search input
              }
            }, 50);
          });
        } else {
          // Search input element not found
        }
      };
      
      // Start focus attempts after a brief delay
      setTimeout(() => attemptFocus(), 100);
      
      // Also try using Chrome's focus API if in popup mode
      if (document.body.classList.contains('popup-mode')) {
        // Additional focus attempt specifically for popup mode
        document.addEventListener('visibilitychange', function handleVisibility() {
          if (!document.hidden) {
            const searchInput = $id('unifiedSearchInput');
            if (searchInput) {
              searchInput.focus();
              document.removeEventListener('visibilitychange', handleVisibility);
            }
          }
        });
      }
      
      delete window._shouldFocusSearch; // Clean up flag
    }
    
    // Debug logging disabled by default for clean production console
    
    // Initialize background ML service
    try {
      await getBackgroundMLService();
    } catch (error) {
      console.error('BackgroundMLService initialization failed:', error);
      // ML service initialization can fail silently
    }
    
    
  } catch (error) {
    logger.error('Error during initialization:', error);
    showStatus('Error initializing extension', 'error');
  }
}

/**
 * Load current tabs from browser and database
 */
async function loadCategorizedTabsFromBackground() {
  try {
    // Ensure database is ready first
    if (!window.tabDatabase) {
      logger.uiState('Database not ready, waiting...');
      await waitForDatabase();
      
      // Initialize database after waiting
      await window.tabDatabase.init();
    }
    
    // Always re-initialize tab data source to ensure it's ready
    initializeTabDataSource(window.tabDatabase);
    
    const result = await getCurrentTabs();
    
    const { categorizedTabs, urlToDuplicateIds } = result || { categorizedTabs: {}, urlToDuplicateIds: {} };
    
    const hasTabs = Object.values(categorizedTabs).some(tabs => tabs.length > 0);
    
    if (hasTabs) {
      state.categorizedTabs = categorizedTabs;
      state.urlToDuplicateIds = urlToDuplicateIds;
      
      // Update UI - make sure container is visible first
      const tabsContainer = $id(DOM_IDS.TABS_CONTAINER);
      if (tabsContainer) {
        show(tabsContainer);
      }
      
      // Force display update
      await displayTabs();
      
      await updateCategorizeBadge();
      
      // Show unified toolbar
      const { showToolbar } = await import('./unified-toolbar.js');
      showToolbar();
      
      // Update categorize button state based on uncategorized tabs
      const hasUncategorized = categorizedTabs[0] && categorizedTabs[0].length > 0;
      const categorizeBtn = $id(DOM_IDS.CATEGORIZE_BTN);
      if (categorizeBtn) {
        categorizeBtn.disabled = !hasUncategorized;
        categorizeBtn.title = hasUncategorized ? 'Categorize tabs using AI' : 'No uncategorized tabs';
      }
    } else {
      
      // Initialize empty state but make sure UI is visible
      const tabsContainer = $id(DOM_IDS.TABS_CONTAINER);
      if (tabsContainer) {
        show(tabsContainer);
      }
      
      // Force display update even with empty state
      await displayTabs(); // This will show empty state
      
      const categorizeBtn = $id(DOM_IDS.CATEGORIZE_BTN);
      if (categorizeBtn) {
        categorizeBtn.disabled = true;
        categorizeBtn.title = 'No tabs to categorize';
      }
      
      // Show unified toolbar even with no tabs
      const { showToolbar } = await import('./unified-toolbar.js');
      showToolbar();
    }
  } catch (error) {
    logger.error('Error loading categorized tabs from background:', error);
    // Initialize empty state on error
    state.categorizedTabs = {
      0: [], // uncategorized
      1: [], // can close  
      2: [], // save later
      3: []  // important
    };
    state.urlToDuplicateIds = {};
  }
}

/**
 * Restore UI state from saved data
 */
async function restoreUIState() {
  // Restore grouping selections
  const groupingSelect = $id(DOM_IDS.GROUPING_SELECT);
  if (groupingSelect && state.popupState.groupingSelections?.categorize) {
    groupingSelect.value = state.popupState.groupingSelections.categorize;
  }
  
  const savedGroupingSelect = $id(DOM_IDS.SAVED_GROUPING_SELECT);
  if (savedGroupingSelect && state.popupState.groupingSelections?.saved) {
    savedGroupingSelect.value = state.popupState.groupingSelections.saved;
  }
  
  // Restore categorized tabs if available
  if (state.popupState.categorizedTabs && !state.popupState.isViewingSaved) {
    state.categorizedTabs = state.popupState.categorizedTabs;
    
    const hasCategories = Object.values(state.categorizedTabs)
      .some(tabs => tabs.length > 0);
      
    if (hasCategories) {
      show($id(DOM_IDS.TABS_CONTAINER));
      show($id(DOM_IDS.SEARCH_CONTROLS), 'flex');
      show('.action-buttons', 'flex');
      show($id(DOM_IDS.CATEGORIZE_GROUPING_CONTROLS), 'flex');
      await displayTabs();
      await updateCategorizeBadge();
    }
  }
  
  // Clear search on popup startup instead of restoring it
  // This ensures tabs are not filtered when popup reopens
  state.searchQuery = '';
  state.popupState.searchQuery = '';
  const searchInput = $id(DOM_IDS.SEARCH_INPUT);
  if (searchInput) {
    searchInput.value = '';
  }
}


/**
 * Initialize tab navigation
 */
function initializeTabNavigation() {
  // Tab navigation is now handled by event-handlers.js
}

/**
 * Check extension integrity
 */
function checkExtensionIntegrity() {
  // This ID will be set when published to Chrome Web Store
  const OFFICIAL_IDS = [
    // Add your official Chrome Web Store ID here when published
  ];
  
  const currentId = browser.runtime.id;
  
  // Check if browser.management API is available (not available in Safari)
  if (browser.management && browser.management.getSelf) {
    // Check if running in development mode
    browser.management.getSelf().then((extensionInfo) => {
      const isDevelopment = extensionInfo.installType === 'development';
      const isOfficial = OFFICIAL_IDS.includes(currentId) || isDevelopment;
      
      if (!isOfficial && OFFICIAL_IDS.length > 0) {
        logger.warn('Unofficial version detected');
        // Show warning in UI
        setTimeout(() => {
          showStatus('⚠️ Unofficial version! Get the official extension from GitHub', 'error', 0); // Permanent message
        }, 2000);
      }
    }).catch(error => {
      logger.warn('Failed to check extension info:', error);
    });
  } else {
    // For browsers without management API (like Safari), just check the ID
    const isOfficial = OFFICIAL_IDS.includes(currentId);
    
    if (!isOfficial && OFFICIAL_IDS.length > 0) {
      logger.warn('Unofficial version detected (no management API)');
      // Show warning in UI
      setTimeout(() => {
        const status = $id(DOM_IDS.STATUS);
        if (status) {
          status.innerHTML = '⚠️ Unofficial version! Get the official extension from <a href="https://github.com/aitkn/ai-tab-manager" target="_blank">GitHub</a>';
          status.className = 'status error';
        }
      }, 2000);
    }
  }
}

/**
 * Set up auto-save on visibility change
 */
export function setupAutoSave() {
  
  // Save state when window loses focus or visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !state.isInitializing) {
      savePopupState();
    }
  });
  
  // Also save when window loses focus
  window.addEventListener(EVENTS.BLUR, () => {
    if (!state.isInitializing) {
      savePopupState();
    }
  });
  
  // Save state on window unload
  window.addEventListener('beforeunload', () => {
    if (!state.isInitializing) {
      savePopupState();
    }
  });
}

/**
 * Set up listener for tab changes from background script
 */
function setupTabChangeListener() {
  
  // Set up listeners through tab data source (now connects to background)
  const port = setupTabEventListeners((changeData) => {
    handleTabChange(changeData);
  });
  
  // Store port reference for cleanup
  window._tabEventPort = port;
  
  // Also expose handler to window for testing
  window.handleTabChangeFromBackground = (data) => {
    handleTabChange(data);
  };
}

// Debounce timer for tab changes
let tabChangeDebounceTimer = null;

/**
 * Handle tab change notifications with debouncing
 */
async function handleTabChange(data) {
  const { changeType, tab, changeInfo } = data;
  
  
  // Skip tab changes during initialization
  if (isInitializing) {
    return;
  }
  
  // Handle changes for both categorize and saved tabs
  const activeTab = state.popupState.activeTab;
  if (activeTab !== TAB_TYPES.CATEGORIZE && activeTab !== TAB_TYPES.SAVED) {
    return;
  }
  
  // Handle audio changes immediately without debounce
  if (changeInfo && (changeInfo.hasOwnProperty('audible') || changeInfo.hasOwnProperty('mutedInfo'))) {
    const { updateMuteButtonState } = await import('./unified-toolbar.js');
    await updateMuteButtonState();
    // Don't process the full tab change for audio-only updates
    return;
  }
  
  // Clear existing debounce timer
  if (tabChangeDebounceTimer) {
    clearTimeout(tabChangeDebounceTimer);
  }
  
  // Debounce rapid changes
  tabChangeDebounceTimer = setTimeout(async () => {
    await processTabChange(changeType, tab);
  }, 200); // 200ms debounce
}

/**
 * Process tab change after debounce
 */
async function processTabChange(changeType) {
  
  // For saved tabs view, we always want to update to refresh URL highlighting
  if (state.popupState.activeTab === 'saved') {
    logger.uiState('Processing tab change for saved tabs view');
  } else {
    // Check if we have categorized tabs (for current tabs view)
    const { hasCurrentTabs } = await import('./tab-data-source.js');
    const hasCategorizedTabs = await hasCurrentTabs();
    
    // Only skip if we have no tabs AND we're not viewing the Current tab (where users expect real-time updates)
    if (!hasCategorizedTabs && changeType !== 'created' && state.popupState.activeTab !== 'categorize') {
      return;
    }
    
    // If we're on Current tab and all tabs were removed, we should still update to show empty state
    if (!hasCategorizedTabs && state.popupState.activeTab === 'categorize') {
      // Empty state will be shown by the normal update flow
    }
  }
  
  
  // For all tab changes, mark content as dirty and update current tabs
  try {
    // Mark current tab content as needing update
    markContentDirty('current');
    
    const { categorizedTabs, urlToDuplicateIds } = await getCurrentTabs();
    
    // Update state
    state.categorizedTabs = categorizedTabs;
    state.urlToDuplicateIds = urlToDuplicateIds;
    
    // Check for duplicate changes
    let duplicatesChanged = false;
    for (const category of Object.keys(categorizedTabs)) {
      for (const tab of categorizedTabs[category]) {
        if (tab.duplicateIds && tab.duplicateIds.length > 1) {
          duplicatesChanged = true;
        }
      }
    }
    
    // Check if all tabs are gone
    const totalTabs = Object.values(categorizedTabs).reduce((sum, tabs) => sum + tabs.length, 0);
    
    if (totalTabs === 0 && state.popupState.activeTab === 'categorize') {
      // Continue processing to show empty state instead of auto-switching to Saved tab
    }
    
    // Update the appropriate tab view based on active tab
    if (state.popupState.activeTab === 'categorize') {
      // Force refresh current tabs using DataManager approach (flicker-free UI disabled)
      try {
        // Force refresh using new DataManager approach
        const { markContentDirty } = await import('./content-manager.js');
        markContentDirty('current');
        await displayTabs();
      } catch (error) {
        logger.error('❌ Failed to refresh tab content:', error);
      }
    } else if (state.popupState.activeTab === 'saved') {
      // Update saved tabs to refresh URL highlighting
      try {
        const { showSavedTabsContent } = await import('./saved-tabs-manager.js');
        const groupingType = state.popupState?.groupingSelections?.saved || 'category';
        // Use null to trigger new filter system
        await showSavedTabsContent(groupingType, null);
      } catch (error) {
        logger.error('❌ Failed to refresh saved tabs:', error);
      }
    }
    
    await updateCategorizeBadge();
    
    // Update mute button state
    const { updateMuteButtonState } = await import('./unified-toolbar.js');
    await updateMuteButtonState();
    
    // Note: Categorize button state is automatically updated by displayTabs/updateCurrentTabContent
    
    // Show appropriate status message based on active tab
    if (state.popupState.activeTab === 'saved') {
      // For saved tabs, we're just updating the URL highlighting
      // Don't show status messages as they would be distracting
    } else {
      // Check if there are uncategorized tabs for status message
      const hasUncategorized = categorizedTabs[0] && categorizedTabs[0].length > 0;
      
      // Show appropriate status message for current tabs
      // if (changeType === 'removed') {
      //   showStatus('Tab closed - display updated', 'success', 2000);
      // } else if (duplicatesChanged) {
      //   showStatus('Duplicate tab detected', 'success', 2000);
      // } else if (changeType === 'created' && hasUncategorized) {
      //   showStatus('New uncategorized tab detected', 'success', 2000);
      // }
    }
  } catch (error) {
    logger.error('Error refreshing tabs:', error);
  }
}

// Export default object
export default {
  initializeApp,
  setupAutoSave
};

// Export additional functions
export { loadCategorizedTabsFromBackground };

