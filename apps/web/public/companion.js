/*!
 * Tempass companion
 * -----------------
 * Runs inside the tab that is actually playing the video (aryplus.tv or any
 * other site that refuses to be embedded). It does two jobs:
 *
 *   1. Reports the media element's state to a Tempass room and applies the
 *      room's play / pause / seek commands — the room's remote control.
 *   2. Optionally captures this tab (getDisplayMedia) and sends it to the room
 *      over WebRTC, so the picture shows up inside Tempass.
 *
 * It never re-hosts the media: no proxying, no downloading, no DRM bypass. The
 * capture is a live peer-to-peer view of a tab the presenter is already
 * watching, like sharing a screen on a call.
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
  var ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

  var socket = null;
  var bound = new WeakSet();
  var video = null;
  var applying = false;
  var emitTimer = 0;
  var scanTimer = 0;

  var sharedStream = null;
  var peers = []; // participant socket ids
  var connections = {}; // socketId -> { pc, pending: [] }
  var sharing = false;

  /* ------------------------------------------------------------------ *
   * Keep playing when the tab goes to the background.
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
      /* non-fatal */
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
    "display:flex",
    "align-items:center",
    "gap:10px",
    "padding:8px 10px",
    "border-radius:10px",
    "background:rgba(9,9,15,.94)",
    "color:#e2e8f0",
    "font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
    "box-shadow:0 6px 24px rgba(0,0,0,.45)",
    "border:1px solid rgba(255,255,255,.12)",
    "max-width:360px",
  ].join(";");

  var statusEl = document.createElement("span");
  statusEl.textContent = "Tempass: starting…";

  var shareButton = document.createElement("button");
  shareButton.type = "button";
  shareButton.textContent = "Share this tab";
  shareButton.style.cssText = [
    "cursor:pointer",
    "border:0",
    "border-radius:7px",
    "padding:6px 10px",
    "font:600 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
    "background:#f43f5e",
    "color:#fff",
  ].join(";");
  shareButton.addEventListener("click", function () {
    if (sharing) {
      stopSharing();
    } else {
      startSharing();
    }
  });

  badge.appendChild(statusEl);
  badge.appendChild(shareButton);

  function setStatus(text, tone) {
    statusEl.textContent = text;
    statusEl.style.color = tone === "error" ? "#fda4af" : "#e2e8f0";
  }

  function mountBadge() {
    if (!badge.isConnected && document.body) {
      document.body.appendChild(badge);
    }
  }

  /* ------------------------------------------------------------------ *
   * Video discovery + state reporting
   * ------------------------------------------------------------------ */
  function pickVideo() {
    var videos = [].slice.call(document.querySelectorAll("video"));
    var best = null;
    var bestScore = -1;

    for (var i = 0; i < videos.length; i += 1) {
      var candidate = videos[i];
      var score =
        (candidate.clientWidth || candidate.videoWidth || 0) *
        (candidate.clientHeight || candidate.videoHeight || 0);

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

  function report() {
    if (!socket || !socket.connected || !video || applying) {
      return;
    }

    socket.emit("bridge:state", {
      source: {
        url: location.href,
        title: String(
          document.title ||
            (video.getAttribute && video.getAttribute("title")) ||
            "External video",
        ).slice(0, 200),
      },
      status: video.paused ? "paused" : "playing",
      positionSeconds: currentPosition(),
      durationSeconds: currentDuration(),
    });
  }

  function reportSoon(delay) {
    window.setTimeout(report, delay || 0);
  }

  function bindVideo(next) {
    if (!next || bound.has(next)) {
      video = next || video;
      return;
    }

    bound.add(next);
    video = next;

    var onLocal = function () {
      reportSoon(60);
    };

    next.addEventListener("play", onLocal);
    next.addEventListener("pause", onLocal);
    next.addEventListener("seeked", onLocal);
    next.addEventListener("loadedmetadata", onLocal);
    next.addEventListener("ratechange", onLocal);
  }

  function scan() {
    var next = pickVideo();
    if (next && next !== video) {
      bindVideo(next);
      report();
    }
  }

  /* ------------------------------------------------------------------ *
   * Remote playback commands
   * ------------------------------------------------------------------ */
  function applyCommand(command) {
    if (!video) {
      return;
    }

    applying = true;

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
            setStatus("Tap the video once to allow playback", "error");
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
      applying = false;
      report();
    }, LOCAL_ECHO_GUARD_MS + 250);
  }

  /* ------------------------------------------------------------------ *
   * Tab capture -> WebRTC
   * ------------------------------------------------------------------ */
  function createPeer(socketId) {
    if (connections[socketId] || !sharedStream) {
      return;
    }

    var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    var entry = { pc: pc, pending: [] };
    connections[socketId] = entry;

    sharedStream.getTracks().forEach(function (track) {
      pc.addTrack(track, sharedStream);
    });

    pc.onicecandidate = function (event) {
      if (event.candidate) {
        socket.emit("webrtc:signal", {
          to: socketId,
          data: { type: "candidate", candidate: event.candidate.toJSON() },
        });
      }
    };

    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed") {
        closePeer(socketId);
      }
    };

    pc.createOffer()
      .then(function (offer) {
        return pc.setLocalDescription(offer);
      })
      .then(function () {
        socket.emit("webrtc:signal", {
          to: socketId,
          data: { type: "offer", sdp: pc.localDescription.sdp },
        });
      })
      .catch(function () {
        closePeer(socketId);
      });
  }

  function closePeer(socketId) {
    var entry = connections[socketId];
    if (!entry) {
      return;
    }
    try {
      entry.pc.close();
    } catch (error) {
      /* ignore */
    }
    delete connections[socketId];
  }

  function syncPeers() {
    if (!sharing) {
      return;
    }

    for (var i = 0; i < peers.length; i += 1) {
      createPeer(peers[i]);
    }

    Object.keys(connections).forEach(function (socketId) {
      if (peers.indexOf(socketId) === -1) {
        closePeer(socketId);
      }
    });
  }

  function beginSharing(stream) {
    sharedStream = stream;
    sharing = true;
    shareButton.textContent = "Stop sharing";
    setStatus("Sharing this tab with the room");

    var videoTrack = stream.getVideoTracks()[0];

    if (videoTrack) {
      videoTrack.addEventListener("ended", function () {
        stopSharing();
      });
    }

    syncPeers();
  }

  function startSharing() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setStatus("This browser cannot capture a tab", "error");
      return;
    }

    setStatus("Pick this tab, then share…");

    navigator.mediaDevices
      .getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      })
      .then(function (stream) {
        beginSharing(stream);
      })
      .catch(function () {
        setStatus("Tab capture was cancelled", "error");
      });
  }

  function stopSharing() {
    sharing = false;
    shareButton.textContent = "Share this tab";
    setStatus("Tempass: connected");

    Object.keys(connections).forEach(closePeer);

    if (sharedStream) {
      sharedStream.getTracks().forEach(function (track) {
        track.stop();
      });
      sharedStream = null;
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
      // HTTPS XHR only: source sites usually allow `https:` in connect-src
      // but block ws:// and wss://.
      transports: ["polling"],
      upgrade: false,
      reconnection: true,
    });

    socket.on("connect", function () {
      setStatus("Tempass: connected to " + location.hostname);
      report();
    });

    socket.on("disconnect", function () {
      setStatus("Tempass: reconnecting…", "error");
    });

    socket.on("connect_error", function (error) {
      setStatus(
        "Tempass: " + (error && error.message ? error.message : "cannot connect"),
        "error",
      );
    });

    socket.on("bridge:command", function (command) {
      applyCommand(command);
    });

    socket.on("room:peers", function (payload) {
      peers = ((payload && payload.peers) || []).map(function (peer) {
        return peer.socketId;
      });
      syncPeers();
    });

    socket.on("webrtc:signal", function (message) {
      var entry = message && connections[message.from];
      if (!entry) {
        return;
      }

      var data = message.data || {};

      if (data.type === "answer") {
        entry.pc
          .setRemoteDescription({ type: "answer", sdp: data.sdp })
          .then(function () {
            entry.pending.splice(0).forEach(function (candidate) {
              entry.pc.addIceCandidate(candidate).catch(function () {});
            });
          })
          .catch(function () {});
        return;
      }

      if (data.type === "candidate" && data.candidate) {
        if (entry.pc.remoteDescription) {
          entry.pc.addIceCandidate(data.candidate).catch(function () {});
        } else {
          entry.pending.push(data.candidate);
        }
      }
    });
  }

  function start() {
    patchVisibility();
    mountBadge();
    scan();
    scanTimer = window.setInterval(scan, VIDEO_RESCAN_MS);
    emitTimer = window.setInterval(report, EMIT_INTERVAL_MS);

    loadSocketIo(CONFIG.server, function (error) {
      if (error) {
        setStatus("Tempass: " + error.message, "error");
        return;
      }
      connect();
    });
  }

  function destroy() {
    window.clearInterval(emitTimer);
    window.clearInterval(scanTimer);
    stopSharing();

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
    startSharing: startSharing,
    beginSharing: beginSharing,
    stopSharing: stopSharing,
    get video() {
      return video;
    },
    get socket() {
      return socket;
    },
    get peers() {
      return peers.slice();
    },
    get connections() {
      return connections;
    },
  };

  start();
})();
