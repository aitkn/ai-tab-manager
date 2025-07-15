/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Unified Tab Renderer - handles tab rendering for both Current and Saved tabs
 */

import { TAB_CATEGORIES, CSS_CLASSES } from '../utils/constants.js';
import { createElement, classes } from '../utils/dom-helpers.js';
import { createOptimizedFavicon } from '../utils/favicon-loader.js';

/**
 * Tab Renderer Strategy Interface
 * Defines the contract for different tab rendering strategies
 */
class TabRenderStrategy {
  /**
   * Create action buttons for the tab
   * @param {Object} tab - Tab object
   * @param {number} category - Tab category
   * @returns {DocumentFragment|HTMLElement}
   */
  createActionButtons() {
    throw new Error('createActionButtons must be implemented by subclass');
  }

  /**
   * Handle tab click behavior
   * @param {Object} tab - Tab object
   * @returns {Promise<void>}
   */
  async handleTabClick() {
    throw new Error('handleTabClick must be implemented by subclass');
  }

  /**
   * Get supported grouping options for this tab type
   * @returns {Array<string>}
   */
  getSupportedGroupingOptions() {
    throw new Error('getSupportedGroupingOptions must be implemented by subclass');
  }

  /**
   * Get CSS class modifiers for tab element
   * @param {Object} tab - Tab object
   * @param {number} category - Tab category
   * @returns {string}
   */
  getTabModifierClasses() {
    return '';
  }
}

/**
 * Current Tabs Renderer Strategy
 * Handles rendering for live browser tabs
 */
export class CurrentTabRenderStrategy extends TabRenderStrategy {
  constructor(tabOperations) {
    super();
    this.tabOperations = tabOperations;
  }

  createActionButtons() {
    // Only close button for current tabs (category buttons moved to common area)
    const closeBtn = createElement('button', {
      className: 'close-btn',
      title: 'Close tab',
      innerHTML: '×',
    });

    return closeBtn;
  }


  async handleTabClick(tab) {
    // For active tabs, switch to the existing tab
    if (tab.windowId) {
      browser.windows.update(tab.windowId, { focused: true }, () => {
        browser.tabs.update(tab.id, { active: true });
        // Keep popup open
      });
    } else {
      browser.tabs.update(tab.id, { active: true });
      // Keep popup open
    }
  }

  getSupportedGroupingOptions() {
    return ['category', 'domain', 'subdomain'];
  }

  getTabModifierClasses(tab) {
    const classes = [];
    
    if (tab.alreadySaved) {
      classes.push(CSS_CLASSES.TAB_ALREADY_SAVED);
    }
    
    if (tab.alreadyCategorized || (tab.knownCategory && tab.knownCategory !== 0)) {
      classes.push('already-categorized');
    }
    
    return classes.join(' ');
  }
}

/**
 * Saved Tabs Renderer Strategy
 * Handles rendering for saved tabs from database
 */
export class SavedTabRenderStrategy extends TabRenderStrategy {
  constructor(tabOperations) {
    super();
    this.tabOperations = tabOperations;
  }

  createActionButtons() {
    // Delete button for saved tabs
    const deleteBtn = createElement('button', {
      className: 'delete-btn',
      title: 'Delete saved tab',
      innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>'
    });

    return deleteBtn;
  }

  async handleTabClick(tab) {
    // For saved tabs, open in a different window to keep popup open
    try {
      // Get all windows
      const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
      const currentWindow = await browser.windows.getCurrent();
      
      // Find a window that's not the current one
      const otherWindow = windows.find(w => w.id !== currentWindow.id);
      
      if (otherWindow) {
        // Open in the other window
        await browser.tabs.create({ 
          url: tab.url,
          active: true,
          windowId: otherWindow.id
        });
        // Focus that window
        await browser.windows.update(otherWindow.id, { focused: true });
      } else {
        // No other window, create a new one
        await browser.windows.create({
          url: tab.url,
          focused: true
        });
      }
      // Popup stays open
    } catch (error) {
      console.error('Error opening saved tab:', error);
    }
  }

  getSupportedGroupingOptions() {
    return ['category', 'domain', 'savedDate', 'savedWeek', 'savedMonth', 'closeTime'];
  }

  getTabModifierClasses(tab) {
    const classes = [];
    
    // Add any saved tab specific classes
    if (tab.lastCloseTime) {
      classes.push('has-close-time');
    }
    
    return classes.join(' ');
  }
}

/**
 * Unified Tab Renderer
 * Main class that renders tabs using different strategies
 */
export class UnifiedTabRenderer {
  constructor() {
    this.strategies = new Map();
  }

  /**
   * Register a rendering strategy
   * @param {string} type - Strategy type ('current' or 'saved')
   * @param {TabRenderStrategy} strategy - Strategy instance
   */
  registerStrategy(type, strategy) {
    this.strategies.set(type, strategy);
  }

  /**
   * Get strategy for tab type
   * @param {string} type - Strategy type ('current' or 'saved')
   * @returns {TabRenderStrategy}
   */
  getStrategy(type) {
    const strategy = this.strategies.get(type);
    if (!strategy) {
      throw new Error(`No strategy registered for type: ${type}`);
    }
    return strategy;
  }

  /**
   * Create a tab element using the appropriate strategy
   * @param {Object} tab - Tab object
   * @param {number} category - Tab category
   * @param {string} type - Tab type ('current' or 'saved')
   * @returns {HTMLElement}
   */
  createTabElement(tab, category, type) {
    const strategy = this.getStrategy(type);
    
    // Create base tab element
    const tabElement = createElement('div', {
      className: this.buildTabClasses(category, strategy.getTabModifierClasses(tab)),
      dataset: { 
        tabId: tab.id,
        category: category,
        tabType: type
      }
    });

    // Add favicon
    const favicon = createOptimizedFavicon(tab);
    tabElement.appendChild(favicon);

    // ML confidence indicator removed - not requested

    // Create tab info section
    const tabInfo = this.createTabInfo(tab);
    tabElement.appendChild(tabInfo);

    // Create action buttons container
    const actionButtonsContainer = createElement('div', { className: 'tab-actions' });
    
    // Add category selection buttons (common for both Current and Saved)
    const categoryButtons = this.createCategoryButtons(tab, category);
    actionButtonsContainer.appendChild(categoryButtons);
    
    // Add strategy-specific action buttons
    const strategyButtons = strategy.createActionButtons();
    actionButtonsContainer.appendChild(strategyButtons);
    
    tabElement.appendChild(actionButtonsContainer);

    return tabElement;
  }

  /**
   * Build CSS classes for tab element
   * @param {number} category - Tab category
   * @param {string} modifierClasses - Additional modifier classes
   * @returns {string}
   */
  buildTabClasses(category, modifierClasses = '') {
    let classes = CSS_CLASSES.TAB_ITEM;
    
    // Add category-specific class
    if (category === TAB_CATEGORIES.UNCATEGORIZED) {
      classes += ' category-uncategorized';
    } else if (category === TAB_CATEGORIES.IMPORTANT) {
      classes += ' category-important';
    } else if (category === TAB_CATEGORIES.SAVE_LATER) {
      classes += ' category-save-later';
    } else if (category === TAB_CATEGORIES.CAN_CLOSE) {
      classes += ' category-can-close';
    }

    // Add modifier classes
    if (modifierClasses) {
      classes += ' ' + modifierClasses;
    }

    return classes;
  }

  /**
   * Add ML confidence indicator if available
   * @param {HTMLElement} tabElement - Tab element
   * @param {Object} tab - Tab object
   */
  addMLConfidenceIndicator(tabElement, tab) {
    if (tab.mlMetadata && tab.mlMetadata.confidence !== undefined) {
      const confidence = Math.round(tab.mlMetadata.confidence * 100);
      const confidenceLevel = confidence >= 80 ? 'high' : confidence >= 60 ? 'medium' : 'low';
      const source = tab.mlMetadata.source || 'unknown';
      
      const confidenceIndicator = createElement('div', {
        className: `ml-confidence ml-confidence-${confidenceLevel}`,
        title: `${confidence}% confidence (${source})`,
        innerHTML: `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="${10 * tab.mlMetadata.confidence}" opacity="${0.3 + 0.7 * tab.mlMetadata.confidence}"/>
          </svg>
          <span class="confidence-text">${confidence}%</span>
        `
      });
      tabElement.appendChild(confidenceIndicator);
    }
  }

  /**
   * Create tab info section (title and URL)
   * @param {Object} tab - Tab object
   * @param {TabRenderStrategy} strategy - Rendering strategy
   * @returns {HTMLElement}
   */
  createTabInfo(tab) {
    const tabInfo = createElement('div', {
      className: 'tab-info'
    });

    // Title with duplicate count if applicable
    let titleText = tab.title || 'Untitled';
    if (tab.duplicateCount && tab.duplicateCount > 1) {
      titleText += ` ( ${tab.duplicateCount} )`;
    }
    
    const tabTitle = createElement('div', {
      className: 'tab-title',
      textContent: titleText,
      title: titleText
    });
    tabInfo.appendChild(tabTitle);
    
    const tabUrl = createElement('div', {
      className: 'tab-url',
      textContent: tab.url,
      title: tab.url
    });
    
    // Add class for matched URLs
    // For current tabs: check if already saved
    // For saved tabs: check if currently open
    if (tab.alreadySaved || tab.knownCategory !== undefined || tab.isCurrentlyOpen) {
      classes.add(tabUrl, 'tab-url-matched');
    }
    
    tabInfo.appendChild(tabUrl);

    return tabInfo;
  }

  /**
   * Create category selection buttons (common for both Current and Saved tabs)
   * @param {Object} tab - Tab object
   * @param {number} category - Current category
   * @param {string} type - Tab type ('current' or 'saved')
   * @returns {HTMLElement}
   */
  createCategoryButtons(tab, category) {
    const categoryButtons = createElement('div', { className: 'category-buttons' });
    
    // Important category button
    const importantBtn = createElement('button', {
      className: 'category-btn category-important',
      disabled: category === TAB_CATEGORIES.IMPORTANT,
      title: 'Mark as Important',
      innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>'
    });
    categoryButtons.appendChild(importantBtn);
    
    // Save Later category button
    const saveLaterBtn = createElement('button', {
      className: 'category-btn category-save-later',
      disabled: category === TAB_CATEGORIES.SAVE_LATER,
      title: 'Mark as Useful',
      innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>'
    });
    categoryButtons.appendChild(saveLaterBtn);
    
    // Can Close category button
    const canCloseBtn = createElement('button', {
      className: 'category-btn category-can-close',
      disabled: category === TAB_CATEGORIES.CAN_CLOSE,
      title: 'Mark as Ignore',
      innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    });
    categoryButtons.appendChild(canCloseBtn);

    return categoryButtons;
  }

  /**
   * Change category for a tab (handles both Current and Saved tabs)
   * @param {Object} tab - Tab object
   * @param {number} oldCategory - Current category
   * @param {number} newCategory - New category
   * @param {string} type - Tab type ('current' or 'saved')
   */
  async changeCategoryForTab(tab, oldCategory, newCategory, type) {
    try {
      // Use moveTabToCategory for both Current and Saved tabs
      // This ensures consistent functionality including ML learning, database updates, and state management
      const { moveTabToCategory } = await import('./categorization-service.js');
      await moveTabToCategory(tab, oldCategory, newCategory, type);
    } catch (error) {
      console.error('Error changing tab category:', error);
    }
  }

  /**
   * Get supported grouping options for a tab type
   * @param {string} type - Tab type ('current' or 'saved')
   * @returns {Array<string>}
   */
  getSupportedGroupingOptions(type) {
    const strategy = this.getStrategy(type);
    return strategy.getSupportedGroupingOptions();
  }
}

// Create and export a singleton instance
export const unifiedTabRenderer = new UnifiedTabRenderer();

// Auto-register strategies with lazy loading of tab operations
let currentStrategy = null;
let savedStrategy = null;

/**
 * Get or create current tab strategy
 */
async function getCurrentStrategy() {
  if (!currentStrategy) {
    const tabOperations = await import('./tab-operations.js');
    currentStrategy = new CurrentTabRenderStrategy(tabOperations.default);
    unifiedTabRenderer.registerStrategy('current', currentStrategy);
  }
  return currentStrategy;
}

/**
 * Get or create saved tab strategy  
 */
async function getSavedStrategy() {
  if (!savedStrategy) {
    const tabOperations = await import('./tab-operations.js');
    savedStrategy = new SavedTabRenderStrategy(tabOperations.default);
    unifiedTabRenderer.registerStrategy('saved', savedStrategy);
  }
  return savedStrategy;
}

/**
 * Initialize strategies
 */
export async function initializeTabRenderer() {
  await getCurrentStrategy();
  await getSavedStrategy();
}

/**
 * Create tab element - main entry point
 * @param {Object} tab - Tab object
 * @param {number} category - Tab category
 * @param {boolean} isFromSaved - Whether this is a saved tab
 * @returns {Promise<HTMLElement>}
 */
export async function createTabElement(tab, category, isFromSaved = false) {
  // Ensure strategies are initialized
  await initializeTabRenderer();
  
  const type = isFromSaved ? 'saved' : 'current';
  return unifiedTabRenderer.createTabElement(tab, category, type);
}

// Export for testing and advanced usage
export { TabRenderStrategy };