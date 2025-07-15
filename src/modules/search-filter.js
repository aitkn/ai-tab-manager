/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Search Filter Module - handles search functionality for tabs
 */

import { DOM_IDS } from '../utils/constants.js';
import { $id } from '../utils/dom-helpers.js';
import { state, updateState, savePopupState, saveGroupCollapseStates } from './state-manager.js';
import { showStatus, updateCategorizeBadge } from './ui-manager.js';
import { unifiedSearchService } from '../services/UnifiedSearchService.js';
import { displayTabs } from './tab-display.js';
import { showSavedTabsContent } from './saved-tabs-manager.js';

/**
 * Handle search input for categorized tabs
 */
export function onSearchInput(e) {
  const query = e.target.value.toLowerCase().trim();
  updateState('searchQuery', query);
  
  // Update unified search service
  unifiedSearchService.setSearchQuery(query);
  unifiedSearchService.setContext('current');
  
  // Trigger re-render with search query (centralized approach)
  refreshCurrentView();
  
  savePopupState();
}

/**
 * Clear search and reset filter
 */
export function clearSearch() {
  const searchInput = $id(DOM_IDS.SEARCH_INPUT);
  if (searchInput) {
    searchInput.value = '';
  }
  updateState('searchQuery', '');
  
  // Clear unified search service
  unifiedSearchService.setSearchQuery('');
  
  // Trigger re-render without search query (centralized approach)
  refreshCurrentView();
  
  savePopupState();
}

/**
 * Check if a tab matches the search query
 * @deprecated Use unifiedSearchService.matchesSearch() instead
 */
export function matchesSearch(tab, query) {
  // Legacy compatibility - use unified search service
  const originalQuery = unifiedSearchService.searchQuery;
  if (query !== undefined) {
    unifiedSearchService.setSearchQuery(query);
  }
  const result = unifiedSearchService.matchesSearch(tab, false);
  if (query !== undefined) {
    unifiedSearchService.setSearchQuery(originalQuery);
  }
  return result;
}

/**
 * Apply search filter to all displayed tabs
 */
export async function applySearchFilter() {
  const container = $id(DOM_IDS.CURRENT_CONTENT) || document;
  const groupSections = container.querySelectorAll('.group-section');
  
  // Update unified search service context
  unifiedSearchService.setContext('current');
  
  if (groupSections.length > 0) {
    // We're in grouped view - use unified search service
    applyGroupedSearchFilter(state.searchQuery);
    return;
  }
  
  // We're in category view - use unified search service
  const allTabs = container.querySelectorAll('.tab-item');
  
  // Use unified search service for filtering
  unifiedSearchService.filterTabs(allTabs, container, true, {
    groupingType: 'category',
    updateCounts: true,
    hideEmptyGroups: true,
    smartShowMore: true
  });
  
  // Update categorize tab badge
  updateCategorizeBadge();
}




/**
 * Filter tabs in a group section based on actual tab data, not DOM visibility
 * @deprecated Use unifiedSearchService.filterTabs() instead
 */
export function filterGroupTabs(groupSection, searchQuery) {
  // Use unified search service
  unifiedSearchService.setSearchQuery(searchQuery);
  const tabs = groupSection.querySelectorAll('.tab-item');
  
  const results = unifiedSearchService.filterTabs(tabs, groupSection, true, {
    groupingType: 'domain',
    updateCounts: true,
    hideEmptyGroups: true,
    smartShowMore: true
  });
  
  return results.visibleCount;
}





/**
 * Apply search filter to grouped view
 */
export function applyGroupedSearchFilter(searchQuery) {
  const container = $id(DOM_IDS.CURRENT_CONTENT) || document;
  const groupSections = container.querySelectorAll('.group-section');
  
  // Update unified search service
  unifiedSearchService.setSearchQuery(searchQuery);
  unifiedSearchService.setContext('current');
  
  // Use unified search service for each group
  groupSections.forEach(section => {
    const tabs = section.querySelectorAll('.tab-item');
    unifiedSearchService.filterTabs(tabs, section, true, {
      groupingType: 'domain', // Most common grouped view
      updateCounts: true,
      hideEmptyGroups: true,
      smartShowMore: true
    });
  });
}

/**
 * Initialize search functionality
 */
export function initializeSearch() {
  // DEPRECATED: Search input is now handled by unified toolbar
  // Set up search input handlers
  const searchInput = $id(DOM_IDS.SEARCH_INPUT);
  if (searchInput) {
    console.warn('⚠️ Legacy search input found - should use unified toolbar instead');
    // searchInput.addEventListener('input', onSearchInput);
    
    // Restore search value if any
    if (state.searchQuery) {
      searchInput.value = state.searchQuery;
    }
  }
  
  // Set up clear search button
  const clearSearchBtn = $id(DOM_IDS.CLEAR_SEARCH_BTN);
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', clearSearch);
  }
  
  // Set up saved tabs search
  const savedSearchInput = $id(DOM_IDS.SAVED_SEARCH_INPUT);
  if (savedSearchInput) {
    savedSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      handleSavedTabSearch(query);
    });
  }
  
  const clearSavedSearchBtn = $id(DOM_IDS.CLEAR_SAVED_SEARCH_BTN);
  if (clearSavedSearchBtn) {
    clearSavedSearchBtn.addEventListener('click', () => {
      if (savedSearchInput) {
        savedSearchInput.value = '';
        handleSavedTabSearch('');
      }
    });
  }
}

// Re-export handleSavedTabSearch from saved-tabs-manager
import { handleSavedTabSearch } from './saved-tabs-manager.js';

/**
 * Apply search filter to saved tabs
 */
export function applySavedSearchFilter(query) {
  handleSavedTabSearch(query);
}

/**
 * Refresh current view using DataManager
 */
async function refreshCurrentView() {
  try {
    
    // Save current group collapse states before re-rendering
    saveGroupCollapseStates();
    
    if (state.isViewingSaved) {
      // Refresh saved tabs view
      const groupingType = state.popupState?.groupingSelections?.saved || 'category';
      await showSavedTabsContent(groupingType);
    } else {
      // Refresh current tabs view
      await displayTabs(false); // false = not from saved
    }
    
    // Collapse states are now applied during rendering in unified-group-renderer.js
  } catch (error) {
    console.error('Error refreshing view after search:', error);
    showStatus('Error updating search results', 'error');
  }
}

// Export default object
export default {
  onSearchInput,
  clearSearch,
  matchesSearch,
  applySearchFilter,
  filterGroupTabs,
  applyGroupedSearchFilter,
  initializeSearch,
  applySavedSearchFilter
};