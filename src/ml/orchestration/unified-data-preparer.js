/*
 * AI Tab Manager - Unified Data Preparer
 * Single data preparation pipeline for all training scenarios
 */

import { ML_CONFIG } from '../model-config.js';
import logger from '../../utils/logger.js';

/**
 * Unified Data Preparer
 * Consolidates data preparation logic from multiple sources
 */
export class UnifiedDataPreparer {
  
  /**
   * Prepare training data for the given configuration
   * @param {Object} config - Training configuration
   * @returns {Object} Prepared training data { training, validation }
   */
  async prepare(config) {
    logger.mlTraining(`🔄 Preparing ${config.context} training data...`);

    try {
      // 1. Load raw training data based on context
      const rawData = await this.loadRawData(config);
      
      // 2. Apply data validation and filtering
      const filteredData = await this.validateAndFilter(rawData, config);
      
      // 3. Split into training and validation sets
      const splitData = await this.splitData(filteredData, config);
      
      // 4. Apply balancing if needed
      const balancedData = await this.balanceData(splitData, config);
      
      // 5. Extract and cache features
      const finalData = await this.extractFeatures(balancedData, config);

      logger.mlTraining(`✅ Data preparation complete:`, {
        training: finalData.training.length,
        validation: finalData.validation.length,
        context: config.context
      });

      return finalData;
      
    } catch (error) {
      logger.error('Error preparing training data:', error);
      throw new Error(`Data preparation failed: ${error.message}`);
    }
  }

  /**
   * Load raw training data based on context
   */
  async loadRawData(config) {
    switch (config.context) {
      case 'incremental':
        return this.loadIncrementalData(config);
        
      case 'manual':
      case 'background':
      case 'auto':
      default:
        return this.loadStandardTrainingData(config);
    }
  }

  /**
   * Load data for incremental training (new data since last training)
   */
  async loadIncrementalData(config) {
    try {
      // Get the cutoff timestamp for new data
      const { getTabClassifier } = await import('../models/tab-classifier.js');
      const classifier = await getTabClassifier();
      const trainedUpTo = classifier.metadata?.trainedUpTo || 0;

      // Load training data since last training
      const { getMLTrainingData } = await import('../storage/ml-database.js');
      const allData = await getMLTrainingData();
      
      // Filter for new data only
      const newData = allData.filter(item => {
        const itemTimestamp = item.timestamp || item.createdAt || item.lastAccessed || 0;
        return itemTimestamp > trainedUpTo;
      });

      logger.mlTraining(`🔄 Incremental training: ${newData.length} new samples since ${new Date(trainedUpTo).toISOString()}`);
      
      return newData;
      
    } catch (error) {
      logger.error('Error loading incremental data:', error);
      // Fallback to standard data if incremental fails
      return this.loadStandardTrainingData(config);
    }
  }

  /**
   * Load standard training data from ML database
   */
  async loadStandardTrainingData(config) {
    try {
      const { getMLTrainingData } = await import('../storage/ml-database.js');
      return await getMLTrainingData();
    } catch (error) {
      logger.error('Error loading ML training data:', error);
      
      // Fallback: convert saved tabs to training data
      return this.convertSavedTabsToTrainingData();
    }
  }

  /**
   * Convert saved tabs to training data format (fallback)
   */
  async convertSavedTabsToTrainingData() {
    try {
      logger.mlTraining('📋 Converting saved tabs to training data (fallback)');
      
      // Get saved tabs from main database
      const savedTabs = await window.tabDatabase.getAllSavedTabs();
      
      // Filter for categorized tabs only
      const categorized = savedTabs.filter(tab => tab.category && tab.category > 0);
      
      // Convert to training data format
      return categorized.map(tab => ({
        url: tab.url,
        title: tab.title,
        category: tab.category,
        trainingConfidence: 0.9, // High confidence for user-saved tabs
        combinedConfidence: 0.9,
        source: 'saved_tabs',
        timestamp: tab.savedAt || tab.lastAccessed || Date.now()
      }));
      
    } catch (error) {
      logger.error('Error converting saved tabs:', error);
      throw new Error('No training data available');
    }
  }

  /**
   * Validate and filter training data
   */
  async validateAndFilter(data, config) {
    if (!data || data.length === 0) {
      throw new Error('No training data available');
    }

    // Filter out invalid entries
    const filtered = data.filter(item => {
      // Must have URL and title
      if (!item.url || !item.title) return false;
      
      // Must have valid category
      if (!item.category || item.category <= 0) return false;
      
      // Must have confidence > 0 (exclude zero-confidence excluded tabs)
      if (!item.trainingConfidence || item.trainingConfidence <= 0) return false;
      
      return true;
    });

    // Deduplicate by URL (keep most recent)
    const deduped = this.deduplicateByUrl(filtered);

    logger.mlTraining(`🔍 Data filtering: ${data.length} → ${filtered.length} → ${deduped.length} (filtered → deduped)`);

    // Check minimum data requirements
    if (deduped.length < ML_CONFIG.training.minTrainingExamples) {
      throw new Error(`Insufficient training data: ${deduped.length} (minimum: ${ML_CONFIG.training.minTrainingExamples})`);
    }

    return deduped;
  }

  /**
   * Deduplicate training data by URL, keeping most recent
   */
  deduplicateByUrl(data) {
    const urlMap = new Map();
    
    data.forEach(item => {
      const existing = urlMap.get(item.url);
      if (!existing) {
        urlMap.set(item.url, item);
      } else {
        // Keep the one with higher confidence, or more recent timestamp
        const itemTime = item.timestamp || item.lastAccessed || 0;
        const existingTime = existing.timestamp || existing.lastAccessed || 0;
        
        if (item.trainingConfidence > existing.trainingConfidence || 
            (item.trainingConfidence === existing.trainingConfidence && itemTime > existingTime)) {
          urlMap.set(item.url, item);
        }
      }
    });
    
    return Array.from(urlMap.values());
  }

  /**
   * Split data into training and validation sets
   */
  async splitData(data, config) {
    try {
      // Use the existing random data generator for consistent splitting
      const { RandomDataGenerator } = await import('../training/random-data-generator.js');
      const generator = new RandomDataGenerator(data);
      
      const { trainData, validData } = generator.splitDataRandomly(config.validationSplit || 0.2);
      
      return {
        training: trainData,
        validation: validData
      };
      
    } catch (error) {
      logger.error('Error splitting data:', error);
      
      // Fallback: simple split
      const splitIndex = Math.floor(data.length * 0.8);
      return {
        training: data.slice(0, splitIndex),
        validation: data.slice(splitIndex)
      };
    }
  }

  /**
   * Apply class balancing to training data
   */
  async balanceData(splitData, config) {
    // Only balance training data, not validation
    if (config.balanceClasses !== false) {
      try {
        const { RandomDataGenerator } = await import('../training/random-data-generator.js');
        const generator = new RandomDataGenerator();
        
        const balancedTraining = generator.balanceTrainingData(splitData.training);
        
        return {
          training: balancedTraining,
          validation: splitData.validation
        };
        
      } catch (error) {
        logger.error('Error balancing data:', error);
        // Return unbalanced data if balancing fails
      }
    }
    
    return splitData;
  }

  /**
   * Extract and cache features for training data
   */
  async extractFeatures(data, config) {
    try {
      // Get vocabulary
      const { getOrCreateVocabulary } = await import('../features/vocabulary.js');
      const vocabulary = await getOrCreateVocabulary();
      
      // Extract features for both training and validation data
      const trainingWithFeatures = await this.extractFeaturesForDataset(data.training, vocabulary);
      const validationWithFeatures = await this.extractFeaturesForDataset(data.validation, vocabulary);
      
      return {
        training: trainingWithFeatures,
        validation: validationWithFeatures
      };
      
    } catch (error) {
      logger.error('Error extracting features:', error);
      throw new Error(`Feature extraction failed: ${error.message}`);
    }
  }

  /**
   * Extract features for a dataset
   */
  async extractFeaturesForDataset(dataset, vocabulary) {
    const { prepareEmbeddingInputs } = await import('../embeddings/embedding-model.js');
    const { FEATURE_VERSION } = await import('../storage/ml-database.js');
    
    return dataset.map(item => {
      // Check if features are already cached and current
      if (item.features && item.featureVersion === FEATURE_VERSION) {
        return item;
      }
      
      // Extract features
      const inputs = prepareEmbeddingInputs(item, vocabulary);
      
      return {
        ...item,
        features: {
          urlTokens: inputs.urlTokens,
          titleTokens: inputs.titleTokens,
          engineeredFeatures: inputs.features
        },
        featureVersion: FEATURE_VERSION
      };
    });
  }
}

export default { UnifiedDataPreparer };