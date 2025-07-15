/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Categorization Service - handles tab categorization using LLMs
 */

import { TAB_CATEGORIES, STATUS_MESSAGES, CATEGORY_NAMES, RULE_TYPES, RULE_FIELDS, DOM_IDS, LIMITS } from '../utils/constants.js';
import { extractDomain, smartConfirm } from '../utils/helpers.js';
import logger from '../utils/logger.js';
import MessageService from '../services/MessageService.js';
import { getUnifiedDatabase } from '../services/UnifiedDatabaseService.js';
import { state, updateState, clearCategorizedTabs, savePopupState } from './state-manager.js';
import { showStatus, clearStatusByProcessKey, updateCategorizeBadge, hideApiKeyPrompt } from './ui-manager.js';
import { getCurrentTabs } from './tab-data-source.js';
import { markContentDirty, syncHiddenTabContent } from './content-manager.js';
import { $id } from '../utils/dom-helpers.js';
// Database is available as window.tabDatabase (basic) or via getUnifiedDatabase() (with ML sync)

// Track categorization processing state
let isCategorizationInProgress = false;

/**
 * Handle categorize button click
 */
export async function handleCategorize() {
  
  // Disable categorize buttons immediately to prevent double-clicking
  disableCategorizeButtons();
  
  // Check if this is first-time use
  if (!state.settings.hasConfiguredSettings) {
    const shouldRedirect = await smartConfirm('Welcome to AI Tab Manager! Would you like to configure your categorization settings first?\n\nYou can choose to use AI-powered categorization or set up rules-based categorization.', { defaultAnswer: false });
    if (shouldRedirect) {
      const { switchToTab } = await import('./ui-manager.js');
      switchToTab('settings');
      showStatus('Please configure your categorization settings', 'info', 5000);
      await enableCategorizeButtons(); // Re-enable buttons on early exit
      return;
    }
  }
  
  // Check if LLM is disabled
  if (!state.settings.useLLM) {
    // Only use rule-based categorization
    await categorizeTabs();
    return;
  }
  
  // Check for API key if LLM is enabled
  const apiKey = state.settings.apiKeys[state.settings.provider];
  const provider = state.settings.provider;
  const model = state.settings.model || state.settings.selectedModels[provider];
  
  if (!apiKey || !provider || !model) {
    showStatus(STATUS_MESSAGES.ERROR_NO_API_KEY, 'error', 5000);
    await enableCategorizeButtons(); // Re-enable buttons on API key error
    return;
  }
  
  hideApiKeyPrompt();
  await categorizeTabs();
}

/**
 * Apply rules to categorize tabs
 * @param {Array} tabs - Array of tabs to categorize
 * @param {Array} rules - Array of rules to apply
 * @returns {Object} Object with categorized tabs and remaining uncategorized tabs
 */
export function applyRulesToTabs(tabs, rules) {
  const categorizedByRules = {
    [TAB_CATEGORIES.CAN_CLOSE]: [],
    [TAB_CATEGORIES.SAVE_LATER]: [],
    [TAB_CATEGORIES.IMPORTANT]: []
  };
  const uncategorizedTabs = [];
  
  tabs.forEach(tab => {
    let categorized = false;
    
    // Check each rule
    for (const rule of rules) {
      if (!rule.enabled) continue;
      
      let matches = false;
      
      switch (rule.type) {
        case RULE_TYPES.DOMAIN: {
          const tabDomain = extractDomain(tab.url);
          matches = tabDomain === rule.value;
          break;
        }
          
        case RULE_TYPES.URL_CONTAINS:
          matches = tab.url.includes(rule.value);
          break;
          
        case RULE_TYPES.TITLE_CONTAINS:
          matches = tab.title && tab.title.includes(rule.value);
          break;
          
        case RULE_TYPES.REGEX:
          try {
            const regex = new RegExp(rule.value);
            const field = rule.field === RULE_FIELDS.TITLE ? tab.title : tab.url;
            matches = regex.test(field);
          } catch (e) {
            console.error('Invalid regex:', rule.value, e);
          }
          break;
      }
      
      if (matches) {
        categorizedByRules[rule.category].push(tab);
        categorized = true;
        break; // Apply first matching rule only
      }
    }
    
    if (!categorized) {
      uncategorizedTabs.push(tab);
    }
  });
  
  return { categorizedByRules, uncategorizedTabs };
}

/**
 * Batch categorization with progress tracking
 * @param {Array} tabs - Tabs to categorize
 * @param {Object} options - Categorization options
 * @param {number} options.batchSize - Number of tabs per batch (default: 100)
 * @param {Function} options.onProgress - Progress callback function
 * @param {Object} options.settings - Categorization settings
 * @param {string} options.source - Source of tabs ('current_tabs', 'csv_import', etc.)
 * @returns {Promise<Object>} Final categorization result
 */
export async function categorizeBatches(tabs, options = {}) {
  const {
    batchSize = state.settings?.batchSize || LIMITS.BATCH_SIZE_DEFAULT,
    onProgress = null,
    settings = state.settings
  } = options;
  
  
  if (tabs.length === 0) {
    if (onProgress) onProgress({ processed: 0, total: 0, currentBatch: 0, totalBatches: 0, status: 'completed' });
    return {
      [TAB_CATEGORIES.UNCATEGORIZED]: [],
      [TAB_CATEGORIES.CAN_CLOSE]: [],
      [TAB_CATEGORIES.SAVE_LATER]: [],
      [TAB_CATEGORIES.IMPORTANT]: []
    };
  }
  
  // Always use Web Worker for categorization if available
  const useWorker = typeof Worker !== 'undefined';
  
  if (useWorker) {
    // Use Web Worker for large batches to avoid blocking UI
    try {
      // Create worker without module type (uses dynamic imports like training-worker)
      let worker;
      try {
        worker = new Worker(
          new URL('../ml/workers/categorization-worker.js', import.meta.url)
          // No { type: 'module' } - uses dynamic imports instead
        );
      } catch (workerError) {
        console.error('Failed to create Worker:', workerError);
        throw workerError; // Let outer catch handle fallback
      }
      
      // Get saved URLs before creating the Promise
      let savedUrls = [];
      if (settings?.useLLM) {
        try {
          const savedTabs = await window.tabDatabase.getAllSavedTabs();
          savedUrls = savedTabs
            .filter(tab => tab.category !== 0)
            .map(tab => tab.url);
        } catch (error) {
          console.error('Error getting saved tabs:', error);
        }
      }
      
      const workerResults = await new Promise((resolve, reject) => {
        const jobId = Date.now().toString();
        let completed = false;
        
        // Set up message handler
        worker.addEventListener('message', async (event) => {
          const { type, data, error, jobId: messageJobId } = event.data;
          
          switch (type) {
            case 'INITIALIZED':
              // Send categorization request
              worker.postMessage({
                type: 'CATEGORIZE',
                jobId,
                data: { tabs, settings, batchSize }
              });
              break;
              
            case 'LLM_REQUEST':
              // Handle LLM request from worker
              try {
                // Make LLM call through MessageService (which communicates with background)
                const llmResults = await MessageService.categorizeTabs({
                  tabs: data.tabs,
                  apiKey: data.apiKey,
                  provider: data.provider,
                  model: data.model,
                  customPrompt: data.customPrompt,
                  savedUrls: data.savedUrls
                });
                
                // Send results back to worker
                worker.postMessage({
                  type: 'LLM_RESPONSE',
                  jobId: messageJobId,
                  llmResults
                });
              } catch (error) {
                console.error('Error calling LLM from worker:', error);
                
                // Show error to user with same error handling as non-worker path
                let userMessage = 'LLM categorization failed';
                const errorString = error.toString();
                
                if (errorString.includes('402') || errorString.includes('Insufficient Balance')) {
                  userMessage = `${data.provider} API: Insufficient balance - please check your account`;
                } else if (errorString.includes('401') || errorString.includes('Unauthorized')) {
                  userMessage = `${data.provider} API: Invalid API key - please check your settings`;
                } else if (errorString.includes('429') || errorString.includes('Rate limit')) {
                  userMessage = `${data.provider} API: Rate limit exceeded - please try again later`;
                } else if (errorString.includes('500') || errorString.includes('502') || errorString.includes('503')) {
                  userMessage = `${data.provider} API: Server error - please try again later`;
                } else if (errorString.includes('timeout')) {
                  userMessage = `${data.provider} API: Request timed out - please try again`;
                } else if (errorString.includes('Network') || errorString.includes('Failed to fetch')) {
                  userMessage = `${data.provider} API: Network error - please check your connection`;
                } else if (error.message) {
                  userMessage = `${data.provider} API error: ${error.message}`;
                }
                
                showStatus(`${userMessage}. Please fix the API issue or disable LLM in settings.`, 'error');
                
                // Send null results to worker so it can continue
                worker.postMessage({
                  type: 'LLM_RESPONSE',
                  jobId: messageJobId,
                  llmResults: null
                });
              }
              break;
              
            case 'PROGRESS':
              if (onProgress && data) {
                onProgress({
                  processed: data.processed,
                  total: data.total,
                  currentBatch: data.currentBatch,
                  totalBatches: data.totalBatches,
                  status: 'processing',
                  batchInfo: `Processing batch ${data.currentBatch}/${data.totalBatches}`
                });
              }
              break;
              
            case 'COMPLETE':
              completed = true;
              if (onProgress) {
                onProgress({
                  processed: data.processedCount,
                  total: data.processedCount,
                  currentBatch: Math.ceil(data.processedCount / batchSize),
                  totalBatches: Math.ceil(data.processedCount / batchSize),
                  status: 'completed',
                  batchInfo: 'Categorization completed'
                });
              }
              worker.terminate();
              
              // Worker returns raw categorized results - we need to save them
              // and handle all the same logic as categorizeWithEnsemble
              const workerResults = data.results;
              
              // Process the worker results through the save/update flow
              // We'll handle this after resolving
              resolve(workerResults);
              break;
              
            case 'ERROR':
              completed = true;
              worker.terminate();
              reject(new Error(error || 'Worker error'));
              break;
          }
        });
        
        // Set up error handler
        worker.addEventListener('error', (error) => {
          if (!completed) {
            completed = true;
            worker.terminate();
            // Convert Worker error event to a proper Error object
            const errorMessage = error.message || error.filename || 'Worker failed to load';
            console.error('Worker error details:', {
              message: error.message,
              filename: error.filename,
              lineno: error.lineno,
              colno: error.colno
            });
            reject(new Error(`Worker error: ${errorMessage}`));
          }
        });
        
        // Initialize worker with settings to determine if ML should be loaded
        // Create a clean copy of settings for serialization
        const settingsForWorker = {
          useML: settings?.useML,
          useLLM: settings?.useLLM,
          rules: settings?.rules || [],
          provider: settings?.provider,
          model: settings?.model,
          selectedModels: settings?.selectedModels || {},
          apiKeys: settings?.apiKeys || {},
          customPrompt: settings?.customPrompt,
          batchSize: settings?.batchSize,
          savedUrls: savedUrls
        };
        
        worker.postMessage({ type: 'INIT', settings: settingsForWorker });
        
        // Set timeout
        setTimeout(() => {
          if (!completed) {
            completed = true;
            worker.terminate();
            reject(new Error('Worker timeout'));
          }
        }, 300000); // 5 minute timeout
      });
      
      // Worker returns raw categorized results - now process them
      // This replicates what categorizeWithEnsemble does after categorization
      
      // Extract predictions from worker results
      const predictions = {};
      Object.values(workerResults).forEach(tabs => {
        if (Array.isArray(tabs)) {
          tabs.forEach(tab => {
            if (tab.mlPrediction && Object.keys(tab.mlPrediction).length > 0) {
              // The mlPrediction contains the full metadata from voting
              // We need to ensure it has the correct structure for UnifiedDatabaseService
              const metadata = tab.mlPrediction;
              predictions[tab.url] = {
                ...metadata,
                // Ensure required fields are present
                predictions: metadata.predictions || {},
                confidences: metadata.confidences || {},
                weights: metadata.trustWeights || metadata.weights || {},
                combinedConfidence: metadata.combinedConfidence || 0,
                agreement: metadata.agreement,
                strategy: metadata.strategy,
                source: metadata.source || 'ensemble'
              };
            }
          });
        }
      });
      
      // Get already saved URLs to avoid re-saving them
      let savedUrlSet = new Set();
      try {
        const savedTabs = await window.tabDatabase.getAllSavedTabs();
        savedUrlSet = new Set(savedTabs
          .filter(tab => tab.category !== 0)
          .map(tab => tab.url));
      } catch (error) {
        console.error('Error getting saved tabs for filtering:', error);
      }
      
      // Filter out any tabs that are already saved in the database
      const filteredCategorizedTabs = {
        [TAB_CATEGORIES.CAN_CLOSE]: (workerResults[TAB_CATEGORIES.CAN_CLOSE] || []).filter(tab => !savedUrlSet.has(tab.url)),
        [TAB_CATEGORIES.SAVE_LATER]: (workerResults[TAB_CATEGORIES.SAVE_LATER] || []).filter(tab => !savedUrlSet.has(tab.url)),
        [TAB_CATEGORIES.IMPORTANT]: (workerResults[TAB_CATEGORIES.IMPORTANT] || []).filter(tab => !savedUrlSet.has(tab.url))
      };
      
      // Filter predictions to match filtered tabs
      const filteredPredictions = {};
      for (const [url, predictionData] of Object.entries(predictions)) {
        if (!savedUrlSet.has(url)) {
          filteredPredictions[url] = predictionData;
        }
      }
      
      // Save categorized tabs to database using UnifiedDatabaseService for ML sync
      const unifiedDB = await getUnifiedDatabase();
      await unifiedDB.saveCategorizedTabs(filteredCategorizedTabs, {
        provider: settings.provider,
        model: settings.model,
        closedAfterSave: false,
        mlEnabled: settings.useML,
        source: settings.source || 'ensemble_categorization',
        mlMetadata: {}  // Worker doesn't provide separate metadata
      }, filteredPredictions);
      
      // Only update UI state if this is not a CSV import
      const isCSVImport = settings.source === 'csv_import';
      
      if (!isCSVImport) {
        // Get current state for merging
        const currentState = await getCurrentTabs();
        const existingCategorized = currentState.categorizedTabs || {};
        
        // Merge worker results with existing categorized tabs
        const mergedResult = {
          [TAB_CATEGORIES.UNCATEGORIZED]: [],
          [TAB_CATEGORIES.CAN_CLOSE]: [...(workerResults[TAB_CATEGORIES.CAN_CLOSE] || [])],
          [TAB_CATEGORIES.SAVE_LATER]: [...(workerResults[TAB_CATEGORIES.SAVE_LATER] || [])],
          [TAB_CATEGORIES.IMPORTANT]: [...(workerResults[TAB_CATEGORIES.IMPORTANT] || [])]
        };
        
        // Keep existing categorized tabs that weren't recategorized
        const processedIds = new Set(tabs.map(t => t.id));
        [TAB_CATEGORIES.CAN_CLOSE, TAB_CATEGORIES.SAVE_LATER, TAB_CATEGORIES.IMPORTANT].forEach(cat => {
          const existing = existingCategorized[cat] || [];
          existing.forEach(tab => {
            if (!processedIds.has(tab.id)) {
              mergedResult[cat].push(tab);
            }
          });
        });
        
        // Update state with categorized tabs
        mergedResult[TAB_CATEGORIES.UNCATEGORIZED] = [];
        updateState('categorizedTabs', mergedResult);
        
        // Update UI
        updateCategorizeBadge();
        
        // Update saved badge count since we just saved tabs
        const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
        await loadSavedTabsCount();
        
        // Save state
        await savePopupState();
        
        // Update content using simple approach
        markContentDirty('all');
        const { updateCurrentTabContent } = await import('./content-manager.js');
        await updateCurrentTabContent(true); // Force refresh after categorization
        await syncHiddenTabContent();
        
        // Show the tabs container and toolbar
        const { show } = await import('../utils/dom-helpers.js');
        const { DOM_IDS } = await import('../utils/constants.js');
        const { $id } = await import('../utils/dom-helpers.js');
        show($id(DOM_IDS.TABS_CONTAINER));
        
        // Show unified toolbar
        const { showToolbar } = await import('./unified-toolbar.js');
        showToolbar();
      }
      
      // Record predictions for performance tracking
      if (Object.keys(predictions).length > 0) {
        try {
          const { getPerformanceTracker } = await import('../ml/trust/performance-tracker.js');
          const performanceTracker = getPerformanceTracker();
          
          // Record predictions for each tab
          for (const [url, predictionData] of Object.entries(predictions)) {
            // Find which category this tab ended up in
            let finalCategory = null;
            let tab = null;
            for (const [category, tabsInCategory] of Object.entries(workerResults)) {
              const found = tabsInCategory.find(t => t.url === url);
              if (found) {
                tab = found;
                finalCategory = parseInt(category);
                break;
              }
            }
            
            if (finalCategory >= 1 && finalCategory <= 3 && tab) {
              const trackingData = {
                tabId: tab.id,
                url: tab.url,
                title: tab.title,
                rules: predictionData.predictions?.rules,
                model: predictionData.predictions?.model,
                llm: predictionData.predictions?.llm,
                confidences: predictionData.confidences || {},
                weights: predictionData.weights || {},
                confidence: predictionData.combinedConfidence || predictionData.confidence || 0,
                agreement: predictionData.agreement,
                source: predictionData.source
              };
              
              await performanceTracker.recordPrediction(trackingData, finalCategory, settings.source || 'auto_categorization');
            }
          }
        } catch (error) {
          console.error('Error recording predictions:', error);
        }
      }
      
      return workerResults;
      
    } catch (workerError) {
      console.error('Web Worker failed:', {
        error: workerError.message || workerError,
        tabCount: tabs.length
      });
      throw workerError; // Always throw - no fallback
    }
  } else {
    throw new Error('Web Workers not supported in this browser');
  }
}

// Removed categorizeSingleBatch - no longer needed since we always use worker



/**
 * Categorize all open tabs (updated to use batch processing)
 */
export async function categorizeTabs() {
  try {
    // Get current tabs from tab data source
    const { categorizedTabs } = await getCurrentTabs();
    
    // Get uncategorized tabs (category 0)
    const uncategorizedTabs = categorizedTabs[TAB_CATEGORIES.UNCATEGORIZED] || [];
    
    // If no uncategorized tabs, nothing to categorize
    if (uncategorizedTabs.length === 0) {
      showStatus('No uncategorized tabs to process', 'info', 3000);
      await enableCategorizeButtons(); // Re-enable buttons when no tabs to categorize
      return;
    }
    
    // Set up progress tracking
    const updateProgress = (progress) => {
      const progressPercent = Math.round((progress.processed / progress.total) * 100);
      let statusMessage;
      
      if (progress.status === 'processing') {
        // If only one batch, show simpler message
        if (progress.totalBatches === 1) {
          statusMessage = `Processing ${progress.total} tabs...`;
        } else {
          statusMessage = `Processing batch ${progress.currentBatch}/${progress.totalBatches} (${progressPercent}%)`;
        }
        showStatus(statusMessage, 'loading', 0, 'batch-processing');
      } else if (progress.status === 'completed') {
        // Update the progress message to show completion (no spinner)
        if (progress.totalBatches === 1) {
          statusMessage = `Processed ${progress.total} tabs`;
        } else {
          statusMessage = `Processed ${progress.totalBatches} batches (${progress.total} tabs)`;
        }
        showStatus(statusMessage, 'info', 5000, 'batch-processing');
      }
    };
    
    // Use batch categorization
    // IMPORTANT: categorizeBatches returns ONLY newly categorized tabs, not merged results
    const result = await categorizeBatches(uncategorizedTabs, {
      batchSize: state.settings?.batchSize || LIMITS.BATCH_SIZE_DEFAULT,
      onProgress: updateProgress,
      settings: state.settings,
      source: 'current_tabs'
    });
    
    // Note: categorizeWithEnsemble already handles:
    // - Merging with existing tabs
    // - Updating state with categorizedTabs
    // - Tracking duplicate URLs
    // - Saving to database
    // So we don't need to do any of that here
    
    // Note: Batch categorization already saves tabs in categorizeWithEnsemble
    // with proper predictions and confidence values. No need to save again here.
    
    // Update UI
    updateCategorizeBadge();
    
    // Update saved badge count since we just saved tabs
    const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
    await loadSavedTabsCount();
    
    // Count how many tabs were actually categorized from the uncategorized batch
    // Only count tabs that are NOT in category 0 (uncategorized)
    const categorizedCount = (result[TAB_CATEGORIES.CAN_CLOSE]?.length || 0) +
                           (result[TAB_CATEGORIES.SAVE_LATER]?.length || 0) +
                           (result[TAB_CATEGORIES.IMPORTANT]?.length || 0);
    
    // Show appropriate success message (without process key so it doesn't replace the processing message)
    if (categorizedCount === uncategorizedTabs.length) {
      showStatus(`All ${categorizedCount} tabs categorized and saved successfully!`, 'success');
    } else if (categorizedCount > 0) {
      const remainingUncategorized = uncategorizedTabs.length - categorizedCount;
      showStatus(`${categorizedCount} tabs categorized and saved. ${remainingUncategorized} tabs could not be categorized.`, 'warning');
    } else {
      // No tabs were categorized
      if (uncategorizedTabs.length === 1) {
        showStatus('The tab could not be categorized with current rules/settings.', 'info');
      } else {
        showStatus(`None of the ${uncategorizedTabs.length} tabs could be categorized with current rules/settings.`, 'info');
      }
    }
    
    // Save state
    await savePopupState();
    
    // Trigger display update AFTER categorization is complete
    markContentDirty('all');
    const { updateCurrentTabContent } = await import('./content-manager.js');
    await updateCurrentTabContent(true); // Force refresh after categorization
    await syncHiddenTabContent();
    
    // Show the tabs container and toolbar
    const { show } = await import('../utils/dom-helpers.js');
    const { DOM_IDS } = await import('../utils/constants.js');
    const { $id } = await import('../utils/dom-helpers.js');
    show($id(DOM_IDS.TABS_CONTAINER));
    
    // Show unified toolbar
    const { showToolbar } = await import('./unified-toolbar.js');
    showToolbar();
    
    // Re-enable categorize buttons after successful categorization
    await enableCategorizeButtons();
    
    return result;
    
  } catch (error) {
    console.error('Error in categorizeTabs:', error);
    // Don't show duplicate error messages for LLM/ML failures
    if (!error.message?.includes('LLM categorization failed') && 
        !error.message?.includes('ML categorization failed')) {
      showStatus(`${STATUS_MESSAGES.ERROR_CATEGORIZATION} ${error.message}`, 'error');
    }
    // Re-enable categorize buttons after error
    await enableCategorizeButtons();
    return null;
  }
}

/**
 * Re-categorize tabs (refresh)
 */
export async function refreshCategorization() {
  // Clear existing categorization
  clearCategorizedTabs();
  
  // Re-categorize
  return categorizeTabs();
}

/**
 * Move a tab to a different category
 * @param {Object} tab - Tab to move
 * @param {number} fromCategory - Source category
 * @param {number} toCategory - Target category
 * @param {string} type - Tab type ('current' or 'saved') - optional for backward compatibility
 */
export async function moveTabToCategory(tab, fromCategory, toCategory, type = 'current', silent = false) {
  if (fromCategory === toCategory) return;
  
  try {
    // Process as user correction for ML learning
    if (state.mlMetadata && state.mlMetadata[tab.id]) {
      try {
        const { getMLCategorizer } = await import('../ml/categorization/ml-categorizer.js');
        const mlCategorizer = await getMLCategorizer();
        await mlCategorizer.processCorrection(
          tab, 
          fromCategory, 
          toCategory, 
          state.mlMetadata[tab.id]
        );
      } catch (error) {
        logger.mlTraining('Could not process ML correction:', error);
      }
    }
    
    // Always ensure the tab is saved to database before updating category
    // This handles both current tabs that aren't saved yet and saved tabs
    await window.tabDatabase.getOrCreateUrl(tab, toCategory);
    
    // Update database with user correction using unified service
    const unifiedDB = await getUnifiedDatabase();
    await unifiedDB.updateTabCategory(tab.url, fromCategory, toCategory, 'user_correction');
    
    
    // Update local state
    const categorizedTabs = state.categorizedTabs || {};
    
    // Remove tab from old category
    if (categorizedTabs[fromCategory]) {
      categorizedTabs[fromCategory] = categorizedTabs[fromCategory].filter(t => t.id !== tab.id);
    }
    
    // Add tab to new category
    if (!categorizedTabs[toCategory]) {
      categorizedTabs[toCategory] = [];
    }
    // Update the tab's category
    const updatedTab = { ...tab };
    updatedTab.knownCategory = toCategory;
    updatedTab.alreadySaved = true; // Mark as saved since we just saved it
    categorizedTabs[toCategory].push(updatedTab);
    
    // Update state
    updateState('categorizedTabs', categorizedTabs);
    
    // Save state
    await savePopupState();
    
    updateCategorizeBadge();
    
    // Update saved badge count if tab was moved to/from any saved category (1, 2, or 3)
    if (toCategory === TAB_CATEGORIES.CAN_CLOSE || toCategory === TAB_CATEGORIES.SAVE_LATER || toCategory === TAB_CATEGORIES.IMPORTANT ||
        fromCategory === TAB_CATEGORIES.CAN_CLOSE || fromCategory === TAB_CATEGORIES.SAVE_LATER || fromCategory === TAB_CATEGORIES.IMPORTANT) {
      const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
      await loadSavedTabsCount();
    }
    
    // Trigger UI update based on tab type
    markContentDirty('all');
    
    if (type === 'current') {
      // Force refresh current tabs data from database to get updated saved status
      const { getCurrentTabs } = await import('./tab-data-source.js');
      const { categorizedTabs: refreshedTabs } = await getCurrentTabs();
      updateState('categorizedTabs', refreshedTabs);
      
      // Update Current tabs content with force flag to bypass cache
      const { updateCurrentTabContent } = await import('./content-manager.js');
      await updateCurrentTabContent(true); // Force update to ensure UI refreshes
      await syncHiddenTabContent();
    } else {
      // Force refresh saved tabs data from database to get updated category
      const { getSavedTabs } = await import('./tab-data-source.js');
      await getSavedTabs();
      
      // Update Saved tabs content
      const { showSavedTabsContent } = await import('./saved-tabs-manager.js');
      await showSavedTabsContent(state.savedGroupingType);
    }
    
    if (!silent) {
      showStatus(`Moved to ${CATEGORY_NAMES[toCategory]}`, 'success');
    }
    
  } catch (error) {
    console.error('Error moving tab:', error);
    showStatus('Error moving tab', 'error');
  }
}

/**
 * Check if tab is already saved
 * @param {string} url - Tab URL
 * @returns {Promise<boolean>}
 */
export async function isTabSaved(url) {
  try {
    const savedTabs = await window.tabDatabase.getAllSavedTabs();
    return savedTabs.some(tab => tab.url === url);
  } catch (error) {
    console.error('Error checking if tab is saved:', error);
    return false;
  }
}

/**
 * Get categorization stats
 * @returns {Promise<Object>} Stats object
 */
export async function getCategorizationStats() {
  const { getCurrentTabs } = await import('./tab-data-source.js');
  const { categorizedTabs, urlToDuplicateIds } = await getCurrentTabs();
  
  const stats = {
    total: 0,
    byCategory: {
      [TAB_CATEGORIES.CAN_CLOSE]: categorizedTabs[TAB_CATEGORIES.CAN_CLOSE]?.length || 0,
      [TAB_CATEGORIES.SAVE_LATER]: categorizedTabs[TAB_CATEGORIES.SAVE_LATER]?.length || 0,
      [TAB_CATEGORIES.IMPORTANT]: categorizedTabs[TAB_CATEGORIES.IMPORTANT]?.length || 0
    },
    duplicates: Object.keys(urlToDuplicateIds).length,
    saved: 0
  };
  
  stats.total = stats.byCategory[TAB_CATEGORIES.CAN_CLOSE] + 
                stats.byCategory[TAB_CATEGORIES.SAVE_LATER] + 
                stats.byCategory[TAB_CATEGORIES.IMPORTANT];
  
  // Count saved tabs
  Object.values(categorizedTabs).forEach(tabs => {
    if (tabs) {
      tabs.forEach(tab => {
        if (tab.alreadySaved) stats.saved++;
      });
    }
  });
  
  return stats;
}

/**
 * Collect predictions from different methods for accuracy assessment
 * @param {Array} tabs - Original tabs
 * @param {Object} categorizedTabs - Final categorized result
 * @param {Object} mlResults - ML categorization results
 * @returns {Promise<Object>} Predictions map by URL
 */
async function collectPredictions(tabs, categorizedTabs, mlResults, llmResults) {
  const predictions = {};
  
  try {
    // Get unified database for ML predictions
    const unifiedDB = await getUnifiedDatabase();
    
    for (const tab of tabs) {
      const predictionData = {};
      
      // Rules-based prediction
      const ruleResult = applyRulesToTabs([tab], state.settings.rules);
      if (ruleResult.categorizedByRules && Object.keys(ruleResult.categorizedByRules).length > 0) {
        // Find which category this tab was assigned to
        let assignedCategory = null;
        for (const [category, tabsInCategory] of Object.entries(ruleResult.categorizedByRules)) {
          if (tabsInCategory && tabsInCategory.find(t => t.url === tab.url)) {
            assignedCategory = parseInt(category);
            break;
          }
        }
        
        if (assignedCategory) {
          predictionData.rules = {
            category: assignedCategory,
            confidence: 0.9, // High confidence for rule-based categorization
            predictionId: `rules_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
          };
        }
      }
      
      // ML model prediction (if available)
      try {
        const mlPrediction = await unifiedDB.getMLPrediction(tab);
        if (mlPrediction && mlPrediction.category) {
          predictionData.ml_model = {
            category: mlPrediction.category,
            confidence: mlPrediction.confidence,
            predictionId: mlPrediction.predictionId || `ml_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
          };
        }
      } catch (mlError) {
        logger.mlCategorization('ML prediction not available for tab:', tab.url);
      }
      
      // LLM prediction (need to find which category the tab ended up in from LLM)
      // The LLM results are organized by category (1, 2, 3) not by tab
      if (llmResults) {
        // Check each category to find where this tab was placed by LLM
        for (const [category, tabsInCategory] of Object.entries(llmResults)) {
          if (tabsInCategory && Array.isArray(tabsInCategory)) {
            const found = tabsInCategory.find(t => t.url === tab.url);
            if (found) {
              predictionData.llm = {
                category: parseInt(category),
                confidence: 0.8, // Default confidence for LLM
                predictionId: `llm_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
              };
              break;
            }
          }
        }
      }
      
      // Find final category for this tab by ID (not URL)
      let finalCategory = null;
      for (const [category, tabsInCategory] of Object.entries(categorizedTabs)) {
        if (tabsInCategory && tabsInCategory.find(t => t.id === tab.id)) {
          finalCategory = parseInt(category);
          break;
        }
      }
      
      if (finalCategory && Object.keys(predictionData).length > 0) {
        predictionData.finalCategory = finalCategory;
        
        // Structure confidence data properly for _syncToMLDatabase
        const confidences = {};
        
        // Extract confidence values from each prediction type
        if (predictionData.rules) {
          confidences.rules = predictionData.rules.confidence;
        }
        if (predictionData.ml_model) {
          confidences.ml_model = predictionData.ml_model.confidence;
        }
        if (predictionData.llm) {
          confidences.llm = predictionData.llm.confidence;
        }
        
        // Add structured confidence data
        predictionData.confidences = confidences;
        
        // Add metadata from ML results including weights and combined confidence
        if (mlResults?.metadata?.[tab.id]) {
          const meta = mlResults.metadata[tab.id];
          predictionData.combinedConfidence = meta.combinedConfidence || 0;
          predictionData.agreement = meta.agreement;
          predictionData.strategy = meta.strategy;
          
          // Use the actual trust weights from ensemble voting
          if (meta.trustWeights) {
            predictionData.weights = meta.trustWeights;
          } else if (meta.weights) {
            // Fallback to meta.weights if trustWeights not available
            predictionData.weights = meta.weights;
          }
        } else {
          // No metadata - this might happen with rules-only categorization
          // For rules-only, we should still create prediction data
          if (predictionData.rules) {
            // Set default weights for rules-only categorization
            predictionData.weights = { rules: 1.0 };
            predictionData.combinedConfidence = predictionData.rules.confidence || 0.9;
            predictionData.agreement = 1.0; // Rules always agree with themselves
          }
        }
        
        // If no weights available from metadata, don't set any (let _syncToMLDatabase handle defaults)
        
        predictions[tab.url] = predictionData;
        
      }
    }
    
  } catch (error) {
    console.error('Error collecting predictions:', error);
  }
  
  
  return predictions;
}

/**
 * Disable categorize buttons to prevent double-clicking
 */
function disableCategorizeButtons() {
  isCategorizationInProgress = true;
  const categorizeBtn = $id(DOM_IDS.CATEGORIZE_BTN);
  
  if (categorizeBtn) {
    categorizeBtn.disabled = true;
    categorizeBtn.classList.add('disabled');
  }
}

/**
 * Enable categorize buttons after categorization completes
 */
async function enableCategorizeButtons() {
  isCategorizationInProgress = false;
  
  // Get the button directly
  const categorizeBtn = $id(DOM_IDS.CATEGORIZE_BTN);
  if (categorizeBtn) {
    categorizeBtn.classList.remove('disabled');
  }
  
  // Update button state based on uncategorized tabs
  const { updateLegacyCategorizeButtonState } = await import('./ui-manager.js');
  await updateLegacyCategorizeButtonState();
}

// Export default object
export default {
  handleCategorize,
  categorizeTabs,
  categorizeBatches,
  refreshCategorization,
  moveTabToCategory,
  isTabSaved,
  getCategorizationStats,
  applyRulesToTabs,
  get isCategorizationInProgress() { return isCategorizationInProgress; }
};