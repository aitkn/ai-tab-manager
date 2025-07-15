/*
 * Diagnostic module to analyze training data with zero confidence
 */

import { getTrainingData } from '../storage/ml-database.js';
import logger from '../../utils/logger.js';

export async function diagnoseTrainingData() {
  logger.mlDiagnostic('🔍 Diagnosing ML training data...\n');
  
  // Get ALL training data (no limit)
  const allData = await getTrainingData(100000);
  
  // Check for duplicates
  const urlCounts = {};
  const duplicates = [];
  
  allData.forEach(item => {
    if (!urlCounts[item.url]) {
      urlCounts[item.url] = [];
    }
    urlCounts[item.url].push(item);
  });
  
  Object.entries(urlCounts).forEach(([url, items]) => {
    if (items.length > 1) {
      duplicates.push({
        url,
        count: items.length,
        items: items.map(item => ({
          id: item.id,
          timestamp: new Date(item.timestamp).toISOString(),
          trainingConfidence: item.trainingConfidence,
          combinedConfidence: item.combinedConfidence,
          source: item.source
        }))
      });
    }
  });
  
  if (duplicates.length > 0) {
    logger.mlDiagnostic(`\n🔄 Found ${duplicates.length} URLs with duplicate records:`);
    duplicates.slice(0, 3).forEach(dup => {
      logger.mlDiagnostic(`\n"${dup.url}" has ${dup.count} records:`);
      dup.items.forEach(item => {
        logger.mlDiagnostic(`  ID: ${item.id}, confidence: ${item.trainingConfidence}, timestamp: ${item.timestamp}`);
      });
    });
  }
  
  // Analyze confidence distribution
  const confidenceStats = {
    total: allData.length,
    zeroConfidence: 0,
    lowConfidence: 0,  // < 0.5
    mediumConfidence: 0, // 0.5-0.8
    highConfidence: 0,  // > 0.8
    missingConfidence: 0,
    sources: {},
    zeroConfidenceExamples: []
  };
  
  allData.forEach(item => {
    const confidence = item.trainingConfidence;
    
    // Track by source
    const source = item.source || 'unknown';
    if (!confidenceStats.sources[source]) {
      confidenceStats.sources[source] = {
        total: 0,
        zeroConfidence: 0,
        avgConfidence: 0,
        confidences: []
      };
    }
    
    confidenceStats.sources[source].total++;
    confidenceStats.sources[source].confidences.push(confidence || 0);
    
    if (confidence === undefined || confidence === null) {
      confidenceStats.missingConfidence++;
      confidenceStats.sources[source].zeroConfidence++;
    } else if (confidence === 0) {
      confidenceStats.zeroConfidence++;
      confidenceStats.sources[source].zeroConfidence++;
      
      // Collect examples of zero confidence records
      if (confidenceStats.zeroConfidenceExamples.length < 10) {
        confidenceStats.zeroConfidenceExamples.push({
          id: item.id,
          url: item.url,
          category: item.category,
          source: item.source,
          timestamp: new Date(item.timestamp).toISOString(),
          metadata: item.metadata,
          corrected: item.corrected,
          combinedConfidence: item.combinedConfidence,
          trainingConfidence: item.trainingConfidence
        });
      }
    } else if (confidence < 0.5) {
      confidenceStats.lowConfidence++;
    } else if (confidence <= 0.8) {
      confidenceStats.mediumConfidence++;
    } else {
      confidenceStats.highConfidence++;
    }
  });
  
  // Calculate average confidence by source
  Object.keys(confidenceStats.sources).forEach(source => {
    const sourceData = confidenceStats.sources[source];
    const sum = sourceData.confidences.reduce((a, b) => a + b, 0);
    sourceData.avgConfidence = sourceData.total > 0 ? sum / sourceData.total : 0;
    delete sourceData.confidences; // Remove array to clean up output
  });
  
  // Print results
  logger.mlDiagnostic('📊 Training Data Summary:');
  logger.mlDiagnostic(`Total records: ${confidenceStats.total}`);
  logger.mlDiagnostic(`\nConfidence Distribution:`);
  logger.mlDiagnostic(`- Zero confidence: ${confidenceStats.zeroConfidence} (${(confidenceStats.zeroConfidence/confidenceStats.total*100).toFixed(1)}%)`);
  logger.mlDiagnostic(`- Missing confidence: ${confidenceStats.missingConfidence}`);
  logger.mlDiagnostic(`- Low confidence (<0.5): ${confidenceStats.lowConfidence}`);
  logger.mlDiagnostic(`- Medium confidence (0.5-0.8): ${confidenceStats.mediumConfidence}`);
  logger.mlDiagnostic(`- High confidence (>0.8): ${confidenceStats.highConfidence}`);
  
  logger.mlDiagnostic(`\n📈 By Source:`);
  Object.entries(confidenceStats.sources).forEach(([source, data]) => {
    logger.mlDiagnostic(`\n${source}:`);
    logger.mlDiagnostic(`  - Total: ${data.total}`);
    logger.mlDiagnostic(`  - Zero confidence: ${data.zeroConfidence}`);
    logger.mlDiagnostic(`  - Average confidence: ${data.avgConfidence.toFixed(3)}`);
  });
  
  if (confidenceStats.zeroConfidenceExamples.length > 0) {
    logger.mlDiagnostic(`\n⚠️  Examples of Zero Confidence Records:`);
    confidenceStats.zeroConfidenceExamples.forEach((example, i) => {
      logger.mlDiagnostic(`\n${i + 1}. ${example.url}`);
      logger.mlDiagnostic(`   ID: ${example.id}`);
      logger.mlDiagnostic(`   Category: ${example.category}`);
      logger.mlDiagnostic(`   Source: ${example.source}`);
      logger.mlDiagnostic(`   Corrected: ${example.corrected}`);
      logger.mlDiagnostic(`   Training Confidence: ${example.trainingConfidence}`);
      logger.mlDiagnostic(`   Combined Confidence: ${example.combinedConfidence}`);
      logger.mlDiagnostic(`   Timestamp: ${example.timestamp}`);
      if (example.metadata && Object.keys(example.metadata).length > 0) {
        logger.mlDiagnostic(`   Metadata:`, example.metadata);
      }
    });
  }
  
  // Check for data integrity issues
  logger.mlDiagnostic(`\n🔍 Data Integrity Check:`);
  const needsInvestigation = confidenceStats.zeroConfidence + confidenceStats.missingConfidence;
  if (needsInvestigation > 0) {
    logger.mlDiagnostic(`❌ Found ${needsInvestigation} records with zero or missing confidence!`);
    logger.mlDiagnostic(`   This indicates these records were added without proper prediction data.`);
    logger.mlDiagnostic(`   Likely causes:`);
    logger.mlDiagnostic(`   - Tabs saved before ML confidence system was implemented`);
    logger.mlDiagnostic(`   - Tabs categorized by rules-only without confidence scores`);
    logger.mlDiagnostic(`   - Data migration issues`);
    logger.mlDiagnostic(`\n   PROBLEM: These records are being stored in ML database but then filtered out during training.`);
    logger.mlDiagnostic(`   This causes the confusing log messages about discarding low-confidence records.`);
  } else {
    logger.mlDiagnostic(`✅ All training data has valid confidence values`);
  }
  
  return confidenceStats;
}

// Make it available globally for easy access from console
window.diagnoseTrainingData = diagnoseTrainingData;