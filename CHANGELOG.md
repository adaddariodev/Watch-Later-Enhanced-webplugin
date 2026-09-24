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

The settings panel was a long scroll. Sound, the mixer, the mini player, the
JobsMatch banner and the supporter code now sit together under one
**Settings** section that opens on click and stays shut otherwise. Its closed
header names anything you have switched off or changed, so folding it away
hides controls rather than information. The user guide stays outside, in plain
sight — it is not a setting.

### 🎨 Calmer labels

The **Shorts** label was red and the **Video** one grey, which made a list of
Shorts look like a list of warnings. Both are now the same quiet slate: the
word tells you which is which, and the colour is left to your own tags.

Scrollbars, in the popup and in the guide, go from a solid grey bar to a
hairline that firms up as you reach for it — still easy to grab, far quieter
when you are not using it.

### 📐 Room for the list

Nearly half the popup was taken up before the first video began. Two changes
give 45px of it back — about half a video more on screen, and the same again
every time you scroll, since that strip stays pinned to the top.

* **The search box folds away.** It was the tallest single thing in the popup
  and empty almost always. It is now a magnifying glass at the end of the
  filter row; clicking it — or pressing `/` — unfolds the box underneath,
  below the filters, so nothing that was already on screen moves. `Esc` gives
  it back. It never folds while it is filtering: if you searched for something,
  or clicked a tag, the box stays open with the text in it, so the list is
  never quietly filtered by something you cannot see.
* **Titles get their width back.** The row of buttons on each card is now two
  shorter rows — what plays the video beside the title, what files it away on
  the line below, level with the pills. The title has about 100px more to work
  with, so far fewer of them are cut short.

### 🪟 One mini player, and it outlives the page it came from

Two fixes to the same root: opening the mini player from a video page did not
open a window at all. It handed that page's live player to a floating player
**owned by the tab** — so closing the tab closed the mini player with it, and
the only way to have one that survived was to pin it first.

It opens a window of its own now, exactly like every other way in. Close the
page, close the tab, navigate away: the mini player stays, and **Pin on top**
still puts it above everything when you want that.

* **The page you opened it from stops playing.** It used to keep going, so you
  had two soundtracks with one of them coming from a window you could not see.
  A tab showing the same video stops too, wherever you opened the mini player
  from.
* **There is only one mini player.** Asking for the video already in it brings
  that window forward; asking for another puts it in the same window, instead
  of leaving a trail of windows all playing at once.
* It **picks the video up where the page had got to** rather than starting it
  again.

What is given up is the hand-off: the window loads the video rather than
receiving the one already decoded, so it chooses its own quality and any
captions you had switched on need switching on again. A player that dies with
the tab it came from is not worth that.

### 🔎 Search the titles too, and click a channel to filter by it

The search box looked only at tags, which meant a video was findable only if
you had thought to tag it. It now matches the **title** as well — the other
thing anyone remembers about something they saved.

**Channel names under each video are now clickable**: one click and the list
is only what you saved from that channel, and a click on the lit one takes the
filter off again. It stays lit for as long as the filter holds, in a colour the
channel's own name decides — the same way a tag gets its colour, so the same
channel is the same colour every time.

Clicking a channel or a tag writes what it did into the search box —
`channel:Fireship`, `tag:music` — rather than filtering behind it. You can type
those yourself, edit them, or clear them like any other search. They match the
whole name, so `channel:Lofi` does not also bring in *Lofi Girl*.

### ⚡ Long lists open at once

The popup used to build every saved video before it would show you any of
them. With a thousand-odd videos that was two seconds of empty popup, and
half a second again every time anything changed — a heart, a filter, a
keystroke — to draw a column 135,000 pixels tall into a window 400 tall.

It now draws what fits and the rest as you scroll. A big list opens in about
a quarter of a second, and it keeps your place: marking something a favourite
halfway down the list leaves you exactly where you were.

One thing did change on purpose: **changing a filter, or searching, takes you
back to the top**. You were previously left at whatever height you happened to
be at, inside a list you had not seen the top of.

### ▶️ One gesture for the mini player: `Alt` + `Shift` + click

`Alt` + click saves a video. **`Alt` + `Shift` + click plays it in the mini
player** — and it now means that everywhere, which it did not before.

* On a **thumbnail or its title**, anywhere one appears: the home page, a
  search, a channel, the sidebar of another video. The video plays in the mini
  player without being opened.
* On the **player itself**, where it hands the live player over to a floating
  window — your position, the captions, the quality you picked all come with
  it. Again, and the video goes back.

**`Alt` + `Shift` + `D` is gone.** It did only the second of those, and having
a key for one case and a click for the others was two things to remember for
one feature. The keyboard is one way short as a result; everything it did is a
click away, and the mini player's own keys are unchanged once it is open.

There is also a third way in that asks nothing of a gesture: **Play in mini
player** is now the first item in the **⋮ menu** on every video, beside "Save
to Watch Later". The row is a copy of one of YouTube's own, so it looks and
now highlights like the menu it sits in.

### 🐛 The thumbnail button only worked on watch pages

The button that plays a video in the mini player straight from its thumbnail
was wired up only on a video page, so it appeared in the sidebar beside a
video you were already watching and nowhere else — not on the home page, not
on a channel, not in search. It is on every page with thumbnails now.

Three other things were keeping it from showing even where it was wired:

* It only recognised thumbnails by the names of the components YouTube builds
  its pages out of, which differ per surface and change without notice. It now
  recognises them by what they are: a link to a video, the size and shape of a
  picture.
* YouTube starts playing a preview over the thumbnail about a second after you
  get there, and every pointer event after that comes from inside that
  preview — so the button vanished exactly as you reached for it. It now finds
  the video underneath whatever YouTube has floated on top.
* Scrolling took the button away until the mouse was moved again, which
  included the scroll a page does to bring a video into view. It follows the
  thumbnail instead, and goes when the thumbnail does.

It has also moved to the **top-left** of the thumbnail. It was sitting on top
of YouTube's own Watch later and Add to queue buttons, which are top-right on
the same hover — covering what they are and making them unclickable.

### 🧹 Lighter on the page it is a guest on

* The extension had an **`unload` listener** on every YouTube page. A page with
  one cannot be kept in the browser's back/forward cache, which turns every
  Back out of a video into a full page load instead of an instant restore. The
  teardown it was doing has its own modern event, `pagehide`, which costs the
  page nothing.
* Filling in the details of older saves now waits for the browser to be
  **idle** rather than for a fixed four seconds, so it cannot land in the
  middle of a video starting.
* The hit test that keeps the thumbnail button visible under YouTube's preview
  ran on **every frame** the pointer moved. It measures 250µs on a page the
  size of a scrolled home page; it now runs eight times a second instead of
  sixty, which is still far more often than anyone can react to.

### 🎨 Your colours, your way

Tags and the lit channel pill used to pick their colours for you, and that was
that. There is now a **Styling** section in Settings with four answers:

* **Random** — the default, unchanged: a colour per name, worked out from its
  letters, so a tag is always the same colour and always the same colour for
  everybody.
* **Muted** — no colour at all. One neutral for everything, like the rest of
  the popup.
* **Monotone** — greyscale, but a shade per name, so two tags on a row are
  still two tags.
* **Static** — one colour everywhere, the one you type in as a HEX code or
  pick from the swatch. Choose a light one and the lettering turns dark by
  itself, so a pale yellow tag is still readable.

The choice covers everything the extension colours in, now and later — it is
one setting rather than one per coloured thing.

### 🫥 A popup you can see through

Under the same section, a **Transparency** slider lets the browser show
through the popup's background. What it does *not* touch is anything carrying
text: the header, the filters, the video cards and the settings panel stay
solid, so turning it up never costs you a word. It stops at 90% for the same
reason.

### 📏 A popup the size of your screen

The popup was 500px tall on every machine — a third of a large screen, and
most of a small laptop. It now takes about three quarters of whatever height
the screen has spare, between 400px and the 600px the browser will draw: more
videos before you scroll on a desktop, and nothing overflowing on a tablet.

### 🗂 A tidier Info & Settings

* The **supporter code** card is half the size it was: it lost a heading, a
  line of explanation and a permanently blank status row, and moved inside the
  Settings section with everything else you can change.
* Next to the user guide, in the same card, a **What's new** link to the
  releases on GitHub, for when you want to know what a version changed.
* The credits at the bottom are two lines instead of four, and they now print
  the **version you are running** — read from the extension itself, so it can
  never disagree with what you have installed.

### ✨ Smaller things

* **One icon for the mini player.** The three buttons that open it — in
  YouTube's control bar, on a thumbnail, on a saved video — were carrying two
  different glyphs, and neither said "mini player". They now share one: a
  player floating in front of a window, with a play symbol in it. It also
  reads clearly at the size a thumbnail button uses, where the old one turned
  into a smudge, and it is deliberately unlike YouTube's own miniplayer icon
  sitting a few pixels away in the same control bar.
* The favourites toggle now matches the type chips it sits with, and the whole
  set — chips, favourites, search — is centred rather than pushed to the edges.
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
