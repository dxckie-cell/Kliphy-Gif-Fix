(function () {
  "use strict";

  const { before } = vendetta.patcher;
  const { findByProps } = vendetta.metro;
  const { showToast } = vendetta.ui.toasts;
  const { logger } = vendetta;

  // Functions Discord uses when you Save / Share media. The first one is the
  // main "Save Image" path. The rest are fallbacks; any that don't exist on
  // your Discord build are simply skipped.
  const TARGETS = ["downloadMediaAsset", "saveMediaToGallery", "shareMedia"];

  // Value Discord's media functions use for "treat this as an image" (not video).
  // If saving still lands as a video, try changing this to 1.
  const IMAGE_TYPE = 0;

  const KLIPY = /klipy\.com/i;
  const VIDEO_EXT = /\.(mp4|webm|mov)(?=$|\?)/i;

  function fixUrl(url) {
    if (typeof url !== "string") return url;
    if (!KLIPY.test(url) || !VIDEO_EXT.test(url)) return url;
    return url.replace(VIDEO_EXT, ".gif");
  }

  const unpatches = [];

  function patchTarget(name) {
    const mod = findByProps(name);
    if (!mod || typeof mod[name] !== "function") return false;

    unpatches.push(
      before(name, mod, (args) => {
        try {
          const first = args[0];

          // Plain string URL
          if (typeof first === "string") {
            const fixed = fixUrl(first);
            if (fixed !== first) {
              logger.log(`[Kliphy Gif Fix] ${name}: ${first} -> ${fixed}`);
              args[0] = fixed;
              if (typeof args[1] === "number") args[1] = IMAGE_TYPE;
            }
            return;
          }

          // Object-style argument ({ uri } / { url })
          if (first && typeof first === "object") {
            for (const key of ["uri", "url", "source"]) {
              if (typeof first[key] === "string") {
                const fixed = fixUrl(first[key]);
                if (fixed !== first[key]) {
                  logger.log(`[Kliphy Gif Fix] ${name}.${key}: ${first[key]} -> ${fixed}`);
                  args[0] = { ...first, [key]: fixed };
                  return;
                }
              }
            }
          }
        } catch (e) {
          logger.error("[Kliphy Gif Fix] patch error", e);
        }
      })
    );
    logger.log(`[Kliphy Gif Fix] patched ${name}`);
    return true;
  }

  return {
    onLoad() {
      let patched = 0;
      for (const name of TARGETS) if (patchTarget(name)) patched++;
      if (!patched) {
        showToast("Kliphy Gif Fix: couldn't find Discord's save function", 0);
        logger.error("[Kliphy Gif Fix] none of the target functions were found");
      }
    },
    onUnload() {
      for (const unpatch of unpatches) unpatch();
      unpatches.length = 0;
    },
  };
})()
