/*
 * AI Tab Manager - Model Trainer
 * Orchestrates model training with data management
 */

import { ML_CONFIG } from '../model-config.js';
import { getTabClassifier } from '../models/tab-classifier.js';
import { getTrainingData, addTrainingData, recordMetric } from '../storage/ml-database.js';
import logger from '../../utils/logger.js';
import { updateVocabulary } from '../features/vocabulary.js';
import { updateAllTrainingDataFeatures } from '../features/feature-updater.js';
import RandomDataGenerator from './random-data-generator.js';
import { validateTrainingData } from './validation.js';
import { state } from '../../modules/state-manager.js';

/**
 * Get epochs from user settings or fall back to config default
 */
function getEpochsFromSettings(options = {}) {
  if (options.epochs && options.epochs > 0) {
    return options.epochs; // Use provided epochs
  }
  
  // This should never happen as epochs should always be provided
  throw new Error('Epochs must be provided in options - no fallback allowed');
}

/**
 * Model Trainer class
 */
export class ModelTrainer {
  constructor() {
    this.classifier = null;
    this.isTraining = false;
    this.trainingHistory = [];
    this.callbacks = {
      onProgress: null,
      onComplete: null,
      onError: null
    };
  }
  
  /**
   * Initialize trainer
   */
  async initialize() {
    this.classifier = await getTabClassifier();
  }
  
  /**
   * Prepare training data - directly from saved tabs + user corrections
   * @returns {Promise<Array>} Prepared training data
   */
  async prepareTrainingData() {
    // Get ALL ML training data (this has the confidence values)
    const mlData = await getTrainingData();
    
    
    // Filter for valid training data
    const validData = mlData.filter(item => 
      item.category !== undefined && 
      item.category !== null &&
      Number.isInteger(item.category) &&
      item.category >= 0 && 
      item.category <= 3
    );
    
    
    // Create a Map to deduplicate by URL, keeping the most recent
    const dataMap = new Map();
    
    // Sort by timestamp to ensure we keep the most recent data
    validData.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    // Add to map (first occurrence wins due to sort)
    validData.forEach(item => {
      if (!dataMap.has(item.url)) {
        dataMap.set(item.url, item);
      }
    });
    
    
    
    // Convert back to array and filter out zero-confidence records
    const allData = Array.from(dataMap.values()).filter(item => 
      (item.trainingConfidence || 0) > 0
    );
    
    
    
    return allData;
  }
  
  /**
   * Convert saved tabs from main database to ML training data
   * @returns {Promise<Array>} Converted training examples
   */
  async convertSavedTabsToTrainingData() {
    try {
      // Get saved tabs from main database
      const savedTabs = await window.tabDatabase.getAllSavedTabs();
        
      // Filter out uncategorized tabs (category 0) and convert to training format
      const trainingData = savedTabs
        .filter(tab => tab.category && tab.category > 0) // Only categorized tabs
        .map(tab => ({
          url: tab.url,
          title: tab.title || '',
          category: tab.category,
          source: 'saved_tabs_import',
          corrected: false,
          // Include confidence values if available, default to 0 for exclusion
          combinedConfidence: tab.combinedConfidence || 0,
          trainingConfidence: tab.trainingConfidence || 0,
          metadata: {
            importedFrom: 'main_database',
            originalId: tab.id,
            importTime: Date.now()
          }
        }));
      
      return trainingData;
    } catch (error) {
      logger.error('Error converting saved tabs to training data:', error);
      return [];
    }
  }
  
  /**
   * Train model (alias for trainWithStoredData)
   * @param {Object} options - Training options
   * @returns {Promise<Object>} Training results
   */
  async trainModel(options = {}) {
    return this.trainWithStoredData(options);
  }

  /**
   * Train model with provided data (avoids duplicate data preparation)
   * @param {Array} trainingData - Pre-prepared training data
   * @param {Object} options - Training options
   * @returns {Promise<Object>} Training results
   */
  async trainWithData(trainingData, options = {}) {
    if (this.isTraining) {
      throw new Error('Training already in progress');
    }
    
    this.isTraining = true;
    const startTime = Date.now();
    
    try {
      // Validate data
      const validationResult = validateTrainingData(trainingData);
      if (!validationResult.isValid) {
        throw new Error(`Invalid training data: ${validationResult.errors.join(', ')}`);
      }
      
      // Store current vocab size before update
      const oldVocabSize = this.classifier.vocabulary ? this.classifier.vocabulary.size() : 0;
      
      // Update vocabulary with all data
      const updatedVocab = await updateVocabulary(trainingData);
      
      // CRITICAL: Set the updated vocabulary in the classifier
      this.classifier.vocabulary = updatedVocab;
      
      const newVocabSize = this.classifier.vocabulary.size();
      
      // Update features for any training data that has outdated features
      if (newVocabSize > 4) {
        logger.mlTraining('🔄 Updating features for training data with new vocabulary...');
        const { updated, total } = await updateAllTrainingDataFeatures();
        if (updated > 0) {
          logger.mlTraining(`   Updated features for ${updated}/${total} training examples`);
          // Reload training data to get updated features
          trainingData = await this.prepareTrainingData();
        }
      }
      
      
      // Only initialize if model doesn't exist or vocabulary size changed
      if (!this.classifier.model) {
        await this.classifier.initialize();
      } else if (oldVocabSize !== newVocabSize) {
        logger.mlTraining(`ML Training: Vocabulary size changed (${oldVocabSize} → ${newVocabSize}), model needs rebuild`);
        logger.mlTraining('This will reset weights - consider using fixed vocabulary size');
        
        // Force model rebuild by clearing the existing model
        this.classifier.model = null;
        this.classifier.isLoaded = false;
        
        // Reinitialize with new vocabulary
        await this.classifier.initialize();
        
        // Verify the model was rebuilt with correct vocabulary
        const embeddingLayer = this.classifier.model.layers.find(l => l.name === 'token_embeddings');
        if (embeddingLayer && embeddingLayer.inputDim !== newVocabSize) {
          throw new Error(`Model rebuild failed! Embedding layer has ${embeddingLayer.inputDim} but vocabulary has ${newVocabSize}`);
        }
        logger.mlTraining('Model rebuilt with new vocabulary size');
        
      } else {
      }
      
      // Prepare data for training with random validation
      const generator = new RandomDataGenerator(trainingData);
      const { trainData, validData } = generator.splitDataRandomly(
        options.validationSplit || ML_CONFIG.training.validationSplit
      );
      
      // The RandomDataGenerator already applied weight-based balancing
      // The returned trainData IS the balanced data
      
      // Dispatch training started event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('trainingStarted', {
          detail: { isIncremental: options.incremental || false }
        }));
      }
      
      // Set up training callbacks
      const trainingCallbacks = {
        onProgress: (progress) => {
          // Dispatch progress event for charts
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('trainingProgress', {
              detail: progress
            }));
          }
          
          if (this.callbacks.onProgress) {
            this.callbacks.onProgress({
              ...progress,
              elapsed: Date.now() - startTime
            });
          }
        },
        earlyStoppingCallback: async (epoch, logs) => {
          // Implement early stopping
          if (this.shouldStopEarly(epoch, logs)) {
            logger.mlTraining('Early stopping triggered');
            return true;
          }
          return false;
        }
      };
      
      // Use WorkerManager for training
      const { getWorkerManager } = await import('../workers/worker-manager.js');
      const workerManager = getWorkerManager();
      
      // Start training in worker
      const result = await workerManager.train({
        trainingData: trainData, // This is already balanced by RandomDataGenerator
        validationData: validData, // Pass separate validation data
        epochs: getEpochsFromSettings(options),
        batchSize: options.batchSize,
        learningRate: options.learningRate,
        earlyStoppingPatience: options.earlyStoppingPatience,
        validationSplit: options.validationSplit || ML_CONFIG.training.validationSplit,
        incremental: options.incremental,
        balanceClasses: options.balanceClasses,
        onProgress: trainingCallbacks.onProgress,
        onComplete: async (workerResult) => {
          // Training completed callback
          if (workerResult.success) {
            // Evaluate on validation data
            const evaluation = await this.classifier.evaluate(validData);
            
            // Record metrics
            await this.recordTrainingMetrics({
              accuracy: evaluation.accuracy,
              loss: evaluation.loss,
              trainingExamples: trainData.length,
              validationExamples: validData.length,
              duration: Date.now() - startTime,
              perClassMetrics: evaluation.perClassMetrics
            });
            
            // Update training history
            this.trainingHistory.push({
              timestamp: Date.now(),
              accuracy: evaluation.accuracy,
              loss: evaluation.loss,
              samples: trainData.length
            });
            
            const finalResult = {
              success: true,
              history: workerResult.history,
              evaluation,
              duration: Date.now() - startTime,
              modelSummary: this.classifier.getSummary(),
              accuracy: evaluation.accuracy
            };
            
            if (this.callbacks.onComplete) {
              this.callbacks.onComplete(finalResult);
            }
          }
        },
        onError: (error) => {
          // Error callback
          if (this.callbacks.onError) {
            this.callbacks.onError(error);
          }
        }
      });
      
      return result;
      
    } catch (error) {
      logger.error('Training error:', error);
      
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
      
      throw error;
      
    } finally {
      this.isTraining = false;
    }
  }
  
  /**
   * Train model with stored data
   * @param {Object} options - Training options
   * @returns {Promise<Object>} Training results
   */
  async trainWithStoredData(options = {}) {
    if (this.isTraining) {
      throw new Error('Training already in progress');
    }
    
    this.isTraining = true;
    const startTime = Date.now();
    
    try {
      // Load training data using our prepared method
      let allData = await this.prepareTrainingData();
      
      // Validate data
      const validationResult = validateTrainingData(allData);
      if (!validationResult.isValid) {
        // Check if it's just insufficient data
        const insufficientDataError = validationResult.errors.find(err => 
          err.includes('Insufficient training data'));
        
        if (insufficientDataError) {
          logger.mlTraining(`⏳ ${insufficientDataError}. Training skipped.`);
          return {
            success: false,
            reason: 'insufficient_data',
            message: insufficientDataError,
            dataCount: allData.length
          };
        }
        
        // Other validation errors are still thrown
        throw new Error(`Invalid training data: ${validationResult.errors.join(', ')}`);
      }
      
      // Update vocabulary with all data
      const updatedVocab = await updateVocabulary(allData);
      
      // CRITICAL: Set the updated vocabulary in the classifier BEFORE initializing
      this.classifier.vocabulary = updatedVocab;
      
      const newVocabSize = this.classifier.vocabulary.size();
      
      // Update features for any training data that has outdated features
      if (newVocabSize > 4) {
        logger.mlTraining('🔄 Updating features for training data with new vocabulary...');
        const { updated, total } = await updateAllTrainingDataFeatures();
        if (updated > 0) {
          logger.mlTraining(`   Updated features for ${updated}/${total} training examples`);
          // Reload training data to get updated features
          allData = await this.prepareTrainingData();
        }
      }
      
      // Ensure classifier is initialized with updated vocabulary
      await this.classifier.initialize();
      
      // Prepare data for training AFTER features are updated
      const generator = new RandomDataGenerator(allData);
      // Use stratified random splitting to ensure all categories are represented
      // in both training and validation sets with deterministic URL-based assignment
      const { trainData, validData } = generator.splitDataRandomly(
        options.validationSplit || ML_CONFIG.training.validationSplit
      );
      
      // ✅ ENABLED: Using actual confidence values for weight-based training
      logger.mlTraining('⚖️ Using real confidence values for proper weighted training');
      
      // Log confidence statistics for monitoring
      const trainConfidences = trainData.map(item => item.trainingConfidence);
      const validConfidences = validData.map(item => item.trainingConfidence);
      // Training confidence logged via mlDiagnostic if enabled
      // Validation confidence logged via mlDiagnostic if enabled
      
      // The RandomDataGenerator already applied weight-based balancing
      // The returned trainData IS the balanced data
      logger.mlTraining('📊 Training split complete:');
      logger.mlTraining(`  Training: ${trainData.length} samples (weight-balanced by RandomDataGenerator)`);
      logger.mlTraining(`  Validation: ${validData.length} samples (unchanged)`);
      
      // Log what we're sending to worker
      logger.mlTraining('📦 Sending data to worker:', {
        trainDataLength: trainData.length,
        validDataLength: validData.length,
        trainCategories: trainData.reduce((acc, item) => {
          acc[item.category] = (acc[item.category] || 0) + 1;
          return acc;
        }, {}),
        validCategories: validData.reduce((acc, item) => {
          acc[item.category] = (acc[item.category] || 0) + 1;
          return acc;
        }, {}),
        trainHasIsValidation: trainData.filter(d => d.isValidation !== undefined).length,
        validHasIsValidation: validData.filter(d => d.isValidation !== undefined).length
      });
      
      // Set up training callbacks
      const trainingCallbacks = {
        onProgress: (progress) => {
          if (this.callbacks.onProgress) {
            this.callbacks.onProgress({
              ...progress,
              elapsed: Date.now() - startTime
            });
          }
        },
        earlyStoppingCallback: async (epoch, logs) => {
          // Implement early stopping
          if (this.shouldStopEarly(epoch, logs)) {
            logger.mlTraining('Early stopping triggered');
            return true;
          }
          return false;
        }
      };
      
      // Use WorkerManager for training
      const { getWorkerManager } = await import('../workers/worker-manager.js');
      const workerManager = getWorkerManager();
      
      // Start training in worker
      const result = await workerManager.train({
        trainingData: trainData, // This is already balanced by RandomDataGenerator
        validationData: validData, // Pass separate validation data
        epochs: getEpochsFromSettings(options),
        batchSize: options.batchSize,
        learningRate: options.learningRate,
        earlyStoppingPatience: options.earlyStoppingPatience,
        validationSplit: options.validationSplit || ML_CONFIG.training.validationSplit,
        incremental: options.incremental,
        balanceClasses: options.balanceClasses,
        onProgress: trainingCallbacks.onProgress,
        onComplete: async (workerResult) => {
          // Training completed callback
          if (workerResult.success) {
            // Evaluate on validation data
            const evaluation = await this.classifier.evaluate(validData);
            
            // Record metrics
            await this.recordTrainingMetrics({
              accuracy: evaluation.accuracy,
              loss: evaluation.loss,
              trainingExamples: trainData.length,
              validationExamples: validData.length,
              duration: Date.now() - startTime,
              perClassMetrics: evaluation.perClassMetrics
            });
            
            // Update training history
            this.trainingHistory.push({
              timestamp: Date.now(),
              accuracy: evaluation.accuracy,
              loss: evaluation.loss,
              samples: trainData.length
            });
          }
        },
        onError: (error) => {
          // Error callback
          logger.error('Worker training error:', error);
        }
      });
      
      return result; // Result will be returned from worker
      
    } catch (error) {
      logger.error('Training error:', error);
      
      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }
      
      throw error;
      
    } finally {
      this.isTraining = false;
    }
  }
  
  /**
   * Get class distribution
   */
  getClassDistribution(data) {
    const distribution = {};
    
    data.forEach(example => {
      distribution[example.category] = (distribution[example.category] || 0) + 1;
    });
    
    return distribution;
  }
  
  /**
   * Check if should stop training early
   */
  shouldStopEarly(epoch, logs) {
    // Note: This method appears to be dead code as training is done in worker
    throw new Error('shouldStopEarly is not implemented - training happens in worker')
    if (epoch < patience) {
      return false;
    }
    
    const recentHistory = this.trainingHistory.slice(-patience);
    
    if (recentHistory.length < patience) {
      return false;
    }
    
    // Check if loss hasn't improved
    const minDelta = ML_CONFIG.training.earlyStopping.minDelta;
    let hasImproved = false;
    
    for (let i = 1; i < recentHistory.length; i++) {
      if (recentHistory[i].loss < recentHistory[i-1].loss - minDelta) {
        hasImproved = true;
        break;
      }
    }
    
    return !hasImproved;
  }
  
  /**
   * Record training metrics
   */
  async recordTrainingMetrics(metrics) {
    // Overall accuracy
    await recordMetric({
      method: 'model',
      type: 'accuracy',
      value: metrics.accuracy,
      metadata: metrics
    });
    
    // Per-class metrics (if available)
    if (metrics.perClassMetrics && Array.isArray(metrics.perClassMetrics)) {
      for (const classMetric of metrics.perClassMetrics) {
        await recordMetric({
          method: 'model',
          type: `class_${classMetric.class}_f1`,
          value: classMetric.f1,
          metadata: classMetric
        });
      }
    }
  }
  
  /**
   * Set training callbacks
   */
  setCallbacks(callbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }
  
  /**
   * Get training status
   */
  getStatus() {
    return {
      isTraining: this.isTraining,
      history: this.trainingHistory,
      lastTraining: this.trainingHistory[this.trainingHistory.length - 1] || null
    };
  }
  
  /**
   * Schedule automatic training
   */
  async scheduleAutoTraining() {
    const schedule = ML_CONFIG.backgroundTraining.schedule;
    
    // Check if we have enough new data
    const trainingData = await getTrainingData();
    if (trainingData.length < ML_CONFIG.training.minTrainingExamples) {
      logger.mlTraining('Not enough data for training');
      return;
    }
    
    // Check last training time
    const lastTraining = this.trainingHistory[this.trainingHistory.length - 1];
    if (lastTraining) {
      const timeSinceLastTraining = Date.now() - lastTraining.timestamp;
      const scheduleInterval = this.getScheduleInterval(schedule);
      
      if (timeSinceLastTraining < scheduleInterval) {
        logger.mlTraining('Too soon for scheduled training');
        return;
      }
    }
    
    // Start training
    logger.mlTraining('Starting scheduled training');
    return this.trainWithStoredData({
      balanceClasses: true
    });
  }
  
  /**
   * Get schedule interval in milliseconds
   */
  getScheduleInterval(schedule) {
    const intervals = {
      hourly: 60 * 60 * 1000,
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000
    };
    
    return intervals[schedule] || intervals.daily;
  }
}

// Export singleton instance
let trainerInstance = null;

export async function getModelTrainer() {
  if (!trainerInstance) {
    trainerInstance = new ModelTrainer();
    await trainerInstance.initialize();
  }
  
  return trainerInstance;
}

export default {
  ModelTrainer,
  getModelTrainer
};