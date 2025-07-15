/*
 * AI Tab Manager - Background ML Service
 * Handles background ML operations and retraining
 */

import { getUnifiedDatabase } from './UnifiedDatabaseService.js';
import { state } from '../modules/state-manager.js';
// ML_CONFIG imported dynamically to avoid initialization order issues
import logger from '../utils/logger.js';

/**
 * Background ML Service
 * Manages ML operations that run in background
 */
class BackgroundMLService {
  constructor() {
    this.isInitialized = false;
    this.retrainingInProgress = false;
    this.lastRetrainingCheck = 0;
    this.CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
    this.intervalId = null;
  }

  /**
   * Initialize the background service
   */
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      // Check if ML is enabled
      if (state.settings?.useML === false) {
        logger.mlTraining('ML is disabled - BackgroundMLService not starting');
        return;
      }
      
      logger.mlTraining('🟢 Initializing BackgroundMLService...');
      
      // Check for interrupted training first and handle it
      const handledInterrupted = await this.handleInterruptedTraining();
      
      // If we handled interrupted training, skip the initial model check
      // to avoid conflicting with the resumed training
      if (handledInterrupted) {
        logger.mlTraining('🔄 Skipping initial model check - training was resumed');
        this.isInitialized = true;
        return;
      }
      
      // Start periodic checks
      this.startPeriodicChecks();
      
      // Run initial check after a delay to let the app finish loading
      setTimeout(() => this.checkRetrainingNeed(), 10000); // 10 second delay
      
      this.isInitialized = true;
      
    } catch (error) {
      console.error('Error initializing Background ML Service:', error);
    }
  }

  /**
   * Start periodic retraining checks
   */
  startPeriodicChecks() {
    if (this.intervalId) return; // Already running
    
    this.intervalId = setInterval(() => {
      this.checkRetrainingNeed();
    }, this.CHECK_INTERVAL);
  }

  /**
   * Handle any interrupted training from previous session
   * @returns {boolean} True if interrupted training was found and resumed
   */
  async handleInterruptedTraining() {
    try {
      logger.mlTraining('🔍 BACKGROUND SERVICE: Checking for interrupted training...');
      const { getTrainingCheckpoint } = await import('../ml/storage/ml-database.js');
      
      // Check for training_last checkpoint
      const interruptedModel = await getTrainingCheckpoint('last');
      
      if (interruptedModel) {
        // Check how old the interrupted training is
        const timeSinceUpdate = Date.now() - (interruptedModel.metadata.lastUpdated || interruptedModel.metadata.startedAt || 0);
        const minutesSinceUpdate = Math.floor(timeSinceUpdate / 60000);
        
        // Use training history length as source of truth for epoch count
        const actualEpoch = interruptedModel.metadata?.trainingHistory?.loss?.length || interruptedModel.metadata.epoch || 0;
        logger.mlTraining(`🔄 BACKGROUND SERVICE: Found interrupted training from ${minutesSinceUpdate} minutes ago at epoch ${actualEpoch}`);
        
        // Keep all interrupted training for resumption - no automatic deletion based on age
        logger.mlTraining('✅ BACKGROUND SERVICE: Interrupted training found - will be resumed by training system');
        
        // Check if training was actually complete
        if (interruptedModel.metadata.trainingComplete) {
          logger.mlTraining('   Interrupted training was complete, promoting best checkpoint to current...');
          const { promoteTrainingModel, getTrainingCheckpoint, deleteTrainingCheckpoint } = await import('../ml/storage/ml-database.js');
          
          // Check if we have a best checkpoint
          const bestModel = await getTrainingCheckpoint('best');
          
          if (bestModel) {
            await promoteTrainingModel('training_best');
            
            // Clean up training_last after promoting best
            await deleteTrainingCheckpoint('last');
          } else {
            // Fallback: promote last checkpoint if no best checkpoint exists
            logger.mlTraining('⚠️ No best checkpoint found, promoting last checkpoint...');
            await promoteTrainingModel('training_last');
          }
          return true;
        }
        
        logger.mlTraining('🔄 BACKGROUND SERVICE: Resuming interrupted training...');
        
        // Set global flag to prevent model loading conflicts
        window._trainingInProgress = true;
        
        // Get trainer for resuming training
        const { ModelTrainer } = await import('../ml/training/trainer.js');
        const trainer = new ModelTrainer();
        await trainer.initialize();
        
        // Set callbacks for UI updates
        trainer.setCallbacks({
          onProgress: (progress) => {
            
            // Update training status in UI if available
            const statusSpan = document.getElementById('trainingStatus');
            if (statusSpan) {
              statusSpan.textContent = `Resuming training: Epoch ${progress.epoch + 1}/${progress.totalEpochs} - ${Math.round(progress.progress * 100)}%`;
            }
            
            // Make charts visible and update them
            try {
              const { getTrainingCharts } = require('../modules/training-charts.js');
              const charts = getTrainingCharts();
              if (!charts.isVisible) {
                charts.show();
              }
              
              if (progress.loss !== undefined) {
                // Use explicit validation instead of || fallbacks to avoid masking valid 0 values
                const trainAcc = (typeof progress.trainAccuracy === 'number') ? progress.trainAccuracy : 
                                 (typeof progress.accuracy === 'number') ? progress.accuracy : 0;
                const valAcc = (typeof progress.valAccuracy === 'number') ? progress.valAccuracy : trainAcc;
                
                charts.addDataPoint(
                  progress.epoch + 1,
                  progress.loss,
                  progress.valLoss || progress.loss,
                  trainAcc,
                  valAcc
                );
                // Training history is automatically saved by the training system in model metadata
              }
            } catch (chartError) {
              // Chart update failed - continue training
            }
          },
          onComplete: (result) => {
            // Clear training flag
            window._trainingInProgress = false;
            logger.mlTraining('Resumed training completed successfully');
          },
          onError: (error) => {
            // Clear training flag even on error
            window._trainingInProgress = false;
            console.error('Training error:', error);
          }
        });
        
        // Start the resumed training (don't await to avoid blocking initialization)
        const { ML_CONFIG: mlConfig1 } = await import('../ml/model-config.js');
        const trainingPromise = trainer.trainWithStoredData({
          epochs: mlConfig1.training.epochs,
          incremental: true,
          batchSize: state.settings.mlBatchSize,
          learningRate: state.settings.mlLearningRate,
          earlyStoppingPatience: state.settings.mlEarlyStoppingPatience,
          balanceClasses: true
        });
        
        trainingPromise.catch(error => {
          // Handle any errors not caught by callbacks
          window._trainingInProgress = false;
          console.error('Error during resumed training:', error);
        });
        
        return true; // Indicate that interrupted training was handled
      }
      
      return false; // No interrupted training found
    } catch (error) {
      console.error('Error handling interrupted training:', error);
      return false;
    }
  }

  /**
   * Stop periodic checks
   */
  stopPeriodicChecks() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check model state and determine needed action
   * @returns {Promise<{modelExists: boolean, needsTraining: boolean, trainingDataCount: number}>}
   */
  async checkModelState() {
    try {
      // Get ML config
      const { ML_CONFIG: mlConfig2 } = await import('../ml/model-config.js');
      
      // Check if model exists
      const { getMLCategorizer } = await import('../ml/categorization/ml-categorizer.js');
      const mlCategorizer = await getMLCategorizer();
      const status = await mlCategorizer.getStatus();
      
      // Check actual ML training data count (not just saved tabs)
      const { getTrainingData } = await import('../ml/storage/ml-database.js');
      const mlTrainingData = await getTrainingData(1); // Just check if any exist
      let trainingDataCount = 0;
      
      if (mlTrainingData.length > 0) {
        // Get full count only if data exists
        const allTrainingData = await getTrainingData(10000);
        trainingDataCount = allTrainingData.length;
      }
      
      // Check if model needs initial training
      const { getTabClassifier } = await import('../ml/models/tab-classifier.js');
      const classifier = await getTabClassifier();
      
      const result = {
        modelExists: status.modelExists,
        needsInitialTraining: classifier.needsInitialTraining || false,
        trainingDataCount: trainingDataCount,
        hasEnoughData: trainingDataCount >= mlConfig2.training.minTrainingExamples
      };
      
      // Determine if training is needed
      if (!result.modelExists && result.hasEnoughData) {
        result.needsTraining = true;
        result.reason = 'No model exists but sufficient training data available';
      } else if (result.needsInitialTraining && result.hasEnoughData) {
        result.needsTraining = true;
        result.reason = 'Model needs initial training';
      } else {
        result.needsTraining = false;
        if (!result.hasEnoughData) {
          result.reason = `Not enough training data (${trainingDataCount}/${mlConfig2.training.minTrainingExamples} required)`;
        } else {
          result.reason = 'Model exists and is trained';
        }
      }
      
      return result;
      
    } catch (error) {
      console.error('Error checking model state:', error);
      return {
        modelExists: false,
        needsTraining: false,
        trainingDataCount: 0,
        hasEnoughData: false,
        error: error.message
      };
    }
  }

  /**
   * Check if model retraining is needed
   */
  async checkRetrainingNeed() {
    if (this.retrainingInProgress) {
      return;
    }

    try {
      // Throttle checks
      const now = Date.now();
      if (now - this.lastRetrainingCheck < this.CHECK_INTERVAL) {
        return;
      }
      this.lastRetrainingCheck = now;

      
      // Use centralized model state check
      const modelState = await this.checkModelState();
      
      if (modelState.needsTraining) {
        await this.triggerBackgroundRetraining();
        return;
      }
      
      // If model exists, use the incremental trainer to check and train if needed
      if (modelState.modelExists) {
        const { getIncrementalTrainer } = await import('../ml/learning/incremental-trainer.js');
        const trainer = await getIncrementalTrainer();
        
        // Let the incremental trainer handle the decision logic properly
        // It uses trainingData.timestamp vs lastTrainingTime, not the flawed addedToML approach
        await trainer.checkAndTrain();
      }

    } catch (error) {
      console.error('Error checking retraining need:', error);
    }
  }

  /**
   * Trigger background model retraining
   */
  async triggerBackgroundRetraining() {
    if (this.retrainingInProgress) {
      return;
    }

    try {
      this.retrainingInProgress = true;

      // Check if we have enough data before attempting training
      const { ML_CONFIG: mlConfig } = await import('../ml/model-config.js');
      const unifiedDB = await getUnifiedDatabase();
      const trainingDataCount = await unifiedDB.getTrainingDataCount();
      if (trainingDataCount < mlConfig.training.minTrainingExamples) {
        logger.mlTraining(`Background training skipped: Only ${trainingDataCount} examples (minimum: ${mlConfig.training.minTrainingExamples})`);
        return;
      }
      
      // Get trainer for background retraining
      const { ModelTrainer } = await import('../ml/training/trainer.js');
      const trainer = new ModelTrainer();
      await trainer.initialize();
      
      // Set callbacks for silent background training
      trainer.setCallbacks({
        onProgress: () => {
          // Silent progress for background training
        },
        onComplete: () => {
          logger.mlTraining('Background retraining completed');
        },
        onError: (error) => {
          console.error('Background training error:', error);
        }
      });
      
      // Use trainer's proper training method which includes data splitting
      const { ML_CONFIG: mlConfig3 } = await import('../ml/model-config.js');
      await trainer.trainWithStoredData({
        epochs: mlConfig3.training.epochs,
        incremental: true, // Background training is usually incremental
        batchSize: state.settings.mlBatchSize,
        learningRate: state.settings.mlLearningRate,
        earlyStoppingPatience: state.settings.mlEarlyStoppingPatience,
        balanceClasses: true
      });

    } catch (error) {
      console.error('Background model retraining failed:', error);
    } finally {
      this.retrainingInProgress = false;
    }
  }

  /**
   * Force immediate retraining (called manually)
   */
  async forceRetraining() {
    try {
      logger.mlTraining('🔥 BACKGROUND SERVICE: forceRetraining() called');
      
      // Check if already in progress
      if (this.retrainingInProgress) {
        logger.mlTraining('⏳ BACKGROUND SERVICE: Retraining already in progress, skipping');
        return false;
      }
      
      this.retrainingInProgress = true;
      logger.mlTraining('🔥 BACKGROUND SERVICE: Set retrainingInProgress = true');
      
      // No longer need to directly create WorkerManager - trainer handles it
      
      // Get trainer for data preparation
      const { ModelTrainer } = await import('../ml/training/trainer.js');
      const trainer = new ModelTrainer();
      await trainer.initialize();
      
      // Load training data
      const trainingData = await trainer.prepareTrainingData();
      
      // Check if model actually exists for incremental vs fresh training
      const { getMLCategorizer } = await import('../ml/categorization/ml-categorizer.js');
      const mlCategorizer = await getMLCategorizer();
      const status = await mlCategorizer.getStatus();
      
      // Set callbacks on trainer for UI updates
      trainer.setCallbacks({
        onProgress: (progress) => {
          // Log progress for forced training
          if (progress.epoch !== undefined) {
            // Update UI if available (for when called from ml-dashboard)
            const statusSpan = document.getElementById('trainingStatus');
            if (statusSpan) {
              statusSpan.textContent = `Training: Epoch ${progress.epoch + 1}/${progress.totalEpochs} - ${Math.round(progress.progress * 100)}%`;
            }
            
            // Update charts if available
            try {
              const { getTrainingCharts } = require('../modules/training-charts.js');
              const charts = getTrainingCharts();
              if (charts && !charts.isVisible) {
                charts.show();
              }
              
              if (charts && progress.loss !== undefined) {
                // Use explicit validation instead of || fallbacks to avoid masking valid 0 values
                const trainAcc = (typeof progress.trainAccuracy === 'number') ? progress.trainAccuracy : 
                                 (typeof progress.accuracy === 'number') ? progress.accuracy : 0;
                const valAcc = (typeof progress.valAccuracy === 'number') ? progress.valAccuracy : trainAcc;
                
                charts.addDataPoint(
                  progress.epoch + 1,
                  progress.loss,
                  progress.valLoss || progress.loss,
                  trainAcc,
                  valAcc
                );
                // Training history is automatically saved by the training system in model metadata
              }
            } catch (chartError) {
              // Chart update failed - continue training silently
            }
          }
        },
        onComplete: (result) => {
          logger.mlTraining('Forced training completed');
        },
        onError: (error) => {
          console.error('Forced training error:', error);
        }
      });
      
      // Use trainer's proper training method which includes data splitting
      const { ML_CONFIG: mlConfig4 } = await import('../ml/model-config.js');
      const result = await trainer.trainWithStoredData({
        epochs: mlConfig4.training.epochs,
        incremental: status.modelExists,
        batchSize: state.settings.mlBatchSize,
        learningRate: state.settings.mlLearningRate,
        earlyStoppingPatience: state.settings.mlEarlyStoppingPatience,
        balanceClasses: true
      });
      
      return result && result.success !== false;
      
    } catch (error) {
      console.error('Forced retraining failed:', error);
      return false;
    } finally {
      // Clear retrainingInProgress flag
      this.retrainingInProgress = false;
      logger.mlTraining('🔥 BACKGROUND SERVICE: Set retrainingInProgress = false (finally block)');
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      retrainingInProgress: this.retrainingInProgress,
      lastRetrainingCheck: this.lastRetrainingCheck,
      checkInterval: this.CHECK_INTERVAL,
      isRunning: !!this.intervalId
    };
  }

  /**
   * Update settings and restart if needed
   */
  async updateSettings(newSettings) {
    const mlWasEnabled = state.settings?.useML !== false;
    const mlIsEnabled = newSettings?.useML !== false;
    
    if (mlWasEnabled && !mlIsEnabled) {
      // ML was just disabled - stop periodic checks
      this.stopPeriodicChecks();
    } else if (!mlWasEnabled && mlIsEnabled) {
      // ML was just enabled - check model state and train if needed
      logger.mlTraining('ML re-enabled - checking model state...');
      
      try {
        // Initialize the service
        await this.initialize();
        
        // Use centralized model state check
        const modelState = await this.checkModelState();
        
        logger.mlTraining('Model state check completed');
        
        if (modelState.needsTraining) {
          logger.mlTraining(`${modelState.reason} - triggering model creation...`);
          await this.forceRetraining();
        } else if (modelState.modelExists) {
          logger.mlTraining('Model already exists - checking for new training data...');
          await this.checkRetrainingNeed();
        } else {
          logger.mlTraining(`${modelState.reason}`);
        }
      } catch (error) {
        console.error('Error checking model state after ML re-enabled:', error);
      }
    }
  }

  /**
   * Clear any interrupted training (called during reset)
   */
  // Removed clearInterruptedTraining - interrupted training should never be automatically deleted

  /**
   * Cleanup when service is destroyed
   */
  destroy() {
    this.stopPeriodicChecks();
    this.isInitialized = false;
    this.retrainingInProgress = false;
  }
}

// Create singleton instance
let backgroundMLServiceInstance = null;

export async function getBackgroundMLService() {
  if (!backgroundMLServiceInstance) {
    backgroundMLServiceInstance = new BackgroundMLService();
    await backgroundMLServiceInstance.initialize();
  }
  return backgroundMLServiceInstance;
}

export default {
  getBackgroundMLService,
  BackgroundMLService
};