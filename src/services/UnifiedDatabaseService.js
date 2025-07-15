/*
 * AI Tab Manager - Unified Database Service
 * Wraps main database operations with ML data synchronization
 */

import { addTrainingData } from '../ml/storage/ml-database.js';
import { getMLCategorizer } from '../ml/categorization/ml-categorizer.js';
import { getModelTrainer } from '../ml/training/trainer.js';
import { calculateFeaturesForTrainingData } from '../ml/features/feature-calculator.js';
import { state } from '../modules/state-manager.js';

/**
 * Unified Database Service
 * Wraps database operations with automatic ML synchronization
 */
class UnifiedDatabaseService {
  constructor() {
    this.mainDatabase = null; // Will be window.tabDatabase
    this.mlEnabled = true;
    this.pendingRetraining = false;
    this.newDataCount = 0;
    this.RETRAIN_THRESHOLD = 50; // Retrain when 50 new examples accumulated
  }

  /**
   * Initialize the service
   */
  async initialize() {
    // Wait for main database to be available
    if (typeof window !== 'undefined' && window.tabDatabase) {
      this.mainDatabase = window.tabDatabase;
    } else {
      throw new Error('Main database not available');
    }
    
    this.mlEnabled = state.settings?.useML !== false;
  }

  /**
   * Save categorized tabs with ML synchronization
   * @param {Object} categorizedTabs - Tabs grouped by category
   * @param {Object} metadata - Save metadata
   * @param {Object} predictions - Optional: ML/rules/LLM predictions for accuracy tracking
   * @returns {Promise<Array>} Save results
   */
  async saveCategorizedTabs(categorizedTabs, metadata = {}, predictions = null) {
    try {
      // Save to main database first - check which method is available
      let saveResults;
      if (this.mainDatabase.saveTabs) {
        // New database_v2.js API
        saveResults = await this.mainDatabase.saveTabs(categorizedTabs, metadata);
      } else if (this.mainDatabase.saveCategorizedTabs) {
        // Old database.js API
        saveResults = await this.mainDatabase.saveCategorizedTabs(categorizedTabs);
      } else {
        throw new Error('No compatible save method found in database');
      }
      
      // ALWAYS sync to ML database to collect training data
      // This ensures we have data ready when ML is re-enabled
      const source = metadata?.source || 'categorization_save';
      await this._syncToMLDatabase(categorizedTabs, metadata, source, predictions);
      
      // Record predictions for accuracy assessment if provided
      if (predictions) {
        await this._recordPredictionAccuracy(categorizedTabs, predictions);
      }
      
      // Only check for retraining if ML is enabled
      if (this.mlEnabled) {
        this._checkRetrainingNeed();
      }
      
      return saveResults;
    } catch (error) {
      console.error('Error in saveCategorizedTabs:', error);
      throw error;
    }
  }

  /**
   * Save single tab (usually from manual categorization)
   * @param {Object} tabData - Tab data
   * @param {number} category - Category (1-3)
   * @param {Object} predictions - Optional: predictions for accuracy tracking
   * @returns {Promise<number>} Saved tab ID
   */
  async saveTab(tabData, category, predictions = null) {
    const categorizedTabs = { [category]: [tabData] };
    const metadata = { source: 'manual_categorization', savedAt: Date.now() };
    return this.saveCategorizedTabs(categorizedTabs, metadata, predictions);
  }

  /**
   * Update tab category (user correction)
   * @param {string} url - Tab URL
   * @param {number} oldCategory - Previous category
   * @param {number} newCategory - New category
   * @param {string} source - Source of change ('user_correction', 'import', etc.)
   * @returns {Promise<void>}
   */
  async updateTabCategory(url, oldCategory, newCategory, source = 'user_correction') {
    try {
      // Update main database
      if (this.mainDatabase.updateUrlCategory) {
        await this.mainDatabase.updateUrlCategory(url, newCategory);
      } else {
        // Fallback: get tab data and re-save
        const tabs = await this.mainDatabase.getAllSavedTabs();
        const tab = tabs.find(t => t.url === url);
        if (tab) {
          tab.category = newCategory;
          await this.mainDatabase.saveTabs({ [newCategory]: [tab] }, { 
            source: 'category_update',
            updatedAt: Date.now() 
          });
        }
      }

      if (this.mlEnabled && source === 'user_correction') {
        // Update accuracy metrics in performance tracker
        try {
          const { getPerformanceTracker } = await import('../ml/trust/performance-tracker.js');
          const perfTracker = getPerformanceTracker();
          await perfTracker.handleCategoryChange(url, oldCategory, newCategory);
          
          // Update ML dashboard if it's visible
          if (typeof window !== 'undefined' && window.document) {
            const settingsTab = window.document.getElementById('settingsTab');
            if (settingsTab && settingsTab.classList.contains('active')) {
              const { updateMLStatus } = await import('../modules/ml-dashboard.js');
              await updateMLStatus();
            }
          }
        } catch (perfError) {
          console.error('Error updating performance metrics:', perfError);
        }
        
        // Process through ML categorizer for learning
        // This will update existing training data instead of creating duplicates
        try {
          const mlCategorizer = await getMLCategorizer();
          const tab = await this._getTabData(url);
          if (tab) {
            await mlCategorizer.processCorrection(
              tab,
              oldCategory,
              newCategory,
              { timestamp: Date.now() }
            );
            this.newDataCount++; // Increment counter since processCorrection handled the update
          }
        } catch (mlError) {
          // ML error already logged in processCorrection
        }
      }
      
    } catch (error) {
      console.error('Error updating tab category:', error);
      throw error;
    }
  }

  /**
   * Delete tab(s) with ML cleanup
   * @param {string|number|Array<string|number>} urlsOrIds - URL(s) or ID(s) to delete
   * @returns {Promise<void>}
   */
  async deleteTabs(urlsOrIds) {
    const inputArray = Array.isArray(urlsOrIds) ? urlsOrIds : [urlsOrIds];
    const urlsToDelete = [];
    
    try {
      // First, collect all URLs we're about to delete
      // This is important because we need URLs for ML cleanup
      for (const urlOrId of inputArray) {
        if (typeof urlOrId === 'number') {
          // It's an ID - get the URL from cache
          if (window.tabDatabase && window.tabDatabase.cache.initialized) {
            const urlRecord = window.tabDatabase.cache.urlsById.get(urlOrId);
            if (urlRecord && urlRecord.url) {
              urlsToDelete.push(urlRecord.url);
            }
          }
        } else {
          // It's already a URL
          urlsToDelete.push(urlOrId);
        }
      }
      
      // Delete from main database
      for (const urlOrId of inputArray) {
        if (typeof urlOrId === 'number') {
          // Delete by ID
          await this.mainDatabase.deleteUrl(urlOrId);
        } else if (this.mainDatabase.deleteUrl) {
          // Delete by URL - need to find ID first
          const urlRecord = window.tabDatabase.cache.urls.get(urlOrId);
          if (urlRecord) {
            await this.mainDatabase.deleteUrl(urlRecord.id);
          }
        } else {
          // Fallback for older database versions
          await this.mainDatabase.deleteSavedTab(urlOrId);
        }
      }

      // ALWAYS clean up ML data, regardless of whether ML is currently enabled
      // Users might disable ML but still need to delete old ML data
      await this._cleanupMLData(urlsToDelete);
      
      // Update ML dashboard if it's visible AND ML is enabled
      if (this.mlEnabled) {
        try {
          if (typeof window !== 'undefined' && window.document) {
            const settingsTab = window.document.getElementById('settingsTab');
            if (settingsTab && settingsTab.classList.contains('active')) {
              const { updateMLStatus } = await import('../modules/ml-dashboard.js');
              await updateMLStatus();
            }
          }
        } catch (error) {
          // Silently fail - UI update is not critical
          console.debug('Could not update ML dashboard:', error);
        }
      }
      
    } catch (error) {
      console.error('Error deleting tabs:', error);
      throw error;
    }
  }

  /**
   * Import tabs from CSV with ML sync
   * @param {string} csvContent - CSV content
   * @param {Object} settings - Import settings
   * @returns {Promise<Object>} Import results
   */
  async importFromCSV(csvContent, settings = {}) {
    try {
      // Use main database import with some modifications for ML sync
      // Import to main database
      const importResults = await this.mainDatabase.importFromCSV(csvContent, settings);
      
      // CSV imports don't have prediction confidence data, so we cannot add them to ML training
      // This is by design - training data should only come from:
      // 1. Fresh categorization with predictions and confidence scores
      // 2. User manual corrections
      // CSV imports are already-categorized data without confidence information
      
      return importResults;
    } catch (error) {
      console.error('Error in CSV import:', error);
      throw error;
    }
  }

  /**
   * Get ML prediction for new tab
   * @param {Object} tabData - Tab data (url, title)
   * @returns {Promise<Object>} Prediction result
   */
  async getMLPrediction(tabData) {
    if (!this.mlEnabled) {
      return { category: null, confidence: 0, source: 'ml_disabled' };
    }

    try {
      const mlCategorizer = await getMLCategorizer();
      // Ensure tab has an id for ML processing
      const tabWithId = { ...tabData, id: tabData.id || tabData.url };
      
      // Use the new method to get single ML prediction without ensemble voting
      const result = await mlCategorizer.getSingleMLPrediction(tabWithId);
      
      return result;
    } catch (error) {
      // Error getting ML prediction, return default
    }
    
    return { category: null, confidence: 0, source: 'ml_error' };
  }

  /**
   * Get count of available training data
   * @returns {Promise<number>}
   */
  async getTrainingDataCount() {
    try {
      // Get actual ML training data count (not saved tabs)
      const { getTrainingData } = await import('../ml/storage/ml-database.js');
      const mlTrainingData = await getTrainingData(10000); // Get all training data
      
      // Filter for valid training data with confidence > 0 (same as trainer does)
      const validData = mlTrainingData.filter(item => 
        item.category !== undefined && 
        item.category !== null &&
        Number.isInteger(item.category) &&
        item.category >= 0 && 
        item.category <= 3 &&
        (item.trainingConfidence || 0) > 0
      );
      
      return validData.length;
    } catch (error) {
      console.error('Error getting training data count:', error);
      return 0;
    }
  }

  /**
   * Trigger background model retraining
   * @param {boolean} force - Force retraining even if threshold not met
   * @returns {Promise<void>}
   */
  async triggerRetraining(force = false) {
    if (!this.mlEnabled || (this.pendingRetraining && !force)) {
      return;
    }

    try {
      this.pendingRetraining = true;
      
      // Check if we have enough training data before attempting to train
      const { ML_CONFIG } = await import('../ml/model-config.js');
      const trainingDataCount = await this.getTrainingDataCount();
      if (trainingDataCount < ML_CONFIG.training.minTrainingExamples) {
        console.log(`Training skipped: Only ${trainingDataCount} examples (minimum: ${ML_CONFIG.training.minTrainingExamples})`);
        this.newDataCount = 0; // Reset counter
        return;
      }
      
      
      const trainer = await getModelTrainer();
      await trainer.trainModel({ 
        backgroundTraining: true,
        maxTrainingTime: 30000 // 30 second limit
      });
      
      this.newDataCount = 0;
      
    } catch (error) {
      console.error('Background retraining failed:', error);
    } finally {
      this.pendingRetraining = false;
    }
  }

  // REMOVED: syncExistingSavedTabs - This function violated the principle that
  // already categorized tabs should never be added to training data without
  // their original prediction confidence. Training data should only come from:
  // 1. Fresh categorization with predictions
  // 2. User manual corrections

  // --- Private Methods ---

  /**
   * Sync categorized tabs to ML database
   * @private
   */
  async _syncToMLDatabase(categorizedTabs, metadata, source, predictions) {
    try {
      // Assert: We should NEVER sync already-categorized tabs without predictions OR training data
      // Check if any tabs have training data (from manual categorization)
      let hasTrainingData = false;
      if ((!predictions || Object.keys(predictions).length === 0) && categorizedTabs) {
        
        // Check if any categorized tabs have training metadata
        for (const category of Object.keys(categorizedTabs)) {
          const categoryTabs = categorizedTabs[category];
          if (categoryTabs && categoryTabs.length > 0) {
            
            const hasTrainingInCategory = categoryTabs.some(tab => {
              const hasTraining = tab.mlData && tab.mlData.training && 
                tab.mlData.training.timestamp && 
                tab.mlData.training.source && 
                tab.mlData.training.trainConfidence !== undefined;
              return hasTraining;
            });
            
            if (hasTrainingInCategory) {
              hasTrainingData = true;
              break;
            }
          }
        }
        
      }

      if (!hasTrainingData && (!predictions || Object.keys(predictions).length === 0)) {
        console.error('🚨 CRITICAL: Attempting to sync categorized tabs to ML without predictions or training data!', {
          categorizedTabs,
          metadata,
          source,
          predictionsCount: predictions ? Object.keys(predictions).length : 0,
          hasTrainingData
        });
        throw new Error('Cannot add already-categorized tabs to ML training without their original predictions or training metadata. This violates the principle that training data must come from fresh categorization or user corrections.');
      }
      
      
      
      // Convert categorized tabs to ML training format
      const trainingData = [];
      
      // Handle all categories if they exist
      Object.keys(categorizedTabs).forEach(category => {
        const categoryNum = parseInt(category);
        if (categorizedTabs[categoryNum] && categoryNum >= 1 && categoryNum <= 3) {
          categorizedTabs[categoryNum].forEach(tab => {
            // Get prediction data for this tab (predictions are indexed by URL)
            const predictionData = predictions?.[tab.url] || {};
            
            // Check if this tab has training data (from manual categorization)
            const hasTrainingData = tab.mlData && tab.mlData.training && 
              tab.mlData.training.timestamp && 
              tab.mlData.training.source && 
              tab.mlData.training.trainConfidence !== undefined;
            
            // Skip tabs without predictions AND without training data
            if ((!predictionData || Object.keys(predictionData).length === 0) && !hasTrainingData) {
              console.warn(`Skipping tab ${tab.url} - categorized without predictions or training data. This violates design principles.`);
              return; // Skip this tab
            }
            
            let combinedConfidence, corrected, trainingConfidence;
            
            if (hasTrainingData && (!predictionData || Object.keys(predictionData).length === 0)) {
              // Use training data directly (from manual categorization/CSV import)
              const trainingData = tab.mlData.training;
              combinedConfidence = trainingData.trainConfidence;
              corrected = trainingData.source === 'user_correction' || trainingData.source === 'manual';
              trainingConfidence = trainingData.trainConfidence;
            } else {
              // Use prediction data (from fresh categorization)
              combinedConfidence = predictionData.combinedConfidence || 0;
              corrected = predictionData.corrected || false;
              
              // Calculate training confidence excluding ML predictions
              trainingConfidence = 0;
              
              if (corrected || source === 'user_correction') {
                // User corrections always get maximum confidence
                trainingConfidence = 1.0;
              } else if (predictionData.confidences && predictionData.weights) {
              // Apply trust weights to get weighted confidences first
              const { rules, llm } = predictionData.confidences;
              const weights = predictionData.weights;
              
              // Get weighted confidences
              const weightedConfidences = [];
              if (rules !== undefined && weights.rules) {
                weightedConfidences.push((rules || 1.0) * weights.rules);
              }
              if (llm !== undefined && weights.llm) {
                weightedConfidences.push((llm || 0.8) * weights.llm);
              }
              
              if (weightedConfidences.length === 0) {
                trainingConfidence = 0.5;
              } else if (weightedConfidences.length === 1) {
                // Single method - use its weighted confidence
                trainingConfidence = weightedConfidences[0];
              } else {
                // Multiple methods - check if they agree
                // Look for predictions in the right place - they might be at the top level
                let rulesCategory, llmCategory;
                
                if (predictionData.predictions) {
                  rulesCategory = predictionData.predictions.rules;
                  llmCategory = predictionData.predictions.llm;
                } else if (predictionData.rules !== undefined || predictionData.llm !== undefined) {
                  // Predictions might be at top level (legacy format)
                  // Check if they are objects with category property
                  if (typeof predictionData.rules === 'object' && predictionData.rules?.category !== undefined) {
                    rulesCategory = predictionData.rules.category;
                  } else {
                    rulesCategory = predictionData.rules;
                  }
                  
                  if (typeof predictionData.llm === 'object' && predictionData.llm?.category !== undefined) {
                    llmCategory = predictionData.llm.category;
                  } else {
                    llmCategory = predictionData.llm;
                  }
                }
                
                if (rulesCategory === llmCategory && rulesCategory !== undefined) {
                  // They agree - use multiplicative combination for boost
                  // P(correct) = 1 - ∏(1 - weighted_conf_i)
                  let probAllWrong = 1;
                  for (const wc of weightedConfidences) {
                    probAllWrong *= (1 - wc);
                  }
                  trainingConfidence = 1 - probAllWrong;
                } else {
                  // They disagree or one is undefined - use average
                  trainingConfidence = weightedConfidences.reduce((a, b) => a + b, 0) / weightedConfidences.length;
                }
              }
              } else {
                // No weights or confidence data - THIS SHOULD NEVER HAPPEN
                console.error(`🚨 CRITICAL: Tab ${tab.url} has no prediction confidence data!`, {
                  tab,
                  predictionData,
                  metadata,
                  source,
                  corrected
                });
                throw new Error(`Tab ${tab.url} is missing prediction confidence data. Training data can only be created from: 1) Fresh categorization with predictions, or 2) User manual corrections`);
              }
            }
            
            trainingData.push({
              url: tab.url,
              title: tab.title || '',
              category: categoryNum,
              source: source,
              corrected: corrected,
              combinedConfidence: combinedConfidence,
              trainingConfidence: trainingConfidence,
              metadata: {
                // Don't spread the entire metadata object - it contains mlMetadata for ALL tabs
                source: metadata.source || source,
                agreement: predictionData.agreement,
                strategy: predictionData.strategy
                // Don't set addedToML here - it should only be set when model is actually trained on this data
                // The incremental trainer will set addedToML when it uses this data for training
              }
              // Note: Features will be calculated in bulk after vocabulary is loaded
            });
          });
        }
      });
      
      // Calculate features for all training data BEFORE database operations
      const trainingDataWithFeatures = await Promise.all(
        trainingData.map(data => calculateFeaturesForTrainingData(data))
      );
      
      // Add ALL training data to ML database (no filtering - we'll use confidence as weights)
      let addedCount = 0;
      
      for (const data of trainingDataWithFeatures) {
        await addTrainingData(data);
        this.newDataCount++;
        addedCount++;
        
      }
      
      // Log summary with confidence distribution
      const confidenceDistribution = trainingDataWithFeatures.reduce((acc, data) => {
        const bucket = Math.floor(data.trainingConfidence * 10) / 10; // Round to nearest 0.1
        acc[bucket] = (acc[bucket] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`📊 ML Training Data: Added ${addedCount} tabs`);
      console.log(`   Confidence distribution:`, confidenceDistribution);
      
    } catch (error) {
      console.error('Error syncing to ML database:', error);
    }
  }

  /**
   * Record prediction accuracy
   * @private
   */
  async _recordPredictionAccuracy(categorizedTabs, predictions) {
    try {
      // Compare predictions with actual user choices
      [1, 2, 3].forEach(category => {
        if (categorizedTabs[category]) {
          categorizedTabs[category].forEach(tab => {
            const prediction = predictions[tab.url];
            if (prediction) {
              // Note: We don't update prediction correctness here anymore
              // The prediction's 'corrected' field is only set to true when user manually changes category
            }
          });
        }
      });
    } catch (error) {
      console.error('Error recording prediction accuracy:', error);
    }
  }


  /**
   * Get tab data by URL
   * @private
   */
  async _getTabData(url) {
    try {
      const tabs = await this.mainDatabase.getAllSavedTabs();
      return tabs.find(tab => tab.url === url);
    } catch (error) {
      console.error('Error getting tab data:', error);
      return null;
    }
  }

  /**
   * Cleanup ML data for deleted tabs
   * @private
   */
  async _cleanupMLData(urls) {
    try {
      // Import the centralized ML deletion function
      const { deleteUrlFromMLDatabase } = await import('../ml/storage/ml-database.js');
      
      // Delete all ML data for each URL (predictions, training data, etc.)
      for (const url of urls) {
        await deleteUrlFromMLDatabase(url);
      }
    } catch (error) {
      console.error('Error cleaning up ML data:', error);
      // Don't fail the main deletion if ML cleanup fails
    }
  }

  /**
   * Check if retraining is needed
   * @private
   */
  _checkRetrainingNeed() {
    if (this.newDataCount >= this.RETRAIN_THRESHOLD && !this.pendingRetraining) {
      console.log(`Retraining threshold reached (${this.newDataCount} new examples)`);
      // Schedule retraining in background
      setTimeout(() => this.triggerRetraining(), 5000); // 5 second delay
    }
  }
  
  /**
   * Update ML enabled state
   * @param {boolean} enabled - Whether ML is enabled
   */
  updateMLEnabled(enabled) {
    this.mlEnabled = enabled;
    console.log(`UnifiedDatabaseService: ML ${enabled ? 'enabled' : 'disabled'}`);
  }
}

// Create singleton instance
let unifiedDatabaseInstance = null;

export async function getUnifiedDatabase() {
  if (!unifiedDatabaseInstance) {
    unifiedDatabaseInstance = new UnifiedDatabaseService();
    await unifiedDatabaseInstance.initialize();
  }
  return unifiedDatabaseInstance;
}

export default {
  getUnifiedDatabase,
  UnifiedDatabaseService
};