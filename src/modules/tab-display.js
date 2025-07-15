/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Tab Display Module - handles rendering of tabs in various views
 */

import { DOM_IDS, TAB_CATEGORIES, GROUPING_OPTIONS } from '../utils/constants.js';
import { $id, show, createElement } from '../utils/dom-helpers.js';
import { getWeekStartDate, formatDate, extractDateFromGroupName, sortGroups } from '../utils/helpers.js';
import { preloadFavicons } from '../utils/favicon-loader.js';
import { state, saveGroupCollapseStates } from './state-manager.js';
import logger from '../utils/logger.js';
import { showStatus } from './ui-manager.js';
import { uiDataAdapter } from './ui-data-adapter.js';
// import { moveTab } from './tab-operations.js'; // Unused - keeping for reference
import { createTabElement as createUnifiedTabElement } from './unified-tab-renderer.js';
import { createCategorySection as createUnifiedCategorySection, createGroupSection as createUnifiedGroupSection } from './unified-group-renderer.js';
import { getCurrentTabs } from './tab-data-source.js';

/**
 * Display tabs based on current state and grouping
 */
export async function displayTabs(isFromSaved = false) {
  try {
    if (!isFromSaved) {
      const groupingType = state.popupState.groupingSelections.categorize || 'category';
      
      await showCurrentTabsContent(groupingType);
      
      // Update Close All button color
      const { updateCloseAllButtonColor } = await import('./ui-utilities.js');
      await updateCloseAllButtonColor();
      
      // Update categorize button state based on current tabs
      const { updateCategorizeButtonState } = await import('./unified-toolbar.js');
      await updateCategorizeButtonState();
      
      // Also update the legacy button text with count
      const { updateLegacyCategorizeButtonState } = await import('./ui-manager.js');
      await updateLegacyCategorizeButtonState();
    }
  } catch (error) {
    console.error('Error displaying tabs:', error);
    showStatus('Error displaying tabs', 'error');
  }
}

/**
 * Show current tabs content - unified approach like saved tabs
 */
export async function showCurrentTabsContent(groupingType) {
  try {
    logger.uiRendering('📍 showCurrentTabsContent called with groupingType:', groupingType);
    
    // Make sure the tabs container exists and is ready
    const tabsContainer = $id(DOM_IDS.TABS_CONTAINER);
    if (!tabsContainer) {
      return;
    }
    
    // Ensure the main tabs container is visible
    show(tabsContainer);
    
    // Get the current content container
    const currentContent = $id(DOM_IDS.CURRENT_CONTENT);
    if (!currentContent) {
      return;
    }
    
    // Don't bypass data manager for custom groupings - let it handle everything
    
    // Use DataManager for clean data processing
    if (!window.dataManager || !window.dataManager.isReady()) {
      console.error('❌ DataManager not available, falling back to legacy');
      throw new Error('DataManager not ready! Check initialization in app-initializer.js');
    }
    
    // Get search query from state
    const searchQuery = state.popupState?.searchQuery || '';
    
    // Get categories to include based on current tab filter state
    let categories = [];
    if (state.popupState && state.popupState.categoryFilters && state.popupState.categoryFilters.current) {
      const currentFilters = state.popupState.categoryFilters.current;
      if (currentFilters.uncategorized) categories.push(0); // Uncategorized
      if (currentFilters.ignore) categories.push(1);     // Ignore
      if (currentFilters.useful) categories.push(2);     // Useful
      if (currentFilters.important) categories.push(3);  // Important
    } else {
      // Default: show all categories if state is not ready
      categories = [0, 1, 2, 3]; // Show all by default
    }
    
    // Process data using clean architecture
    const processedData = await window.dataManager.getCurrentTabsData({
      searchQuery: searchQuery,
      categories: categories,
      groupBy: groupingType,
      sortBy: 'category', // Default sort
      // Don't override the default limits set in data-manager.js
      // The DataManager already sets maxGroups: 10 by default
    });
    
    
    // Adapt for UI rendering
    const uiData = uiDataAdapter.adaptForUI(processedData, {
      showCounters: true,
      formatDates: true,
      formatDomains: true
    });
    
    // Build new HTML content
    let newHTML = '';
    
    if (uiData.sections.length === 0) {
      // Check if this is due to search filtering or genuinely no tabs
      const searchQuery = state.popupState?.searchQuery || '';
      const hasActiveSearch = searchQuery.trim().length > 0;
      
      if (hasActiveSearch) {
        // Don't show empty state during search filtering - user can see search is active
        newHTML = ''; 
      } else {
        // Empty state HTML - match saved tabs styling
        newHTML = `
          <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; display: block; opacity: 0.5;">
              <rect x="3" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            </svg>
            <h3 style="margin: 0 0 8px 0; font-weight: 500;">No tabs to display</h3>
            <p style="margin: 0; font-size: 14px;">Open some browser tabs to get started</p>
          </div>
        `;
      }
    } else {
      // Check if we need to transform data for custom groupings
      const customGroupings = ['opened', 'lastActive', 'timeOpen'];
      if (customGroupings.includes(groupingType)) {
        // Transform the category-based sections into custom grouped sections
        const transformedData = await transformDataForCustomGrouping(uiData, groupingType, false);
        newHTML = await renderSectionsToHTML(transformedData.sections, groupingType, false, transformedData);
      } else {
        // Build sections HTML using centralized rendering logic
        newHTML = await renderSectionsToHTML(uiData.sections, groupingType, false, uiData);
      }
    }
    
    // Check if this is a grouping change that requires full replacement
    const isGroupingChange = currentContent.dataset.lastGrouping && 
                            currentContent.dataset.lastGrouping !== groupingType;
    
    // Check if this is a search state change that requires full replacement
    const currentSearchQuery = state.popupState?.searchQuery || '';
    const lastSearchState = currentContent.dataset.lastSearchState || '';
    const hasActiveSearch = currentSearchQuery.trim().length > 0;
    const hadActiveSearch = lastSearchState === 'active';
    const isSearchStateChange = hasActiveSearch !== hadActiveSearch;
    
    // Also check if we're transitioning between empty and non-empty content during active search
    const hasContent = uiData.sections.length > 0;
    const lastHadContent = currentContent.dataset.lastHadContent === 'true';
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
      const scrollTop = currentContent.scrollTop;
      
      // Full replacement for grouping changes, search state changes, or fallback
      currentContent.innerHTML = newHTML;
      
      
      // Restore scroll position after replacement
      requestAnimationFrame(() => {
        currentContent.scrollTop = scrollTop;
      });
      
      // Collapse states are now applied during rendering in unified-group-renderer.js
    }
    
    // Store the current grouping type, search state, and content state for next comparison
    currentContent.dataset.lastGrouping = groupingType;
    currentContent.dataset.lastSearchState = hasActiveSearch ? 'active' : 'inactive';
    currentContent.dataset.lastHadContent = hasContent ? 'true' : 'false';
    
    // Preload favicons for better performance
    const allTabs = uiData.sections.flatMap(section => section.items);
    if (allTabs.length > 0) {
      preloadFavicons(allTabs);
    }
    
    
  } catch (error) {
    console.error('Error in showCurrentTabsContent:', error);
    showStatus('Error displaying current tabs', 'error');
  }
}



/**
 * Display tabs in grouped view
 * @param {string} groupingType - Type of grouping
 * @param {boolean} isFromSaved - Whether displaying saved tabs
 * @param {Object} tabsToDisplay - Optional tabs to display
 */
export async function displayGroupedView(groupingType, isFromSaved = false, tabsToDisplay = null) {
  
  // Don't manipulate isViewingSaved here - it's managed by ui-manager
  
  // Fetch current tabs if not provided
  let tabs = tabsToDisplay;
  if (!tabs && !isFromSaved) {
    const { categorizedTabs } = await getCurrentTabs();
    tabs = categorizedTabs;
  } else if (!tabs) {
    tabs = {};
  }
  
  // Always create a new grouped view element for consistency
  const groupedView = createElement('div', {
    className: 'grouping-view',
    id: isFromSaved ? 'savedGroupedView' : 'currentGroupedView'
  });
  
  // Flatten all tabs from all categories
  const allTabs = [];
  [TAB_CATEGORIES.UNCATEGORIZED, TAB_CATEGORIES.CAN_CLOSE, TAB_CATEGORIES.SAVE_LATER, TAB_CATEGORIES.IMPORTANT].forEach(category => {
    if (tabs[category]) {
      tabs[category].forEach(tab => {
        allTabs.push({ ...tab, category });
      });
    }
  });
  
  // Group tabs based on grouping type
  logger.uiRendering('🔄 displayGroupedView - calling groupTabsBy with:', {
    groupingType: groupingType,
    allTabsCount: allTabs.length,
    isFromSaved: isFromSaved
  });
  let groups = groupTabsBy(allTabs, groupingType);
  logger.uiRendering('🔄 displayGroupedView - groups result:', {
    groupCount: Object.keys(groups).length,
    groupNames: Object.keys(groups),
    groupSizes: Object.entries(groups).map(([name, tabs]) => ({ name, count: tabs.length }))
  });
  
  // Sort groups and create sections
  let sortedGroups = Object.entries(groups);
  
  console.log('🔍 DEBUG_SORT: Grouping type:', groupingType, 'Groups:', sortedGroups.map(g => g[0]));
  
  // Time-based groupings that need chronological sorting
  const timeBasedGroupings = ['opened', 'lastActive', 'originallyOpened', 'lastViewed', 'saved'];
  
  if (timeBasedGroupings.includes(groupingType)) {
    // For time-based groupings, we need to sort by actual time, not string
    sortedGroups.sort((a, b) => {
      // Get the first tab from each group to extract timestamp
      const tabA = a[1][0];
      const tabB = b[1][0];
      
      let timeA, timeB;
      
      switch (groupingType) {
        case 'opened':
          if (!tabA.firstOpened || !tabB.firstOpened) {
            // Put tabs with unknown time at the end
            if (!tabA.firstOpened && !tabB.firstOpened) return 0;
            if (!tabA.firstOpened) return 1;
            if (!tabB.firstOpened) return -1;
          }
          timeA = new Date(tabA.firstOpened).getTime();
          timeB = new Date(tabB.firstOpened).getTime();
          break;
        case 'lastActive':
          if (!tabA.lastAccessed || !tabB.lastAccessed) {
            // Put tabs with unknown time at the end
            if (!tabA.lastAccessed && !tabB.lastAccessed) return 0;
            if (!tabA.lastAccessed) return 1;
            if (!tabB.lastAccessed) return -1;
          }
          timeA = tabA.lastAccessed;
          timeB = tabB.lastAccessed;
          break;
        case 'originallyOpened':
          if (!tabA.firstOpened || !tabB.firstOpened) {
            // Put tabs with unknown time at the end
            if (!tabA.firstOpened && !tabB.firstOpened) return 0;
            if (!tabA.firstOpened) return 1;
            if (!tabB.firstOpened) return -1;
          }
          timeA = new Date(tabA.firstOpened).getTime();
          timeB = new Date(tabB.firstOpened).getTime();
          break;
        case 'lastViewed':
          if (!tabA.lastAccessed || !tabB.lastAccessed) {
            // Put tabs with unknown time at the end
            if (!tabA.lastAccessed && !tabB.lastAccessed) return 0;
            if (!tabA.lastAccessed) return 1;
            if (!tabB.lastAccessed) return -1;
          }
          timeA = new Date(tabA.lastAccessed).getTime();
          timeB = new Date(tabB.lastAccessed).getTime();
          break;
        case 'saved':
          if (!tabA.savedDate || !tabB.savedDate) {
            // Put tabs with unknown time at the end
            if (!tabA.savedDate && !tabB.savedDate) return 0;
            if (!tabA.savedDate) return 1;
            if (!tabB.savedDate) return -1;
          }
          timeA = new Date(tabA.savedDate).getTime();
          timeB = new Date(tabB.savedDate).getTime();
          break;
        default:
          timeA = 0;
          timeB = 0;
      }
      
      return timeB - timeA; // Newest first (descending)
    });
  } else if (groupingType === 'timeOpen') {
    // For timeOpen, extract duration from group names and sort by duration
    console.log('🔍 DEBUG_SORT: Before sorting:', sortedGroups.map(g => g[0]));
    sortedGroups.sort((a, b) => {
      const nameA = a[0];
      const nameB = b[0];
      
      // Handle special cases
      if (nameA === 'Unknown Open Time') return 1;
      if (nameB === 'Unknown Open Time') return -1;
      
      // Extract minutes from patterns like "Open 0-5 minutes", "Open 10-15 minutes"
      const getMinutes = (name) => {
        // Match minute ranges like "Open 0-5 minutes", "Open 55-60 minutes"
        const minuteMatch = name.match(/Open (\d+)-(\d+) minutes/);
        if (minuteMatch) {
          const startMinutes = parseInt(minuteMatch[1]);
          console.log('🔍 DEBUG_SORT: Minute range match:', name, '→', startMinutes, 'minutes');
          return startMinutes;
        }
        
        // Handle hours pattern "Open X+ hours"
        const hoursMatch = name.match(/Open (\d+)\+ hours/);
        if (hoursMatch) {
          const hours = parseInt(hoursMatch[1]);
          const minutes = hours * 60;
          console.log('🔍 DEBUG_SORT: Hours match:', name, '→', minutes, 'minutes');
          return minutes;
        }
        
        // Handle day patterns
        if (name === 'Opened Today') return 0;
        const daysMatch = name.match(/Opened (\d+) days? ago/);
        if (daysMatch) return parseInt(daysMatch[1]) * 24 * 60;
        const weeksMatch = name.match(/Opened (\d+) weeks? ago/);
        if (weeksMatch) return parseInt(weeksMatch[1]) * 7 * 24 * 60;
        
        // Handle month patterns
        if (name === 'Opened This Month') return 0;
        if (name === 'Opened 1-3 Months Ago') return 30 * 24 * 60;
        if (name === 'Opened 3-6 Months Ago') return 90 * 24 * 60;
        if (name === 'Opened 6-12 Months Ago') return 180 * 24 * 60;
        if (name === 'Opened Over 1 Year Ago') return 365 * 24 * 60;
        
        return 999999; // Unknown pattern
      };
      
      const minutesA = getMinutes(nameA);
      const minutesB = getMinutes(nameB);
      
      console.log('🔍 DEBUG_SORT: Comparing:', nameA, '(', minutesA, ') vs', nameB, '(', minutesB, ')');
      
      return minutesA - minutesB; // Sort by duration ascending (shortest first)
    });
    console.log('🔍 DEBUG_SORT: After sorting:', sortedGroups.map(g => g[0]));
  } else if (groupingType === 'totalAge' || groupingType === 'timeSinceViewed') {
    // For other duration-based groupings, sort by actual duration
    sortedGroups.sort((a, b) => {
      // Get the first tab from each group to determine duration
      const tabA = a[1][0];
      const tabB = b[1][0];
      const now = Date.now();
      
      let durationA, durationB;
      
      switch (groupingType) {
        case 'timeOpen':
          // Time since opened
          if (!tabA.firstOpened || !tabB.firstOpened) {
            // Put tabs with unknown time at the end
            if (!tabA.firstOpened && !tabB.firstOpened) return 0;
            if (!tabA.firstOpened) return 1;
            if (!tabB.firstOpened) return -1;
          }
          const openedA = new Date(tabA.firstOpened).getTime();
          const openedB = new Date(tabB.firstOpened).getTime();
          durationA = now - openedA;
          durationB = now - openedB;
          break;
          
        case 'totalAge':
          // Time since first opened
          if (!tabA.firstOpened || !tabB.firstOpened) {
            // Put tabs with unknown age at the end
            if (!tabA.firstOpened && !tabB.firstOpened) return 0;
            if (!tabA.firstOpened) return 1;
            if (!tabB.firstOpened) return -1;
          }
          const firstA = new Date(tabA.firstOpened).getTime();
          const firstB = new Date(tabB.firstOpened).getTime();
          durationA = now - firstA;
          durationB = now - firstB;
          break;
          
        case 'timeSinceViewed':
          // Time since last viewed
          if (!tabA.lastAccessed || !tabB.lastAccessed) {
            // Put tabs never viewed at the end
            if (!tabA.lastAccessed && !tabB.lastAccessed) return 0;
            if (!tabA.lastAccessed) return 1;
            if (!tabB.lastAccessed) return -1;
          }
          const viewedA = new Date(tabA.lastAccessed).getTime();
          const viewedB = new Date(tabB.lastAccessed).getTime();
          durationA = now - viewedA;
          durationB = now - viewedB;
          break;
          
        default:
          durationA = 0;
          durationB = 0;
      }
      
      // Sort by duration ascending (shortest durations first)
      return durationA - durationB;
    });
  } else if (groupingType.includes('Date') || groupingType.includes('Week') || groupingType.includes('Month') || groupingType === 'closeTime') {
    // Legacy date-based groupings
    sortedGroups.sort((a, b) => {
      // For close time, extract date from "Closed MM/DD/YYYY, HH:MM:SS AM/PM" format
      if (groupingType === 'closeTime') {
        const extractCloseDate = (groupName) => {
          if (groupName === 'Never Closed') return new Date(0); // Sort to end
          const match = groupName.match(/Closed (.+)/);
          return match ? new Date(match[1]) : new Date(0);
        };
        const dateA = extractCloseDate(a[0]);
        const dateB = extractCloseDate(b[0]);
        return dateB - dateA; // Newest first
      } else {
        const dateA = extractDateFromGroupName(a[0]);
        const dateB = extractDateFromGroupName(b[0]);
        return dateB - dateA; // Newest first
      }
    });
  } else {
    // Use the sortGroups helper for other grouping types
    sortedGroups = sortGroups(sortedGroups, groupingType);
  }
  
  for (const [groupName, groupTabs] of sortedGroups) {
    if (groupTabs.length > 0) {
      const section = await createUnifiedGroupSection(groupName, groupTabs, groupingType, isFromSaved);
      groupedView.appendChild(section);
    }
  }
  
  // Replace content in the appropriate container
  if (!isFromSaved) {
    const currentContent = $id(DOM_IDS.CURRENT_CONTENT);
    if (currentContent) {
      // Store current state data
      currentContent.dataset.lastGrouping = groupingType;
      const searchQuery = state.popupState?.searchQuery || '';
      const hasActiveSearch = searchQuery.trim().length > 0;
      currentContent.dataset.lastSearchState = hasActiveSearch ? 'active' : 'inactive';
      currentContent.dataset.lastHadContent = allTabs.length > 0 ? 'true' : 'false';
      
      // Clear and append new content
      currentContent.innerHTML = '';
      currentContent.appendChild(groupedView);
    }
  } else {
    const savedContent = $id(DOM_IDS.SAVED_CONTENT);
    if (savedContent) {
      // Store current state data
      savedContent.dataset.lastGrouping = groupingType;
      const searchQuery = state.popupState?.searchQuery || '';
      const hasActiveSearch = searchQuery.trim().length > 0;
      savedContent.dataset.lastSearchState = hasActiveSearch ? 'active' : 'inactive';
      savedContent.dataset.lastHadContent = allTabs.length > 0 ? 'true' : 'false';
      
      // Clear and append new content
      savedContent.innerHTML = '';
      savedContent.appendChild(groupedView);
    }
  }
  
  // Always return the grouped view element
  return groupedView;
}


/**
 * Create a tab element using the unified renderer
 * @param {Object} tab - Tab object
 * @param {number} category - Tab category
 * @param {boolean} isFromSaved - Whether this is a saved tab
 * @returns {Promise<HTMLElement>}
 */
export async function createTabElement(tab, category, isFromSaved = false) {
  
  return await createUnifiedTabElement(tab, category, isFromSaved);
}

// Grouping functions
function groupByDomain(tabs) {
  const groups = {};
  
  tabs.forEach(tab => {
    const domain = tab.domain || 'unknown';
    if (!groups[domain]) {
      groups[domain] = [];
    }
    groups[domain].push(tab);
  });
  
  return groups;
}

function groupBySavedDate(tabs) {
  const groups = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  tabs.forEach(tab => {
    const savedDate = new Date(tab.savedAt || tab.lastAccessed || Date.now());
    const dateOnly = new Date(savedDate.getFullYear(), savedDate.getMonth(), savedDate.getDate());
    
    let groupName;
    if (dateOnly.getTime() === today.getTime()) {
      groupName = 'Today';
    } else if (dateOnly.getTime() === yesterday.getTime()) {
      groupName = 'Yesterday';
    } else {
      const daysAgo = Math.floor((today - dateOnly) / (1000 * 60 * 60 * 24));
      if (daysAgo <= 7) {
        groupName = `${daysAgo} days ago`;
      } else {
        groupName = `Saved ${formatDate(savedDate.getTime())}`;
      }
    }
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(tab);
  });
  
  return groups;
}

function groupBySavedWeek(tabs) {
  const groups = {};
  
  tabs.forEach(tab => {
    const savedDate = new Date(tab.savedAt || tab.lastAccessed || Date.now());
    const weekStart = getWeekStartDate(savedDate);
    
    // Format: "Week of Mon DD"
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const groupName = `Week of ${monthNames[weekStart.getMonth()]} ${weekStart.getDate()}`;
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(tab);
  });
  
  return groups;
}

function groupBySavedMonth(tabs) {
  const groups = {};
  
  tabs.forEach(tab => {
    const savedDate = new Date(tab.savedAt || tab.lastAccessed || Date.now());
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const groupName = `${monthNames[savedDate.getMonth()]} ${savedDate.getFullYear()}`;
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(tab);
  });
  
  return groups;
}

function groupByLastAccessedDate(tabs) {
  // Same logic as saved date but using lastAccessed timestamp
  return groupBySavedDate(tabs.map(tab => ({
    ...tab,
    savedAt: tab.lastAccessed || tab.savedAt
  })));
}

function groupByLastAccessedWeek(tabs) {
  // Same logic as saved week but using lastAccessed timestamp
  return groupBySavedWeek(tabs.map(tab => ({
    ...tab,
    savedAt: tab.lastAccessed || tab.savedAt
  })));
}

function groupByLastAccessedMonth(tabs) {
  // Same logic as saved month but using lastAccessed timestamp
  return groupBySavedMonth(tabs.map(tab => ({
    ...tab,
    savedAt: tab.lastAccessed || tab.savedAt
  })));
}

function groupByCloseTime(tabs) {
  const groups = {};
  
  tabs.forEach(tab => {
    if (tab.closeEvents && tab.closeEvents.length > 0) {
      // Group by each close event
      tab.closeEvents.forEach(event => {
        if (event.closeTime) {
          const closeDate = new Date(event.closeTime);
          const groupName = `Closed ${closeDate.toLocaleString()}`;
          
          if (!groups[groupName]) {
            groups[groupName] = [];
          }
          
          // Create a copy of the tab for this close event
          const tabCopy = {
            ...tab,
            closeTime: event.closeTime,
            groupKey: groupName
          };
          
          groups[groupName].push(tabCopy);
        }
      });
    } else if (tab.lastCloseTime) {
      // Fallback to single close time if available
      const closeDate = new Date(tab.lastCloseTime);
      const groupName = `Closed ${closeDate.toLocaleString()}`;
      
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      
      groups[groupName].push({
        ...tab,
        closeTime: tab.lastCloseTime,
        groupKey: groupName
      });
    } else {
      // No close time available
      const groupName = 'Never Closed';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(tab);
    }
  });
  
  return groups;
}

/**
 * Get time granularity interval in milliseconds
 */
function getGranularityInterval(granularity) {
  switch (granularity) {
    case 'time': return 5 * 60 * 1000; // 5 minutes
    case 'day': return 24 * 60 * 60 * 1000; // 1 day
    case 'week': return 7 * 24 * 60 * 60 * 1000; // 1 week
    case 'month': return 30 * 24 * 60 * 60 * 1000; // 30 days
    default: return 24 * 60 * 60 * 1000; // Default to day
  }
}

/**
 * Create smart label for time range
 */
function createTimeRangeLabel(timestamp, granularity) {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  switch (granularity) {
    case 'time': {
      // Format: "Today: 9:05 AM" or "Jan 12, 2024 10:35 AM"
      const timeStr = date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      });
      
      if (date >= today) {
        return `Today: ${timeStr}`;
      } else if (date >= yesterday) {
        return `Yesterday: ${timeStr}`;
      } else {
        const dateStr = date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        });
        return `${dateStr} ${timeStr}`;
      }
    }
    
    case 'day': {
      // Format: "Today", "Yesterday", "Dec 26, 2024"
      if (date >= today) {
        return 'Today';
      } else if (date >= yesterday) {
        return 'Yesterday';
      } else {
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        });
      }
    }
    
    case 'week': {
      // Format: "This Week", "Last Week", "Dec 22-28, 2024"
      const weekStart = getWeekStartDate(date);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      
      const thisWeekStart = getWeekStartDate(now);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      
      if (weekStart.getTime() === thisWeekStart.getTime()) {
        return 'This Week';
      } else if (weekStart.getTime() === lastWeekStart.getTime()) {
        return 'Last Week';
      } else {
        const startStr = weekStart.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric' 
        });
        const endStr = weekEnd.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric' 
        });
        return `${startStr}-${endStr.split(',')[0]}, ${weekEnd.getFullYear()}`;
      }
    }
    
    case 'month': {
      // Format: "This Month", "Last Month", "December 2024"
      const thisMonth = new Date(now.getFullYear(), now.getMonth());
      const lastMonth = new Date(thisMonth);
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      
      if (date.getFullYear() === thisMonth.getFullYear() && 
          date.getMonth() === thisMonth.getMonth()) {
        return 'This Month';
      } else if (date.getFullYear() === lastMonth.getFullYear() && 
                 date.getMonth() === lastMonth.getMonth()) {
        return 'Last Month';
      } else {
        return date.toLocaleDateString('en-US', { 
          month: 'long', 
          year: 'numeric' 
        });
      }
    }
    
    default:
      return formatDate(timestamp);
  }
}

/**
 * Group tabs by time with granularity
 */
function groupByTimeWithGranularity(tabs, getTimestamp, granularity) {
  const groups = {};
  const interval = getGranularityInterval(granularity);
  
  console.log('🔍 DEBUG_GRANULARITY: groupByTimeWithGranularity', {
    granularity,
    interval,
    intervalInMinutes: interval / (60 * 1000),
    intervalInHours: interval / (60 * 60 * 1000)
  });
  
  tabs.forEach(tab => {
    const timestamp = getTimestamp(tab);
    if (!timestamp) {
      // Handle tabs without timestamp
      const groupName = 'Unknown Time';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(tab);
      return;
    }
    
    // Round down to the nearest interval
    const roundedTime = Math.floor(timestamp / interval) * interval;
    const groupName = createTimeRangeLabel(roundedTime, granularity);
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(tab);
  });
  
  // Deduplicate tabs within each time bucket
  Object.keys(groups).forEach(groupName => {
    const tabsInGroup = groups[groupName];
    const deduplicatedTabs = [];
    const urlToTab = new Map();
    
    tabsInGroup.forEach(tab => {
      if (urlToTab.has(tab.url)) {
        // URL already exists in this time bucket - add to duplicates
        const existingTab = urlToTab.get(tab.url);
        if (!existingTab.duplicateIds) {
          existingTab.duplicateIds = [existingTab.id];
        }
        existingTab.duplicateIds.push(tab.id);
        existingTab.duplicateCount = existingTab.duplicateIds.length;
        
        console.log('🔍 DEBUG_TEMPORAL: Deduplicating in time bucket', groupName, 'URL:', tab.url, 'count:', existingTab.duplicateCount);
      } else {
        // First occurrence of this URL in this time bucket
        urlToTab.set(tab.url, tab);
        deduplicatedTabs.push(tab);
      }
    });
    
    groups[groupName] = deduplicatedTabs;
  });
  
  return groups;
}

/**
 * Group current tabs by when they were opened
 */
function groupByOpened(tabs) {
  logger.dataGrouping('📊 groupByOpened called');
  const context = 'current';
  const granularity = state.popupState.granularity?.[context] || 'day';
  logger.dataGrouping('📊 groupByOpened - granularity:', granularity);
  
  // Expand tabs that have multiple instances with different open times
  const expandedTabs = [];
  tabs.forEach(tab => {
    if (tab.allTabOpenTimes && Object.keys(tab.allTabOpenTimes).length > 0) {
      // This tab represents multiple instances - expand them
      Object.entries(tab.allTabOpenTimes).forEach(([tabId, openTime]) => {
        expandedTabs.push({
          ...tab,
          id: parseInt(tabId),
          tabOpenTime: openTime,
          duplicateIds: undefined,
          duplicateCount: undefined,
          allTabOpenTimes: undefined
        });
      });
    } else {
      // Single tab instance
      expandedTabs.push(tab);
    }
  });
  
  const result = groupByTimeWithGranularity(expandedTabs, tab => {
    // Use individual tab open time if available, fallback to firstOpened
    const timestamp = tab.tabOpenTime ? new Date(tab.tabOpenTime).getTime() : 
                     tab.firstOpened ? new Date(tab.firstOpened).getTime() : null;
    if (logger.isEnabled('data.grouping')) {
      logger.dataGrouping('📊 Tab open time:', tab.url, 'tabId:', tab.id, 'tabOpenTime:', tab.tabOpenTime, '→', timestamp);
    }
    return timestamp;
  }, granularity);
  
  logger.dataGrouping('📊 groupByOpened result:', Object.keys(result));
  return result;
}

/**
 * Group current tabs by last active time
 */
function groupByLastActive(tabs) {
  const context = 'current';
  const granularity = state.popupState.granularity?.[context] || 'day';
  return groupByTimeWithGranularity(tabs, tab => {
    return tab.lastAccessed || null;
  }, granularity);
}

/**
 * Group current tabs by how long they've been open
 */
function groupByTimeOpen(tabs) {
  const now = Date.now();
  const context = 'current';
  const granularity = state.popupState.granularity?.[context] || 'day';
  const groups = {};
  
  // Expand tabs that have multiple instances with different open times
  const expandedTabs = [];
  tabs.forEach(tab => {
    if (tab.allTabOpenTimes && Object.keys(tab.allTabOpenTimes).length > 0) {
      // This tab represents multiple instances - expand them
      Object.entries(tab.allTabOpenTimes).forEach(([tabId, openTime]) => {
        expandedTabs.push({
          ...tab,
          id: parseInt(tabId),
          tabOpenTime: openTime,
          duplicateIds: undefined,
          duplicateCount: undefined,
          allTabOpenTimes: undefined
        });
      });
    } else {
      // Single tab instance
      expandedTabs.push(tab);
    }
  });
  
  expandedTabs.forEach(tab => {
    // Use individual tab open time if available, fallback to firstOpened
    const tabOpenTimestamp = tab.tabOpenTime || tab.firstOpened;
    
    if (!tabOpenTimestamp) {
      // Handle tabs without open timestamp
      const groupName = 'Unknown Open Time';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(tab);
      return;
    }
    
    const openedTime = new Date(tabOpenTimestamp).getTime();
    const timeOpen = now - openedTime;
    
    
    let groupName;
    
    // Apply granularity-based grouping for duration
    switch (granularity) {
      case 'time': // 5 minute intervals
        const totalMinutes = Math.floor(timeOpen / (60 * 1000)); // Total minutes
        const intervalMinutes = Math.floor(totalMinutes / 5) * 5; // Round down to 5-minute interval
        
        if (intervalMinutes < 60) {
          // For times less than 1 hour, show minute ranges
          const endMinutes = Math.min(intervalMinutes + 5, 60);
          groupName = `Open ${intervalMinutes}-${endMinutes} minutes`;
        } else {
          // For 1 hour or more, show hours
          const hours = Math.floor(intervalMinutes / 60);
          groupName = `Open ${hours}+ hours`;
        }
        break;
        
      case 'day':
        if (timeOpen < 5 * 60 * 1000) { // < 5 minutes
          groupName = 'Just Opened (< 5 min)';
        } else if (timeOpen < 30 * 60 * 1000) { // < 30 minutes
          groupName = 'Recently Opened (5-30 min)';
        } else if (timeOpen < 60 * 60 * 1000) { // < 1 hour
          groupName = 'Opened This Hour (30-60 min)';
        } else if (timeOpen < 3 * 60 * 60 * 1000) { // < 3 hours
          groupName = 'Opened 1-3 Hours Ago';
        } else if (timeOpen < 24 * 60 * 60 * 1000) { // < 1 day
          groupName = 'Opened Today (3+ hours)';
        } else if (timeOpen < 7 * 24 * 60 * 60 * 1000) { // < 1 week
          groupName = 'Opened This Week';
        } else {
          groupName = 'Opened Long Ago (1+ week)';
        }
        break;
        
      case 'week':
        const days = Math.floor(timeOpen / (24 * 60 * 60 * 1000));
        if (days === 0) {
          groupName = 'Opened Today';
        } else if (days < 7) {
          groupName = `Opened ${days} day${days === 1 ? '' : 's'} ago`;
        } else {
          const weeks = Math.floor(days / 7);
          groupName = `Opened ${weeks} week${weeks === 1 ? '' : 's'} ago`;
        }
        break;
        
      case 'month':
        const daysForMonth = Math.floor(timeOpen / (24 * 60 * 60 * 1000));
        if (daysForMonth < 30) {
          groupName = 'Opened This Month';
        } else if (daysForMonth < 90) {
          groupName = 'Opened 1-3 Months Ago';
        } else if (daysForMonth < 180) {
          groupName = 'Opened 3-6 Months Ago';
        } else if (daysForMonth < 365) {
          groupName = 'Opened 6-12 Months Ago';
        } else {
          groupName = 'Opened Over 1 Year Ago';
        }
        break;
        
      default:
        groupName = 'Unknown Duration';
    }
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(tab);
  });
  
  // Deduplicate tabs within each duration bucket
  Object.keys(groups).forEach(groupName => {
    const tabsInGroup = groups[groupName];
    const deduplicatedTabs = [];
    const urlToTab = new Map();
    
    tabsInGroup.forEach(tab => {
      if (urlToTab.has(tab.url)) {
        // URL already exists in this duration bucket - add to duplicates
        const existingTab = urlToTab.get(tab.url);
        if (!existingTab.duplicateIds) {
          existingTab.duplicateIds = [existingTab.id];
        }
        existingTab.duplicateIds.push(tab.id);
        existingTab.duplicateCount = existingTab.duplicateIds.length;
        
        console.log('🔍 DEBUG_TEMPORAL: Deduplicating in duration bucket', groupName, 'URL:', tab.url, 'count:', existingTab.duplicateCount);
      } else {
        // First occurrence of this URL in this duration bucket
        urlToTab.set(tab.url, tab);
        deduplicatedTabs.push(tab);
      }
    });
    
    groups[groupName] = deduplicatedTabs;
  });
  
  return groups;
}

/**
 * Group saved tabs by originally opened time
 */
function groupByOriginallyOpened(tabs) {
  const context = 'saved';
  const granularity = state.popupState.granularity?.[context] || 'day';
  return groupByTimeWithGranularity(tabs, tab => {
    return tab.firstOpened ? new Date(tab.firstOpened).getTime() : null;
  }, granularity);
}

/**
 * Group saved tabs by last viewed time
 */
function groupByLastViewed(tabs) {
  const context = 'saved';
  const granularity = state.popupState.granularity?.[context] || 'day';
  return groupByTimeWithGranularity(tabs, tab => {
    return tab.lastAccessed ? new Date(tab.lastAccessed).getTime() : null;
  }, granularity);
}

/**
 * Group saved tabs by saved time
 */
function groupBySaved(tabs) {
  const context = 'saved';
  const granularity = state.popupState.granularity?.[context] || 'day';
  return groupByTimeWithGranularity(tabs, tab => {
    return tab.savedDate ? new Date(tab.savedDate).getTime() : null;
  }, granularity);
}

/**
 * Group saved tabs by total age (time since first opened)
 */
function groupByTotalAge(tabs) {
  const now = Date.now();
  const context = 'saved';
  const granularity = state.popupState.granularity?.[context] || 'day';
  const groups = {};
  
  tabs.forEach(tab => {
    if (!tab.firstOpened) {
      // Handle tabs without firstOpened timestamp
      const groupName = 'Unknown Age';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(tab);
      return;
    }
    
    const firstOpened = new Date(tab.firstOpened).getTime();
    const age = now - firstOpened;
    
    let groupName;
    
    // Apply granularity-based grouping for duration
    switch (granularity) {
      case 'time': // 5 minute intervals for recent items
        const minutes = Math.floor(age / (5 * 60 * 1000)) * 5;
        if (minutes < 60) {
          groupName = `${minutes}-${minutes + 5} minutes old`;
        } else if (minutes < 24 * 60) {
          const hours = Math.floor(minutes / 60);
          groupName = `${hours} hour${hours === 1 ? '' : 's'} old`;
        } else {
          const days = Math.floor(age / (24 * 60 * 60 * 1000));
          groupName = `${days} day${days === 1 ? '' : 's'} old`;
        }
        break;
        
      case 'day':
        if (age < 24 * 60 * 60 * 1000) { // < 1 day
          groupName = 'Opened Today';
        } else if (age < 7 * 24 * 60 * 60 * 1000) { // < 1 week
          groupName = 'Less Than 1 Week Old';
        } else if (age < 30 * 24 * 60 * 60 * 1000) { // < 1 month
          groupName = '1 Week - 1 Month Old';
        } else if (age < 90 * 24 * 60 * 60 * 1000) { // < 3 months
          groupName = '1-3 Months Old';
        } else if (age < 180 * 24 * 60 * 60 * 1000) { // < 6 months
          groupName = '3-6 Months Old';
        } else if (age < 365 * 24 * 60 * 60 * 1000) { // < 1 year
          groupName = '6-12 Months Old';
        } else {
          groupName = 'Over 1 Year Old';
        }
        break;
        
      case 'week':
        const days = Math.floor(age / (24 * 60 * 60 * 1000));
        if (days === 0) {
          groupName = 'Opened Today';
        } else if (days < 7) {
          groupName = `${days} day${days === 1 ? '' : 's'} old`;
        } else if (days < 14) {
          groupName = '1 week old';
        } else if (days < 30) {
          const weeks = Math.floor(days / 7);
          groupName = `${weeks} week${weeks === 1 ? '' : 's'} old`;
        } else if (days < 365) {
          const months = Math.floor(days / 30);
          groupName = `${months} month${months === 1 ? '' : 's'} old`;
        } else {
          const years = Math.floor(days / 365);
          groupName = `${years} year${years === 1 ? '' : 's'} old`;
        }
        break;
        
      case 'month':
        const daysForMonth = Math.floor(age / (24 * 60 * 60 * 1000));
        if (daysForMonth < 30) {
          groupName = 'Less Than 1 Month Old';
        } else if (daysForMonth < 90) {
          groupName = '1-3 Months Old';
        } else if (daysForMonth < 180) {
          groupName = '3-6 Months Old';
        } else if (daysForMonth < 365) {
          groupName = '6-12 Months Old';
        } else {
          const years = Math.floor(daysForMonth / 365);
          groupName = `${years}+ Year${years === 1 ? '' : 's'} Old`;
        }
        break;
        
      default:
        groupName = 'Unknown Age';
    }
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(tab);
  });
  
  return groups;
}

/**
 * Group saved tabs by time since last viewed
 */
function groupByTimeSinceViewed(tabs) {
  const now = Date.now();
  const context = 'saved';
  const granularity = state.popupState.granularity?.[context] || 'day';
  const groups = {};
  
  tabs.forEach(tab => {
    if (!tab.lastAccessed) {
      // Handle tabs without lastAccessed timestamp
      const groupName = 'Never Viewed';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(tab);
      return;
    }
    
    const lastViewed = new Date(tab.lastAccessed).getTime();
    const timeSince = now - lastViewed;
    
    let groupName;
    
    // Apply granularity-based grouping for duration
    switch (granularity) {
      case 'time': // 5 minute intervals for recent items
        const minutes = Math.floor(timeSince / (5 * 60 * 1000)) * 5;
        if (minutes < 60) {
          groupName = `Viewed ${minutes}-${minutes + 5} minutes ago`;
        } else if (minutes < 24 * 60) {
          const hours = Math.floor(minutes / 60);
          groupName = `Viewed ${hours} hour${hours === 1 ? '' : 's'} ago`;
        } else {
          const days = Math.floor(timeSince / (24 * 60 * 60 * 1000));
          groupName = `Viewed ${days} day${days === 1 ? '' : 's'} ago`;
        }
        break;
        
      case 'day':
        if (timeSince < 24 * 60 * 60 * 1000) { // < 1 day
          groupName = 'Viewed Today';
        } else if (timeSince < 7 * 24 * 60 * 60 * 1000) { // < 1 week
          groupName = 'Viewed This Week';
        } else if (timeSince < 30 * 24 * 60 * 60 * 1000) { // < 1 month
          groupName = 'Viewed This Month';
        } else if (timeSince < 90 * 24 * 60 * 60 * 1000) { // < 3 months
          groupName = 'Viewed 1-3 Months Ago';
        } else if (timeSince < 180 * 24 * 60 * 60 * 1000) { // < 6 months
          groupName = 'Viewed 3-6 Months Ago';
        } else {
          groupName = 'Not Viewed in 6+ Months';
        }
        break;
        
      case 'week':
        const days = Math.floor(timeSince / (24 * 60 * 60 * 1000));
        if (days === 0) {
          groupName = 'Viewed Today';
        } else if (days < 7) {
          groupName = `Viewed ${days} day${days === 1 ? '' : 's'} ago`;
        } else if (days < 14) {
          groupName = 'Viewed 1 week ago';
        } else if (days < 30) {
          const weeks = Math.floor(days / 7);
          groupName = `Viewed ${weeks} week${weeks === 1 ? '' : 's'} ago`;
        } else if (days < 365) {
          const months = Math.floor(days / 30);
          groupName = `Viewed ${months} month${months === 1 ? '' : 's'} ago`;
        } else {
          const years = Math.floor(days / 365);
          groupName = `Not viewed in ${years} year${years === 1 ? '' : 's'}`;
        }
        break;
        
      case 'month':
        const daysForMonth = Math.floor(timeSince / (24 * 60 * 60 * 1000));
        if (daysForMonth < 30) {
          groupName = 'Viewed This Month';
        } else if (daysForMonth < 90) {
          groupName = 'Viewed 1-3 Months Ago';
        } else if (daysForMonth < 180) {
          groupName = 'Viewed 3-6 Months Ago';
        } else if (daysForMonth < 365) {
          groupName = 'Viewed 6-12 Months Ago';
        } else {
          const years = Math.floor(daysForMonth / 365);
          groupName = `Not viewed in ${years}+ year${years === 1 ? '' : 's'}`;
        }
        break;
        
      default:
        groupName = 'Unknown Last View';
    }
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(tab);
  });
  
  return groups;
}

/**
 * Group tabs by prediction confidence
 */
function groupByPredictionConfidence(tabs) {
  const groups = {};
  
  tabs.forEach(tab => {
    let groupName;
    
    // Check if tab has ML metadata with confidence
    if (!tab.mlMetadata || tab.mlMetadata.confidence === undefined) {
      groupName = 'No ML Prediction';
    } else {
      // Use corrected flag to override confidence
      const confidence = tab.mlMetadata.corrected ? 1.0 : tab.mlMetadata.confidence;
      const confidencePercent = Math.round(confidence * 100);
      
      // Group by 10% confidence ranges
      if (confidencePercent === 100) {
        groupName = '100% Confidence';
      } else if (confidencePercent >= 90) {
        groupName = '90-99% Confidence';
      } else if (confidencePercent >= 80) {
        groupName = '80-89% Confidence';
      } else if (confidencePercent >= 70) {
        groupName = '70-79% Confidence';
      } else if (confidencePercent >= 60) {
        groupName = '60-69% Confidence';
      } else if (confidencePercent >= 50) {
        groupName = '50-59% Confidence';
      } else if (confidencePercent >= 40) {
        groupName = '40-49% Confidence';
      } else if (confidencePercent >= 30) {
        groupName = '30-39% Confidence';
      } else if (confidencePercent >= 20) {
        groupName = '20-29% Confidence';
      } else if (confidencePercent >= 10) {
        groupName = '10-19% Confidence';
      } else if (confidencePercent > 0) {
        groupName = '1-9% Confidence';
      } else {
        groupName = '0% Confidence';
      }
    }
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(tab);
  });
  
  return groups;
}

/**
 * Group tabs by prediction agreement
 */
function groupByPredictionAgreement(tabs) {
  const groups = {};
  
  tabs.forEach(tab => {
    let groupName;
    
    // Check if tab has ML metadata
    if (!tab.mlMetadata || !tab.mlMetadata.predictions) {
      groupName = 'No ML Prediction';
    } else {
      const predictions = tab.mlMetadata.predictions || {};
      const actualCategory = tab.category;
      const corrected = tab.mlMetadata.corrected;
      const finalCategory = tab.mlMetadata.final; // The category chosen by voting (before correction)
      
      // Determine which methods were correct
      const methodResults = [];
      Object.entries(predictions).forEach(([method, predicted]) => {
        if (predicted !== null && predicted !== undefined) {
          // Check if prediction matches the actual category
          // This works whether corrected or not - we compare against final category
          const isCorrect = predicted === actualCategory;
          methodResults.push({ method, predicted, isCorrect });
        }
      });
      
      if (methodResults.length === 0) {
        groupName = 'No ML Prediction';
      } else {
        // Build a pattern key showing which methods are correct/incorrect/missing
        const methods = ['llm', 'model', 'rules']; // Fixed order
        const pattern = methods.map(method => {
          const result = methodResults.find(r => r.method === method);
          if (!result) return '-'; // Method not used
          return result.isCorrect ? 'C' : 'W'; // Correct or Wrong
        }).join('');
        
        // Use pattern as grouping key (e.g., "CWC", "WWW", "C-W")
        groupName = pattern;
      }
    }
    
    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push(tab);
  });
  
  return groups;
}

/**
 * Group tabs by the specified type
 * @param {Array} tabs - Array of tabs to group
 * @param {string} groupingType - Type of grouping
 * @returns {Object} Grouped tabs
 */
export function groupTabsBy(tabs, groupingType) {
  logger.dataGrouping('🔍 groupTabsBy called with:', {
    groupingType: groupingType,
    tabsCount: tabs.length,
    sampleTab: tabs[0] || 'no tabs',
    availableFields: tabs[0] ? Object.keys(tabs[0]) : []
  });
  
  switch (groupingType) {
    case 'category':
    case GROUPING_OPTIONS.CATEGORY:
      // Return tabs as-is for category grouping (handled elsewhere)
      return { 'All Tabs': tabs };
    case 'domain':
    case GROUPING_OPTIONS.DOMAIN:
      return groupByDomain(tabs);
    // Current tabs time-based groupings
    case 'opened':
    case GROUPING_OPTIONS.OPENED:
      return groupByOpened(tabs);
    case 'lastActive':
    case GROUPING_OPTIONS.LAST_ACTIVE:
      return groupByLastActive(tabs);
    case 'timeOpen':
    case GROUPING_OPTIONS.TIME_OPEN:
      return groupByTimeOpen(tabs);
    // Saved tabs time-based groupings
    case 'originallyOpened':
    case GROUPING_OPTIONS.ORIGINALLY_OPENED:
      return groupByOriginallyOpened(tabs);
    case 'lastViewed':
    case GROUPING_OPTIONS.LAST_VIEWED:
      return groupByLastViewed(tabs);
    case 'saved':
    case GROUPING_OPTIONS.SAVED:
      return groupBySaved(tabs);
    case 'totalAge':
    case GROUPING_OPTIONS.TOTAL_AGE:
      return groupByTotalAge(tabs);
    case 'timeSinceViewed':
    case GROUPING_OPTIONS.TIME_SINCE_VIEWED:
      return groupByTimeSinceViewed(tabs);
    // ML-based groupings (to be implemented)
    case 'predictionConfidence':
    case GROUPING_OPTIONS.PREDICTION_CONFIDENCE:
      return groupByPredictionConfidence(tabs);
    case 'predictionAgreement':
    case GROUPING_OPTIONS.PREDICTION_AGREEMENT:
      return groupByPredictionAgreement(tabs);
    // Legacy options
    case 'savedDate':
    case GROUPING_OPTIONS.SAVED_DATE:
      return groupBySavedDate(tabs);
    case 'savedWeek':
    case GROUPING_OPTIONS.SAVED_WEEK:
      return groupBySavedWeek(tabs);
    case 'savedMonth':
    case GROUPING_OPTIONS.SAVED_MONTH:
      return groupBySavedMonth(tabs);
    case 'lastAccessedDate':
    case GROUPING_OPTIONS.LAST_ACCESSED_DATE:
      return groupByLastAccessedDate(tabs);
    case 'lastAccessedWeek':
    case GROUPING_OPTIONS.LAST_ACCESSED_WEEK:
      return groupByLastAccessedWeek(tabs);
    case 'lastAccessedMonth':
    case GROUPING_OPTIONS.LAST_ACCESSED_MONTH:
      return groupByLastAccessedMonth(tabs);
    case 'closeTime':
    case GROUPING_OPTIONS.CLOSE_TIME:
      return groupByCloseTime(tabs);
    default:
      return { 'All Tabs': tabs };
  }
}

// Note: extractDateFromGroupName is already imported from helpers.js at the top of the file

/**
 * Render tabs to a specific container (for background renderer)
 * @param {HTMLElement} container - Container to render tabs into
 * @param {Object} categorizedTabs - Categorized tabs data
 */
export async function renderTabsToContainer(container, categorizedTabs) {
  if (!container || !categorizedTabs) return;
  
  
  // Clear container
  container.innerHTML = '';
  
  // Save current state
  const originalCategorizedTabs = state.categorizedTabs;
  
  try {
    // Temporarily set state for rendering
    state.categorizedTabs = categorizedTabs;
    
    const groupingType = state.popupState.groupingSelections.categorize || 'category';
    
    if (groupingType === 'category') {
      await renderCategoryViewToContainer(container);
    } else {
      await renderGroupedViewToContainer(container, groupingType);
    }
    
  } finally {
    // Restore original state
    state.categorizedTabs = originalCategorizedTabs;
  }
}

/**
 * Render category view to a specific container
 * @param {HTMLElement} container - Container to render into
 */
async function renderCategoryViewToContainer(container) {
  const categorizedTabs = state.categorizedTabs;
  
  // Create category sections
  for (const category of [TAB_CATEGORIES.IMPORTANT, TAB_CATEGORIES.SAVE_LATER, TAB_CATEGORIES.CAN_CLOSE, TAB_CATEGORIES.UNCATEGORIZED]) {
    const tabs = categorizedTabs[category] || [];
    if (tabs.length > 0) {
      const categorySection = await createUnifiedCategorySection(category, tabs, false);
      if (categorySection) {
        container.appendChild(categorySection);
      }
    }
  }
}

/**
 * Render grouped view to a specific container
 * @param {HTMLElement} container - Container to render into
 * @param {string} groupingType - Type of grouping
 */
async function renderGroupedViewToContainer(container, groupingType) {
  const categorizedTabs = state.categorizedTabs;
  
  // Get all tabs
  const allTabs = Object.values(categorizedTabs).flat();
  
  if (allTabs.length === 0) {
    container.innerHTML = '<div class="no-tabs">No tabs to display</div>';
    return;
  }
  
  // Group tabs by the specified type
  const groups = groupTabsBy(allTabs, groupingType);
  
  // Create sections for each group
  for (const [groupName, tabs] of Object.entries(groups)) {
    if (tabs.length > 0) {
      const groupSection = await createUnifiedGroupSection(groupName, tabs, groupingType, false);
      if (groupSection) {
        container.appendChild(groupSection);
      }
    }
  }
}


// Tab operations imports removed - not used in this file


/**
 * Render UI data sections to container
 * @param {Object} uiData - UI data from adapter
 * @param {HTMLElement} container - Container element
 * @param {string} groupingType - Grouping type
 */
// Function removed - now using direct morphdom approach in showCurrentTabsContent

/**
 * Centralized section rendering with consistent empty group handling
 * This is the SINGLE SOURCE OF TRUTH for how sections are rendered
 * @param {Array} sections - UI data sections from data manager
 * @param {string} groupingType - Grouping type (category, domain, etc.)
 * @param {boolean} isFromSaved - Whether rendering saved tabs
 * @returns {Promise<string>} HTML string for all sections
 */
async function renderSectionsToHTML(sections, groupingType, isFromSaved, uiData = null) {
  let html = '';
  
  for (const section of sections) {
    let sectionElement;
    
    // Apply search filtering to section items if there's an active search
    const { unifiedSearchService } = await import('../services/UnifiedSearchService.js');
    const hasActiveSearch = !!state.searchQuery;
    
    let filteredItems = section.items;
    if (hasActiveSearch) {
      // Filter items based on current search query
      filteredItems = section.items.filter(item => 
        unifiedSearchService.matchesSearch(item, false)
      );
    }
    
    // Skip truly empty sections only when there's no search
    // During search, always render sections (even empty ones) so they can be hidden
    if (filteredItems.length === 0 && !hasActiveSearch) {
      continue;
    }
    
    if (groupingType === 'category') {
      // Use category section renderer
      // The groupKey should now contain the numeric category ID as a string
      const categoryId = parseInt(section.groupKey, 10);
      
      sectionElement = await createUnifiedCategorySection(categoryId, filteredItems, isFromSaved);
    } else {
      // Use group section renderer
      sectionElement = await createUnifiedGroupSection(section.title, filteredItems, groupingType, isFromSaved);
    }
    
    if (sectionElement) {
      html += sectionElement.outerHTML;
    }
  }
  
  // Add "Show more groups" button if there are more groups
  // Only show for non-category groupings (domain, week, month etc.)
  if (groupingType !== 'category' && uiData && uiData.pagination && uiData.pagination.hasMoreGroups && uiData.summary) {
    const remainingGroups = uiData.summary.totalGroups - uiData.summary.visibleGroups;
    html += `
      <div class="expand-groups-button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        <span>Show more groups (${remainingGroups} remaining)</span>
      </div>
    `;
  }
  
  return html;
}

/**
 * Transform data from category-based grouping to custom grouping
 * @param {Object} uiData - UI data from data manager
 * @param {string} groupingType - Target grouping type
 * @param {boolean} isFromSaved - Whether this is saved tabs
 * @returns {Object} Transformed data with new grouping
 */
async function transformDataForCustomGrouping(uiData, groupingType, isFromSaved) {
  // Extract all tabs from all sections
  const allTabs = [];
  uiData.sections.forEach(section => {
    section.items.forEach(item => {
      // Preserve all the original data including isCurrentTab flag
      allTabs.push(item);
    });
  });
  
  // Apply custom grouping
  const groups = groupTabsBy(allTabs, groupingType);
  
  // Convert groups to sections format
  const sections = [];
  for (const [groupName, groupTabs] of Object.entries(groups)) {
    sections.push({
      groupKey: groupName,
      title: groupName,
      items: groupTabs,
      counters: {
        total: groupTabs.length,
        byCategory: {
          0: groupTabs.filter(t => t.category === 0).length,
          1: groupTabs.filter(t => t.category === 1).length,
          2: groupTabs.filter(t => t.category === 2).length,
          3: groupTabs.filter(t => t.category === 3).length
        }
      }
    });
  }
  
  // Sort sections based on grouping type
  const timeBasedGroupings = ['opened', 'lastActive', 'originallyOpened', 'lastViewed', 'saved'];
  
  if (timeBasedGroupings.includes(groupingType)) {
    // Sort by actual time
    sections.sort((a, b) => {
      const tabA = a.items[0];
      const tabB = b.items[0];
      
      let timeA, timeB;
      
      switch (groupingType) {
        case 'opened':
          if (!tabA.firstOpened || !tabB.firstOpened) {
            if (!tabA.firstOpened && !tabB.firstOpened) return 0;
            if (!tabA.firstOpened) return 1;
            if (!tabB.firstOpened) return -1;
          }
          timeA = new Date(tabA.firstOpened).getTime();
          timeB = new Date(tabB.firstOpened).getTime();
          break;
        case 'lastActive':
          if (!tabA.lastAccessed || !tabB.lastAccessed) {
            if (!tabA.lastAccessed && !tabB.lastAccessed) return 0;
            if (!tabA.lastAccessed) return 1;
            if (!tabB.lastAccessed) return -1;
          }
          timeA = tabA.lastAccessed;
          timeB = tabB.lastAccessed;
          break;
        case 'originallyOpened':
          if (!tabA.firstOpened || !tabB.firstOpened) {
            if (!tabA.firstOpened && !tabB.firstOpened) return 0;
            if (!tabA.firstOpened) return 1;
            if (!tabB.firstOpened) return -1;
          }
          timeA = new Date(tabA.firstOpened).getTime();
          timeB = new Date(tabB.firstOpened).getTime();
          break;
        case 'lastViewed':
          if (!tabA.lastAccessed || !tabB.lastAccessed) {
            if (!tabA.lastAccessed && !tabB.lastAccessed) return 0;
            if (!tabA.lastAccessed) return 1;
            if (!tabB.lastAccessed) return -1;
          }
          timeA = new Date(tabA.lastAccessed).getTime();
          timeB = new Date(tabB.lastAccessed).getTime();
          break;
        case 'saved':
          if (!tabA.savedDate || !tabB.savedDate) {
            if (!tabA.savedDate && !tabB.savedDate) return 0;
            if (!tabA.savedDate) return 1;
            if (!tabB.savedDate) return -1;
          }
          timeA = new Date(tabA.savedDate).getTime();
          timeB = new Date(tabB.savedDate).getTime();
          break;
        default:
          timeA = 0;
          timeB = 0;
      }
      
      return timeB - timeA; // Newest first
    });
  } else if (groupingType === 'timeOpen' || groupingType === 'totalAge' || groupingType === 'timeSinceViewed') {
    // Duration-based sorting
    const now = Date.now();
    sections.sort((a, b) => {
      // For timeOpen, extract duration from group names like "Open 5-10 minutes"
      if (groupingType === 'timeOpen') {
        const extractMinutes = (groupName) => {
          // Handle special cases first
          if (groupName === 'Unknown Open Time') return Number.MAX_SAFE_INTEGER;
          if (groupName.includes('1+ hours')) {
            const match = groupName.match(/(\d+)\+ hours/);
            if (match) return parseInt(match[1]) * 60;
          }
          
          // Extract range like "5-10 minutes"
          const match = groupName.match(/(\d+)-(\d+) minutes/);
          if (match) {
            const lowerBound = parseInt(match[1]);
            return lowerBound;
          }
          
          // If can't parse, return max value
          return Number.MAX_SAFE_INTEGER;
        };
        
        const minutesA = extractMinutes(a.title);
        const minutesB = extractMinutes(b.title);
        
        return minutesA - minutesB; // Sort by duration ascending
      }
      
      const tabA = a.items[0];
      const tabB = b.items[0];
      
      let durationA, durationB;
      
      switch (groupingType) {
        case 'timeOpen':
          // This case is now handled above
          break;
          
        case 'totalAge':
          if (!tabA.firstOpened || !tabB.firstOpened) {
            if (!tabA.firstOpened && !tabB.firstOpened) return 0;
            if (!tabA.firstOpened) return 1;
            if (!tabB.firstOpened) return -1;
          }
          durationA = now - new Date(tabA.firstOpened).getTime();
          durationB = now - new Date(tabB.firstOpened).getTime();
          break;
          
        case 'timeSinceViewed':
          if (!tabA.lastAccessed || !tabB.lastAccessed) {
            if (!tabA.lastAccessed && !tabB.lastAccessed) return 0;
            if (!tabA.lastAccessed) return 1;
            if (!tabB.lastAccessed) return -1;
          }
          durationA = now - new Date(tabA.lastAccessed).getTime();
          durationB = now - new Date(tabB.lastAccessed).getTime();
          break;
          
        default:
          durationA = 0;
          durationB = 0;
      }
      
      return durationA - durationB; // Shortest duration first
    });
  } else if (groupingType === 'predictionConfidence') {
    // Sort by confidence level (highest first)
    const confidenceOrder = {
      '100% Confidence': 1,
      '90-99% Confidence': 2,
      '80-89% Confidence': 3,
      '70-79% Confidence': 4,
      '60-69% Confidence': 5,
      '50-59% Confidence': 6,
      '40-49% Confidence': 7,
      '30-39% Confidence': 8,
      '20-29% Confidence': 9,
      '10-19% Confidence': 10,
      '1-9% Confidence': 11,
      '0% Confidence': 12,
      'No ML Prediction': 13
    };
    
    sections.sort((a, b) => {
      const orderA = confidenceOrder[a.title] || 999;
      const orderB = confidenceOrder[b.title] || 999;
      return orderA - orderB;
    });
  } else if (groupingType === 'predictionAgreement') {
    // Sort by correctness pattern
    sections.sort((a, b) => {
      const titleA = a.title;
      const titleB = b.title;
      
      // Handle special cases first
      if (titleA === 'No ML Prediction') return 1;
      if (titleB === 'No ML Prediction') return -1;
      
      // For pattern-based titles (e.g., "CCC", "WWW", "CW-")
      if (titleA.match(/^[CW-]{3}$/) && titleB.match(/^[CW-]{3}$/)) {
        // Count correct and wrong predictions
        const countCorrect = (pattern) => (pattern.match(/C/g) || []).length;
        const countWrong = (pattern) => (pattern.match(/W/g) || []).length;
        
        const correctA = countCorrect(titleA);
        const correctB = countCorrect(titleB);
        const wrongA = countWrong(titleA);
        const wrongB = countWrong(titleB);
        
        // 1. Sort by number of correct predictions (descending)
        if (correctA !== correctB) {
          return correctB - correctA;
        }
        
        // 2. Same number correct - sort by number of wrong predictions (ascending)
        if (wrongA !== wrongB) {
          return wrongA - wrongB;
        }
        
        // 3. Same pattern - sort alphabetically for consistency
        return titleA.localeCompare(titleB);
      }
      
      // Fallback
      return titleA.localeCompare(titleB);
    });
  }
  
  // Return transformed data preserving the UI data structure
  return {
    ...uiData,
    sections: sections,
    summary: {
      ...uiData.summary,
      totalGroups: sections.length,
      visibleGroups: sections.length
    }
  };
}

// Export centralized rendering function
export { renderSectionsToHTML, transformDataForCustomGrouping };

// Re-export unified functions for backward compatibility
export { createUnifiedGroupSection as createGroupSection, createUnifiedCategorySection as createCategorySection };

// Export functions
export default {
  displayTabs,
  showCurrentTabsContent,
  displayGroupedView,
  createGroupSection: createUnifiedGroupSection,
  createTabElement,
  renderTabsToContainer,
  groupTabsBy
};