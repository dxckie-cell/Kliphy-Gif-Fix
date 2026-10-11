(function () {
  "use strict";

  const { instead } = vendetta.patcher;
  const metro = vendetta.metro;

  const NAME_RE = /^(download|save|share)\w*(media|asset|image|video|gallery|file|gif|attachment|camera)\w*$/i;
  const KLIPY = /klipy\.com/i;
  const VIDEO_EXT = /\.(mp4|webm|mov)(?=$|\?)/i;
  // Klipy answers missing .gif files with a "content no longer available" placeholder of this size.
  const PLACEHOLDER_SIZE = 78534;
  // Discord proxy links: https://images-ext-1.discordapp.net/external/<signature>/https/static.klipy.com/...
  const PROXY_RE = /^https?:\/\/[^/]*discord(?:app)?\.(?:net|com)\/external\/[^/]+\/(https?)\/(.+)$/i;
  const RANK = { hd: 0, md: 1, sm: 2, xs: 3 };

  const unpatches = [];
  const seen = new Set();
  const pages = new Map(); // mp4 file name -> Klipy page link (from the message embed)
  let timer;

  // ---------- helpers ----------
  const unwrap = (u) => {
    const m = PROXY_RE.exec(u);
    return m ? m[1] + "://" + m[2].split("?")[0] : u.split("?")[0];
  };
  const fname = (u) => unwrap(u).split("/").pop();
  const getKey = () => {
    try { return String(vendetta.plugin.storage.apiKey || "").trim(); } catch (e) { return ""; }
  };
  const withTimeout = (p, ms, fallback) =>
    Promise.race([p, new Promise((res) => setTimeout(() => res(fallback), ms))]);

  // ---------- remember which Klipy page each embedded video belongs to ----------
  function indexMessage(m) {
    if (!m || !Array.isArray(m.embeds)) return;
    for (const e of m.embeds) {
      if (!e || typeof e.url !== "string" || !KLIPY.test(e.url)) continue;
      const v = e.video || {};
      for (const u of [v.url, v.proxyURL, v.proxy_url]) {
        if (typeof u === "string" && KLIPY.test(u)) pages.set(fname(u), e.url);
      }
    }
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

  // ---------- find the real GIF through the Klipy API ----------
  function collectGifs(obj, path, out, depth) {
    if (depth > 8 || obj == null) return;
    if (typeof obj === "string") {
      if (/^https?:\/\/.+\.gif(\?|$)/i.test(obj)) out.push({ url: obj, path });
    } else if (typeof obj === "object") {
      for (const k of Object.keys(obj)) collectGifs(obj[k], path + "." + k, out, depth + 1);
    }
  }
  function apiGifs(page, dir, key) {
    const m = /klipy\.com\/(gifs|stickers|memes|clips)\/([^/?#]+)/i.exec(page);
    if (!m) return Promise.resolve([]);
    const url = "https://api.klipy.com/api/v1/" + encodeURIComponent(key) + "/" + m[1].toLowerCase() + "/" + encodeURIComponent(m[2]);
    const req = fetch(url, { headers: { Accept: "application/json" } })
      .then((r) => r.text())
      .then((text) => {
        const found = [];
        try { collectGifs(JSON.parse(text), "", found, 0); } catch (e) {}
        const score = (f) => {
          const size = (/\.(hd|md|sm|xs)\b/.exec(f.path) || [])[1];
          return (dir && f.url.indexOf(dir) >= 0 ? 0 : 10) + (size in RANK ? RANK[size] : 5);
        };
        found.sort((a, b) => score(a) - score(b));
        const urls = [];
        for (const f of found) if (urls.indexOf(f.url) < 0) urls.push(f.url);
        return urls.slice(0, 6);
      })
      .catch(() => []);
    return withTimeout(req, 10000, []);
  }
  function probe(url) {
    const req = fetch(url, { method: "GET", headers: { Range: "bytes=0-0" } })
      .then((r) => {
        const range = r.headers.get("content-range");
        const size = range ? parseInt(range.split("/")[1], 10) : parseInt(r.headers.get("content-length") || "0", 10);
        return (r.status === 200 || r.status === 206) && /image\/gif/i.test(r.headers.get("content-type") || "") && size !== PLACEHOLDER_SIZE;
      })
      .catch(() => false);
    return withTimeout(req, 6000, false);
  }
  async function resolveGif(mp4) {
    const key = getKey();
    if (!key) return null;
    const name = fname(mp4);
    if (!pages.has(name)) scanCurrentChannel();
    const page = pages.get(name);
    if (!page) return null;
    const dir = (unwrap(mp4).split("klipy.com/")[1] || "").replace(/[^/]+$/, "");
    const urls = await apiGifs(page, dir, key);
    const ok = await Promise.all(urls.map(probe));
    for (let i = 0; i < urls.length; i++) if (ok[i]) return urls[i];
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
          return resolveGif(mp4)
            .catch(() => null)
            .then((gif) => orig.apply(self, gif ? buildGifArgs(args, mp4, gif) : args));
        })
      );
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

  // ---------- settings: Klipy API key ----------
  function Settings() {
    const RN = metro.common.ReactNative;
    const React = metro.common.React;
    const [val, setVal] = React.useState(getKey());
    return React.createElement(
      RN.View,
      { style: { padding: 16 } },
      React.createElement(RN.Text, { style: { color: "#ffffff", marginBottom: 8 } }, "Klipy API key (free at klipy.com/developers)"),
      React.createElement(RN.TextInput, {
        value: val,
        placeholder: "paste your key here",
        placeholderTextColor: "#888888",
        autoCapitalize: "none",
        autoCorrect: false,
        style: { color: "#ffffff", borderWidth: 1, borderColor: "#888888", borderRadius: 8, padding: 10 },
        onChangeText: (t) => {
          setVal(t);
          try { vendetta.plugin.storage.apiKey = t.trim(); } catch (e) {}
        },
      })
    );
  }

  return {
    settings: Settings,
    onLoad() {
      try {
        const FD = metro.common && metro.common.FluxDispatcher;
        if (FD) for (const ev of Object.keys(handlers)) FD.subscribe(ev, handlers[ev]);
      } catch (e) {}
      scanCurrentChannel();
      scan();
      timer = setTimeout(scan, 8000);
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
      pages.clear();
    },
  };
})()
