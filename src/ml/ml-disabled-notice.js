/*
 * AI Tab Manager - ML Disabled Notice
 * Explains why ML features are disabled and provides alternatives
 */

export const ML_DISABLED_REASON = `
Machine Learning features are currently disabled due to Chrome extension security restrictions.

Chrome extensions cannot load external scripts (like TensorFlow.js from CDN) for security reasons.

To enable ML features, we would need to:
1. Bundle TensorFlow.js locally (adds ~3MB to extension size)
2. Use a cloud-based ML API instead
3. Use a lighter weight ML library

For now, the extension will use rule-based and LLM categorization only.
`;

export function isMLAvailable() {
  return false;
}

export function getMLDisabledMessage() {
  return 'ML features unavailable (Chrome security restrictions)';
}