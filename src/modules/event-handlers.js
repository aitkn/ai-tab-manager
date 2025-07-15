/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Event Handlers - all UI event handler functions
 */

import { DOM_IDS, EVENTS, TAB_CATEGORIES, LIMITS } from '../utils/constants.js';
import { $id, on, createElement } from '../utils/dom-helpers.js';
import { state, updateState, savePopupState, debouncedSaveState, saveGroupCollapseStates, setGlobalCollapseStatus } from './state-manager.js';
import stateManager from './state-manager.js';
import { switchToTab, setTheme, showStatus } from './ui-manager.js';
import StorageService from '../services/StorageService.js';
import ChromeAPIService from '../services/ChromeAPIService.js';
import { onGroupingChange as handleGroupingChange, toggleAllGroups } from './ui-utilities.js';
import { handleCSVImport } from './import-export.js';
import { updateModelDropdown } from './settings-manager.js';
import { updateCurrentTabContent, updateSavedTabContent } from './content-manager.js';
import logger from '../utils/logger.js';

// Flicker-free UI system removed - using simple approach

/**
 * Set up all event listeners
 */
export function setupEventListeners() {
  // Main action buttons
  // NOTE: CATEGORIZE_BTN and SAVE_AND_CLOSE_ALL_BTN now handled by unified toolbar
  // on($id(DOM_IDS.CATEGORIZE_BTN), EVENTS.CLICK, handleCategorize);
  // on($id(DOM_IDS.SAVE_AND_CLOSE_ALL_BTN), EVENTS.CLICK, () => closeAllTabs());
  // NOTE: SAVE_API_KEY_BTN now handled by settings-manager.js to avoid duplicate handlers
  on($id(DOM_IDS.OPEN_SETTINGS_BTN), EVENTS.CLICK, () => switchToTab('settings'));
  
  // Settings controls
  on($id(DOM_IDS.PROVIDER_SELECT), EVENTS.CHANGE, onProviderChange);
  on($id(DOM_IDS.MODEL_SELECT), EVENTS.CHANGE, onModelChange);
  on($id(DOM_IDS.PROMPT_TEXTAREA), EVENTS.INPUT, onPromptChange);
  on($id(DOM_IDS.RESET_PROMPT_BTN), EVENTS.CLICK, resetPrompt);
  on($id(DOM_IDS.MAX_TABS_INPUT), EVENTS.CHANGE, onMaxTabsChange);
  
  // LLM checkbox
  const useLLMCheckbox = $id('useLLMCheckbox');
  if (useLLMCheckbox) {
    on(useLLMCheckbox, EVENTS.CHANGE, onUseLLMChange);
  }
  
  // Search controls - now handled by unified toolbar
  // on($id(DOM_IDS.SEARCH_INPUT), EVENTS.INPUT, onSearchInput);
  // on($id(DOM_IDS.CLEAR_SEARCH_BTN), EVENTS.CLICK, clearSearch);
  
  // Saved tab controls - now handled by unified toolbar
  // const savedGroupingSelect = $id(DOM_IDS.SAVED_GROUPING_SELECT);
  // const savedSearchInput = $id(DOM_IDS.SAVED_SEARCH_INPUT);
  // const clearSavedSearchBtn = $id(DOM_IDS.CLEAR_SAVED_SEARCH_BTN);
  
  // Export/Import buttons - now handled by unified toolbar
  // on($id(DOM_IDS.EXPORT_CSV_BTN), EVENTS.CLICK, exportToCSV);
  // on($id(DOM_IDS.IMPORT_CSV_BTN), EVENTS.CLICK, () => {
  //   $id(DOM_IDS.CSV_FILE_INPUT).click();
  // });
  on($id(DOM_IDS.CSV_FILE_INPUT), EVENTS.CHANGE, handleCSVImport);
  
  // Show All Categories checkbox - now handled by unified toolbar
  // const showAllCheckbox = $id('showAllCategoriesCheckbox');
  // if (showAllCheckbox) {
  //   on(showAllCheckbox, EVENTS.CHANGE, handleShowAllCategoriesChange);
  // }
  
  // Refresh sessions button
  const refreshSessionsBtn = $id('refreshSessionsBtn');
  if (refreshSessionsBtn) {
    on(refreshSessionsBtn, EVENTS.CLICK, async () => {
      const { displayRecentSessions } = await import('./saved-tabs-manager.js');
      await displayRecentSessions();
      // Table updates show the refresh - no message needed
    });
  }
  
  // Grouping controls
  on($id(DOM_IDS.GROUPING_SELECT), EVENTS.CHANGE, handleGroupingChange);
  on($id(DOM_IDS.TOGGLE_ALL_GROUPS_BTN), EVENTS.CLICK, toggleAllGroups);
  on($id(DOM_IDS.TOGGLE_CATEGORIZE_GROUPS_BTN), EVENTS.CLICK, toggleAllGroups);
  
  // Theme buttons
  document.querySelectorAll('.theme-btn').forEach(btn => {
    on(btn, EVENTS.CLICK, () => setTheme(btn.dataset.theme));
  });
  
  // Tab navigation - simple direct approach
  document.querySelectorAll('.tab-btn').forEach(btn => {
    on(btn, EVENTS.CLICK, async () => {
      const tabName = btn.dataset.tab;
      
      
      // Use simple tab switching with content manager
      switchToTab(tabName);
      
      // Ensure content is refreshed for the new tab
      if (tabName === 'saved') {
        await updateSavedTabContent();
      } else if (tabName === 'categorize') {
        await updateCurrentTabContent();
      } else if (tabName === 'settings') {
        // Refresh ML dashboard when switching to settings
        try {
          const { updateMLStatus } = await import('./ml-dashboard.js');
          await updateMLStatus();
          
          // Initialize charts when Settings tab is first accessed
          const { getTrainingCharts } = await import('./training-charts.js');
          const charts = getTrainingCharts();
          
          // Check if charts are already initialized
          if (!charts.lossChartFull) {
            // Charts not initialized, initialize now while Settings tab is visible
            setTimeout(async () => {
              await charts.initialize();
            }, 50);
          } else {
            // Charts already exist, just refresh layout
            setTimeout(() => {
              charts.reinitializeChartsIfNeeded();
            }, 50);
          }
          
        } catch (err) {
          logger.mlTraining('ML dashboard refresh skipped:', err.message);
        }
      }
    });
  });
  
  // Event delegation for group/category header clicks (collapse/expand)
  // Use bubbling phase (default) to allow button onclick handlers to execute first
  on(document, 'click', async (e) => {
    const header = e.target.closest('.group-header, .category-header');
    if (!header) return;
    
    // Check if this is a button or action area click - don't collapse
    const isButton = e.target.closest('button');
    const actionSelector = header.classList.contains('category-header') ? '.category-header-actions' : '.group-actions';
    const isActionArea = e.target.closest(actionSelector);
    
    if (isButton || isActionArea) {
      // Don't prevent default or stop propagation - let the button handle its own event
      return;
    }
    
    const section = header.closest('.group-section, .category-section');
    if (!section) return;
    
    // Determine collapse class based on section type
    const collapseClass = 'collapsed'; // Both use the same 'collapsed' class
    
    const isCurrentlyCollapsed = section.classList.contains(collapseClass);
    
    // Create target section with toggled state for morphdom
    const targetSection = section.cloneNode(true);
    
    if (isCurrentlyCollapsed) {
      targetSection.classList.remove(collapseClass);
      
      // If expanding a large group, handle the expandable tabs list
      const tabsList = targetSection.querySelector('.tabs-list');
      const showMoreBtn = targetSection.querySelector('.show-more-btn');
      
      if (tabsList && showMoreBtn) {
        // Reset to collapsed view when expanding the group
        const allTabs = tabsList.querySelectorAll('.tab-item');
        const hiddenTabs = Array.from(allTabs).slice(15);
        
        // Hide extra tabs in the target
        hiddenTabs.forEach(tab => tab.style.display = 'none');
        
        // Update show more button in the target
        if (hiddenTabs.length > 0) {
          showMoreBtn.style.display = 'block';
          showMoreBtn.textContent = `Show ${hiddenTabs.length} more...`;
        } else {
          showMoreBtn.style.display = 'none';
        }
        
      }
    } else {
      targetSection.classList.add(collapseClass);
    }
    
    // Use morphdom for smooth transition if available
    if (window.morphdom) {
      logger.uiEvents('Toggling group collapse/expand via morphdom');
      
      // Apply morphdom transition
      window.morphdom(section, targetSection, {
        onBeforeElUpdated: function(fromEl, toEl) {
          // Preserve form states and other dynamic properties
          if (fromEl.tagName === 'INPUT' || fromEl.tagName === 'SELECT' || fromEl.tagName === 'TEXTAREA') {
            toEl.value = fromEl.value;
            if ('checked' in fromEl) {
              toEl.checked = fromEl.checked;
            }
          }
          return true;
        }
      });
    } else {
      // Fallback to direct class toggle
      section.classList.toggle(collapseClass);
      
      // Handle expandable tabs list for fallback
      if (isCurrentlyCollapsed && !section.classList.contains(collapseClass)) {
        const tabsList = section.querySelector('.tabs-list');
        const showMoreBtn = section.querySelector('.show-more-btn');
        
        if (tabsList && showMoreBtn) {
          const allTabs = tabsList.querySelectorAll('.tab-item');
          const hiddenTabs = Array.from(allTabs).slice(15);
          
          hiddenTabs.forEach(tab => tab.style.display = 'none');
          
          if (hiddenTabs.length > 0) {
            showMoreBtn.style.display = 'block';
            showMoreBtn.textContent = `Show ${hiddenTabs.length} more...`;
          }
        }
      }
    }
    
    // Reset global collapse status to 'undefined' when user manually toggles
    const context = state.popupState.activeTab === 'saved' ? 'saved' : 'categorize';
    setGlobalCollapseStatus('undefined', context);
    
    // Save the new collapse states immediately after manual collapse/expand
    saveGroupCollapseStates();
    
    // Update toggle button icon based on current state
    const { updateToggleButtonIcon } = await import('./ui-utilities.js');
    updateToggleButtonIcon();
  });
  
  // Event delegation for "Show more" button clicks (legacy class name)
  on(document, 'click', (e) => {
    const showMoreBtn = e.target.closest('.show-more-btn');
    if (!showMoreBtn) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const tabsList = showMoreBtn.closest('.tabs-list, .category-section').querySelector('.tabs-list');
    if (!tabsList) return;
    
    const hiddenTabs = tabsList.querySelectorAll('.tab-item[style*="display: none"]');
    
    if (hiddenTabs.length > 0) {
      // Show all hidden tabs
      hiddenTabs.forEach(tab => tab.style.display = '');
      showMoreBtn.style.display = 'none';
    }
  });

  // Moved inside setupEventListeners

  // Event delegation for tab category buttons
  on(document, 'click', async (e) => {
    const categoryBtn = e.target.closest('.category-btn');
    if (!categoryBtn) return;
    
    e.stopPropagation();
    
    // Get the tab item and its data
    const tabItem = categoryBtn.closest('.tab-item');
    if (!tabItem) return;
    
    const tabId = tabItem.dataset.tabId;
    const currentCategory = parseInt(tabItem.dataset.category);
    const tabType = tabItem.dataset.tabType || 'current';
    
    // Determine target category based on button class
    let targetCategory;
    if (categoryBtn.classList.contains('category-important')) {
      targetCategory = TAB_CATEGORIES.IMPORTANT;
    } else if (categoryBtn.classList.contains('category-save-later')) {
      targetCategory = TAB_CATEGORIES.SAVE_LATER;
    } else if (categoryBtn.classList.contains('category-can-close')) {
      targetCategory = TAB_CATEGORIES.CAN_CLOSE;
    }
    
    // Don't do anything if button is disabled or same category
    if (categoryBtn.disabled || targetCategory === currentCategory) {
      return;
    }
    
    
    try {
      // Find the tab data
      let tab;
      if (tabType === 'current') {
        // Search in current tabs - convert tabId to number for comparison
        const numericTabId = parseInt(tabId);
        const { getCurrentTabs } = await import('./tab-data-source.js');
        const { categorizedTabs } = await getCurrentTabs();
        
        for (const cats of Object.values(categorizedTabs || {})) {
          tab = cats.find(t => t.id === numericTabId);
          if (tab) break;
        }
      } else {
        // Search in saved tabs - saved tabs use string IDs
        const { getSavedTabs } = await import('./tab-data-source.js');
        const savedTabs = await getSavedTabs();
        // getSavedTabs returns an array, not categorized object
        // Saved tabs have numeric IDs in the database, convert tabId to number
        const numericId = parseInt(tabId);
        tab = savedTabs.find(t => t.id === numericId);
        
        if (!tab) {
          // Try string comparison as fallback
          tab = savedTabs.find(t => t.id === tabId);
        }
      }
      
      if (!tab) {
        logger.error('Tab not found:', tabId);
        return;
      }
      
      // Import and call moveTabToCategory
      const { moveTabToCategory } = await import('./categorization-service.js');
      await moveTabToCategory(tab, currentCategory, targetCategory, tabType);
    } catch (error) {
      logger.error('Error changing tab category:', error);
    }
  });

  // Event delegation for close buttons
  on(document, 'click', async (e) => {
    const closeBtn = e.target.closest('.close-btn');
    if (!closeBtn) return;
    
    e.stopPropagation();
    
    const tabItem = closeBtn.closest('.tab-item');
    if (!tabItem) return;
    
    const tabId = parseInt(tabItem.dataset.tabId);
    const category = parseInt(tabItem.dataset.category);
    
    logger.uiEvents('Closing tab via close button:', { tabId, category });
    
    try {
      // Find the tab
      let tab;
      const { getCurrentTabs } = await import('./tab-data-source.js');
      const { categorizedTabs } = await getCurrentTabs();
      
      for (const cats of Object.values(categorizedTabs || {})) {
        tab = cats.find(t => t.id === tabId);
        if (tab) break;
      }
      
      if (tab) {
        const tabOps = await import('./tab-operations.js');
        await tabOps.default.closeTab(tab, category);
      }
    } catch (error) {
      logger.error('Error closing tab:', error);
    }
  });



  // Event delegation for saved tab group/category action buttons
  on(document, 'click', async (e) => {
    // Handle Open All buttons in saved tabs
    const button = e.target.closest('button');
    if (!button) return;
    
    // Check if this is in saved content
    const savedContent = button.closest('#savedContent, #savedTab');
    if (!savedContent) {
      return;
    }
    
    // Check if it's in a group or category action area
    const groupActions = button.closest('.group-actions, .category-header-actions');
    if (!groupActions) {
      return;
    }
    
    e.stopPropagation();
    
    // Determine action based on button class - check delete first
    const isDelete = button.classList.contains('delete-btn');
    const isOpenAll = !isDelete && (button.classList.contains('icon-btn') || button.classList.contains('icon-btn-small'));
    
    if (!isDelete && !isOpenAll) return;
    
    // Get the section to find tabs
    const section = button.closest('.group-section, .category-section');
    if (!section) return;
    
    const tabs = [];
    
    // For delete and open all operations in saved tabs, get ALL tabs (including hidden ones)
    const tabsList = section.querySelector('.tabs-list');
    if ((isDelete || isOpenAll) && savedContent) {
      // For delete/open all in saved tabs, we MUST have the stored data
      if (!tabsList || !tabsList.dataset.visibleTabsData) {
        logger.error('ERROR: Missing tabs data for delete/open all operation in saved tabs');
        return;
      }
      
      // Get all tabs from the stored data (includes tabs hidden behind "Show more")
      try {
        const allTabsData = JSON.parse(tabsList.dataset.visibleTabsData);
        if (window.tabDatabase && window.tabDatabase.cache.initialized) {
          allTabsData.forEach(tabData => {
            const tab = window.tabDatabase.cache.urlsById.get(tabData.id);
            if (tab) tabs.push(tab);
          });
        }
      } catch (e) {
        logger.error('ERROR: Failed to parse tabs data for delete/open all:', e);
        return;
      }
    } else {
      // For other operations or current tabs, use visible tabs only
      const tabElements = section.querySelectorAll('.tab-item');
      if (window.tabDatabase && window.tabDatabase.cache.initialized) {
        tabElements.forEach(tabEl => {
          const tabId = parseInt(tabEl.dataset.tabId);
          const tab = window.tabDatabase.cache.urlsById.get(tabId);
          if (tab) tabs.push(tab);
        });
      }
    }
    
    if (tabs.length === 0) return;
    
    try {
      const tabOps = await import('./tab-operations.js');
      
      if (isOpenAll) {
        await tabOps.default.openSavedTabs(tabs);
      } else if (isDelete) {
        // Get group or category name for confirmation
        const header = section.querySelector('.group-header, .category-header');
        const isCategory = section.classList.contains('category-section');
        let name = 'these tabs';
        
        if (isCategory) {
          const categoryName = header.querySelector('.category-name');
          name = categoryName ? categoryName.textContent : 'this category';
        } else {
          const groupTitle = header.querySelector('.group-title span');
          name = groupTitle ? groupTitle.textContent : 'this group';
        }
        
        await tabOps.default.deleteTabsInGroup(tabs, name);
      }
    } catch (error) {
      logger.error('Error executing saved tab action:', error);
    }
  });

  // Event delegation for close buttons (current tab groups/categories)
  on(document, 'click', async (e) => {
    const closeBtn = e.target.closest('.category-close-btn, .group-close-btn');
    if (!closeBtn) return;
    
    e.stopPropagation();
    
    // Get the section to find tabs
    const section = closeBtn.closest('.group-section, .category-section');
    if (!section) return;
    
    // Get all tabs in this section
    const tabElements = section.querySelectorAll('.tab-item');
    const tabs = [];
    
    // For current tabs, we need to collect tab IDs differently
    tabElements.forEach(tabEl => {
      const tabId = parseInt(tabEl.dataset.tabId);
      if (tabId) {
        tabs.push({ id: tabId });
      }
    });
    
    if (tabs.length === 0) return;
    
    try {
      const tabOps = await import('./tab-operations.js');
      
      // Check if this is a category or group
      const isCategory = section.classList.contains('category-section');
      
      // Check if there are any unsaved tabs
      const unsavedTabElements = Array.from(tabElements).filter(tabEl => {
        const categoryClass = Array.from(tabEl.classList).find(c => c.startsWith('category-'));
        return categoryClass === 'category-uncategorized';
      });
      
      const savedTabElements = Array.from(tabElements).filter(tabEl => {
        const categoryClass = Array.from(tabEl.classList).find(c => c.startsWith('category-'));
        return categoryClass !== 'category-uncategorized';
      });
      
      const hasUnsavedTabs = unsavedTabElements.length > 0;
      const hasSavedTabs = savedTabElements.length > 0;
      
      if (hasUnsavedTabs) {
        // Choose the appropriate dialog
        const dialogId = hasSavedTabs ? 'closeAllDialog' : 'closeUnsavedDialog';
        const dialog = document.getElementById(dialogId);
        
        return new Promise((resolve) => {
          // Set up button handlers
          const handleDialogClick = (e) => {
            const action = e.target.dataset.action;
            if (!action) return;
            
            dialog.close();
            
            // Remove event listeners
            dialog.removeEventListener('click', handleDialogClick);
            
            switch (action) {
              case 'saved-only': {
                // Filter out uncategorized tabs (only available in mixed dialog)
                const savedTabs = [];
                savedTabElements.forEach(tabEl => {
                  const tabId = parseInt(tabEl.dataset.tabId);
                  if (tabId) {
                    savedTabs.push({ id: tabId });
                  }
                });
                if (savedTabs.length > 0) {
                  tabOps.closeTabsInGroup(savedTabs).then(resolve);
                } else {
                  resolve();
                }
                break;
              }
              case 'all-tabs':
              case 'close':
                // Close all tabs including unsaved
                if (isCategory) {
                  const categoryId = parseInt(section.dataset.category);
                  if (categoryId !== undefined && categoryId !== null) {
                    tabOps.closeAllInCategory(categoryId).then(resolve);
                  }
                } else {
                  tabOps.closeTabsInGroup(tabs).then(resolve);
                }
                break;
              case 'cancel':
                // Do nothing
                resolve();
                break;
            }
          };
          
          dialog.addEventListener('click', handleDialogClick);
          dialog.showModal();
        });
      } else {
        // No unsaved tabs, proceed normally
        if (isCategory) {
          const categoryId = parseInt(section.dataset.category);
          if (categoryId !== undefined && categoryId !== null) {
            await tabOps.closeAllInCategory(categoryId);
          }
        } else {
          await tabOps.closeTabsInGroup(tabs);
        }
      }
    } catch (error) {
      logger.error('Error executing close action:', error);
    }
  });

  // Event delegation for delete buttons (saved tabs) - ONLY for individual tab delete buttons
  on(document, 'click', async (e) => {
    const deleteBtn = e.target.closest('.delete-btn');
    if (!deleteBtn) return;
    
    // Check if this is a group/category delete button - skip if so
    const groupActions = deleteBtn.closest('.group-actions, .category-header-actions');
    if (groupActions) {
      // Don't handle group/category delete buttons here - they have their own onclick handlers
      return;
    }
    
    e.stopPropagation();
    
    // This is a tab-level delete button
    const tabItem = deleteBtn.closest('.tab-item');
    if (!tabItem) return;
    
    const tabId = parseInt(tabItem.dataset.tabId);
    
    try {
      const tabOps = await import('./tab-operations.js');
      await tabOps.default.deleteSavedTab(tabId);
    } catch (error) {
      logger.error('Error deleting tab:', error);
    }
  });

  // Event delegation for "Assign to Category" button in group headers
  on(document, 'click', async (e) => {
    const assignBtn = e.target.closest('.assign-category-btn');
    if (!assignBtn || assignBtn.dataset.action !== 'assignUncategorizedInGroup') return;
    
    e.stopPropagation();
    e.preventDefault();
    
    const groupName = assignBtn.dataset.groupName;
    const uncategorizedCount = parseInt(assignBtn.dataset.uncategorizedCount);
    
    // Create dropdown menu
    const dropdown = createElement('div', {
      className: 'category-dropdown-menu',
      style: 'position: absolute; z-index: 1000; background: var(--md-sys-color-surface); border: 1px solid var(--md-sys-color-outline); border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); padding: 8px 0;'
    });
    
    // Add category options
    const categories = [
      { id: TAB_CATEGORIES.IMPORTANT, name: 'Important', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' },
      { id: TAB_CATEGORIES.SAVE_LATER, name: 'Useful', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>' },
      { id: TAB_CATEGORIES.CAN_CLOSE, name: 'Ignore', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>' }
    ];
    
    categories.forEach(cat => {
      const option = createElement('div', {
        className: 'category-dropdown-option',
        innerHTML: `${cat.icon} <span>${cat.name}</span>`,
        style: 'display: flex; align-items: center; gap: 8px; padding: 8px 16px; cursor: pointer; transition: background 0.2s;'
      });
      
      option.addEventListener('mouseenter', () => {
        option.style.background = 'var(--md-sys-color-surface-variant)';
      });
      
      option.addEventListener('mouseleave', () => {
        option.style.background = '';
      });
      
      option.addEventListener('click', async () => {
        // Remove dropdown
        dropdown.remove();
        
        try {
          // Get all uncategorized tabs in this group
          const section = assignBtn.closest('.group-section');
          const tabElements = section.querySelectorAll('.tab-item.category-uncategorized');
          const { moveTabToCategory } = await import('./categorization-service.js');
          
          // Move each uncategorized tab to the selected category
          let movedCount = 0;
          for (const tabEl of tabElements) {
            const tabId = parseInt(tabEl.dataset.tabId);
            
            // Find the tab data
            const { getCurrentTabs } = await import('./tab-data-source.js');
            const { categorizedTabs } = await getCurrentTabs();
            
            let tab;
            for (const cats of Object.values(categorizedTabs || {})) {
              tab = cats.find(t => t.id === tabId);
              if (tab) break;
            }
            
            if (tab && tab.category === TAB_CATEGORIES.UNCATEGORIZED) {
              await moveTabToCategory(tab, TAB_CATEGORIES.UNCATEGORIZED, cat.id, 'current', true);
              movedCount++;
            }
          }
          
          if (movedCount > 0) {
            showStatus(`Assigned ${movedCount} tabs to ${cat.name}`, 'success');
          }
        } catch (error) {
          logger.error('Error assigning tabs to category:', error);
          showStatus('Error assigning tabs', 'error');
        }
      });
      
      dropdown.appendChild(option);
    });
    
    // Position dropdown below the button
    const rect = assignBtn.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;
    
    // Add to body
    document.body.appendChild(dropdown);
    
    // Close dropdown when clicking outside
    const closeDropdown = (e) => {
      if (!dropdown.contains(e.target) && !assignBtn.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    };
    
    // Delay adding the listener to avoid immediate closure
    setTimeout(() => {
      document.addEventListener('click', closeDropdown);
    }, 0);
  });

  // Event delegation for "Assign All Uncategorized" buttons in category header
  on(document, 'click', async (e) => {
    const assignBtn = e.target.closest('.category-btn');
    if (!assignBtn || assignBtn.dataset.action !== 'assignAllUncategorized') return;
    
    e.stopPropagation();
    e.preventDefault();
    
    const targetCategory = parseInt(assignBtn.dataset.targetCategory);
    
    try {
      // Find all uncategorized tabs in the current view
      const { getCurrentTabs } = await import('./tab-data-source.js');
      const { categorizedTabs } = await getCurrentTabs();
      
      const uncategorizedTabs = categorizedTabs[TAB_CATEGORIES.UNCATEGORIZED] || [];
      const tabCount = uncategorizedTabs.length;
      
      if (tabCount === 0) {
        showStatus('No uncategorized tabs to assign', 'info');
        return;
      }
      
      // Category names for display
      const categoryNames = {
        [TAB_CATEGORIES.IMPORTANT]: 'Important',
        [TAB_CATEGORIES.SAVE_LATER]: 'Useful',
        [TAB_CATEGORIES.CAN_CLOSE]: 'Ignore'
      };
      
      const categoryName = categoryNames[targetCategory];
      
      // Show confirmation dialog
      const confirmMessage = `Are you sure you want to assign all ${tabCount} uncategorized tabs to "${categoryName}"?`;
      
      const { smartConfirm } = await import('../utils/dialog-utils.js');
      if (!await smartConfirm(confirmMessage, { 
        confirmText: `Assign to ${categoryName}`,
        confirmType: 'warning'  // Orange button for bulk action
      })) {
        return;
      }
      
      // Move each uncategorized tab to the target category
      const { moveTabToCategory } = await import('./categorization-service.js');
      let movedCount = 0;
      
      for (const tab of uncategorizedTabs) {
        await moveTabToCategory(tab, TAB_CATEGORIES.UNCATEGORIZED, targetCategory, 'current', true);
        movedCount++;
      }
      
      if (movedCount > 0) {
        showStatus(`Assigned ${movedCount} tabs to ${categoryName}`, 'success');
      }
    } catch (error) {
      logger.error('Error assigning all uncategorized tabs:', error);
      showStatus('Error assigning tabs', 'error');
    }
  });

  // Event delegation for tab info clicks
  on(document, 'click', async (e) => {
    const tabInfo = e.target.closest('.tab-info');
    if (!tabInfo) return;
    
    const tabItem = tabInfo.closest('.tab-item');
    if (!tabItem) return;
    
    const tabId = parseInt(tabItem.dataset.tabId);
    const tabType = tabItem.dataset.tabType || 'current';
    
    logger.uiEvents('Tab info clicked:', { tabId, tabType });
    
    try {
      // Find the tab
      let tab;
      if (tabType === 'current') {
        const { getCurrentTabs } = await import('./tab-data-source.js');
        const { categorizedTabs } = await getCurrentTabs();
        
        for (const cats of Object.values(categorizedTabs || {})) {
          tab = cats.find(t => t.id === tabId);
          if (tab) break;
        }
        
        if (tab) {
          // Switch to the tab
          const currentWindow = await ChromeAPIService.getCurrentWindow();
          const isInDifferentWindow = tab.windowId && tab.windowId !== currentWindow.id;
          
          if (isInDifferentWindow) {
            // First focus the window, then activate the tab
            try {
              // Try to focus the window containing the tab
              await ChromeAPIService.updateWindow(tab.windowId, { focused: true });
              // Activate the tab
              await ChromeAPIService.updateTab(tab.id, { active: true });
              
              // Note: In WSL, window focus may not work due to X11 forwarding limitations
              // The tab will be activated but the window may not come to the foreground
            } catch (error) {
              logger.error('Error switching to tab in another window:', error);
              // Fallback: try to just activate the tab
              try {
                await ChromeAPIService.updateTab(tab.id, { active: true });
              } catch (fallbackError) {
                logger.error('Fallback tab activation failed:', fallbackError);
              }
            }
          } else {
            await ChromeAPIService.updateTab(tab.id, { active: true });
          }
        }
      } else {
        // Handle saved tab click - get from global database cache
        if (!window.tabDatabase || !window.tabDatabase.cache.initialized) {
          return;
        }
        
        // Get tab by ID from cache
        tab = window.tabDatabase.cache.urlsById.get(tabId);
        
        if (tab) {
          // For saved tabs, we need to check if the tab is currently open
          // Chrome's tabs.query({ url }) fails with long URLs, so we query all tabs
          const allTabs = await ChromeAPIService.queryTabs({});
          
          // Find exact URL match
          const existingTab = allTabs.find(t => t.url === tab.url);
          
          if (existingTab) {
            // Tab already exists, just activate it
            await ChromeAPIService.updateTab(existingTab.id, { active: true });
            // Try to focus the window (may not work in WSL)
            try {
              await ChromeAPIService.updateWindow(existingTab.windowId, { focused: true });
            } catch (error) {
              logger.uiEvents('Could not focus window:', error);
            }
          } else {
            // Tab not open, create new one
            browser.tabs.create({ url: tab.url });
          }
        }
      }
    } catch (error) {
      logger.error('Error handling tab click:', error);
    }
  });

  // Window visibility change
  on(document, 'visibilitychange', () => {
    if (document.hidden) {
      savePopupState();
    }
  });
  
  // Event delegation for expand tabs button clicks
  document.addEventListener('click', async (e) => {
    const expandBtn = e.target.closest('.expand-group-button');
    if (!expandBtn) return;
    
    // Don't handle if this was already handled by capture phase
    if (e.defaultPrevented) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Get the parent tabs list
    const tabsList = expandBtn.parentElement;
    if (!tabsList || !tabsList.classList.contains('tabs-list')) return;
    
    // Get stored data
    const visibleTabsData = JSON.parse(tabsList.dataset.visibleTabsData || '[]');
    const currentlyShown = parseInt(tabsList.dataset.currentlyShown || '0');
    const categoryOrGroupType = tabsList.dataset.categoryOrGroupType;
    const tabType = tabsList.dataset.tabType;
    
    // Import the tab renderer
    const { unifiedTabRenderer } = await import('./unified-tab-renderer.js');
    
    // Add next batch of 15 tabs
    const BATCH_SIZE = 15;
    const endIndex = Math.min(currentlyShown + BATCH_SIZE, visibleTabsData.length);
    
    // Remove the button temporarily
    expandBtn.remove();
    
    // Add the next batch of tabs
    for (let i = currentlyShown; i < endIndex; i++) {
      const tabData = visibleTabsData[i];
      const tabElement = await unifiedTabRenderer.createTabElement(
        tabData,
        typeof categoryOrGroupType === 'number' ? parseInt(categoryOrGroupType) : tabData.category,
        tabType // Pass the type string directly, not a boolean
      );
      tabsList.appendChild(tabElement);
    }
    
    // Update the stored count
    tabsList.dataset.currentlyShown = endIndex;
    
    // Create new expand button if there are more tabs
    if (endIndex < visibleTabsData.length) {
      const remainingCount = visibleTabsData.length - endIndex;
      const nextBatchSize = Math.min(remainingCount, BATCH_SIZE);
      
      const newExpandBtn = document.createElement('div');
      newExpandBtn.className = 'expand-group-button';
      newExpandBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
        <span>Show ${nextBatchSize} more tabs (${remainingCount} remaining)</span>
      `;
      tabsList.appendChild(newExpandBtn);
    }
  }, false); // Use bubble phase

  // Event delegation for expand groups button clicks
  document.addEventListener('click', async (e) => {
    const expandBtn = e.target.closest('.expand-groups-button');
    if (!expandBtn) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Update the limit and refresh the view
    const state = stateManager.getState();
    const { dataManager } = window;
    
    if (!dataManager) {
      logger.error('DataManager not available');
      return;
    }
    
    const currentLimit = dataManager.aggregationService.getLimits().maxGroups;
    
    // Increase limit by 10 more groups
    const currentLimits = dataManager.aggregationService.getLimits();
    const newMaxGroups = currentLimit + 10;
    dataManager.aggregationService.setLimits({
      ...currentLimits,
      maxGroups: newMaxGroups
    });
    
    logger.uiEvents('Expanding groups, increasing limit by 10');
    
    // Remove the button to give immediate feedback
    expandBtn.style.opacity = '0.5';
    expandBtn.style.pointerEvents = 'none';
    expandBtn.querySelector('span').textContent = 'Loading...';
    
    // Refresh the current view
    try {
      if (state.popupState.activeTab === 'saved') {
        const { updateSavedTabContent } = await import('./content-manager.js');
        await updateSavedTabContent(true); // Force update to bypass cache
      } else {
        // Instead of using content-manager, directly call showCurrentTabsContent
        // to ensure the new limits are applied
        const { showCurrentTabsContent } = await import('./tab-display.js');
        const groupingType = state.popupState.groupingSelections.categorize || 'category';
        await showCurrentTabsContent(groupingType);
      }
    } catch (error) {
      logger.error('Error updating content:', error);
    }
  }, false); // Use bubble phase
  
  // Save state before unload
  on(window, 'beforeunload', () => {
    savePopupState();
  });
}

/**
 * Provider change handler
 */
async function onProviderChange() {
  const provider = $id(DOM_IDS.PROVIDER_SELECT).value;
  
  updateState('provider', provider);
  state.settings.provider = provider;
  
  // Load API key for this provider if it exists
  const apiKey = state.settings.apiKeys[provider];
  if (apiKey) {
    $id(DOM_IDS.API_KEY_INPUT).value = apiKey;
  } else {
    $id(DOM_IDS.API_KEY_INPUT).value = '';
  }
  
  // Update API key link
  const apiKeyLink = $id('apiKeyLink');
  if (apiKeyLink && CONFIG?.PROVIDERS?.[provider]?.apiKeyUrl) {
    apiKeyLink.href = CONFIG.PROVIDERS[provider].apiKeyUrl;
    apiKeyLink.title = `Get ${provider} API key`;
  }
  
  // Update model dropdown
  await updateModelDropdown();
  
  // Save settings
  await StorageService.saveSettings(state.settings);
}

/**
 * Model change handler
 */
async function onModelChange() {
  const model = $id(DOM_IDS.MODEL_SELECT).value;
  const provider = state.settings.provider;
  
  state.settings.selectedModels[provider] = model;
  updateState('model', model);
  
  await StorageService.saveSettings(state.settings);
}

// saveApiKey function removed - now handled entirely by settings-manager.js

/**
 * Prompt change handler
 */
function onPromptChange() {
  const promptText = $id(DOM_IDS.PROMPT_TEXTAREA).value;
  const isCustomized = promptText && promptText !== CONFIG.DEFAULT_PROMPT;
  
  state.settings.customPrompt = promptText;
  state.settings.isPromptCustomized = isCustomized;
  
  // Update prompt status
  const promptStatus = $id(DOM_IDS.PROMPT_STATUS);
  if (promptStatus) {
    if (isCustomized) {
      promptStatus.textContent = '(Customized)';
      promptStatus.style.color = 'var(--md-sys-color-primary)';
    } else {
      promptStatus.textContent = '(Using default)';
      promptStatus.style.color = '';
    }
  }
  
  debouncedSaveState();
}

/**
 * Reset prompt to default
 */
async function resetPrompt() {
  $id(DOM_IDS.PROMPT_TEXTAREA).value = CONFIG.DEFAULT_PROMPT;
  state.settings.customPrompt = CONFIG.DEFAULT_PROMPT;
  state.settings.isPromptCustomized = false;
  
  const promptStatus = $id(DOM_IDS.PROMPT_STATUS);
  if (promptStatus) {
    promptStatus.textContent = '(Using default)';
    promptStatus.style.color = '';
  }
  
  await StorageService.saveSettings(state.settings);
  showStatus('Prompt reset to default', 'success');
}

/**
 * Max tabs change handler
 */
async function onMaxTabsChange() {
  const maxTabs = parseInt($id(DOM_IDS.MAX_TABS_INPUT).value) || LIMITS.MAX_TABS_DEFAULT;
  
  // Validate range
  if (maxTabs < LIMITS.MIN_TABS_LIMIT) {
    $id(DOM_IDS.MAX_TABS_INPUT).value = LIMITS.MIN_TABS_LIMIT;
    state.settings.maxTabsToOpen = LIMITS.MIN_TABS_LIMIT;
  } else if (maxTabs > LIMITS.MAX_TABS_LIMIT) {
    $id(DOM_IDS.MAX_TABS_INPUT).value = LIMITS.MAX_TABS_LIMIT;
    state.settings.maxTabsToOpen = LIMITS.MAX_TABS_LIMIT;
  } else {
    state.settings.maxTabsToOpen = maxTabs;
  }
  
  await StorageService.saveSettings(state.settings);
}


/**
 * LLM checkbox change handler
 */
async function onUseLLMChange(e) {
  state.settings.useLLM = e.target.checked;
  state.settings.hasConfiguredSettings = true; // Mark that user has configured settings
  
  await StorageService.saveSettings(state.settings);
  
  // Show/hide LLM settings container
  const llmSettingsContainer = $id('llmSettingsContainer');
  if (llmSettingsContainer) {
    llmSettingsContainer.style.display = e.target.checked ? 'block' : 'none';
  }
  
  if (!e.target.checked) {
    showStatus('AI categorization disabled. Only rule-based categorization will be used.', 'info', 3000);
  } else {
    showStatus('AI categorization enabled', 'success', 2000);
  }
}


// Export default object
export default {
  setupEventListeners
};