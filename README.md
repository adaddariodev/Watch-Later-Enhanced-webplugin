# 🕒 Watch Later Enhanced (WLE)

> **A high-performance browser extension engineered to optimize and declutter the YouTube "Watch Later" experience through advanced DOM manipulation and state management.**

[![JavaScript](https://img.shields.io/badge/Language-Vanilla%20JS-yellow.svg?style=for-the-badge&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg?style=for-the-badge&logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

---

## 📋 Overview

**Watch Later Enhanced** is a productivity-focused web extension designed to bridge the gap in YouTube's native playlist management. While the default interface lacks granular control for large playlists, WLE injects a custom logic layer to allow for intelligent filtering, duration calculation, and automated maintenance of the "Watch Later" queue.

## 🛠 Technical Stack & Architecture

This project is built using **Vanilla JavaScript** to ensure zero-dependency overhead and maximum execution speed within the browser's sandbox.

### Core Architecture
* **Engine:** Asynchronous JavaScript (ES6+) for non-blocking UI updates.
* **Standard:** Adheres to **Manifest V3**, utilizing Service Workers and declarative permissions for enhanced security and performance.
* **Communication:** Orchestrates data flow between the **Popup UI** and **Content Scripts** via the `chrome.runtime` messaging API.
* **DOM Interaction:** Optimized selectors and observers designed to interface with YouTube's dynamic, AJAX-heavy frontend.

### 🏗 Project Structure
```text
.
├── src/
│   ├── manifest.json       # Extension configuration & permissions
│   ├── popup/              # UI Layer (HTML/CSS/JS)
│   ├── scripts/
│   │   ├── content.js      # DOM Interaction & Injection logic
│   │   └── background.js   # Service Worker for lifecycle management
│   └── assets/             # Optimized icons and UI elements
└── README.md
```

### 🚀 Key Engineering Features
* **Dynamic DOM Injection:** Safely injects UI components into the YouTube interface using MutationObservers to handle lazy-loaded content without page refreshes.

* **Playlist Analytics:** Algorithmically calculates total playlist duration and "Time to Complete" by parsing and normalizing duration strings directly from the DOM.

* **Performance First:** Event-driven architecture designed to minimize CPU idle usage and prevent memory leaks during long browsing sessions.

* **Privacy-Centric:** No external API calls. All data processing occurs locally within the user's browser instance.

### 🤝 Contributing
I welcome contributions from fellow developers.
If you're interested in refactoring, adding features, or improving performance, let me know!

### 📄 License
Distributed under the MIT License. See LICENSE for more information.

### ✉️ Contact
Antonio D'Addario - GitHub Profile

Project Link: https://github.com/adaddariodev/Watch-Later-Enhanced-webplugin

---

Realizzato con ❤️ da Antonio D'Addario
