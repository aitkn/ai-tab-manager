/*
 * AI Tab Manager - Training Configuration Resolver
 * Unified configuration management for all training scenarios
 */

import { ML_CONFIG } from '../model-config.js';
import logger from '../../utils/logger.js';

/**
 * Training Configuration Resolver
 * Consolidates configuration from multiple sources with proper priority chain
 */
export class TrainingConfigResolver {
  
  /**
   * Resolve final configuration for training
   * Priority: options → user settings → context defaults → global defaults
   * @param {string} context - Training context ('manual', 'background', 'incremental', 'auto')
   * @param {Object} options - Provided options
   * @returns {Object} Resolved configuration
   */
  async resolve(context, options = {}) {
    // Get user settings if available
    const userSettings = await this.getUserSettings();
    
    // Get context-specific defaults
    const contextDefaults = this.getContextDefaults(context);
    
    // Apply priority chain: options → user settings → context defaults → global defaults
    const config = {
      // Default values from config
      epochs: ML_CONFIG.training.epochs,
      batchSize: userSettings.mlBatchSize,
      learningRate: userSettings.mlLearningRate,
      earlyStoppingPatience: userSettings.mlEarlyStoppingPatience,
      validationSplit: ML_CONFIG.training.validationSplit,
      
      // Context defaults
      ...contextDefaults,
      
      // User settings (if available)
      ...(userSettings.mlBatchSize && { batchSize: userSettings.mlBatchSize }),
      
      // Provided options (highest priority)
      ...options,
      
      // Always include context and derived flags
      context,
      isIncremental: this.determineIncremental(context, options),
      backgroundMode: this.isBackgroundContext(context),
      uiCallbacks: this.needsUICallbacks(context)
    };

    // Apply context-specific constraints
    this.applyContextConstraints(config, context);
    
    logger.mlTraining(`🔧 Resolved ${context} training config:`, {
      epochs: config.epochs,
      batchSize: config.batchSize,
      isIncremental: config.isIncremental,
      backgroundMode: config.backgroundMode,
      uiCallbacks: config.uiCallbacks
    });

    return config;
  }

  /**
   * Get user settings from state
   */
  async getUserSettings() {
    try {
      // Import state manager to get user settings
      const { state } = await import('../../modules/state-manager.js');
      return state.settings || {};
    } catch (error) {
      logger.error('Error getting user settings:', error);
      return {};
    }
  }

  /**
   * Get context-specific default values
   */
  getContextDefaults(context) {
    switch (context) {
      case 'manual':
        return {
          // Manual training uses user settings, no overrides
          timeout: 0, // No timeout for manual training
        };
        
      case 'background':
        return {
          // Background training uses user settings, just add timeout
          timeout: ML_CONFIG.backgroundTraining.maxTrainingTime || 300000, // 5 minutes
        };
        
      case 'incremental':
        return {
          // Incremental uses user settings but with shorter timeout
          timeout: 60000, // 1 minute for incremental
        };
        
      case 'auto':
        return {
          // Auto training uses user settings with timeout
          timeout: ML_CONFIG.backgroundTraining.maxTrainingTime || 300000,
        };
        
      default:
        logger.warn(`Unknown training context: ${context}, using user settings`);
        return {}; // User settings will be used
    }
  }

  /**
   * Determine if training should be incremental
   */
  determineIncremental(context, options) {
    // Explicit override
    if (options.incremental !== undefined) {
      return options.incremental;
    }
    
    // Context-based determination
    switch (context) {
      case 'incremental':
        return true; // Always incremental
        
      case 'manual':
        // Check if model exists to determine incremental vs fresh
        return options.modelExists || false;
        
      case 'background':
      case 'auto':
        // Background training is usually incremental unless explicitly fresh
        return options.freshTraining !== true;
        
      default:
        return false;
    }
  }

  /**
   * Check if context is background/silent
   */
  isBackgroundContext(context) {
    return ['background', 'auto'].includes(context);
  }

  /**
   * Check if context needs UI callbacks
   */
  needsUICallbacks(context) {
    return ['manual'].includes(context);
  }

  /**
   * Apply context-specific constraints
   */
  applyContextConstraints(config, context) {
    switch (context) {
      case 'background':
        // Background training should be time-limited
        if (config.timeout === 0) {
          config.timeout = 300000; // Force 5-minute timeout
        }
        // Limit epochs for background training
        if (config.epochs > 50) {
          config.epochs = 50;
          logger.mlTraining('⚠️ Limited background training to 50 epochs');
        }
        break;
        
      case 'incremental':
        // Incremental training should be quick
        if (config.epochs > 10) {
          config.epochs = 10;
          logger.mlTraining('⚠️ Limited incremental training to 10 epochs');
        }
        break;
        
      case 'manual':
        // Manual training respects user settings more freely
        break;
        
      case 'auto':
        // Auto training uses user settings without modification
        break;
    }
  }
}

export default { TrainingConfigResolver };