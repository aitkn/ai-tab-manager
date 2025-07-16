/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Popup redirect loader - loads the appropriate redirect handler
 */
// Popup redirect loader initialized
// Use Safari-specific redirect handler if in Safari
const isSafari = !browser.management || !browser.management.getSelf;
if (isSafari) {
  const script = document.createElement('script');
  script.src = 'src/utils/popup-redirect-safari.js';
  document.head.appendChild(script);
} else {
  const script = document.createElement('script');
  script.src = 'src/utils/popup-redirect.js';
  document.head.appendChild(script);
}