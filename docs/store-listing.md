# Chrome Web Store listing — Watch Later Enhanced

Copy for the Chrome Web Store developer dashboard. Plain text: the store
renders no Markdown, so the version below is written to read well as-is.

---

## Short description (132 characters max)

```
Save any YouTube video with Alt + left click. Favourite it, tag it, watch it in a pinnable floating player. 100% local.
```

*(119 characters, leaving room under the 132 limit.)*

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

▸ FIND IT AGAIN IN ONE KEYSTROKE
  Search looks at video titles and at your own tags at the same time. Click a
  channel name to see everything you saved from it. Give videos colour-coded
  tags for the things their titles don't say.

▸ YOUR ORDER, NOT AN ALGORITHM'S
  Drag and drop to prioritise your queue.

▸ KNOW WHAT YOU SAVED
  Every item shows whether it is a Video or a Shorts, and which channel it
  came from. One click narrows the list to either kind.

▸ SOUNDS ON YOUR TERMS
  A small mixer: set the volume of each sound with a slider or by typing a
  number, mute one of them, or switch the lot off.

▸ MAKE IT LOOK HOW YOU WANT
  Tags and the channel highlight take their colour from one setting: a colour
  per name, worked out from its letters — or one neutral grey for everything,
  or a single colour you give it as a HEX code. A Glass slider turns the
  cards, the toolbar and the settings panel into frosted panes over a lit
  backdrop, as strong or as subtle as you like. And the popup sizes itself to
  your screen, so a large monitor shows more without a small laptop
  overflowing.

▸ TO WATCH, ARCHIVE, TRASH
  Finished videos leave your queue without disappearing. Deletions can be
  undone.

▸ A GUIDE THAT'S ALREADY INSTALLED
  A searchable user guide ships inside the extension, with every shortcut
  explained. It works offline. Next to it, a link to the release notes, and
  the version you're running.


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

  Alt + left click          Save a video
  Alt + Shift + left click  Play a video in the mini player — on a thumbnail,
                            or on the player itself to pop out what you're
                            watching
  /                    Open the search box in the extension popup
  Space or K           Play / pause              (in the mini player)
  Left / Right         Skip 5 seconds            (in the mini player)
  M                    Mute                      (in the mini player)
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
* The feature list is kept in the order the popup shows things, so a reader
  comparing the two is never hunting. If a section moves in the UI, move it
  here too.
* "Talks to nobody but YouTube" is true as of 2.7.2 and is enforced by the
  extension's own CSP (`style-src 'self'; font-src 'self'`). Anything that
  later adds a CDN, an analytics snippet or a remote webfont has to come out
  of this copy at the same time.
