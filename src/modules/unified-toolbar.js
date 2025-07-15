/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Unified Toolbar - manages the shared toolbar across tabs
 */

import { DOM_IDS } from '../utils/constants.js';
import { $id, on, show, hide } from '../utils/dom-helpers.js';
import { state, updateState, savePopupState } from './state-manager.js';
import logger from '../utils/logger.js';
import { updateCloseAllButtonColor } from './ui-utilities.js';
import { displayTabs } from './tab-display.js';
import { showSavedTabsContent } from './saved-tabs-manager.js';
// import { applySavedSearchFilter } from './search-filter.js'; // Unused - kept for future use
import { unifiedSearchService } from '../services/UnifiedSearchService.js';
import { toggleAllGroups, updateToggleButtonIcon } from './ui-utilities.js';
import { handleCategorize } from './categorization-service.js';
import { closeAllTabs } from './tab-operations.js';
import { exportToCSV } from './import-export.js';

// Grouping options for different tabs
const CURRENT_TAB_GROUPING_OPTIONS = [
  { value: 'category', text: 'Category' },
  { value: 'domain', text: 'Domain' },
  { value: 'opened', text: 'Opened' },
  { value: 'lastActive', text: 'Last Active' },
  { value: 'timeOpen', text: 'Time Open' }
];

const SAVED_TAB_GROUPING_OPTIONS = [
  { value: 'category', text: 'Category' },
  { value: 'domain', text: 'Domain' },
  { value: 'originallyOpened', text: 'Originally Opened' },
  { value: 'lastViewed', text: 'Last Viewed' },
  { value: 'saved', text: 'Saved' },
  { value: 'totalAge', text: 'Total Age' },
  { value: 'timeSinceViewed', text: 'Time Since Viewed' },
  { value: 'predictionConfidence', text: 'Prediction Confidence' },
  { value: 'predictionAgreement', text: 'Prediction Agreement' }
];

let currentActiveTab = 'categorize';
let searchDebounceTimer = null;

/**
 * Ensure the category filter state structure exists
 */
function ensureFilterStateStructure() {
  if (!state.popupState) {
    state.popupState = {};
  }
  
  if (!state.popupState.categoryFilters) {
    state.popupState.categoryFilters = {
      current: {
        uncategorized: true,
        important: true,
        useful: true,
        ignore: true
      },
      saved: {
        uncategorized: false,
        important: true,
        useful: true,
        ignore: false
      }
    };
  }
  
  if (!state.popupState.categoryFilters.current) {
    state.popupState.categoryFilters.current = {
      uncategorized: true,
      important: true,
      useful: true,
      ignore: true
    };
  }
  
  if (!state.popupState.categoryFilters.saved) {
    state.popupState.categoryFilters.saved = {
      uncategorized: false,
      important: true,
      useful: true,
      ignore: false
    };
  }
  
  // Migrate existing filter states to include uncategorized
  if (state.popupState.categoryFilters.current && !('uncategorized' in state.popupState.categoryFilters.current)) {
    state.popupState.categoryFilters.current.uncategorized = true;
  }
  if (state.popupState.categoryFilters.saved && !('uncategorized' in state.popupState.categoryFilters.saved)) {
    state.popupState.categoryFilters.saved.uncategorized = false;
  }
  
  // Ensure granularity state exists
  if (!state.popupState.granularity) {
    state.popupState.granularity = {
      current: 'day',  // Default granularity for current tabs
      saved: 'day'     // Default granularity for saved tabs
    };
  }
}

/**
 * Initialize the unified toolbar
 */
export function initializeUnifiedToolbar() {
  // Get toolbar elements
  const searchInput = $id('unifiedSearchInput');
  const clearSearchBtn = $id('clearUnifiedSearchBtn');
  const groupingSelect = $id('unifiedGroupingSelect');
  const toggleBtn = $id('toggleGroupsBtn');
  const categorizeBtn = $id(DOM_IDS.CATEGORIZE_BTN);
  const closeAllBtn = $id(DOM_IDS.CLOSE_ALL_BTN2);
  const filterImportantBtn = $id('filterImportantBtn');
  const filterUsefulBtn = $id('filterUsefulBtn');
  const filterIgnoreBtn = $id('filterIgnoreBtn');
  const exportBtn = $id('exportBtn');
  const importBtn = $id('importBtn');
  
  // Set up event listeners
  if (searchInput) {
    on(searchInput, 'input', handleSearch);
  }
  
  if (clearSearchBtn) {
    on(clearSearchBtn, 'click', clearSearch);
  }
  
  if (groupingSelect) {
    on(groupingSelect, 'change', handleGroupingChange);
  }
  
  if (toggleBtn) {
    on(toggleBtn, 'click', toggleAllGroups);
  }
  
  if (categorizeBtn) {
    on(categorizeBtn, 'click', handleCategorize);
  }
  
  if (closeAllBtn) {
    on(closeAllBtn, 'click', () => closeAllTabs());
  }
  
  const muteAllBtn = $id('muteAllBtn');
  if (muteAllBtn) {
    on(muteAllBtn, 'click', async () => {
      // Disable button immediately to prevent double-clicks
      muteAllBtn.disabled = true;
      
      const { muteAllAudibleTabs } = await import('./tab-operations.js');
      await muteAllAudibleTabs();
      
      // Button state will be updated by muteAllAudibleTabs function
    });
  }
  
  if (filterImportantBtn) {
    on(filterImportantBtn, 'click', () => handleFilterButtonClick('important'));
  }
  
  if (filterUsefulBtn) {
    on(filterUsefulBtn, 'click', () => handleFilterButtonClick('useful'));
  }
  
  if (filterIgnoreBtn) {
    on(filterIgnoreBtn, 'click', () => handleFilterButtonClick('ignore'));
  }
  
  const filterUncategorizedBtn = $id('filterUncategorizedBtn');
  if (filterUncategorizedBtn) {
    on(filterUncategorizedBtn, 'click', () => handleFilterButtonClick('uncategorized'));
  }
  
  if (exportBtn) {
    on(exportBtn, 'click', exportToCSV);
  }
  
  if (importBtn) {
    on(importBtn, 'click', () => $id('csvFileInput')?.click());
  }
  
  // Set up granularity button listeners
  const granularityButtons = document.querySelectorAll('.granularity-btn');
  granularityButtons.forEach(btn => {
    on(btn, 'click', (e) => handleGranularityChange(e.target.dataset.granularity));
  });
  
  // Initialize mute button state
  updateMuteButtonState();
  
  // Don't set default toolbar state - will be set by app initializer
  // Don't initialize filter button states here - will be done after state is loaded
}

/**
 * Update toolbar when switching tabs
 * @param {string} tabType - The tab type ('categorize', 'saved', 'settings')
 * @param {boolean} isInitializing - Whether this is called during app initialization
 */
export async function updateToolbarVisibility(tabType, isInitializing = false) {
  
  currentActiveTab = tabType;
  
  // For Settings tab: hide entire toolbar and return
  if (tabType === 'settings') {
    hideToolbar();
    return;
  }
  
  // For all other tabs: show toolbar first
  showToolbar();
  
  const currentTabControls = $id('currentTabControls');
  const savedTabControls = $id('savedTabControls');
  const searchInput = $id('unifiedSearchInput');
  const groupingSelect = $id('unifiedGroupingSelect');
  
  // The middle section (grouping dropdown + expand) is always visible when toolbar is shown
  // Only manage the left and right tab-specific sections
  
  if (tabType === 'categorize') {
    
    // Show current tab controls, hide saved tab controls
    show(currentTabControls, 'flex');
    hide(savedTabControls);
    
    // Set search placeholder
    searchInput.placeholder = 'Search tabs...';
    
    // Populate grouping options for current tab
    populateGroupingOptions(CURRENT_TAB_GROUPING_OPTIONS);
    
    // Show the close all button
    const closeAllBtn = $id(DOM_IDS.CLOSE_ALL_BTN2);
    if (closeAllBtn) {
      show(closeAllBtn, 'inline-block');
    }
    
    // Restore grouping selection
    if (state.popupState.groupingSelections?.categorize) {
      groupingSelect.value = state.popupState.groupingSelections.categorize;
    }
    
    // Update close all button color
    await updateCloseAllButtonColor();
    
    // Update filter button states for current tab context
    updateFilterButtonStates();
    
    // Update toggle button icon for current context
    updateToggleButtonIcon();
    
    // Enable uncategorized button for current tabs
    const filterUncategorizedBtn = $id('filterUncategorizedBtn');
    if (filterUncategorizedBtn) {
      filterUncategorizedBtn.disabled = false;
    }
    
    // Update granularity button states if visible
    const currentGrouping = state.popupState.groupingSelections?.categorize || 'category';
    handleGroupingChange({ target: { value: currentGrouping } });
    
    // Note: Categorize button state is automatically updated when tabs are displayed
    
  } else if (tabType === 'saved') {
    
    // Hide current tab controls, show saved tab controls
    hide(currentTabControls);
    show(savedTabControls, 'flex');
    
    // Set search placeholder
    searchInput.placeholder = 'Search tabs...';
    
    // Populate grouping options for saved tab
    populateGroupingOptions(SAVED_TAB_GROUPING_OPTIONS);
    
    // Hide the close all button for saved tabs
    const closeAllBtn = $id(DOM_IDS.CLOSE_ALL_BTN2);
    if (closeAllBtn) {
      hide(closeAllBtn);
    }
    
    // Restore grouping selection and filter buttons
    if (state.popupState.groupingSelections?.saved) {
      groupingSelect.value = state.popupState.groupingSelections.saved;
    }
    
    // Restore filter button states
    updateFilterButtonStates();
    
    // Update toggle button icon for saved context
    updateToggleButtonIcon();
    
    // Disable uncategorized button for saved tabs
    const filterUncategorizedBtn = $id('filterUncategorizedBtn');
    if (filterUncategorizedBtn) {
      filterUncategorizedBtn.disabled = true;
      filterUncategorizedBtn.title = 'Uncategorized filter not available for saved tabs';
    }
    
    // Update granularity button states if visible
    const savedGrouping = state.popupState.groupingSelections?.saved || 'category';
    handleGroupingChange({ target: { value: savedGrouping } });
    
  }
  
  // Clear search when switching tabs (except settings which doesn't have toolbar)
  // Skip clearSearch during initialization to prevent double rendering
  if (tabType !== 'settings' && !isInitializing) {
    clearSearch();
  }
}

/**
 * Show the toolbar
 */
export function showToolbar() {
  const toolbar = $id('unifiedToolbar');
  if (toolbar) {
    show(toolbar, 'flex');
  } else {
    logger.error('❌ TOOLBAR: Toolbar element not found');
  }
}

/**
 * Hide the toolbar
 */
export function hideToolbar() {
  const toolbar = $id('unifiedToolbar');
  if (toolbar) {
    hide(toolbar);
  } else {
    logger.error('❌ TOOLBAR: Toolbar element not found for hiding');
  }
}

/**
 * Populate grouping options based on active tab
 */
function populateGroupingOptions(options) {
  const groupingSelect = $id('unifiedGroupingSelect');
  if (!groupingSelect) {
    return;
  }
  
  groupingSelect.innerHTML = '';
  options.forEach((option) => {
    const optionEl = document.createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.text;
    groupingSelect.appendChild(optionEl);
  });
  
}

/**
 * Handle search input
 */
async function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  logger.uiEvents('🔍 handleSearch called with query:', query);
  
  // Add back debounce since events are working, but fix state sync
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  
  searchDebounceTimer = setTimeout(async () => {
    logger.uiEvents('🔍 Executing search after debounce with query:', query);
    
    if (currentActiveTab === 'categorize') {
      // Ensure state is updated BEFORE calling render functions
      updateState('searchQuery', query);
      state.popupState.searchQuery = query; // Also update popup state
      unifiedSearchService.setSearchQuery(query);
      unifiedSearchService.setContext('current');
      
      logger.uiEvents('🔍 State updated, calling showCurrentTabsContent with query:', state.searchQuery);
      
      const { showCurrentTabsContent } = await import('./tab-display.js');
      const groupingType = state.popupState?.groupingSelections?.categorize || 'category';
      await showCurrentTabsContent(groupingType);
      savePopupState();
    } else if (currentActiveTab === 'saved') {
      // Ensure state is updated BEFORE calling render functions
      updateState('searchQuery', query);
      state.popupState.searchQuery = query; // Also update popup state
      unifiedSearchService.setSearchQuery(query);
      unifiedSearchService.setContext('saved');
      
      logger.uiEvents('🔍 State updated, calling showSavedTabsContent with query:', state.popupState.searchQuery);
      
      const { showSavedTabsContent } = await import('./saved-tabs-manager.js');
      // Read grouping type from state (same as content-manager)
      const groupingType = state.popupState?.groupingSelections?.saved || 'category';
      await showSavedTabsContent(groupingType);
      savePopupState();
    }
  }, 200); // 200ms debounce - good balance between responsiveness and performance
}

/**
 * Clear search
 */
async function clearSearch() {
  const searchInput = $id('unifiedSearchInput');
  if (searchInput) {
    searchInput.value = '';
    
    if (currentActiveTab === 'categorize') {
      // Use the same logic as search-filter.js clearSearch
      updateState('searchQuery', '');
      state.popupState.searchQuery = ''; // Also update popup state
      
      // Clear unified search service
      unifiedSearchService.setSearchQuery('');
      
      // Use centralized rendering approach - trigger content refresh
      const { showCurrentTabsContent } = await import('./tab-display.js');
      const groupingType = state.popupState?.groupingSelections?.categorize || 'category';
      await showCurrentTabsContent(groupingType);
      savePopupState();
    } else if (currentActiveTab === 'saved') {
      // Use centralized rendering approach for saved tabs too
      updateState('searchQuery', '');
      state.popupState.searchQuery = ''; // Also update popup state
      unifiedSearchService.setSearchQuery('');
      unifiedSearchService.setContext('saved');
      
      const { showSavedTabsContent } = await import('./saved-tabs-manager.js');
      // Read grouping type from state (same as content-manager)
      const groupingType = state.popupState?.groupingSelections?.saved || 'category';
      await showSavedTabsContent(groupingType);
      savePopupState();
    }
  }
}

/**
 * Handle grouping change
 */
function handleGroupingChange(e) {
  const newGrouping = e.target.value;
  logger.uiEvents('🎯 handleGroupingChange:', {
    newGrouping: newGrouping,
    currentActiveTab: currentActiveTab,
    event: e
  });
  
  // Show/hide granularity controls based on grouping type
  const granularityControls = $id('granularityControls');
  const timeBasedGroupings = [
    'opened', 'lastActive', 'timeOpen',
    'originallyOpened', 'lastViewed', 'saved', 
    'totalAge', 'timeSinceViewed'
  ];
  
  if (granularityControls) {
    if (timeBasedGroupings.includes(newGrouping)) {
      logger.uiState('🎯 Showing granularity controls for:', newGrouping);
      show(granularityControls, 'flex');
      // Update granularity button states to show saved granularity
      updateGranularityButtonStates();
    } else {
      logger.uiState('🎯 Hiding granularity controls for:', newGrouping);
      hide(granularityControls);
    }
  }
  
  if (currentActiveTab === 'categorize') {
    logger.uiState('🎯 Updating categorize grouping to:', newGrouping);
    state.popupState.groupingSelections.categorize = newGrouping;
    savePopupState();
    displayTabs();
  } else if (currentActiveTab === 'saved') {
    logger.uiState('🎯 Updating saved grouping to:', newGrouping);
    state.popupState.groupingSelections.saved = newGrouping;
    savePopupState();
    // Use null to trigger new filter system
    showSavedTabsContent(newGrouping, null);
  }
}

/**
 * Handle filter button click
 */
async function handleFilterButtonClick(filterType) {
  // Ensure the filter state structure exists
  ensureFilterStateStructure();
  
  // Determine which tab context we're in
  const context = currentActiveTab === 'categorize' ? 'current' : 'saved';
  
  // Toggle the filter state for the current context
  state.popupState.categoryFilters[context][filterType] = !state.popupState.categoryFilters[context][filterType];
  savePopupState();
  
  // Update button visual states
  updateFilterButtonStates();
  
  // Refresh content with new filter based on active tab
  if (currentActiveTab === 'categorize') {
    // Refresh current tabs
    const { showCurrentTabsContent } = await import('./tab-display.js');
    const grouping = state.popupState.groupingSelections.categorize || 'category';
    await showCurrentTabsContent(grouping);
  } else if (currentActiveTab === 'saved') {
    // Refresh saved tabs
    const grouping = state.popupState.groupingSelections.saved || 'category';
    showSavedTabsContent(grouping, null);
  }
}

/**
 * Update visual states of filter buttons
 */
function updateFilterButtonStates() {
  const filterImportantBtn = $id('filterImportantBtn');
  const filterUsefulBtn = $id('filterUsefulBtn');
  const filterIgnoreBtn = $id('filterIgnoreBtn');
  const filterUncategorizedBtn = $id('filterUncategorizedBtn');
  
  // Ensure the filter state structure exists
  ensureFilterStateStructure();
  
  // Determine which context we're in
  const context = currentActiveTab === 'categorize' ? 'current' : 'saved';
  const filters = state.popupState.categoryFilters[context];
  
  if (filterImportantBtn) {
    const isActive = filters.important;
    filterImportantBtn.classList.toggle('active', isActive);
    filterImportantBtn.title = isActive ? 'Hide Important tabs' : 'Show Important tabs';
  }
  if (filterUsefulBtn) {
    const isActive = filters.useful;
    filterUsefulBtn.classList.toggle('active', isActive);
    filterUsefulBtn.title = isActive ? 'Hide Useful tabs' : 'Show Useful tabs';
  }
  if (filterIgnoreBtn) {
    const isActive = filters.ignore;
    filterIgnoreBtn.classList.toggle('active', isActive);
    filterIgnoreBtn.title = isActive ? 'Hide Ignore tabs' : 'Show Ignore tabs';
  }
  if (filterUncategorizedBtn) {
    const isActive = filters.uncategorized;
    filterUncategorizedBtn.classList.toggle('active', isActive);
    filterUncategorizedBtn.title = isActive ? 'Hide Uncategorized tabs' : 'Show Uncategorized tabs';
  }
}

/**
 * Get array of active category IDs based on filter state
 * @param {string} context - Either 'current' or 'saved'
 */
function getActiveCategoryIds(context = 'saved') {
  // Ensure the filter state structure exists
  ensureFilterStateStructure();
  
  const filters = state.popupState.categoryFilters[context];
  const activeCategoryIds = [];
  if (filters.uncategorized) activeCategoryIds.push(0); // Uncategorized
  if (filters.ignore) activeCategoryIds.push(1);   // Ignore
  if (filters.useful) activeCategoryIds.push(2);   // Useful
  if (filters.important) activeCategoryIds.push(3); // Important
  return activeCategoryIds;
}

/**
 * Handle granularity button click
 */
function handleGranularityChange(granularity) {
  // Ensure state structure exists
  ensureFilterStateStructure();
  
  // Update granularity for current context
  const context = currentActiveTab === 'categorize' ? 'current' : 'saved';
  state.popupState.granularity[context] = granularity;
  savePopupState();
  
  // Update button visual states
  updateGranularityButtonStates();
  
  // Refresh the current view with new granularity
  if (currentActiveTab === 'categorize') {
    displayTabs();
  } else if (currentActiveTab === 'saved') {
    const grouping = state.popupState.groupingSelections.saved || 'category';
    showSavedTabsContent(grouping, null);
  }
}

/**
 * Update visual states of granularity buttons
 */
function updateGranularityButtonStates() {
  const context = currentActiveTab === 'categorize' ? 'current' : 'saved';
  const activeGranularity = state.popupState.granularity?.[context] || 'day';
  
  
  const granularityButtons = document.querySelectorAll('.granularity-btn');
  granularityButtons.forEach(btn => {
    const isActive = btn.dataset.granularity === activeGranularity;
    btn.classList.toggle('active', isActive);
  });
}

/**
 * Update categorize button state based on uncategorized tabs
 */
async function updateCategorizeButtonState() {
  const categorizeBtn = $id('categorizeBtn');
  if (!categorizeBtn) {
    return;
  }
  
  // Check if categorization is in progress
  const categorizationService = await import('./categorization-service.js');
  if (categorizationService.default.isCategorizationInProgress) {
    // Keep button disabled during processing
    return;
  }
  
  try {
    // Get current tabs to check for uncategorized ones
    const { getCurrentTabs } = await import('./tab-data-source.js');
    const { categorizedTabs } = await getCurrentTabs();
    
    // Check if there are uncategorized tabs (category 0)
    const uncategorizedTabs = categorizedTabs[0] || [];
    const hasUncategorized = uncategorizedTabs.length > 0;
    
    // Update button state
    categorizeBtn.disabled = !hasUncategorized;
    
    if (hasUncategorized) {
      categorizeBtn.title = `Categorize ${uncategorizedTabs.length} uncategorized tab${uncategorizedTabs.length === 1 ? '' : 's'}`;
      categorizeBtn.classList.remove('disabled');
    } else {
      categorizeBtn.title = 'No uncategorized tabs to process';
      categorizeBtn.classList.add('disabled');
    }
    
  } catch (error) {
    logger.error('Error updating categorize button state:', error);
    // On error, keep button enabled but update title
    categorizeBtn.disabled = false;
    categorizeBtn.title = 'Categorize tabs';
  }
}

/**
 * Update mute button state based on whether there are audible tabs
 */
async function updateMuteButtonState() {
  const { hasAudibleTabs } = await import('./tab-operations.js');
  const muteAllBtn = $id('muteAllBtn');
  
  if (muteAllBtn) {
    const hasAudible = await hasAudibleTabs();
    muteAllBtn.disabled = !hasAudible;
    muteAllBtn.title = hasAudible ? 'Mute all audible tabs' : 'No audible tabs';
  }
}

// Export functions
export { updateCategorizeButtonState, updateFilterButtonStates, getActiveCategoryIds, updateMuteButtonState };

export default {
  initializeUnifiedToolbar,
  updateToolbarVisibility,
  showToolbar,
  hideToolbar,
  updateCategorizeButtonState,
  updateFilterButtonStates,
  getActiveCategoryIds,
  updateMuteButtonState
};