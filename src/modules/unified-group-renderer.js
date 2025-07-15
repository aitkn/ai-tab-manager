/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Unified Group Renderer - handles rendering of groups and categories for both Current and Saved tabs
 */

import { TAB_CATEGORIES, CATEGORY_NAMES, CSS_CLASSES, GROUPING_OPTIONS, LIMITS } from '../utils/constants.js';
import { createElement, classes } from '../utils/dom-helpers.js';
import { sortTabsInGroup, smartConfirm } from '../utils/helpers.js';
import { createTabElement } from './unified-tab-renderer.js';
import { state, shouldGroupBeCollapsed } from './state-manager.js';
// import { unifiedSearchService } from '../services/UnifiedSearchService.js'; // Unused - kept for future use
import { createOptimizedFavicon } from '../utils/favicon-loader.js';

/**
 * Group Render Strategy Interface
 * Defines the contract for different group rendering strategies
 */
class GroupRenderStrategy {
  /**
   * Create action buttons for the group/category
   * @param {Array} tabs - Tabs in the group
   * @param {string} groupName - Name of the group
   * @param {number|string} groupType - Category number or group type
   * @returns {DocumentFragment|HTMLElement}
   */
  // eslint-disable-next-line no-unused-vars
  createActionButtons(_tabs, _groupName, _groupType) {
    throw new Error('createActionButtons must be implemented by subclass');
  }

  /**
   * Get CSS class modifiers for group element
   * @param {string} groupName - Name of the group
   * @param {number|string} groupType - Category number or group type
   * @returns {string}
   */
  // eslint-disable-next-line no-unused-vars
  getGroupModifierClasses(_groupName, _groupType) {
    return '';
  }

  /**
   * Get group ID prefix
   * @returns {string}
   */
  getGroupIdPrefix() {
    return '';
  }

  /**
   * Should show empty groups
   * @returns {boolean}
   */
  shouldShowEmptyGroups() {
    return true;
  }
}

/**
 * Current Tabs Group Renderer Strategy
 * Handles rendering for live browser tab groups
 */
export class CurrentGroupRenderStrategy extends GroupRenderStrategy {
  constructor(tabOperations) {
    super();
    this.tabOperations = tabOperations;
  }

  createActionButtons(tabs, _groupName, groupType) {
    const renderer = UnifiedGroupRenderer;
    
    if (typeof groupType === 'number') {
      // Category section
      const hasUncategorized = groupType === TAB_CATEGORIES.UNCATEGORIZED;
      const fragment = document.createDocumentFragment();
      
      // Add category assignment buttons for Uncategorized category
      if (hasUncategorized && tabs.length > 0) {
        // Create category buttons container
        const categoryButtons = createElement('div', { 
          className: 'category-buttons',
          style: 'display: inline-flex; gap: 2px; margin-right: 16px;'
        });
        
        // Important button
        const importantBtn = createElement('button', {
          className: 'category-btn category-important',
          title: `Assign all ${tabs.length} tabs to Important`,
          innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
          dataset: {
            action: 'assignAllUncategorized',
            targetCategory: TAB_CATEGORIES.IMPORTANT
          }
        });
        categoryButtons.appendChild(importantBtn);
        
        // Useful button
        const usefulBtn = createElement('button', {
          className: 'category-btn category-save-later',
          title: `Assign all ${tabs.length} tabs to Useful`,
          innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>',
          dataset: {
            action: 'assignAllUncategorized',
            targetCategory: TAB_CATEGORIES.SAVE_LATER
          }
        });
        categoryButtons.appendChild(usefulBtn);
        
        // Ignore button
        const ignoreBtn = createElement('button', {
          className: 'category-btn category-can-close',
          title: `Assign all ${tabs.length} tabs to Ignore`,
          innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
          dataset: {
            action: 'assignAllUncategorized',
            targetCategory: TAB_CATEGORIES.CAN_CLOSE
          }
        });
        categoryButtons.appendChild(ignoreBtn);
        
        fragment.appendChild(categoryButtons);
      }
      
      // Close All button
      const title = hasUncategorized ? 
        'Close all uncategorized tabs (WARNING: These tabs have not been saved)' : 
        'Close all tabs in this category';
      
      const closeBtn = renderer.prototype.createActionButton({
        className: renderer.BUTTON_CLASSES.CATEGORY_CLOSE,
        title: title,
        icon: renderer.SVG_ICONS.CLOSE,
        hasWarning: hasUncategorized,
        onClick: async () => {
          if (hasUncategorized) {
            // Show warning for uncategorized tabs
            if (await smartConfirm('Are you sure you want to close all uncategorized tabs? These tabs have not been saved.', { defaultAnswer: false })) {
              this.tabOperations.closeAllInCategory(groupType);
            }
          } else {
            this.tabOperations.closeAllInCategory(groupType);
          }
        }
      });
      fragment.appendChild(closeBtn);
      
      return fragment;
    } else {
      // Group section - Close All button
      const hasUncategorizedInGroup = tabs.some(tab => tab.category === TAB_CATEGORIES.UNCATEGORIZED);
      const title = hasUncategorizedInGroup ? 
        'Close all tabs in this group (WARNING: Includes uncategorized tabs)' : 
        'Close all tabs in this group';
      
      return renderer.prototype.createActionButton({
        className: renderer.BUTTON_CLASSES.GROUP_CLOSE,
        title: title,
        icon: renderer.SVG_ICONS.CLOSE,
        hasWarning: hasUncategorizedInGroup,
        onClick: () => {
          this.tabOperations.closeTabsInGroup(tabs);
        }
      });
    }
  }

  getGroupIdPrefix() {
    return 'category';
  }

  shouldShowEmptyGroups() {
    // During search, show empty groups so they can be hidden with CSS
    const hasActiveSearch = state.searchQuery && state.searchQuery.trim().length > 0;
    return hasActiveSearch;
  }
}

/**
 * Saved Tabs Group Renderer Strategy
 * Handles rendering for saved tab groups from database
 */
export class SavedGroupRenderStrategy extends GroupRenderStrategy {
  constructor(tabOperations) {
    super();
    this.tabOperations = tabOperations;
  }

  createActionButtons(tabs, groupName, groupType) {
    const renderer = UnifiedGroupRenderer;
    const fragment = document.createDocumentFragment();

    if (typeof groupType === 'number') {
      // Category section - Open All and Delete All buttons
      const openAllBtn = renderer.prototype.createActionButton({
        className: renderer.BUTTON_CLASSES.CATEGORY_ACTION,
        title: `Open all ${tabs.length} tabs`,
        icon: renderer.SVG_ICONS.OPEN,
        action: 'openSavedTabs',
        data: { tabCount: tabs.length },
        onClick: () => {
          if (this.tabOperations && this.tabOperations.openSavedTabs) {
            this.tabOperations.openSavedTabs(tabs);
          } else {
            console.error('🔶 ERROR: tabOperations.openSavedTabs not available');
          }
        }
      });
      fragment.appendChild(openAllBtn);

      const deleteBtn = renderer.prototype.createActionButton({
        className: renderer.BUTTON_CLASSES.CATEGORY_ACTION + ' delete-btn',
        title: `Delete all ${tabs.length} tabs`,
        icon: renderer.SVG_ICONS.DELETE,
        onClick: () => {
          this.tabOperations.deleteTabsInCategory(tabs, CATEGORY_NAMES[groupType]);
        }
      });
      fragment.appendChild(deleteBtn);
    } else {
      // Group section - Open All and Delete All buttons
      const openAllBtn = renderer.prototype.createActionButton({
        className: renderer.BUTTON_CLASSES.GROUP_ACTION,
        title: 'Open all tabs in this group',
        icon: renderer.SVG_ICONS.OPEN,
        onClick: () => {
          this.tabOperations.openAllTabsInGroup(tabs);
        }
      });
      fragment.appendChild(openAllBtn);

      const deleteBtn = renderer.prototype.createActionButton({
        className: renderer.BUTTON_CLASSES.GROUP_ACTION + ' delete-btn',
        title: 'Delete all tabs in this group',
        icon: renderer.SVG_ICONS.DELETE,
        onClick: () => {
          this.tabOperations.deleteTabsInGroup(tabs, groupName);
        }
      });
      fragment.appendChild(deleteBtn);
    }

    return fragment;
  }

  getGroupIdPrefix() {
    return 'savedCategory';
  }

  shouldShowEmptyGroups() {
    return false; // Don't show empty categories for saved tabs
  }
}

/**
 * Unified Group Renderer
 * Main class that renders groups and categories using different strategies
 */
export class UnifiedGroupRenderer {
  constructor() {
    this.strategies = new Map();
  }

  /**
   * Create expandable tabs list with pagination
   * @param {Array} tabs - All tabs to display
   * @param {number|string} categoryOrGroupType - Category number or group type for tab creation
   * @param {string} type - Tab type ('current' or 'saved')
   * @returns {Promise<HTMLElement>} Tabs list element with expandable functionality
   */
  async createExpandableTabsList(tabs, categoryOrGroupType, type) {
const tabsList = createElement('div', { className: CSS_CLASSES.TABS_LIST });

    // Use tabs as-is (filtering is now handled at higher level in renderSectionsToHTML)
    const visibleTabs = tabs;

    // Expandable group logic: show first 15 tabs, then add "Show more" button
    const INITIAL_TAB_COUNT = LIMITS.INITIAL_TAB_COUNT;
    let currentlyShown = 0;

    // Function to add a batch of tabs
    const addTabBatch = async (startIndex, batchSize) => {
      const endIndex = Math.min(startIndex + batchSize, visibleTabs.length);
      for (let i = startIndex; i < endIndex; i++) {
        const tab = visibleTabs[i];
        const tabElement = await createTabElement(tab, typeof categoryOrGroupType === 'number' ? categoryOrGroupType : tab.category, type === 'saved');
        tabsList.appendChild(tabElement);
      }
      return endIndex;
    };

    // Add initial batch of tabs
    if (visibleTabs.length > 0) {
      currentlyShown = await addTabBatch(0, INITIAL_TAB_COUNT);
    }
    
    // Store tab data on the tabs list for event delegation
    tabsList.dataset.visibleTabsData = JSON.stringify(visibleTabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      domain: t.domain,
      category: t.category,
      favIconUrl: t.favIconUrl
    })));
    tabsList.dataset.currentlyShown = currentlyShown;
    tabsList.dataset.categoryOrGroupType = categoryOrGroupType;
    tabsList.dataset.tabType = type;

    // Helper function to create expand button
    const createExpandButton = (shown) => {
      if (shown >= visibleTabs.length) return null;
      
      const remainingCount = visibleTabs.length - shown;
      const nextBatchSize = Math.min(remainingCount, INITIAL_TAB_COUNT);
      const expandButton = createElement('div', {
        className: 'expand-group-button',
        innerHTML: `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
          <span>Show ${nextBatchSize} more tabs (${remainingCount} remaining)</span>
        `
      });

      // Mark that this button has a direct event listener
      expandButton.dataset.hasListener = 'true';
      
      // Store metadata on the button for event delegation
      expandButton.dataset.currentlyShown = currentlyShown;
      expandButton.dataset.totalTabs = visibleTabs.length;
      expandButton.dataset.groupKey = tabs[0]?.domain || tabs[0]?.category || 'unknown';
      
      // Don't add event listener here - let event delegation handle it
      // The event delegation in event-handlers.js will handle the click
      
      return expandButton;
    };

    // Create initial expand button if there are more tabs
    if (visibleTabs.length > INITIAL_TAB_COUNT) {
      const expandButton = createExpandButton(currentlyShown);
      if (expandButton) {
        tabsList.appendChild(expandButton);
      }
    }

    return tabsList;
  }


  /**
   * Create section header (category or group)
   * @param {Object} options - Header options
   * @returns {HTMLElement} Header element
   */
  createSectionHeader({ groupId, groupName, tabs, sectionType, groupingType, strategy }) {
    const isCategory = sectionType === 'category';
    
    if (isCategory) {
      return this.createCategoryHeader(groupId, groupName, tabs, strategy);
    } else {
      return this.createGroupHeader(groupId, groupName, tabs, groupingType, strategy);
    }
  }

  /**
   * Create category header
   */
  createCategoryHeader(category, groupName, tabs, strategy) {
    // Create header using old-style layout (h2 + category-header-title)
    const header = createElement('h2', { 
      className: CSS_CLASSES.CATEGORY_HEADER + this.getCategoryModifierClass(category),
      style: { cursor: 'pointer' }
    });

    // Category title section (old style)
    const categoryTitle = createElement('div', { className: 'category-header-title' });

    // Category icon (using old style SVG with proper attributes)
    const categoryIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    categoryIcon.setAttribute('class', 'category-icon');
    categoryIcon.setAttribute('width', '18');
    categoryIcon.setAttribute('height', '18');
    categoryIcon.setAttribute('viewBox', '0 0 24 24');
    
    // Set category-specific attributes
    const iconAttribs = this.getOldCategoryIconAttributes(category);
    Object.entries(iconAttribs).forEach(([key, value]) => {
      categoryIcon.setAttribute(key, value);
    });
    
    // Set inner content
    categoryIcon.innerHTML = this.getOldCategoryIcon(category);

    // Category name and count (inline format like "Important (9)")
    const categoryNameSpan = createElement('span', { 
      className: 'category-name',
      textContent: groupName
    });

    const countSpan = createElement('span', { 
      className: 'count',
      textContent: tabs.length.toString()
    });

    // Build title content: icon + "Name (count)"
    categoryTitle.appendChild(categoryIcon);
    categoryTitle.appendChild(document.createTextNode(' '));
    categoryTitle.appendChild(categoryNameSpan);
    categoryTitle.appendChild(document.createTextNode(' ( '));
    categoryTitle.appendChild(countSpan);
    categoryTitle.appendChild(document.createTextNode(' )'));

    // Category header actions
    const headerActions = createElement('div', { className: 'category-header-actions' });

    // Add action buttons using strategy
    if (tabs.length > 0) {
      const actionButtons = strategy.createActionButtons(tabs, '', category);
      headerActions.appendChild(actionButtons);
    }

    header.appendChild(categoryTitle);
    header.appendChild(headerActions);
    
    return header;
  }

  /**
   * Create group header
   */
  createGroupHeader(_groupName, displayName, tabs, groupingType, strategy) {
    const header = createElement('div', { className: 'group-header' });

    // Group title with icon
    const titleDiv = createElement('div', { className: 'group-title' });

    // Add appropriate icon based on grouping type
    if (groupingType === GROUPING_OPTIONS.DOMAIN) {
      // For domain grouping, use the actual domain favicon
      // Use the first tab in the group to get the actual URL for favicon loading
      const representativeTab = tabs[0]; // Use first tab as representative
      
      const favicon = createOptimizedFavicon(representativeTab);
      favicon.style.width = '18px';
      favicon.style.height = '18px';
      favicon.style.flexShrink = '0';
      
      titleDiv.appendChild(favicon);
      titleDiv.appendChild(createElement('span', { textContent: displayName }));
    } else if (groupingType === 'predictionAgreement' && _groupName.match(/^[CW-]{3}$/)) {
      // Special handling for prediction agreement patterns
      const pattern = _groupName;
      const methods = ['LLM', 'ML', 'Rules'];
      const colorClasses = {
        'C': 'agreement-correct-color', // Green for correct
        'W': 'agreement-wrong-color',   // Red for wrong
        '-': 'agreement-none-color'      // Gray for undefined
      };
      
      let html = '<span style="font-family: monospace; font-weight: 500;">';
      for (let i = 0; i < 3; i++) {
        const status = pattern[i];
        const colorClass = colorClasses[status];
        const separator = i < 2 ? ' ' : '';
        html += `<span class="${colorClass}">${methods[i]}</span>${separator}`;
      }
      html += '</span>';
      
      titleDiv.innerHTML = html;
    } else {
      // For other grouping types, use SVG icons
      let icon = '';
      if (typeof groupingType === 'string' && (groupingType.includes('Date') || groupingType.includes('Week') || groupingType.includes('Month'))) {
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
      }
      
      titleDiv.innerHTML = icon + `<span>${displayName}</span>`;
    }
    header.appendChild(titleDiv);

    // Create stats and actions container
    const headerRight = createElement('div', { className: 'header-right' });

    // Count tabs by category (use full tabs list, not search-filtered)
    const categoryCounts = { 
      [TAB_CATEGORIES.UNCATEGORIZED]: 0,
      [TAB_CATEGORIES.CAN_CLOSE]: 0, 
      [TAB_CATEGORIES.SAVE_LATER]: 0, 
      [TAB_CATEGORIES.IMPORTANT]: 0 
    };

    tabs.forEach(tab => {
      if (categoryCounts[tab.category] !== undefined) {
        categoryCounts[tab.category]++;
      }
    });

    // Stats
    const stats = createElement('div', { className: CSS_CLASSES.GROUP_STATS });

    // Show counts with icons for each category
    if (categoryCounts[TAB_CATEGORIES.UNCATEGORIZED] > 0) {
      const uncategorizedStat = createElement('span', {
        className: 'stat-item uncategorized',
        innerHTML: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12" y2="17"></line></svg> ${categoryCounts[TAB_CATEGORIES.UNCATEGORIZED]}`
      });
      stats.appendChild(uncategorizedStat);
    }

    if (categoryCounts[TAB_CATEGORIES.IMPORTANT] > 0) {
      const importantStat = createElement('span', {
        className: 'stat-item important',
        innerHTML: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> ${categoryCounts[TAB_CATEGORIES.IMPORTANT]}`
      });
      stats.appendChild(importantStat);
    }

    if (categoryCounts[TAB_CATEGORIES.SAVE_LATER] > 0) {
      const saveForLaterStat = createElement('span', {
        className: 'stat-item somewhat',
        innerHTML: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg> ${categoryCounts[TAB_CATEGORIES.SAVE_LATER]}`
      });
      stats.appendChild(saveForLaterStat);
    }

    if (categoryCounts[TAB_CATEGORIES.CAN_CLOSE] > 0) {
      const canCloseStat = createElement('span', {
        className: 'stat-item not-important',
        innerHTML: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg> ${categoryCounts[TAB_CATEGORIES.CAN_CLOSE]}`
      });
      stats.appendChild(canCloseStat);
    }


    headerRight.appendChild(stats);

    // Group actions
    const groupActions = createElement('div', { className: 'group-actions' });

    // Add action buttons using strategy
    const actionButtons = strategy.createActionButtons(tabs, _groupName, groupingType);
    groupActions.appendChild(actionButtons);

    headerRight.appendChild(groupActions);
    header.appendChild(headerRight);
    
    return header;
  }

  /**
   * Add collapse/expand behavior with reset functionality
   * NOTE: Event handling is now done via delegation in event-handlers.js
   * This function only sets the cursor style for visual feedback
   */
  addCollapseExpandBehavior(section, header, _tabs, options) {
    // Only set cursor style - actual event handling is done via delegation in event-handlers.js
    header.style.cursor = 'pointer';
    
    // Store tab info as data attributes for the delegation handler
    const { groupId, type, sectionType, groupingType } = options;
    section.dataset.groupId = groupId;
    section.dataset.type = type;
    section.dataset.sectionType = sectionType;
    if (groupingType) {
      section.dataset.groupingType = groupingType;
    }
  }

  /**
   * Shared SVG icons for consistent formatting
   */
  static SVG_ICONS = {
    CLOSE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    OPEN: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>',
    DELETE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>'
  };

  /**
   * Shared button classes for consistent styling
   */
  static BUTTON_CLASSES = {
    CATEGORY_ACTION: 'icon-btn',           // Standard size for category actions (Open/Delete)
    GROUP_ACTION: 'icon-btn-small',       // Small size for group actions (Open/Delete)
    CATEGORY_CLOSE: 'category-close-btn', // Close button for category sections
    GROUP_CLOSE: 'group-close-btn'        // Close button for group sections
  };

  /**
   * Create a standardized action button
   * @param {Object} options - Button options
   * @param {string} options.className - CSS class name
   * @param {string} options.title - Button title/tooltip
   * @param {string} options.icon - SVG icon (use SVG_ICONS constants)
   * @param {Function} options.onClick - Click handler (no longer used - kept for compatibility)
   * @param {boolean} options.hasWarning - Whether to add warning styling
   * @returns {HTMLElement}
   */
  // eslint-disable-next-line no-unused-vars
  createActionButton({ className, title, icon, onClick: _onClick, hasWarning = false, action, data }) {
    const finalClassName = className + (hasWarning ? ' has-uncategorized' : '');
    
    const button = createElement('button', {
      className: finalClassName,
      title: title,
      innerHTML: icon
    });
    
    // Add data attributes for event delegation fallback
    if (action) {
      button.dataset.action = action;
    }
    if (data) {
      Object.entries(data).forEach(([key, value]) => {
        button.dataset[key] = typeof value === 'object' ? JSON.stringify(value) : value;
      });
    }
    
    return button;
  }

  /**
   * Register a rendering strategy
   * @param {string} type - Strategy type ('current' or 'saved')
   * @param {GroupRenderStrategy} strategy - Strategy instance
   */
  registerStrategy(type, strategy) {
    this.strategies.set(type, strategy);
  }

  /**
   * Get strategy for tab type
   * @param {string} type - Strategy type ('current' or 'saved')
   * @returns {GroupRenderStrategy}
   */
  getStrategy(type) {
    const strategy = this.strategies.get(type);
    if (!strategy) {
      throw new Error(`No strategy registered for type: ${type}`);
    }
    return strategy;
  }

  /**
   * Create a unified section (category or group) using the appropriate strategy
   * @param {Object} options - Section options
   * @param {number|string} options.groupId - Category number or group name
   * @param {Array} options.tabs - Tabs in this section
   * @param {string} options.type - Tab type ('current' or 'saved')
   * @param {string} options.sectionType - 'category' or 'group'
   * @param {string} [options.groupingType] - Type of grouping (for groups)
   * @returns {Promise<HTMLElement|null>}
   */
  async createSection({ groupId, tabs, type, sectionType, groupingType = null }) {
    // Check if we should show empty sections
    if (tabs.length === 0) {
      const strategy = this.getStrategy(type);
      if (!strategy.shouldShowEmptyGroups()) {
        return null;
      }
    }

    const strategy = this.getStrategy(type);
    const isCategory = sectionType === 'category';
    const category = isCategory ? groupId : null;
    const groupName = isCategory ? CATEGORY_NAMES[groupId] || `Category ${groupId}` : groupId;
    
    // Sort tabs if this is a group (categories don't need sorting)
    const sortedTabs = isCategory ? tabs : sortTabsInGroup(tabs, groupingType);

    // Create section element
    const sectionClass = isCategory ? CSS_CLASSES.CATEGORY_SECTION : CSS_CLASSES.GROUP_SECTION;
    
    // Check if we should hide this section immediately (empty during search)
    const hasActiveSearch = state.searchQuery && state.searchQuery.trim().length > 0;
    const shouldHideEmpty = tabs.length === 0 && hasActiveSearch;
    
    // Check if this group/category should be rendered collapsed
    const shouldBeCollapsed = shouldGroupBeCollapsed(
      isCategory ? category : groupName, 
      isCategory ? 'category' : 'group',
      type // Pass the context ('current' or 'saved')
    );
    
    // Build complete className with all modifiers
    let fullClassName = sectionClass;
    fullClassName += ' ' + strategy.getGroupModifierClasses(groupName, isCategory ? category : groupingType);
    if (shouldHideEmpty) {
      fullClassName += ' ' + CSS_CLASSES.GROUP_HIDDEN;
    }
    if (shouldBeCollapsed) {
      fullClassName += ' collapsed';
    }
    
    const section = createElement('div', {
      className: fullClassName,
      id: isCategory ? `${strategy.getGroupIdPrefix()}${category}` : undefined,
      dataset: isCategory ? { category: category } : undefined
    });

    // Create header
    const header = this.createSectionHeader({
      groupId,
      groupName,
      tabs: sortedTabs,
      sectionType,
      groupingType,
      strategy
    });

    section.appendChild(header);

    // Create expandable tabs list using common method
    const tabsList = await this.createExpandableTabsList(sortedTabs, isCategory ? category : groupingType, type);
    section.appendChild(tabsList);

    // Add collapse/expand functionality with reset
    this.addCollapseExpandBehavior(section, header, sortedTabs, { groupId, type, sectionType, groupingType });

    // Category-specific behaviors
    if (isCategory) {
      // Show/hide uncategorized section based on whether it has tabs
      if (category === TAB_CATEGORIES.UNCATEGORIZED) {
        const hasUncategorized = tabs.length > 0;
        section.style.display = hasUncategorized ? 'block' : 'none';
      }

      // Mark section as empty if no tabs
      if (tabs.length === 0) {
        classes.add(section, CSS_CLASSES.CATEGORY_EMPTY);
      } else {
        classes.remove(section, CSS_CLASSES.CATEGORY_EMPTY);
      }
    }

    return section;
  }

  /**
   * Create a category section (compatibility wrapper for unified createSection)
   * @param {number} category - Category number
   * @param {Array} tabs - Tabs in this category
   * @param {string} type - Tab type ('current' or 'saved')
   * @returns {Promise<HTMLElement|null>}
   */
  async createCategorySection(category, tabs, type) {
    return this.createSection({
      groupId: category,
      tabs,
      type,
      sectionType: 'category'
    });
  }

  /**
   * Create a group section (compatibility wrapper for unified createSection)
   * @param {string} groupName - Name of the group
   * @param {Array} tabs - Tabs in this group
   * @param {string} groupingType - Type of grouping
   * @param {string} type - Tab type ('current' or 'saved')
   * @returns {Promise<HTMLElement>}
   */
  async createGroupSection(groupName, tabs, groupingType, type) {
    return this.createSection({
      groupId: groupName,
      tabs,
      type,
      sectionType: 'group',
      groupingType
    });
  }

  /**
   * Get old-style category icon attributes (from original popup.html)
   * @param {number} category - Category number
   * @returns {Object} Icon attributes
   */
  getOldCategoryIconAttributes(category) {
    switch (category) {
      case TAB_CATEGORIES.IMPORTANT:
        return { fill: 'currentColor' };
      case TAB_CATEGORIES.SAVE_LATER:
      case TAB_CATEGORIES.CAN_CLOSE:
      case TAB_CATEGORIES.UNCATEGORIZED:
      default:
        return { 
          fill: 'none', 
          stroke: 'currentColor', 
          'stroke-width': '2', 
          'stroke-linecap': 'round', 
          'stroke-linejoin': 'round' 
        };
    }
  }

  /**
   * Get old-style category icon HTML (from original popup.html)
   * @param {number} category - Category number
   * @returns {string} Icon HTML (inner content only)
   */
  getOldCategoryIcon(category) {
    switch (category) {
      case TAB_CATEGORIES.IMPORTANT:
        return '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>';
      case TAB_CATEGORIES.SAVE_LATER:
        return '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>';
      case TAB_CATEGORIES.CAN_CLOSE:
        return '<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>';
      case TAB_CATEGORIES.UNCATEGORIZED:
        return '<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12" y2="17"></line>';
      default:
        return '<circle cx="12" cy="12" r="10"></circle>';
    }
  }

  /**
   * Get category modifier CSS class
   * @param {number} category - Category number
   * @returns {string} CSS class modifier
   */
  getCategoryModifierClass(category) {
    switch (category) {
      case TAB_CATEGORIES.IMPORTANT:
        return ' important';
      case TAB_CATEGORIES.SAVE_LATER:
        return ' somewhat-important';
      case TAB_CATEGORIES.CAN_CLOSE:
        return ' not-important';
      default:
        return '';
    }
  }

  /**
   * Get category icon HTML
   * @param {number} category - Category number
   * @returns {string} Icon HTML
   */
  getCategoryIcon(category) {
    switch (category) {
      case TAB_CATEGORIES.IMPORTANT:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>';
      case TAB_CATEGORIES.SAVE_LATER:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
      case TAB_CATEGORIES.CAN_CLOSE:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
      case TAB_CATEGORIES.UNCATEGORIZED:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6m11-5h-6m-6 0H1"></path></svg>';
      default:
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';
    }
  }
}

// Create and export a singleton instance
export const unifiedGroupRenderer = new UnifiedGroupRenderer();

// Auto-register strategies with lazy loading of tab operations
let currentStrategy = null;
let savedStrategy = null;

/**
 * Get or create current group strategy
 */
async function getCurrentGroupStrategy() {
  if (!currentStrategy) {
    const tabOperations = await import('./tab-operations.js');
    currentStrategy = new CurrentGroupRenderStrategy(tabOperations.default);
    unifiedGroupRenderer.registerStrategy('current', currentStrategy);
  }
  return currentStrategy;
}

/**
 * Get or create saved group strategy  
 */
async function getSavedGroupStrategy() {
  if (!savedStrategy) {
    const tabOperations = await import('./tab-operations.js');
    savedStrategy = new SavedGroupRenderStrategy(tabOperations.default);
    unifiedGroupRenderer.registerStrategy('saved', savedStrategy);
  }
  return savedStrategy;
}

/**
 * Initialize strategies
 */
export async function initializeGroupRenderer() {
  await getCurrentGroupStrategy();
  await getSavedGroupStrategy();
}

/**
 * Create category section - main entry point
 * @param {number} category - Category number
 * @param {Array} tabs - Tabs in this category
 * @param {boolean} isFromSaved - Whether this is for saved tabs
 * @returns {Promise<HTMLElement|null>}
 */
export async function createCategorySection(category, tabs, isFromSaved = false) {
  // Ensure strategies are initialized
  await initializeGroupRenderer();
  
  const type = isFromSaved ? 'saved' : 'current';
  return unifiedGroupRenderer.createCategorySection(category, tabs, type);
}

/**
 * Create group section - main entry point
 * @param {string} groupName - Name of the group
 * @param {Array} tabs - Tabs in this group
 * @param {string} groupingType - Type of grouping
 * @param {boolean} isFromSaved - Whether this is for saved tabs
 * @returns {Promise<HTMLElement>}
 */
export async function createGroupSection(groupName, tabs, groupingType, isFromSaved = false) {
  // Ensure strategies are initialized
  await initializeGroupRenderer();
  
  const type = isFromSaved ? 'saved' : 'current';
  return unifiedGroupRenderer.createGroupSection(groupName, tabs, groupingType, type);
}

// Export for testing and advanced usage
export { GroupRenderStrategy };