/*
 * AI Tab Manager - ML Data Validator
 * Diagnostic tool to find and report invalid training data
 */

import { getTrainingData } from '../storage/ml-database.js';
import logger from '../../utils/logger.js';

/**
 * Validate all training data and find invalid categories
 * @returns {Promise<Object>} Validation report
 */
export async function validateAllTrainingData() {
  logger.mlDiagnostic('🔍 Starting ML training data validation...');
  
  const trainingData = await getTrainingData(100000); // Get all data
  const report = {
    totalRecords: trainingData.length,
    validRecords: 0,
    invalidRecords: 0,
    invalidCategories: new Map(), // Map<category, count>
    invalidRecordDetails: [],
    categoryDistribution: new Map() // Map<category, count>
  };
  
  // Check each record
  trainingData.forEach((record, index) => {
    const category = record.category;
    
    // Update category distribution
    const currentCount = report.categoryDistribution.get(category) || 0;
    report.categoryDistribution.set(category, currentCount + 1);
    
    // Validate category
    if (typeof category !== 'number' || 
        !Number.isInteger(category) || 
        category < 0 || 
        category > 3) {
      
      report.invalidRecords++;
      
      // Track invalid category counts
      const invalidCount = report.invalidCategories.get(category) || 0;
      report.invalidCategories.set(category, invalidCount + 1);
      
      // Store details of first 10 invalid records
      if (report.invalidRecordDetails.length < 10) {
        report.invalidRecordDetails.push({
          index,
          id: record.id,
          url: record.url,
          title: record.title,
          category: category,
          categoryType: typeof category,
          source: record.source,
          timestamp: record.timestamp,
          corrected: record.corrected,
          metadata: record.metadata
        });
      }
    } else {
      report.validRecords++;
    }
  });
  
  // Log the report
  logger.mlDiagnostic('📊 ML Training Data Validation Report:');
  logger.mlDiagnostic(`   Total records: ${report.totalRecords}`);
  logger.mlDiagnostic(`   Valid records: ${report.validRecords}`);
  logger.mlDiagnostic(`   Invalid records: ${report.invalidRecords}`);
  
  if (report.invalidRecords > 0) {
    logger.error('❌ Found invalid training data!');
    logger.error('Invalid categories found:', Array.from(report.invalidCategories.entries()));
    logger.error('Sample invalid records:', report.invalidRecordDetails);
  }
  
  logger.mlDiagnostic('Category distribution:');
  const sortedCategories = Array.from(report.categoryDistribution.entries()).sort((a, b) => a[0] - b[0]);
  sortedCategories.forEach(([category, count]) => {
    const isValid = Number.isInteger(category) && category >= 0 && category <= 3;
    logger.mlDiagnostic(`   Category ${category}: ${count} records ${isValid ? '' : '⚠️ INVALID'}`);
  });
  
  return report;
}

/**
 * Find the source of invalid category values
 * @param {number} invalidCategory - The invalid category to trace
 * @returns {Promise<Object>} Trace report
 */
export async function traceInvalidCategorySource(invalidCategory) {
  logger.mlDiagnostic(`🕵️ Tracing source of invalid category: ${invalidCategory}`);
  
  const trainingData = await getTrainingData(100000);
  const invalidRecords = trainingData.filter(record => record.category === invalidCategory);
  
  if (invalidRecords.length === 0) {
    logger.mlDiagnostic('No records found with this category');
    return { found: false };
  }
  
  // Analyze the records
  const sources = new Map();
  const timestamps = [];
  const urls = new Set();
  
  invalidRecords.forEach(record => {
    // Track sources
    const source = record.source || 'unknown';
    sources.set(source, (sources.get(source) || 0) + 1);
    
    // Track timestamps
    timestamps.push(record.timestamp);
    
    // Track unique URLs
    urls.add(record.url);
  });
  
  // Find earliest and latest
  timestamps.sort((a, b) => a - b);
  const earliest = new Date(timestamps[0]);
  const latest = new Date(timestamps[timestamps.length - 1]);
  
  const report = {
    found: true,
    invalidCategory,
    recordCount: invalidRecords.length,
    uniqueUrls: urls.size,
    sources: Array.from(sources.entries()),
    earliestRecord: earliest.toISOString(),
    latestRecord: latest.toISOString(),
    timeSpan: `${Math.round((latest - earliest) / 1000 / 60)} minutes`,
    sampleRecords: invalidRecords.slice(0, 5).map(r => ({
      url: r.url,
      title: r.title,
      source: r.source,
      timestamp: new Date(r.timestamp).toISOString(),
      metadata: r.metadata
    }))
  };
  
  logger.mlDiagnostic('📋 Invalid Category Trace Report:');
  logger.mlDiagnostic(`   Category: ${invalidCategory}`);
  logger.mlDiagnostic(`   Total records: ${report.recordCount}`);
  logger.mlDiagnostic(`   Unique URLs: ${report.uniqueUrls}`);
  logger.mlDiagnostic(`   Sources:`, report.sources);
  logger.mlDiagnostic(`   Time range: ${report.earliestRecord} to ${report.latestRecord} (${report.timeSpan})`);
  logger.mlDiagnostic('   Sample records:', report.sampleRecords);
  
  // Check if this might be a bit shift or encoding issue
  if (invalidCategory > 127) {
    logger.warn('⚠️ Category value > 127 suggests possible bit manipulation or encoding issue');
    logger.mlDiagnostic(`   Binary: ${invalidCategory.toString(2)}`);
    logger.mlDiagnostic(`   Hex: 0x${invalidCategory.toString(16)}`);
    
    // Check if it's a shifted value
    for (let shift = 1; shift <= 8; shift++) {
      const unshifted = invalidCategory >> shift;
      if (unshifted >= 0 && unshifted <= 3) {
        logger.warn(`   🔍 Possible bit shift detected: ${invalidCategory} >> ${shift} = ${unshifted}`);
      }
    }
  }
  
  return report;
}

/**
 * Run full diagnostics
 */
export async function runFullDiagnostics() {
  logger.mlDiagnostic('🏥 Running full ML data diagnostics...\n');
  
  // Validate all data
  const validationReport = await validateAllTrainingData();
  
  // If invalid data found, trace each invalid category
  if (validationReport.invalidRecords > 0) {
    logger.mlDiagnostic('\n🔍 Tracing invalid categories...\n');
    
    for (const [category, count] of validationReport.invalidCategories) {
      logger.mlDiagnostic(`\n--- Tracing category ${category} (${count} records) ---`);
      await traceInvalidCategorySource(category);
    }
  } else {
    logger.mlDiagnostic('\n✅ All training data is valid!');
  }
  
  return validationReport;
}

// Export for use in console
if (typeof window !== 'undefined') {
  window.mlDataValidator = {
    validateAllTrainingData,
    traceInvalidCategorySource,
    runFullDiagnostics
  };
  logger.mlDiagnostic('💡 ML Data Validator loaded. Use window.mlDataValidator.runFullDiagnostics() to check data integrity.');
}