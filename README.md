<div align="center">
  <img src="imgs/logo.png" alt="Watch Later Enhanced Logo" width="350"/>

  <h1>Watch Later Enhanced ✨</h1>

  <p>A high-performance, lightweight browser extension engineered to optimize the YouTube "Watch Later" experience through smart event delegation and asynchronous state management.</p>

  <a href="https://chromewebstore.google.com/detail/watch-later-enhanced/pkepecmnomlcbmemeochebfonchhdpfb">
    <img src="https://img.shields.io/badge/Available_on-Chrome_Web_Store-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Chrome Web Store" />
  </a>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="Vanilla JS" />
  <img src="https://img.shields.io/badge/Manifest-V3-34A853?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/License-MIT-34A853?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="MIT License" />

  <br /><br />

  [![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/adaddariodev)
  
  </div>

  

---

## 📋 Overview

**Watch Later Enhanced** is a productivity-focused web extension designed to remove the friction of YouTube's native playlist management. Instead of navigating through multiple dropdown menus, WLE injects a custom logic layer allowing users to instantly save videos to a local queue using a simple `Alt + Click` shortcut, complete with immediate visual and auditory feedback.

## 🪟 Detached Mini Player

Any video can be popped out of the browser into a floating window that stays on
top of every other application — the browser can be minimized and the video
keeps playing, wherever the user drags the window.

* **From the video page:** the mini-player button in YouTube's control bar, or `Alt + Shift + D`.
* **From the extension popup:** the mini-player button on any saved video opens it and offers a one-click launcher on the page (the Picture-in-Picture APIs require a gesture inside the tab, so the popup cannot detach a video on its own).
* **While detached:** `Space` / `K` play and pause, `←` `→` seek, `M` mutes, `Esc` closes. Closing the window — or navigating away — drops the player back exactly where it was, still playing.

Under the hood WLE moves YouTube's *own* player element into a
[Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
window (Chrome 116+), so native controls, captions, quality settings and the
"skip ad" button all keep working. Browsers without that API fall back to the
classic video Picture-in-Picture; the window size is remembered between
sessions, and the feature can be switched off in Settings.

## 📖 Built-in User Guide

Settings hosts a **User guide** button (the book icon) that opens `wiki.html`, a
bundled documentation page: searchable, with a sticky table of contents that
follows the reader, a full shortcut reference and a troubleshooting section. It
ships inside the extension, so it opens instantly and works offline.

## 🛠 Technical Stack & Architecture

This project is built entirely in **Vanilla JavaScript**, ensuring zero-dependency overhead, maximum execution speed, and minimal memory footprint within the browser.

* **Standard:** Adheres to **Manifest V3**, utilizing declarative permissions for enhanced security.
* **Data Management:** Stateless communication utilizing `chrome.storage.local` to sync data seamlessly between the Content Script and the Popup UI.
* **Zero External Dependencies:** Built natively with Fetch API, DOM API, and Web Audio API.

## 🚀 Engineering Highlights

* **Advanced Event Delegation:** Instead of attaching hundreds of listeners to dynamically loaded YouTube thumbnails, the extension uses a single global event listener on the document object, significantly reducing CPU idle usage and preventing memory leaks.
* **Graceful Degradation (Title Extraction):** WLE implements a robust dual-strategy for data retrieval. It primarily fetches clean metadata via YouTube's `oembed` API. If the network request fails, it instantly falls back to an **Aggressive DOM Parsing** strategy, iterating through 4 different selector layers (`aria-label`, `img alt`, etc.) to guarantee a result.
* **Asynchronous UI State Management:** The custom injected HUD handles rapid user inputs and race conditions gracefully. Global timeouts are cleared and reset dynamically to prevent UI flickering or overlapping animations during consecutive saves.
* **Cross-Document Player Hand-off:** The mini player re-parents the live `<video>` player into a second document without interrupting playback, mirrors the page's stylesheets into it, and restores the element to its original node position on close — including when YouTube's SPA router navigates away mid-playback.

## ⚙️ Installation

### From Chrome Web Store (Recommended)
1. Go to the [Chrome Web Store Page](https://chromewebstore.google.com/detail/pkepecmnomlcbmemeochebfonchhdpfb?utm_source=item-share-cb).
2. Click **"Add to Chrome"**.

### Manual Installation (For Developers)
1. Clone this repository: `git clone https://github.com/adaddariodev/Watch-Later-Enhanced-webplugin.git`
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the cloned directory.

## 🏗 Project Structure

```text
.
├── icons/              # Required extension icons (48px, 128px)
├── imgs/               # Promotional assets, high-res logos, and store banners
├── sounds/             # Audio feedback assets (success.wav, click.wav)
├── .gitattributes      # Git configuration
├── content.css         # UI layer: Glassmorphism HUD and animations
├── content.js          # Core logic: Event delegation, API fetch, DOM parsing
├── detach.css          # Styling of the detached mini-player window
├── detach.js           # Detached mini player: Document Picture-in-Picture
├── manifest.json       # Extension configuration & V3 permissions
├── popup.css           # Styling for the popup UI
├── popup.html          # Extension popup interface
├── popup.js            # Storage reader and list management
├── wiki.css            # Styling of the built-in user guide
├── wiki.html           # Built-in user guide (opened from Settings)
├── wiki.js             # Guide navigation: contents, search, back to top
└── README.md           # Project documentation
```

## 🤝 Contributing

This project was built to solve a specific problem, but I am totally open to contributions! Whether it's refactoring, adding new features, or optimizing the DOM parsing logic, feel free to fork the repo and submit a Pull Request.

## 📄 License

Distributed under the MIT License. See LICENSE for more information.

---
<div align="center">
  <b>Built with ❤️ by <a href="https://github.com/adaddariodev">adaddariodev</a></b>
</div>
