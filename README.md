# Kliphy Gif Fix

A Revenge (Classic / Vendetta-style) plugin that makes saving or sharing a **Klipy** GIF on Discord
give you a `.gif` instead of an `.mp4`. Based on the idea behind nexpid's `tenor-gif-fix`.

## Install

1. Push `index.js` and `manifest.json` to the repo root.
2. In the repo go to **Settings → Pages**, set the source to your main branch (root).
3. In Revenge, go to **Plugins → Install** and paste:

   `https://dxckie-cell.github.io/Kliphy-Gif-Fix/`

## Notes

- Whenever you edit `index.js`, update `hash` in `manifest.json`: `sha256sum index.js`
- No debug log needed: the plugin shows toasts. On load it says how many functions it hooked, and when you save a Klipy GIF it shows "rewrote URL in <function>".
