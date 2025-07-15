/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Saved Tabs Manager - handles all saved tabs functionality
 */

import { DOM_IDS } from '../utils/constants.js';
import { $id, createElement } from '../utils/dom-helpers.js';
import { showStatus, updateSavedBadge, switchToTab } from './ui-manager.js';
import { state, saveGroupCollapseStates } from './state-manager.js';
import { preloadFavicons } from '../utils/favicon-loader.js';
import { unifiedSearchService } from '../services/UnifiedSearchService.js';
import { uiDataAdapter } from './ui-data-adapter.js';
import { createCategorySection as createUnifiedCategorySection, createGroupSection as createUnifiedGroupSection } from './tab-display.js';
// Database is available as window.window.tabDatabase

/**
 * Show saved tabs content
 */
export async function showSavedTabsContent(groupingType, includeCanClose = null) {
  try {
    // Rendering saved tabs content
    
    // Make sure the saved tab pane exists and is ready
    const savedTab = $id('savedTab');
    if (!savedTab) {
      console.error('Saved tab pane not found');
      return;
    }
    
    
    // Get current grouping from state first, then fallback to dropdown if not passed
    if (!groupingType) {
      // Read from state first (consistent with unified-toolbar approach)
      groupingType = state.popupState?.groupingSelections?.saved || 'category';
      
      // If state doesn't have it, fallback to dropdown as last resort
      if (groupingType === 'category' && state.popupState?.groupingSelections?.saved === undefined) {
        const savedGroupingSelect = $id(DOM_IDS.SAVED_GROUPING_SELECT);
        if (savedGroupingSelect && savedGroupingSelect.value !== 'category') {
          groupingType = savedGroupingSelect.value;
        }
      }
    }
    
    // Don't bypass data manager for custom groupings - let it handle everything
    
    // Check if DataManager is available and initialized
    if (!window.dataManager || !window.dataManager.isReady()) {
      console.warn('⚠️ SavedTabsManager: DataManager not available, using legacy method');
      
      if (window.dataManagerFailed) {
        console.error('❌ SavedTabsManager: DataManager initialization failed:', window.dataManagerError);
        showStatus('Error: Data system initialization failed. Please reload the extension.', 'error');
        return;
      }
      
      // Fallback to legacy saved tabs loading
      await loadSavedTabsLegacy(groupingType, includeCanClose, savedContent);
      return;
    }
    
    // Get search query from state
    const searchQuery = state.popupState?.searchQuery || '';
    
    // Set categories to include based on filter state
    let categories;
    if (includeCanClose !== null) {
      // Legacy compatibility mode - use boolean includeCanClose parameter
      categories = includeCanClose ? [1, 2, 3] : [2, 3];
    } else {
      // New filter system - use category filter state for saved tabs
      categories = [];
      if (state.popupState && state.popupState.categoryFilters && state.popupState.categoryFilters.saved) {
        const savedFilters = state.popupState.categoryFilters.saved;
        if (savedFilters.ignore) categories.push(1);   // Ignore
        if (savedFilters.useful) categories.push(2);   // Useful
        if (savedFilters.important) categories.push(3); // Important
      } else {
        // Default: show important and useful if state is not ready
        categories = [2, 3]; // Default: show important and useful
      }
    }
    
    // Process data using clean architecture
    const processedData = await window.dataManager.getSavedTabsData({
      searchQuery,
      categories,
      groupBy: groupingType,
      sortBy: 'savedDate', // Default sort by saved date
      // Don't override the default limits set in data-manager.js
      // The DataManager already sets maxGroups: 10 by default
    });
    
    // Adapt for UI rendering
    const uiData = uiDataAdapter.adaptForUI(processedData, {
      showCounters: true,
      formatDates: true,
      formatDomains: true
    });
    
    // Get the saved content container 
    let savedContent = $id(DOM_IDS.SAVED_CONTENT);
    if (!savedContent) {
      console.error('❌ SavedTabsManager: savedContent element not found!');
      showStatus('Error: Cannot find saved content container. Please reload extension.', 'error');
      return;
    }
    
    // Build new HTML content
    let newHTML = '';
    
    if (uiData.sections.length === 0) {
      // Check if this is due to search filtering or genuinely no saved tabs
      const searchQuery = state.popupState?.searchQuery || '';
      const hasActiveSearch = searchQuery.trim().length > 0;
      
      if (hasActiveSearch) {
        // Don't show empty state during search filtering - user can see search is active
        newHTML = '';
      } else {
        // Empty state HTML
        newHTML = `
          <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; display: block; opacity: 0.5;">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
            </svg>
            <h3 style="margin: 0 0 8px 0; font-weight: 500;">No saved tabs yet</h3>
            <p style="margin: 0; font-size: 14px;">Categorize your tabs and save them to view here</p>
          </div>
        `;
      }
    } else {
      // Check if we need to transform data for custom groupings
      const customGroupings = ['originallyOpened', 'lastViewed', 'saved', 'totalAge', 'timeSinceViewed', 'predictionConfidence', 'predictionAgreement'];
      if (customGroupings.includes(groupingType)) {
        // Transform the category-based sections into custom grouped sections
        const { renderSectionsToHTML, transformDataForCustomGrouping } = await import('./tab-display.js');
        const transformedData = await transformDataForCustomGrouping(uiData, groupingType, true);
        newHTML = await renderSectionsToHTML(transformedData.sections, groupingType, true, transformedData);
      } else {
        // Build sections HTML using centralized rendering logic
        const { renderSectionsToHTML } = await import('./tab-display.js');
        newHTML = await renderSectionsToHTML(uiData.sections, groupingType, true, uiData);
      }
    }
    
    // Check if this is a grouping change that requires full replacement
    const isGroupingChange = savedContent.dataset.lastGrouping && 
                            savedContent.dataset.lastGrouping !== groupingType;
    
    // Check if this is a search state change that requires full replacement
    const currentSearchQuery = state.popupState?.searchQuery || '';
    const lastSearchState = savedContent.dataset.lastSearchState || '';
    const hasActiveSearch = currentSearchQuery.trim().length > 0;
    const hadActiveSearch = lastSearchState === 'active';
    const isSearchStateChange = hasActiveSearch !== hadActiveSearch;
    
    // Also check if we're transitioning between empty and non-empty content during active search
    const hasContent = uiData.sections.length > 0;
    const lastHadContent = savedContent.dataset.lastHadContent === 'true';
    const isContentStateChange = hasActiveSearch && (hasContent !== lastHadContent);
    
    // Morphdom disabled - using direct DOM replacement
    {
      if (isGroupingChange) {
        // Grouping change handled
      } else if (isSearchStateChange) {
        // Search state change handled
      } else if (isContentStateChange) {
        // Content state change handled
      } else {
        // Other state change handled
      }
      
      // Save group collapse states before replacing content
      saveGroupCollapseStates();
      
      // Store scroll position before replacing content
      const scrollTop = savedContent.scrollTop;
      
      // Full replacement for grouping changes, search state changes, or fallback
      savedContent.innerHTML = newHTML;
      
      // Empty group handling is now centralized in renderSectionsToHTML
      
      // Restore scroll position after replacement
      requestAnimationFrame(() => {
        savedContent.scrollTop = scrollTop;
      });
      
      // Collapse states are now applied during rendering in unified-group-renderer.js
    }
    
    // Store the current grouping type, search state, and content state for next comparison
    savedContent.dataset.lastGrouping = groupingType;
    savedContent.dataset.lastSearchState = hasActiveSearch ? 'active' : 'inactive';
    savedContent.dataset.lastHadContent = hasContent ? 'true' : 'false';
    
    // Preload favicons for better performance
    const allTabs = uiData.sections.flatMap(section => section.items);
    if (allTabs.length > 0) {
      preloadFavicons(allTabs);
    }
    
    
  } catch (error) {
    showStatus('Error loading saved tabs: ' + error.message, 'error');
  }
}



/**
 * Create empty state message
 */
function createEmptyStateMessage() {
  return createElement('div', {
    style: 'text-align: center; padding: 40px 20px; color: var(--text-secondary);',
    innerHTML: `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; display: block; opacity: 0.5;">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
      </svg>
      <h3 style="margin: 0 0 8px 0; font-weight: 500;">No saved tabs yet</h3>
      <p style="margin: 0; font-size: 14px;">Categorize your tabs and save them to view here</p>
    `
  });
}



/**
 * Legacy function for compatibility
 */
export async function showSavedTabs() {
  switchToTab('saved');
}

/**
 * Load saved tabs count
 */
export async function loadSavedTabsCount() {
  try {
    // Count ALL saved tabs - categories 1 (Can Close), 2 (Save Later), and 3 (Important)
    const savedUrls = await window.window.tabDatabase.getSavedUrls([1, 2, 3]);
    updateSavedBadge(savedUrls.length);
    return savedUrls.length;
  } catch (error) {
    console.error('Error loading saved tabs count:', error);
    return 0;
  }
}

/**
 * Handle saved tab search using unified search service
 */
export function handleSavedTabSearch(searchQuery) {
  const savedContent = $id(DOM_IDS.SAVED_CONTENT);
  if (!savedContent) return;
  
  // Update unified search service context
  unifiedSearchService.setSearchQuery(searchQuery);
  unifiedSearchService.setContext('saved');
  
  const tabElements = savedContent.querySelectorAll('.tab-item');
  
  // Use unified search service for filtering
  const results = unifiedSearchService.filterTabs(tabElements, savedContent, true, {
    groupingType: getSavedGroupingType(),
    updateCounts: true,
    hideEmptyGroups: true,
    smartShowMore: true
  });
  
  return results;
}

/**
 * Get current saved tabs grouping type
 */
function getSavedGroupingType() {
  // Read from state first (consistent with unified-toolbar approach)
  const stateGrouping = state.popupState?.groupingSelections?.saved;
  if (stateGrouping) {
    return stateGrouping;
  }
  
  // Fallback to dropdown
  const savedGroupingSelect = $id(DOM_IDS.SAVED_GROUPING_SELECT);
  return savedGroupingSelect ? savedGroupingSelect.value : 'category';
}

/**
 * Render saved tabs to a specific container (for background renderer)
 * @param {HTMLElement} container - Container to render tabs into
 * @param {Object} savedData - Saved tabs data
 * @param {string} groupingType - Grouping type
 * @param {boolean} showIgnore - Whether to show ignored tabs
 */
export async function renderSavedTabsToContainer(container, savedData, groupingType) {
  if (!container || !savedData) return;
  
  
  // Clear container
  container.innerHTML = '';
  
  try {
    // Use the saved data provided
    const { tabs } = savedData;
    
    if (!tabs || tabs.length === 0) {
      container.innerHTML = '<div class="no-tabs">No saved tabs to display</div>';
      return;
    }
    
    // Group tabs and render
    await renderSavedTabGroupsToContainer(container, tabs, groupingType);
    
  } catch (error) {
    console.error('Error rendering saved tabs to container:', error);
    container.innerHTML = '<div class="error">Error loading saved tabs</div>';
  }
}

/**
 * Render saved tab groups to container
 * @param {HTMLElement} container - Container to render into
 * @param {Array} tabs - Saved tabs
 * @param {string} groupingType - Grouping type
 */
async function renderSavedTabGroupsToContainer(container, tabs, groupingType) {
  if (groupingType === 'category') {
    // Group by category
    const groupedTabs = {};
    tabs.forEach(tab => {
      const category = tab.category;
      if (!groupedTabs[category]) {
        groupedTabs[category] = [];
      }
      groupedTabs[category].push(tab);
    });
    
    // Render each category
    for (const [category, categoryTabs] of Object.entries(groupedTabs)) {
      if (categoryTabs.length > 0) {
        const categorySection = await createUnifiedCategorySection(parseInt(category), categoryTabs, true);
        if (categorySection) {
          container.appendChild(categorySection);
        }
      }
    }
  } else {
    // Use grouped view for other grouping types
    await renderGroupedSavedTabsToContainer(container, tabs, groupingType);
  }
}


/**
 * Render grouped saved tabs to container
 * @param {HTMLElement} container - Container to render into
 * @param {Array} tabs - Saved tabs
 * @param {string} groupingType - Grouping type
 */
async function renderGroupedSavedTabsToContainer(container, tabs, groupingType) {
  // Save original state
  const originalCategorizedTabs = state.categorizedTabs;
  
  try {
    // Use displayGroupedView from tab-display.js
    const { groupTabsBy } = await import('./tab-display.js');
    const groups = groupTabsBy(tabs, groupingType);
    
    // Render each group
    for (const [groupName, groupTabs] of Object.entries(groups)) {
      if (groupTabs.length > 0) {
        const groupSection = await createUnifiedGroupSection(groupName, groupTabs, groupingType, true);
        if (groupSection) {
          container.appendChild(groupSection);
        }
      }
    }
    
  } finally {
    // Restore original state
    state.categorizedTabs = originalCategorizedTabs;
  }
}


// Function removed - now using direct morphdom approach in showSavedTabsContent

/**
 * Legacy fallback function for when DataManager is not available
 * @param {string} groupingType - Grouping type
 * @param {boolean} includeCanClose - Whether to include can close category
 * @param {HTMLElement} savedContent - Container element
 */
async function loadSavedTabsLegacy(groupingType, includeCanClose, savedContent) {
  try {
    
    // Get the saved content container if not provided
    if (!savedContent) {
      savedContent = $id(DOM_IDS.SAVED_CONTENT);
    }
    
    if (!savedContent) {
      console.error('❌ SavedTabsManager: savedContent element not found for legacy loading');
      return;
    }
    
    // Set categories to include
    const categories = includeCanClose ? [1, 2, 3] : [2, 3];
    
    // Get saved tabs from database directly
    const savedUrls = await window.window.tabDatabase.getSavedUrls(categories);
    
    
    // Hide content to prevent scroll jump
    savedContent.style.opacity = '0';
    savedContent.style.pointerEvents = 'none';
    
    savedContent.innerHTML = '';
    
    if (savedUrls.length === 0) {
      // Show empty state
      const emptyMessage = createEmptyStateMessage();
      savedContent.appendChild(emptyMessage);
    } else {
      // Group and render tabs using legacy method
      await renderSavedTabGroupsToContainer(savedContent, savedUrls, groupingType);
    }
    
    // Show content with smooth transition
    requestAnimationFrame(() => {
      savedContent.style.transition = 'opacity 150ms ease-in-out';
      savedContent.style.opacity = '1';
      savedContent.style.pointerEvents = 'auto';
      
      // Restore scroll position
      if (state.popupState.scrollPositions?.saved) {
        const scrollPos = state.popupState.scrollPositions.saved;
        // Restoring scroll position
        requestAnimationFrame(() => {
          setTimeout(() => {
            savedContent.scrollTop = scrollPos;
            // Scroll position restored
          }, 10);
        });
      }
      
      // Clean up transition
      setTimeout(() => {
        savedContent.style.transition = '';
      }, 150);
    });
    
    // Saved tabs loading completed
    
  } catch (error) {
    console.error('❌ SavedTabsManager: Error in legacy saved tabs loading:', error);
    showStatus('Error loading saved tabs: ' + error.message, 'error');
  }
}

// Export default object
export default {
  showSavedTabsContent,
  showSavedTabs,
  loadSavedTabsCount,
  handleSavedTabSearch,
  renderSavedTabsToContainer
};