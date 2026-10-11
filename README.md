# Klipy Gif Fix

A Revenge (Classic / Vendetta-style) plugin that makes saving or sharing a **Klipy** GIF on Discord
give you a real `.gif` instead of an `.mp4`.

It is the Klipy counterpart of [Tenor Gif Fix](https://github.com/nexpid/RevengePlugins/tree/main/src/plugins/tenor-gif-fix)
by nexpid, which does the same for Tenor links.

## The problem

Klipy GIFs sent in Discord are shown as short videos, so when you save one to your gallery or share it to
another app you get an `.mp4` file, not a GIF. Apps that expect a GIF (or that you want it to animate in)
then don't treat it as one.

## What the plugin does

When you save or share a Klipy GIF, the plugin swaps the video for the real GIF file before Discord
handles it:

1. It watches messages so it knows which Klipy page each embedded video came from.
2. When a save / download / share action is called with a Klipy `.mp4` / `.webm` / `.mov`, it asks the
   [Klipy API](https://klipy.com/developers) for that item's GIF files.
3. It checks each candidate link really is a GIF (and not Klipy's "content no longer available" placeholder),
   preferring the same folder and the highest quality size (`hd`, then `md`, `sm`, `xs`).
4. It replaces the mp4 with the GIF in the save / share call, including the content type.

Works with Klipy GIFs, stickers, memes and clips pages. Nothing changes in how GIFs look in chat; only
saving and sharing are affected.

If anything fails or times out (no API key, no GIF available, network error), the plugin steps aside and
the mp4 is saved as usual, so it never blocks a save.

## Install

1. In Revenge, go to **Plugins → Install** and paste:
   ```
   https://dxckie-cell.github.io/Kliphy-Gif-Fix/
   ```
2. Open the plugin's settings and paste a free Klipy API key (get one at
   [klipy.com/developers](https://klipy.com/developers)).

The key is stored only on your device, in the plugin's settings, and is sent only to `api.klipy.com`.

## Notes

- Without a key, or if Klipy has no GIF for an item, the plugin saves the mp4 as usual.
- It finds Discord's save / share functions by name rather than a fixed module, so a Discord update that
  renames them could stop it working until the plugin is updated.

## For developers

The plugin is a single file, `index.js`, plus `manifest.json`, served straight from the repo root with
GitHub Pages (**Settings → Pages**, source: `main` branch, root).

Whenever you edit `index.js`, update `hash` in `manifest.json`:

```
sha256sum index.js
```

## Credits

- Inspired by [Tenor Gif Fix](https://github.com/nexpid/RevengePlugins/tree/main/src/plugins/tenor-gif-fix)
  by [nexpid](https://github.com/nexpid), from [nexpid/RevengePlugins](https://github.com/nexpid/RevengePlugins)
  (licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Klipy Gif Fix does the same job for Klipy
  links, using the Klipy API.
- GIF files come from [Klipy](https://klipy.com).
