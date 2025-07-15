# AI Tab Manager - Smart Browser Extension for Tab Organization

A powerful browser extension that automatically categorizes and saves your tabs using AI. Let artificial intelligence analyze your tabs, instantly save important ones, and give you peace of mind to close everything with one click - knowing nothing important is lost.

## ✨ What Makes AI Tab Manager Special?

- **Instant Save & Categorization**: AI analyzes and saves your tabs simultaneously, preserving everything important before you close
- **Smart Learning**: Starts with LLM and rules, but learns YOUR preferences over time through machine learning
- **Works Everywhere**: Supports Chrome, Safari, Edge, Firefox, and Opera browsers
- **Privacy First**: All processing happens locally in your browser
- **Real-time Updates**: See changes as you browse
- **Powerful Batch Operations**: Close, open, or categorize tabs across all browser windows at once

## 🚀 Quick Start

### Install from Web Store (Recommended)
1. Visit the AI Tab Manager page on your browser's extension store
2. Click "Add to Browser"
3. Click the extension icon in your toolbar to start

### Manual Installation
1. Download the latest release from [GitHub Releases](https://github.com/aitkn/ai-tab-manager/releases)
2. Open your browser's extension management page:
   - Chrome/Edge/Opera: `chrome://extensions/`
   - Firefox: `about:addons`
   - Safari: Preferences → Extensions
3. Enable "Developer mode" (Chrome/Edge/Opera)
4. Click "Load unpacked" and select the extracted folder

**Firefox Note**: For Firefox, rename `manifest.json.v2` to `manifest.json` before loading

## 🎯 How It Works

AI Tab Manager saves and categorizes your tabs based on refindability - then learns YOUR unique preferences over time:

- **🔴 Important** (Hard to find again): Documentation, work tools, unique content
- **🔵 Useful** (Takes time to find): Articles, videos, research
- **⚪ Ignore** (Easy to find): Homepages, search results, social media feeds

As you use the extension and manually categorize tabs, the built-in machine learning model learns your specific preferences, eventually allowing you to turn off the LLM if desired.

## 🛠️ Setting Up LLM (Optional but Recommended)

While the extension works with built-in rules, adding an LLM is highly recommended initially since the ML model needs data to learn from:

### Available LLM Providers

Choose any provider based on your needs and budget:

- **Google Gemini**: Free models available (for now) - great starting point
- **DeepSeek**: Very affordable option with good performance
- **Claude (Anthropic)**: Claude 3.5 Haiku offers excellent value
- **OpenAI**: Wide range of models to choose from
- **Grok**: X.AI's competitive offering

Advanced models may cost more but provide similar categorization results. When you add an API key, you'll see all available models with approximate pricing per 100 tab categorizations.

### Setup Steps
1. Get your API key from your chosen provider
2. Open AI Tab Manager and click ⚙️ Settings
3. Select your provider and paste your API key
4. Choose a model based on the displayed pricing

## 📖 Using AI Tab Manager

### Basic Usage
1. **Click the extension icon** to open AI Tab Manager
2. **Click "Categorize"** to analyze and save all open tabs
3. **Review the results** - tabs are instantly saved and sorted
4. **Close with confidence** - all categorized tabs are already saved and can be reopened later

### Key Features

**💾 Instant Save**: Tabs are saved as soon as they're categorized - no separate save step needed

**🔍 Search & Find**: Quickly locate any saved tab with powerful search

**📊 Batch Operations**:
- Close all tabs across every browser window with one click
- Open multiple saved tabs at once
- Assign categories to groups of tabs
- Mute all audible tabs instantly

**📥 Import/Export**: 
- Export saved tabs to CSV for backup
- Import tabs from CSV files with automatic categorization

**🎨 Themes**: Choose between Light, Dark, or System theme

**🪟 Window Mode**: Open the extension in a full browser tab for easier management

## 🔒 Privacy & Security

- **Machine Learning**: 100% local processing in your browser - no data ever sent anywhere
- **Rule-Based**: All processing happens locally using predefined rules
- **LLM Integration**: When using AI providers (optional):
  - Only tab URL and title are sent directly to your chosen LLM provider
  - We never store, log, or intercept this data
  - Communication goes directly from your browser to the LLM API
  - You control which provider to use with your own API key
- **No Tracking**: We don't collect any usage data or analytics
- **Secure Storage**: API keys and all data stored locally in your browser
- **Open Source**: Review our code on [GitHub](https://github.com/aitkn/ai-tab-manager)

## ⚡ Performance Tips

- The extension uses smart caching for instant loading
- Handles tens of thousands of saved tabs efficiently
- Ignore tabs not accessed for a year are automatically cleaned
- Important and Useful tabs are kept forever (delete manually if needed)
- Machine learning improves categorization accuracy over time

## 🤝 Getting Help

- **Issues?** Report them on [GitHub Issues](https://github.com/aitkn/ai-tab-manager/issues)
- **Questions?** Check our [FAQ](https://github.com/aitkn/ai-tab-manager/wiki/FAQ)
- **Feature requests?** We'd love to hear your ideas!

## 📜 License

AI Tab Manager is proprietary software. 
- ✅ **Free** for personal, non-commercial use
- ❌ Commercial use requires a license
- 📧 Contact: support@aitkn.com for licensing

---

Made with ❤️ by [AI Tech Knowledge LLC](https://aitkn.com)

© 2025 AI Tech Knowledge LLC. All rights reserved.