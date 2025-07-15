/*
 * AI Tab Manager - Incremental Trainer
 * Manages continuous model updates from user feedback
 */

import { ML_CONFIG } from '../model-config.js';
// Worker manager no longer needed - using ModelTrainer instead
import { getTabClassifier } from '../models/tab-classifier.js';
import logger from '../../utils/logger.js';
import { getFeedbackProcessor } from './feedback-processor.js';
import { getTrainingData, recordMetric } from '../storage/ml-database.js';

/**
 * Incremental Trainer for continuous learning
 */
export class IncrementalTrainer {
  constructor() {
    this.feedbackProcessor = null;
    this.isTraining = false;
    this.trainingSchedule = null;
    this.lastTrainingTime = 0;
    this.pendingUpdates = 0;
  }
  
  /**
   * Initialize the incremental trainer
   */
  async initialize() {
    this.feedbackProcessor = getFeedbackProcessor();
    
    // Load last training time from model metadata
    try {
      const { loadModel } = await import('../storage/ml-database.js');
      const model = await loadModel();
      if (model && model.metadata && model.metadata.trainedUpTo) {
        this.lastTrainingTime = model.metadata.trainedUpTo;
        logger.mlTraining(`Loaded model trained up to: ${new Date(this.lastTrainingTime).toISOString()}`);
      }
    } catch (error) {
      logger.mlTraining('Could not load model training cutoff:', error);
    }
    
    // Set up training schedule
    this.setupTrainingSchedule();
    
    logger.mlTraining('Incremental trainer initialized');
  }
  
  /**
   * Set up automatic training schedule
   */
  setupTrainingSchedule() {
    const config = ML_CONFIG.backgroundTraining;
    
    if (!config.enabled) {
      logger.mlTraining('Background training disabled');
      return;
    }
    
    // Clear existing schedule
    if (this.trainingSchedule) {
      clearInterval(this.trainingSchedule);
    }
    
    // Set up new schedule
    const interval = this.getScheduleInterval(config.schedule);
    
    this.trainingSchedule = setInterval(() => {
      this.checkAndTrain();
    }, interval);
    
    logger.mlTraining(`Training scheduled: ${config.schedule}`);
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
  
  /**
   * Check conditions and train if appropriate
   */
  async checkAndTrain() {
    try {
      // Check if already training
      if (this.isTraining) {
        logger.mlTraining('Training already in progress');
        return;
      }
      
      // Check time since last training
      const timeSinceLastTraining = Date.now() - this.lastTrainingTime;
      const minInterval = this.getScheduleInterval('hourly'); // Minimum 1 hour between trainings
      
      if (timeSinceLastTraining < minInterval) {
        logger.mlTraining('Too soon since last training');
        return;
      }
      
      // Check if we have enough new data
      const newData = await this.getNewTrainingData();
      
      if (newData.length < ML_CONFIG.backgroundTraining.minNewExamples) {
        logger.mlTraining(`Not enough new data: ${newData.length} examples`);
        return;
      }
      
      // Check system conditions
      if (!this.checkSystemConditions()) {
        logger.mlTraining('System conditions not met for training');
        return;
      }
      
      // Start training
      await this.performIncrementalTraining(newData);
      
    } catch (error) {
      logger.error('Error in scheduled training:', error);
      
      await recordMetric({
        method: 'system',
        type: 'training_error',
        value: 1,
        metadata: {
          error: error.message,
          scheduled: true
        }
      });
    }
  }
  
  /**
   * Get new training data since last training
   */
  async getNewTrainingData() {
    // Get all training data
    const allData = await getTrainingData();
    
    // Filter for recent data
    const cutoffTime = this.lastTrainingTime || (Date.now() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
    
    return allData.filter(example => 
      example.timestamp > cutoffTime &&
      (example.source === 'user_correction' || example.source === 'user_feedback')
    );
  }
  
  /**
   * Check system conditions for training
   */
  checkSystemConditions() {
    const config = ML_CONFIG.backgroundTraining;
    
    // Check if tab is visible
    if (config.requiresIdle && document.visibilityState === 'visible') {
      return false;
    }
    
    // Check battery status if available
    if (config.requiresCharging && navigator.getBattery) {
      // This would need to be async in real implementation
      // For now, we'll skip this check
    }
    
    // Check memory usage
    if (performance.memory) {
      const memoryUsage = performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit;
      if (memoryUsage > 0.8) {
        logger.mlTraining('Memory usage too high:', (memoryUsage * 100).toFixed(1) + '%');
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Perform incremental training
   * @param {Array} newData - New training examples
   */
  async performIncrementalTraining(newData) {
    this.isTraining = true;
    const startTime = Date.now();
    
    try {
      logger.mlTraining(`Starting incremental training with ${newData.length} new examples`);
      
      // Get current model for comparison
      const classifier = await getTabClassifier();
      const modelSummary = classifier.getSummary();
      
      // Get model trainer for proper incremental training
      const { ModelTrainer } = await import('../training/trainer.js');
      const trainer = new ModelTrainer();
      await trainer.initialize();
      
      // Set up callbacks for tracking
      trainer.setCallbacks({
        onProgress: (progress) => {
          if (progress.epoch !== undefined) {
            logger.mlTraining(`Incremental training: Epoch ${progress.epoch + 1}/3 - ${Math.round(progress.progress * 100)}%`);
          }
        },
        onComplete: (result) => {
          logger.mlTraining('Incremental training completed');
        },
        onError: (error) => {
          logger.error('Incremental training error:', error);
        }
      });
      
      // Get user settings and model config
      const { state } = await import('../../modules/state-manager.js');
      const { ML_CONFIG } = await import('../model-config.js');
      
      // Use trainer's proper method which handles data splitting
      const result = await trainer.trainWithData(newData, {
        epochs: ML_CONFIG.training.epochs,
        incremental: true,
        batchSize: state.settings.mlBatchSize,
        learningRate: state.settings.mlLearningRate,
        earlyStoppingPatience: state.settings.mlEarlyStoppingPatience,
        balanceClasses: false // Don't balance for incremental
      });
      
      // Check if training was successful
      if (!result || !result.success) {
        throw new Error(result?.error || result?.reason || 'Training failed');
      }
      
      // Record success metrics
      await recordMetric({
        method: 'model',
        type: 'incremental_training',
        value: result.accuracy || 0,
        metadata: {
          duration: result.duration || 0,
          newExamples: newData.length,
          finalLoss: result.loss || 0,
          improvement: (result.accuracy || 0) - (modelSummary.metadata.accuracy || 0)
        }
      });
      
      // Update state
      this.lastTrainingTime = Date.now();
      this.pendingUpdates = 0;
      
      logger.mlTraining(`Incremental training completed in ${(result.duration / 1000).toFixed(1)}s`);
      logger.mlTraining(`New accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
      
    } catch (error) {
      logger.error('Incremental training error:', error);
      
      await recordMetric({
        method: 'system',
        type: 'training_error',
        value: 0,
        metadata: {
          error: error.message,
          examples: newData.length
        }
      });
      
      throw error;
      
    } finally {
      this.isTraining = false;
    }
  }
  
  /**
   * Balance training data
   */
  balanceData(data) {
    // Group by category
    const categorized = {};
    data.forEach(example => {
      const cat = example.category;
      if (!categorized[cat]) categorized[cat] = [];
      categorized[cat].push(example);
    });
    
    // Find max category size
    const sizes = Object.values(categorized).map(arr => arr.length);
    const maxSize = Math.max(...sizes);
    const avgSize = sizes.reduce((sum, s) => sum + s, 0) / sizes.length;
    
    // Balance by oversampling small categories
    const balanced = [];
    
    Object.entries(categorized).forEach(([category, examples]) => {
      // Add all original examples
      balanced.push(...examples);
      
      // Oversample if much smaller than average
      if (examples.length < avgSize * 0.5) {
        const needed = Math.floor(avgSize - examples.length);
        for (let i = 0; i < needed; i++) {
          const randomExample = examples[Math.floor(Math.random() * examples.length)];
          balanced.push({ ...randomExample, augmented: true });
        }
      }
    });
    
    // Shuffle
    return balanced.sort(() => Math.random() - 0.5);
  }
  
  /**
   * Extract features from training example
   */
  extractFeatures(example) {
    // This is a simplified version - in reality, this would use
    // the same feature extraction as the main model
    const features = new Array(128).fill(0); // Placeholder
    
    // Add some basic features
    features[0] = example.url.length / 200;
    features[1] = example.title.length / 100;
    features[2] = example.url.includes('https') ? 1 : 0;
    features[3] = example.url.includes('localhost') ? 1 : 0;
    
    return features;
  }
  
  /**
   * Update model weights
   */
  async updateModelWeights(classifier, newWeights) {
    const tf = (await import('../tensorflow-loader.js')).getTensorFlow();
    
    // Convert weight data back to tensors
    const weightTensors = newWeights.map(w => 
      tf.tensor(w.data, w.shape)
    );
    
    // Set weights on model
    classifier.model.setWeights(weightTensors);
    
    // Clean up tensors
    weightTensors.forEach(t => t.dispose());
  }
  
  /**
   * Trigger immediate training
   * @param {string} reason - Reason for immediate training
   */
  async triggerTraining(reason = 'manual') {
    logger.mlTraining(`Immediate training triggered: ${reason}`);
    
    await recordMetric({
      method: 'system',
      type: 'training_triggered',
      value: 1,
      metadata: { reason }
    });
    
    // Reset last training time to allow immediate training
    const tempLastTime = this.lastTrainingTime;
    this.lastTrainingTime = 0;
    
    try {
      await this.checkAndTrain();
    } finally {
      // Restore if training didn't happen
      if (this.lastTrainingTime === 0) {
        this.lastTrainingTime = tempLastTime;
      }
    }
  }
  
  /**
   * Get training status
   */
  getStatus() {
    return {
      isTraining: this.isTraining,
      lastTrainingTime: this.lastTrainingTime,
      timeSinceLastTraining: this.lastTrainingTime ? 
        Date.now() - this.lastTrainingTime : null,
      pendingUpdates: this.pendingUpdates,
      scheduleEnabled: !!this.trainingSchedule,
      schedule: ML_CONFIG.backgroundTraining.schedule
    };
  }
  
  /**
   * Stop scheduled training
   */
  stop() {
    if (this.trainingSchedule) {
      clearInterval(this.trainingSchedule);
      this.trainingSchedule = null;
    }
    
    logger.mlTraining('Incremental training stopped');
  }
}

// Export singleton
let trainerInstance = null;

export async function getIncrementalTrainer() {
  if (!trainerInstance) {
    trainerInstance = new IncrementalTrainer();
    await trainerInstance.initialize();
  }
  return trainerInstance;
}

export default {
  IncrementalTrainer,
  getIncrementalTrainer
};