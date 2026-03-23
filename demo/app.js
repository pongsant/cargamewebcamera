const START_GATE_KEY = "raceControlStarted";
const exitBtn = document.getElementById("exitBtn");

if (exitBtn) {
  exitBtn.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(START_GATE_KEY);
    } catch (error) {
      // Ignore storage errors and continue to start page.
    }
  });
}

const getBackendSocketUrl = () => {
  const backendProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const backendHost = window.location.hostname || "localhost";
  return `${backendProtocol}//${backendHost}:8765`;
};

const mount = document.getElementById("bg-canvas");

if (mount) {
  import("https://unpkg.com/three@0.164.1/build/three.module.js").then((THREE) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 280);
    camera.position.set(0, 20, 44);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(renderer.domElement);

    const segX = window.innerWidth < 900 ? 92 : 128;
    const segY = window.innerWidth < 900 ? 92 : 128;

    const makeTerrain = (opacity, y, z, scale, color) => {
      const geometry = new THREE.PlaneGeometry(170, 170, segX, segY);
      geometry.rotateX(-Math.PI * 0.488);

      const material = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, y, z);
      mesh.scale.setScalar(scale);
      scene.add(mesh);

      return {
        mesh,
        base: new Float32Array(geometry.attributes.position.array),
        position: geometry.attributes.position,
      };
    };

    const front = makeTerrain(0.12, -8, 0, 1, 0xffffff);
    const back = makeTerrain(0.11, -11, -14, 1.1, 0x000000);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let rafId = null;

    const animate = (timeMs) => {
      const t = timeMs * 0.00016;

      if (!reduceMotion) {
        const f = front.position.array;
        for (let i = 0; i < f.length; i += 3) {
          const x = front.base[i];
          const z = front.base[i + 2];
          const w1 = Math.sin((x * 0.21) + (t * 3.0)) * 1.9;
          const w2 = Math.cos((z * 0.16) - (t * 2.2)) * 1.5;
          const w3 = Math.sin(((x + z) * 0.11) + (t * 1.4)) * 0.95;
          f[i + 1] = front.base[i + 1] + w1 + w2 + w3;
        }
        front.position.needsUpdate = true;

        const b = back.position.array;
        for (let i = 0; i < b.length; i += 3) {
          const x = back.base[i];
          const z = back.base[i + 2];
          const w1 = Math.sin((x * 0.18) + (t * 2.4) + 0.9) * 1.2;
          const w2 = Math.cos((z * 0.14) - (t * 1.7) + 0.4) * 1.0;
          b[i + 1] = back.base[i + 1] + w1 + w2;
        }
        back.position.needsUpdate = true;

        camera.position.x = Math.sin(t * 0.53) * 3.1;
        camera.position.y = 20 + Math.sin(t * 0.41) * 1.3;
        camera.position.z = 44 + Math.cos(t * 0.29) * 1.1;
        camera.lookAt(0, -4.2, 0);
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      } else if (!document.hidden && !rafId) {
        rafId = requestAnimationFrame(animate);
      }
    });

    rafId = requestAnimationFrame(animate);
  }).catch((error) => {
    console.error("Failed to load Three.js background:", error);
  });
}

const timerEl = document.getElementById("timer");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");
const scoreboardBody = document.getElementById("scoreboardBody");
const playerNameInput = document.getElementById("playerNameInput");
const addPlayerBtn = document.getElementById("addPlayerBtn");
const playerSelect = document.getElementById("playerSelect");
const saveTimeBtn = document.getElementById("saveTimeBtn");
const scoreStatus = document.getElementById("scoreStatus");
const wsStatusEl = document.getElementById("wsStatus");
const penaltyCountEl = document.getElementById("penaltyCount");
const penaltyTimeEl = document.getElementById("penaltyTime");
const raceStatusEl = document.getElementById("raceStatus");
const finalResultBox = document.getElementById("finalResultBox");
const resultRawTimeEl = document.getElementById("resultRawTime");
const resultPenaltySummaryEl = document.getElementById("resultPenaltySummary");
const resultFinalTimeEl = document.getElementById("resultFinalTime");

if (timerEl && startBtn && stopBtn && resetBtn) {
  const backendUrl = getBackendSocketUrl();

  let startTime = 0;
  let elapsedBefore = 0;
  let timerRafId = null;
  let raceSocket = null;
  let reconnectTimeoutId = null;
  let manualSocketClose = false;
  let latestBackendResult = null;
  let latestPenaltyCount = 0;
  let latestPenaltyTime = 0;
  let pendingCommand = null;
  const players = [];

  const formatTime = (ms) => {
    const totalCentiseconds = Math.floor(ms / 10);
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  };

  const formatSeconds = (seconds) => `${Number(seconds || 0).toFixed(2)}s`;

  const update = () => {
    const now = performance.now();
    const elapsed = elapsedBefore + (now - startTime);
    timerEl.textContent = formatTime(elapsed);
    timerRafId = requestAnimationFrame(update);
  };

  const getCurrentElapsed = () => {
    if (timerRafId === null) return elapsedBefore;
    return elapsedBefore + (performance.now() - startTime);
  };

  const startFrontendTimer = () => {
    if (timerRafId !== null) return;
    startTime = performance.now();
    timerRafId = requestAnimationFrame(update);
  };

  const stopFrontendTimer = () => {
    if (timerRafId === null) return;
    cancelAnimationFrame(timerRafId);
    timerRafId = null;
    elapsedBefore += performance.now() - startTime;
    timerEl.textContent = formatTime(elapsedBefore);
  };

  const resetFrontendTimer = () => {
    if (timerRafId !== null) {
      cancelAnimationFrame(timerRafId);
      timerRafId = null;
    }
    startTime = 0;
    elapsedBefore = 0;
    timerEl.textContent = "00:00.00";
  };

  const setScoreStatus = (message) => {
    if (scoreStatus) scoreStatus.textContent = message;
  };

  const setRaceStatus = (message) => {
    if (raceStatusEl) raceStatusEl.textContent = message;
  };

  const setWsStatus = (message) => {
    if (wsStatusEl) wsStatusEl.textContent = message;
  };

  const updatePenaltyUi = (penaltyCount = 0, penaltyTime = 0) => {
    latestPenaltyCount = penaltyCount;
    latestPenaltyTime = penaltyTime;
    if (penaltyCountEl) penaltyCountEl.textContent = String(penaltyCount);
    if (penaltyTimeEl) penaltyTimeEl.textContent = formatSeconds(penaltyTime);
  };

  const hideFinalResult = () => {
    latestBackendResult = null;
    finalResultBox?.classList.add("is-hidden");
    if (resultRawTimeEl) resultRawTimeEl.textContent = "--";
    if (resultPenaltySummaryEl) resultPenaltySummaryEl.textContent = "--";
    if (resultFinalTimeEl) resultFinalTimeEl.textContent = "--";
  };

  const renderFinalResult = (payload) => {
    latestBackendResult = payload;
    if (resultRawTimeEl) resultRawTimeEl.textContent = formatSeconds(payload.rawTime);
    if (resultPenaltySummaryEl) {
      resultPenaltySummaryEl.textContent = `${payload.penaltyCount} × ${Number(payload.penaltySeconds || 0).toFixed(2)}s = ${formatSeconds(payload.penaltyTime)}`;
    }
    if (resultFinalTimeEl) resultFinalTimeEl.textContent = formatSeconds(payload.finalTime);
    finalResultBox?.classList.remove("is-hidden");
  };

  const renderPlayerOptions = () => {
    if (!playerSelect) return;
    playerSelect.innerHTML = "";

    if (players.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No player";
      playerSelect.appendChild(option);
      playerSelect.disabled = true;
      return;
    }

    playerSelect.disabled = false;
    players.forEach((player) => {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = player.name;
      playerSelect.appendChild(option);
    });
  };

  const renderScoreboard = () => {
    if (!scoreboardBody) return;
    scoreboardBody.innerHTML = "";

    const ranked = players
      .filter((player) => Number.isFinite(player.bestMs))
      .sort((a, b) => a.bestMs - b.bestMs);

    if (ranked.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = "<td>-</td><td>No score yet</td><td>--:--.--</td>";
      scoreboardBody.appendChild(row);
      return;
    }

    ranked.forEach((player, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${index + 1}</td><td>${player.name}</td><td>${formatTime(player.bestMs)}</td>`;
      scoreboardBody.appendChild(row);
    });
  };

  const addPlayer = () => {
    if (!playerNameInput) return;
    const name = playerNameInput.value.trim();

    if (!name) {
      setScoreStatus("Please enter a player name.");
      return;
    }

    const exists = players.some((player) => player.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      setScoreStatus("Player name already exists.");
      return;
    }

    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    players.push({ id, name, bestMs: Number.POSITIVE_INFINITY });
    playerNameInput.value = "";

    renderPlayerOptions();
    renderScoreboard();
    playerSelect.value = id;
    setScoreStatus(`Added player: ${name}`);
  };

  const getAuthoritativeMs = () => {
    if (latestBackendResult && Number.isFinite(latestBackendResult.finalMs)) {
      return latestBackendResult.finalMs;
    }
    return getCurrentElapsed();
  };

  const saveTimeForPlayer = () => {
    if (!playerSelect || !playerSelect.value) {
      setScoreStatus("Please add/select a player first.");
      return;
    }

    const player = players.find((item) => item.id === playerSelect.value);
    if (!player) {
      setScoreStatus("Player not found.");
      return;
    }

    const currentMs = getAuthoritativeMs();
    if (currentMs <= 0) {
      setScoreStatus("No result available yet.");
      return;
    }

    if (currentMs < player.bestMs) {
      player.bestMs = currentMs;
      if (latestBackendResult) {
        setScoreStatus(`Saved backend final result for ${player.name}: ${formatSeconds(latestBackendResult.finalTime)}`);
      } else {
        setScoreStatus(`Saved current timer for ${player.name}: ${formatTime(currentMs)}`);
      }
    } else {
      setScoreStatus(`${player.name} time ${formatTime(currentMs)} is slower than best ${formatTime(player.bestMs)}`);
    }

    renderScoreboard();
  };

  const sendBackendMessage = (payload) => {
    if (!raceSocket || raceSocket.readyState !== WebSocket.OPEN) {
      pendingCommand = payload;
      setRaceStatus("Backend socket is not connected yet. Command queued.");
      return false;
    }

    raceSocket.send(JSON.stringify(payload));
    pendingCommand = null;
    return true;
  };

  const applyBackendState = (payload) => {
    updatePenaltyUi(payload.penaltyCount, payload.penaltyTime);

    const state = payload.state || "idle";
    if (state === "idle") {
      setRaceStatus("Backend idle. Press Start to begin a run.");
    } else if (state === "running") {
      setRaceStatus("Race running. Penalties are streamed from Python.");
    } else if (state === "finished") {
      setRaceStatus("Race finished. Final result received from backend.");
      stopFrontendTimer();
      renderFinalResult(payload);
    } else if (state === "stopped") {
      setRaceStatus("Race stopped by operator.");
      stopFrontendTimer();
    } else {
      setRaceStatus("Backend connected and waiting.");
    }
  };

  const handleSocketMessage = (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.type === "state") {
        applyBackendState(payload);
        return;
      }

      if (payload.type === "penalty_update") {
        updatePenaltyUi(payload.penaltyCount, payload.penaltyTime);
        setRaceStatus(`Penalty updated: ${payload.penaltyCount} event(s).`);
        return;
      }

      if (payload.type === "final_result") {
        updatePenaltyUi(payload.penaltyCount, payload.penaltyTime);
        stopFrontendTimer();
        renderFinalResult(payload);
        setRaceStatus("Final result received from Python.");
        return;
      }

      if (payload.type === "status") {
        setRaceStatus(payload.message || "Backend status updated.");
        return;
      }

      if (payload.type === "error") {
        setRaceStatus(payload.message || "Backend reported an error.");
      }
    } catch (error) {
      console.error("Invalid backend payload:", error, event.data);
    }
  };

  const scheduleReconnect = () => {
    if (manualSocketClose || reconnectTimeoutId !== null) return;

    reconnectTimeoutId = window.setTimeout(() => {
      reconnectTimeoutId = null;
      connectBackend();
    }, 1500);
  };

  const connectBackend = () => {
    if (raceSocket && (raceSocket.readyState === WebSocket.OPEN || raceSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setWsStatus("Connecting…");
    raceSocket = new WebSocket(backendUrl);

    raceSocket.addEventListener("open", () => {
      setWsStatus("Connected");
      setRaceStatus("Backend connected. Ready to start.");
      if (pendingCommand) {
        raceSocket.send(JSON.stringify(pendingCommand));
        pendingCommand = null;
      }
    });

    raceSocket.addEventListener("message", handleSocketMessage);

    raceSocket.addEventListener("close", () => {
      setWsStatus("Disconnected");
      if (!manualSocketClose) {
        setRaceStatus("Backend disconnected. Retrying…");
        scheduleReconnect();
      }
    });

    raceSocket.addEventListener("error", (error) => {
      console.error("Race socket error:", error);
      setWsStatus("Connection error");
      setRaceStatus("Could not talk to Python backend.");
    });
  };

  startBtn.addEventListener("click", () => {
    hideFinalResult();
    updatePenaltyUi(0, 0);
    resetFrontendTimer();
    startFrontendTimer();
    setRaceStatus("Start command sent. Waiting for backend updates.");

    const sent = sendBackendMessage({ type: "arm" });
    if (!sent) {
      connectBackend();
    }
  });

  stopBtn.addEventListener("click", () => {
    stopFrontendTimer();
    sendBackendMessage({ type: "stop" });
    setRaceStatus("Frontend timer stopped.");
  });

  resetBtn.addEventListener("click", () => {
    resetFrontendTimer();
    updatePenaltyUi(0, 0);
    hideFinalResult();
    sendBackendMessage({ type: "reset" });
    setRaceStatus("Run reset.");
  });

  addPlayerBtn?.addEventListener("click", addPlayer);

  playerNameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addPlayer();
  });

  saveTimeBtn?.addEventListener("click", saveTimeForPlayer);

  window.addEventListener("beforeunload", () => {
    manualSocketClose = true;
    if (reconnectTimeoutId !== null) {
      window.clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    if (raceSocket && raceSocket.readyState === WebSocket.OPEN) {
      raceSocket.close();
    }
  });

  renderPlayerOptions();
  renderScoreboard();
  hideFinalResult();
  updatePenaltyUi(0, 0);
  connectBackend();
}

const SCREEN_SOURCE_ID = "__screen_share__";
const enableCamsBtn = document.getElementById("enableCamsBtn");
const stopCamsBtn = document.getElementById("stopCamsBtn");
const cameraStatus = document.getElementById("cameraStatus");
const programSelect = document.getElementById("programSelect");
const mainVideo = document.getElementById("mainVideo");
const frameStreamStatusEl = document.getElementById("frameStreamStatus");

const slots = {
  back: { select: document.getElementById("backSelect"), video: document.getElementById("backVideo"), stream: null },
  front: { select: document.getElementById("frontSelect"), video: document.getElementById("frontVideo"), stream: null },
  top: { select: document.getElementById("topSelect"), video: document.getElementById("topVideo"), stream: null },
};

const cameraSupported =
  Boolean(navigator.mediaDevices) &&
  typeof navigator.mediaDevices.getUserMedia === "function" &&
  typeof navigator.mediaDevices.enumerateDevices === "function";
const screenShareSupported =
  Boolean(navigator.mediaDevices) &&
  typeof navigator.mediaDevices.getDisplayMedia === "function";
const sourceSupported = cameraSupported || screenShareSupported;
let localVideoDevices = [];

const frameBackendUrl = getBackendSocketUrl();
const FRAME_STREAM_FPS = 8;
const FRAME_STREAM_QUALITY = 0.6;
const FRAME_STREAM_MAX_WIDTH = 640;
const FRAME_STREAM_RECONNECT_MS = 1500;
let frameSocket = null;
let frameReconnectTimeoutId = null;
let framePumpIntervalId = null;
let manualFrameSocketClose = false;
const frameCaptureCanvas = document.createElement("canvas");
const frameCaptureContext = frameCaptureCanvas.getContext("2d", { alpha: false });

const FRONT_LABEL_HINTS = [
  "iphone",
  "front",
  "continuity",
  "ios",
  "phone",
];

const TOP_LABEL_HINTS = [
  "logitech",
  "webcam",
  "usb",
  "brio",
  "c920",
  "c922",
  "c930",
];

const SLOT_DEVICE_PREFERENCES = {
  front: [
    "prum iphone 17 pro",
    "iphone 17 pro",
    "prum iphone",
    "continuity camera",
    "continuity",
    "iphone",
  ],
  top: [
    "prum iphone 17 pro",
    "iphone 17 pro",
    "prum iphone",
    "continuity camera",
    "continuity",
    "iphone",
    "iphone 14 pro",
  ],
};

const SLOT_DISPLAY_PREFERENCES = {
  front: {
    displayName: "Prum iPhone 17 Pro",
    missingValue: "__missing_front_iphone_17_pro__",
  },
};

const setFrameStreamStatus = (message) => {
  if (frameStreamStatusEl) frameStreamStatusEl.textContent = message;
};

const updateStatus = (message) => {
  if (cameraStatus) cameraStatus.textContent = message;
};

const stopStream = (stream) => {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
};

const setSlotStream = (slotKey, stream) => {
  const slot = slots[slotKey];
  if (!slot) return;
  slot.stream = stream;
  if (slot.video) {
    slot.video.srcObject = stream;
    slot.video.play().catch(() => {});
  }
};

const refreshProgramFeed = () => {
  if (!mainVideo || !programSelect) return;
  const selected = slots[programSelect.value];
  mainVideo.srcObject = selected ? selected.stream : null;
};

const normalizeDeviceLabel = (label) => (
  (label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
);

const compactDeviceLabel = (label) => normalizeDeviceLabel(label).replace(/\s+/g, "");

const matchesPreferredModel = (slotKey, label) => {
  const normalized = normalizeDeviceLabel(label);
  const compactNormalized = compactDeviceLabel(label);
  if (!normalized) return false;

  const preferredModels = SLOT_DEVICE_PREFERENCES[slotKey] || [];
  return preferredModels.some((modelHint) => {
    const normalizedHint = normalizeDeviceLabel(modelHint);
    const compactHint = compactDeviceLabel(modelHint);
    return normalized.includes(normalizedHint) || compactNormalized.includes(compactHint);
  });
};

const isMissingPreferenceValue = (slotKey, value) => {
  const missingValue = SLOT_DISPLAY_PREFERENCES[slotKey]?.missingValue;
  return Boolean(missingValue) && value === missingValue;
};

const getPreferenceScore = (slotKey, label) => {
  const normalized = normalizeDeviceLabel(label);
  if (!normalized) return 0;

  if (matchesPreferredModel(slotKey, label)) return 100;

  if (slotKey === "front") {
    let score = 0;
    FRONT_LABEL_HINTS.forEach((hint) => {
      if (normalized.includes(hint)) score += 2;
    });
    if (normalized.includes("14 pro")) score -= 10;
    if (normalized.includes("built in") || normalized.includes("builtin")) score -= 2;
    if (normalized.includes("macbook") || normalized.includes("mac")) score -= 1;
    if (normalized.includes("back") || normalized.includes("rear")) score -= 3;
    return score;
  }

  if (slotKey === "top") {
    let score = 0;
    FRONT_LABEL_HINTS.forEach((hint) => {
      if (normalized.includes(hint)) score += 2;
    });
    TOP_LABEL_HINTS.forEach((hint) => {
      if (normalized.includes(hint)) score += 1;
    });
    if (normalized.includes("built in") || normalized.includes("builtin")) score -= 2;
    if (normalized.includes("macbook") || normalized.includes("mac")) score -= 1;
    return score;
  }

  return 0;
};

const listVideoDevices = async () => {
  if (!cameraSupported) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
};

const addScreenShareEndedHandler = (stream) => {
  const [videoTrack] = stream.getVideoTracks();
  if (!videoTrack) return;

  videoTrack.addEventListener("ended", () => {
    Object.values(slots).forEach((slot) => {
      if (slot.select?.value === SCREEN_SOURCE_ID) {
        stopStream(slot.stream);
        slot.stream = null;
        if (slot.video) slot.video.srcObject = null;
      }
    });
    refreshProgramFeed();
    updateStatus("FaceTime screen share ended. Choose Screen / Window again to resume.");
  }, { once: true });
};

const fillSelectOptions = (select, devices, slotKey) => {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";

  const displayPreference = SLOT_DISPLAY_PREFERENCES[slotKey];
  const preferredDevice = displayPreference
    ? devices.find((device) => matchesPreferredModel(slotKey, device.label))
    : null;

  if (displayPreference && !preferredDevice) {
    const missingOption = document.createElement("option");
    missingOption.value = displayPreference.missingValue;
    missingOption.textContent = `${displayPreference.displayName} (connect this phone)`;
    select.appendChild(missingOption);
  }

  if (screenShareSupported) {
    const screenOption = document.createElement("option");
    screenOption.value = SCREEN_SOURCE_ID;
    screenOption.textContent = "Screen / Window (FaceTime)";
    select.appendChild(screenOption);
  }

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    if (displayPreference && preferredDevice && preferredDevice.deviceId === device.deviceId) {
      option.textContent = displayPreference.displayName;
    } else {
      option.textContent = device.label || `Camera ${index + 1}`;
    }
    select.appendChild(option);
  });

  if (devices.length === 0 && !screenShareSupported) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No source found";
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  if (previous && Array.from(select.options).some((option) => option.value === previous && !option.disabled)) {
    select.value = previous;
  }
};

const findBestOptionIndex = (select, slotKey) => {
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < select.options.length; i += 1) {
    const option = select.options[i];
    const value = option.value;
    if (
      !value ||
      value === SCREEN_SOURCE_ID ||
      isMissingPreferenceValue(slotKey, value) ||
      option.disabled
    ) continue;

    const score = getPreferenceScore(slotKey, option.textContent);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
};

const applyDefaultSelections = () => {
  const keys = ["front", "top", "back"];

  keys.forEach((key) => {
    const select = slots[key].select;
    if (!select || !select.options.length || !select.options[0].value) return;

    const currentValue = select.value;
    if (
      currentValue &&
      Array.from(select.options).some((option) => option.value === currentValue && !option.disabled)
    ) {
      return;
    }

    let chosenIndex = findBestOptionIndex(select, key);

    if (chosenIndex === -1) {
      for (let i = 0; i < select.options.length; i += 1) {
        const value = select.options[i].value;
        if (
          !value ||
          value === SCREEN_SOURCE_ID ||
          isMissingPreferenceValue(key, value) ||
          select.options[i].disabled
        ) continue;
        chosenIndex = i;
        break;
      }
    }

    if (chosenIndex === -1) {
      for (let i = 0; i < select.options.length; i += 1) {
        const value = select.options[i].value;
        if (!value || select.options[i].disabled) continue;
        chosenIndex = i;
        break;
      }
    }

    if (chosenIndex === -1) chosenIndex = 0;

    select.value = select.options[chosenIndex].value;
  });
};

const refreshSourceOptions = () => {
  fillSelectOptions(slots.back.select, localVideoDevices, "back");
  fillSelectOptions(slots.front.select, localVideoDevices, "front");
  fillSelectOptions(slots.top.select, localVideoDevices, "top");
  applyDefaultSelections();
};

const getMatchingSourceSlot = (slotKey, sourceValue) => Object.entries(slots).find(([key, current]) => (
  key !== slotKey &&
  current.select &&
  current.select.value === sourceValue &&
  current.stream
));

const findPreferredDeviceId = (slotKey) => {
  const directMatch = localVideoDevices.find((device) => matchesPreferredModel(slotKey, device.label));
  if (directMatch) return directMatch.deviceId;

  const fallback = localVideoDevices
    .filter((device) => getPreferenceScore(slotKey, device.label) > 0)
    .sort((a, b) => getPreferenceScore(slotKey, b.label) - getPreferenceScore(slotKey, a.label))[0];
  return fallback?.deviceId || "";
};

const startScreenShareSlot = (slotKey) => {
  const slot = slots[slotKey];
  if (!slot || !slot.select || !slot.video || slot.select.value !== SCREEN_SOURCE_ID) {
    return Promise.resolve();
  }

  stopStream(slot.stream);
  slot.stream = null;

  const sameSourceSlot = getMatchingSourceSlot(slotKey, SCREEN_SOURCE_ID);
  if (sameSourceSlot) {
    setSlotStream(slotKey, sameSourceSlot[1].stream.clone());
    return Promise.resolve();
  }

  if (!screenShareSupported) {
    return Promise.reject(new Error("Screen sharing is not supported in this browser."));
  }

  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  }).then((stream) => {
    addScreenShareEndedHandler(stream);
    setSlotStream(slotKey, stream);
  });
};

const startSlot = async (slotKey) => {
  const slot = slots[slotKey];
  if (!slot || !slot.select || !slot.video || !slot.select.value) return;

  stopStream(slot.stream);
  slot.stream = null;

  const sameSourceSlot = getMatchingSourceSlot(slotKey, slot.select.value);
  if (sameSourceSlot) {
    setSlotStream(slotKey, sameSourceSlot[1].stream.clone());
    return;
  }

  if (slot.select.value === SCREEN_SOURCE_ID) {
    await startScreenShareSlot(slotKey);
    return;
  }

  const resolvedDeviceId = isMissingPreferenceValue(slotKey, slot.select.value)
    ? findPreferredDeviceId(slotKey)
    : slot.select.value;

  if (!resolvedDeviceId) {
    throw new Error(`${SLOT_DISPLAY_PREFERENCES[slotKey]?.displayName || "Preferred camera"} is not available yet.`);
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: resolvedDeviceId } },
    audio: false,
  });

  setSlotStream(slotKey, stream);
};

const scheduleFrameReconnect = () => {
  if (manualFrameSocketClose || framePumpIntervalId === null || frameReconnectTimeoutId !== null) return;

  setFrameStreamStatus("Reconnecting…");
  frameReconnectTimeoutId = window.setTimeout(() => {
    frameReconnectTimeoutId = null;
    connectFrameSocket();
  }, FRAME_STREAM_RECONNECT_MS);
};

const connectFrameSocket = () => {
  if (frameSocket && (frameSocket.readyState === WebSocket.OPEN || frameSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  frameSocket = new WebSocket(frameBackendUrl);

  frameSocket.addEventListener("open", () => {
    setFrameStreamStatus("Connected");
  });

  frameSocket.addEventListener("error", (error) => {
    setFrameStreamStatus("Error");
    console.error("Frame socket error:", error);
  });

  frameSocket.addEventListener("close", () => {
    frameSocket = null;
    if (manualFrameSocketClose) {
      setFrameStreamStatus("Stopped");
      return;
    }
    scheduleFrameReconnect();
  });
};

const stopFramePump = () => {
  if (framePumpIntervalId !== null) {
    window.clearInterval(framePumpIntervalId);
    framePumpIntervalId = null;
  }
};

const closeFrameSocket = () => {
  manualFrameSocketClose = true;
  stopFramePump();

  if (frameReconnectTimeoutId !== null) {
    window.clearTimeout(frameReconnectTimeoutId);
    frameReconnectTimeoutId = null;
  }

  if (frameSocket && (frameSocket.readyState === WebSocket.OPEN || frameSocket.readyState === WebSocket.CONNECTING)) {
    frameSocket.close();
  }
  frameSocket = null;
  setFrameStreamStatus("Stopped");
};

const getBackendFrameSource = () => {
  if (slots.front.stream && slots.front.video) return slots.front;

  if (programSelect) {
    const selectedSlot = slots[programSelect.value];
    if (selectedSlot && selectedSlot.stream && selectedSlot.video) return selectedSlot;
  }

  return Object.values(slots).find((slot) => slot.stream && slot.video) || null;
};

const sendFrameToBackend = () => {
  if (!frameCaptureContext) return;
  if (!frameSocket || frameSocket.readyState !== WebSocket.OPEN) return;

  const sourceSlot = getBackendFrameSource();
  if (!sourceSlot || !sourceSlot.video) return;

  const sourceVideo = sourceSlot.video;
  if (
    sourceVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    sourceVideo.videoWidth < 2 ||
    sourceVideo.videoHeight < 2
  ) return;

  let targetWidth = sourceVideo.videoWidth;
  let targetHeight = sourceVideo.videoHeight;

  if (targetWidth > FRAME_STREAM_MAX_WIDTH) {
    const scale = FRAME_STREAM_MAX_WIDTH / targetWidth;
    targetWidth = FRAME_STREAM_MAX_WIDTH;
    targetHeight = Math.max(2, Math.round(targetHeight * scale));
  }

  if (frameCaptureCanvas.width !== targetWidth || frameCaptureCanvas.height !== targetHeight) {
    frameCaptureCanvas.width = targetWidth;
    frameCaptureCanvas.height = targetHeight;
  }

  frameCaptureContext.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);
  const dataUrl = frameCaptureCanvas.toDataURL("image/jpeg", FRAME_STREAM_QUALITY);
  const imageData = dataUrl.split(",", 2)[1];
  if (!imageData) return;
  const sourceLabel = sourceSlot.select?.selectedOptions?.[0]?.textContent?.trim()
    || (sourceSlot === slots.front ? "Prum iPhone 17 Pro" : "Camera Source");

  frameSocket.send(JSON.stringify({
    type: "frame",
    image: imageData,
    width: targetWidth,
    height: targetHeight,
    source: sourceSlot === slots.front ? "front" : (programSelect?.value || "auto"),
    sourceLabel,
    timestamp: Date.now(),
  }));
};

const startFramePump = () => {
  manualFrameSocketClose = false;
  setFrameStreamStatus("Connecting…");
  connectFrameSocket();

  if (framePumpIntervalId !== null) return;
  framePumpIntervalId = window.setInterval(sendFrameToBackend, Math.round(1000 / FRAME_STREAM_FPS));
};

const stopAllCameras = () => {
  Object.values(slots).forEach((slot) => {
    stopStream(slot.stream);
    slot.stream = null;
    if (slot.video) slot.video.srcObject = null;
  });

  if (mainVideo) mainVideo.srcObject = null;
  closeFrameSocket();
  updateStatus("Cameras stopped.");
};

const enableCameras = async () => {
  if (!sourceSupported) {
    updateStatus("Camera and screen-share APIs are not supported in this browser.");
    return;
  }

  try {
    updateStatus("Preparing Prum iPhone 17 Pro and FaceTime sources...");

    if (cameraSupported) {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        stopStream(tempStream);
      } catch (permissionError) {
        // Continue with available sources such as screen share.
      }
    }

    localVideoDevices = await listVideoDevices();
    refreshSourceOptions();

    const startResults = await Promise.allSettled([
      startSlot("front"),
      startSlot("top"),
    ]);

    const successCount = startResults.filter((result) => result.status === "fulfilled").length;
    refreshProgramFeed();

    if (successCount > 0) {
      startFramePump();
      updateStatus("Sources connected. Choose Prum iPhone 17 Pro or Screen / Window (FaceTime).");
    } else if (screenShareSupported) {
      stopFramePump();
      updateStatus("No camera started yet. Choose Screen / Window (FaceTime) to show your FaceTime call.");
    } else {
      stopFramePump();
      updateStatus("No camera sources available. Check browser permissions and connected devices.");
    }
  } catch (error) {
    closeFrameSocket();
    updateStatus("Cannot initialize sources. Check browser permissions and reload.");
    console.error(error);
  }
};

setFrameStreamStatus("Waiting…");
if (cameraStatus) {
  updateStatus("Enable Cameras, then choose Prum iPhone 17 Pro or Screen / Window (FaceTime).");
}

if (sourceSupported && enableCamsBtn && stopCamsBtn) {
  enableCamsBtn.addEventListener("click", () => {
    enableCameras();
  });

  stopCamsBtn.addEventListener("click", () => {
    stopAllCameras();
  });

  Object.entries(slots).forEach(([slotKey, slot]) => {
    if (!slot.select) return;

    slot.select.addEventListener("change", () => {
      if (slot.select.value === SCREEN_SOURCE_ID) {
        updateStatus("Choose your FaceTime window in the share prompt.");
        startScreenShareSlot(slotKey)
          .then(() => {
            refreshProgramFeed();
            startFramePump();
            updateStatus("FaceTime screen share connected. Python detection feed updated.");
          })
          .catch((error) => {
            updateStatus("Screen share was canceled or blocked.");
            console.error(error);
          });
        return;
      }

      (async () => {
        try {
          await startSlot(slotKey);
          refreshProgramFeed();
          startFramePump();
          updateStatus("Camera source updated. Python detection feed updated.");
        } catch (error) {
          updateStatus(error.message || "Failed to switch camera source.");
          console.error(error);
        }
      })();
    });
  });

  if (programSelect) {
    programSelect.addEventListener("change", () => {
      refreshProgramFeed();
    });
  }

  window.addEventListener("beforeunload", () => {
    closeFrameSocket();
  });
} else if (cameraStatus) {
  updateStatus("Camera controls are unavailable in this browser.");
}
