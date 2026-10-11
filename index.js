(function () {
  "use strict";

  const { before } = vendetta.patcher;
  const { showToast } = vendetta.ui.toasts;
  const metro = vendetta.metro;

  // Any function whose name looks like "download/save/share + media/asset/image/..."
  const NAME_RE = /^(download|save|share)\w*(media|asset|image|video|gallery|file|gif|attachment|camera)\w*$/i;
  const KLIPY = /klipy\.com/i;
  const VIDEO_EXT = /\.(mp4|webm|mov)(?=$|\?)/i;

  const unpatches = [];
  const seen = new Set();
  const patchedNames = [];
  let timer;

  function fixString(s) {
    if (KLIPY.test(s) && VIDEO_EXT.test(s)) return s.replace(VIDEO_EXT, ".gif");
    return s;
  }

  // Walks strings / arrays / plain objects (up to 3 levels) and rewrites Klipy video URLs.
  function deepFix(v, depth) {
    if (typeof v === "string") {
      const f = fixString(v);
      return f === v ? [v, false] : [f, true];
    }
    if (!v || typeof v !== "object" || depth > 3) return [v, false];
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => {
        const [nx, c] = deepFix(x, depth + 1);
        changed = changed || c;
        return nx;
      });
      return changed ? [out, true] : [v, false];
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return [v, false];
    let changed = false;
    const out = {};
    for (const k of Object.keys(v)) {
      const [nv, c] = deepFix(v[k], depth + 1);
      changed = changed || c;
      out[k] = nv;
    }
    return changed ? [out, true] : [v, false];
  }

  function hook(obj, key, label) {
    try {
      if (!obj || typeof obj[key] !== "function") return;
      const id = label + ":" + key;
      if (seen.has(id)) return;
      seen.add(id);
      unpatches.push(
        before(key, obj, (args) => {
          try {
            let hit = false;
            for (let i = 0; i < args.length; i++) {
              const [nv, c] = deepFix(args[i], 0);
              if (c) {
                args[i] = nv;
                hit = true;
              }
            }
            if (hit) {
              // Treat as an image rather than a video if a numeric "type" arg was passed.
              if (typeof args[1] === "number") args[1] = 0;
              showToast("Kliphy Gif Fix: rewrote URL in " + key);
            }
          } catch (e) {}
        })
      );
      patchedNames.push(key);
    } catch (e) {}
  }

  function scan() {
    // 1) Discord's JS modules (only ones that are already loaded)
    try {
      const mods = metro.modules || {};
      for (const id in mods) {
        const m = mods[id];
        if (!m || !m.isInitialized) continue;
        const ex = m.publicModule && m.publicModule.exports;
        if (!ex || typeof ex !== "object") continue;
        for (const holder of [ex, ex.default]) {
          if (!holder || (typeof holder !== "object" && typeof holder !== "function")) continue;
          let keys = [];
          try { keys = Object.keys(holder); } catch (e) {}
          for (const k of keys) {
            if (NAME_RE.test(k)) hook(holder, k, "m" + id);
          }
        }
      }
    } catch (e) {}

    // 2) Native modules (the part that actually writes the file)
    try {
      const NM = metro.common && metro.common.ReactNative && metro.common.ReactNative.NativeModules;
      if (NM) {
        for (const modName of Object.keys(NM)) {
          const mod = NM[modName];
          if (!mod || typeof mod !== "object") continue;
          for (const k of Object.keys(mod)) {
            if (NAME_RE.test(k)) hook(mod, k, "n:" + modName);
          }
        }
      }
    } catch (e) {}
  }

  return {
    onLoad() {
      scan();
      // Run again shortly after, once more of Discord's modules have loaded.
      timer = setTimeout(scan, 8000);
      showToast(
        "Kliphy Gif Fix: hooked " + patchedNames.length + " function(s)" +
        (patchedNames.length ? ": " + patchedNames.slice(0, 4).join(", ") : "")
      );
    },
    onUnload() {
      clearTimeout(timer);
      for (const u of unpatches) { try { u(); } catch (e) {} }
      unpatches.length = 0;
      seen.clear();
      patchedNames.length = 0;
    },
  };
})()
