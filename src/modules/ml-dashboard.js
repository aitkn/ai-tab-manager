/*
 * AI Tab Manager - ML Dashboard
 * Handles Machine Learning dashboard UI and controls
 */

import { $id } from '../utils/dom-helpers.js';
import { state, updateState } from './state-manager.js';
import { smartConfirm } from '../utils/helpers.js';
import logger from '../utils/logger.js';
import { showStatus } from './ui-manager.js';
import { getBackendInfo } from '../ml/tensorflow-loader.js';
import { ML_CONFIG } from '../ml/model-config.js';
import StorageService from '../services/StorageService.js';
import { getTrainingCharts } from './training-charts.js';

/**
 * Initialize ML Dashboard
 */
export async function initializeMLDashboard() {
  // Set up ML checkbox
  const useMLCheckbox = $id('useMLCheckbox');
  if (useMLCheckbox) {
    useMLCheckbox.checked = state.settings.useML !== false; // Default to true
    
    // Show/hide ML dashboard based on checkbox state
    const mlDashboard = $id('mlDashboard');
    if (mlDashboard) {
      mlDashboard.style.display = useMLCheckbox.checked ? 'block' : 'none';
    }
    
    // Add change listener
    useMLCheckbox.addEventListener('change', handleMLToggle);
  }
  
  // Initialize charts only if Settings tab is currently active
  // This prevents chart overlap when extension opens on other tabs
  const settingsTab = document.getElementById('settingsTab');
  const isSettingsActive = settingsTab && settingsTab.classList.contains('active');
  
  if (isSettingsActive) {
    // Settings tab is active, initialize charts immediately
    setTimeout(async () => {
      const charts = getTrainingCharts();
      await charts.initialize();
    }, 100);
  }
  // If Settings tab not active, charts will be initialized when user switches to Settings
  
  // Set up training controls
  const trainModelBtn = $id('trainModelBtn');
  if (trainModelBtn) {
    trainModelBtn.addEventListener('click', handleTrainModel);
  }
  
  const resetModelBtn = $id('resetModelBtn');
  if (resetModelBtn) {
    resetModelBtn.addEventListener('click', handleResetModel);
  }
  
  
  // Always load ML status (it will show appropriate state)
  await updateMLStatus();
  
  // Listen for ML data changes
  window.addEventListener('mlDataChanged', async (event) => {
    logger.mlTraining('📊 ML data changed event received:', event.detail);
    
    // Update ML status if settings tab is active
    const settingsTab = document.getElementById('settingsTab');
    if (settingsTab && settingsTab.classList.contains('active')) {
      logger.mlTraining('✅ Updating ML dashboard due to data change');
      await updateMLStatus();
    }
  });
  
  // Listen for model promotion events
  window.addEventListener('mlModelPromoted', async (event) => {
    logger.mlTraining('🎉 ML model promoted event received:', event.detail);
    
    // Always update ML status when model is promoted
    logger.mlTraining('✅ Updating ML dashboard after model promotion');
    await updateMLStatus();
  });
}

/**
 * Check model state and start training if needed
 * @returns {Promise<boolean>} True if training was started
 */
async function checkModelStateAndTrain() {
  try {
    logger.mlTraining('🎯 ML DASHBOARD: checkModelStateAndTrain() called');
    const { getBackgroundMLService } = await import('../services/BackgroundMLService.js');
    const mlService = await getBackgroundMLService();
    logger.mlTraining('🎯 ML DASHBOARD: Got BackgroundMLService instance');
    
    // Use the centralized model state check
    const modelState = await mlService.checkModelState();
    
    logger.mlTraining('📊 Model state check:', {
      modelExists: modelState.modelExists,
      needsTraining: modelState.needsTraining,
      trainingDataCount: modelState.trainingDataCount,
      reason: modelState.reason
    });
    
    if (modelState.needsTraining) {
      // Check if training is already in progress to avoid conflicts
      logger.mlTraining(`🎯 ML DASHBOARD: Model needs training. Checking retrainingInProgress flag: ${mlService.retrainingInProgress}`);
      if (mlService.retrainingInProgress) {
        logger.mlTraining('⏳ ML DASHBOARD: Training already in progress via BackgroundMLService, skipping automatic training');
        showStatus('Training already in progress...', 'info', 3000);
        return false;
      }
      
      logger.mlTraining(`🚀 ${modelState.reason} - triggering model training...`);
      showStatus('Starting automatic model training...', 'info', 5000);
      
      // **FIXED**: Ensure training charts are visible and ready for progress
      const charts = getTrainingCharts();
      if (!charts.isVisible) {
        charts.show();
        logger.mlTraining('📊 Training charts made visible for automatic training');
      }
      
      // **FIXED**: Delegate to BackgroundMLService for coordinated training
      try {
        logger.mlTraining('✅ Delegating automatic training to BackgroundMLService');
        const success = await mlService.forceRetraining();
        
        if (success) {
          showStatus('Model training started via background service', 'success', 5000);
          return true;
        } else {
          showStatus('Could not start automatic training', 'warning', 5000);
          return false;
        }
        
      } catch (trainingError) {
        logger.error('Error starting automatic training:', trainingError);
        showStatus('Could not start automatic training', 'warning', 5000);
        return false;
      }
    } else {
      // Show appropriate message based on reason
      showStatus(`ML ready. ${modelState.reason}`, 'info', 5000);
      return false;
    }
  } catch (error) {
    logger.error('Error checking model state:', error);
    showStatus('Error checking ML model state', 'error', 5000);
    return false;
  }
}

/**
 * Handle ML toggle
 */
async function handleMLToggle(event) {
  const enabled = event.target.checked;
  
  // Update settings
  state.settings.useML = enabled;
  updateState('settings', state.settings);
  await StorageService.saveSettings(state.settings);
  
  // Show/hide dashboard
  const mlDashboard = $id('mlDashboard');
  if (mlDashboard) {
    mlDashboard.style.display = enabled ? 'block' : 'none';
  }
  
  // Notify services about the ML state change
  try {
    // Update BackgroundMLService
    const { getBackgroundMLService } = await import('../services/BackgroundMLService.js');
    const mlService = await getBackgroundMLService();
    await mlService.updateSettings(state.settings);
    
    // Update UnifiedDatabaseService
    const { getUnifiedDatabase } = await import('../services/UnifiedDatabaseService.js');
    const unifiedDB = await getUnifiedDatabase();
    unifiedDB.updateMLEnabled(enabled);
  } catch (error) {
    logger.error('Error updating ML services:', error);
  }
  
  // Update status regardless of enabled state
  await updateMLStatus();
  
  // If ML was just enabled, check model state and train if needed
  if (enabled) {
    await checkModelStateAndTrain();
  }
}

/**
 * Update ML status display
 */
export async function updateMLStatus() {
  try {
    const statusContent = $id('mlStatusContent');
    if (!statusContent) {
      return;
    }
    
    // Clear ALL existing content immediately (including any loading message)
    statusContent.innerHTML = '';
    
    // Check if ML is disabled
    if (state.settings.useML === false) {
      statusContent.innerHTML = `
        <div style="color: var(--md-sys-color-on-surface-variant);">
          <div style="margin-bottom: 4px;">ML features disabled</div>
          <div style="font-size: 11px;">Enable ML categorization to see status and metrics.</div>
        </div>
      `;
      // Don't return - continue to update performance metrics
    } else {
      // Get ML status
      let mlCategorizer, status;
      try {
        const { getMLCategorizer } = await import('../ml/categorization/ml-categorizer.js');
        mlCategorizer = await getMLCategorizer();
        status = await mlCategorizer.getStatus();
      } catch (mlError) {
        // Show a more user-friendly message if ML modules are not available
        const isCSPError = mlError.message && mlError.message.includes('unsafe-eval');
        statusContent.innerHTML = `
          <div style="color: var(--md-sys-color-on-surface-variant);">
            <div style="margin-bottom: 4px;">ML features not available</div>
            <div style="font-size: 11px;">
              ${isCSPError 
                ? 'TensorFlow.js CSP-compliant modules failed to load. ML features are disabled.' 
                : 'Machine learning capabilities are being loaded. If this persists, ML features may not be available.'
              }
            </div>
          </div>
        `;
        // Don't return - continue to update performance metrics
      }
      
      if (status) {
        // Get backend information
        const backendInfo = getBackendInfo();
        
        statusContent.innerHTML = `
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Backend:</span>
            <span style="font-weight: 500; color: ${backendInfo.isGPU ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-on-surface-variant)'}">
              ${backendInfo.isGPU ? '🚀 GPU (WebGL)' : '💻 CPU'} ${backendInfo.backend ? `(${backendInfo.backend})` : ''}
            </span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Available:</span>
            <span style="font-weight: 500; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">
              ${backendInfo.available.join(', ') || 'None'}
            </span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Model exists:</span>
            <span style="font-weight: 500; color: ${status.modelExists ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-error)'}">
              ${status.modelExists ? 'Yes' : 'No'}
            </span>
          </div>
          ${status.modelExists && status.modelAccuracy ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Model accuracy:</span>
              <span style="font-weight: 500; color: var(--md-sys-color-primary)">
                ${Math.round(status.modelAccuracy * 100)}%
              </span>
            </div>
          ` : ''}
          ${backendInfo.memory ? `
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>GPU Memory:</span>
              <span style="font-weight: 500; color: var(--md-sys-color-on-surface-variant); font-size: 11px;">
                ${Math.round(backendInfo.memory.numBytes / 1024 / 1024)}MB
              </span>
            </div>
          ` : ''}
          ${!status.modelExists ? `
            <div style="margin-top: 8px; color: var(--md-sys-color-on-surface-variant);">
              The model will be created after you categorize more tabs.
            </div>
          ` : ''}
        `;
        
        // Update training button text based on model existence
        const trainBtn = $id('trainModelBtn');
        if (trainBtn) {
          // Always show "Train Model" - it handles both new and incremental training
          trainBtn.textContent = 'Train Model';
          if (status.modelExists) {
            trainBtn.title = 'Force incremental training without waiting for minimum new examples';
          } else {
            trainBtn.title = 'Create and train a new model from scratch';
          }
        }
        
        // Update feedback stats if available
        if (status.feedbackStats) {
          const insights = status.feedbackStats.correctionPatterns;
          if (insights && insights.length > 0) {
            // Could add a section to show common correction patterns
          }
        }
        
        // Update trust weights
        const trustContent = $id('mlTrustContent');
        if (trustContent && status.trustWeights) {
          const weights = status.trustWeights;
          trustContent.innerHTML = `
            <div class="trust-weight-item" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Rules:</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 100px; height: 8px; background: var(--md-sys-color-surface-container-highest); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${weights.rules * 100}%; height: 100%; background: var(--md-sys-color-primary);"></div>
                </div>
                <span style="font-weight: 500; min-width: 40px; text-align: right;">${Math.round(weights.rules * 100)}%</span>
              </div>
            </div>
            <div class="trust-weight-item" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Model:</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 100px; height: 8px; background: var(--md-sys-color-surface-container-highest); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${weights.model * 100}%; height: 100%; background: var(--md-sys-color-secondary);"></div>
                </div>
                <span style="font-weight: 500; min-width: 40px; text-align: right;">${Math.round(weights.model * 100)}%</span>
              </div>
            </div>
            <div class="trust-weight-item" style="display: flex; justify-content: space-between;">
              <span>LLM:</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 100px; height: 8px; background: var(--md-sys-color-surface-container-highest); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${weights.llm * 100}%; height: 100%; background: var(--md-sys-color-tertiary);"></div>
                </div>
                <span style="font-weight: 500; min-width: 40px; text-align: right;">${Math.round(weights.llm * 100)}%</span>
              </div>
            </div>
          `;
        }
      }
    }
    
    // Always update performance metrics (regardless of ML status)
    await updatePerformanceMetrics();
    
  } catch (error) {
    logger.error('Error updating ML status:', error);
    logger.error('Error stack:', error.stack);
    
    // Show error state
    const statusContent = $id('mlStatusContent');
    if (statusContent) {
      statusContent.innerHTML = `
        <div style="color: var(--md-sys-color-on-surface-variant);">
          <div>ML features unavailable</div>
          <div style="font-size: 11px; margin-top: 4px;">${error.message || 'Check console for details'}</div>
        </div>
      `;
    }
    
    // Still try to update performance metrics
    await updatePerformanceMetrics();
  }
}

/**
 * Handle train model button
 */
async function handleTrainModel() {
  const trainBtn = $id('trainModelBtn');
  const statusSpan = $id('trainingStatus');
  
  if (!trainBtn || !statusSpan) return;
  
  // Disable button and show status
  trainBtn.disabled = true;
  trainBtn.textContent = 'Training...';
  statusSpan.textContent = 'Starting training...';
  
  try {
    // Check if model exists to determine if this should be incremental training
    const { getTabClassifier } = await import('../ml/models/tab-classifier.js');
    const classifier = await getTabClassifier();
    const modelExists = classifier && !classifier.disabled && classifier.isLoaded && classifier.model !== null;
    
    logger.mlTraining(`Manual training triggered - modelExists: ${modelExists}, will use incremental: ${modelExists}`);
    
    // Get training settings from state - defaults are defined in state-manager.js
    const patience = state.settings.mlEarlyStoppingPatience;
    const batchSize = state.settings.mlBatchSize;
    const learningRate = state.settings.mlLearningRate;
    
    // No longer need to directly create WorkerManager - trainer handles it
    
    // Get model trainer for data preparation
    const { ModelTrainer } = await import('../ml/training/trainer.js');
    const trainer = new ModelTrainer();
    await trainer.initialize();
    
    // Prepare training data
    statusSpan.textContent = 'Loading training data from saved tabs...';
    const trainingData = await trainer.prepareTrainingData();
    
    if (trainingData.length < 20) {
      // Get saved tabs count for better error message
      const savedTabs = await window.tabDatabase.getAllSavedTabs();
      const categorizedSavedTabs = savedTabs.filter(tab => tab.category && tab.category > 0);
      
      statusSpan.textContent = `Need more data (${categorizedSavedTabs.length}/20 categorized saved tabs)`;
      return;
    }
    
    // Check if model already exists for incremental training
    const { getMLCategorizer } = await import('../ml/categorization/ml-categorizer.js');
    const mlCategorizer = await getMLCategorizer(true);
    const mlStatus = await mlCategorizer.getStatus();
    
    // Get training charts (already initialized)
    const charts = getTrainingCharts();
    
    // Only clear if this is a fresh training (not incremental)
    if (!mlStatus.modelExists) {
      charts.clear();
    }
    
    // Start training in Web Worker
    statusSpan.textContent = 'Starting training in background worker...';
    
    // Set callbacks on trainer
    trainer.setCallbacks({
      onProgress: (progress) => {
        if (progress.epoch !== undefined) {
          const epochDisplay = progress.epoch + 1;
          // Use totalEpochs from progress data if available (for proper incremental training display)
          const totalEpochsDisplay = progress.totalEpochs || 10000;
          statusSpan.textContent = `Training: Epoch ${epochDisplay}/${totalEpochsDisplay} - ${Math.round(progress.progress * 100)}%`;
          
          // Update charts with training progress
          if (progress.loss !== undefined) {
            charts.addDataPoint(
              epochDisplay,
              progress.loss, // training loss
              progress.valLoss || progress.loss, // validation loss
              progress.trainAccuracy || progress.accuracy || 0, // training accuracy
              progress.valAccuracy || progress.accuracy || 0 // validation accuracy
            );
            
            // Training history is automatically saved by the training system in model metadata
          }
        } else {
          statusSpan.textContent = `Training: ${Math.round(progress.progress * 100)}%`;
        }
      },
      onComplete: async (result) => {
        if (result.success) {
          statusSpan.textContent = `Training complete! Accuracy: ${Math.round(result.accuracy * 100)}%`;
          showStatus('Model trained successfully', 'success');
          
          // Dashboard will be updated automatically by mlModelPromoted event
          // triggered when the model is actually promoted
        } else {
          statusSpan.textContent = 'Training failed';
          showStatus('Error training model', 'error');
        }
        
        // Re-enable button
        trainBtn.disabled = false;
        trainBtn.textContent = 'Train Model';
      },
      onError: (error) => {
        logger.error('Worker training error:', error);
        statusSpan.textContent = 'Training failed';
        showStatus('Error training model', 'error');
        
        // Re-enable button
        trainBtn.disabled = false;
        trainBtn.textContent = 'Train Model';
      }
    });
    
    // Use trainer's proper training method which includes data splitting
    const result = await trainer.trainWithStoredData({
      epochs: 10000,  // Max epochs - early stopping will handle actual stopping
      earlyStoppingPatience: patience,
      incremental: modelExists,  // Use the modelExists we checked above
      batchSize: batchSize,
      learningRate: learningRate,
      balanceClasses: true
    });
    
  } catch (error) {
    logger.error('Error training model:', error);
    statusSpan.textContent = 'Training failed';
    showStatus('Error training model', 'error');
  } finally {
    // Re-enable button
    trainBtn.disabled = false;
    trainBtn.textContent = 'Train Now';
    
    // Clear status after delay
    setTimeout(() => {
      statusSpan.textContent = '';
    }, 5000);
  }
}

/**
 * Handle reset model button
 */
async function handleResetModel() {
  const confirmMessage = `Are you sure you want to reset the ML model?

This will DELETE:
• Trained model weights
• Vocabulary 
• Performance metrics
• Metrics summary

This will PRESERVE:
• All training data (for retraining)
• All predictions history

You can retrain the model after reset using the preserved data.`;
  
  if (!await smartConfirm(confirmMessage, { 
    defaultAnswer: false,
    confirmType: 'warning'  // Orange button for destructive action
  })) {
    return;
  }
  
  const resetBtn = $id('resetModelBtn');
  const statusSpan = $id('trainingStatus');
  
  if (!resetBtn || !statusSpan) return;
  
  // Disable button
  resetBtn.disabled = true;
  statusSpan.textContent = 'Resetting model...';
  
  try {
    // Always check for and cancel any active training jobs
    statusSpan.textContent = 'Stopping any active training...';
    
    // Get worker manager and cancel all training jobs
    try {
      const { getWorkerManager } = await import('../ml/workers/worker-manager.js');
      const workerManager = getWorkerManager();
      
      // Cancel all active training jobs
      if (workerManager) {
        logger.mlTraining('WorkerManager found, checking for active jobs...');
        if (workerManager.cancelAllTrainingJobs) {
          const cancelledCount = workerManager.cancelAllTrainingJobs();
          logger.mlTraining(`Cancelled ${cancelledCount} active training job(s) for model reset`);
          
          // If jobs were cancelled but might be stuck, force cleanup
          if (cancelledCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
            const remainingJobs = workerManager.forceCleanupTrainingJobs();
            if (remainingJobs > 0) {
              logger.mlTraining(`Force cleaned up ${remainingJobs} stuck training job(s)`);
            }
          }
        } else {
          logger.mlTraining('WorkerManager does not have cancelAllTrainingJobs method');
        }
      } else {
        logger.mlTraining('WorkerManager not found');
      }
      
      // Clear any job reference stored on the button
      const trainBtn = $id('trainModelBtn');
      if (trainBtn && trainBtn.dataset.jobId) {
        delete trainBtn.dataset.jobId;
      }
      
      // Re-enable the train button if it was disabled
      if (trainBtn) {
        trainBtn.disabled = false;
        trainBtn.textContent = 'Train Model';
      }
      
      // Clear training charts since we're cancelling mid-training
      const charts = getTrainingCharts();
      if (charts) {
        charts.clear();
      }
    } catch (cancelError) {
      logger.error('Error cancelling training:', cancelError);
    }
    
    // Wait a moment for cancellation to process
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Update status after cancellation
    statusSpan.textContent = 'Resetting model...';
    
    // Double-check that jobs are cleared
    try {
      const { getWorkerManager: getWM } = await import('../ml/workers/worker-manager.js');
      const wm = getWM();
      if (wm && wm.jobs) {
        // Log current jobs for debugging
        const jobsList = Array.from(wm.jobs.entries()).map(([id, job]) => ({
          id,
          type: job.type,
          status: job.status
        }));
        if (jobsList.length > 0) {
          logger.mlTraining('Jobs remaining after cancellation:', jobsList);
        }
      }
    } catch (e) {
      // Ignore if we can't access workerManager
    }
    
    // Also stop any background training and clear interrupted training
    const { getBackgroundMLService } = await import('../services/BackgroundMLService.js');
    const mlService = await getBackgroundMLService();
    if (mlService.retrainingInProgress) {
      logger.mlTraining('Stopping background training for model reset');
      mlService.retrainingInProgress = false;
    }
    
    // Interrupted training should never be automatically deleted - user decides when to clear
    
    // Get ML database
    const { resetMLModel } = await import('../ml/storage/ml-database.js');
    const stats = await resetMLModel();
    
    // Reset trust weights
    const { getTrustManager } = await import('../ml/trust/trust-manager.js');
    const trustManager = getTrustManager();
    await trustManager.resetTrust();
    
    // Clear vocabulary cache to force rebuild
    const { clearVocabularyCache } = await import('../ml/features/vocabulary.js');
    clearVocabularyCache();
    
    // Reset classifier cache to force rebuild
    const { resetTabClassifierCache, TabClassifier } = await import('../ml/models/tab-classifier.js');
    resetTabClassifierCache();
    
    // Also clear the TensorFlow.js model from IndexedDB
    const tempClassifier = new TabClassifier();
    await tempClassifier.clearStoredModel();
    
    // Clear training charts data but keep charts visible
    const charts = getTrainingCharts();
    charts.clear();
    
    // Show success with preserved data info
    statusSpan.textContent = 'Model reset complete';
    showStatus(`ML model has been reset. Preserved ${stats.trainingData || 0} training records and ${stats.predictions || 0} predictions.`, 'success');
    
    // Update dashboard
    await updateMLStatus();
    
    // Check model state and trigger rebuild if needed
    statusSpan.textContent = 'Checking model state...';
    const trainingStarted = await checkModelStateAndTrain();
    
    if (trainingStarted) {
      statusSpan.textContent = 'Model training started';
      
      // Ensure charts are ready to receive background training events
      const charts = getTrainingCharts();
      if (!charts.isVisible) {
        charts.show();
      }
    } else {
      statusSpan.textContent = 'Model reset complete';
    }
    
  } catch (error) {
    logger.error('Error resetting model:', error);
    statusSpan.textContent = 'Reset failed';
    showStatus('Error resetting model', 'error');
  } finally {
    // Re-enable button
    resetBtn.disabled = false;
    
    // Clear status after delay
    setTimeout(() => {
      statusSpan.textContent = '';
    }, 3000);
  }
}

/**
 * Update performance metrics (trust weights and accuracy)
 * This applies to all categorization methods, not just ML
 */
export async function updatePerformanceMetrics() {
  try {
    // Get ML status for trust weights if not already updated
    const trustContent = $id('mlTrustContent');
    if (trustContent && trustContent.innerHTML.includes('Loading trust data...')) {
      try {
        const { getMLCategorizer } = await import('../ml/categorization/ml-categorizer.js');
        const mlCategorizer = await getMLCategorizer();
        const status = await mlCategorizer.getStatus();
        
        if (status.trustWeights) {
          const weights = status.trustWeights;
          trustContent.innerHTML = `
            <div class="trust-weight-item" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Rules:</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 100px; height: 8px; background: var(--md-sys-color-surface-container-highest); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${weights.rules * 100}%; height: 100%; background: var(--md-sys-color-primary);"></div>
                </div>
                <span style="font-weight: 500; min-width: 40px; text-align: right;">${Math.round(weights.rules * 100)}%</span>
              </div>
            </div>
            <div class="trust-weight-item" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span>Model:</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 100px; height: 8px; background: var(--md-sys-color-surface-container-highest); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${weights.model * 100}%; height: 100%; background: var(--md-sys-color-secondary);"></div>
                </div>
                <span style="font-weight: 500; min-width: 40px; text-align: right;">${Math.round(weights.model * 100)}%</span>
              </div>
            </div>
            <div class="trust-weight-item" style="display: flex; justify-content: space-between;">
              <span>LLM:</span>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 100px; height: 8px; background: var(--md-sys-color-surface-container-highest); border-radius: 4px; overflow: hidden;">
                  <div style="width: ${weights.llm * 100}%; height: 100%; background: var(--md-sys-color-tertiary);"></div>
                </div>
                <span style="font-weight: 500; min-width: 40px; text-align: right;">${Math.round(weights.llm * 100)}%</span>
              </div>
            </div>
          `;
        }
      } catch (error) {
        logger.mlTraining('Could not get ML status for trust weights:', error);
        trustContent.innerHTML = '<div style="color: var(--md-sys-color-on-surface-variant);">Trust weights not available</div>';
      }
    }
    
    // Update performance metrics
    const performanceContent = $id('mlPerformanceContent');
    if (performanceContent) {
      try {
        // Get performance tracker
        const { getPerformanceTracker } = await import('../ml/trust/performance-tracker.js');
        const tracker = getPerformanceTracker();
        
        // Force reload cached metrics from database
        const { loadAllTimeMetrics: loadCachedMetrics } = await import('../ml/storage/ml-database.js');
        const freshMetrics = await loadCachedMetrics();
        if (freshMetrics) {
          // Update the tracker's cached metrics with fresh data from database
          tracker.allTimeMetrics = freshMetrics;
        }
        
        // Also reload last 100 metrics
        await tracker.loadLast100Metrics();
        
        // Get metrics for all scopes
        const sessionMetrics = await tracker.getMetrics('session');
        const last100Metrics = await tracker.getMetrics('last100');
        const allTimeMetrics = await tracker.getMetrics('allTime');
        
        // Build table
        let html = `
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="border-bottom: 1px solid var(--md-sys-color-outline-variant);">
                <th style="text-align: left; padding: 8px 8px 8px 0; font-weight: 500;">Method</th>
                <th style="text-align: center; padding: 8px 4px; font-weight: 500;">Session</th>
                <th style="text-align: center; padding: 8px 4px; font-weight: 500;">Last 100</th>
                <th style="text-align: center; padding: 8px 4px; font-weight: 500;">All Time</th>
              </tr>
            </thead>
            <tbody>
        `;
        
        // Add rows for each method
        const methods = [
          { key: 'rules', name: 'Rules' },
          { key: 'model', name: 'ML Model' },
          { key: 'llm', name: 'LLM' }
        ];
        
        methods.forEach(({ key, name }, index) => {
          const sessionData = sessionMetrics[key];
          const last100Data = last100Metrics[key];
          const allTimeData = allTimeMetrics[key];
          
          html += `
            <tr ${index < methods.length - 1 ? 'style="border-bottom: 1px solid var(--md-sys-color-surface-variant);"' : ''}>
              <td style="padding: 8px 8px 8px 0; font-weight: 500;">${name}</td>
              <td style="text-align: center; padding: 8px 4px;">
                ${sessionData ? `
                  <div style="font-weight: 500;">${(sessionData.accuracy * 100).toFixed(1)}%</div>
                  <div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant);">${sessionData.correct}/${sessionData.total}</div>
                ` : '<div style="color: var(--md-sys-color-on-surface-variant);">-</div>'}
              </td>
              <td style="text-align: center; padding: 8px 4px;">
                ${last100Data ? `
                  <div style="font-weight: 500;">${(last100Data.accuracy * 100).toFixed(1)}%</div>
                  <div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant);">${last100Data.correct}/${last100Data.total}</div>
                ` : '<div style="color: var(--md-sys-color-on-surface-variant);">-</div>'}
              </td>
              <td style="text-align: center; padding: 8px 4px;">
                ${allTimeData ? `
                  <div style="font-weight: 500;">${(allTimeData.accuracy * 100).toFixed(1)}%</div>
                  <div style="font-size: 11px; color: var(--md-sys-color-on-surface-variant);">${allTimeData.correct}/${allTimeData.total}</div>
                ` : '<div style="color: var(--md-sys-color-on-surface-variant);">-</div>'}
              </td>
            </tr>
          `;
        });
        
        html += `
            </tbody>
          </table>
        `;
        
        // Check if we have any data
        const hasAnyData = methods.some(({ key }) => 
          sessionMetrics[key] || last100Metrics[key] || allTimeMetrics[key]
        );
        
        performanceContent.innerHTML = hasAnyData ? html : '<div>No performance data yet</div>';
      } catch (error) {
        logger.mlTraining('Could not load performance metrics:', error);
        performanceContent.innerHTML = '<div style="color: var(--md-sys-color-on-surface-variant);">Performance metrics not available</div>';
      }
    }
  } catch (error) {
    logger.error('Error updating performance metrics:', error);
  }
}