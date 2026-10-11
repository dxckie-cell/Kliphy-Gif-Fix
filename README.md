# Klipy Gif Fix

A Revenge (Classic / Vendetta-style) plugin that makes saving or sharing a **Klipy** GIF on Discord
give you a real `.gif` instead of an `.mp4`.

## Install

1. Push `index.js` and `manifest.json` to the repo root.
2. In the repo go to **Settings → Pages**, set the source to your main branch (root).
3. In Revenge, go to **Plugins → Install** and paste `https://dxckie-cell.github.io/Kliphy-Gif-Fix/`
4. Open the plugin's settings and paste a free Klipy API key (klipy.com/developers).

## Notes

- Without a key, or if Klipy has no GIF for an item, the plugin saves the mp4 as usual.
- Whenever you edit `index.js`, update `hash` in `manifest.json`: `sha256sum index.js`
