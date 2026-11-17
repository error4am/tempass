/*!
 * Tempass companion
 * -----------------
 * Runs inside the tab that is actually playing the video (aryplus.tv or any
 * other site that refuses to be embedded). It reports the media element's
 * state to a Tempass room and applies the room's play / pause / seek commands.
 *
 * It never touches the media itself: no proxying, no downloading, no DRM.
 * It only presses the same buttons a viewer would press.
 *
 * Usage (bookmarklet):
 *   javascript:(()=>{const s=document.createElement('script');
 *   s.src='https://tempass.vercel.app/companion.js?room=ROOM&token=TOKEN&server=https://api.example';
 *   document.body.appendChild(s)})()
 */
(function () {
  "use strict";

  var CONFIG = (function readConfig() {
    var override = window.__TEMPASS_CONFIG;
    if (override && override.room && override.token) {
      return {
        room: override.room,
        token: override.token,
        server: override.server || "http://localhost:3001",
      };
    }

    var candidates = [];
    if (document.currentScript && document.currentScript.src) {
      candidates.push(document.currentScript.src);
    }
    for (var i = document.scripts.length - 1; i >= 0; i -= 1) {
      var src = document.scripts[i].src || "";
      if (src.indexOf("companion.js") !== -1) {
        candidates.push(src);
      }
    }

    for (var c = 0; c < candidates.length; c += 1) {
      try {
        var url = new URL(candidates[c]);
        var room = url.searchParams.get("room");
        var token = url.searchParams.get("token");
        if (room && token) {
          return {
            room: room,
            token: token,
            server: url.searchParams.get("server") || url.origin,
          };
        }
      } catch (error) {
        /* try the next candidate */
      }
    }

    return null;
  })();

  if (!CONFIG) {
    window.alert(
      "Tempass companion: missing ?room= and ?token=. Re-copy the bookmarklet from your room.",
    );
    return;
  }

  if (window.__tempassCompanion) {
    window.__tempassCompanion.destroy();
  }

  var EMIT_INTERVAL_MS = 2000;
  var LOCAL_ECHO_GUARD_MS = 700;
  var VIDEO_RESCAN_MS = 3000;

  var socket = null;
  var bound = new WeakSet();
  var video = null;
  var applying = false;
  var lastLocalActionAt = 0;
  var emitTimer = 0;
  var scanTimer = 0;
  var suspended = false;
  var revision = 0;

  /* ------------------------------------------------------------------ *
   * Keep playing when the tab goes to the background.
   * Many players pause themselves on visibilitychange; the presenter needs
   * this tab to keep running while the Tempass room is in front.
   * ------------------------------------------------------------------ */
  function patchVisibility() {
    try {
      Object.defineProperty(Document.prototype, "hidden", {
        get: function () {
          return false;
        },
        configurable: true,
      });
      Object.defineProperty(Document.prototype, "visibilityState", {
        get: function () {
          return "visible";
        },
        configurable: true,
      });
      Object.defineProperty(Document.prototype, "webkitHidden", {
        get: function () {
          return false;
        },
        configurable: true,
      });
      document.addEventListener(
        "visibilitychange",
        function (event) {
          event.stopImmediatePropagation();
        },
        true,
      );
    } catch (error) {
      /* non-fatal: the tab may still pause itself */
    }
  }

  /* ------------------------------------------------------------------ *
   * Badge
   * ------------------------------------------------------------------ */
  var badge = document.createElement("div");
  badge.setAttribute("data-tempass-companion", "badge");
  badge.style.cssText = [
    "position:fixed",
    "z-index:2147483647",
    "right:16px",
    "bottom:16px",
    "padding:8px 12px",
    "border-radius:10px",
    "background:rgba(9,9,15,.92)",
    "color:#e2e8f0",
    "font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
    "box-shadow:0 6px 24px rgba(0,0,0,.45)",
    "border:1px solid rgba(255,255,255,.12)",
    "pointer-events:none",
    "max-width:280px",
  ].join(";");

  function setBadge(text, tone) {
    badge.textContent = text;
    badge.style.color = tone === "error" ? "#fda4af" : "#e2e8f0";
  }

  function mountBadge() {
    if (!badge.isConnected && document.body) {
      document.body.appendChild(badge);
    }
  }

  /* ------------------------------------------------------------------ *
   * Video discovery
   * ------------------------------------------------------------------ */
  function pickVideo() {
    var videos = [].slice.call(document.querySelectorAll("video"));
    var best = null;
    var bestScore = -1;

    for (var i = 0; i < videos.length; i += 1) {
      var candidate = videos[i];
      var width = candidate.clientWidth || candidate.videoWidth || 0;
      var height = candidate.clientHeight || candidate.videoHeight || 0;
      var score = width * height;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return bestScore > 0 ? best : null;
  }

  function currentPosition() {
    if (!video || !isFinite(video.currentTime)) {
      return 0;
    }
    return Math.max(0, Math.round(video.currentTime));
  }

  function currentDuration() {
    if (!video || !isFinite(video.duration) || video.duration <= 0) {
      return 0;
    }
    return Math.round(video.duration);
  }

  /* ------------------------------------------------------------------ *
   * Reporting
   * ------------------------------------------------------------------ */
  function report() {
    if (!socket || !socket.connected || !video) {
      return;
    }

    // Ignore the brief window where our own seek/pause/play is settling.
    if (applying) {
      return;
    }

    var title =
      document.title ||
      (video.getAttribute && video.getAttribute("title")) ||
      "External video";

    socket.emit("bridge:state", {
      source: { url: location.href, title: String(title).slice(0, 200) },
      status: video.paused ? "paused" : "playing",
      positionSeconds: currentPosition(),
      durationSeconds: currentDuration(),
    });
  }

  function reportSoon(delay) {
    window.setTimeout(report, delay || 0);
  }

  /* ------------------------------------------------------------------ *
   * Remote commands
   * ------------------------------------------------------------------ */
  function applyCommand(command) {
    if (!video) {
      return;
    }

    applying = true;
    revision += 1;
    var guard = window.setTimeout(function () {
      applying = false;
    }, LOCAL_ECHO_GUARD_MS);

    try {
      if (command.action === "seek") {
        video.currentTime = Math.max(0, command.positionSeconds);
      } else if (command.action === "play") {
        if (Math.abs(video.currentTime - command.positionSeconds) > 1.5) {
          video.currentTime = Math.max(0, command.positionSeconds);
        }
        var played = video.play();
        if (played && typeof played.catch === "function") {
          played.catch(function () {
            setBadge("Tap the video once to allow playback", "error");
          });
        }
      } else if (command.action === "pause") {
        video.pause();
        if (Math.abs(video.currentTime - command.positionSeconds) > 1.5) {
          video.currentTime = Math.max(0, command.positionSeconds);
        }
      }
    } catch (error) {
      /* ignore */
    }

    window.setTimeout(function () {
      window.clearTimeout(guard);
      applying = false;
      report();
    }, LOCAL_ECHO_GUARD_MS + 250);
  }

  /* ------------------------------------------------------------------ *
   * Local listeners
   * ------------------------------------------------------------------ */
  function bindVideo(next) {
    if (!next || bound.has(next)) {
      video = next || video;
      return;
    }

    bound.add(next);
    video = next;

    var onLocal = function () {
      lastLocalActionAt = Date.now();
      reportSoon(60);
    };

    next.addEventListener("play", onLocal);
    next.addEventListener("pause", onLocal);
    next.addEventListener("seeked", onLocal);
    next.addEventListener("loadedmetadata", onLocal);
    next.addEventListener("ratechange", onLocal);

    setBadge("Tempass: connected to " + location.hostname);
  }

  function scan() {
    var next = pickVideo();
    if (next && next !== video) {
      bindVideo(next);
      report();
    }
  }

  /* ------------------------------------------------------------------ *
   * Socket
   * ------------------------------------------------------------------ */
  function loadSocketIo(server, done) {
    if (window.io && typeof window.io.connect === "function") {
      done(null);
      return;
    }

    var tag = document.createElement("script");
    tag.src = server.replace(/\/$/, "") + "/socket.io/socket.io.js";
    tag.onload = function () {
      done(null);
    };
    tag.onerror = function () {
      done(new Error("socket.io client failed to load"));
    };
    document.head.appendChild(tag);
  }

  function connect() {
    socket = window.io(CONFIG.server, {
      auth: { token: CONFIG.token, role: "bridge" },
      // Polling first: source sites commonly send
      // `connect-src https:` which allows HTTPS XHR but blocks ws://wss://.
      // Our update rate is one message every 2s, so polling is plenty.
      transports: ["polling"],
      upgrade: false,
      reconnection: true,
    });

    socket.on("connect", function () {
      setBadge("Tempass: connected to " + location.hostname);
      report();
    });

    socket.on("disconnect", function () {
      setBadge("Tempass: reconnecting…", "error");
    });

    socket.on("connect_error", function (error) {
      setBadge("Tempass: " + (error && error.message ? error.message : "cannot connect"), "error");
    });

    socket.on("bridge:command", function (command) {
      applyCommand(command);
    });
  }

  function start() {
    patchVisibility();
    mountBadge();
    setBadge("Tempass: starting…");

    scan();
    scanTimer = window.setInterval(scan, VIDEO_RESCAN_MS);
    emitTimer = window.setInterval(function () {
      if (!suspended) {
        report();
      }
    }, EMIT_INTERVAL_MS);

    loadSocketIo(CONFIG.server, function (error) {
      if (error) {
        setBadge("Tempass: " + error.message, "error");
        return;
      }
      connect();
    });
  }

  function destroy() {
    window.clearInterval(emitTimer);
    window.clearInterval(scanTimer);
    if (socket) {
      try {
        socket.disconnect();
      } catch (error) {
        /* ignore */
      }
      socket = null;
    }
    if (badge.isConnected) {
      badge.remove();
    }
    window.__tempassCompanion = null;
  }

  window.__tempassCompanion = {
    destroy: destroy,
    report: report,
    get video() {
      return video;
    },
    get socket() {
      return socket;
    },
  };

  start();
})();
