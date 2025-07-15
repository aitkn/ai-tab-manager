/*
 * AI Tab Manager - Performance Tracker
 * Tracks accuracy and performance metrics for all categorization methods
 */

import { ML_CONFIG } from '../model-config.js';
import { recordMetric, getMetrics, recordPrediction, STORES } from '../storage/ml-database.js';
import logger from '../../utils/logger.js';

/**
 * Performance Tracker for all categorization methods
 */
export class PerformanceTracker {
  constructor() {
    
    // Track predictions and outcomes
    this.predictions = {
      rules: { correct: 0, total: 0, recentAccuracy: [] },
      model: { correct: 0, total: 0, recentAccuracy: [] },
      llm: { correct: 0, total: 0, recentAccuracy: [] }
    };
    
    // Calculated accuracies (0-1)
    this.accuracy = {
      rules: ML_CONFIG.trust.initialWeights.rules,
      model: ML_CONFIG.trust.initialWeights.model,
      llm: ML_CONFIG.trust.initialWeights.llm
    };
    
    // Trust weights (normalized)
    this.trustWeights = { ...ML_CONFIG.trust.initialWeights };
    
    // Rolling window size
    this.windowSize = ML_CONFIG.trust.accuracyWindow;
    
    // Minimum predictions before adjusting trust
    this.minPredictions = ML_CONFIG.trust.minPredictionsForAdjustment;
    
    // Track prediction history
    this.predictionHistory = [];
    
    // Session metrics (reset when popup opens)
    this.sessionMetrics = {
      startTime: Date.now(),
      predictions: {
        rules: { total: 0, correct: 0 },
        model: { total: 0, correct: 0 },
        llm: { total: 0, correct: 0 }
      }
    };
    
    // Initialize metrics containers
    // allTimeMetrics removed - now read/write directly to database
    this.last100Metrics = null;
    
    
    // Load historical data on init
    this.initializationPromise = this.loadHistoricalMetrics();
  }
  
  /**
   * Load historical metrics from storage
   */
  async loadHistoricalMetrics() {
    try {
      // Load recent metrics for each method
      for (const method of ['rules', 'model', 'llm']) {
        const metrics = await getMetrics(method, 'accuracy', this.windowSize);
        
        if (metrics.length > 0) {
          // Calculate average accuracy from historical data
          const avgAccuracy = metrics.reduce((sum, m) => sum + m.value, 0) / metrics.length;
          this.accuracy[method] = avgAccuracy;
          
          // Update recent accuracy array
          this.predictions[method].recentAccuracy = metrics.map(m => m.value);
        }
      }
      
      // Recalculate trust weights based on loaded accuracies
      this.updateTrustWeights();
      
      // allTimeMetrics no longer cached - loaded on demand
      
      // Load last 100 predictions
      await this.loadLast100Metrics();
      
    } catch (error) {
      logger.error('Error loading historical metrics:', error);
    }
  }
  
  /**
   * Record a prediction and its outcome
   * @param {Object} prediction - Prediction details
   * @param {string} finalCategory - Final category (after user confirmation)
   * @param {string} source - How final decision was made
   */
  async recordPrediction(prediction, finalCategory, source = 'user') {
    // Store prediction in database
    const predictionRecord = await recordPrediction({
      ...prediction,
      final: finalCategory,
      source,
      corrected: false // Track if user later corrected this prediction
    });
    
    // Track what each method predicted
    for (const method of ['rules', 'model', 'llm']) {
      if (prediction[method] !== undefined && prediction[method] !== null) {
        const isCorrect = prediction[method] === finalCategory;
        
        // Update counters
        this.predictions[method].total++;
        if (isCorrect) {
          this.predictions[method].correct++;
        }
        
        // Update session metrics
        this.sessionMetrics.predictions[method].total++;
        if (isCorrect) {
          this.sessionMetrics.predictions[method].correct++;
        }
        
        // Update all-time metrics with synchronous read-write
        const { loadAllTimeMetrics, saveAllTimeMetrics } = await import('../storage/ml-database.js');
        const currentMetrics = await loadAllTimeMetrics() || {
          rules: { total: 0, correct: 0 },
          model: { total: 0, correct: 0 },
          llm: { total: 0, correct: 0 }
        };
        
        currentMetrics[method].total++;
        if (isCorrect) {
          currentMetrics[method].correct++;
        }
        
        await saveAllTimeMetrics(currentMetrics);
        
        // Update rolling window
        this.predictions[method].recentAccuracy.push(isCorrect ? 1 : 0);
        if (this.predictions[method].recentAccuracy.length > this.windowSize) {
          this.predictions[method].recentAccuracy.shift();
        }
        
        // No longer recording metrics - using predictions table instead
      }
    }
    
    // Add to history
    this.predictionHistory.push({
      timestamp: Date.now(),
      prediction,
      finalCategory,
      source,
      predictionId: predictionRecord.id
    });
    
    // Update accuracies and trust weights
    this.updateAccuracies();
    this.updateTrustWeights();
    
    // Only refresh last 100 metrics (all-time already saved above)
    await this.loadLast100Metrics();
  }
  
  /**
   * Handle user changing a category - adjust accuracy metrics
   * @param {string} url - The URL of the tab
   * @param {number} oldCategory - Previous category
   * @param {number} newCategory - New category
   */
  async handleCategoryChange(url, oldCategory, newCategory) {
    
    try {
      // Get predictions for this URL
      const { getPredictionsByURL } = await import('../storage/ml-database.js');
      const predictions = await getPredictionsByURL(url);
      
      if (!predictions || predictions.length === 0) {
        return;
      }
      
      // Get the most recent prediction
      const latestPrediction = predictions[0]; // Already sorted by timestamp desc
      
      // Check if prediction has method predictions
      if (!latestPrediction.predictions || Object.keys(latestPrediction.predictions).length === 0) {
        return;
      }
      
      // Check if this prediction is in current session
      const isInSession = latestPrediction.timestamp >= this.sessionMetrics.startTime;
      
      // Update accuracy for each method
      for (const method of ['rules', 'model', 'llm']) {
        const methodPrediction = latestPrediction.predictions[method];
        
        // Skip if method didn't make a prediction
        if (methodPrediction === undefined || methodPrediction === null) {
          continue;
        }
        
        // Calculate accuracy changes
        const wasCorrect = methodPrediction === oldCategory;
        const isCorrect = methodPrediction === newCategory;
        
        
        if (wasCorrect !== isCorrect) {
          // Accuracy changed for this method
          if (wasCorrect && !isCorrect) {
            // Was correct, now wrong - decrement correct count
            this.allTimeMetrics[method].correct--;
            if (isInSession) {
              this.sessionMetrics.predictions[method].correct--;
            }
          } else if (!wasCorrect && isCorrect) {
            // Was wrong, now correct - increment correct count
            this.allTimeMetrics[method].correct++;
            if (isInSession) {
              this.sessionMetrics.predictions[method].correct++;
            }
          }
        }
      }
      
      // Update the prediction record's final category
      const db = await this.openDatabase();
      const tx = db.transaction(['predictions'], 'readwrite');
      const predictionsStore = tx.objectStore('predictions');
      
      const predRequest = predictionsStore.get(latestPrediction.id);
      await new Promise((resolve, reject) => {
        predRequest.onsuccess = () => {
          const pred = predRequest.result;
          if (pred) {
            pred.final = newCategory;
            pred.corrected = true; // Mark that user corrected this prediction
            const updateReq = predictionsStore.put(pred);
            updateReq.onsuccess = () => resolve();
            updateReq.onerror = () => reject(updateReq.error);
          } else {
            resolve();
          }
        };
        predRequest.onerror = () => reject(predRequest.error);
      });
      
      // Record the category change event
      const { recordMetric } = await import('../storage/ml-database.js');
      await recordMetric({
        method: 'user',
        type: 'category_change',
        value: newCategory,
        metadata: {
          url,
          from: oldCategory,
          to: newCategory,
          predictionId: latestPrediction.id,
          timestamp: Date.now()
        }
      });
      
      // Metrics already saved in the loop above
      
      // Refresh last 100 metrics (they might have changed)
      await this.loadLast100Metrics();
      
      
    } catch (error) {
      logger.error('Error handling category change:', error);
    }
  }
  
  /**
   * Update accuracy calculations for all methods
   */
  updateAccuracies() {
    for (const method of ['rules', 'model', 'llm']) {
      const methodData = this.predictions[method];
      
      // Skip if not enough data
      if (methodData.total < this.minPredictions) {
        continue;
      }
      
      // Calculate recent accuracy (from rolling window)
      const recentAccuracy = methodData.recentAccuracy.length > 0
        ? methodData.recentAccuracy.reduce((sum, val) => sum + val, 0) / methodData.recentAccuracy.length
        : 0;
      
      // Calculate all-time accuracy
      const allTimeAccuracy = methodData.total > 0
        ? methodData.correct / methodData.total
        : 0;
      
      // Weighted average (recent performance matters more)
      this.accuracy[method] = 0.7 * recentAccuracy + 0.3 * allTimeAccuracy;
      
      // Record updated accuracy
      recordMetric({
        method,
        type: 'accuracy',
        value: this.accuracy[method],
        metadata: {
          recentAccuracy,
          allTimeAccuracy,
          totalPredictions: methodData.total,
          windowSize: methodData.recentAccuracy.length
        }
      });
    }
  }
  
  /**
   * Update trust weights based on accuracies
   */
  updateTrustWeights() {
    const adjustmentConfig = ML_CONFIG.trust.adjustment;
    
    // Calculate raw weights based on accuracy
    let rawWeights = { ...this.accuracy };
    
    // Apply constraints
    for (const method of ['rules', 'model', 'llm']) {
      rawWeights[method] = Math.max(
        adjustmentConfig.minWeight,
        Math.min(adjustmentConfig.maxWeight, rawWeights[method])
      );
    }
    
    // Normalize weights to sum to 1
    const totalWeight = Object.values(rawWeights).reduce((sum, w) => sum + w, 0);
    
    if (totalWeight > 0) {
      for (const method of ['rules', 'model', 'llm']) {
        this.trustWeights[method] = rawWeights[method] / totalWeight;
      }
    }
    
    // Update trust weight metric (update existing record instead of creating new one)
    this.updateTrustWeightMetric();
  }
  
  /**
   * Update trust weight metric - updates existing record instead of creating new ones
   */
  async updateTrustWeightMetric() {
    try {
      const db = await this.openDatabase();
      const transaction = db.transaction([STORES.METRICS], 'readwrite');
      const store = transaction.objectStore(STORES.METRICS);
      const index = store.index('metricType');
      
      // Find existing trust_weights record
      const request = index.openCursor(IDBKeyRange.only('trust_weights'));
      
      await new Promise((resolve, reject) => {
        let found = false;
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          
          if (cursor) {
            // Check if this is a system trust_weights record
            if (cursor.value.method === 'system') {
              // Update existing record
              cursor.value.timestamp = Date.now();
              cursor.value.metadata = this.trustWeights;
              cursor.update(cursor.value);
              found = true;
              resolve();
            } else {
              cursor.continue();
            }
          } else if (!found) {
            // No existing record found, create initial one
            const metricData = {
              timestamp: Date.now(),
              method: 'system',
              metricType: 'trust_weights',
              value: 1, // Dummy value
              metadata: this.trustWeights
            };
            
            const addRequest = store.add(metricData);
            addRequest.onsuccess = () => resolve();
            addRequest.onerror = () => reject(addRequest.error);
          } else {
            resolve();
          }
        };
        
        request.onerror = () => reject(request.error);
      });
      
    } catch (error) {
      logger.error('Error updating trust weight metric:', error);
    }
  }

  /**
   * Handle URL deletion - remove predictions and update accuracy counters
   * @param {string} url - The URL being deleted
   */
  async handleUrlDeletion(url) {
    try {
      // Get all predictions for this URL
      const { getPredictionsByURL } = await import('../storage/ml-database.js');
      const predictions = await getPredictionsByURL(url);
      
      if (!predictions || predictions.length === 0) {
        return;
      }
      
      // Load current metrics once before processing predictions
      const { loadAllTimeMetrics, saveAllTimeMetrics } = await import('../storage/ml-database.js');
      const currentMetrics = await loadAllTimeMetrics() || {
        rules: { total: 0, correct: 0 },
        model: { total: 0, correct: 0 },
        llm: { total: 0, correct: 0 }
      };
      
      // For each prediction, adjust the all-time counters
      for (const prediction of predictions) {
        // Check if prediction has method predictions
        if (!prediction.predictions || Object.keys(prediction.predictions).length === 0) {
          continue;
        }
        
        // Check if this prediction is in current session
        const isInSession = prediction.timestamp >= this.sessionMetrics.startTime;
        
        // Update counters for each method
        for (const method of ['rules', 'model', 'llm']) {
          const methodPrediction = prediction.predictions[method];
          
          // Skip if method didn't make a prediction
          if (methodPrediction === undefined || methodPrediction === null) {
            continue;
          }
          
          // Determine if prediction was correct
          const wasCorrect = methodPrediction === prediction.final;
          
          // Decrement total count
          currentMetrics[method].total--;
          
          // If it was correct, decrement correct count
          if (wasCorrect) {
            currentMetrics[method].correct--;
          }
          
          // Update session metrics if applicable
          if (isInSession) {
            this.sessionMetrics.predictions[method].total--;
            if (wasCorrect) {
              this.sessionMetrics.predictions[method].correct--;
            }
          }
        }
        
        // Remove from prediction history if present
        const historyIndex = this.predictionHistory.findIndex(h => h.predictionId === prediction.id);
        if (historyIndex !== -1) {
          this.predictionHistory.splice(historyIndex, 1);
        }
      }
      
      // Delete the predictions from database
      const db = await this.openDatabase();
      
      // Delete predictions
      const predTx = db.transaction(['predictions'], 'readwrite');
      const predStore = predTx.objectStore('predictions');
      const predIndex = predStore.index('url');
      
      await new Promise((resolve, reject) => {
        const request = predIndex.openCursor(IDBKeyRange.only(url));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
      
      // No longer need to delete metrics - using predictions table exclusively
      
      // Save updated all-time metrics
      await saveAllTimeMetrics(currentMetrics);
      
      // Refresh last 100 metrics (they might have changed)
      await this.loadLast100Metrics();
      
    } catch (error) {
      logger.error('Error handling URL deletion:', error);
    }
  }

  /**
   * Handle user correction of a prediction
   * @param {string} predictionId - ID of the prediction
   * @param {number} oldCategory - Original category
   * @param {number} newCategory - Corrected category
   */
  async handleCorrection(predictionId, oldCategory, newCategory) {
    // Find the prediction in history
    const historyItem = this.predictionHistory.find(h => h.predictionId === predictionId);
    
    if (!historyItem) {
      logger.warn('Prediction not found in history:', predictionId);
      return;
    }
    
    // Note: We don't use this method anymore - predictions are marked as corrected in handleCategoryChange
    
    // Penalize methods that got it wrong
    for (const method of ['rules', 'model', 'llm']) {
      if (historyItem.prediction[method] === oldCategory) {
        // This method was wrong
        const penalty = ML_CONFIG.trust.adjustment.incorrectPredictionPenalty;
        
        // Update recent accuracy (add 0 for incorrect)
        this.predictions[method].recentAccuracy.push(0);
        if (this.predictions[method].recentAccuracy.length > this.windowSize) {
          this.predictions[method].recentAccuracy.shift();
        }
        
        // Immediate trust reduction
        this.accuracy[method] = Math.max(
          ML_CONFIG.trust.adjustment.minWeight,
          this.accuracy[method] - penalty
        );
      } else if (historyItem.prediction[method] === newCategory) {
        // This method was actually correct
        const boost = ML_CONFIG.trust.adjustment.correctPredictionBoost;
        
        // Update recent accuracy (add 1 for correct)
        this.predictions[method].recentAccuracy.push(1);
        if (this.predictions[method].recentAccuracy.length > this.windowSize) {
          this.predictions[method].recentAccuracy.shift();
        }
        
        // Immediate trust boost
        this.accuracy[method] = Math.min(
          ML_CONFIG.trust.adjustment.maxWeight,
          this.accuracy[method] + boost
        );
      }
    }
    
    // Update trust weights
    this.updateTrustWeights();
    
    // Record the correction
    await recordMetric({
      method: 'user',
      type: 'correction',
      value: 1,
      metadata: {
        predictionId,
        oldCategory,
        newCategory,
        originalPredictions: historyItem.prediction
      }
    });
  }
  
  /**
   * Ensure tracker is initialized
   * @returns {Promise} Resolves when initialization is complete
   */
  async ensureInitialized() {
    if (this.initializationPromise) {
      await this.initializationPromise;
    }
  }
  
  /**
   * Get current trust weights
   * @returns {Object} Normalized trust weights
   */
  getTrustWeights() {
    return { ...this.trustWeights };
  }
  
  /**
   * Refresh metrics after external changes (like direct database deletions)
   */
  async refreshMetrics() {
    try {
      // Reload all-time metrics from database
      const { loadAllTimeMetrics } = await import('../storage/ml-database.js');
      const metrics = await loadAllTimeMetrics();
      if (metrics) {
        this.allTimeMetrics = metrics;
      }
      
      // Reload last 100 metrics
      await this.loadLast100Metrics();
      
      // Performance metrics refreshed
    } catch (error) {
      logger.error('Error refreshing metrics:', error);
    }
  }
  
  /**
   * Recalculate all-time metrics from scratch by scanning all predictions
   * This is only used when cached metrics are missing or corrupted
   */
  async recalculateAllTimeMetrics() {
    try {
      const db = await this.openDatabase();
      const transaction = db.transaction(['predictions'], 'readonly');
      const store = transaction.objectStore('predictions');
      
      // Initialize counters
      const metrics = {
        rules: { total: 0, correct: 0 },
        model: { total: 0, correct: 0 },
        llm: { total: 0, correct: 0 }
      };
      
      // Open cursor to iterate through all predictions
      const request = store.openCursor();
      
      await new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const prediction = cursor.value;
            
            // Count predictions for each method
            if (prediction.predictions && prediction.final !== null && prediction.final !== undefined) {
              for (const method of ['rules', 'model', 'llm']) {
                const methodPrediction = prediction.predictions[method];
                if (methodPrediction !== null && methodPrediction !== undefined) {
                  metrics[method].total++;
                  if (methodPrediction === prediction.final) {
                    metrics[method].correct++;
                  }
                }
              }
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
      
      // Save the recalculated metrics
      const { saveAllTimeMetrics } = await import('../storage/ml-database.js');
      await saveAllTimeMetrics(metrics);
      
      logger.performanceTimings('All-time metrics recalculated:', metrics);
      return metrics;
      
    } catch (error) {
      logger.error('Error recalculating all-time metrics:', error);
      // Return zeros if error occurs
      return {
        rules: { total: 0, correct: 0 },
        model: { total: 0, correct: 0 },
        llm: { total: 0, correct: 0 }
      };
    }
  }
  
  /**
   * Open database connection
   */
  async openDatabase() {
    // Ensure ML database is initialized first
    const { initMLDatabase, DB_NAME, DB_VERSION } = await import('../storage/ml-database.js');
    await initMLDatabase();
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Load last 100 predictions metrics
   */
  async loadLast100Metrics() {
    try {
      const last100 = {
        rules: { total: 0, correct: 0 },
        model: { total: 0, correct: 0 },
        llm: { total: 0, correct: 0 }
      };
      
      // Get last 100 predictions from the predictions table
      const db = await this.openDatabase();
      const tx = db.transaction(['predictions'], 'readonly');
      const store = tx.objectStore('predictions');
      const index = store.index('timestamp');
      
      // Get the last 100 predictions
      const predictions = [];
      await new Promise((resolve) => {
        const request = index.openCursor(null, 'prev'); // reverse chronological
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && predictions.length < 100) {
            predictions.push(cursor.value);
            cursor.continue();
          } else {
            resolve();
          }
        };
      });
      
      // Count predictions for each method
      for (const prediction of predictions) {
        if (prediction.predictions && prediction.final !== null && prediction.final !== undefined) {
          for (const method of ['rules', 'model', 'llm']) {
            const methodPrediction = prediction.predictions[method];
            if (methodPrediction !== null && methodPrediction !== undefined) {
              last100[method].total++;
              if (methodPrediction === prediction.final) {
                last100[method].correct++;
              }
            }
          }
        }
      }
      
      db.close();
      this.last100Metrics = last100;
      
    } catch (error) {
      logger.error('Error loading last 100 metrics:', error);
      // Initialize with empty metrics on error
      this.last100Metrics = {
        rules: { total: 0, correct: 0 },
        model: { total: 0, correct: 0 },
        llm: { total: 0, correct: 0 }
      };
    }
  }
  
  /**
   * Get metrics for all methods
   * @param {string} scope - 'session', 'last100', or 'allTime'
   * @returns {Object} Metrics for each method
   */
  async getMetrics(scope = 'session') {
    const metrics = {};
    
    switch (scope) {
      case 'session':
        for (const method of ['rules', 'model', 'llm']) {
          const session = this.sessionMetrics.predictions[method];
          if (session.total > 0) {
            metrics[method] = {
              total: session.total,
              correct: session.correct,
              accuracy: session.correct / session.total
            };
          }
        }
        break;
        
      case 'last100':
        if (!this.last100Metrics) {
          await this.loadLast100Metrics();
        }
        // Ensure last100Metrics exists even if loading failed
        if (this.last100Metrics) {
          for (const method of ['rules', 'model', 'llm']) {
            const last100 = this.last100Metrics[method];
            if (last100 && last100.total > 0) {
              metrics[method] = {
                total: last100.total,
                correct: last100.correct,
                accuracy: last100.correct / last100.total
              };
            }
          }
        }
        break;
        
      case 'allTime':
        // Load all-time metrics from database
        const { loadAllTimeMetrics } = await import('../storage/ml-database.js');
        let allTimeMetrics = await loadAllTimeMetrics();
        
        // Check if metrics need recalculation
        if (!allTimeMetrics) {
          logger.performanceTimings('All-time metrics not found, recalculating...');
          allTimeMetrics = await this.recalculateAllTimeMetrics();
        } else {
          // Verify metrics are valid
          let needsRecalculation = false;
          for (const method of ['rules', 'model', 'llm']) {
            if (!allTimeMetrics[method] || 
                allTimeMetrics[method].total < 0 || 
                allTimeMetrics[method].correct < 0 ||
                allTimeMetrics[method].correct > allTimeMetrics[method].total) {
              logger.warn(`Invalid cached metrics for ${method}:`, allTimeMetrics[method]);
              needsRecalculation = true;
              break;
            }
          }
          
          if (needsRecalculation) {
            allTimeMetrics = await this.recalculateAllTimeMetrics();
          }
        }
        
        for (const method of ['rules', 'model', 'llm']) {
          const allTime = allTimeMetrics[method];
          // Include metrics even if total is 0 (for display purposes)
          // This handles edge cases where corrections were made before predictions
          if (allTime) {
            metrics[method] = {
              total: Math.max(0, allTime.total),
              correct: Math.max(0, allTime.correct),
              accuracy: allTime.total > 0 ? allTime.correct / allTime.total : 0
            };
          }
        }
        break;
        
      default:
        // Return current session by default
        return this.getMetrics('session');
    }
    
    return metrics;
  }
  
  /**
   * Get detailed statistics for a method
   * @param {string} method - Method name
   * @returns {Object} Detailed statistics
   */
  getMethodStats(method) {
    const methodData = this.predictions[method];
    
    return {
      accuracy: this.accuracy[method],
      trustWeight: this.trustWeights[method],
      totalPredictions: methodData.total,
      correctPredictions: methodData.correct,
      recentAccuracy: methodData.recentAccuracy.length > 0
        ? methodData.recentAccuracy.reduce((sum, val) => sum + val, 0) / methodData.recentAccuracy.length
        : 0,
      trend: this.calculateTrend(method),
      confidence: this.calculateConfidence(method)
    };
  }
  
  /**
   * Calculate accuracy trend
   * @param {string} method - Method name
   * @returns {string} Trend indicator
   */
  calculateTrend(method) {
    const recent = this.predictions[method].recentAccuracy;
    
    if (recent.length < 10) {
      return 'neutral';
    }
    
    // Compare first half vs second half
    const midpoint = Math.floor(recent.length / 2);
    const firstHalf = recent.slice(0, midpoint);
    const secondHalf = recent.slice(midpoint);
    
    const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
    
    const difference = secondAvg - firstAvg;
    
    if (difference > 0.1) return 'improving';
    if (difference < -0.1) return 'declining';
    return 'stable';
  }
  
  /**
   * Calculate confidence in method
   * @param {string} method - Method name
   * @returns {number} Confidence score (0-1)
   */
  calculateConfidence(method) {
    const methodData = this.predictions[method];
    
    // Low confidence if not enough predictions
    if (methodData.total < this.minPredictions) {
      return 0.3;
    }
    
    // Base confidence on consistency of recent predictions
    const recent = methodData.recentAccuracy;
    if (recent.length === 0) return 0.5;
    
    // Calculate variance
    const mean = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const variance = recent.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recent.length;
    
    // Lower variance = higher confidence
    const confidence = 1 - Math.min(1, variance * 2);
    
    return confidence;
  }
  
  /**
   * Get overall system statistics
   * @returns {Object} System-wide statistics
   */
  getSystemStats() {
    const stats = {
      methods: {},
      overall: {
        totalPredictions: 0,
        averageAccuracy: 0,
        bestMethod: null,
        worstMethod: null
      }
    };
    
    // Collect stats for each method
    let bestAccuracy = 0;
    let worstAccuracy = 1;
    
    for (const method of ['rules', 'model', 'llm']) {
      const methodStats = this.getMethodStats(method);
      stats.methods[method] = methodStats;
      
      stats.overall.totalPredictions += methodStats.totalPredictions;
      
      if (methodStats.accuracy > bestAccuracy) {
        bestAccuracy = methodStats.accuracy;
        stats.overall.bestMethod = method;
      }
      
      if (methodStats.accuracy < worstAccuracy) {
        worstAccuracy = methodStats.accuracy;
        stats.overall.worstMethod = method;
      }
    }
    
    // Calculate average accuracy
    stats.overall.averageAccuracy = Object.values(this.accuracy)
      .reduce((sum, acc) => sum + acc, 0) / 3;
    
    // Add insights
    stats.insights = this.generateInsights(stats);
    
    return stats;
  }
  
  /**
   * Generate insights from statistics
   * @param {Object} stats - System statistics
   * @returns {Array<string>} Insights
   */
  generateInsights(stats) {
    const insights = [];
    
    // Best performing method
    if (stats.overall.bestMethod) {
      const best = stats.methods[stats.overall.bestMethod];
      insights.push(`${stats.overall.bestMethod} is performing best with ${(best.accuracy * 100).toFixed(1)}% accuracy`);
    }
    
    // Model learning progress
    const modelStats = stats.methods.model;
    if (modelStats.trend === 'improving' && modelStats.totalPredictions > 50) {
      insights.push('ML model is improving as it learns from your behavior');
    }
    
    // Trust weight distribution
    const maxWeight = Math.max(...Object.values(this.trustWeights));
    if (maxWeight > 0.6) {
      const dominantMethod = Object.entries(this.trustWeights)
        .find(([_, weight]) => weight === maxWeight)[0];
      insights.push(`System is heavily relying on ${dominantMethod} (${(maxWeight * 100).toFixed(0)}% trust)`);
    }
    
    // Low accuracy warning
    if (stats.overall.averageAccuracy < 0.7) {
      insights.push('Overall accuracy is below 70% - consider reviewing categorization rules');
    }
    
    return insights;
  }
  
  /**
   * Reset all performance data to initial state
   */
  async reset() {
    // Reset predictions counters
    this.predictions = {
      rules: { correct: 0, total: 0, recentAccuracy: [] },
      model: { correct: 0, total: 0, recentAccuracy: [] },
      llm: { correct: 0, total: 0, recentAccuracy: [] }
    };
    
    // Reset accuracies to initial values
    this.accuracy = {
      rules: ML_CONFIG.trust.initialWeights.rules,
      model: ML_CONFIG.trust.initialWeights.model,
      llm: ML_CONFIG.trust.initialWeights.llm
    };
    
    // Reset trust weights to initial values
    this.trustWeights = { ...ML_CONFIG.trust.initialWeights };
    
    // Clear prediction history
    this.predictionHistory = [];
    
    logger.performanceTimings('Performance tracker reset to initial state');
  }

  /**
   * Export metrics for analysis
   * @returns {Object} Exportable metrics
   */
  async exportMetrics() {
    const recentMetrics = {
      rules: await getMetrics('rules', null, 100),
      model: await getMetrics('model', null, 100),
      llm: await getMetrics('llm', null, 100)
    };
    
    return {
      currentState: {
        accuracy: this.accuracy,
        trustWeights: this.trustWeights,
        predictions: this.predictions
      },
      history: this.predictionHistory.slice(-100),
      recentMetrics,
      systemStats: this.getSystemStats()
    };
  }
}

// Export singleton instance
let trackerInstance = null;

export function getPerformanceTracker() {
  if (!trackerInstance) {
    trackerInstance = new PerformanceTracker();
  }
  return trackerInstance;
}

// Reset instance for testing
export function resetPerformanceTracker() {
  trackerInstance = null;
}

export default {
  PerformanceTracker,
  getPerformanceTracker
};