const START_GATE_KEY = "raceControlStarted";
const AUTO_START_KEY = "raceControlAutoStart";
const exitBtn = document.getElementById("exitBtn");

if (exitBtn) {
  exitBtn.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(START_GATE_KEY);
      sessionStorage.removeItem(AUTO_START_KEY);
    } catch (error) {
      // Ignore storage errors.
    }
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

const enableCamsBtn = document.getElementById("enableCamsBtn");
const stopCamsBtn = document.getElementById("stopCamsBtn");
const cameraStatus = document.getElementById("cameraStatus");
const programSelect = document.getElementById("programSelect");
const mainVideo = document.getElementById("mainVideo");
const laneOverlayCanvas = document.getElementById("laneOverlayCanvas");
const laneOverlayStatus = document.getElementById("laneOverlayStatus");
const toggleLaneOverlayBtn = document.getElementById("toggleLaneOverlayBtn");
const backendDebugPreview = document.getElementById("backendDebugPreview");
const backendDebugStatus = document.getElementById("backendDebugStatus");
const toggleBackendDebugBtn = document.getElementById("toggleBackendDebugBtn");

const GUIDE_W = 640;
const GUIDE_H = 360;
const GUIDE_POINTS = [
  [4, 176], [68, 177], [116, 176], [139, 168], [152, 153], [157, 136],
  [159, 113], [162, 91], [174, 76], [196, 63], [212, 61], [231, 65],
  [243, 79], [246, 96], [247, 123], [247, 149], [248, 177], [248, 206],
  [248, 233], [250, 255], [259, 275], [273, 288], [291, 291], [308, 284],
  [317, 268], [320, 247], [323, 226], [323, 207], [330, 192], [348, 183],
  [367, 183], [388, 183], [408, 181], [425, 175], [438, 163], [448, 148],
  [451, 129], [453, 110], [455, 92], [466, 78], [480, 69], [499, 66],
  [515, 69], [525, 76], [534, 91], [536, 112], [537, 140], [537, 190],
  [538, 266], [540, 355],
];

const slots = {
  back: { select: document.getElementById("backSelect"), video: document.getElementById("backVideo"), stream: null },
  front: { select: document.getElementById("frontSelect"), video: document.getElementById("frontVideo"), stream: null },
  top: { select: document.getElementById("topSelect"), video: document.getElementById("topVideo"), stream: null },
};

const cameraSupported =
  Boolean(navigator.mediaDevices) &&
  typeof navigator.mediaDevices.getUserMedia === "function" &&
  typeof navigator.mediaDevices.enumerateDevices === "function";

const backendProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const backendUrl = `${backendProtocol}//${window.location.host}/ws/race`;

let laneOverlayVisible = true;
let laneOverlayRafId = null;
let backendPreviewEnabled = true;
let backendPreviewFrameCount = 0;
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
let streamingIntervalId = null;
let encodingFrame = false;
let autoStartConsumed = false;

const players = [];
const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d", { alpha: false, willReadFrequently: false });

const normalizeVec = (x, y) => {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
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

const updateCameraStatus = (message) => {
  if (cameraStatus) cameraStatus.textContent = message;
};

const updateBackendDebugStatus = (message) => {
  if (backendDebugStatus) backendDebugStatus.textContent = message;
};

const clearBackendDebugPreview = () => {
  if (backendDebugPreview) backendDebugPreview.removeAttribute("src");
};

const renderBackendDebugPreview = (payload) => {
  if (!backendPreviewEnabled || !backendDebugPreview || !payload?.imageBase64) return;
  backendPreviewFrameCount += 1;
  backendDebugPreview.src = `data:image/jpeg;base64,${payload.imageBase64}`;
  const suffix = payload.debugText ? ` | ${payload.debugText}` : "";
  updateBackendDebugStatus(`Backend preview frame ${backendPreviewFrameCount}${suffix}`);
};

const formatTime = (ms) => {
  const totalCentiseconds = Math.floor(ms / 10);
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
};

const formatSeconds = (seconds) => `${Number(seconds || 0).toFixed(2)}s`;

const updateTimer = () => {
  const now = performance.now();
  const elapsed = elapsedBefore + (now - startTime);
  timerEl.textContent = formatTime(elapsed);
  timerRafId = requestAnimationFrame(updateTimer);
};

const startFrontendTimer = () => {
  if (timerRafId !== null) return;
  startTime = performance.now();
  timerRafId = requestAnimationFrame(updateTimer);
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

const getAuthoritativeMs = () => {
  if (latestBackendResult && Number.isFinite(latestBackendResult.finalMs)) {
    return latestBackendResult.finalMs;
  }
  if (timerRafId === null) return elapsedBefore;
  return elapsedBefore + (performance.now() - startTime);
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

  const ranked = players.filter((player) => Number.isFinite(player.bestMs)).sort((a, b) => a.bestMs - b.bestMs);
  if (!ranked.length) {
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

  if (players.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
    setScoreStatus("Player name already exists.");
    return;
  }

  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  players.push({ id, name, bestMs: Number.POSITIVE_INFINITY });
  playerNameInput.value = "";
  renderPlayerOptions();
  renderScoreboard();
  playerSelect.value = id;
  setScoreStatus(`Added player: ${name}`);
};

const saveTimeForPlayer = () => {
  if (!playerSelect || !playerSelect.value) {
    setScoreStatus("Please add or select a player first.");
    return;
  }

  const player = players.find((entry) => entry.id === playerSelect.value);
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
    setScoreStatus(`Saved ${player.name}: ${formatTime(currentMs)}`);
  } else {
    setScoreStatus(`${player.name} time ${formatTime(currentMs)} is slower than best ${formatTime(player.bestMs)}`);
  }

  renderScoreboard();
};

const resizeLaneOverlayCanvas = () => {
  if (!laneOverlayCanvas || !mainVideo) return;
  const rect = mainVideo.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (laneOverlayCanvas.width !== width) laneOverlayCanvas.width = width;
  if (laneOverlayCanvas.height !== height) laneOverlayCanvas.height = height;
};

const scaleGuidePoints = (width, height) => {
  const scaleX = width / GUIDE_W;
  const scaleY = height / GUIDE_H;
  return GUIDE_POINTS.map(([x, y]) => [x * scaleX, y * scaleY]);
};

const drawCrossLine = (ctx, point, direction, roadThickness, color, label) => {
  const [dx, dy] = direction;
  const perpX = -dy;
  const perpY = dx;
  const lineHalf = roadThickness / 2 + 10;

  const ax = point[0] + perpX * lineHalf;
  const ay = point[1] + perpY * lineHalf;
  const bx = point[0] - perpX * lineHalf;
  const by = point[1] - perpY * lineHalf;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "bold 16px Arial";
  ctx.fillText(label, ax - 24, ay - 10);
  ctx.restore();
};

const drawLaneOverlay = () => {
  if (!laneOverlayCanvas || !mainVideo) return;

  resizeLaneOverlayCanvas();
  const ctx = laneOverlayCanvas.getContext("2d");
  const width = laneOverlayCanvas.width;
  const height = laneOverlayCanvas.height;
  ctx.clearRect(0, 0, width, height);

  if (!laneOverlayVisible || !mainVideo.srcObject || mainVideo.readyState < 2) {
    laneOverlayRafId = requestAnimationFrame(drawLaneOverlay);
    return;
  }

  const points = scaleGuidePoints(width, height);
  const roadThickness = Math.max(30, Math.round(Math.min(width, height) * 0.15));
  const startPoint = points[0];
  const nextStartPoint = points[1];
  const endPrevPoint = points[points.length - 2];
  const endPoint = points[points.length - 1];
  const startDir = normalizeVec(nextStartPoint[0] - startPoint[0], nextStartPoint[1] - startPoint[1]);
  const finishDir = normalizeVec(endPoint[0] - endPrevPoint[0], endPoint[1] - endPrevPoint[1]);

  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = roadThickness;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#00e7ff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#ffd84d";
  ctx.font = "11px Arial";
  points.forEach(([x, y], index) => {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (index % 5 === 0 || index === 0 || index === points.length - 1) {
      ctx.fillText(String(index), x + 6, y - 6);
    }
  });
  ctx.restore();

  drawCrossLine(ctx, startPoint, startDir, roadThickness, "#ff4d4d", "START");
  drawCrossLine(ctx, endPoint, finishDir, roadThickness, "#33dd66", "FINISH");

  if (laneOverlayStatus) {
    laneOverlayStatus.textContent = `Lane overlay visible | ${width}×${height}`;
  }

  laneOverlayRafId = requestAnimationFrame(drawLaneOverlay);
};

const startLaneOverlay = () => {
  if (!laneOverlayCanvas || !mainVideo) return;
  if (laneOverlayRafId !== null) cancelAnimationFrame(laneOverlayRafId);
  laneOverlayRafId = requestAnimationFrame(drawLaneOverlay);
};

const stopLaneOverlay = () => {
  if (laneOverlayRafId !== null) {
    cancelAnimationFrame(laneOverlayRafId);
    laneOverlayRafId = null;
  }
  if (laneOverlayCanvas) {
    const ctx = laneOverlayCanvas.getContext("2d");
    ctx.clearRect(0, 0, laneOverlayCanvas.width, laneOverlayCanvas.height);
  }
};

toggleLaneOverlayBtn?.addEventListener("click", () => {
  laneOverlayVisible = !laneOverlayVisible;
  if (laneOverlayStatus) {
    laneOverlayStatus.textContent = laneOverlayVisible ? "Lane overlay enabled." : "Lane overlay hidden.";
  }
});

toggleBackendDebugBtn?.addEventListener("click", () => {
  backendPreviewEnabled = !backendPreviewEnabled;
  toggleBackendDebugBtn.textContent = backendPreviewEnabled ? "Pause Preview" : "Resume Preview";
  if (!backendPreviewEnabled) {
    clearBackendDebugPreview();
    updateBackendDebugStatus("Backend preview paused.");
  } else {
    updateBackendDebugStatus("Backend preview resumed. Waiting for next processed frame.");
  }
  sendPreviewPreference();
});

const stopStream = (stream) => {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
};

const refreshProgramFeed = () => {
  if (!mainVideo || !programSelect) return;
  const selected = slots[programSelect.value];
  mainVideo.srcObject = selected?.stream || null;
  if (mainVideo.srcObject) {
    mainVideo.play().catch(() => {});
    startLaneOverlay();
  } else {
    stopLaneOverlay();
  }
};

const listVideoDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
};

const fillSelectOptions = (select, devices) => {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";

  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;
    select.appendChild(option);
  });

  if (!devices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No camera found";
    select.appendChild(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  if (previous && devices.some((device) => device.deviceId === previous)) {
    select.value = previous;
  }
};

const applyDefaultSelections = () => {
  const allValues = Array.from(
    new Set(
      Object.values(slots)
        .flatMap((slot) => Array.from(slot.select?.options || []).map((option) => option.value))
        .filter(Boolean)
    )
  );

  if (!allValues.length) return;
  if (slots.front.select && !slots.front.select.value) slots.front.select.value = allValues[0] || "";
  if (slots.top.select && !slots.top.select.value) slots.top.select.value = allValues[1] || allValues[0] || "";
  if (slots.back.select && !slots.back.select.value) slots.back.select.value = allValues[2] || allValues[0] || "";
};

const startSlot = async (slotKey) => {
  const slot = slots[slotKey];
  if (!slot?.select || !slot.video || !slot.select.value) return;

  stopStream(slot.stream);
  slot.stream = null;

  const sameSourceSlot = Object.entries(slots).find(([key, current]) => (
    key !== slotKey &&
    current.select &&
    current.select.value === slot.select.value &&
    current.stream
  ));

  if (sameSourceSlot) {
    slot.stream = sameSourceSlot[1].stream.clone();
    slot.video.srcObject = slot.stream;
    await slot.video.play().catch(() => {});
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: { exact: slot.select.value },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: false,
  });

  slot.stream = stream;
  slot.video.srcObject = stream;
  await slot.video.play().catch(() => {});
};

const stopAllCameras = () => {
  Object.values(slots).forEach((slot) => {
    stopStream(slot.stream);
    slot.stream = null;
    if (slot.video) slot.video.srcObject = null;
  });

  if (mainVideo) mainVideo.srcObject = null;
  stopFrameStreaming();
  stopLaneOverlay();
  clearBackendDebugPreview();
  updateBackendDebugStatus("Backend preview paused because cameras are stopped.");
  updateCameraStatus("Cameras stopped.");
};

const enableCameras = async () => {
  if (!cameraSupported) {
    updateCameraStatus("Camera API is not supported in this browser.");
    return false;
  }

  try {
    updateCameraStatus("Preparing camera sources...");
    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stopStream(tempStream);

    const devices = await listVideoDevices();
    fillSelectOptions(slots.back.select, devices);
    fillSelectOptions(slots.front.select, devices);
    fillSelectOptions(slots.top.select, devices);
    applyDefaultSelections();

    const results = await Promise.allSettled([
      startSlot("back"),
      startSlot("front"),
      startSlot("top"),
    ]);

    refreshProgramFeed();
    const successes = results.filter((result) => result.status === "fulfilled").length;
    if (!successes) {
      updateCameraStatus("No camera sources available. Check permissions and connected devices.");
      return false;
    }

    updateCameraStatus("Camera sources connected.");
    startFrameStreaming();
    return true;
  } catch (error) {
    console.error(error);
    updateCameraStatus("Cannot initialize sources. Check browser permissions and reload.");
    return false;
  }
};

const waitForVideoReady = (video) => new Promise((resolve) => {
  if (!video) {
    resolve(false);
    return;
  }

  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    resolve(true);
    return;
  }

  const timeoutId = window.setTimeout(() => {
    cleanup();
    resolve(video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
  }, 3000);

  const onReady = () => {
    cleanup();
    resolve(true);
  };

  const cleanup = () => {
    window.clearTimeout(timeoutId);
    video.removeEventListener("loadeddata", onReady);
    video.removeEventListener("loadedmetadata", onReady);
  };

  video.addEventListener("loadeddata", onReady, { once: true });
  video.addEventListener("loadedmetadata", onReady, { once: true });
});

const ensureMainFeedReady = async () => {
  const hasStream = Boolean(mainVideo?.srcObject);
  if (!hasStream) {
    const enabled = await enableCameras();
    if (!enabled) return false;
  }

  refreshProgramFeed();
  const ready = await waitForVideoReady(mainVideo);
  if (ready) startFrameStreaming();
  return ready;
};

const sendPreviewPreference = () => {
  if (!raceSocket || raceSocket.readyState !== WebSocket.OPEN) return;
  raceSocket.send(JSON.stringify({
    type: "set_preview",
    enabled: backendPreviewEnabled,
  }));
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
    sendPreviewPreference();
    if (pendingCommand) {
      raceSocket.send(JSON.stringify(pendingCommand));
      pendingCommand = null;
    }
  });

  raceSocket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      console.error("Invalid backend payload:", error, event.data);
      return;
    }

    if (payload.type === "state") {
      updatePenaltyUi(payload.penaltyCount, payload.penaltyTime);
      if (payload.message) setRaceStatus(payload.message);
      if (payload.debugText) updateBackendDebugStatus(payload.debugText);
      return;
    }

    if (payload.type === "penalty_update") {
      updatePenaltyUi(payload.penaltyCount, payload.penaltyTime);
      setRaceStatus(`Penalty updated: ${payload.penaltyCount} event(s).`);
      return;
    }

    if (payload.type === "preview") {
      renderBackendDebugPreview(payload);
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
  });

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
    setRaceStatus("Could not talk to the Python backend.");
  });
};

const sendBackendMessage = (payload) => {
  if (!raceSocket || raceSocket.readyState !== WebSocket.OPEN) {
    pendingCommand = payload;
    connectBackend();
    return false;
  }

  raceSocket.send(JSON.stringify(payload));
  pendingCommand = null;
  return true;
};

const sendFrameToBackend = () => {
  if (!mainVideo || !raceSocket || raceSocket.readyState !== WebSocket.OPEN) return;
  if (!mainVideo.srcObject || mainVideo.readyState < 2 || !mainVideo.videoWidth || !mainVideo.videoHeight) return;
  if (encodingFrame || raceSocket.bufferedAmount > 1_000_000) return;

  encodingFrame = true;

  const sourceWidth = mainVideo.videoWidth;
  const sourceHeight = mainVideo.videoHeight;
  const targetWidth = Math.min(sourceWidth, 960);
  const targetHeight = Math.round((targetWidth / sourceWidth) * sourceHeight);

  captureCanvas.width = targetWidth;
  captureCanvas.height = targetHeight;
  captureCtx.drawImage(mainVideo, 0, 0, targetWidth, targetHeight);

  captureCanvas.toBlob((blob) => {
    if (blob && raceSocket && raceSocket.readyState === WebSocket.OPEN) {
      raceSocket.send(blob);
    }
    encodingFrame = false;
  }, "image/jpeg", 0.72);
};

const startFrameStreaming = () => {
  if (streamingIntervalId !== null) return;
  streamingIntervalId = window.setInterval(sendFrameToBackend, 100);
};

const stopFrameStreaming = () => {
  if (streamingIntervalId !== null) {
    window.clearInterval(streamingIntervalId);
    streamingIntervalId = null;
  }
  encodingFrame = false;
};

const consumeAutoStartFlag = () => {
  if (autoStartConsumed) return false;
  autoStartConsumed = true;
  try {
    const shouldAutoStart = sessionStorage.getItem(AUTO_START_KEY) === "true";
    sessionStorage.removeItem(AUTO_START_KEY);
    return shouldAutoStart;
  } catch (error) {
    return false;
  }
};

if (cameraSupported && enableCamsBtn && stopCamsBtn) {
  enableCamsBtn.addEventListener("click", async () => {
    await enableCameras();
  });

  stopCamsBtn.addEventListener("click", () => {
    stopAllCameras();
  });

  Object.entries(slots).forEach(([slotKey, slot]) => {
    if (!slot.select) return;
    slot.select.addEventListener("change", async () => {
      try {
        await startSlot(slotKey);
        refreshProgramFeed();
        startFrameStreaming();
        updateCameraStatus("Camera source updated.");
      } catch (error) {
        console.error(error);
        updateCameraStatus("Failed to switch camera source.");
      }
    });
  });

  if (programSelect) {
    programSelect.addEventListener("change", () => {
      refreshProgramFeed();
      startFrameStreaming();
    });
  }

  mainVideo?.addEventListener("loadedmetadata", startLaneOverlay);
  mainVideo?.addEventListener("loadeddata", startLaneOverlay);
  mainVideo?.addEventListener("play", startLaneOverlay);
  window.addEventListener("resize", startLaneOverlay);
} else if (cameraStatus) {
  updateCameraStatus("Camera controls are unavailable in this browser.");
}

if (timerEl && startBtn && stopBtn && resetBtn) {
  startBtn.addEventListener("click", async () => {
    hideFinalResult();
    updatePenaltyUi(0, 0);

    const ready = await ensureMainFeedReady();
    if (!ready) {
      setRaceStatus("Could not start the race because the browser camera is not ready.");
      return;
    }

    resetFrontendTimer();
    startFrontendTimer();
    startFrameStreaming();
    setRaceStatus("Start command sent. Python backend is now processing browser camera frames.");
    sendBackendMessage({ type: "start" });
  });

  stopBtn.addEventListener("click", () => {
    stopFrontendTimer();
    sendBackendMessage({ type: "stop" });
    setRaceStatus("Race stopped.");
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
    stopFrameStreaming();
    stopLaneOverlay();
    clearBackendDebugPreview();
    if (raceSocket && raceSocket.readyState === WebSocket.OPEN) {
      raceSocket.close();
    }
  });

  renderPlayerOptions();
  renderScoreboard();
  hideFinalResult();
  updatePenaltyUi(0, 0);
  updateBackendDebugStatus("Waiting for Python preview…");
  connectBackend();

  if (consumeAutoStartFlag()) {
    setRaceStatus("Dashboard ready. Click Start to begin the run.");
  }
}
