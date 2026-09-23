# Chrome Web Store listing — Watch Later Enhanced

Copy for the Chrome Web Store developer dashboard. Plain text: the store
renders no Markdown, so the version below is written to read well as-is.

---

## Short description (132 characters max)

```
Save any YouTube video with Alt+Click. Favourite it, tag it, and watch it in a pinnable floating player. 100% local.
```

*(115 characters, leaving room under the 132 limit.)*

---

## Detailed description

```
Save any YouTube video with one gesture — then actually watch it.

YouTube's own "Watch Later" takes three clicks and a page you didn't want to load, and the list only works on YouTube. Most videos saved that way are never seen again.

Watch Later Enhanced replaces all of that with Alt + Click.


HOW IT WORKS

1. Hold ALT and left-click any YouTube video — a thumbnail, or the player itself.
2. It's saved instantly. No new tab, no dropdown, no page reload.
3. Open the extension from your toolbar, on any website, and watch it.

Add SHIFT to that same click and the video plays in a floating mini player
instead, without opening it.


WHAT YOU GET

▸ INSTANT SAVING
  Alt + Click anything on YouTube. A small on-screen confirmation shows the
  video's real title. You never leave the page you were on.

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

▸ FAVOURITES
  Mark the ones worth coming back to with a heart, and show only those with
  one click. It narrows whatever you are already looking at, so you can see
  your favourite Shorts, or your favourites tagged "music".

▸ TAGS AND SEARCH
  Give videos colour-coded tags and find them again in one keystroke.

▸ YOUR ORDER, NOT AN ALGORITHM'S
  Drag and drop to prioritise your queue.

▸ KNOW WHAT YOU SAVED
  Every item shows whether it is a Video or a Shorts, and which channel it
  came from. One click narrows the list to either kind.

▸ SOUNDS ON YOUR TERMS
  A small mixer: set the volume of each sound with a slider or by typing a
  number, mute one of them, or switch the lot off.

▸ TO WATCH, ARCHIVE, TRASH
  Finished videos leave your queue without disappearing. Deletions can be
  undone.

▸ A GUIDE THAT'S ALREADY INSTALLED
  A searchable user guide ships inside the extension, with every shortcut
  explained. It works offline.


WHY THIS ONE

▸ TRULY PRIVATE
  No account. No sign-in. No tracking. No cloud. Your list is stored on your
  own machine and never sent anywhere. The extension talks to nobody but
  YouTube — not even for a font.

▸ ONE PERMISSION
  The extension asks for "storage" and nothing else. It cannot read your tabs
  or your browsing history, because it never asks to.

▸ GENUINELY LIGHTWEIGHT
  Zero dependencies, no frameworks, no background polling. It stays out of your
  browser's way.

▸ OPEN SOURCE
  Every line is public and auditable. Nothing is hidden.


SHORTCUTS

  Alt + Click          Save a video
  Alt + Shift + Click  Play a video in the mini player, without opening it
  Alt + Shift + D      Open / close the floating mini player
  Space or K           Play / pause
  Left / Right         Skip 5 seconds
  M                    Mute
  Esc                  Close the mini player


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
* "Talks to nobody but YouTube" is true as of 2.7.2 and is enforced by the
  extension's own CSP (`style-src 'self'; font-src 'self'`). Anything that
  later adds a CDN, an analytics snippet or a remote webfont has to come out
  of this copy at the same time.
