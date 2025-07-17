/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Database Sync Adapter - Notifies sync service of database changes
 */

let syncService = null;
let isInitialized = false;

/**
 * Initialize the database sync adapter
 * @param {GoogleDriveSyncService} service - The sync service instance
 */
export function initializeDatabaseSyncAdapter(service) {
  syncService = service;
  isInitialized = true;
  
  // Expose notifyDatabaseChange globally for database.js
  window.notifyDatabaseChange = notifyDatabaseChange;
}

/**
 * Notify sync service of a database change
 * Should be called after any database modification
 */
export function notifyDatabaseChange() {
  if (!isInitialized || !syncService) {
    return;
  }
  
  // Schedule sync after change
  try {
    syncService.scheduleSyncAfterChange();
  } catch (error) {
    console.error('Error notifying sync service:', error);
  }
}

/**
 * Check if sync adapter is initialized
 * @returns {boolean}
 */
export function isSyncAdapterInitialized() {
  return isInitialized;
}