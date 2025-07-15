/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Content Manager - Smart tab content management with background updates
 */

import { state } from './state-manager.js';
import { displayTabs } from './tab-display.js';
import { showSavedTabsContent } from './saved-tabs-manager.js';
import { $id } from '../utils/dom-helpers.js';

// Content state tracking
const contentState = {
  current: {
    loaded: false,
    lastUpdate: 0,
    lastTabCount: 0,
    lastTabHash: '',
    needsUpdate: true
  },
  saved: {
    loaded: false,
    lastUpdate: 0,
    lastSavedCount: 0,
    lastGrouping: 'category',
    lastCategoryFilters: { current: { important: true, useful: true, ignore: true }, saved: { important: true, useful: true, ignore: false } },
    needsUpdate: true
  },
  settings: {
    loaded: false,
    needsUpdate: false
  }
};

/**
 * Initialize content for all tabs (called once on app start)
 */
export async function initializeAllTabContent() {
  
  // Initialize current tabs content
  await updateCurrentTabContent(true);
  
  // Check if we need to initialize saved tab content based on target tab
  const targetTab = window._targetTab || state.popupState?.activeTab || 'categorize';
  
  if (targetTab === 'saved') {
    // User will start on saved tab, so we need to initialize it
    // (tab should already be active from app-initializer switchToTab call)
    await updateSavedTabContent(true);
  } else {
    // User will start on different tab, load saved content lazily when needed
    contentState.saved.loaded = false; // Will be loaded when user visits saved tab
  }
  
  // Settings tab doesn't need pre-loading (it's static)
  contentState.settings.loaded = true;
  
}

/**
 * Update current tab content (can happen while tab is hidden)
 * @param {boolean} force - Force update even if content seems fresh
 */
export async function updateCurrentTabContent(force = false) {
  const startTime = Date.now();
  
  try {
    
    // Check if update is needed
    if (!force && !contentState.current.needsUpdate) {
      return;
    }
    
    
    // Get current categorized tabs
    const { getCurrentTabs } = await import('./tab-data-source.js');
    const { categorizedTabs } = await getCurrentTabs();
    
    
    // Calculate content hash for change detection
    const tabsArray = Object.values(categorizedTabs).flat();
    const tabCount = tabsArray.length;
    const tabHash = generateTabHash(tabsArray);
    
    
    // Check if content actually changed
    if (!force && 
        contentState.current.lastTabCount === tabCount && 
        contentState.current.lastTabHash === tabHash) {
      contentState.current.needsUpdate = false;
      return;
    }
    
    // Display tabs using new DataManager system
    await displayTabs();
    
    
    // Update state tracking
    contentState.current.loaded = true;
    contentState.current.lastUpdate = startTime;
    contentState.current.lastTabCount = tabCount;
    contentState.current.lastTabHash = tabHash;
    contentState.current.needsUpdate = false;
    
    
    // Ensure tabs container is visible when content is loaded
    const tabsContainer = document.getElementById('tabsContainer');
    if (tabsContainer) {
      // Import show function
      const { show } = await import('../utils/dom-helpers.js');
      show(tabsContainer);
    } else {
      console.error('❌ CURRENT TAB: Tabs container element not found');
    }
    
    // Only update saved content if there were actual changes that affect it
    // (like new categorizations), not just because we viewed the Current tab
    if (contentState.saved.loaded && contentState.saved.needsUpdate) {
      // Check if this update was triggered by a categorization or just tab switching
      const timeSinceLastUpdate = Date.now() - contentState.saved.lastUpdate;
      if (timeSinceLastUpdate < 5000) {
        // If saved content was updated very recently, this is likely just tab switching
        contentState.saved.needsUpdate = false; // Reset the flag
      } else {
        await updateSavedTabContent();
      }
    } else if (contentState.saved.loaded) {
      // Content already loaded, no action needed
    }
    
  } catch (error) {
    console.error('❌ ContentManager: Error updating current tab content:', error);
  }
}

/**
 * Update saved tab content (can happen while tab is hidden)  
 * @param {boolean} force - Force update even if content seems fresh
 */
export async function updateSavedTabContent(force = false) {
  const startTime = Date.now();
  
  try {
    // Get current saved tab settings from state
    const currentGrouping = state.popupState?.groupingSelections?.saved || 'category';
    const currentCategoryFilters = state.popupState.categoryFilters || { current: { important: true, useful: true, ignore: true }, saved: { important: true, useful: true, ignore: false } };
    
    // Check if update is needed
    const filtersChanged = JSON.stringify(contentState.saved.lastCategoryFilters) !== JSON.stringify(currentCategoryFilters);
    if (!force && 
        !contentState.saved.needsUpdate &&
        contentState.saved.lastGrouping === currentGrouping &&
        !filtersChanged) {
      
      // Even if content is fresh, we need to restore scroll position when switching to saved tab
      const savedContent = $id('savedContent');
      if (savedContent && state.popupState.scrollPositions?.saved) {
        const scrollPos = state.popupState.scrollPositions.saved;
        
        // Use requestAnimationFrame to ensure content is rendered
        requestAnimationFrame(() => {
          setTimeout(() => {
            savedContent.scrollTop = scrollPos;
          }, 10);
        });
      }
      return;
    }
    
    
    // Use new DataManager system for saved tabs - pass null to use new filter system
    await showSavedTabsContent(currentGrouping, null);
    
    // Update state tracking
    contentState.saved.loaded = true;
    contentState.saved.lastUpdate = startTime;
    contentState.saved.lastGrouping = currentGrouping;
    contentState.saved.lastCategoryFilters = JSON.parse(JSON.stringify(currentCategoryFilters));
    contentState.saved.needsUpdate = false;
    
    
  } catch (error) {
    console.error('❌ ContentManager: Error updating saved tab content:', error);
  }
}

/**
 * Mark content as needing update (called when data changes)
 * @param {string} tabType - 'current', 'saved', or 'all'
 */
export function markContentDirty(tabType = 'all') {
  
  if (tabType === 'all' || tabType === 'current') {
    contentState.current.needsUpdate = true;
  }
  
  if (tabType === 'all' || tabType === 'saved') {
    contentState.saved.needsUpdate = true;
  }
}

/**
 * Update content for currently hidden tabs (background sync)
 * This is called when we know data has changed but want to update hidden tabs
 */
export async function syncHiddenTabContent() {
  const activeTab = state.popupState.activeTab;
  
  
  // Update current tab content if it's not active
  if (activeTab !== 'categorize' && contentState.current.needsUpdate) {
    await updateCurrentTabContent();
  }
  
  // Update saved tab content if it's not active  
  if (activeTab !== 'saved' && contentState.saved.needsUpdate) {
    await updateSavedTabContent();
  }
}

/**
 * Get content freshness info for debugging
 */
export function getContentStatus() {
  return {
    current: {
      loaded: contentState.current.loaded,
      needsUpdate: contentState.current.needsUpdate,
      lastUpdate: new Date(contentState.current.lastUpdate).toLocaleTimeString(),
      tabCount: contentState.current.lastTabCount
    },
    saved: {
      loaded: contentState.saved.loaded,
      needsUpdate: contentState.saved.needsUpdate,
      lastUpdate: new Date(contentState.saved.lastUpdate).toLocaleTimeString(),
      grouping: contentState.saved.lastGrouping
    },
    settings: {
      loaded: contentState.settings.loaded
    }
  };
}

/**
 * Generate a simple hash of tab data for change detection
 * @param {Array} tabs - Array of tab objects
 * @returns {string} Hash string
 */
function generateTabHash(tabs) {
  // Create a simple hash based on tab URLs, titles, and duplicate counts
  const hashString = tabs
    .map(tab => `${tab.url}:${tab.title}:${tab.category || 0}:${tab.duplicateCount || 1}`)
    .sort()
    .join('|');
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < hashString.length; i++) {
    const char = hashString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return hash.toString();
}

// Export content state for debugging
export { contentState };