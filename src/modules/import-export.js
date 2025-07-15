/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Import/Export Module - handles CSV import and export functionality
 */

import { DOM_IDS, TAB_TYPES, LIMITS } from '../utils/constants.js';
import { $id } from '../utils/dom-helpers.js';
import { smartConfirm, parseCSVLine } from '../utils/helpers.js';
import { showConfirmWithCheckboxes } from '../utils/dialog-utils.js';
import { showStatus } from './ui-manager.js';
import { state } from './state-manager.js';
import { showSavedTabsContent } from './saved-tabs-manager.js';
import { dataManager } from './data-manager.js';
import { getUnifiedDatabase } from '../services/UnifiedDatabaseService.js';
// Database is available as window.tabDatabase

/**
 * Export tabs to CSV file
 */
export async function exportToCSV() {
  try {
    // Check if DataManager is available
    if (!dataManager || !dataManager.isReady()) {
      console.warn('DataManager not available, using legacy export');
      // Show simple confirmation for legacy export
      const confirmed = await smartConfirm('Export all saved tabs to CSV?', { defaultAnswer: true });
      if (!confirmed) return;
      
      // Export is instant - no messages needed
      const csvContent = await window.tabDatabase.exportAsCSV();
      downloadCSV(csvContent);
      return;
    }
    
    // Get current state for filters and sorting
    const searchQuery = state.popupState?.searchQuery || '';
    
    // Get category filters for saved tabs
    const categories = [];
    if (state.popupState?.categoryFilters?.saved) {
      const savedFilters = state.popupState.categoryFilters.saved;
      if (savedFilters.ignore) categories.push(1);   // Ignore
      if (savedFilters.useful) categories.push(2);   // Useful  
      if (savedFilters.important) categories.push(3); // Important
    } else {
      // Default to all categories if no filters set
      categories.push(1, 2, 3);
    }
    
    // Get current grouping type
    const groupingType = state.popupState?.groupingSelections?.saved || 'category';
    
    // Use DataManager to get filtered and sorted data - same as saved tabs display
    const processedData = await dataManager.getSavedTabsData({
      searchQuery,
      categories,
      groupBy: groupingType,
      sortBy: 'savedDate' // Default sort, but groupBy will determine actual sorting
    });
    
    // Extract all tabs from the processed data
    const allTabs = [];
    
    // The processedData has a groups structure from the aggregation service
    if (processedData.groups) {
      // Iterate through all groups
      Object.values(processedData.groups).forEach(group => {
        if (Array.isArray(group)) {
          // Each group is directly an array of items
          allTabs.push(...group);
        } else if (group.items && Array.isArray(group.items)) {
          // Fallback: group might be an object with items property
          allTabs.push(...group.items);
        }
      });
    } else if (processedData.items && Array.isArray(processedData.items)) {
      // Fallback: if no groups, use items directly
      allTabs.push(...processedData.items);
    }
    
    // Build confirmation message
    const exportCount = allTabs.length;
    let confirmMessage = `Export ${exportCount} saved tab${exportCount === 1 ? '' : 's'} to CSV?`;
    
    // Add filter information if any filters are active
    const filterInfo = [];
    if (searchQuery) filterInfo.push(`Search: "${searchQuery}"`);
    if (categories.length < 3) {
      const categoryNames = categories.map(c => [null, 'Ignore', 'Useful', 'Important'][c]).filter(Boolean);
      filterInfo.push(`Categories: ${categoryNames.join(', ')}`);
    }
    
    if (filterInfo.length > 0) {
      confirmMessage += '\n\nNote: Only filtered records will be exported:\n' + filterInfo.map(info => `- ${info}`).join('\n');
    }
    
    // Get saved ML export preference
    const savedIncludeML = await chrome.storage.local.get('exportIncludeMLData');
    const includeMLDefault = savedIncludeML.exportIncludeMLData || false;
    
    // Show confirmation dialog with ML data checkbox
    const dialogResult = await showConfirmWithCheckboxes(confirmMessage, { 
      confirmText: 'Export',
      cancelText: 'Cancel',
      checkboxes: [
        {
          name: 'includeMLData',
          label: 'Include ML data (predictions and training)',
          checked: includeMLDefault
        }
      ]
    });
    
    if (!dialogResult.confirmed) {
      showStatus('Export cancelled', 'warning');
      return;
    }
    
    // Save ML export preference
    const includeMLData = dialogResult.checkboxes.includeMLData;
    await chrome.storage.local.set({ exportIncludeMLData: includeMLData });
    
    // Proceed with export - instant operation, no loading message needed
    
    // Export the filtered and sorted tabs with ML data option
    const csvContent = await window.tabDatabase.exportAsCSV(allTabs, includeMLData);
    
    // Download the CSV
    downloadCSV(csvContent);
    
    // File downloaded - no success message needed
  } catch (error) {
    console.error('Export error:', error);
    showStatus('Failed to export tabs: ' + error.message, 'error', null, 'csv-export');
  }
}

/**
 * Helper function to download CSV
 */
function downloadCSV(csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const filename = `saved_tabs_${new Date().toISOString().split('T')[0]}.csv`;
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  
  URL.revokeObjectURL(url);
}

/**
 * Handle CSV import
 */
export async function handleCSVImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  try {
    // Reading file is instant - no loading message needed
    
    const csvContent = await readFileAsText(file);
    
    // Show import dialog to confirm
    const dialogResult = await showImportDialog(csvContent);
    
    if (dialogResult.confirmed) {
      const recategorizeAll = dialogResult.checkboxes.recategorizeAll;
      // Parse CSV content to get tabs that need categorization
      const lines = csvContent.split('\n').filter(line => line.trim());
      const headers = parseCSVLine(lines[0]).map(h => h.trim());
      
      // Find column indices - map header names to indices
      const columnMap = {};
      headers.forEach((header, index) => {
        const h = header.toLowerCase();
        // Basic fields
        if (h === 'url' || (h.includes('url') && !h.includes('curl'))) columnMap.url = index;
        if (h === 'title' || h.includes('title')) columnMap.title = index;
        if (h === 'domain' || h.includes('domain')) columnMap.domain = index;
        if (h === 'category' || h.includes('category')) columnMap.category = index;
        if (h === 'firstseen') columnMap.firstSeen = index;
        if (h === 'lastcategorized') columnMap.lastCategorized = index;
        if (h === 'lastaccessed') columnMap.lastAccessed = index;
        if (h === 'favicon') columnMap.favicon = index;
        if (h === 'saveddate') columnMap.savedDate = index;
        if (h === 'firstopened') columnMap.firstOpened = index;
        if (h === 'lastopened') columnMap.lastOpened = index;
        if (h === 'lastclosetime') columnMap.lastCloseTime = index;
        
        // ML Prediction fields
        if (h === 'mlpredictiontimestamp') columnMap.mlPredictionTimestamp = index;
        if (h === 'rulespredict') columnMap.rulesPredict = index;
        if (h === 'rulesconfidence') columnMap.rulesConfidence = index;
        if (h === 'rulesweight') columnMap.rulesWeight = index;
        if (h === 'modelpredict') columnMap.modelPredict = index;
        if (h === 'modelconfidence') columnMap.modelConfidence = index;
        if (h === 'modelweight') columnMap.modelWeight = index;
        if (h === 'llmpredict') columnMap.llmPredict = index;
        if (h === 'llmconfidence') columnMap.llmConfidence = index;
        if (h === 'llmweight') columnMap.llmWeight = index;
        if (h === 'finalpredict') columnMap.finalPredict = index;
        if (h === 'predictionconfidence') columnMap.predictionConfidence = index;
        if (h === 'predictionagreement') columnMap.predictionAgreement = index;
        if (h === 'corrected') columnMap.corrected = index;
        
        // Training data fields
        if (h === 'traintimestamp') columnMap.trainTimestamp = index;
        if (h === 'trainsource') columnMap.trainSource = index;
        if (h === 'trainconfidence') columnMap.trainConfidence = index;
      });
      
      
      if (columnMap.url === undefined || columnMap.title === undefined) {
        throw new Error('CSV must contain URL and Title columns');
      }
      
      // Parse tabs from CSV and check for duplicates upfront
      const tabsToImport = [];
      const tabsNeedingCategorization = [];
      const duplicateUrls = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        
        const values = parseCSVLine(line).map(v => v.trim());
        const url = values[columnMap.url];
        const title = values[columnMap.title];
        
        if (!url || !title) continue; // Skip rows without required fields
        
        // Check for duplicates upfront
        const existingUrl = await window.tabDatabase.getUrlByUrl(url);
        if (existingUrl) {
          duplicateUrls.push(url);
          continue; // Skip duplicate URLs entirely
        }
        
        // Helper to get value or null
        const getValue = (key) => columnMap[key] !== undefined ? values[columnMap[key]] || null : null;
        const getNumber = (key) => {
          const val = getValue(key);
          return val ? (parseFloat(val) || null) : null;
        };
        const getInt = (key) => {
          const val = getValue(key);
          return val ? (parseInt(val) || null) : null;
        };
        const getBool = (key) => {
          const val = getValue(key);
          return val === 'true' || val === '1';
        };
        
        // Convert UTC timestamp to appropriate format
        const getTimestamp = (key, asEpoch = false) => {
          const val = getValue(key);
          if (!val) return null;
          // Try to parse as ISO date string
          const date = new Date(val);
          if (!isNaN(date.getTime())) {
            return asEpoch ? date.getTime() : date.toISOString();
          }
          // If it's already a number (epoch), handle appropriately
          const epoch = parseInt(val);
          if (!isNaN(epoch)) {
            return asEpoch ? epoch : new Date(epoch).toISOString();
          }
          return null;
        };
        
        // Extract all fields
        const tabData = {
          url,
          title,
          domain: getValue('domain') || window.tabDatabase.extractDomain(url),
          category: recategorizeAll ? 0 : (getInt('category') || 0),
          // Temporal fields
          firstSeen: getTimestamp('firstSeen'),
          lastCategorized: getTimestamp('lastCategorized'),
          lastAccessed: getTimestamp('lastAccessed'),
          favicon: getValue('favicon'),
          savedDate: getTimestamp('savedDate'),
          firstOpened: getTimestamp('firstOpened'),
          lastOpened: getTimestamp('lastOpened'),
          lastCloseTime: getTimestamp('lastCloseTime'),
          // ML fields (only if not recategorizing)
          mlData: !recategorizeAll ? (() => {
            const hasPredictionData = getValue('mlPredictionTimestamp');
            const hasTrainingData = getValue('trainTimestamp');
            
            if (!hasPredictionData && !hasTrainingData) {
              return null;
            }
            
            const mlDataObj = {};
            
            // Add prediction data if available
            if (hasPredictionData) {
              mlDataObj.prediction = {
                timestamp: getTimestamp('mlPredictionTimestamp', true), // ML DB expects epoch
                rules: getInt('rulesPredict'),
                rulesConfidence: getNumber('rulesConfidence'),
                rulesWeight: getNumber('rulesWeight'),
                model: getInt('modelPredict'),
                modelConfidence: getNumber('modelConfidence'),
                modelWeight: getNumber('modelWeight'),
                llm: getInt('llmPredict'),
                llmConfidence: getNumber('llmConfidence'),
                llmWeight: getNumber('llmWeight'),
                final: getInt('finalPredict'),
                confidence: getNumber('predictionConfidence'),
                agreement: getNumber('predictionAgreement'),
                corrected: getBool('corrected')
              };
            }
            
            // Add training data if available
            if (hasTrainingData) {
              mlDataObj.training = {
                timestamp: getTimestamp('trainTimestamp', true), // ML DB expects epoch
                source: getValue('trainSource') || 'csv_import',
                trainConfidence: getNumber('trainConfidence')
              };
            }
            
            return mlDataObj;
          })() : null
        };
        
        
        tabsToImport.push(tabData);
        
        // If category is 0 or invalid, it needs categorization
        if (!tabData.category || tabData.category < 1 || tabData.category > 3) {
          tabsNeedingCategorization.push(tabData);
        }
      }
      
      
      let categorizationResult = null;
      let duplicates = duplicateUrls.length;
      let imported = 0;
      
      // Early exit if no new tabs to import
      if (tabsToImport.length === 0) {
        showStatus(`No new tabs to import (all ${duplicates} were already saved)`, 'warning', null, 'csv-import');
        return;
      }
      
      // Categorize tabs that need it using batch processing
      if (tabsNeedingCategorization.length > 0) {
        // Set up progress tracking for categorization
        const updateProgress = (progress) => {
          const progressPercent = Math.round((progress.processed / progress.total) * 100);
          let statusMessage;
          
          if (progress.status === 'processing') {
            // If only one batch, show simpler message
            if (progress.totalBatches === 1) {
              statusMessage = `Categorizing ${progress.total} tabs (${progressPercent}%)`;
            } else {
              statusMessage = `Categorizing batch ${progress.currentBatch}/${progress.totalBatches} (${progressPercent}%)`;
            }
            showStatus(statusMessage, 'loading', 0, 'csv-categorization');
          } else if (progress.status === 'completed') {
            // Update to show completion
            if (progress.totalBatches === 1) {
              statusMessage = `Categorized ${progress.total} tabs`;
            } else {
              statusMessage = `Categorized ${progress.totalBatches} batches (${progress.total} tabs)`;
            }
            showStatus(statusMessage, 'info', 5000, 'csv-categorization');
          }
        };
        
        // Import batch categorization function
        const { categorizeBatches } = await import('./categorization-service.js');
        
        // Use batch categorization - this handles EVERYTHING including saving
        categorizationResult = await categorizeBatches(tabsNeedingCategorization, {
          batchSize: state.settings?.batchSize || LIMITS.BATCH_SIZE_CSV,
          onProgress: updateProgress,
          settings: state.settings,
          source: 'csv_import'
        });
        
      } else {
        // All tabs are already categorized - save them directly
        const categorizedTabs = {
          0: [],
          1: [],
          2: [],
          3: []
        };
        
        tabsToImport.forEach(tab => {
          if (tab.category >= 0 && tab.category <= 3) {
            categorizedTabs[tab.category].push(tab);
          }
        });
        
        // Save pre-categorized tabs to database
        const unifiedDB = await getUnifiedDatabase();
        await unifiedDB.saveCategorizedTabs(categorizedTabs, {
          source: 'csv_import', 
          savedAt: Date.now()
        }, {}); // No predictions for pre-categorized tabs
        
        categorizationResult = categorizedTabs;
      }
      
      // Ensure we have a result
      if (!categorizationResult) {
        categorizationResult = {
          0: [],
          1: [],
          2: [],
          3: []
        };
      }
      
      // Count imported tabs
      imported = Object.values(categorizationResult)
        .filter(tabs => Array.isArray(tabs))
        .reduce((sum, tabs) => sum + tabs.length, 0);
      
      // Create result object
      const result = {
        imported,
        duplicates,
        savedTabs: [], // Not used in new path
        categorized: categorizationResult ? 
          Object.values(categorizationResult).flat().length : 0,
        categorizedByRules: 0 // Will be calculated by categorization process
      };
      
      // Build status message
      let statusMessage;
      const details = [];
      
      if (result.imported === 0 && result.duplicates > 0) {
        // All tabs were duplicates
        statusMessage = `No new tabs imported (all ${result.duplicates} were already saved)`;
      } else if (result.imported === 0) {
        // No valid tabs found
        statusMessage = 'No valid tabs found in CSV file';
      } else {
        // Normal import
        statusMessage = `Imported ${result.imported} tabs`;
        
        if (result.duplicates > 0) {
          details.push(`${result.duplicates} duplicates skipped`);
        }
        
        if (result.categorizedByRules > 0) {
          details.push(`${result.categorizedByRules} categorized by rules`);
        }
        
        if (result.categorized > 0) {
          details.push(`${result.categorized} categorized by AI`);
        }
        
        if (details.length > 0) {
          statusMessage += ` (${details.join(', ')})`;
        }
      }
      
      // Only show status once
      showStatus(statusMessage, result.imported > 0 ? 'success' : 'warning', null, 'csv-import');
      
      // Update saved tabs badge
      const { loadSavedTabsCount } = await import('./saved-tabs-manager.js');
      await loadSavedTabsCount();
      
      // Refresh saved tabs view if currently showing
      if (state.popupState.activeTab === TAB_TYPES.SAVED) {
        await showSavedTabsContent();
      }
    }
  } catch (error) {
    console.error('Import error:', error);
    
    // Handle different error types
    let errorMessage = 'Failed to import tabs';
    if (error instanceof Error) {
      errorMessage += ': ' + error.message;
    } else if (error && error.type === 'error') {
      // Worker error event
      errorMessage += ': Worker error during import';
    } else if (typeof error === 'string') {
      errorMessage += ': ' + error;
    }
    
    showStatus(errorMessage, 'error', null, 'csv-import');
  }
  
  // Reset file input
  event.target.value = '';
}

/**
 * Read file as text
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Build list of enabled categorization methods
 */
function buildCategorizationMethodsList(settings) {
  const methods = [];
  
  // Rules are always available if configured
  if (settings.rules && settings.rules.length > 0) {
    const enabledRules = settings.rules.filter(r => r.enabled).length;
    if (enabledRules > 0) {
      methods.push(`- Rule-based categorization (${enabledRules} active rules)`);
    }
  }
  
  // ML (Machine Learning) - check if enabled
  if (settings.useML !== false) {
    methods.push('- Machine Learning categorization');
  }
  
  // LLM (Language Model) - check if enabled and configured
  if (settings.useLLM && settings.apiKeys && settings.apiKeys[settings.provider]) {
    methods.push(`- ${settings.provider} AI categorization`);
  }
  
  // If no methods are enabled, show warning
  if (methods.length === 0) {
    return '⚠️ No categorization methods are enabled. Tabs will remain uncategorized.';
  }
  
  return methods.join('\n');
}

/**
 * Show import confirmation dialog
 */
async function showImportDialog(csvContent) {
  // Simple preview of the CSV
  const lines = csvContent.split('\n').filter(line => line.trim());
  const rowCount = lines.length - 1; // Minus header
  
  const methodsList = buildCategorizationMethodsList(state.settings);
  
  const message = `Import ${rowCount} rows from CSV?\n\n` +
    (methodsList ? 
      `Tabs without categories will be categorized using:\n${methodsList}` :
      `⚠️ No categorization methods are enabled. Tabs will remain uncategorized.`
    );
  
  const dialogResult = await showConfirmWithCheckboxes(message, { 
    confirmText: 'Import',
    cancelText: 'Cancel',
    checkboxes: [
      {
        name: 'recategorizeAll',
        label: 'Ignore categories and recategorize all tabs',
        checked: false
      }
    ]
  });
  
  return dialogResult;
}

/**
 * Initialize import/export functionality
 */
export function initializeImportExport() {
  // Set up export button
  const exportBtn = $id(DOM_IDS.EXPORT_CSV_BTN);
  if (exportBtn) {
    exportBtn.addEventListener('click', exportToCSV);
  }
  
  // Set up import button
  const importBtn = $id(DOM_IDS.IMPORT_CSV_BTN);
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      const fileInput = $id(DOM_IDS.CSV_FILE_INPUT);
      if (fileInput) {
        fileInput.click();
      }
    });
  }
  
  // Set up file input handler
  const fileInput = $id(DOM_IDS.CSV_FILE_INPUT);
  if (fileInput) {
    fileInput.addEventListener('change', handleCSVImport);
  }
}

// Export default object
export default {
  exportToCSV,
  handleCSVImport,
  initializeImportExport
};