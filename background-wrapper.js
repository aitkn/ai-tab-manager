// Import the polyfill first
importScripts('lib/browser-polyfill.min.js');

// Import required dependencies
importScripts('src/data/database.js');
importScripts('src/config/config.js');

// Then import the actual background script
importScripts('background.js');