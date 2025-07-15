/*
 * AI Tab Manager - Update Training Features
 * Utility to update existing training data with pre-calculated features
 */

import { getTrainingData, updateTrainingDataFeatures, FEATURE_VERSION } from '../storage/ml-database.js';
import { prepareEmbeddingInputs } from '../embeddings/embedding-model.js';
import { getOrCreateVocabulary } from './vocabulary.js';

/**
 * Update all training data with pre-calculated features
 * This speeds up future training by caching feature calculations
 */
export async function updateAllTrainingFeatures() {
  try {
    console.log('📊 Updating training data with pre-calculated features...');
    
    // Get vocabulary
    const vocabulary = await getOrCreateVocabulary();
    
    // Get all training data
    const trainingData = await getTrainingData(10000); // Get all data
    
    if (!trainingData || trainingData.length === 0) {
      console.log('No training data to update');
      return { updated: 0, total: 0 };
    }
    
    console.log(`Found ${trainingData.length} training records to process`);
    
    // Process in batches to avoid memory issues
    const batchSize = 50;
    let updated = 0;
    
    for (let i = 0; i < trainingData.length; i += batchSize) {
      const batch = trainingData.slice(i, i + batchSize);
      
      // Calculate features for batch
      const updatedBatch = batch.map(item => {
        // Skip if already has features with current version
        if (item.features && item.featureVersion === FEATURE_VERSION) {
          return null;
        }
        
        // Calculate features
        const inputs = prepareEmbeddingInputs(
          { url: item.url, title: item.title },
          vocabulary
        );
        
        return {
          id: item.id,
          features: {
            urlTokens: inputs.urlTokens,
            titleTokens: inputs.titleTokens,
            engineeredFeatures: inputs.features
          },
          featureVersion: FEATURE_VERSION
        };
      }).filter(item => item !== null);
      
      // Update batch in database
      if (updatedBatch.length > 0) {
        await updateTrainingDataFeatures(updatedBatch);
        updated += updatedBatch.length;
      }
      
      // Log progress
      const progress = Math.min(i + batchSize, trainingData.length);
      console.log(`Progress: ${progress}/${trainingData.length} (${(progress/trainingData.length*100).toFixed(1)}%)`);
    }
    
    console.log(`✅ Updated ${updated} training records with features`);
    
    return {
      updated,
      total: trainingData.length,
      skipped: trainingData.length - updated
    };
    
  } catch (error) {
    console.error('Error updating training features:', error);
    throw error;
  }
}

// Make available globally for testing
if (typeof window !== 'undefined') {
  window.updateAllTrainingFeatures = updateAllTrainingFeatures;
}