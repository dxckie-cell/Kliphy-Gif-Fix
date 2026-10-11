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

  // Discord proxy links look like:
  //   https://images-ext-1.discordapp.net/external/<signature>/https/static.klipy.com/...mp4
  // The signature only matches that exact URL, so we must go back to the original Klipy URL.
  const PROXY_RE = /^https?:\/\/[^/]*discord(?:app)?\.(?:net|com)\/external\/[^/]+\/(https?)\/(.+)$/i;

  function fixString(s) {
    if (!KLIPY.test(s)) return s;
    let url = s;
    const m = PROXY_RE.exec(url);
    if (m) url = m[1] + "://" + m[2].split("?")[0];
    if (!VIDEO_EXT.test(url)) return s;
    return url.replace(VIDEO_EXT, ".gif");
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


  const diagged = new Set();
  function head(url) {
    const req = fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } })
      .then((r) => r.status + " " + (r.headers.get("content-type") || "?") + " " + (r.headers.get("content-range") || r.headers.get("content-length") || "?"))
      .catch((e) => "error " + (e && e.message));
    const timeout = new Promise((res) => setTimeout(() => res("timeout (6s)"), 6000));
    return Promise.race([req, timeout]);
  }
  function copy(text) {
    try {
      const C = metro.findByProps("setString", "getString");
      if (C) { C.setString(text); return true; }
    } catch (e) {}
    return false;
  }
  function diag(fn, origUrl, newArg0, origArgs) {
    const newUrl = typeof newArg0 === "string" ? newArg0 : JSON.stringify(newArg0);
    if (diagged.has(newUrl)) return;
    diagged.add(newUrl);
    Promise.all([head(origUrl), head(newUrl)]).then(([o, n]) => {
      const report = "fn: " + fn + "\norig args: [" + origArgs + "]\nORIG: " + origUrl + "\n -> " + o + "\nNEW: " + newUrl + "\n -> " + n;
      const ok = copy(report);
      showToast("GIF link: " + n.slice(0, 40) + (ok ? " (report copied)" : ""));
    });
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
            const origUrl = typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]);
            const orig = args.map((a) => (typeof a === "number" ? a : typeof a === "string" ? "s" : typeof a)).join(",");
            for (let i = 0; i < args.length; i++) {
              const [nv, c] = deepFix(args[i], 0);
              if (c) {
                args[i] = nv;
                hit = true;
              }
            }
            if (hit) {
              // Also fix the content type / media type so it's saved as a GIF, not a video.
              for (let i = 0; i < args.length; i++) {
                const a = args[i];
                if (typeof a === "string" && /^video\//i.test(a)) args[i] = "image/gif";
                else if (typeof a === "number" && i > 0) args[i] = 0;
                else if (a && typeof a === "object" && !Array.isArray(a)) {
                  const o = { ...a };
                  for (const k of ["contentType", "mimeType", "mime", "type"]) {
                    if (typeof o[k] === "string" && /video/i.test(o[k])) o[k] = "image/gif";
                  }
                  args[i] = o;
                }
              }
              const shape = args.map((a) => (typeof a === "string" ? a.slice(-28) : typeof a)).join(" | ");
              showToast("Kliphy Gif Fix: checking GIF link...");
              diag(key, origUrl, args[0], orig);
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
      diagged.clear();
      patchedNames.length = 0;
    },
  };
})()
