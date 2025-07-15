/*
 * AI Tab Manager - Unified Training Orchestrator
 * Single entry point for all training scenarios: manual, background, incremental, auto
 */

import { ML_CONFIG } from '../model-config.js';
import logger from '../../utils/logger.js';

/**
 * Unified Training Orchestrator
 * Eliminates duplication by providing single training interface for all contexts
 */
export class UnifiedTrainingOrchestrator {
  constructor() {
    this.isTraining = false;
    this.currentTrainingContext = null;
  }

  /**
   * Main entry point for all training scenarios
   * @param {string} context - Training context: 'manual', 'background', 'incremental', 'auto'
   * @param {Object} options - Training options (epochs, batchSize, etc.)
   * @returns {Promise<Object>} Training result
   */
  async startTraining(context, options = {}) {
    if (this.isTraining) {
      logger.mlTraining(`🔄 Training already in progress (${this.currentTrainingContext}), skipping ${context} request`);
      return { success: false, reason: 'training_in_progress' };
    }

    this.isTraining = true;
    this.currentTrainingContext = context;

    try {
      logger.mlTraining(`🚀 Starting ${context} training...`);

      // 1. Unified configuration resolution
      const config = await this.resolveConfiguration(context, options);
      
      // 2. Unified data preparation 
      const trainingData = await this.prepareTrainingData(config);
      
      // 3. Unified progress callback setup
      const callbacks = await this.setupProgressCallbacks(context, config);
      
      // 4. Chart management - ensure charts are ready
      await this.manageChartState(config);
      
      // 5. Single worker execution
      const result = await this.executeTraining(trainingData, config, callbacks);
      
      logger.mlTraining(`✅ ${context} training completed successfully`);
      return result;

    } catch (error) {
      logger.error(`❌ ${context} training failed:`, error);
      return { success: false, error: error.message };
    } finally {
      this.isTraining = false;
      this.currentTrainingContext = null;
    }
  }

  /**
   * Resolve training configuration from multiple sources
   * Priority: options → user settings → context defaults → global defaults
   */
  async resolveConfiguration(context, options) {
    const { TrainingConfigResolver } = await import('./training-config-resolver.js');
    const resolver = new TrainingConfigResolver();
    return resolver.resolve(context, options);
  }

  /**
   * Prepare training data using unified pipeline
   */
  async prepareTrainingData(config) {
    const { UnifiedDataPreparer } = await import('./unified-data-preparer.js');
    const preparer = new UnifiedDataPreparer();
    return preparer.prepare(config);
  }

  /**
   * Setup progress callbacks for the given context
   */
  async setupProgressCallbacks(context, config) {
    const { TrainingProgressManager } = await import('./training-progress-manager.js');
    const manager = new TrainingProgressManager();
    return manager.createCallbacks(context, config);
  }

  /**
   * Manage chart state and visibility for training
   */
  async manageChartState(config) {
    try {
      // Import training charts
      const { getTrainingCharts } = await import('../../modules/training-charts.js');
      const charts = getTrainingCharts();
      
      // Always ensure charts are visible when training starts
      if (!charts.isVisible) {
        charts.show();
        logger.mlTraining('📊 Training charts made visible for progress tracking');
      }
      
      // Dispatch trainingStarted event with correct isIncremental flag
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('trainingStarted', {
          detail: { 
            isIncremental: config.isIncremental,
            context: config.context
          }
        }));
        logger.mlTraining(`📈 Dispatched trainingStarted event (isIncremental: ${config.isIncremental})`);
      }
    } catch (error) {
      logger.error('Error managing chart state:', error);
      // Don't fail training if charts have issues
    }
  }

  /**
   * Execute training using WorkerManager
   */
  async executeTraining(trainingData, config, callbacks) {
    // Get WorkerManager
    const { getWorkerManager } = await import('../workers/worker-manager.js');
    const workerManager = getWorkerManager();
    
    // Initialize if needed
    if (!workerManager.isInitialized) {
      await workerManager.initialize();
    }

    // Prepare worker training parameters
    const workerParams = {
      trainingData: trainingData.training,
      validationData: trainingData.validation,
      epochs: config.epochs,
      batchSize: config.batchSize,
      incremental: config.isIncremental,
      onProgress: callbacks.onProgress,
      onComplete: callbacks.onComplete,
      onError: callbacks.onError
    };

    // Execute training
    const trainingJob = workerManager.train(workerParams);
    
    // Store job reference for potential cancellation
    this.currentTrainingJob = trainingJob;
    
    return trainingJob.promise;
  }

  /**
   * Cancel current training if in progress
   */
  async cancelTraining() {
    if (this.currentTrainingJob) {
      const { getWorkerManager } = await import('../workers/worker-manager.js');
      const workerManager = getWorkerManager();
      workerManager.cancelJob(this.currentTrainingJob.id);
      
      this.isTraining = false;
      this.currentTrainingContext = null;
      this.currentTrainingJob = null;
      
      logger.mlTraining('🛑 Training cancelled by user');
    }
  }

  /**
   * Get current training status
   */
  getStatus() {
    return {
      isTraining: this.isTraining,
      context: this.currentTrainingContext,
      jobId: this.currentTrainingJob?.id
    };
  }
}

// Export singleton instance
let orchestratorInstance = null;

export function getUnifiedTrainingOrchestrator() {
  if (!orchestratorInstance) {
    orchestratorInstance = new UnifiedTrainingOrchestrator();
  }
  return orchestratorInstance;
}

export default {
  UnifiedTrainingOrchestrator,
  getUnifiedTrainingOrchestrator
};