/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Unified Search Service - handles search functionality across all tab contexts
 */

import { TAB_CATEGORIES, CSS_CLASSES, LIMITS } from '../utils/constants.js';
import { classes } from '../utils/dom-helpers.js';
import { extractDomain } from '../utils/helpers.js';
import { showStatus } from '../modules/ui-manager.js';

// Search configuration
const SEARCH_CONFIG = {
  INITIAL_TAB_COUNT: LIMITS.INITIAL_TAB_COUNT,
  SEARCH_FIELDS: ['title', 'url', 'domain'],
  CASE_SENSITIVE: false
};

/**
 * Unified Search Service for handling search across all tab contexts
 */
export class UnifiedSearchService {
  constructor() {
    this.searchQuery = '';
    this.activeContext = 'current'; // 'current' or 'saved'
  }

  /**
   * Set the current search query
   * @param {string} query - Search query
   */
  setSearchQuery(query) {
    this.searchQuery = SEARCH_CONFIG.CASE_SENSITIVE ? query.trim() : query.toLowerCase().trim();
  }

  /**
   * Set the active search context
   * @param {string} context - 'current' or 'saved'
   */
  setContext(context) {
    this.activeContext = context;
  }

  /**
   * Check if a tab matches the current search query
   * @param {Object} tab - Tab object or element
   * @param {boolean} isDOMElement - Whether tab is a DOM element
   * @returns {boolean} - Whether tab matches search
   */
  matchesSearch(tab, isDOMElement = false) {
    if (!this.searchQuery) return true;

    let searchFields;
    
    if (isDOMElement) {
      // Extract text from DOM element
      const title = tab.querySelector('.tab-title')?.textContent || '';
      const url = tab.querySelector('.tab-url')?.textContent || '';
      const domain = this.extractDomainFromUrl(url);
      
      searchFields = [title, url, domain];
    } else {
      // Use tab object properties
      searchFields = [
        tab.title || '',
        tab.url || '',
        tab.domain || this.extractDomainFromUrl(tab.url || '')
      ];
    }

    const searchableText = searchFields.join(' ').toLowerCase();
    
    // Multi-word search: split query and check that ALL words are present
    const searchWords = this.searchQuery.split(/\s+/).filter(word => word.length > 0);
    return searchWords.every(word => searchableText.includes(word));
  }

  /**
   * Extract domain from URL for consistent domain searching
   * @param {string} url - URL string
   * @returns {string} - Domain
   */
  extractDomainFromUrl(url) {
    try {
      return extractDomain(url) || '';
    } catch (error) {
      return '';
    }
  }

  /**
   * Filter tabs and update display with unified logic
   * @param {Array|NodeList} tabs - Tabs to filter (objects or DOM elements)
   * @param {HTMLElement} container - Container element
   * @param {boolean} isDOMBased - Whether tabs are DOM elements
   * @param {Object} options - Additional options
   * @returns {Object} - Filter results
   */
  filterTabs(tabs, container, isDOMBased = false, options = {}) {
    const {
      groupingType = 'category',
      updateCounts = true,
      hideEmptyGroups = true,
      smartShowMore = true
    } = options;


    let visibleCount = 0;
    const visibleByCategory = this.initializeCategoryCounters();
    const groupResults = new Map(); // Track results by group

    // Convert NodeList to Array if needed
    const tabArray = Array.from(tabs);

    tabArray.forEach(tab => {
      const matches = this.matchesSearch(tab, isDOMBased);
      const category = this.getTabCategory(tab, isDOMBased);
      
      if (matches) {
        if (isDOMBased) {
          classes.remove(tab, CSS_CLASSES.TAB_ITEM_HIDDEN);
          classes.add(tab, 'search-match');
        }
        
        visibleCount++;
        visibleByCategory[category]++;
        
        // Track group-level results
        const groupKey = this.getTabGroupKey(tab, groupingType, isDOMBased);
        if (!groupResults.has(groupKey)) {
          groupResults.set(groupKey, { count: 0, byCategory: this.initializeCategoryCounters() });
        }
        groupResults.get(groupKey).count++;
        groupResults.get(groupKey).byCategory[category]++;
        
      } else {
        if (isDOMBased) {
          classes.add(tab, CSS_CLASSES.TAB_ITEM_HIDDEN);
          classes.remove(tab, 'search-match');
        }
      }
    });

    const results = {
      visibleCount,
      visibleByCategory,
      groupResults,
      hasActiveSearch: !!this.searchQuery
    };

    // Apply unified updates
    if (updateCounts) {
      this.updateCounters(container, results, groupingType);
    }
    
    if (hideEmptyGroups) {
      this.handleEmptyGroups(container, results);
    }
    
    if (smartShowMore) {
      this.updateShowMoreLogic(container, results);
    }

    // Show search status
    this.showSearchStatus(results);

    return results;
  }

  /**
   * Initialize category counters object
   * @returns {Object} - Category counters
   */
  initializeCategoryCounters() {
    return {
      [TAB_CATEGORIES.UNCATEGORIZED]: 0,
      [TAB_CATEGORIES.CAN_CLOSE]: 0,
      [TAB_CATEGORIES.SAVE_LATER]: 0,
      [TAB_CATEGORIES.IMPORTANT]: 0
    };
  }

  /**
   * Get tab category from tab object or DOM element
   * @param {Object|Element} tab - Tab
   * @param {boolean} isDOMElement - Whether tab is DOM element
   * @returns {number} - Category number
   */
  getTabCategory(tab, isDOMElement) {
    if (isDOMElement) {
      return parseInt(tab.dataset.category) || TAB_CATEGORIES.UNCATEGORIZED;
    }
    return tab.category || TAB_CATEGORIES.UNCATEGORIZED;
  }

  /**
   * Get group key for tab based on grouping type
   * @param {Object|Element} tab - Tab
   * @param {string} groupingType - Type of grouping
   * @param {boolean} isDOMElement - Whether tab is DOM element
   * @returns {string} - Group key
   */
  getTabGroupKey(tab, groupingType, isDOMElement) {
    if (groupingType === 'category') {
      return `category-${this.getTabCategory(tab, isDOMElement)}`;
    }
    
    // For domain-based grouping
    if (groupingType === 'domain') {
      const domain = isDOMElement 
        ? this.extractDomainFromUrl(tab.querySelector('.tab-url')?.textContent || '')
        : (tab.domain || this.extractDomainFromUrl(tab.url || ''));
      return `domain-${domain}`;
    }
    
    // Default to category grouping
    return `category-${this.getTabCategory(tab, isDOMElement)}`;
  }

  /**
   * Update all counters (category counts, group counts, etc.)
   * @param {HTMLElement} container - Container element
   * @param {Object} results - Filter results
   * @param {string} groupingType - Grouping type
   */
  updateCounters(container, results, groupingType) {
    const { visibleByCategory, groupResults, hasActiveSearch } = results;

    if (groupingType === 'category') {
      this.updateCategoryCounters(container, visibleByCategory, hasActiveSearch);
    } else {
      this.updateGroupCounters(container, groupResults, hasActiveSearch);
    }
  }

  /**
   * Update category counters in category view
   * @param {HTMLElement} container - Container element
   * @param {Object} visibleByCategory - Visible counts by category
   * @param {boolean} hasActiveSearch - Whether search is active
   */
  updateCategoryCounters(container, visibleByCategory, hasActiveSearch) {
    Object.keys(visibleByCategory).forEach(category => {
      const categoryNum = parseInt(category);
      const countElement = container.querySelector(`#category${categoryNum} .count`);
      
      if (countElement) {
        const visibleCount = visibleByCategory[categoryNum];
        
        if (hasActiveSearch) {
          // Get original total count from DOM or data
          const totalCount = this.getOriginalCategoryCount(container, categoryNum);
          countElement.textContent = `${visibleCount} of ${totalCount}`;
        } else {
          countElement.textContent = visibleCount;
        }
      }
    });
  }

  /**
   * Update group counters in grouped view
   * @param {HTMLElement} container - Container element
   * @param {Map} groupResults - Results by group
   * @param {boolean} hasActiveSearch - Whether search is active
   */
  updateGroupCounters(container, groupResults, hasActiveSearch) {
    const groupSections = container.querySelectorAll('.group-section');
    
    groupSections.forEach(groupSection => {
      this.updateSingleGroupCounters(groupSection, groupResults, hasActiveSearch);
    });
  }

  /**
   * Update counters for a single group section
   * @param {HTMLElement} groupSection - Group section element
   * @param {Map} groupResults - Results by group
   * @param {boolean} hasActiveSearch - Whether search is active
   */
  updateSingleGroupCounters(groupSection, groupResults, hasActiveSearch) {
    const statsContainer = groupSection.querySelector('.group-stats');
    if (!statsContainer) return;

    const allTabs = groupSection.querySelectorAll('.tab-item');
    const visibleTabs = groupSection.querySelectorAll('.tab-item:not(.tab-item-hidden)');
    
    // Update total count
    const totalStat = statsContainer.querySelector('.stat-item.total');
    if (totalStat) {
      if (hasActiveSearch) {
        totalStat.textContent = `Total: ${visibleTabs.length} of ${allTabs.length}`;
      } else {
        totalStat.textContent = `Total: ${allTabs.length}`;
      }
    }

    // Update category-specific stats
    this.updateGroupCategoryStats(statsContainer, groupSection, hasActiveSearch);
  }

  /**
   * Update category stats within a group
   * @param {HTMLElement} statsContainer - Stats container
   * @param {HTMLElement} groupSection - Group section
   * @param {boolean} hasActiveSearch - Whether search is active
   */
  updateGroupCategoryStats(statsContainer, groupSection, hasActiveSearch) {
    const categoryStats = {
      [TAB_CATEGORIES.UNCATEGORIZED]: { selector: '.stat-item.uncategorized', count: 0 },
      [TAB_CATEGORIES.IMPORTANT]: { selector: '.stat-item.important', count: 0 },
      [TAB_CATEGORIES.SAVE_LATER]: { selector: '.stat-item.somewhat', count: 0 },
      [TAB_CATEGORIES.CAN_CLOSE]: { selector: '.stat-item.not-important', count: 0 }
    };

    // Count visible tabs by category
    const visibleTabs = groupSection.querySelectorAll('.tab-item:not(.tab-item-hidden)');
    visibleTabs.forEach(tab => {
      const category = parseInt(tab.dataset.category) || TAB_CATEGORIES.UNCATEGORIZED;
      if (categoryStats[category]) {
        categoryStats[category].count++;
      }
    });

    // Update each category stat
    Object.entries(categoryStats).forEach(([, info]) => {
      const statElement = statsContainer.querySelector(info.selector);
      if (statElement) {
        const icon = statElement.querySelector('svg')?.outerHTML || '';
        
        if (hasActiveSearch && info.count === 0) {
          statElement.style.display = 'none';
        } else {
          statElement.style.display = '';
          statElement.innerHTML = `${icon} ${info.count}`;
        }
      }
    });
  }

  /**
   * Get original category count (before filtering)
   * @param {HTMLElement} container - Container element
   * @param {number} categoryNum - Category number
   * @returns {number} - Original count
   */
  getOriginalCategoryCount(container, categoryNum) {
    const categoryElement = container.querySelector(`#category${categoryNum}`);
    if (categoryElement) {
      const allTabs = categoryElement.querySelectorAll('.tab-item');
      return allTabs.length;
    }
    return 0;
  }

  /**
   * Handle empty groups (hide/show based on search results)
   * Uses centralized logic consistent with unified group renderer
   * @param {HTMLElement} container - Container element
   * @param {Object} results - Filter results
   */
  handleEmptyGroups(container, results) {
    const { hasActiveSearch } = results;
    
    // Handle all sections (both group and category) consistently
    const allSections = container.querySelectorAll('.group-section, .category-section');
    
    allSections.forEach(section => {
      const visibleTabs = section.querySelectorAll('.tab-item:not(.tab-item-hidden)');
      const hasVisibleTabs = visibleTabs.length > 0;
      
      // Determine if this section should be hidden when empty
      const shouldHideWhenEmpty = this.shouldHideEmptySection(section);
      
      // Apply consistent hiding logic
      if (!hasVisibleTabs && (hasActiveSearch || shouldHideWhenEmpty)) {
        // Use consistent CSS class for hiding (not direct style manipulation)
        classes.add(section, CSS_CLASSES.GROUP_HIDDEN);
      } else {
        classes.remove(section, CSS_CLASSES.GROUP_HIDDEN);
      }
    });
  }

  /**
   * Determine if a section should be hidden when empty
   * Centralizes the logic from unified group renderer strategies
   * @param {HTMLElement} section - Section element
   * @returns {boolean} - Whether to hide when empty
   */
  shouldHideEmptySection(section) {
    // Category sections should always be hidden when empty (consistent with renderer logic)
    if (section.classList.contains('category-section')) {
      return true;
    }
    
    // Group sections depend on context - for current tabs, hide empty groups
    // For saved tabs, also hide empty groups (consistent with renderer strategies)
    if (section.classList.contains('group-section')) {
      return true;
    }
    
    return false;
  }

  /**
   * Update "show more" logic based on filtered results
   * @param {HTMLElement} container - Container element
   * @param {Object} results - Filter results
   */
  updateShowMoreLogic(container, results) {
    const { hasActiveSearch } = results;
    
    // Find all expandable sections
    const expandableSections = container.querySelectorAll('.group-section, [id^="category"]');
    
    expandableSections.forEach(section => {
      this.updateSectionShowMore(section, hasActiveSearch);
    });
  }

  /**
   * Update show more logic for a single section
   * @param {HTMLElement} section - Section element
   * @param {boolean} hasActiveSearch - Whether search is active
   */
  updateSectionShowMore(section, hasActiveSearch) {
    const visibleTabs = section.querySelectorAll('.tab-item:not(.tab-item-hidden)');
    const expandButton = section.querySelector('.expand-group-button');
    
    // If we have fewer than 15 visible tabs after filtering, remove expand button
    if (hasActiveSearch && visibleTabs.length <= SEARCH_CONFIG.INITIAL_TAB_COUNT) {
      if (expandButton) {
        expandButton.remove();
      }
      
      // Show all filtered tabs
      visibleTabs.forEach(tab => {
        tab.style.display = '';
      });
    }
    // If search is cleared, restore original expand logic
    else if (!hasActiveSearch && expandButton) {
      // Let the original expand logic handle this
      // The unified-group-renderer will recreate proper expand buttons
    }
  }

  /**
   * Show search status message
   * @param {Object} results - Filter results
   */
  showSearchStatus(results) {
    const { visibleCount, hasActiveSearch, groupResults } = results;
    
    if (hasActiveSearch) {
      const visibleGroups = Array.from(groupResults.values()).filter(group => group.count > 0).length;
      
      // Search results are instantly visible in the UI - no message needed
    }
  }

  /**
   * Clear search and reset all filters
   * @param {HTMLElement} container - Container element
   * @param {Array|NodeList} tabs - All tabs
   * @param {boolean} isDOMBased - Whether tabs are DOM elements
   */
  clearSearch(container, tabs, isDOMBased = false) {
    this.searchQuery = '';
    
    // Show all tabs
    const tabArray = Array.from(tabs);
    tabArray.forEach(tab => {
      if (isDOMBased) {
        classes.remove(tab, CSS_CLASSES.TAB_ITEM_HIDDEN);
        classes.remove(tab, 'search-match');
      }
    });

    // Reset all counters and groups
    this.resetAllDisplayState(container);
    
    // No need to clear status - we're not showing search messages
  }

  /**
   * Reset all display state (counters, groups, expand buttons)
   * @param {HTMLElement} container - Container element
   */
  resetAllDisplayState(container) {
    // Show all groups
    const groupSections = container.querySelectorAll('.group-section');
    groupSections.forEach(section => {
      classes.remove(section, CSS_CLASSES.GROUP_HIDDEN);
    });

    // Show all category sections
    const categorySections = container.querySelectorAll('[id^="category"]');
    categorySections.forEach(section => {
      section.style.display = '';
    });

    // Reset group stats to show original counts
    this.resetGroupStats(container);
    
    // Reset category counts
    this.resetCategoryStats(container);
  }

  /**
   * Reset group statistics to original state
   * @param {HTMLElement} container - Container element
   */
  resetGroupStats(container) {
    const groupSections = container.querySelectorAll('.group-section');
    
    groupSections.forEach(groupSection => {
      const statsContainer = groupSection.querySelector('.group-stats');
      if (!statsContainer) return;

      const allTabs = groupSection.querySelectorAll('.tab-item');
      
      // Reset total count
      const totalStat = statsContainer.querySelector('.stat-item.total');
      if (totalStat) {
        totalStat.textContent = `Total: ${allTabs.length}`;
      }

      // Reset category stats
      const categoryStats = {
        [TAB_CATEGORIES.UNCATEGORIZED]: '.stat-item.uncategorized',
        [TAB_CATEGORIES.IMPORTANT]: '.stat-item.important',
        [TAB_CATEGORIES.SAVE_LATER]: '.stat-item.somewhat',
        [TAB_CATEGORIES.CAN_CLOSE]: '.stat-item.not-important'
      };

      Object.entries(categoryStats).forEach(([category, selector]) => {
        const statElement = statsContainer.querySelector(selector);
        if (statElement) {
          const tabsInCategory = allTabs.length > 0 ? 
            Array.from(allTabs).filter(tab => 
              parseInt(tab.dataset.category) === parseInt(category)
            ).length : 0;
          
          const icon = statElement.querySelector('svg')?.outerHTML || '';
          statElement.style.display = tabsInCategory > 0 ? '' : 'none';
          statElement.innerHTML = `${icon} ${tabsInCategory}`;
        }
      });
    });
  }

  /**
   * Reset category statistics to original state
   * @param {HTMLElement} container - Container element
   */
  resetCategoryStats(container) {
    const categorySections = container.querySelectorAll('[id^="category"]');
    
    categorySections.forEach(section => {
      const countElement = section.querySelector('.count');
      if (countElement) {
        const allTabs = section.querySelectorAll('.tab-item');
        countElement.textContent = allTabs.length;
      }
    });
  }
}

// Create singleton instance
export const unifiedSearchService = new UnifiedSearchService();

// Export class for direct instantiation if needed
export default UnifiedSearchService;