/*
 * AI Tab Manager - Training Progress Manager
 * Unified progress callback system for all training contexts
 */

import logger from '../../utils/logger.js';

/**
 * Training Progress Manager
 * Creates consistent progress callbacks for different training contexts
 */
export class TrainingProgressManager {
  
  /**
   * Create progress callbacks for the given context
   * @param {string} context - Training context
   * @param {Object} config - Training configuration
   * @returns {Object} Callback functions { onProgress, onComplete, onError }
   */
  createCallbacks(context, config) {
    const callbacks = {
      onProgress: this.createProgressCallback(context, config),
      onComplete: this.createCompleteCallback(context, config),
      onError: this.createErrorCallback(context, config)
    };

    logger.mlTraining(`📊 Created ${context} progress callbacks (UI: ${config.uiCallbacks})`);
    return callbacks;
  }

  /**
   * Create progress callback function
   */
  createProgressCallback(context, config) {
    return async (progress) => {
      // Always dispatch progress events for charts
      this.dispatchProgressEvent(progress);
      
      // Context-specific progress handling
      if (config.uiCallbacks) {
        await this.updateUIProgress(progress, context, config);
      }
      
      // Always log progress for debugging
      this.logProgress(progress, context);
    };
  }

  /**
   * Create completion callback function
   */
  createCompleteCallback(context, config) {
    return async (result) => {
      logger.mlTraining(`✅ ${context} training completed:`, {
        success: result.success,
        accuracy: result.accuracy,
        duration: result.duration
      });

      // Context-specific completion handling
      if (config.uiCallbacks) {
        await this.updateUIComplete(result, context);
      }
      
      // Always update ML status after training
      await this.updateMLStatus();
      
      // Dispatch completion event
      this.dispatchCompletionEvent(result, context);
    };
  }

  /**
   * Create error callback function
   */
  createErrorCallback(context, config) {
    return (error) => {
      logger.error(`❌ ${context} training error:`, error);

      // Context-specific error handling
      if (config.uiCallbacks) {
        this.updateUIError(error, context);
      }
      
      // Always show user-friendly error for important contexts
      if (['manual', 'auto'].includes(context)) {
        this.showUserError(error, context);
      }
    };
  }

  /**
   * Dispatch training progress event for charts
   */
  dispatchProgressEvent(progress) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('trainingProgress', {
        detail: progress
      }));
    }
  }

  /**
   * Update UI progress elements
   */
  async updateUIProgress(progress, context, config) {
    try {
      const statusSpan = document.getElementById('trainingStatus');
      if (statusSpan) {
        if (progress.epoch !== undefined) {
          const epochDisplay = progress.epoch + 1;
          const totalEpochs = config.epochs;
          statusSpan.textContent = `Training: Epoch ${epochDisplay}/${totalEpochs} - ${Math.round(progress.progress * 100)}%`;
        } else {
          statusSpan.textContent = `Training: ${Math.round(progress.progress * 100)}%`;
        }
      }

      // Update training charts if available
      try {
        const { getTrainingCharts } = await import('../../modules/training-charts.js');
        if (getTrainingCharts && progress.epoch !== undefined && progress.loss !== undefined) {
          const charts = getTrainingCharts();
          charts.addDataPoint(
            progress.epoch + 1,
            progress.loss,
            progress.valLoss || progress.loss,
            progress.trainAccuracy || progress.accuracy || 0,
            progress.valAccuracy || progress.accuracy || 0
          );
          // Training history is automatically saved by the training system in model metadata
        }
      } catch (chartError) {
        // Don't fail if chart updates fail
        logger.error('Error updating training charts:', chartError);
      }
    } catch (error) {
      // Don't fail training if UI updates fail
      logger.error('Error updating UI progress:', error);
    }
  }

  /**
   * Update UI on training completion
   */
  async updateUIComplete(result, context) {
    try {
      const statusSpan = document.getElementById('trainingStatus');
      if (statusSpan) {
        if (result.success) {
          const accuracy = Math.round(result.accuracy * 100);
          statusSpan.textContent = `Training complete! Accuracy: ${accuracy}%`;
        } else {
          statusSpan.textContent = 'Training failed';
        }
      }

      // Re-enable train button if it exists
      const trainBtn = document.getElementById('trainModelBtn');
      if (trainBtn) {
        trainBtn.disabled = false;
        trainBtn.textContent = 'Train Now';
      }

      // Show success status
      if (result.success) {
        this.showUserStatus('Model trained successfully', 'success');
      } else {
        this.showUserStatus('Training failed', 'error');
      }
    } catch (error) {
      logger.error('Error updating UI completion:', error);
    }
  }

  /**
   * Update UI on training error
   */
  updateUIError(error, context) {
    try {
      const statusSpan = document.getElementById('trainingStatus');
      if (statusSpan) {
        statusSpan.textContent = 'Training failed';
      }

      // Re-enable train button if it exists
      const trainBtn = document.getElementById('trainModelBtn');
      if (trainBtn) {
        trainBtn.disabled = false;
        trainBtn.textContent = 'Train Now';
      }
    } catch (uiError) {
      logger.error('Error updating UI error:', uiError);
    }
  }

  /**
   * Log progress for debugging
   */
  logProgress(progress, context) {
    if (logger.isEnabled('ml.training')) {
      if (progress.epoch !== undefined) {
        const epochDisplay = progress.epoch + 1;
        logger.mlTraining(`📈 ${context} training - Epoch ${epochDisplay}: ${Math.round(progress.progress * 100)}%`);
      }
    }
  }

  /**
   * Update ML status dashboard
   */
  async updateMLStatus() {
    try {
      const { updateMLStatus } = await import('../../modules/ml-dashboard.js');
      await updateMLStatus();
    } catch (error) {
      logger.error('Error updating ML status:', error);
    }
  }

  /**
   * Show user-friendly status message
   */
  showUserStatus(message, type) {
    try {
      const { showStatus } = await import('../../modules/ui-manager.js');
      showStatus(message, type);
    } catch (error) {
      logger.error('Error showing user status:', error);
    }
  }

  /**
   * Show user-friendly error message
   */
  showUserError(error, context) {
    const contextName = context === 'auto' ? 'automatic' : context;
    this.showUserStatus(`Error during ${contextName} training`, 'error');
  }

  /**
   * Dispatch training completion event
   */
  dispatchCompletionEvent(result, context) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('trainingComplete', {
        detail: {
          result,
          context,
          success: result.success
        }
      }));
    }
  }

  /**
   * Safely import training charts
   */
  async getTrainingCharts() {
    try {
      return await import('../../modules/training-charts.js');
    } catch (error) {
      return {};
    }
  }
}

export default { TrainingProgressManager };