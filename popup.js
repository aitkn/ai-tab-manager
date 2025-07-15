/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Main popup entry point - coordinates all modules
 */

// Check if popup redirect stopped initialization
if (window._stopPopupInit) {
  throw new Error('Popup initialization stopped - redirecting to full window');
}

// Import all modules
import './src/config/config.js'; // Load CONFIG global first
import './src/utils/logger.js'; // Load centralized logger

// Import constants
// import { TAB_CATEGORIES, DOM_IDS, CSS_CLASSES, DISPLAY, EVENTS } from './src/utils/constants.js'; // Unused

// Import helpers
// import { getRootDomain, extractDomain, formatDate } from './src/utils/helpers.js'; // Unused
// import { $, $id, show, hide, on } from './src/utils/dom-helpers.js'; // Unused

// Import services
// import ChromeAPIService from './src/services/ChromeAPIService.js'; // Unused
// import StorageService from './src/services/StorageService.js'; // Unused  
// import MessageService from './src/services/MessageService.js'; // Unused

// Import feature modules
import { state } from './src/modules/state-manager.js';
import { initializeApp, setupAutoSave } from './src/modules/app-initializer.js';


// Flicker-free UI system removed - using simple morphdom approach

// Database is loaded as a global in popup.html

// Set up auto-save handlers
setupAutoSave();

// Store when popup closes
window.addEventListener('unload', () => {
  browser.storage.local.set({ lastPopupCloseTime: Date.now() });
});

// Load state and initialize DOM atomically
async function initializeWithState() {
  // Now perform initialization
  performInitialization();
}

async function performInitialization() {
  // Check last popup close time
  let shouldGoToCurrentTab = false;
  try {
    const timeResult = await browser.storage.local.get(['lastPopupCloseTime']);
    if (timeResult.lastPopupCloseTime) {
      const timeSinceLastClose = Date.now() - timeResult.lastPopupCloseTime;
      const oneMinuteInMs = 60 * 1000;
      
      if (timeSinceLastClose > oneMinuteInMs) {
        shouldGoToCurrentTab = true;
        // Going to Current tab
      } else {
        // Using saved tab
      }
    } else {
      // First time opening - go to current tab
      shouldGoToCurrentTab = true;
      // First time opening popup
    }
  } catch (error) {
    console.error('Error checking last close time:', error);
  }
  
  // Load both popup state and settings in a single call
  browser.storage.local.get(['popupState', 'settings']).then((result) => {
    
    // Apply loaded state immediately
    const savedPopupState = result.popupState || null;
    const savedSettings = result.settings || null;
    
    
    if (savedPopupState) {
      Object.assign(state.popupState, savedPopupState);
      state.isViewingSaved = savedPopupState.isViewingSaved || false;
      // Clear search query on popup startup - don't restore it
      state.searchQuery = '';
      state.popupState.searchQuery = '';
    }
    
    if (savedSettings) {
      Object.assign(state.settings, savedSettings);
    }
    
    // Check if default rules need to be applied
    if (!state.settings.defaultRulesApplied || !state.settings.rules || state.settings.rules.length === 0) {
      // Flag for state-manager to handle default rules
      window._needsDefaultRules = true;
    }
    
    // Determine target tab based on time since last close
    let targetTab = 'categorize'; // Default
    
    if (shouldGoToCurrentTab) {
      // More than 1 minute since last close - go to Current tab
      targetTab = 'categorize';
      // Store flag to focus search later
      window._shouldFocusSearch = true;
      // Going to Current tab with search focus
    } else if (savedPopupState && savedPopupState.activeTab) {
      // Less than 1 minute - use saved tab
      targetTab = savedPopupState.activeTab;
      // Using saved tab
    }
    
    
    // Store globally and update state
    window._targetTab = targetTab;
    state.popupState.activeTab = targetTab;
    
    
    
    // Set correct DOM state immediately BEFORE any initialization
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tab === targetTab) {
        btn.classList.add('active');
      }
    });
    
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
      if (pane.id === `${targetTab}Tab`) {
        pane.classList.add('active');
      }
    });
    
    
    // Initialize the app
    
    // Initialize only the legacy system
    initializeApp().then(() => {
    }).catch(error => {
      console.error('App initialization failed:', error);
    });
  }).catch(error => {
    console.error('Failed to load storage:', error);
    // Initialize with defaults if storage fails
    initializeApp();
  });
}

// Initialize when DOM is ready
function preInitialize() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWithState);
  } else {
    // DOM is already loaded, initialize immediately
    initializeWithState();
  }
}


// Handle CSP eval errors from TensorFlow.js gracefully
window.addEventListener('error', (event) => {
  if (event.error && event.error.message && event.error.message.includes('unsafe-eval')) {
    // CSP error: TensorFlow.js eval blocked (expected in Chrome extensions)
    // ML features will be disabled due to Chrome extension CSP restrictions
    event.preventDefault(); // Prevent the error from being thrown
    return false;
  }
});

// Handle unhandled promise rejections that might be CSP related
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.message && event.reason.message.includes('unsafe-eval')) {
    event.preventDefault();
    return false;
  }
});





// Start pre-initialization immediately
preInitialize();

// Load diagnostic tools for development
Promise.all([
  import('./src/ml/diagnostics/training-data-diagnostic.js'),
  import('./src/ml/diagnostics/cleanup-duplicates.js')
]).then(() => {
  if (window.logger) {
    window.logger.mlDiagnostic('ML diagnostic tools loaded:');
    window.logger.mlDiagnostic('  - await window.diagnoseTrainingData() - Analyze training data');
    window.logger.mlDiagnostic('  - await window.cleanupDuplicateTrainingData() - Remove duplicate records');
  }
}).catch(err => {
  // ML diagnostic tools not available
});