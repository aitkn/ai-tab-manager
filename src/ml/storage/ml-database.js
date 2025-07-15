/*
 * AI Tab Manager - ML Database
 * IndexedDB schema and operations for ML data storage
 */

import { ML_CONFIG } from '../model-config.js';
import logger from '../../utils/logger.js';

const DB_NAME = 'TabClassifierML';
const DB_VERSION = 4; // Incremented to add isValidation field for random train/validation splitting
export const FEATURE_VERSION = 3; // Track feature calculation version - incremented again to force regeneration of all features with new token lengths

// Export constants for other modules
export { DB_NAME, DB_VERSION };

// Store names
export const STORES = {
  MODELS: 'models',
  TRAINING_DATA: 'trainingData',
  VOCABULARY: 'vocabulary',
  METRICS: 'metrics',
  PREDICTIONS: 'predictions',
  METRICS_SUMMARY: 'metricsSummary'
};

let db = null;

/**
 * Deterministic URL-based random assignment for train/validation split
 * Uses simple hash function to ensure same URL always gets same assignment
 * @param {string} url - The URL to assign
 * @returns {boolean} - true if validation, false if training
 */
function assignRandomSplit(url) {
  // Simple hash function for deterministic assignment
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Use absolute value and modulo to get 0-99 range
  const bucket = Math.abs(hash) % 100;
  
  // 20% validation (buckets 0-19), 80% training (buckets 20-99)
  return bucket < 20;
}

/**
 * Initialize the ML database
 */
export async function initMLDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => {
      reject(new Error('Failed to open ML database'));
    };
    
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;
      
      console.log('Upgrading ML database from version', oldVersion, 'to', DB_VERSION);
      
      // Models store - stores trained models
      if (!db.objectStoreNames.contains(STORES.MODELS)) {
        const modelStore = db.createObjectStore(STORES.MODELS, { keyPath: 'id' });
        modelStore.createIndex('version', 'version');
        modelStore.createIndex('createdAt', 'createdAt');
      }
      
      // Training data store - stores training examples
      if (!db.objectStoreNames.contains(STORES.TRAINING_DATA)) {
        const trainingStore = db.createObjectStore(STORES.TRAINING_DATA, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        trainingStore.createIndex('timestamp', 'timestamp');
        trainingStore.createIndex('category', 'category');
        trainingStore.createIndex('source', 'source');
        trainingStore.createIndex('url', 'url');
      }
      
      // Vocabulary store - stores token mappings
      if (!db.objectStoreNames.contains(STORES.VOCABULARY)) {
        const vocabStore = db.createObjectStore(STORES.VOCABULARY, { keyPath: 'id' });
        vocabStore.createIndex('version', 'version');
      }
      
      // Metrics store - stores performance metrics
      if (!db.objectStoreNames.contains(STORES.METRICS)) {
        const metricsStore = db.createObjectStore(STORES.METRICS, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        metricsStore.createIndex('timestamp', 'timestamp');
        metricsStore.createIndex('method', 'method');
        metricsStore.createIndex('metricType', 'metricType');
      }
      
      // Predictions store - stores recent predictions for analysis
      if (!db.objectStoreNames.contains(STORES.PREDICTIONS)) {
        const predictionsStore = db.createObjectStore(STORES.PREDICTIONS, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        predictionsStore.createIndex('timestamp', 'timestamp');
        predictionsStore.createIndex('tabId', 'tabId');
        predictionsStore.createIndex('correct', 'correct');
      }
      
      // Version 2 updates
      if (oldVersion < 2) {
        // Add URL index to predictions store if it doesn't exist
        if (db.objectStoreNames.contains(STORES.PREDICTIONS)) {
          const transaction = event.target.transaction;
          const predictionsStore = transaction.objectStore(STORES.PREDICTIONS);
          if (!predictionsStore.indexNames.contains('url')) {
            console.log('Adding URL index to predictions store');
            predictionsStore.createIndex('url', 'url');
          }
        }
        
        // Add metrics summary store for cached all-time counters
        if (!db.objectStoreNames.contains(STORES.METRICS_SUMMARY)) {
          console.log('Creating metrics summary store');
          const summaryStore = db.createObjectStore(STORES.METRICS_SUMMARY, { keyPath: 'id' });
          summaryStore.createIndex('timestamp', 'timestamp');
        }
      }
      
      // Version 3 updates - Add unique URL indexes
      if (oldVersion < 3) {
        console.log('Upgrading to version 3 - Adding unique URL constraints');
        
        // For training data, we need to clean duplicates before making URL unique
        if (db.objectStoreNames.contains(STORES.TRAINING_DATA)) {
          // Note: We can't make the URL index unique in IndexedDB
          // We'll enforce uniqueness in the addTrainingData function
          console.log('URL uniqueness for training data will be enforced at application level');
        }
        
        // For predictions, URL should also be unique
        if (db.objectStoreNames.contains(STORES.PREDICTIONS)) {
          // Note: We can't make the URL index unique in IndexedDB
          // We'll enforce uniqueness in the recordPrediction function
          console.log('URL uniqueness for predictions will be enforced at application level');
        }
      }
      
      // Version 4 updates - Add isValidation field for random train/validation splitting
      if (oldVersion < 4) {
        console.log('Upgrading to version 4 - Adding isValidation field for random splitting');
        
        // Migration will be triggered after the database is ready
        // We can't run async operations in the upgrade handler
        event.target.transaction.oncomplete = async () => {
          try {
            await migrateTrainingDataForRandomSplit();
          } catch (error) {
            console.error('Failed to migrate training data for random split:', error);
          }
        };
      }
    };
  });
}

/**
 * Clear stored model from database
 */
export async function clearStoredModel() {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.MODELS], 'readwrite');
  const store = transaction.objectStore(STORES.MODELS);
  
  return new Promise((resolve, reject) => {
    const request = store.delete('current');
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Reset ML model and related data (preserves training data and predictions)
 * This is used when user clicks "Reset Model" button
 * Only clears: models, vocabulary, metrics, metrics summary
 * Preserves: training data, predictions
 */
export async function resetMLModel() {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  // Clear model-related stores and metrics, preserve training data and predictions
  const storesToClear = [STORES.MODELS, STORES.VOCABULARY, STORES.METRICS, STORES.METRICS_SUMMARY];
  const transaction = db.transaction(storesToClear, 'readwrite');
  
  const promises = storesToClear.map(storeName => {
    return new Promise((resolve, reject) => {
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => {
        logger.mlDiagnostic(`✓ Cleared ${storeName} store`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  });
  
  await Promise.all(promises);
  
  // Clear features field from all trainingData records
  const clearedFeaturesCount = await clearTrainingDataFeatures();
  
  // Log what was preserved
  const preservedStores = [STORES.TRAINING_DATA, STORES.PREDICTIONS];
  logger.mlDiagnostic('✓ Preserved stores:', preservedStores.join(', '));
  logger.mlDiagnostic(`✓ Cleared features from ${clearedFeaturesCount} training records`);
  
  // Get counts of preserved data
  const stats = await getDatabaseStats();
  logger.mlDiagnostic(`✓ Preserved ${stats.trainingData || 0} training records`);
  logger.mlDiagnostic(`✓ Preserved ${stats.predictions || 0} prediction records`);
  
  return stats;
}

/**
 * Save a trained model (only keeps current model)
 */
export async function saveModel(modelData) {
  const transaction = db.transaction([STORES.MODELS], 'readwrite');
  const store = transaction.objectStore(STORES.MODELS);
  
  const timestamp = Date.now();
  const model = {
    id: 'current',
    version: modelData.version || timestamp.toString(),
    architecture: modelData.architecture,
    weights: modelData.weights,
    vocabulary: modelData.vocabulary,
    metadata: {
      accuracy: modelData.accuracy,
      trainingSamples: modelData.trainingSamples,
      createdAt: timestamp,
      inputShape: modelData.inputShape,
      outputShape: modelData.outputShape,
      trainedUpTo: modelData.trainedUpTo || timestamp, // Cutoff timestamp for training data
      ...modelData.metadata // Include all other metadata (like epoch, bestAccuracy, etc.)
    }
  };
  
  return new Promise((resolve, reject) => {
    // Save current model (overwrites previous)
    const request = store.put(model);
    request.onsuccess = () => resolve(model);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save model as training version (keeps old model active)
 * @deprecated Use direct database access with custom IDs (training_last, training_best)
 */
export async function saveModelAsTraining(modelData) {
  const transaction = db.transaction([STORES.MODELS], 'readwrite');
  const store = transaction.objectStore(STORES.MODELS);
  
  const timestamp = Date.now();
  const model = {
    id: modelData.id || 'training_current', // Allow custom ID or use default
    version: modelData.version || timestamp.toString(),
    architecture: modelData.architecture,
    weights: modelData.weights,
    vocabulary: modelData.vocabulary,
    metadata: {
      accuracy: modelData.accuracy,
      trainingSamples: modelData.trainingSamples,
      createdAt: timestamp,
      inputShape: modelData.inputShape,
      outputShape: modelData.outputShape,
      isTraining: true,
      startedAt: modelData.metadata?.startedAt || timestamp,
      ...modelData.metadata // Include additional metadata like epoch, bestAccuracy, etc.
    }
  };
  
  return new Promise((resolve, reject) => {
    // Save the training model (keep only one by using same ID prefix)
    const request = store.put(model);
    request.onsuccess = () => resolve(model);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Promote training model to current
 */
export async function promoteTrainingModel(trainingModelId) {
  const transaction = db.transaction([STORES.MODELS], 'readwrite');
  const store = transaction.objectStore(STORES.MODELS);
  
  return new Promise((resolve, reject) => {
    // Get the training model
    const getRequest = store.get(trainingModelId);
    getRequest.onsuccess = () => {
      const trainingModel = getRequest.result;
      if (!trainingModel) {
        reject(new Error('Training model not found'));
        return;
      }
      
      // Update it to be the current model
      const currentModel = {
        ...trainingModel,
        id: 'current',
        metadata: {
          ...trainingModel.metadata,
          promotedAt: Date.now(),
          previousId: trainingModelId
        }
      };
      
      const putRequest = store.put(currentModel);
      putRequest.onsuccess = () => {
        // Delete the training model
        const deleteRequest = store.delete(trainingModelId);
        deleteRequest.onsuccess = () => resolve(currentModel);
        deleteRequest.onerror = () => reject(deleteRequest.error);
      };
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Clean up old training models
 */
export async function cleanupTrainingModels() {
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.MODELS], 'readwrite');
  const store = transaction.objectStore(STORES.MODELS);
  
  return new Promise((resolve, reject) => {
    const deletePromises = [];
    const request = store.openCursor();
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const model = cursor.value;
        // Delete training models (both old timestamped ones and the new fixed ID)
        // BUT preserve training_history which contains chart data and active checkpoints
        if (model.id.startsWith('training_') && 
            model.id !== 'training_history' && 
            model.id !== 'training_last' && 
            model.id !== 'training_best') {
          deletePromises.push(new Promise((res, rej) => {
            const deleteReq = store.delete(model.id);
            deleteReq.onsuccess = () => res();
            deleteReq.onerror = () => rej(deleteReq.error);
          }));
        }
        cursor.continue();
      } else {
        // All done scanning
        Promise.all(deletePromises)
          .then(() => {
            logger.mlDiagnostic(`🧹 Cleaned up ${deletePromises.length} training models`);
            resolve(deletePromises.length);
          })
          .catch(reject);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load the current model
 */
export async function loadModel() {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.MODELS], 'readonly');
  const store = transaction.objectStore(STORES.MODELS);
  
  return new Promise((resolve, reject) => {
    const request = store.get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get active training model if exists - returns last checkpoint
 * @deprecated Use getTrainingCheckpoint instead
 */
export async function getActiveTrainingModel() {
  return getTrainingCheckpoint('last');
}

/**
 * Get training checkpoint by type
 * @param {string} type - 'last' or 'best'
 * @returns {Promise<Object|null>} The checkpoint model or null
 */
export async function getTrainingCheckpoint(type = 'last') {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const checkpointId = type === 'best' ? 'training_best' : 'training_last';
  const transaction = db.transaction([STORES.MODELS], 'readonly');
  const store = transaction.objectStore(STORES.MODELS);
  
  return new Promise((resolve, reject) => {
    const request = store.get(checkpointId);
    request.onsuccess = () => {
      const model = request.result;
      resolve(model || null);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete training checkpoint by type
 * @param {string} type - 'last' or 'best' 
 * @returns {Promise<void>}
 */
export async function deleteTrainingCheckpoint(type = 'last') {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const checkpointId = type === 'best' ? 'training_best' : 'training_last';
  const transaction = db.transaction([STORES.MODELS], 'readwrite');
  const store = transaction.objectStore(STORES.MODELS);
  
  return new Promise((resolve, reject) => {
    const request = store.delete(checkpointId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save training checkpoint
 * @param {Object} modelData - Model data to save
 * @param {string} type - 'last' or 'best'
 * @returns {Promise<Object>} Saved model
 */
export async function saveTrainingCheckpoint(modelData, type = 'last') {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const checkpointId = type === 'best' ? 'training_best' : 'training_last';
  const transaction = db.transaction([STORES.MODELS], 'readwrite');
  const store = transaction.objectStore(STORES.MODELS);
  
  const timestamp = Date.now();
  const model = {
    ...modelData,
    id: checkpointId,
    metadata: {
      ...modelData.metadata,
      checkpointType: type,
      savedAt: timestamp
    }
  };
  
  return new Promise((resolve, reject) => {
    const request = store.put(model);
    request.onsuccess = () => resolve(model);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Migrate existing training data to add isValidation field
 * This is called automatically when database version is upgraded
 */
export async function migrateTrainingDataForRandomSplit() {
  console.log('🔄 Starting migration of training data for random split...');
  if (!db) {
    await initMLDatabase();
  }
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORES.TRAINING_DATA], 'readwrite');
    const store = transaction.objectStore(STORES.TRAINING_DATA);
    const getAllRequest = store.getAll();
    
    getAllRequest.onsuccess = () => {
      const allRecords = getAllRequest.result;
      let updatedCount = 0;
      let totalCount = allRecords.length;
      
      if (totalCount === 0) {
        console.log('No training data to migrate');
        resolve(0);
        return;
      }
      
      allRecords.forEach(record => {
        // Only update records that don't have isValidation field
        if (record.isValidation === undefined) {
          record.isValidation = assignRandomSplit(record.url);
          
          const updateRequest = store.put(record);
          updateRequest.onsuccess = () => {
            updatedCount++;
            if (updatedCount === totalCount) {
              console.log(`✅ Migrated ${updatedCount} training records with isValidation field`);
              resolve(updatedCount);
            }
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          updatedCount++;
          if (updatedCount === totalCount) {
            console.log(`Migration complete: ${totalCount} records already had isValidation field`);
            resolve(0);
          }
        }
      });
    };
    
    getAllRequest.onerror = () => reject(getAllRequest.error);
  });
}

/**
 * Add training data
 */
export async function addTrainingData(data) {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  // Prepare the training example with provided or empty features
  // Note: Features should be calculated BEFORE calling this function to avoid transaction timeouts
  const trainingExample = {
    url: data.url,
    title: data.title,
    features: data.features || null, // Store null if not provided
    featureVersion: data.featureVersion || null,
    category: data.category,
    timestamp: Date.now(),
    source: data.source || 'user',
    corrected: data.corrected || false,
    // Store confidence values for weighted training
    trainingConfidence: data.trainingConfidence || 0,
    combinedConfidence: data.combinedConfidence || 0,
    metadata: data.metadata || {},
    // Random train/validation split assigned at write time
    isValidation: data.isValidation !== undefined ? data.isValidation : assignRandomSplit(data.url)
  };
  
  return new Promise((resolve, reject) => {
    // Create transaction AFTER all async work is done
    const transaction = db.transaction([STORES.TRAINING_DATA], 'readwrite');
    const store = transaction.objectStore(STORES.TRAINING_DATA);
    const urlIndex = store.index('url');
    
    // ALWAYS check if we already have a record for this URL (not just for corrections)
    const getRequest = urlIndex.getAll(data.url);
    
    getRequest.onsuccess = () => {
      const existingRecords = getRequest.result;
      
      if (existingRecords && existingRecords.length > 0) {
        // We already have training data for this URL
        const mostRecent = existingRecords.reduce((latest, record) => 
          record.timestamp > latest.timestamp ? record : latest
        );
        
        // Only update if the new data has higher confidence or is a user correction
        const shouldUpdate = data.source === 'user_correction' || 
                           trainingExample.trainingConfidence > mostRecent.trainingConfidence;
        
        if (shouldUpdate) {
          // Update the existing record
          const updatedRecord = {
            ...mostRecent,
            category: trainingExample.category,
            features: trainingExample.features || mostRecent.features,
            featureVersion: trainingExample.featureVersion || mostRecent.featureVersion,
            timestamp: Date.now(),
            source: trainingExample.source,
            corrected: trainingExample.corrected,
            trainingConfidence: trainingExample.trainingConfidence,
            combinedConfidence: trainingExample.combinedConfidence,
            // Preserve existing isValidation assignment if present, otherwise assign new one
            isValidation: mostRecent.isValidation !== undefined ? mostRecent.isValidation : trainingExample.isValidation,
            metadata: {
              ...mostRecent.metadata,
              ...trainingExample.metadata,
              previousCategory: mostRecent.category !== trainingExample.category ? mostRecent.category : undefined,
              updatedAt: Date.now(),
              updateCount: (mostRecent.metadata?.updateCount || 0) + 1
            }
          };
          
          const updateRequest = store.put(updatedRecord);
          updateRequest.onsuccess = () => {
            console.log(`Updated training record for ${data.url} (confidence: ${mostRecent.trainingConfidence} → ${trainingExample.trainingConfidence})`);
            resolve(updatedRecord);
          };
          updateRequest.onerror = () => reject(updateRequest.error);
          
          // Delete any older duplicate records for this URL
          existingRecords.forEach(record => {
            if (record.id !== mostRecent.id) {
              store.delete(record.id);
            }
          });
        } else {
          // Skip update - existing record has higher confidence
          console.log(`Skipped update for ${data.url} - existing confidence (${mostRecent.trainingConfidence}) >= new confidence (${trainingExample.trainingConfidence})`);
          resolve(mostRecent);
        }
      } else {
        // No existing record, add new one
        const addRequest = store.add(trainingExample);
        addRequest.onsuccess = () => {
          cleanupOldTrainingData();
          resolve(trainingExample);
        };
        addRequest.onerror = () => reject(addRequest.error);
      }
    };
    
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Get training data for model training
 * @param {number} limit - Maximum number of records to return (default: 10000)
 * @returns {Promise<Array>} Training data sorted by confidence
 */
export async function getTrainingData(limit = 10000) {
  
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.TRAINING_DATA], 'readonly');
  const store = transaction.objectStore(STORES.TRAINING_DATA);
  
  return new Promise((resolve, reject) => {
    const data = [];
    const request = store.openCursor();
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        data.push(cursor.value);
        cursor.continue();
      } else {
        
        
        // Sort by training confidence (descending) and take top N
        const sortedData = data
          .sort((a, b) => {
            // Use trainingConfidence if available, fall back to combinedConfidence
            const aConf = a.trainingConfidence !== undefined ? a.trainingConfidence : (a.combinedConfidence || 0);
            const bConf = b.trainingConfidence !== undefined ? b.trainingConfidence : (b.combinedConfidence || 0);
            return bConf - aConf;
          })
          .slice(0, limit);
        
        
        // Log statistics about the data
        if (sortedData.length > 0) {
          const stats = {
            total: data.length,
            kept: sortedData.length,
            discarded: data.length - sortedData.length,
            minConfidence: sortedData[sortedData.length - 1].trainingConfidence || sortedData[sortedData.length - 1].combinedConfidence || 0,
            maxConfidence: sortedData[0].trainingConfidence || sortedData[0].combinedConfidence || 0
          };
          if (limit < 1000) {
            // This is likely a check, not actual training
            logger.mlDiagnostic(`📊 Checked top ${stats.kept} training records (${stats.total} total available)`);
            logger.mlDiagnostic(`   Top ${stats.kept} confidence range: ${stats.minConfidence.toFixed(3)} - ${stats.maxConfidence.toFixed(3)}`);
          } else {
            logger.mlDiagnostic(`📊 Training data loaded: ${stats.kept}/${stats.total} records (filtered ${stats.discarded} low-confidence)`);
            logger.mlDiagnostic(`   Confidence range: ${stats.minConfidence.toFixed(3)} - ${stats.maxConfidence.toFixed(3)}`);
          }
        }
        
        resolve(sortedData);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update metadata for multiple training data records
 * @param {Array} updates - Array of {url, updates: {key: value}}
 */
export async function updateTrainingDataBatch(updates) {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.TRAINING_DATA], 'readwrite');
  const store = transaction.objectStore(STORES.TRAINING_DATA);
  const urlIndex = store.index('url');
  
  return new Promise((resolve, reject) => {
    let updateCount = 0;
    let errorCount = 0;
    
    // Handle transaction errors
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(new Error('Transaction aborted'));
    
    const processUpdate = (update) => {
      const urlRequest = urlIndex.get(update.url);
      
      urlRequest.onsuccess = () => {
        const record = urlRequest.result;
        if (record) {
          // Apply updates to metadata
          const updatedRecord = { ...record };
          
          Object.keys(update.updates).forEach(key => {
            if (key.startsWith('metadata.')) {
              const metadataKey = key.replace('metadata.', '');
              updatedRecord.metadata = updatedRecord.metadata || {};
              updatedRecord.metadata[metadataKey] = update.updates[key];
            } else {
              updatedRecord[key] = update.updates[key];
            }
          });
          
          const updateRequest = store.put(updatedRecord);
          updateRequest.onsuccess = () => {
            updateCount++;
            if (updateCount + errorCount === updates.length) {
              resolve({ updated: updateCount, errors: errorCount });
            }
          };
          updateRequest.onerror = () => {
            errorCount++;
            if (updateCount + errorCount === updates.length) {
              resolve({ updated: updateCount, errors: errorCount });
            }
          };
        } else {
          errorCount++;
          if (updateCount + errorCount === updates.length) {
            resolve({ updated: updateCount, errors: errorCount });
          }
        }
      };
      
      urlRequest.onerror = () => {
        errorCount++;
        if (updateCount + errorCount === updates.length) {
          resolve({ updated: updateCount, errors: errorCount });
        }
      };
    };
    
    updates.forEach(processUpdate);
  });
}

/**
 * Update features for multiple training data records
 * @param {Array} updates - Array of {id, features, featureVersion}
 */
// DUPLICATE FUNCTION REMOVED - see line 933 for the correct implementation
/*
export async function updateTrainingDataFeatures(updates) {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.TRAINING_DATA], 'readwrite');
  const store = transaction.objectStore(STORES.TRAINING_DATA);
  
  return new Promise((resolve, reject) => {
    let updateCount = 0;
    
    // Process each update
    updates.forEach(update => {
      const getRequest = store.get(update.id);
      
      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (record) {
          // Update features
          record.features = update.features;
          record.featureVersion = update.featureVersion;
          
          const putRequest = store.put(record);
          putRequest.onsuccess = () => {
            updateCount++;
            if (updateCount === updates.length) {
              resolve(updateCount);
            }
          };
          putRequest.onerror = () => reject(putRequest.error);
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
    
    // Handle empty updates array
    if (updates.length === 0) {
      resolve(0);
    }
  });
}
*/

/**
 * Save vocabulary (only keeps current vocabulary)
 */
export async function saveVocabulary(vocabulary) {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.VOCABULARY], 'readwrite');
  const store = transaction.objectStore(STORES.VOCABULARY);
  
  const timestamp = Date.now();
  const vocabData = {
    id: 'current',
    version: timestamp.toString(),
    tokenToId: vocabulary.tokenToId,
    idToToken: vocabulary.idToToken,
    tokenCounts: vocabulary.tokenCounts,
    finalized: vocabulary.finalized,
    pendingTokenCounts: vocabulary.pendingTokenCounts,
    documentsProcessed: vocabulary.documentsProcessed,
    lastRefinementCheck: vocabulary.lastRefinementCheck,
    metadata: {
      size: vocabulary.idToToken.length,
      maxSize: vocabulary.maxSize,
      createdAt: timestamp
    }
  };
  
  return new Promise((resolve, reject) => {
    // Save current vocabulary (overwrites previous)
    const request = store.put(vocabData);
    request.onsuccess = () => resolve(vocabData);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save vocabulary as training version (keeps old vocabulary active)
 */
export async function saveVocabularyAsTraining(vocabulary) {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.VOCABULARY], 'readwrite');
  const store = transaction.objectStore(STORES.VOCABULARY);
  
  const timestamp = Date.now();
  const vocabData = {
    id: `training_${timestamp}`,
    version: timestamp.toString(),
    tokenToId: vocabulary.tokenToId,
    idToToken: vocabulary.idToToken,
    tokenCounts: vocabulary.tokenCounts,
    finalized: vocabulary.finalized,
    pendingTokenCounts: vocabulary.pendingTokenCounts,
    documentsProcessed: vocabulary.documentsProcessed,
    lastRefinementCheck: vocabulary.lastRefinementCheck,
    metadata: {
      size: vocabulary.idToToken.length,
      maxSize: vocabulary.maxSize,
      createdAt: timestamp,
      isTraining: true
    }
  };
  
  return new Promise((resolve, reject) => {
    const request = store.put(vocabData);
    request.onsuccess = () => resolve(vocabData);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load vocabulary
 */
export async function loadVocabulary() {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.VOCABULARY], 'readonly');
  const store = transaction.objectStore(STORES.VOCABULARY);
  
  return new Promise((resolve, reject) => {
    const request = store.get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get active training vocabulary if exists
 */
export async function getActiveTrainingVocabulary() {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.VOCABULARY], 'readonly');
  const store = transaction.objectStore(STORES.VOCABULARY);
  
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const vocab = cursor.value;
        // Check if this is a training vocabulary
        if (vocab.id.startsWith('training_') && vocab.metadata.isTraining) {
          resolve(vocab);
          return;
        }
        cursor.continue();
      } else {
        resolve(null); // No training vocabulary found
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Record a metric
 */
export async function recordMetric(metric) {
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.METRICS], 'readwrite');
  const store = transaction.objectStore(STORES.METRICS);
  
  const metricData = {
    timestamp: Date.now(),
    method: metric.method,
    metricType: metric.type,
    value: metric.value,
    metadata: metric.metadata || {}
  };
  
  return new Promise((resolve, reject) => {
    const request = store.add(metricData);
    request.onsuccess = () => {
      cleanupOldMetrics();
      resolve(metricData);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get metrics for a specific method
 */
export async function getMetrics(method, type = null, limit = 100) {
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.METRICS], 'readonly');
  const store = transaction.objectStore(STORES.METRICS);
  const index = store.index('method');
  
  return new Promise((resolve, reject) => {
    const metrics = [];
    const request = index.openCursor(IDBKeyRange.only(method));
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && metrics.length < limit) {
        if (!type || cursor.value.metricType === type) {
          metrics.push(cursor.value);
        }
        cursor.continue();
      } else {
        // Sort by timestamp descending
        metrics.sort((a, b) => b.timestamp - a.timestamp);
        resolve(metrics);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * Record a prediction for tracking (enforces URL uniqueness)
 */
export async function recordPrediction(prediction) {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.PREDICTIONS], 'readwrite');
  const store = transaction.objectStore(STORES.PREDICTIONS);
  const urlIndex = store.index('url');
  
  const predictionData = {
    timestamp: Date.now(),
    tabId: prediction.tabId,
    url: prediction.url,
    title: prediction.title,
    predictions: {
      rules: prediction.rules,
      model: prediction.model,
      llm: prediction.llm
    },
    confidences: prediction.confidences || {}, // Individual method confidences
    weights: prediction.weights || {}, // Trust weights for each method
    final: prediction.final,
    source: prediction.source,
    confidence: prediction.confidence, // Combined confidence
    agreement: prediction.agreement, // Agreement score
    corrected: prediction.corrected || false
  };
  
  return new Promise((resolve, reject) => {
    // Check if we already have a prediction for this URL
    const getRequest = urlIndex.getAll(prediction.url);
    
    getRequest.onsuccess = () => {
      const existingPredictions = getRequest.result;
      
      if (existingPredictions && existingPredictions.length > 0) {
        // Update the most recent prediction
        const mostRecent = existingPredictions.reduce((latest, pred) => 
          pred.timestamp > latest.timestamp ? pred : latest
        );
        
        // Update with new data
        const updatedPrediction = {
          ...mostRecent,
          ...predictionData,
          id: mostRecent.id // Keep the same ID
        };
        
        const updateRequest = store.put(updatedPrediction);
        updateRequest.onsuccess = () => {
          logger.mlDiagnostic(`Updated prediction for ${prediction.url}`);
          resolve(updatedPrediction);
        };
        updateRequest.onerror = () => reject(updateRequest.error);
        
        // Delete any older duplicate predictions for this URL
        existingPredictions.forEach(pred => {
          if (pred.id !== mostRecent.id) {
            store.delete(pred.id);
          }
        });
      } else {
        // No existing prediction, add new one
        const addRequest = store.add(predictionData);
        addRequest.onsuccess = () => {
          predictionData.id = addRequest.result;
          resolve(predictionData);
        };
        addRequest.onerror = () => reject(addRequest.error);
      }
    };
    
    getRequest.onerror = () => reject(getRequest.error);
  });
}


/**
 * Clean up old training data
 */
async function cleanupOldTrainingData() {
  const transaction = db.transaction([STORES.TRAINING_DATA], 'readwrite');
  const store = transaction.objectStore(STORES.TRAINING_DATA);
  const index = store.index('timestamp');
  
  // Count total records
  const countRequest = store.count();
  
  countRequest.onsuccess = () => {
    const count = countRequest.result;
    if (count > ML_CONFIG.storage.maxTrainingDataSize) {
      // Delete oldest records
      const toDelete = count - ML_CONFIG.storage.maxTrainingDataSize;
      let deleted = 0;
      
      const cursor = index.openCursor();
      cursor.onsuccess = (event) => {
        const result = event.target.result;
        if (result && deleted < toDelete) {
          result.delete();
          deleted++;
          result.continue();
        }
      };
    }
  };
}

/**
 * Clean up old metrics
 */
async function cleanupOldMetrics() {
  const transaction = db.transaction([STORES.METRICS], 'readwrite');
  const store = transaction.objectStore(STORES.METRICS);
  const index = store.index('timestamp');
  
  // Delete metrics older than 30 days
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const range = IDBKeyRange.upperBound(thirtyDaysAgo);
  
  const request = index.openCursor(range);
  request.onsuccess = (event) => {
    const cursor = event.target.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
}

/**
 * Update training data features in bulk
 * @param {Array} updates - Array of {id, features, featureVersion}
 */
export async function updateTrainingDataFeatures(updates) {
  // Ensure database is initialized
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.TRAINING_DATA], 'readwrite');
  const store = transaction.objectStore(STORES.TRAINING_DATA);
  
  const promises = updates.map(update => {
    return new Promise((resolve, reject) => {
      // First get the existing record
      const getRequest = store.get(update.id);
      
      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (record) {
          // Update features
          record.features = update.features;
          record.featureVersion = update.featureVersion;
          
          // Save back
          const putRequest = store.put(record);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve(); // Record not found, skip
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  });
  
  await Promise.all(promises);
}

/**
 * Get database statistics
 */
export async function getDatabaseStats() {
  const stats = {};
  
  for (const storeName of Object.values(STORES)) {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    
    await new Promise((resolve) => {
      const request = store.count();
      request.onsuccess = () => {
        stats[storeName] = request.result;
        resolve();
      };
    });
  }
  
  return stats;
}

/**
 * Save all-time metrics summary to avoid full scan on startup
 */
export async function saveAllTimeMetrics(metrics) {
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.METRICS_SUMMARY], 'readwrite');
  const store = transaction.objectStore(STORES.METRICS_SUMMARY);
  
  const summaryData = {
    id: 'allTimeMetrics',
    timestamp: Date.now(),
    metrics: metrics,
    version: DB_VERSION
  };
  
  return new Promise((resolve, reject) => {
    const request = store.put(summaryData);
    request.onsuccess = () => {
      resolve(summaryData);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load all-time metrics summary from cache
 */
export async function loadAllTimeMetrics() {
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.METRICS_SUMMARY], 'readonly');
  const store = transaction.objectStore(STORES.METRICS_SUMMARY);
  
  return new Promise((resolve, reject) => {
    const request = store.get('allTimeMetrics');
    request.onsuccess = () => {
      const result = request.result;
      if (result && result.version === DB_VERSION) {
        resolve(result.metrics);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get predictions by URL using the new index
 */
export async function getPredictionsByURL(url, limit = null) {
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.PREDICTIONS], 'readonly');
  const store = transaction.objectStore(STORES.PREDICTIONS);
  const index = store.index('url');
  
  return new Promise((resolve, reject) => {
    const predictions = [];
    const request = index.openCursor(IDBKeyRange.only(url), 'prev'); // newest first
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor && (!limit || predictions.length < limit)) {
        predictions.push(cursor.value);
        cursor.continue();
      } else {
        resolve(predictions);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete all ML data for a specific URL
 * This is called when a URL is deleted from saved tabs
 * @param {string} url - The URL to delete
 */
export async function deleteUrlFromMLDatabase(url) {
  if (!db) {
    await initMLDatabase();
  }
  
  // Silently delete data for URL
  
  try {
    // 1. Delete predictions
    const predTx = db.transaction([STORES.PREDICTIONS], 'readwrite');
    const predStore = predTx.objectStore(STORES.PREDICTIONS);
    const predIndex = predStore.index('url');
    
    let deletedPredictions = 0;
    await new Promise((resolve, reject) => {
      const request = predIndex.openCursor(IDBKeyRange.only(url));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deletedPredictions++;
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
    
    // 2. Delete training data
    const trainTx = db.transaction([STORES.TRAINING_DATA], 'readwrite');
    const trainStore = trainTx.objectStore(STORES.TRAINING_DATA);
    const trainIndex = trainStore.index('url');
    
    let deletedTraining = 0;
    await new Promise((resolve, reject) => {
      const request = trainIndex.openCursor(IDBKeyRange.only(url));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deletedTraining++;
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
    
    // Successfully deleted ${deletedPredictions} predictions and ${deletedTraining} training records
    
    // 3. Update performance metrics
    // Import performance tracker to update accuracy counters
    try {
      const { getPerformanceTracker } = await import('../trust/performance-tracker.js');
      const tracker = await getPerformanceTracker();
      // Let tracker update its metrics based on the deletions
      await tracker.refreshMetrics();
    } catch (error) {
      console.warn('Could not update performance metrics:', error);
    }
    
  } catch (error) {
    console.error(`❌ Error deleting ML data for URL ${url}:`, error);
    throw error;
  }
}

/**
 * Clear all ML data (for debugging/reset)
 */
export async function clearAllMLData() {
  const stores = Object.values(STORES);
  const transaction = db.transaction(stores, 'readwrite');
  
  const promises = stores.map(storeName => {
    return new Promise((resolve, reject) => {
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
  
  return Promise.all(promises);
}

/**
 * Clear features field from all training data records
 * Used when vocabulary or model structure changes
 */
export async function clearTrainingDataFeatures() {
  if (!db) {
    await initMLDatabase();
  }
  
  const transaction = db.transaction([STORES.TRAINING_DATA], 'readwrite');
  const store = transaction.objectStore(STORES.TRAINING_DATA);
  
  let clearedCount = 0;
  return new Promise((resolve, reject) => {
    const cursorRequest = store.openCursor();
    
    cursorRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const record = cursor.value;
        if (record.features !== undefined) {
          record.features = undefined;
          record.featureVersion = undefined;
          cursor.update(record);
          clearedCount++;
        }
        cursor.continue();
      } else {
        resolve(clearedCount);
      }
    };
    
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

// Removed standalone training history functions - history now stored in model.metadata.trainingHistory

// Auto-initialize on import
initMLDatabase().catch(console.error);

// Export for testing
export { assignRandomSplit };

export default {
  initMLDatabase,
  saveModel,
  loadModel,
  addTrainingData,
  getTrainingData,
  updateTrainingDataFeatures,
  saveVocabulary,
  loadVocabulary,
  recordMetric,
  getMetrics,
  recordPrediction,
  getDatabaseStats,
  clearAllMLData,
  resetMLModel,
  saveAllTimeMetrics,
  loadAllTimeMetrics,
  getPredictionsByURL,
  deleteUrlFromMLDatabase,
};