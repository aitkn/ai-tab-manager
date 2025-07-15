/*
 * AI Tab Manager - Feature Updater
 * Updates features for existing training data when vocabulary changes
 */

import { getTrainingData, updateTrainingDataFeatures, FEATURE_VERSION } from '../storage/ml-database.js';
import { calculateFeaturesForTrainingData } from './feature-calculator.js';
import { getOrCreateVocabulary } from './vocabulary.js';
import { prepareEmbeddingInputs } from '../embeddings/embedding-model.js';
import logger from '../../utils/logger.js';

/**
 * Update features for all training data that has outdated or missing features
 * This should be called after vocabulary is built or updated
 */
export async function updateAllTrainingDataFeatures() {
  try {
    // Get current vocabulary
    const vocabulary = await getOrCreateVocabulary();
    
    // Only proceed if vocabulary has been built with enough tokens
    if (vocabulary.size() <= 4) {
      console.log('Vocabulary too small for feature updates');
      return { updated: 0, total: 0 };
    }
    
    // Get all training data
    const allData = await getTrainingData();
    
    let updatedCount = 0;
    const updates = [];
    
    // Check each training example
    for (const example of allData) {
      // Skip if features are already calculated with current version
      if (example.features && example.featureVersion === FEATURE_VERSION && 
          example.features.urlTokens && example.features.titleTokens &&
          !example.features.urlTokens.every(id => id === 1 || id === 0)) {
        // Features look valid, skip
        continue;
      }
      
      // Only recalculate token features (keep existing engineered features if available)
      let updatedFeatures;
      
      if (example.features && example.features.engineeredFeatures) {
        // Keep existing engineered features, only update tokens
        const inputs = prepareEmbeddingInputs(
          { url: example.url, title: example.title },
          vocabulary
        );
        
        updatedFeatures = {
          urlTokens: inputs.urlTokens,
          titleTokens: inputs.titleTokens,
          engineeredFeatures: example.features.engineeredFeatures // Keep existing
        };
      } else {
        // Calculate all features if none exist
        const updatedExample = await calculateFeaturesForTrainingData(example);
        updatedFeatures = updatedExample.features;
      }
      
      if (updatedFeatures) {
        updates.push({
          id: example.id,
          features: updatedFeatures,
          featureVersion: FEATURE_VERSION
        });
        updatedCount++;
      }
    }
    
    // Batch update features in database
    if (updates.length > 0) {
      await updateTrainingDataFeatures(updates);
      logger.mlFeatures(`✅ Updated features for ${updatedCount} training examples`);
    }
    
    return { updated: updatedCount, total: allData.length };
    
  } catch (error) {
    console.error('Error updating training data features:', error);
    return { updated: 0, total: 0, error };
  }
}

export default {
  updateAllTrainingDataFeatures
};