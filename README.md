<div align="center">
  <img src="imgs/logo.png" alt="Watch Later Enhanced Logo" width="350"/>

  <h1>Watch Later Enhanced</h1>

  <p><strong>Save any YouTube video with <code>Alt + left click</code>. Watch it in a floating window that outlives the browser.</strong><br/>
  A zero-dependency Manifest V3 extension. Your list never leaves your machine.</p>

  <a href="https://chromewebstore.google.com/detail/watch-later-enhanced/pkepecmnomlcbmemeochebfonchhdpfb">
    <img src="https://img.shields.io/badge/Available_on-Chrome_Web_Store-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Chrome Web Store" />
  </a>
  <img src="https://img.shields.io/badge/Version-3.1.0-FF5A50?style=for-the-badge" alt="Version 3.1.0" />
  <img src="https://img.shields.io/badge/Manifest-V3-34A853?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Dependencies-0-8FA6C4?style=for-the-badge" alt="Zero dependencies" />
  <img src="https://img.shields.io/badge/License-MIT-34A853?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="MIT License" />

  <br /><br />

  [![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/adaddariodev)

</div>

---

## Why it exists

YouTube's own "Watch Later" costs you three clicks, a dropdown and a page you
did not want to load — and then the list only works on YouTube. Most videos
saved that way are never seen again.

Watch Later Enhanced replaces that with one gesture. Hold `Alt`, left click any
thumbnail, and it is on your list — no navigation, no dropdown, no page load.
The list lives in your browser toolbar, reachable from any site.

## What it does

### Save without leaving the page

`Alt + left click` any thumbnail, or the player itself, and the video is saved. A
small HUD confirms it with the video's real title, pulled from the page or from
YouTube's oEmbed endpoint if the page does not offer one.

### Or from nothing but its link

Paste a YouTube link — `youtube.com`, the Share button's `youtu.be`, a Short, a
live stream, with or without `https://` — anywhere on the list in the popup, or
into **Info & Settings → Import & export → Add by link**. There, anything that is
not a YouTube video is refused with the reason, and
a video already on the list says which tab it is in rather than being added
twice. The popup asks YouTube nothing, so the title, channel and type are filled
in by a YouTube tab: at once if one is on screen, otherwise on your next visit.

### Take your list with you

**Export** writes To Watch and Archive to a JSON file; **Import** reads one back —
or a hand-written list of links — and only ever adds: a video already on the list
is left exactly as it is, nothing is removed, and an **Undo** takes the whole
import back out. The **Guide** beside the two buttons opens the guide's own section on
them, with the file format, every field and worked examples. A file window closes
the toolbar popup in some browsers, silently taking the import with it, so Import
always opens the list in a small window of its own first, which it cannot close.

### Watch it in a window of its own

Pop any video out of the browser into a floating mini player. Minimize the
browser, move to another app, drag the window anywhere — it keeps playing.

* **From any thumbnail, without opening it:** `Alt + Shift + left click` it — the
  gesture that saves a video, with Shift. Or pick **Play in mini player** from
  the video's own ⋮ menu. Or hover the thumbnail and use the button in its
  top-left corner.
* **On a video page:** `Alt + Shift + left click` the player, or the mini-player
  button in YouTube's control bar. The window opens at the second the page had
  reached, and the page stops playing — one video at a time, never two.
* **From the popup:** the mini-player button on a saved video plays it
  immediately in a dedicated window — no tab, nothing to confirm. **Pin on
  top** in its corner promotes it to the floating kind.
* **While detached:** `Space`/`K` play and pause, `←` `→` seek five seconds,
  `M` mutes, `Esc` closes. Closing and returning to the tab also sit in the
  browser's own title bar on that window, so the overlay does not repeat them —
  it shows the video's title and a **Pinned** badge, and fades out of the way.

There is only ever one mini player: asking for the video already in it brings
that window forward, and asking for another puts it in the same window. It is a
window of its own, so closing the page it came from leaves it playing.

> The pin is a button rather than a setting because it has to be: a browser
> only grants an always-on-top window in response to a click inside the page,
> so no preference can ask for one on your behalf.

### Organise it the way you think

* **Search that looks at titles and tags** at once, for the two things anyone
  remembers about a saved video. The box folds into the filter row when nothing
  is being searched for, and never while something typed in it is filtering.
* **Click a channel name** under any video to see only what you saved from it —
  or a tag, to see only what carries it. Either writes what it did into the
  search box (`channel:Fireship`, `tag:music`), which you can also type; a tag
  leaves the box folded, since its chip lights up in the tag bar instead.
* **A tag bar** under the filters: every tag on the list on screen, most used
  first, one click from filtering by it. One line that scrolls sideways — arrows
  appear only on a side with more to see — so it never grows with your tags,
  and it is not there at all until you have one.
* **Tags**, colour-derived from their own name, with autocomplete.
* **Thumbnails** — each card opens with the video's picture, the smallest one
  YouTube publishes (a few KB), loaded only for cards near the screen and kept
  only in the browser's own cache. One switch in Settings turns them off.
* **A numbered queue** — every card shows its place in its tab, counting from
  1, and takes its new number the moment it is moved. Hover the card and the
  number becomes the grip you drag it by, in the same spot — a badge in the
  thumbnail's corner — so a number costs the title nothing.
* **Drag and drop** to set your own order, in **To Watch** and in **Archive**
  alike. Sorting one tab never moves anything in the other.
* **To Watch / Archive / Trash**, so finished videos leave the queue without
  disappearing, and deletions are recoverable.
* **A Shorts label** on Shorts, with a filter that narrows the list to either kind.
* **The channel** that published each video, under its title — and clickable.
* **Favourites** — a heart per row, and a filter that narrows whatever the
  type chips and the tag search are already showing.
* **A sound mixer** — a level and an on/off per sound, or silence for the lot.
* **Colours you choose** — every colour the extension invents for itself comes
  from one setting: a colour per name worked out from its letters, one neutral
  for everything, or a single HEX code you give it. A light one flips the
  lettering to dark so a pale tag stays readable.
* **A glass finish** — a slider that turns the cards, the toolbar and the
  settings panel into frosted panes over a lit backdrop, at whatever strength
  you want, and draws none of it at zero.
* **A popup the size of your screen** — about three quarters of the height it
  has spare, between 400px and the 600 a browser will draw.

### Know what you saved

The **channel name** — and a **Shorts** label, on a Short — sit on one line
under every title, with your own tags on a line of their own below them.
Because YouTube serves the same Short behind both `/shorts/` and `/watch`
links, the type is worked out from the URL, then from the page around the
thumbnail, and finally — when neither settles it — by asking YouTube in the
background and correcting the label a moment later. The channel comes from the
page when it is there and from YouTube's `oembed` payload when it is not.

Items saved before a detail existed are filled in a few at a time while you
browse YouTube, rather than left permanently blank.

### Read the manual without leaving the extension

Settings opens a bundled user guide: searchable, with a table of contents that
tracks your scroll position, a full shortcut reference and troubleshooting.
It ships inside the extension, so it works offline. Beside it, **What's new**
links to the releases on GitHub, and the version you are running is printed at
the foot of the panel — read from the manifest, so it cannot disagree with
what you have installed.

## Shortcuts

| Shortcut | Where | What it does |
| --- | --- | --- |
| `Alt + left click` | Any YouTube thumbnail | Saves it without opening it |
| `Alt + left click` | The video player | Saves what you are watching |
| `Alt + Shift + left click` | Any thumbnail or title | Plays it in the mini player, without opening it |
| `Alt + Shift + left click` | The player on a video page | Opens it in the mini player, from where the page had reached |
| `/` | The popup | Opens the search box |
| `Ctrl/⌘ + V` | The list in the popup | Adds the YouTube link on the clipboard |
| `Enter` | Add by link | Adds the pasted link |
| `Esc` | The search box | Clears it and folds it away |
| `Space` or `K` | Mini player | Play / pause |
| `←` / `→` | Mini player | Back / forward 5 seconds |
| `M` | Mini player | Mute / unmute |
| `Esc` | Mini player | Close and return the video to the tab |
| `Enter` / `Esc` | Tag box | Add the tag / close without adding |
| `←` / `→`, `Home` / `End` | Tag bar | Move along the tags; `Enter` filters by the one focused |

## Privacy

There is no server behind this extension. No account, no sign-in, no telemetry,
no analytics, no sync. Your list is held in `chrome.storage.local` on your own
machine and is never transmitted anywhere.

Every outbound request the extension makes, in full:

| To | When | What it carries |
| --- | --- | --- |
| `youtube.com/oembed` | Saving a video whose title the page did not provide, or naming one added by its link | The video URL |
| `youtube.com/shorts/<id>` | Saving, to tell a Short from a video | The video ID |
| `i.ytimg.com/vi/<id>/default.jpg` | Showing a card's thumbnail, while thumbnails are on | The video ID; no referrer |

That is the complete list. The first two go to YouTube, only from a YouTube tab,
and carry nothing about you beyond the video in question — which is why a video
added in the popup by its link waits for a YouTube tab to name it rather than
the popup asking. The third is YouTube's image server, asked by the popup for the
pictures of the cards near the screen; the browser caches them, and the extension
stores none. Export and Import write and read a file on your own machine; nothing
is uploaded. Nothing reaches any other party: the Inter typeface is
[bundled with the extension](fonts/) rather than fetched from Google, so with
thumbnails switched off, opening the popup makes no request at all.

The page's own Content Security Policy enforces it — `style-src 'self';
font-src 'self';` — so a remote stylesheet or font could not load even if one
were added by mistake.

Permissions requested: **`storage`**. That is the whole list — no host
permissions, no tabs, no scripting.

## Install

**From the Chrome Web Store** —
[add it here](https://chromewebstore.google.com/detail/watch-later-enhanced/pkepecmnomlcbmemeochebfonchhdpfb).

**From source**

```bash
git clone https://github.com/adaddariodev/Watch-Later-Enhanced-webplugin.git
```

Then open `chrome://extensions/`, turn on **Developer mode**, click
**Load unpacked**, and select the cloned directory.

Requires Chrome 116+ for the detached mini player (older versions fall back to
the classic Picture-in-Picture). Firefox 109+ is supported.

**Packaging for the Chrome Web Store**

```bash
./scripts/package.sh   # → dist/watch-later-enhanced-<version>.zip
```

It zips an allow-list of the files the extension loads, taken from the last
commit rather than the folder: the README, the store copy in `docs/` and the
logos and promo banners in `imgs/` stay out of what users install, and an
uncommitted edit can never ship by accident.

## How it is built

Vanilla JavaScript, no build step, no dependencies, no framework. Clone it and
it runs.

* **Manifest V3**, with `storage` as the only permission.
* **One delegated listener** on `document` handles every thumbnail on the page,
  rather than binding to each of the hundreds YouTube creates and destroys as
  you scroll. Nothing to clean up, nothing to leak.
* **Structural matching, not component names** — a thumbnail is recognised as a
  link to a video at the size and shape of a picture, never as
  `ytd-thumbnail` or `ytLockupViewModelContentImage`. Those names differ per
  surface and change without notice; that shape does not. Where something has
  to be found inside YouTube's own UI, it is found by its ARIA role — the ⋮
  menu is `[role="menu"]`, and the row added to it is a clone of one of its
  own, so it inherits whatever styling that menu is wearing.
* **Layered title extraction** — the page's own DOM first (with selectors for
  the Shorts view model, which stores its title somewhere else entirely), then
  YouTube's `oembed` endpoint as a fallback. Title and channel share one
  memoised `oembed` call rather than one each, and everything is asked of the
  page's own origin so it works on `m.youtube.com` too.
* **Layered type detection** — the URL, then the DOM around the click, then a
  same-origin redirect check, memoised per video and bounded by a timeout.
* **Thumbnails that cost no storage** — the picture's address is built from the
  video id at render time (`i.ytimg.com/vi/<id>/default.jpg`, 120×90, a few KB),
  never stored. `loading="lazy"` inside the render window means only cards near
  the screen ask; the browser's HTTP cache answers every later redraw and
  reopening, measured at zero repeat requests. The 16:9 frame inside the 4:3
  file is cropped out by `object-fit: cover` in a 16:9 box, so no larger size is
  ever fetched.
* **Imports are rebuilt, never trusted** — a pasted link or an imported entry is
  reconstructed field by field from an allow-list: the link re-parsed down to its
  video id and stored as the canonical watch URL, text trimmed and capped, tag
  colours recomputed from their names. A file can add videos; it cannot add a
  key, a style or a script, and it never overwrites a video already saved.
* **Moves by identity, not position** — a drag names the two videos by url and
  finds them inside the write, so a delete or an import landing between drawing
  the list and dropping the card cannot move the wrong one.
* **Optimistic writes with a snapshot guard** — every read-modify-write on the
  list re-reads before committing and retries on conflict, so the popup and a
  YouTube tab saving at the same moment cannot drop each other's changes.
* **A render window** — the list is drawn a chunk at a time, the next fetched
  by an `IntersectionObserver` a screen ahead of the fold, so the cost of the
  full rebuild each change triggers is the cost of what is on screen rather
  than of everything saved. The window never shrinks while the list is the
  same one, because the browser keeps your scroll position across a rebuild
  only while the content is still as tall.
* **A mini player that outlives its opener** — every way in opens a real
  browser window, owned by the service worker rather than by the page that
  asked for it, so closing that page leaves it playing. It is a window because
  it has to be: a
  [Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
  window belongs to the document that opened it and dies with it. What is
  given up is the hand-off of the already-decoded `<video>`, so the window
  starts at the second the page had reached rather than receiving the frame
  itself.
* **Document PiP for the pin, and only for it** — **Pin on top** is the one
  place a floating always-on-top player earns its ownership problem, and the
  window it came from minimizes rather than closes so there is something for
  it to belong to. It is a button rather than a setting because a browser only
  grants that window in answer to a click inside the page.
* **One mini player, serialised in the worker** — requests queue behind each
  other there, so a double-click cannot race two windows into existence; the
  second either focuses the window already showing that video or replaces what
  is in it.

## Project structure

```text
.
├── docs/               # Chrome Web Store listing copy
├── imgs/               # Logos and store promo banners — repo and listing only, not packaged
├── scripts/package.sh  # Builds the Web Store zip from an allow-list
├── fonts/              # Inter, bundled (woff2 + OFL licence) — no CDN
├── icons/              # Extension icons (48px, 128px) and button glyphs
├── sounds/             # popup-click.mp3, video-saved.mp3
├── background.js       # Service worker: opens and serialises the mini player window
├── content.js          # Saving, title extraction, type detection, backfill, HUD
├── content.css         # In-page HUD and injected button styles
├── detach.js           # Detached mini player (Document Picture-in-Picture)
├── detach.css          # Mini player window styling
├── popup.html/.css/.js # The list: thumbnails, tags, search, filters, drag reorder,
│                       # add by link, import/export, settings
├── wiki.html/.css/.js  # Built-in user guide, opened from Settings
├── url-utils.js        # Shared URL parsing and validation
├── manifest.json       # Manifest V3 configuration
└── README.md
```

## Contributing

Issues and pull requests are welcome — refactors, new features, or sharper
selectors for YouTube's ever-changing DOM. Fork it and open a PR.

## License

MIT. See [LICENSE](LICENSE).

The bundled **Inter** typeface is © The Inter Project Authors, licensed under
the SIL Open Font License 1.1 — see [`fonts/OFL.txt`](fonts/OFL.txt).

---
<div align="center">
  <b>Built with ❤️ by <a href="https://github.com/adaddariodev">adaddariodev</a></b>
</div>
