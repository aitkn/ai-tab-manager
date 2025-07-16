/*
 * Cleanup duplicate training data records
 * Keeps only the record with highest confidence for each URL
 */

import { initMLDatabase, STORES, DB_NAME, DB_VERSION } from '../storage/ml-database.js';
import logger from '../../utils/logger.js';

export async function cleanupDuplicateTrainingData() {
  logger.mlDiagnostic('🧹 Starting duplicate training data cleanup...\n');
  
  // Initialize database
  await initMLDatabase();
  
  // Get direct database access
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  
  return new Promise((resolve, reject) => {
    request.onsuccess = async () => {
      const db = request.result;
      const transaction = db.transaction([STORES.TRAINING_DATA], 'readwrite');
      const store = transaction.objectStore(STORES.TRAINING_DATA);
      
      // Get all records
      const getAllRequest = store.getAll();
      
      getAllRequest.onsuccess = async () => {
        const allRecords = getAllRequest.result;
        logger.mlDiagnostic(`Found ${allRecords.length} total training records`);
        
        // Group by URL
        const urlGroups = {};
        allRecords.forEach(record => {
          if (!urlGroups[record.url]) {
            urlGroups[record.url] = [];
          }
          urlGroups[record.url].push(record);
        });
        
        // Find duplicates
        let duplicateCount = 0;
        let deletedCount = 0;
        const deletionPromises = [];
        
        Object.entries(urlGroups).forEach(([url, records]) => {
          if (records.length > 1) {
            duplicateCount++;
            
            // Sort by confidence (descending), then by timestamp (descending)
            records.sort((a, b) => {
              const confDiff = (b.trainingConfidence || 0) - (a.trainingConfidence || 0);
              if (confDiff !== 0) return confDiff;
              return b.timestamp - a.timestamp;
            });
            
            const keepRecord = records[0];
            const deleteRecords = records.slice(1);
            
            logger.mlDiagnostic(`\nURL: ${url}`);
            logger.mlDiagnostic(`  Keeping: ID ${keepRecord.id}, confidence: ${keepRecord.trainingConfidence}, timestamp: ${new Date(keepRecord.timestamp).toISOString()}`);
            
            deleteRecords.forEach(record => {
              logger.mlDiagnostic(`  Deleting: ID ${record.id}, confidence: ${record.trainingConfidence}, timestamp: ${new Date(record.timestamp).toISOString()}`);
              
              // Delete in a new transaction
              const deleteTransaction = db.transaction([STORES.TRAINING_DATA], 'readwrite');
              const deleteStore = deleteTransaction.objectStore(STORES.TRAINING_DATA);
              const deleteRequest = deleteStore.delete(record.id);
              
              deletionPromises.push(new Promise((resolve, reject) => {
                deleteRequest.onsuccess = () => {
                  deletedCount++;
                  resolve();
                };
                deleteRequest.onerror = () => reject(deleteRequest.error);
              }));
            });
          }
        });
        
        // Wait for all deletions to complete
        await Promise.all(deletionPromises);
        
        logger.mlDiagnostic(`\n✅ Cleanup complete!`);
        logger.mlDiagnostic(`  - Found ${duplicateCount} URLs with duplicates`);
        logger.mlDiagnostic(`  - Deleted ${deletedCount} duplicate records`);
        logger.mlDiagnostic(`  - Remaining records: ${allRecords.length - deletedCount}`);
        
        resolve({
          totalRecords: allRecords.length,
          duplicateUrls: duplicateCount,
          deletedRecords: deletedCount,
          remainingRecords: allRecords.length - deletedCount
        });
      };
      
      getAllRequest.onerror = () => reject(getAllRequest.error);
    };
    
    request.onerror = () => reject(request.error);
  });
}

// Make it available globally
window.cleanupDuplicateTrainingData = cleanupDuplicateTrainingData;