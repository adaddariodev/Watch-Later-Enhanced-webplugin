# Changelog

All notable changes to **Watch Later Enhanced**.
The top entry is written to be pasted straight into a GitHub Release.

---

## v2.7.0 — mini player, Shorts, and a built-in guide

### 🪟 Watch anywhere: the detached mini player

Any video can now be popped out of the browser into its own floating window.
Minimize the browser, switch to another app, drag the window wherever you
like — the video keeps playing.

* A **mini-player button** sits in YouTube's own control bar, next to the
  familiar ones. `Alt + Shift + D` does the same thing.
* From the popup, the mini-player button on any saved video **starts playing it
  straight away**, in a small window of its own. No new tab, nothing to
  confirm.
* While it is detached: `Space` or `K` to play and pause, `←` `→` to skip five
  seconds, `M` to mute, `Esc` to close. There is also a plain **✕** in the
  top-right corner.
* Closing the window — or clicking away to another video — puts the player back
  exactly where it was, still playing.

It moves YouTube's *real* player into the new window, so captions, quality,
speed and the "skip ad" button all keep working. You can switch the whole
feature off in Settings.

### 🎬 Videos and Shorts, told apart

* Every saved item now carries a **Video** or **Shorts** label under its title.
* Three chips under the search box narrow the list to **All**, **Videos** or
  **Shorts**, each with a count. Your choice is remembered.
* **Shorts save under their own title again.** They used to come in as
  "YouTube", because a Short does not put its title where a normal video does.
* Saving a Short from a normal `/watch` link — from search, from a channel
  page, from a link someone sent you — is recognised correctly. Nothing on such
  a page says it is a Short, so the extension checks with YouTube in the
  background and puts the label right a moment later.
* **Items saved before this version get sorted out on their own.** They had no
  type at all, so they all read as videos and the Shorts filter could not find
  them. They are now worked through quietly in the background while you browse
  YouTube — no re-saving, nothing to click.

### 📖 A user guide, built in

Settings has a new **User guide** button (the book icon). It opens a full
documentation page that ships inside the extension: searchable, with a table of
contents that follows you as you scroll, every shortcut listed, and a
troubleshooting section. It works offline and opens instantly.

### 🔒 It no longer talks to Google

The popup used to fetch its typeface from Google Fonts every time you opened
it — which meant an extension whose whole point is that nothing leaves your
machine was quietly announcing to a third party that you had opened it, and
when. The font now ships inside the extension.

Opening the popup, or the guide, now makes **no network request at all**, and
the extension's own security policy enforces it. The only requests it ever
makes are to YouTube, while you are on YouTube, to read a video's title and to
tell a Short from a video.

### ✨ Smaller things

* Buttons have clearer icons — each one now looks like what it does.
* The Settings panel no longer outgrows the popup, and closes with `Esc` or by
  clicking outside it.
* A new, crisper click sound.
* The empty "How to use" card no longer flashes when the popup opens.
* Long titles get more room: the type label sits under the title rather than
  pushing into it.

### ☕ For people who tip

Ko-fi's automatic thank-you message includes a short code. Paste it in
**Settings** for a small extra — a quiet thank-you for keeping an open-source
tool alive, not a paywall.

Still 100% local and private — no accounts, no tracking. Your list stays on
your machine.

---

## v2.6.1 — sturdier saves, watch-page button, safer links

### 🛡 More reliable list

Saving, archiving, and deleting now fight less with YouTube's own page and with
each other.

* Opening a saved item only happens for real YouTube links.
* Alt+Click and the popup no longer overwrite each other if you tidy the list
  while saving.
* Archive / To Watch toasts tell the truth if a save fails.
* Permanent delete from Trash asks first.
* If browser storage is full, you get a clear message instead of a silent fail.

### 📺 YouTube coverage

* Works on more YouTube hosts, including mobile.
* The in-page Save button comes back after YouTube's in-app navigation.
* Shorts-style pages use the same strict video-ID checks as a normal watch page.
