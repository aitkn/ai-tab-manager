/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Popup redirect handler - must run before popup.js
 */
// Popup redirect initialized
(async function checkFullWindowMode() {
  // Only log in development/debug mode - check if logger exists and debug is enabled
  if (typeof window.logger !== 'undefined' && window.logger.isEnabled('ui.events')) {
    console.log('[POPUP-REDIRECT] Script running, URL:', window.location.href);
  }
  const urlParams = new URLSearchParams(window.location.search);
  const isPopup = !urlParams.has('popup') || urlParams.get('popup') !== 'false';
  const isSafariPopup = urlParams.has('safariPopup');
  const isChromePopup = urlParams.has('chromePopup');
  const isSafari = !browser.management || !browser.management.getSelf;
  if (typeof window.logger !== 'undefined' && window.logger.isEnabled('ui.events')) {
    console.log('[POPUP-REDIRECT] Popup type:', { isPopup, isSafariPopup, isChromePopup, isSafari });
  }
  
  // First, clean up any existing extension tabs/windows (except this one)
  if (isPopup && !isSafariPopup && !isChromePopup) {
    try {
      // Get current tab/window info
      let currentTabId = null;
      let currentWindowId = null;
      try {
        const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
        currentTabId = currentTab?.id;
        currentWindowId = currentTab?.windowId;
      } catch (e) {
        console.log('Could not get current tab (expected in popup):', e);
      }
      
      // Find all extension tabs
      const allTabs = await browser.tabs.query({});
      const extensionBaseUrl = browser.runtime.getURL('popup.html');
      
      const existingTabs = allTabs.filter(tab => {
        if (!tab.url || !tab.url.startsWith(extensionBaseUrl)) {
          return false;
        }
        // For Safari, close all extension tabs (we're in a popup window)
        if (isSafari) {
          console.log('Safari: Found extension tab to close:', tab.url);
          return true;
        }
        // For other browsers, don't close the current tab
        if (currentTabId && tab.id === currentTabId) {
          console.log('Skipping current tab:', tab.url);
          return false;
        }
        console.log('Found extension tab to close:', tab.url);
        return true;
      });
      
      // Find popup windows created by us
      const allWindows = await browser.windows.getAll({ populate: true });
      const popupWindows = [];
      
      // Get current window ID more reliably
      let actualCurrentWindowId = currentWindowId;
      if (!actualCurrentWindowId) {
        try {
          const currentWindow = await browser.windows.getCurrent();
          actualCurrentWindowId = currentWindow.id;
        } catch (e) {
          console.log('Could not get current window:', e);
        }
      }
      
      for (const window of allWindows) {
        // Skip current window
        if (window.id === actualCurrentWindowId) {
          console.log('Skipping current window:', window.id);
          continue;
        }
        
        // Check if it's our popup window - ALL tabs must be chromePopup=true
        if (window.type === 'popup' || window.type === 'normal') {
          const extensionTabs = window.tabs.filter(tab => 
            tab.url && tab.url.startsWith(extensionBaseUrl)
          );
          
          if (extensionTabs.length > 0) {
            // Check if ALL tabs in this window are popup mode tabs
            const allTabsArePopupMode = window.tabs.every(tab => 
              tab.url && tab.url.includes('chromePopup=true')
            );
            
            if (allTabsArePopupMode) {
              // Safe to close the entire window
              popupWindows.push(window);
            } else {
              // This is a normal window with extension tab(s) mixed with other tabs
              // Add these tabs to existingTabs list to close individually
              extensionTabs.forEach(tab => {
                if (!existingTabs.some(t => t.id === tab.id)) {
                  existingTabs.push(tab);
                }
              });
            }
          }
        }
      }
      
      // Close all existing extension tabs
      console.log(`Found ${existingTabs.length} extension tabs to close`);
      for (const tab of existingTabs) {
        try {
          console.log('Closing tab:', tab.id, tab.url);
          await browser.tabs.remove(tab.id);
        } catch (e) {
          console.log('Could not close tab:', tab.id, e);
        }
      }
      
      // Close all popup windows
      console.log(`Found ${popupWindows.length} popup windows to close`);
      for (const window of popupWindows) {
        try {
          await browser.windows.remove(window.id);
        } catch (e) {
          console.log('Could not close window:', e);
        }
      }
      
      // Small delay to ensure tabs are closed
      if (existingTabs.length > 0 || popupWindows.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.log('Error cleaning up existing instances:', error);
      // Continue with normal flow even if cleanup fails
    }
    
    // Now check preference and redirect if needed
    const result = await browser.storage.local.get('preferredMode');
    
    if (result.preferredMode === 'tab') {
      // For Safari, we need to show something minimal instead of blank
      // This prevents the empty popup balloon
      document.documentElement.innerHTML = '<html><body style="width:0;height:0;overflow:hidden"></body></html>';
      
      const extensionUrl = browser.runtime.getURL('popup.html?popup=false');
      
      try {
        // Check if extension is already open in a tab
        const existingTabs = await browser.tabs.query({ 
          url: [
            browser.runtime.getURL('popup.html'),
            browser.runtime.getURL('popup.html?popup=false')
          ]
        });
        
        if (existingTabs && existingTabs.length > 0) {
          // Extension tab already exists
          const existingTab = existingTabs[0];
          
          // For Safari, we need to be more aggressive with tab activation
          // First, get the current active tab to compare
          const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
          
          if (activeTab && activeTab.id !== existingTab.id) {
            // Focus the window first
            try {
              await browser.windows.update(existingTab.windowId, { focused: true });
            } catch (e) {
              console.log('Window focus failed:', e);
            }
            
            // Then activate the tab with a small delay for Safari
            setTimeout(async () => {
              try {
                await browser.tabs.update(existingTab.id, { active: true });
              } catch (e) {
                console.log('Tab activation failed:', e);
              }
            }, 50);
          }
          
          // Reload after activation
          setTimeout(() => {
            browser.tabs.reload(existingTab.id);
          }, 100);
          
        } else {
          // Create new tab - use opener tab ID for better activation
          const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
          
          const createOptions = {
            url: extensionUrl,
            active: true
          };
          
          // Add opener tab ID if available (helps with activation)
          if (currentTab && currentTab.id) {
            createOptions.openerTabId = currentTab.id;
          }
          
          const newTab = await browser.tabs.create(createOptions);
          
          // Force activation after creation
          if (newTab && newTab.id) {
            setTimeout(async () => {
              try {
                await browser.tabs.update(newTab.id, { active: true });
                if (newTab.windowId) {
                  await browser.windows.update(newTab.windowId, { focused: true });
                }
              } catch (e) {
                console.log('New tab activation failed:', e);
              }
            }, 50);
          }
        }
      } catch (error) {
        console.error('Error opening full window:', error);
        browser.tabs.create({ url: extensionUrl, active: true });
      }
      
      // Close the popup window
      window.close();
      
      // For Safari, try alternative close methods
      if (typeof browser !== 'undefined' && (!browser.management || !browser.management.getSelf)) {
        // Safari detected - try to make the popup window as small as possible
        try {
          // Try to resize window to minimal size
          window.resizeTo(1, 1);
          window.moveTo(-100, -100);
        } catch (e) {
          // Window manipulation might be blocked
        }
        
        // Try closing again after a delay
        setTimeout(() => {
          window.close();
        }, 50);
      }
      
      // Stop all further script execution
      window.stop();
      
      // Prevent popup.js from loading
      window._stopPopupInit = true;
    }
  } else if (isSafariPopup || isChromePopup) {
    // For Safari/Chrome popup windows, also clean up other instances
    try {
      const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
      const currentWindowId = currentTab ? currentTab.windowId : null;
      
      // Find all extension tabs and windows
      const allTabs = await browser.tabs.query({});
      const extensionBaseUrl = browser.runtime.getURL('popup.html');
      const existingTabs = allTabs.filter(tab => 
        tab.url && 
        tab.url.startsWith(extensionBaseUrl) &&
        tab.windowId !== currentWindowId // Don't close tabs in our window
      );
      
      // Close existing tabs in other windows
      for (const tab of existingTabs) {
        try {
          await browser.tabs.remove(tab.id);
        } catch (e) {
          console.log('Could not close tab:', e);
        }
      }
    } catch (error) {
      console.log('Error cleaning up for popup window:', error);
    }
  }
})();