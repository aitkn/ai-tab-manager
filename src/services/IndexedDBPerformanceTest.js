/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * IndexedDB Performance Test - Measures actual database read/write performance
 */

/**
 * IndexedDB Performance Testing Module
 */
export class IndexedDBPerformanceTest {
  constructor() {
    this.dbName = 'ai_tab_manager_test';
    this.dbVersion = 1;
    this.db = null;
    this.results = {};
  }

  /**
   * Initialize test database
   */
  async initializeTestDB() {
    console.log('🔄 Initializing test IndexedDB...');
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => {
        console.error('❌ Failed to open IndexedDB');
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ Test IndexedDB initialized');
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create URLs store matching our real schema
        if (!db.objectStoreNames.contains('urls')) {
          const urlStore = db.createObjectStore('urls', { keyPath: 'id', autoIncrement: true });
          
          // Add indexes matching our real database
          urlStore.createIndex('url', 'url', { unique: false });
          urlStore.createIndex('category', 'category', { unique: false });
          urlStore.createIndex('domain', 'domain', { unique: false });
          urlStore.createIndex('lastCategorized', 'lastCategorized', { unique: false });
          urlStore.createIndex('url_title', ['url', 'title'], { unique: true });
        }
        
        console.log('📋 Test database schema created');
      };
    });
  }

  /**
   * Generate realistic test data matching our schema
   */
  generateRealisticData(count = 1000) {
    console.log(`🔄 Generating ${count} realistic test records...`);
    
    const domains = [
      'google.com', 'github.com', 'stackoverflow.com', 'reddit.com', 'youtube.com',
      'amazon.com', 'facebook.com', 'twitter.com', 'linkedin.com', 'microsoft.com',
      'apple.com', 'netflix.com', 'wikipedia.org', 'medium.com', 'dev.to',
      'news.ycombinator.com', 'techcrunch.com', 'vercel.com', 'netlify.com', 'cloudflare.com'
    ];
    
    const titlePrefixes = [
      'How to', 'Best practices for', 'Complete guide to', 'Understanding', 'Introduction to',
      'Advanced', 'Tutorial:', 'Tips for', 'Common mistakes in', 'Debugging'
    ];
    
    const titleSuffixes = [
      'React development', 'JavaScript performance', 'CSS animations', 'Node.js APIs',
      'database design', 'authentication', 'deployment strategies', 'testing frameworks'
    ];
    
    const data = [];
    const baseDate = new Date('2024-01-01');
    
    for (let i = 0; i < count; i++) {
      const domain = domains[Math.floor(Math.random() * domains.length)];
      const titlePrefix = titlePrefixes[Math.floor(Math.random() * titlePrefixes.length)];
      const titleSuffix = titleSuffixes[Math.floor(Math.random() * titleSuffixes.length)];
      const path = Math.random().toString(36).substring(2, 15);
      
      // Realistic category distribution
      let category;
      const rand = Math.random();
      if (rand < 0.05) category = 0;      // 5% uncategorized
      else if (rand < 0.25) category = 1; // 20% can close
      else if (rand < 0.70) category = 2; // 45% save later
      else category = 3;                  // 30% important
      
      const randomDays = Math.floor(Math.random() * 365);
      const savedDate = new Date(baseDate.getTime() + randomDays * 24 * 60 * 60 * 1000);
      
      data.push({
        url: `https://${domain}/${path}`,
        title: `${titlePrefix} ${titleSuffix} - ${domain}`,
        domain: domain,
        category: category,
        firstSeen: savedDate.toISOString(),
        lastCategorized: savedDate.toISOString(),
        favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=16`
      });
    }
    
    console.log(`✅ Generated ${count} realistic records`);
    return data;
  }

  /**
   * Test bulk insert performance
   */
  async testBulkInsert(data) {
    console.log(`🔄 Testing bulk insert of ${data.length} records...`);
    
    const start = performance.now();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readwrite');
      const store = transaction.objectStore('urls');
      
      const errors = [];
      
      transaction.oncomplete = () => {
        const elapsed = performance.now() - start;
        console.log(`✅ Bulk insert completed: ${data.length} records in ${elapsed.toFixed(2)}ms`);
        console.log(`   Average: ${(elapsed / data.length).toFixed(4)}ms per record`);
        console.log(`   Rate: ${Math.round(data.length / (elapsed / 1000))} records/second`);
        
        resolve({
          operation: 'bulk_insert',
          recordCount: data.length,
          totalTime: elapsed,
          timePerRecord: elapsed / data.length,
          recordsPerSecond: data.length / (elapsed / 1000),
          errors: errors.length
        });
      };
      
      transaction.onerror = () => {
        const elapsed = performance.now() - start;
        console.error(`❌ Bulk insert failed after ${elapsed.toFixed(2)}ms`);
        reject(transaction.error);
      };
      
      // Add all records
      data.forEach((record, index) => {
        const request = store.add(record);
        
        request.onsuccess = () => {
          // Success - no need to track count
        };
        
        request.onerror = () => {
          errors.push({ index, error: request.error });
        };
      });
    });
  }

  /**
   * Test reading all records
   */
  async testReadAll() {
    console.log('🔄 Testing read all records...');
    
    const start = performance.now();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readonly');
      const store = transaction.objectStore('urls');
      const request = store.getAll();
      
      request.onsuccess = () => {
        const elapsed = performance.now() - start;
        const records = request.result;
        
        console.log(`✅ Read all completed: ${records.length} records in ${elapsed.toFixed(2)}ms`);
        console.log(`   Average: ${(elapsed / records.length).toFixed(4)}ms per record`);
        console.log(`   Rate: ${Math.round(records.length / (elapsed / 1000))} records/second`);
        
        resolve({
          operation: 'read_all',
          recordCount: records.length,
          totalTime: elapsed,
          timePerRecord: elapsed / records.length,
          recordsPerSecond: records.length / (elapsed / 1000),
          dataSize: JSON.stringify(records).length
        });
      };
      
      request.onerror = () => {
        console.error('❌ Read all failed');
        reject(request.error);
      };
    });
  }

  /**
   * Test reading with cursor (streaming approach)
   */
  async testReadWithCursor() {
    console.log('🔄 Testing read with cursor...');
    
    const start = performance.now();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readonly');
      const store = transaction.objectStore('urls');
      const request = store.openCursor();
      
      const records = [];
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        
        if (cursor) {
          records.push(cursor.value);
          cursor.continue();
        } else {
          // Cursor finished
          const elapsed = performance.now() - start;
          
          console.log(`✅ Cursor read completed: ${records.length} records in ${elapsed.toFixed(2)}ms`);
          console.log(`   Average: ${(elapsed / records.length).toFixed(4)}ms per record`);
          console.log(`   Rate: ${Math.round(records.length / (elapsed / 1000))} records/second`);
          
          resolve({
            operation: 'read_cursor',
            recordCount: records.length,
            totalTime: elapsed,
            timePerRecord: elapsed / records.length,
            recordsPerSecond: records.length / (elapsed / 1000)
          });
        }
      };
      
      request.onerror = () => {
        console.error('❌ Cursor read failed');
        reject(request.error);
      };
    });
  }

  /**
   * Test reading with index (category filter)
   */
  async testReadWithIndex(categories = [2, 3]) {
    console.log(`🔄 Testing read with index (categories: [${categories.join(', ')}])...`);
    
    const start = performance.now();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readonly');
      const store = transaction.objectStore('urls');
      const index = store.index('category');
      
      const allRecords = [];
      let completedQueries = 0;
      
      const onCategoryComplete = () => {
        completedQueries++;
        if (completedQueries === categories.length) {
          const elapsed = performance.now() - start;
          
          console.log(`✅ Index read completed: ${allRecords.length} records in ${elapsed.toFixed(2)}ms`);
          console.log(`   Average: ${(elapsed / allRecords.length).toFixed(4)}ms per record`);
          console.log(`   Rate: ${Math.round(allRecords.length / (elapsed / 1000))} records/second`);
          
          resolve({
            operation: 'read_index',
            recordCount: allRecords.length,
            totalTime: elapsed,
            timePerRecord: elapsed / allRecords.length,
            recordsPerSecond: allRecords.length / (elapsed / 1000),
            categories: categories
          });
        }
      };
      
      categories.forEach(category => {
        const request = index.getAll(category);
        
        request.onsuccess = () => {
          allRecords.push(...request.result);
          onCategoryComplete();
        };
        
        request.onerror = () => {
          console.error(`❌ Index read failed for category ${category}`);
          reject(request.error);
        };
      });
    });
  }

  /**
   * Test individual record updates
   */
  async testUpdate(sampleSize = 100) {
    console.log(`🔄 Testing update of ${sampleSize} random records...`);
    
    // First get some records to update
    const transaction1 = this.db.transaction(['urls'], 'readonly');
    const store1 = transaction1.objectStore('urls');
    const allRecords = await new Promise(resolve => {
      const request = store1.getAll();
      request.onsuccess = () => resolve(request.result);
    });
    
    if (allRecords.length === 0) {
      console.log('⚠️  No records to update');
      return { operation: 'update', recordCount: 0, totalTime: 0 };
    }
    
    // Select random records to update
    const recordsToUpdate = [];
    for (let i = 0; i < Math.min(sampleSize, allRecords.length); i++) {
      const randomIndex = Math.floor(Math.random() * allRecords.length);
      const record = { ...allRecords[randomIndex] };
      record.lastCategorized = new Date().toISOString(); // Update timestamp
      record.category = (record.category + 1) % 4; // Change category
      recordsToUpdate.push(record);
    }
    
    const start = performance.now();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readwrite');
      const store = transaction.objectStore('urls');
      
      transaction.oncomplete = () => {
        const elapsed = performance.now() - start;
        console.log(`✅ Update completed: ${recordsToUpdate.length} records in ${elapsed.toFixed(2)}ms`);
        console.log(`   Average: ${(elapsed / recordsToUpdate.length).toFixed(4)}ms per record`);
        console.log(`   Rate: ${Math.round(recordsToUpdate.length / (elapsed / 1000))} records/second`);
        
        resolve({
          operation: 'update',
          recordCount: recordsToUpdate.length,
          totalTime: elapsed,
          timePerRecord: elapsed / recordsToUpdate.length,
          recordsPerSecond: recordsToUpdate.length / (elapsed / 1000)
        });
      };
      
      transaction.onerror = () => {
        console.error('❌ Update failed');
        reject(transaction.error);
      };
      
      recordsToUpdate.forEach(record => {
        const request = store.put(record);
        request.onsuccess = () => {}; // Success tracked by transaction completion
      });
    });
  }

  /**
   * Test individual record deletion
   */
  async testDelete(sampleSize = 50) {
    console.log(`🔄 Testing deletion of ${sampleSize} random records...`);
    
    // Get some record IDs to delete
    const transaction1 = this.db.transaction(['urls'], 'readonly');
    const store1 = transaction1.objectStore('urls');
    const allRecords = await new Promise(resolve => {
      const request = store1.getAll();
      request.onsuccess = () => resolve(request.result);
    });
    
    if (allRecords.length === 0) {
      console.log('⚠️  No records to delete');
      return { operation: 'delete', recordCount: 0, totalTime: 0 };
    }
    
    // Select random records to delete
    const idsToDelete = [];
    for (let i = 0; i < Math.min(sampleSize, allRecords.length); i++) {
      const randomIndex = Math.floor(Math.random() * allRecords.length);
      idsToDelete.push(allRecords[randomIndex].id);
    }
    
    const start = performance.now();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['urls'], 'readwrite');
      const store = transaction.objectStore('urls');
      
      transaction.oncomplete = () => {
        const elapsed = performance.now() - start;
        console.log(`✅ Delete completed: ${idsToDelete.length} records in ${elapsed.toFixed(2)}ms`);
        console.log(`   Average: ${(elapsed / idsToDelete.length).toFixed(4)}ms per record`);
        console.log(`   Rate: ${Math.round(idsToDelete.length / (elapsed / 1000))} records/second`);
        
        resolve({
          operation: 'delete',
          recordCount: idsToDelete.length,
          totalTime: elapsed,
          timePerRecord: elapsed / idsToDelete.length,
          recordsPerSecond: idsToDelete.length / (elapsed / 1000)
        });
      };
      
      transaction.onerror = () => {
        console.error('❌ Delete failed');
        reject(transaction.error);
      };
      
      idsToDelete.forEach(id => {
        const request = store.delete(id);
        request.onsuccess = () => {}; // Success tracked by transaction completion
      });
    });
  }

  /**
   * Run comprehensive IndexedDB performance test
   */
  async runComprehensiveDBTest(dataSize = 5000) {
    console.log('🚀 Starting comprehensive IndexedDB performance test...');
    console.log(`📊 Dataset size: ${dataSize}`);
    console.log('');
    
    const overallStart = performance.now();
    
    try {
      // 1. Initialize database
      await this.initializeTestDB();
      
      // 2. Generate test data
      const testData = this.generateRealisticData(dataSize);
      
      // 3. Test bulk insert
      console.log('\n📝 TESTING BULK INSERT:');
      const insertResult = await this.testBulkInsert(testData);
      
      // 4. Test read all
      console.log('\n📖 TESTING READ ALL:');
      const readAllResult = await this.testReadAll();
      
      // 5. Test read with cursor
      console.log('\n🔍 TESTING READ WITH CURSOR:');
      const cursorResult = await this.testReadWithCursor();
      
      // 6. Test read with index
      console.log('\n📋 TESTING READ WITH INDEX:');
      const indexResult = await this.testReadWithIndex([2, 3]);
      
      // 7. Test updates
      console.log('\n✏️  TESTING UPDATES:');
      const updateResult = await this.testUpdate(200);
      
      // 8. Test deletes
      console.log('\n🗑️  TESTING DELETES:');
      const deleteResult = await this.testDelete(100);
      
      const overallTime = performance.now() - overallStart;
      
      // Compile results
      const results = {
        metadata: {
          dataSize: dataSize,
          totalTime: overallTime,
          timestamp: new Date().toISOString()
        },
        operations: {
          insert: insertResult,
          readAll: readAllResult,
          readCursor: cursorResult,
          readIndex: indexResult,
          update: updateResult,
          delete: deleteResult
        }
      };
      
      this.results = results;
      this.printDBSummary();
      
      return results;
      
    } catch (error) {
      console.error('❌ IndexedDB test failed:', error);
      throw error;
    }
  }

  /**
   * Print IndexedDB performance summary
   */
  printDBSummary() {
    if (!this.results) return;
    
    const r = this.results;
    
    console.log('\n🎯 INDEXEDDB PERFORMANCE SUMMARY');
    console.log('==========================================');
    console.log(`📊 Dataset: ${r.metadata.dataSize} records`);
    console.log(`⏱️  Total time: ${r.metadata.totalTime.toFixed(2)}ms`);
    console.log('');
    
    console.log('📝 INSERT PERFORMANCE:');
    console.log(`   Bulk insert: ${r.operations.insert.totalTime.toFixed(2)}ms`);
    console.log(`   Per record: ${r.operations.insert.timePerRecord.toFixed(4)}ms`);
    console.log(`   Rate: ${r.operations.insert.recordsPerSecond.toFixed(0)} records/sec`);
    console.log('');
    
    console.log('📖 READ PERFORMANCE:');
    console.log(`   Read all: ${r.operations.readAll.totalTime.toFixed(2)}ms`);
    console.log(`   Read cursor: ${r.operations.readCursor.totalTime.toFixed(2)}ms`);
    console.log(`   Read index: ${r.operations.readIndex.totalTime.toFixed(2)}ms`);
    console.log('');
    
    console.log('✏️  UPDATE PERFORMANCE:');
    console.log(`   ${r.operations.update.recordCount} updates: ${r.operations.update.totalTime.toFixed(2)}ms`);
    console.log(`   Per record: ${r.operations.update.timePerRecord.toFixed(4)}ms`);
    console.log('');
    
    console.log('🗑️  DELETE PERFORMANCE:');
    console.log(`   ${r.operations.delete.recordCount} deletes: ${r.operations.delete.totalTime.toFixed(2)}ms`);
    console.log(`   Per record: ${r.operations.delete.timePerRecord.toFixed(4)}ms`);
    console.log('');
    
    // Overall assessment
    const readAllSpeed = r.operations.readAll.timePerRecord;
    console.log('📈 PERFORMANCE ASSESSMENT:');
    console.log(`   Read speed: ${readAllSpeed.toFixed(4)}ms per record`);
    
    if (readAllSpeed < 0.1) {
      console.log('   ✅ EXCELLENT - Very fast database operations');
    } else if (readAllSpeed < 0.5) {
      console.log('   ✅ GOOD - Acceptable database performance');
    } else if (readAllSpeed < 1.0) {
      console.log('   ⚠️  FAIR - Slower database operations');
    } else {
      console.log('   ❌ POOR - Database operations are slow');
    }
  }

  /**
   * Cleanup test database
   */
  async cleanup() {
    console.log('🧹 Cleaning up test database...');
    
    if (this.db) {
      this.db.close();
    }
    
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);
      
      deleteRequest.onsuccess = () => {
        console.log('✅ Test database cleaned up');
        resolve();
      };
      
      deleteRequest.onerror = () => {
        console.error('❌ Failed to cleanup test database');
        reject(deleteRequest.error);
      };
    });
  }
}

// Export for testing
export default IndexedDBPerformanceTest;