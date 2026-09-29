# Chrome Web Store listing — Watch Later Enhanced

Copy for the Chrome Web Store developer dashboard. Plain text: the store
renders no Markdown, so the version below is written to read well as-is.

---

## Title (75 characters max)

Read from `name` in `manifest.json` — the dashboard shows it as the title
"from the package", and a new one takes effect with the next uploaded version.

```
Watch Later Enhanced: Save YouTube Videos & Mini Player
```

*(55 characters.)* The brand first, so existing users and ratings still
recognise it, then what it does in the words people search for. No more than
that: the store's policy counts keyword-stuffed titles against a listing.

---

## Short description (132 characters max)

Read from `description` in `manifest.json`, like the title.

```
Save any YouTube video with Alt + left click or its link. Tag it, sort it, back it up, and watch in a floating mini player.
```

*(123 characters, under the 132 limit.)*

---

## Detailed description

```
Save any YouTube video with one gesture — then actually watch it.

YouTube's own "Watch Later" takes three clicks and a page you didn't want to load, and the list only works on YouTube. Most videos saved that way are never seen again.

Watch Later Enhanced replaces all of that with Alt + left click.


HOW IT WORKS

1. Hold ALT and LEFT-CLICK any YouTube video — a thumbnail, or the player itself.
2. It's saved instantly. No new tab, no dropdown, no page reload.
3. Open the extension from your toolbar, on any website, and watch it.

Add SHIFT to that same click and the video plays in a floating mini player
instead, without opening it.


WHAT YOU GET

▸ INSTANT SAVING
  Alt + left click anything on YouTube. A small on-screen confirmation shows the
  video's real title. You never leave the page you were on.

▸ SAVE FROM A LINK, TOO
  Someone sent you a video? Copy the link, open the extension and paste it
  anywhere on your list — done. Any YouTube link works: youtube.com, youtu.be
  from the Share button, Shorts, live streams, the mobile site. There is also a
  box that shows the video's thumbnail before you add it, so a wrong link is
  caught straight away.

▸ SEE WHAT YOU SAVED
  Every video in your list shows its thumbnail, the channel that published it,
  and a Shorts label when it is one. Click the picture to open the video.

▸ A MINI PLAYER YOU CAN PIN ON TOP
  Pop any video out of the browser into its own window. Minimize the browser,
  switch to another app, drag the window wherever you want — it keeps playing.
  Pin it and it stays above everything else on screen. Play, pause, seek and
  mute from the keyboard.

  You don't have to open a video first. Anywhere a thumbnail appears — the
  home page, a search, a channel, the sidebar of another video — three ways
  send it straight to the mini player: ALT + SHIFT + CLICK it, pick "Play in
  mini player" from the video's own menu, or use the button that appears when
  you hover it.

▸ FIND IT AGAIN IN ONE CLICK
  All your tags sit in one bar above the list, most used first: click one to
  see only those videos. Search looks at video titles and your tags at the same
  time. Click a channel name to see everything you saved from it.

▸ FAVOURITES
  Mark the ones worth coming back to with a heart, and show only those with
  one click. It narrows whatever you are already looking at, so you can see
  your favourite Shorts, or your favourites tagged "music".

▸ YOUR ORDER, NOT AN ALGORITHM'S
  Drag and drop to prioritise your queue — and your Archive, which keeps an
  order of its own. Every card shows its number and takes its new one the
  moment you move it.

▸ TO WATCH, ARCHIVE, TRASH
  Finished videos leave your queue without disappearing. Deletions can be
  undone.

▸ BACK UP AND MOVE YOUR LIST
  Export your whole list to a file, and import it on another computer or in
  another browser. Importing only ever adds — nothing already on your list is
  changed or removed — and one click undoes it. A plain list of links works
  as an import too.

▸ SOUNDS ON YOUR TERMS
  A small mixer: set the volume of each sound with a slider or by typing a
  number, mute one of them, or switch the lot off.

▸ MAKE IT LOOK HOW YOU WANT
  Tags and the channel highlight take their colour from one setting: a colour
  per name, one neutral grey for everything, or a single colour you choose. A
  Glass slider turns the popup into frosted panes over a lit backdrop. And the
  popup sizes itself to your screen, so a large monitor shows more without a
  small laptop overflowing.

▸ A GUIDE THAT'S ALREADY INSTALLED
  A searchable user guide ships inside the extension, with every shortcut
  explained and step-by-step examples for import and export. It works offline.


WHY THIS ONE

▸ TRULY PRIVATE
  No account. No sign-in. No tracking. No cloud. Your list is stored on your
  own machine and never sent anywhere. The extension talks to nobody but
  YouTube — not even for a font. Thumbnails come from YouTube's own image
  server and are cached by your browser; switch them off in Settings and the
  popup makes no request at all.

▸ ONE PERMISSION
  The extension asks for "storage" and nothing else. It cannot read your tabs
  or your browsing history, because it never asks to.

▸ GENUINELY LIGHTWEIGHT
  Zero dependencies, no frameworks, no background polling. Thumbnails are the
  smallest size YouTube offers and load only for what is on screen. It stays
  out of your browser's way.

▸ OPEN SOURCE
  Every line is public and auditable. Nothing is hidden.


SHORTCUTS

  Alt + left click          Save a video
  Alt + Shift + left click  Play a video in the mini player — on a thumbnail,
                            or on the player itself to pop out what you're
                            watching
  Ctrl / Cmd + V            Paste a YouTube link onto your list to save it
  /                         Open the search box in the extension popup
  Space or K                Play / pause              (in the mini player)
  Left / Right              Skip 5 seconds            (in the mini player)
  M                         Mute                      (in the mini player)
  Esc                       Close the mini player


Source code and issue tracker:
https://github.com/adaddariodev/Watch-Later-Enhanced-webplugin

Built and maintained by one developer. If it saves you time, you can support it
at https://ko-fi.com/adaddariodev — entirely optional, and nothing is locked
behind it.
```

---

## Notes for whoever updates the listing

* The store strips Markdown. Keep the plain-text layout above — the `▸` marks
  and indentation are what give it structure there.
* Keep the permissions claim accurate: if a future version adds a permission,
  the "one permission" line has to change with it.
* The feature list is kept in the order the popup shows things, so a reader
  comparing the two is never hunting. If a section moves in the UI, move it
  here too.
* "Talks to nobody but YouTube" is true as of 3.1.0: the only hosts are
  youtube.com (from YouTube tabs) and i.ytimg.com, YouTube's image server, for
  thumbnails — which can be switched off, and the copy says so. Fonts and
  styles are kept local by the extension's own CSP (`style-src 'self';
  font-src 'self'`). Anything that later adds a CDN, an analytics snippet or a
  remote webfont has to come out of this copy at the same time.
* The detailed description has a 16,000-character limit; this one is far
  under it.
