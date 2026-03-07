import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const mount = document.getElementById("bg-canvas");

if (mount) {
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

if (timerEl && startBtn && stopBtn && resetBtn) {
  let startTime = 0;
  let elapsedBefore = 0;
  let timerRafId = null;
  const players = [];

  const formatTime = (ms) => {
    const totalCentiseconds = Math.floor(ms / 10);
    const minutes = Math.floor(totalCentiseconds / 6000);
    const seconds = Math.floor((totalCentiseconds % 6000) / 100);
    const centiseconds = totalCentiseconds % 100;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
  };

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

  const setScoreStatus = (message) => {
    if (scoreStatus) scoreStatus.textContent = message;
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

    const currentMs = getCurrentElapsed();
    if (currentMs <= 0) {
      setScoreStatus("Timer is zero. Run timer before saving.");
      return;
    }

    if (currentMs < player.bestMs) {
      player.bestMs = currentMs;
      setScoreStatus(`Saved new best for ${player.name}: ${formatTime(currentMs)}`);
    } else {
      setScoreStatus(`${player.name} time ${formatTime(currentMs)} is slower than best ${formatTime(player.bestMs)}`);
    }

    renderScoreboard();
  };

  startBtn.addEventListener("click", () => {
    if (timerRafId !== null) return;
    startTime = performance.now();
    timerRafId = requestAnimationFrame(update);
  });

  stopBtn.addEventListener("click", () => {
    if (timerRafId === null) return;
    cancelAnimationFrame(timerRafId);
    timerRafId = null;
    elapsedBefore += performance.now() - startTime;
    timerEl.textContent = formatTime(elapsedBefore);
  });

  resetBtn.addEventListener("click", () => {
    if (timerRafId !== null) {
      cancelAnimationFrame(timerRafId);
      timerRafId = null;
    }
    startTime = 0;
    elapsedBefore = 0;
    timerEl.textContent = "00:00.00";
  });

  addPlayerBtn?.addEventListener("click", addPlayer);

  playerNameInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addPlayer();
  });

  saveTimeBtn?.addEventListener("click", saveTimeForPlayer);

  renderPlayerOptions();
  renderScoreboard();
}

const enableCamsBtn = document.getElementById("enableCamsBtn");
const stopCamsBtn = document.getElementById("stopCamsBtn");
const cameraStatus = document.getElementById("cameraStatus");
const programSelect = document.getElementById("programSelect");
const mainVideo = document.getElementById("mainVideo");

const slots = {
  back: { select: document.getElementById("backSelect"), video: document.getElementById("backVideo"), stream: null },
  front: { select: document.getElementById("frontSelect"), video: document.getElementById("frontVideo"), stream: null },
  top: { select: document.getElementById("topSelect"), video: document.getElementById("topVideo"), stream: null },
};

const cameraSupported =
  Boolean(navigator.mediaDevices) &&
  typeof navigator.mediaDevices.getUserMedia === "function" &&
  typeof navigator.mediaDevices.enumerateDevices === "function";

const updateStatus = (message) => {
  if (cameraStatus) cameraStatus.textContent = message;
};

const stopStream = (stream) => {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
};

const refreshProgramFeed = () => {
  if (!mainVideo || !programSelect) return;
  const selected = slots[programSelect.value];
  mainVideo.srcObject = selected ? selected.stream : null;
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

  if (devices.length === 0) {
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
  const keys = ["back", "front", "top"];
  const used = new Set();

  keys.forEach((key) => {
    const select = slots[key].select;
    if (!select || !select.options.length || !select.options[0].value) return;

    let chosenIndex = 0;
    while (chosenIndex < select.options.length && used.has(select.options[chosenIndex].value)) {
      chosenIndex += 1;
    }
    if (chosenIndex >= select.options.length) chosenIndex = 0;

    select.value = select.options[chosenIndex].value;
    used.add(select.value);
  });
};

const startSlot = async (slotKey) => {
  const slot = slots[slotKey];
  if (!slot || !slot.select || !slot.video || !slot.select.value) return;

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
    slot.video.play().catch(() => {});
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: slot.select.value } },
    audio: false,
  });

  slot.stream = stream;
  slot.video.srcObject = stream;
  slot.video.play().catch(() => {});
};

const stopAllCameras = () => {
  Object.values(slots).forEach((slot) => {
    stopStream(slot.stream);
    slot.stream = null;
    if (slot.video) slot.video.srcObject = null;
  });

  if (mainVideo) mainVideo.srcObject = null;
  updateStatus("Cameras stopped.");
};

const enableCameras = async () => {
  if (!cameraSupported) {
    updateStatus("Camera API is not supported in this browser.");
    return;
  }

  try {
    updateStatus("Requesting camera permission...");

    const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stopStream(tempStream);

    const devices = await listVideoDevices();
    fillSelectOptions(slots.back.select, devices);
    fillSelectOptions(slots.front.select, devices);
    fillSelectOptions(slots.top.select, devices);
    applyDefaultSelections();

    await startSlot("back");
    await startSlot("front");
    await startSlot("top");

    refreshProgramFeed();
    updateStatus("Cameras connected.");
  } catch (error) {
    updateStatus("Cannot access cameras. Allow camera permission and reload.");
    console.error(error);
  }
};

if (cameraSupported && enableCamsBtn && stopCamsBtn) {
  enableCamsBtn.addEventListener("click", () => {
    enableCameras();
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
        updateStatus("Camera source updated.");
      } catch (error) {
        updateStatus("Failed to switch camera source.");
        console.error(error);
      }
    });
  });

  if (programSelect) {
    programSelect.addEventListener("change", refreshProgramFeed);
  }
} else if (cameraStatus) {
  updateStatus("Camera controls are unavailable in this browser.");
}
