/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Safari-specific popup redirect handler
 * 
 * Safari doesn't support automatic "open in full window" mode.
 * Instead, we provide a manual "Open in Tab" button in the UI.
 */

// Safari popup redirect loaded

(async function checkFullWindowMode() {
  console.log('[SAFARI-POPUP-REDIRECT] Script running, URL:', window.location.href);
  const urlParams = new URLSearchParams(window.location.search);
  const isPopup = !urlParams.has('popup') || urlParams.get('popup') !== 'false';
  const isSafariPopup = urlParams.has('safariPopup');
  
  // Clean up existing extension tabs when opening popup in Safari
  if (isPopup && !isSafariPopup) {
    console.log('[SAFARI-POPUP-REDIRECT] Checking for existing extension tabs');
    try {
      // Get the active tab in the current window
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      const extensionBaseUrl = browser.runtime.getURL('popup.html');
      
      // Check if the active tab is an extension tab
      if (activeTab && activeTab.url && activeTab.url.startsWith(extensionBaseUrl)) {
        console.log('[SAFARI-POPUP-REDIRECT] Active tab is already extension - no need for popup');
        // Don't do anything - user is already using the extension
        // The popup will close itself naturally
        return;
      }
      
      // Active tab is not extension, so we can safely close all extension tabs
      console.log('[SAFARI-POPUP-REDIRECT] Active tab is not extension, cleaning up extension tabs');
      
      // Get all tabs across all windows
      const allTabs = await browser.tabs.query({});
      
      const extensionTabs = allTabs.filter(tab => {
        return tab.url && tab.url.startsWith(extensionBaseUrl);
      });
      
      console.log(`[SAFARI-POPUP-REDIRECT] Found ${extensionTabs.length} extension tabs to close`);
      
      // Close all extension tabs
      for (const tab of extensionTabs) {
        try {
          console.log('[SAFARI-POPUP-REDIRECT] Closing tab:', tab.id, tab.url);
          await browser.tabs.remove(tab.id);
        } catch (e) {
          console.log('[SAFARI-POPUP-REDIRECT] Could not close tab:', tab.id, e);
        }
      }
      
      // Small delay to ensure tabs are closed
      if (extensionTabs.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.log('[SAFARI-POPUP-REDIRECT] Error cleaning up existing instances:', error);
    }
  }
  
  // Safari doesn't need automatic redirect since it uses manual tab/popup switching
})();