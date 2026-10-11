(function () {
  "use strict";

  const { instead } = vendetta.patcher;
  const { showToast } = vendetta.ui.toasts;
  const metro = vendetta.metro;

  const NAME_RE = /^(download|save|share)\w*(media|asset|image|video|gallery|file|gif|attachment|camera)\w*$/i;
  const KLIPY = /klipy\.com/i;
  const VIDEO_EXT = /\.(mp4|webm|mov)(?=$|\?)/i;
  // Klipy answers missing .gif files with a "content no longer available" placeholder of this size.
  const PLACEHOLDER_SIZE = 78534;
  // Discord proxy links: https://images-ext-1.discordapp.net/external/<signature>/https/static.klipy.com/...
  const PROXY_RE = /^https?:\/\/[^/]*discord(?:app)?\.(?:net|com)\/external\/[^/]+\/(https?)\/(.+)$/i;

  const unpatches = [];
  const seen = new Set();
  const patchedNames = [];
  const index = new Map(); // mp4 file name -> { page, thumbs[] }
  let timer;

  // ---------- helpers ----------
  function unwrap(u) {
    const m = PROXY_RE.exec(u);
    return m ? m[1] + "://" + m[2].split("?")[0] : u.split("?")[0];
  }
  function fname(u) {
    try { return unwrap(u).split("/").pop(); } catch (e) { return null; }
  }

  // ---------- embed index: video file name -> Klipy page + GIF thumbnails ----------
  function indexEmbed(e) {
    if (!e || typeof e !== "object") return;
    const v = e.video || {};
    const vids = [v.url, v.proxyURL, v.proxy_url].filter((x) => typeof x === "string" && KLIPY.test(x));
    if (!vids.length) return;
    const t = e.thumbnail || {};
    const thumbs = [t.url, t.proxyURL, t.proxy_url]
      .filter((x) => typeof x === "string")
      .map(unwrap)
      .filter((x) => /\.gif$/i.test(x));
    const page = typeof e.url === "string" && KLIPY.test(e.url) ? e.url : null;
    for (const vid of vids) {
      const n = fname(vid);
      if (n) index.set(n, { page, thumbs });
    }
  }
  function indexMessage(m) {
    if (m && Array.isArray(m.embeds)) m.embeds.forEach(indexEmbed);
  }

  const handlers = {
    MESSAGE_CREATE: (e) => e && e.message && indexMessage(e.message),
    MESSAGE_UPDATE: (e) => e && e.message && indexMessage(e.message),
    LOAD_MESSAGES_SUCCESS: (e) => e && Array.isArray(e.messages) && e.messages.forEach(indexMessage),
  };

  function scanCurrentChannel() {
    try {
      const MS = metro.findByStoreName("MessageStore");
      const SC = metro.findByStoreName("SelectedChannelStore");
      const id = SC && SC.getChannelId && SC.getChannelId();
      const msgs = MS && id && MS.getMessages(id);
      const arr = msgs && (msgs.toArray ? msgs.toArray() : msgs._array);
      if (arr) arr.forEach(indexMessage);
    } catch (e) {}
  }
  function lookup(name) {
    if (!index.has(name)) scanCurrentChannel();
    return index.get(name);
  }

  // ---------- network ----------
  function withTimeout(p, ms, fallback) {
    return Promise.race([p, new Promise((res) => setTimeout(() => res(fallback), ms))]);
  }
  function probe(url) {
    const req = fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } })
      .then((r) => {
        const range = r.headers.get("content-range");
        const size = range ? parseInt(range.split("/")[1], 10) : parseInt(r.headers.get("content-length") || "0", 10);
        return { status: r.status, type: r.headers.get("content-type") || "?", size };
      })
      .catch((e) => ({ status: 0, type: "error " + (e && e.message), size: 0 }));
    return withTimeout(req, 6000, { status: 0, type: "timeout", size: 0 });
  }
  function isRealGif(p) {
    return (p.status === 200 || p.status === 206) && /image\/gif/i.test(p.type) && p.size !== PLACEHOLDER_SIZE;
  }
  // Reads <meta property="og:image"> from the Klipy page.
  function pageGif(page) {
    const req = fetch(page)
      .then((r) => r.text())
      .then((html) => {
        const a = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html);
        const b = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
        const u = (a && a[1]) || (b && b[1]);
        return u && /\.gif(\?|$)/i.test(u) ? u.replace(/&amp;/g, "&") : null;
      })
      .catch(() => null);
    return withTimeout(req, 8000, null);
  }

  async function resolveGif(mp4, log) {
    const name = fname(mp4);
    const entry = name && lookup(name);
    log.push("embed index: " + (entry ? "found" : "MISS") + (entry && entry.page ? " page=" + entry.page : ""));
    const cands = [];
    if (entry) {
      for (const t of entry.thumbs) cands.push(["thumbnail", t]);
      if (entry.page) {
        const g = await pageGif(entry.page);
        if (g) cands.push(["og:image", g]);
        else log.push("og:image: none found");
      }
    }
    for (const [src, url] of cands) {
      const p = await probe(url);
      log.push(src + ": " + url + " -> " + p.status + " " + p.type + " " + p.size + "B");
      if (isRealGif(p)) return url;
    }
    return null;
  }

  // ---------- argument rewriting ----------
  function findKlipyVideo(args) {
    const look = (v, d) => {
      if (typeof v === "string") return KLIPY.test(v) && VIDEO_EXT.test(v) ? v : null;
      if (v && typeof v === "object" && d < 3) {
        for (const k of Object.keys(v)) {
          const r = look(v[k], d + 1);
          if (r) return r;
        }
      }
      return null;
    };
    for (const a of args) {
      const r = look(a, 0);
      if (r) return r;
    }
    return null;
  }
  function swap(v, from, to, d) {
    if (typeof v === "string") return v === from ? to : v;
    if (Array.isArray(v)) return v.map((x) => swap(x, from, to, d + 1));
    if (v && typeof v === "object" && d < 3) {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return v;
      const o = {};
      for (const k of Object.keys(v)) o[k] = swap(v[k], from, to, d + 1);
      return o;
    }
    return v;
  }
  function buildGifArgs(args, mp4, gif) {
    const out = args.map((a) => swap(a, mp4, gif, 0));
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      if (typeof a === "string" && /^video\//i.test(a)) out[i] = "image/gif";
      else if (typeof a === "number" && i > 0) out[i] = 0;
      else if (a && typeof a === "object" && !Array.isArray(a)) {
        for (const k of ["contentType", "mimeType", "mime", "type"]) {
          if (typeof a[k] === "string" && /video/i.test(a[k])) a[k] = "image/gif";
        }
      }
    }
    return out;
  }

  function copy(text) {
    try {
      const C = metro.findByProps("setString", "getString");
      if (C) C.setString(text);
    } catch (e) {}
  }

  // ---------- patching ----------
  function hook(obj, key, label) {
    try {
      if (!obj || typeof obj[key] !== "function") return;
      const id = label + ":" + key;
      if (seen.has(id)) return;
      seen.add(id);
      unpatches.push(
        instead(key, obj, function (args, orig) {
          const self = this;
          let mp4 = null;
          try { mp4 = findKlipyVideo(args); } catch (e) {}
          if (!mp4) return orig.apply(self, args);

          const log = ["MP4: " + mp4];
          return resolveGif(mp4, log)
            .catch((e) => { log.push("error: " + (e && e.message)); return null; })
            .then((gif) => {
              copy(log.join("\n") + "\nused: " + (gif ? gif : "mp4 fallback"));
              if (gif) {
                showToast("Kliphy Gif Fix: saving as GIF");
                return orig.apply(self, buildGifArgs(args, mp4, gif));
              }
              showToast("Kliphy Gif Fix: no GIF found, saving mp4");
              return orig.apply(self, args);
            });
        })
      );
      patchedNames.push(key);
    } catch (e) {}
  }

  function scan() {
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
          for (const k of keys) if (NAME_RE.test(k)) hook(holder, k, "m" + id);
        }
      }
    } catch (e) {}
    try {
      const NM = metro.common && metro.common.ReactNative && metro.common.ReactNative.NativeModules;
      if (NM) {
        for (const modName of Object.keys(NM)) {
          const mod = NM[modName];
          if (!mod || typeof mod !== "object") continue;
          for (const k of Object.keys(mod)) if (NAME_RE.test(k)) hook(mod, k, "n:" + modName);
        }
      }
    } catch (e) {}
  }

  return {
    onLoad() {
      try {
        const FD = metro.common && metro.common.FluxDispatcher;
        if (FD) for (const ev of Object.keys(handlers)) FD.subscribe(ev, handlers[ev]);
      } catch (e) {}
      scanCurrentChannel();
      scan();
      timer = setTimeout(scan, 8000);
      showToast("Kliphy Gif Fix: hooked " + patchedNames.length + " function(s)");
    },
    onUnload() {
      clearTimeout(timer);
      try {
        const FD = metro.common && metro.common.FluxDispatcher;
        if (FD) for (const ev of Object.keys(handlers)) FD.unsubscribe(ev, handlers[ev]);
      } catch (e) {}
      for (const u of unpatches) { try { u(); } catch (e) {} }
      unpatches.length = 0;
      seen.clear();
      patchedNames.length = 0;
      index.clear();
    },
  };
})()
