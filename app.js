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

const SCREEN_SOURCE_ID = "__screen_share__";
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
const screenShareSupported =
  Boolean(navigator.mediaDevices) &&
  typeof navigator.mediaDevices.getDisplayMedia === "function";
const sourceSupported = cameraSupported || screenShareSupported;
let localVideoDevices = [];

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

const refreshProgramFeed = () => {
  if (!mainVideo || !programSelect) return;
  const selected = slots[programSelect.value];
  mainVideo.srcObject = selected ? selected.stream : null;
};

const listVideoDevices = async () => {
  if (!cameraSupported) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
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

  if (slotKey === "front") {
    const fallback = localVideoDevices
      .filter((device) => getPreferenceScore("front", device.label) > 0)
      .sort((a, b) => getPreferenceScore("front", b.label) - getPreferenceScore("front", a.label))[0];
    if (fallback) return fallback.deviceId;
  }

  return "";
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
      updateStatus("Sources connected. Choose Prum iPhone 17 Pro or Screen / Window (FaceTime).");
    } else if (screenShareSupported) {
      updateStatus("No camera started yet. Choose Screen / Window (FaceTime) to show your FaceTime call.");
    } else {
      updateStatus("No camera sources available. Check browser permissions and connected devices.");
    }
  } catch (error) {
    updateStatus("Cannot initialize sources. Check browser permissions and reload.");
    console.error(error);
  }
};

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
            updateStatus("FaceTime screen share connected.");
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
          updateStatus("Camera source updated.");
        } catch (error) {
          updateStatus(error.message || "Failed to switch camera source.");
          console.error(error);
        }
      })();
    });
  });

  if (programSelect) {
    programSelect.addEventListener("change", refreshProgramFeed);
  }
} else if (cameraStatus) {
  updateStatus("Camera controls are unavailable in this browser.");
}
