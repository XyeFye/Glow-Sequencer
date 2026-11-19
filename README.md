# Glow Theme for Online Sequencer

A sleek dark theme with a glowing accent color for onlinesequencer.net. Works in Opera (and any Chromium browser: Chrome, Edge, Brave).

## Install in Opera

1. Unzip `onlinesequencer-glow.zip` somewhere you'll keep it (for example `Documents/onlinesequencer-glow`). Don't delete the folder afterwards — the browser loads the theme from it.
2. In Opera, go to `opera://extensions` (paste that into the address bar).
3. Turn on **Developer mode** (toggle in the top-right).
4. Click **Load unpacked** and pick the `onlinesequencer-glow` folder (the one that contains `manifest.json`).
5. Open or refresh onlinesequencer.net. Done.

To pick a different accent color, click the extension's icon in the toolbar. If you don't see it, click the little cube/puzzle icon on the right of the address bar and pin "Glow Theme for Online Sequencer".

## Backups & updates

Open **⟲ Backup & updates** in the extension popup.

- **Your data is backed up automatically** — once a day, a few minutes after your Sequence library changes, and right after every update — to `Downloads/Glow Theme backup/glow-backup.json` (one file, replaced each time). It holds your settings, the Sequence library with its version history and pictures, and your comment index. It never holds the account switcher's saved sign-ins: those stay inside the extension. **Save a copy somewhere else…** puts one wherever you like (OneDrive, a USB stick).
- **Bringing it back**: a fresh install opens the Backup & updates page by itself. **Find my last backup** looks in this browser's downloads list (turn on *Allow access to file URLs* for Glow Theme and it opens the file for you; otherwise choose it). **Choose a backup file…** takes one from anywhere — on a new computer, copy the file over first. Restoring only adds what's missing; nothing you have is removed.
- **Updating keeps your data** as long as you update the files in the same folder (or use one of the ways below). Removing the extension in Opera deletes its data — restore a backup afterwards.
- **Automatic updates.** The extension notices when newer files land in its folder and reloads itself into them within a minute or two. The files can arrive three ways:
  - **GitHub**: set `"repo": "your-name/your-repo"` in `update.json`, then double-click `updater/Install auto-updates.cmd` once on each computer. It checks GitHub every hour (and when you sign in to Windows) and copies a newer version in. `Remove auto-updates.cmd` turns it off. With a repo set, the extension also checks GitHub itself and shows a notice on Online Sequencer when a newer version is out.
  - **OneDrive**: keep the extension folder inside your OneDrive folder and load it from there on each PC. When OneDrive syncs new files, the extension reloads itself.
  - **Opera add-ons store**: a copy installed from the store is updated by Opera (its backups and restore work the same).
- Versions before 2.54.0 don't have any of this: update them once by hand (copy the new files over the old folder and press reload on the extensions page), and they keep themselves current from then on.

## What it changes

- Deep dark background with an accent glow; the blue header becomes dark + glassy
- Toolbar icons glow on hover; the active tool (draw/edit/erase) lights up in the accent color
- Play button, playhead, selection box, timeline markers and slider knobs all use the accent
- Instrument panel, dropdowns, popups and dialogs are themed to match (the light grey menus are gone)
- "Enabled" effect buttons use the accent instead of orange
- Optional (in the popup): hide ad banners, dim the note grid, turn animations off

## Tools tab

**Tools** and **Settings** entries are added to the site's top navigation. It opens a panel with three tabs:

- **BPM** — tap tempo (click or press T), detect the tempo of an imported track (the Track-tab reference track or the site's "Add Audio Track" file), or of any audio file. "Apply to sequence" sets the editor's BPM.
- **Key** — find the key of the sequence you have open, of an imported track, or of an audio file. Shows the best match, alternatives, and a pitch-class chart.
- **Chords** — generate a chord progression in any key (defaults to your sequence's key): pick a preset (Pop I–V–vi–IV, 50s, Emotional, Royal road, Canon, Epic, Andalusian, Jazz ii–V–I, Lo-fi, 12-bar blues) or hit **Randomize** for a new progression that follows common chord movement. Click any chord to swap it for another that fits. Choose triads / 7ths / add9 / sus, rhythm (held, two hits, 8th pulse, off-beat, arpeggios, strum), voicing (smooth voice-leading, close, open, wide), register, chords per bar and an optional bass note. The chords show on the piano roll as a dashed preview with their names; **▶ Hear it** plays them on the current instrument, **Add to sequence** turns them into real notes (one Ctrl+Z undoes it).
- **Stems** — split a song into Vocals, Drums, Bass, Instruments, or Remove vocals. Two engines: **AI** (Meta's HTDemucs, runs on your GPU through WebGPU; all four parts come out of one pass, so switching parts is instant afterwards) and **Fast** (built-in signal processing, offline and instant but with more bleed; also has Lead / solo, Strength and Clean-up). Play the result, send it to the Track tab as a reference, or save it as a WAV.
- **Track** — import a song and push it onto the grid at a measure. On load it detects the song's BPM and time signature (3/4, 4/4 or 5/4) and sets the sequence to match so the measures line up with the audio (toggle "Auto-detect" off, or hit "Detect BPM & time sig" any time). Split it at any measure (or at the playhead — **Alt+S**) and move the pieces to other measures; clips also appear as a lane on the grid where you can click to select (Shift+click adds), drag (follows the sequencer's grid setting, just like notes — hold Alt to move freely) or double-click to split. **Shift+Alt+S** merges the selected clips: pieces that are still back-to-back are re-joined, anything else is rendered together exactly as placed (gaps and overlaps included). Plays in real time with ▶ and ignores BPM / tempo markers completely, so it never stretches or drifts. While a reference track is loaded the sequencer plays through to the end of its clips instead of looping back to measure 1 when your own notes run out. **Note guide**: tick "Show notes" — the default **AI** engine is Spotify's Basic Pitch note transcriber (the built-in pitch analysis is still there as **Fast**); to paint the track's detected pitches onto the piano roll, half-transparent, aligned with the clips. Pick what to show — Melody, Bass, Chords, Arpeggio or Everything — plus sensitivity, max-notes and opacity sliders. Pitches are scored by their whole overtone series (so a voice with a weak fundamental lands on the note you hear, not the octave above), overtones and sub-octaves are filtered out, quiet steps show nothing (Sensitivity sets how quiet), low notes are analyzed at a finer frequency resolution, and each detected note is drawn as its own bar — when the same key is played again right away, the repeat is drawn in a second color so you can see where it restarts. Melody looks at C3 and up and ignores the bass; Bass looks below C4. For the cleanest guide, isolate the part first in the Stems tab. Best on isolated stems — "Use as reference track" in the Stems tab turns it on automatically.
- **Settings** — the theme settings (style presets, accent color, tint & glow strength, options) live here on the page too; there's a Settings link in the top nav next to Tools.
- **Visualizer** — reacts to whatever the site is playing (press ▶ in the sequencer) or to an audio file you picked. Bars / Wave / Ring / Mirror modes, Intensity and Smoothing sliders, fullscreen button.

Drag the panel by its title bar; it remembers where you put it. The ⮞ button docks it into the editor's sidebar (next to the sequence's Info/Comments tabs); ⮜ pops it back out.

Audio files never leave your computer; all analysis runs in the browser.

## Layers

Click **Layers** in the top menu of the editor to open it as a tab in the sidebar (the same place as the chat). A short **Tips** drop-up at the bottom of the panel has the shortcuts. It organises the sequence into:

- **Instrument tracks** — every instrument that has notes shows up on its own. Click one to make it the current instrument. **M**, **S** and the lock are the site's own Mute, Solo and Lock (the same buttons as in the instrument settings), and the eye hides the track's notes from the grid (they still play).
- **Note groups** — select notes and press **Ctrl+G** (or "Group") to group them; **Ctrl+Shift+G** takes the selected notes out of their group. Click a group to select its notes. A group can be hidden, muted, soloed or locked on its own, and the **+** on a group adds the selected notes to it. Grouping and ungrouping can be undone with Ctrl+Z.
- **Selecting rows** — click a row to select it, **Shift+click** for a range, **Ctrl+click** to add or remove one (Esc or clicking anywhere else clears it). With rows selected, **Ctrl+G** puts them into a new group and **Ctrl+Alt+G** into a new folder (the "New folder" button does the same); **Ctrl+Shift+G** dissolves the selected groups / folders, moving what's inside up a level. Dragging one of several selected rows moves them all.
- **Folders and nesting** — groups and folders are both containers: either can hold tracks, groups and other folders, so they nest inside each other however you like (a group additionally holds its own notes). Drag any row to reorder; drop on the middle of a group or folder to put something inside (the ⋯ menu also has Move up / Move down / Move out / Move into…, plus New folder inside / New group inside). The ▸ arrow collapses or expands; an expanded group also lists which instruments its own notes are on (click one of those lines to select just those notes). Hiding, muting, soloing or locking a container applies to everything in it. Double-click, Enter or F2 renames (tracks too — that sets the instrument's name, like the name box in Instrument settings); right-click a row's icon (or press **Alt+I** with the row selected) for a colour picker right beside it — swatches, a custom colour, and for tracks a Default button; a track's colour is the instrument's real colour, so the notes on the grid change too. The ⋯ menu has rename, colour, select notes, and delete (keep the contents, or delete the notes too — Ctrl+Z brings them back).
- **Solo** — **S** on a group or folder plays only the soloed layers (several can be soloed at once; "Clear solo" at the top turns them all off). On an instrument track, S is the site's own instrument solo.
- **Thumbnail folder** — the site draws a sequence's thumbnail from its first measures, and thumbnail art is usually drawn with duplicated ("cloned") 8-Bit Square instruments or with silent notes. Any instrument whose notes are all in the first 7 measures and is either an 8-Bit Square duplicate or entirely silent (volume 0, or an instrument at volume 0 / muted) counts as art: its track is filed automatically into a "Thumbnail" folder (marked *auto*). Silent early notes on an instrument that also plays real notes go into a "Thumbnail notes" group inside it. New art is picked up as you draw it. Anything you drag back out stays out; dissolving or deleting the folder turns the whole thing off for that sequence, and "Find thumbnail art" in the ⋯ menu brings it back.
- **Download a layer** — the ⋯ menu on any track, group or folder has *Download as .wav* and *Download as .mp3*. Notes that are muted or locked (themselves, through a group or folder, or with the site's own instrument buttons) are left out of the audio.
- **Download everything at once** — the panel's ⋯ menu has *Download every top-level folder / group / track as .wav / .mp3*: each top-level item becomes its own file, exported one after another (the browser may ask to allow multiple downloads). Items that are muted or locked are skipped entirely; the same menu can stop a running batch. It renders through the site's own exporter with only that layer's notes, so markers and instrument effects apply as usual. The lead-in silence is kept (only the tail is trimmed) so layers exported separately line up with each other in a DAW. The file is named "*title* - *layer*".

Hidden notes are not drawn and can't be clicked or selected, but they still play. Muted groups and folders are silent in playback and in exports (a layer download ignores mute and solo and renders exactly that layer). Locked notes can't be selected or moved.

The site's sequence file has no room for any of this, so the layout is saved in this browser, per sequence (it follows the sequence when you save it under a new link). Groups remember their notes by position, pitch and instrument, so they come back when you reopen the sequence.

- **Volume & effects in the panel**: the sliders button on a track opens a mixer drawer under it — volume, pan, detune, reverb (on/off, type, amount), delay, distortion (on/off, type, amount), bitcrusher (on/off, depth, level) and EQ (on/off, low/mid/high) — all through the site's own instrument settings, so its instrument panel and the audio stay in step. On a folder or group the drawer edits every track inside at once; on a selected track it edits all selected tracks. Each slider drag is one undo step.
- **Half-visible when silenced**: notes of a muted track, group or folder are drawn at half strength on the grid, and so is everything outside a solo while anything is soloed (the panel rows dim the same way). You can solo several tracks, groups and folders at once; "Clear all solos" clears the site's instrument solos too.

### Add a song into this one
**＋ Add a song** in the Layers panel (or its ⋯ menu) adds another sequence to the one you're editing — from a `.sequence` file or a link to a sequence on the site. Nothing already here is replaced:
- Its instruments come with their own settings (volume, effects, colour, name).
- An instrument this song already uses isn't overwritten: the incoming part goes onto a **new copy (clone)** of that instrument, with the incoming settings, named after the song it came from (e.g. "Bass Guitar · TIME | pathway").
- Its per-instrument automation comes along on the same instruments; its tempo changes only if you tick *Use its tempo* (they'd change this whole song's speed).
- Put it at the start, at the playhead, or after the end of this song. **Ctrl+Z** takes the whole addition back out.
- Dropping a `.sequence` file onto an editor that already has notes asks whether to **add it** or **open it instead** (the site's usual replace).

In Layers, every song's tracks sit in a **folder named after the song**, and each added song gets its own folder beside it.

## Slide notes (FL Studio style)

Slide notes work the way they do in FL Studio's piano roll: a slide note is **silent**; it bends whatever note is already playing on its instrument to its own pitch, taking its own length to get there, and the bent note stays there (or follows the next slide note) until it ends. No extra instrument is made — the slide note sits on the same instrument as the note it bends.

- **Place one**: Shift+click an empty cell in Draw mode, or turn on the slide button next to the eraser and just click. Put it *over* a playing note of the current instrument, at the pitch the note should bend to; its length is the glide time. Chain several to bend a note step by step.
- Slide notes show a small triangle in their corner (red if nothing is playing under them), and the bent note shows its pitch path across the grid. Draw, move, resize, copy and undo them like any note.
- **Curves**: a slide note can glide linearly, ease in (slow start), ease out (fast start) or smoothly (S-curve). Shift+click a slide note to cycle through them, or pick one in its sheet; with several slide notes selected it applies to all of them.
- **Shift+right-click** a note for a small sheet: what a slide note bends, its curve, ▶ Preview, make it a normal note / a slide note, delete (acts on all selected notes of that kind).
- With the extension only the note under a slide is bent — notes placed next to it, after it, or sounding alongside it on the same instrument play straight.
- **With the extension**, playback bends each note's own voice (its detune is automated when it is scheduled), so nothing instrument-wide ever changes: stop mid-glide, preview a note, play the keyboard — all at normal pitch.
- **Without the extension** people see what the site stores: silent notes plus ordinary detune markers on the instrument (one where the glide starts, a blended one where it ends, one that resets the detune). Those markers are the "special marker" that makes a silent note a slide note — the site's own player performs the glide from them, and the extension reads slides back from them when a sequence is opened. The extension writes those markers but never plays from them.
- Without the extension detune is per instrument, so there other notes of the instrument sounding during the glide bend with it, and a curve is played as a few straight pieces (markers sit on sixteenths); the detune is put back the moment the bent note ends. The extension manages the detune markers only inside the span of a note that a slide bends; detune markers you place anywhere else on that instrument are yours and are left alone.
- **Saving**: a slide note is stored with a tiny signature volume (0.001; the curve is encoded in it), so after a save and reload it is still a slide note and its markers are rebuilt even if they were lost. Older slide notes (volume 0) are recognised by their markers and upgraded the first time the sequence is opened.

## Time signature changes

The site has one time signature for the whole sequence; this adds changes per bar.

- **Shift+right-click a bar number** in the timeline (or click the **♩** button at the right end of the timeline) for the time-signature sheet of that bar: beats / unit (2, 4, 8 or 16), and whether it applies to **this bar only**, to the **selected bars** (when notes are selected), or **from this bar onwards**. Apply, remove the change at that bar, or clear all. Every change is one undo step.
- With changes in place the timeline shows the real bars — their numbers and widths, with a small tag where a signature starts — and the grid gets a bar line at every bar start (highlighted where the signature changes). The loop end snaps to a real bar end and the metronome accents real downbeats. Notes themselves never move; the sixteenth grid is unchanged, so a 7/8 bar is simply 14 sixteenths wide.
- The map is kept in an ordinary **annotation note** on the grid that reads `Time signatures: 3 = 3/4, 7 = 7/8` (bar numbers as shown). That is what makes it save with the sequence; you can also edit that text by hand (or move the note), and people without the extension still see what the piece is doing. The sequence's own time signature applies until the first change.

## Account switcher

Switch between your Online Sequencer accounts in one click — from the little ▾ next to "Welcome back NAME" at the top of the site, or from the extension's popup.

- **Your account is saved automatically** the first time the extension sees you signed in. To add another: **▾ → Add account**. The page reloads signed out with the login fields open; sign in with the other account as usual, and it's saved too.
- **Switching** puts the other account's saved sign-in back and reloads the page (the browser will still warn you first if the editor has unsaved changes). Other open Online Sequencer tabs get a banner asking you to reload them before saving or commenting, since they still belong to the old account.
- **How it works:** the site keeps you signed in with cookies. While you're signed in, the extension keeps a copy of onlinesequencer.net's cookies for that account, in its own private storage (web pages and other extensions can't read it); switching swaps them and reloads, and Add account clears them so you can sign in to another account. Current Chromium browsers (Opera 138 included) no longer let extensions list a site's cookies, only read them by name, so the extension learns the names from the cookie headers your browser exchanges with onlinesequencer.net (names only — that's what the *webRequest* permission is for), plus the forum software's standard ones. They're never sent anywhere except back to onlinesequencer.net. **Passwords are never seen or saved** — you always sign in yourself.
- If something goes wrong, the switcher now says so on the page. **Copy troubleshooting info** in the popup copies what it sees — cookie *names* and flags only, never their values — so the problem can be looked at.
- If a saved sign-in stops working (you logged out on another device, changed the password…), switching notices, puts you back on the account you were using and marks that one *Signed out*; use Add account to sign in to it again.
- Using the site's own **Log out** signs that account out for real: the extension forgets its saved sign-in too. **▾ → Manage** removes accounts from the list (without signing them out).
- The extension needs the browser's *cookies* permission for this (Opera may ask you to approve it when you reload the extension).

## My comments

Search every comment you've left on sequences: **▾ → Search my comments** at the top of the site, or **My comments** in the popup. It opens a full page with a search box (words or "exact phrases", also matches sequence names), filters for account, comments vs. replies, date range and deleted comments, sorting, and **Export CSV**. Each result shows **the sequence's picture, title and creator** (click to open it), the date, what a reply was answering, and **★ Save sequence** to put that sequence in your library.

The site has no list of a member's comments and no feed of all comments — it only serves comments one sequence at a time, across about 5.9 million sequences. So the extension keeps its own index, in this browser, and finds your comments by checking sequences:

- **It scans by itself:** opening the page starts going through your accounts' comment history — your own sequences first (that's where most of anyone's comments are), then the deep scan — and results appear as they're found, while you search. **Pause** / **Resume** in the strip above the results. Next time it only checks what's new. Whenever a Comments panel loads on the site, your comments in it are added too.
- **Deep scan** (on by default): every sequence by everyone you interact with — people who comment on your sequences, people who reply to you or you reply to, and the makers of sequences you've commented on — most-interacted first, then again for the people that turns up, until nobody new appears. Up to 25,000 sequences per run; it picks up where it left off.
- **Your own sequences**, **sequences you've opened**, **browser history** (every sequence link in it; needs the *history* permission, asked once), **popular sequences** (300 / 1,000 / 3,000), and pasted links.
- Checks run 3 at a time with pauses, to stay gentle on the site. Sequences already checked are skipped unless you tick *Check again*.
- Comments from every account in the account switcher are collected. A comment deleted on the site drops out of the results on the next check (*Include deleted* still shows it).
- The one thing it can't promise: a comment on a sequence by someone you've never otherwise talked to, that isn't popular and isn't in your history. Finding those would mean checking all ~5.9 million sequences — days of nonstop requests to the site — which the extension deliberately doesn't do.

## Sequence library

A database of sequences saved as **real sequence data** (the site's own `.sequence` format), in this browser: **▾ → My sequence library**, or **Sequence library** in the popup.

- **Save the sequence you're editing** — unsaved changes included — with **▾ → Save this sequence to my library**. It's stored with a small piano-roll picture of its notes.
- **Save from the site**: paste links or numbers, save **all of a member's sequences** (any member, or one of your accounts), or press **★ Save sequence** on a comment result. These are stored with the site's thumbnail, title and creator.
- **Open** puts a saved sequence in the editor as a new, unsaved sequence (just like dropping a .sequence file on it) — save it from there to put it back on the site. **Download** gives a `.sequence` file. Rename (✎) and delete (✕) per sequence; search by title, creator or number; sort by date, title, creator or size.
- The same sequence with identical data is only stored once; a newer version of it is stored alongside.
- **Back up library** writes one file with every sequence and its picture; **Restore backup** adds back whatever is missing. You can also drop `.sequence` files onto the page.

## Instrument options extras

- **Exact numbers on every slider** in the Advanced and Synthesizer tabs — volume %, pan, detune ¢, reverb / distortion / bitcrusher amounts, EQ dB, attack / release s, filter Hz, Q, LFO %, synth ADSR. The number is a box you can type into (Enter or Tab applies it), and it follows the slider as you drag.
- **Copy / Load carries the Synthesizer tab**: loading copied settings onto a custom synthesizer also brings its waveform, filter, LFO and envelopes (the site itself keeps the target's synth settings on Load). Load also works when the clipboard can't be read, using the last settings copied in this session.
- **Presets ▾** next to Copy / Load: save the current instrument's settings under a name and apply them to any instrument later. Presets live in this browser (localStorage) and note whether they include synthesizer settings.

## FX dock

**FX** in the top menu opens an effects dock along the bottom of the editor (the note grid shrinks to make room), laid out like a DAW's effects strip:

- Left block: the instrument (picker for any instrument with notes, tinted with its colour), **Presets ▾** (the same presets as the instrument options) and **Reset** (every effect off, channel back to default — one undo step).
- Then the chain, left to right: **Channel** (volume, pan, detune) always first; **Filter** + **Amp envelope** for the custom synthesizer, **Envelope** (attack / release) for sampled instruments; then **Equalizer**, **Distortion**, **Bitcrusher**, **Delay**, **Reverb**. The strip scrolls sideways (wheel or drag the scrollbar).
- Every card has a **power button** and a ✕ on hover; cards that are off are dimmed; **＋ Add effect** at the end lists the ones that are off. Distortion and Reverb have their type picker in the card.
- **Knobs**: drag up / down (Shift for fine steps), scroll for steps, double-click to reset, or click the number to type an exact value.
- Right rail: collapse to a slim strip, or close. Everything goes through the site's own instrument-settings functions, so the instrument panel, the Layers mixer and the audio stay in step, and every gesture is one undo step. The dock remembers whether it was open and collapsed.

## Profile extras

- **Stats card** on every profile: total plays, sequences, subscribers, plays per sequence, member-for, sequences/month, plays/day, plus last-7 / last-30-day plays and a themed plays-per-day chart with hover readout. All computed client-side from what the page and the site's play-stats endpoint already expose.
- **Top sequences tab**: the stats card now has *Overview* and *Top sequences* tabs. Top sequences ranks the profile's sequences by plays in the last **Day** (today so far, or yesterday), **Week** (last 7 days) or **Month** (the ~30 days the site keeps), with thumbnail, share of plays, a bar and a 30-day sparkline that highlights the chosen window. It reads each sequence's plays-per-day data (the same numbers as the "N plays" hover chart), 4 at a time, and caches the result in this browser for an hour; **Refresh** re-counts.
- **Better play graph**: hovering any "N plays" (profiles and sequence pages) shows the themed chart instead of the stock Google chart.
- **History**: pick Plays per day, Total plays, Subscribers, Sequences made or Plays-by-creation-month, set any date range (presets for 30 d / 90 d / 1 y / all time) and grouping (day / week / month / year). The site only serves 30 days of plays and a current subscriber count, so the extension keeps its own local history that grows with every profile visit; sequences-made history is rebuilt from each sequence's creation date via "Load sequence history" (one-time, cached). There is no way to see *who* is subscribed — the site has no such endpoint.
- **Banners**: every profile gets a wide banner above the header. Sequence banners are drawn from the sequence's own notes (crisp, in the site's instrument colours, with the whole picture rather than the site's dotted preview — for note-art sequences just the picture block), squished into a square like the site's own thumbnails, since that's the shape note artists draw for. On your own profile, **Set a banner / Change banner** opens a picker: one of your sequences' art, one of ten colour presets, or a direct https link to an image (about 1500 × 300 looks best). The picture **fills** the banner; **✥ Move & zoom…** lets you drag it to choose which part shows and zoom in or out (slider, − / +, or the mouse wheel; zoomed out, a blurred copy fills the sides), and **Height** is Short, Medium or Tall. **Show all of it** shows the whole picture on a blurred copy of itself instead. It's saved through the site's own bio **Save** as a short tag at the end of your bio — `[banner: 1234567]`, `[banner: 1234567 z60 y30 tall]`, `[banner: neon]` or `[banner: https://…/image.png]` — so everyone with Glow Theme sees it (the tag itself is hidden for them; people without the extension see the tag text). **Automatic** removes the tag. Profiles without one get their most popular sequence's art, with its title linked in the corner.
- **Sequence browser**: the small tiles are replaced by big cards with title, notes, plays and date, a search box (uses the site's own search), sort (Newest / Oldest / Popular / Most notes / Longest), date and note-count filters, and endless scrolling. Hover a card for quick actions: ▶ open, ★ save to your library, ⧉ copy link, 💬 comment count. **Classic view** brings back the site's list (remembered).

## Glow layout

Its look is taken from the sequencer itself rather than from a video site: hardware-style panels, glowing status LEDs, the piano-roll grid and numeric read-outs.

On by default outside the editor (popup → Quality of life → **Glow layout** turns it off at once).

- **Top bar**: a dark console strip with an accent seam — ☰ menu, logo, one search field with the lens inside and a "/" key hint (searches sequences; on the Sequences page it uses the site's own search), your avatar and name.
- **Sidebar**: Editor, Sequences, Popular, Following (the site's feed of sequences by people you follow), then **Your studio** (your avatar, your subscriber count, Your channel, History, Sequence library, Your comments), your **Subscriptions** list with avatars, and Explore (Members, Chat, Forum, Wiki). ☰ shrinks it to icons; in a narrow window it slides in as a drawer.
- **Subscriptions list**: Online Sequencer has no page that lists who you follow, so the list is built from the site's Subscriptions feed (everyone you follow who has posted) and from each profile's Subscribe button — subscribe or unsubscribe on a profile and the sidebar updates right away. Kept per account, in this browser only.
- **Who subscribes to you** can't be shown: the site only ever gives the number of subscribers, never their names (the number appears under **You**).
- **Sequences pages**: the filters become a panel of lit keys, and each sequence is a framed tile — its picture on a faint piano-roll grid with a glowing time read-out, the title, a small square avatar beside the creator, and notes / plays / comments under a divider. **Card size** S / M / L changes how many fit per row.
- **Card details**: the creator on one line, then "1,625 notes · 12 plays · 3 comments · updated 5 minutes ago".
- **Members page**: sort options as chips, a pill search box, and each member as a card with a round avatar, their stats and their latest sequences as picture tiles.
- **Window size**: the search box and account buttons rearrange on narrow windows; under 1200 px the sidebar becomes a drawer.
- **Profiles** get a console header: wide banner, a framed square avatar with an accent ring, big name, read-outs for last online, member since, subscribers, sequences and plays, a glowing Subscribe key, tabs as a segmented switch, the bio folded to a few lines with **…more**, and tabs — **Home**, **Sequences**, **Featured**, **Playlists**, **Stats**.

## Glow playlist player

Playlists get their own player views. On a playlist page, the **Online Sequencer / Glow player / Studio** switch picks the view (remembered; `#os` / `#sc` / `#st` at the end of the address choose it too). On profiles, hovering a playlist shows **Open** (the site's page), **▶ Player** and **Studio**.

- **Header**: the playing sequence's picture, drawn from its notes and squished square like the site’s thumbnails (a song with no picture block keeps the site’s own thumbnail), in a glowing frame; behind it the same picture, softly blurred and still, under a piano-roll grid. Then the playlist's name and owner, the play button, what's playing, and tags for its place in the list, its length and a link to open it in the editor.
- **Live visualizer**: bars like the Studio visualizer — one per moment of the song, as tall as how much sounds then, in the colours of the instruments carrying it. Played bars glow with a bright cap; bars to come are dim (brighter under the pointer, where a click jumps). While a song plays, the playhead glides every frame and the bars around it dance to the real sound coming out of the site's player, low notes to high (an analyser listens to the player's final mix — nothing you hear changes). It runs on the song's real clock — tempo changes (BPM markers, including gradual ones) are followed the way the site's player follows them, so a picture section at 999 BPM is a sliver and slow parts stretch out. It lights up as the song plays behind a glowing playhead, with a time ruler underneath; hover to see the time, click to jump there.
- **Track list** below (the playing track shows a moving level icon), and a floating player dock (shuffle, back, play, next, loop, volume, progress) along the bottom.
- **Studio** (the third tab, or `#st`): everything side by side. The song (picture, title, play button) with the playlist right beside it; under the song, the site's actual sequencer playing along and the visualizer (the note meter); under the playlist, the playing sequence's comments, with a link to write one. Below 1100 px wide it stacks into one column.
- Track thumbnails further down a long playlist load as they come into view (the site only loads them when its own short list is scrolled).
- **Smooth changes**: switching between Online Sequencer, Glow player and Studio morphs — panels slide and resize into their new places while their contents crossfade, and the highlight glides to the chosen tab. Changing songs crossfades the picture and the backdrop, the new picture settles in, the title and tags rise in, the note meter grows in from left to right, the track's highlight sweeps across (and in Studio, glides to the middle of the playlist), and comments arrive one after another. Channel tabs on profiles (Glow layout) glide and crossfade the same way. All of it follows the popup's **Animations** switch and the system's reduced-motion setting.
- **On every sequence page too**: a sequence's own page opens in the Glow player — its picture, title, creator, plays, notes, date and "based on" links, the meter, its description and comments, and For you beside them. The button in the corner (or "Open in the editor") switches back to the site's view, and that choice is remembered.
- **Scrolls like a normal page**: a sequence's page in the Glow player scrolls as one page — the description, the comments and For you are shown in full, with no boxes scrolling inside the page and no gap under the player. A sequence without a picture in its notes shows the site's small thumbnail (not the big share image with the site's badge).
- **Jumping keeps the sound**: clicking a spot in the meter or the time line while a song plays stops it and plays again from there (the site's own way), so the music comes with the playhead instead of going silent.
- **A thumbnail for every sequence**: wherever a page gave no picture (For you, the add-to-playlist panel, the Recent list, a playlist track whose thumbnail hadn't loaded yet), the site's own small thumbnail is used, so nothing shows up blank or black.
- **No site badge on pictures**: the site's big share picture has an "Online Sequencer" badge in its bottom-right corner. Library thumbnails keep only the part above it (pictures kept by earlier versions are cropped once, the first time the library opens), and the player, Recent list, comments page and profile banners use the site's plain thumbnail or the picture drawn from the notes instead.
- **Editing steps the player aside**: **✎ Edit** on the Glow player (or the site's own pencil) opens the site's full editor, and the Glow player gets out of the way while you edit — the editor, its grid and its tools look and work exactly as on the site. Leave edit mode and the Glow player comes back.
- **A tidy bottom bar** on playlists (Glow player and Studio): symmetrical — what's playing on the left, the volume on the right, and in the middle the buttons centred over the time line — with nothing on top of anything else. The volume slider is big and easy to drag (scroll over it to nudge it, click the speaker to mute), the time line is easy to hit, and its times follow the song's tempo changes like the Glow player's meter (clicking it jumps to that moment).
- **The bottom bar on sequence pages too**: a sequence's own page in the Glow player gets the same bar — its picture, title and creator (click to go back to the top), back, play / pause, next, the time line (tempo-true; click to jump) and the volume (it moves the site's own volume; scroll over it to nudge it, click the speaker to mute).
- **Back and next through a creator's songs**: on a sequence's page, ⏭ goes to the next sequence in the list you opened it from (a creator's sequences, search results, a For you shelf…) — or, if you came straight to it, the creator's own sequences in the order their profile shows them. ⏮ goes back to the start; in the first 10 seconds it goes to the previous sequence instead, so past 10 seconds pressing it twice goes back a song. If the song was playing, the next one starts playing when it opens. Hover the buttons to see which song they go to.
- **Previous and Up next**: on a wide window with For you folded away, a sequence's page has the song before it on the left and the one after it on the right — one each, from the same list as back and next. They wait tucked behind the player, dark, and come out into the light when you point at them — or on their own when it's their moment: Previous in the first 5 seconds of a playing song, Up next in its last 10. Each card wears the player's backdrop (that song's picture, blurred, under the piano-roll grid). Click one to go there (a playing song carries on playing).
- **Play the next song when one ends** (a switch in the popup, on by default): when a song on a sequence's page finishes, the next one in the list opens and plays, instead of the song starting over. With the switch off — or when it's the last one — the song loops as usual.
- **For you** (switch it off in the popup): the player moves to the left and a column on the right suggests music in shelves — *More like this* (searches for the playing song's title and the words your playlist and recent plays share), *More from the creator & people you like* (the creator's or playlist owner's channel, and one creator you follow or visited), *Popular this week*, and *Playlists*. Each shows why it's there; nothing already playing or in the playlist is suggested. At most six pages are read for it, slowly, and remembered for 30 minutes.
- **Fold away For you**: the › in its corner slides it out and the player glides to the middle, the same space on both sides; a small "For you" lip on the player's top-right corner brings it back (on a narrow window it tucks just inside the corner). Remembered — and while it's folded away it reads nothing from the site.
- **Adding to your own playlist**: the site's "add a sequence" (and "＋ Add sequences" on the Glow player) opens a panel instead of asking for a link — search every sequence on the site, or pick from **Yours**, **Recent** (what you've opened) or **For you**, and add each with one click (it shows what's already in). Pasting links still works (several at once), and you can drag sequence links from another tab onto the panel. Each add is the site's own, so the track appears in the list and plays like any other.
- **Playlists made easy**: "+ Playlist" on the player (and on For you suggestions and sequence cards) opens a picker of your playlists — it knows when a sequence is already in one — with "New playlist" to make one with the sequence already inside. "⧉ Copy to my playlists" on a playlist page makes a playlist of your own with every sequence in it. These use the site's own requests from the page itself (the site's sign-in key never leaves the page), through the polite queue.
- **Jumping lands in the right place**: clicking the meter plays from that moment. (The site's own progress bar jumps by position in the score, which is off — sometimes by half a minute — when the tempo changes along the way; the Glow player works out the right spot from the tempo map.)
- **No lag from the hidden sequencer**: while the Glow player shows, the site's sequencer keeps playing but stops redrawing its grid (like hiding instruments in the editor); it redraws as soon as you switch back.
- The site's own player does the playing — the Glow player only drives it, so queueing, shuffle and looping work as usual. Switch it off entirely in the popup (Layout → Glow playlist player).

## Site-wide extras

- **Every save is backed up**: each time you save a sequence on the site, a copy of exactly what was saved goes to your Sequence library on this computer — the sequence's history, one version per save (an unchanged save isn't repeated; the newest 50 are kept). The library shows one card per sequence with a **History** button: every version, newest first, with its date, notes (and how many were added or removed since the one before), and Open / Download / Delete. On a sequence's page the Glow player shows "🕘 History" when there's more than one. Switch it off in the popup (Back up every save).
- **Older versions, found**: the site keeps only the newest copy of a sequence (each save replaces the last), so History looks for older versions where they still exist. **🔎 Find older versions** fetches the version on the site now plus older copies of it on the site — the sequences it was "based on" and the creator's other sequences with the same name — one page at a time through the polite queue, each dated by when that copy was last updated. **＋ Add a file as a version** puts .sequence files you downloaded earlier into its history. And opening one of your own sequences keeps a copy of it as it is on the site whenever that differs from what's kept, so saves made on another computer show up too. Your own sequences show 🕘 History on the Glow player even before the first save.
- **The view switch stays in the corner**: Online Sequencer / Glow player (/ Studio) sits in the bottom-right corner on every view, just above the bottom bar on playlists.
- **Blurred backdrop**: the player's background is the sequence's picture, softly blurred, and it stays still while the song plays (the waveform is what moves).

- **Gentle on the site**: Online Sequencer briefly blocks a browser that asks for too much too fast (and then sequences stop loading). Every request the extension makes goes through one queue shared by all your tabs: at most two at a time with a short gap, what you asked for first and background work last, one at a time. If the site ever says "too many requests", the extension pauses everything for as long as the site asks (or 15 s, 30 s, 1 min… up to 5 min), tells you once, and carries on afterwards. The playing sequence's notes are read from the site's own player instead of being downloaded a second time; sequence pictures, the player's meters and comment counts are remembered, so seeing them again costs nothing.
- **Smooth page changes and pop-outs**: moving to another page fades the old one out and the new one in once the extension has laid it out (so the plain site no longer flashes up first; it never stays hidden more than 1.5 s). Menus, pickers, dropdowns and dialogs — the extension's and the site's (instrument options, share, dropdown menus, tooltips) — ease in, and the extension's ease away when closed. Folding the sidebar slides. All of it follows the popup's **Animations** switch and the system's reduced-motion setting.
- **Space plays and stops** from anywhere on the editor, sequence pages and playlists — not only while the sequencer grid has the keyboard focus (the site's own behaviour), so it no longer scrolls the page. Typing in a box is left alone.

Every extra on this page and in Profile extras above (banners, the profile sequence browser, quick actions, endless scrolling, sticky header, back to top, recently viewed, keyboard shortcuts) has its own switch in the popup under **Quality of life**, plus **Turn all off / on**. Switches apply straight away on open tabs.

- **Sequences pages**: bigger cards in a grid, endless scrolling (with "Page N" markers) and the same quick actions.
- **Card sizes**: pick **S / M / L** separately for the Sequences pages, a profile's sequence cards and a profile's **Featured** sequences (popup → Quality of life → Card sizes). Sequences pages and Featured also have **Site** for the site's own look. The Sequences pages and the profile browser have the same S / M / L switch right on the page. Featured becomes a grid of picture cards with the title on the art.
- **Sticky header** that stays at the top while you scroll, plus a **back to top** button.
- **Recently viewed**: the clock button next to your name lists the last sequences and profiles you opened (kept in this browser only; **Clear** empties it).
- **Keyboard shortcuts** (outside the editor): `/` search, `G` then `S` Sequences, `P` your profile, `M` members, `F` forum, `H` editor, `R` recently viewed, `C` my comments, `L` sequence library, `?` the list.

## Customize

- **Style:** five presets in the popup — Glow (default dark), Midnight (pure black), Slate (lighter grey), Glass (frosted translucent panels), Neon (near-black with intense glow).
- **Accent color:** six presets plus a custom color picker in the popup.
- **Tint & glow strength:** slider in the popup (0–200%) that scales every accent glow and tint, including the grid lines.
- **Everything else:** edit `theme.css`. The colors are all variables at the top of the file (`--rg-bg`, `--rg-panel`, `--rg-radius`, etc.). After editing, go back to `opera://extensions` and click the reload (↻) button on the extension.

## Notes

- The note grid itself is drawn on a canvas, so it can't be recolored directly; the "Dim the note grid" option darkens it slightly to fit the theme. Turn it off if you prefer the original brightness.
- The theme only changes colors, glows and rounding — never sizes or positions — so it shouldn't break the editor's layout.



## AI engines — downloads, privacy, credits

Nothing is downloaded until you use an AI engine. On first use the page fetches:
- ONNX Runtime Web 1.30.0 from cdn.jsdelivr.net (~25 MB) and the HTDemucs model from huggingface.co/timcsy/demucs-web-onnx (~180 MB, kept in the browser's Cache Storage for onlinesequencer.net, so it downloads once);
- Spotify Basic Pitch 1.0.1 and TensorFlow.js from cdn.jsdelivr.net (~2 MB).

Your audio never leaves your computer — everything runs in the browser, in background workers, so the editor stays responsive while a song is being separated or transcribed. Without WebGPU the separator falls back to the CPU (works, but several times slower than real time).

Credits: HTDemucs by Meta / facebookresearch (MIT); browser pre/post-processing adapted from demucs-web by timcsy (MIT); Basic Pitch by Spotify (Apache-2.0); ONNX Runtime Web by Microsoft (MIT).

## Usernames

Usernames keep the site's own colors — the preset blue, or a member's custom name color — instead of the theme's link tint. In Tools → Settings you can pick a color for **your own** name (only you see it); the extension learns which account is yours from the "Welcome back" header once you're logged in.
