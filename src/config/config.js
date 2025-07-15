/*
 * AI Tab Manager - Copyright (c) 2025 AI Tech Knowledge LLC
 * Proprietary License - See LICENSE file
 * support@aitkn.com
 */

// Configuration for the extension
const CONFIG = {
  // LLM Provider configurations
  PROVIDERS: {
    Claude: {
      name: 'Claude',
      apiUrl: 'https://api.anthropic.com/v1/messages',
      modelsUrl: 'https://api.anthropic.com/v1/models',
      apiKeyPlaceholder: 'sk-ant-api03-...',
      apiKeyUrl: 'https://console.anthropic.com/settings/keys',
      headers: {
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      models: [] // Will be fetched dynamically
    },
    OpenAI: {
      name: 'OpenAI',
      apiUrl: 'https://api.openai.com/v1/chat/completions',
      modelsUrl: 'https://api.openai.com/v1/models',
      apiKeyPlaceholder: 'sk-...',
      apiKeyUrl: 'https://platform.openai.com/api-keys',
      headers: {},
      models: [] // Will be fetched dynamically
    },
    Gemini: {
      name: 'Gemini',
      apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
      modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
      apiKeyPlaceholder: 'AIza...',
      apiKeyUrl: 'https://aistudio.google.com/app/apikey',
      headers: {},
      models: [] // Will be fetched dynamically
    },
    DeepSeek: {
      name: 'DeepSeek',
      apiUrl: 'https://api.deepseek.com/v1/chat/completions',
      modelsUrl: 'https://api.deepseek.com/v1/models',
      apiKeyPlaceholder: 'sk-...',
      apiKeyUrl: 'https://platform.deepseek.com/api_keys',
      headers: {},
      models: [] // Will be fetched dynamically
    },
    Grok: {
      name: 'Grok',
      apiUrl: 'https://api.x.ai/v1/chat/completions',
      modelsUrl: 'https://api.x.ai/v1/models',
      apiKeyPlaceholder: 'xai-...',
      apiKeyUrl: 'https://console.x.ai/team',
      headers: {},
      models: [] // Will be fetched dynamically
    }
  },
  
  // Default settings
  DEFAULT_PROVIDER: 'Claude',
  DEFAULT_MODEL: '', // Will be set dynamically
  
  // Default domains to consider as "frequently opened"
  FREQUENT_DOMAINS: [
    'mail.google.com',
    'gmail.com',
    'x.com',
    'twitter.com',
    'youtube.com',
    'google.com',
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'reddit.com',
    'github.com'
  ],
  
  // Prompt versioning - increment this when you update the default prompt
  PROMPT_VERSION: 3,
  
  // Default categorization prompt (user-editable part)
  DEFAULT_PROMPT: `You are a tab categorization assistant. Categorize browser tabs based on how difficult they would be to find again if closed.

  Categories:
  1. Easy to Refind (can be closed): Takes less than 10 seconds to get back to this exact page
  2. Moderate Effort to Refind (save for later): Takes 10 seconds to 2 minutes to find again
  3. Hard to Refind (must save): Takes more than 2 minutes or might be impossible to find again

  Category 1 - Easy to Refind:
  - Well-known domains everyone uses (google.com, youtube.com, gmail.com, amazon.com, etc.)
  - Login/authentication pages of major services
  - Empty tabs, new tabs, error pages
  - Simple Google searches
  - Major news sites, social media homepages

  Category 2 - Moderate Effort to Refind:
  - Less common domains that aren't household names
  - Articles/videos you could find with specific search terms
  - Product pages from any company (even unknown ones)
  - Social media posts from accounts you could find again
  - General documentation or guides
  - Any .ai, .dev, .io domains (unless extremely well-known like github.io)

  Category 3 - Hard to Refind:
  - Deep links to specific conversations, sessions, or states
  - URLs with unique IDs or session tokens
  - Specific social media posts (hard to search for exact tweets/posts)
  - Complex search results after multiple refinements
  - Dynamically generated content or temporary links
  - Pages reached through multiple navigation steps
  - Work in progress or unsaved content

  Key considerations:
  1. Domain familiarity: Is this a domain the average person visits regularly?
  2. URL complexity: Does the URL contain unique IDs, parameters, or session info?
  3. Search difficulty: What would you need to remember to find this exact page?

  Examples:
  - devin.ai → Category 2 (not a well-known domain)
  - github.com/user/repo → Category 2 (specific but searchable)
  - claude.ai/chat/[unique-id] → Category 3 (specific conversation)
  - youtube.com → Category 1 (well-known homepage)`,
  
  // System-enforced prompt suffix (not user-editable)
  // This ensures LLMs always return properly formatted JSON responses
  PROMPT_SYSTEM_SUFFIX: `

  For each tab, assign a category (1, 2, or 3) based on the title and URL.

  Tabs data:
  {TABS_DATA}

  Respond with ONLY a JSON object where keys are tab IDs and values are category numbers (1, 2, or 3).
  Example: {"0": 1, "1": 3, "2": 2}`,
  
  // Database maintenance settings
  DATABASE: {
    // URL retention period in seconds (default: 1 year = 365 * 24 * 60 * 60)
    // Set to a small value (e.g., 60) for testing
    URL_RETENTION_SECONDS: 365 * 24 * 60 * 60
  }
};

// Make CONFIG available globally
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}