# Changelog

All notable changes to **Watch Later Enhanced**.
The top entry is written to be pasted straight into a GitHub Release.

---

## v2.7.2 — favourites, pin the player, and see who published what

### ❤️ Favourites

Every saved video has a **heart**. Fill it in for the ones worth coming back
to, and the toggle beside the type chips shows only those — with a count of
how many it would leave.

It is not a fourth kind of video: it narrows whatever you are already looking
at, so you can ask for your favourite Shorts, or your favourites tagged
*music*, without giving up either filter.

### ▶️ The mini player, without opening the video first

Hover any thumbnail on YouTube — the home page, a search, a channel, the
sidebar — and a small button appears in its corner. One click and that video
plays in the mini player, with nothing opened and nothing navigated away from.

It is a single button that follows your pointer rather than one planted in
every thumbnail: YouTube builds and destroys those by the hundred as you
scroll, and anything left inside them is torn out again seconds later.


### 📌 Keep the player on top of everything

The mini player opened from the extension survives minimizing the browser, but
it still slipped behind other windows. It now has a **Pin on top** button in
its corner: one click and it floats above every other application, whatever you
are doing underneath.

The button is there because it has to be — a browser only grants an
always-on-top window in response to a click inside the page, so nothing can do
this for you automatically. Opening the mini player from a video page, with
`Alt + Shift + D` or the button in YouTube's control bar, has always given you
the floating kind directly.

While the video is pinned, the window it came from **gets out of the way**: it
minimizes itself, so only the floating player is on screen, and comes back
exactly as you left it — maximized if that is how you had it. It cannot simply
close: a floating player belongs to the window that opened it, and would go
down with it.

It comes back **without interrupting you**. A player that closes because you
asked — `Esc`, or the browser's own buttons on that window — brings its window
up with it. One that
closes on its own, because autoplay moved to the next video, quietly hands the
video back without pulling you out of whatever you were working in.

### 🪟 Both ways in, one mini player

The floating player opened from a video page now **says it is pinned**, with a
badge beside its title. It always floated above other windows; nothing said so,
which made it look like the one feature the video-page button was missing. Both
windows now carry the video's title, and the same bar, so the two ways in look
like one feature rather than two.

That bar is also **lighter than it was**. The browser draws the floating window
with its own small title bar, which already carries a close button and a way
back to the tab — and Watch Later Enhanced was drawing its own copies of both
directly underneath. They are gone. What is left over the video is the title
and the Pinned badge, and both fade away while you watch, leaving nothing but
the picture.

### 📺 The channel, next to the title

Every saved item now shows **who published it**, on the line under its title
beside the Video / Shorts label. Long channel names are shortened with the full
one on hover.

Your own tags have moved to a line of their own underneath, so what YouTube
says about a video and what you called it no longer compete for the same row.
Videos with no tags take up no more space than before.

Items you saved before this version get their channel filled in quietly in the
background while you browse YouTube — the same way older items got their type
in 2.7.0. Nothing to click, no re-saving.

### 🔊 A mixer for the sounds

Settings now has a small mixer. Each sound — the **click** in the popup and the
**save** on YouTube — has its own switch and its own level, set by dragging the
slider or typing a number beside it. Mute one and keep the other, or switch
everything off with **All sounds**. Muting remembers the level you had, so
switching a sound back on sounds the way it did.

Both sounds **play back as you set them**, at the level you are setting, so you
are not choosing a number blind and finding out later.

### 🗂 Settings that fold away

The settings panel was a long scroll. Sound, the mixer, the mini player and
the JobsMatch banner now sit together under one **Preferences** section that
opens on click and stays shut otherwise. Its closed header names anything you
have switched off, so folding it away hides controls rather than information.
The user guide and the supporter code stay where they were, in plain sight.

### 🎨 Calmer labels

The **Shorts** label was red and the **Video** one grey, which made a list of
Shorts look like a list of warnings. Both are now the same quiet slate: the
word tells you which is which, and the colour is left to your own tags.

Scrollbars, in the popup and in the guide, go from a solid grey bar to a
hairline that firms up as you reach for it — still easy to grab, far quieter
when you are not using it.

### ✨ Smaller things

* **Titles get their width back.** The row of buttons on each card is now two
  shorter rows — what plays the video beside the title, what files it away on
  the line below, level with the pills. The title has about 100px more to work
  with, so far fewer of them are cut short.
* The favourites toggle now matches the type chips it sits with, and the whole
  set is centred under the search box instead of being pushed to either edge.
* The **JobsMatch** strip reads better: its line sits beside the arrow it
  points at instead of trailing the logo across an empty gap.
* A number typed above the maximum in the mixer is corrected on screen, not
  only in the setting behind it.
* The guide gained a troubleshooting entry for the commonest confusion after
  an update: a YouTube tab that was already open keeps running the old version
  until you reload it, which makes a setting look like it is being ignored.

### 🐛 Fixed

* Titles never resolved on **m.youtube.com**: the lookup asked
  `www.youtube.com` outright, which the browser blocks from the mobile site.
* On a Shorts feed, the channel could be read from a neighbouring reel rather
  than the one playing — the same mistake titles used to make.

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
  seconds, `M` to mute, `Esc` to close.
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
