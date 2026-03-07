const timerEl = document.getElementById("timer");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resetBtn = document.getElementById("resetBtn");

if (timerEl && startBtn && stopBtn && resetBtn) {
  let startTime = 0;
  let elapsedBefore = 0;
  let rafId = null;

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
    rafId = requestAnimationFrame(update);
  };

  startBtn.addEventListener("click", () => {
    if (rafId !== null) return;
    startTime = performance.now();
    rafId = requestAnimationFrame(update);
  });

  stopBtn.addEventListener("click", () => {
    if (rafId === null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
    elapsedBefore =
      elapsedBefore + (performance.now() - startTime);
    timerEl.textContent = formatTime(elapsedBefore);
  });

  resetBtn.addEventListener("click", () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    startTime = 0;
    elapsedBefore = 0;
    timerEl.textContent = "00:00.00";
  });
}

const enableCamsBtn = document.getElementById("enableCamsBtn");
const stopCamsBtn = document.getElementById("stopCamsBtn");
const cameraStatus = document.getElementById("cameraStatus");
const programSelect = document.getElementById("programSelect");
const mainVideo = document.getElementById("mainVideo");

const slots = {
  back: {
    select: document.getElementById("backSelect"),
    video: document.getElementById("backVideo"),
    stream: null,
  },
  front: {
    select: document.getElementById("frontSelect"),
    video: document.getElementById("frontVideo"),
    stream: null,
  },
  top: {
    select: document.getElementById("topSelect"),
    video: document.getElementById("topVideo"),
    stream: null,
  },
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
  const slotKey = programSelect.value;
  const selectedSlot = slots[slotKey];
  mainVideo.srcObject = selectedSlot ? selectedSlot.stream : null;
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
    while (
      chosenIndex < select.options.length &&
      used.has(select.options[chosenIndex].value)
    ) {
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
  const existingSlot = Object.entries(slots).find(([key, current]) => {
    return (
      key !== slotKey &&
      current.select &&
      current.select.value === slot.select.value &&
      current.stream
    );
  });

  if (existingSlot) {
    slot.stream = existingSlot[1].stream.clone();
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
    const tempStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
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

const trackBg = document.querySelector(".track-bg");
const trackGroup = document.getElementById("trackGroup");
const trackOuter = document.getElementById("trackOuter");
const trackInner = document.getElementById("trackInner");
const trackCore = document.getElementById("trackCore");

if (trackBg && trackGroup && trackOuter && trackInner && trackCore) {
  const trackShapes = [
    "M 110 560 C 110 360 260 250 430 260 C 590 270 710 380 790 390 C 860 398 900 330 890 240 C 880 150 770 80 610 80 C 450 80 330 120 230 190 C 130 260 110 380 110 560 Z",
    "M 160 520 C 130 400 200 260 330 220 C 470 180 630 230 730 290 C 810 338 880 300 890 220 C 900 150 840 90 740 90 C 610 90 520 130 440 160 C 320 205 240 180 190 120 C 145 70 85 95 80 170 C 75 260 125 360 160 520 Z",
    "M 210 600 C 180 520 185 420 240 350 C 300 275 390 245 510 250 C 640 255 730 340 790 340 C 840 340 885 300 900 235 C 920 145 860 90 760 90 C 675 90 620 120 580 170 C 525 235 480 260 430 260 C 355 260 315 220 285 165 C 250 95 170 85 140 160 C 100 260 140 420 210 600 Z",
    "M 140 500 C 120 360 190 250 300 220 C 420 190 540 230 630 320 C 690 380 720 460 760 500 C 810 550 900 520 920 430 C 940 335 880 250 790 230 C 700 210 640 180 590 120 C 540 65 470 55 420 100 C 360 155 315 180 255 170 C 180 155 140 110 115 80 C 80 40 30 65 30 130 C 30 210 80 300 140 500 Z",
    "M 250 560 C 190 490 170 390 210 320 C 250 250 320 230 430 240 C 560 252 690 360 780 360 C 860 360 910 300 920 220 C 930 140 880 95 810 95 C 710 95 650 150 620 225 C 590 300 535 330 450 330 C 355 330 300 280 300 210 C 300 140 250 95 190 95 C 120 95 80 140 80 210 C 80 310 150 450 250 560 Z",
    "M 180 560 C 130 470 120 360 170 290 C 230 205 335 190 435 225 C 520 255 575 320 635 385 C 690 445 760 480 835 455 C 900 435 925 370 920 305 C 915 235 880 195 820 180 C 745 160 715 115 695 70 C 675 25 620 15 575 45 C 520 80 505 145 460 185 C 420 220 365 235 290 215 C 205 190 155 120 130 80 C 100 30 40 45 35 115 C 30 220 95 410 180 560 Z",
    "M 180 520 C 170 410 230 330 330 320 C 430 310 520 360 570 430 C 620 495 690 550 780 540 C 860 530 910 465 910 390 C 910 300 845 245 760 245 C 650 245 620 180 600 110 C 580 40 510 25 465 70 C 420 115 435 170 410 220 C 380 275 330 285 255 255 C 165 220 130 130 115 70 C 100 15 30 20 25 95 C 18 220 80 420 180 520 Z",
    "M 120 550 C 110 455 145 355 215 295 C 300 220 405 220 520 270 C 615 312 665 400 740 425 C 820 450 900 400 905 320 C 910 250 870 205 815 190 C 735 168 690 115 655 60 C 615 -5 540 -5 500 55 C 450 130 405 155 330 145 C 245 132 210 75 190 30 C 165 -25 95 -10 75 65 C 48 170 65 380 120 550 Z",
    "M 210 570 C 130 490 120 355 190 265 C 260 175 380 160 470 205 C 550 245 610 330 675 385 C 740 440 840 455 905 390 C 965 330 950 235 880 190 C 810 145 735 170 680 130 C 620 85 610 15 550 15 C 490 15 470 90 420 130 C 360 180 290 160 245 100 C 205 45 140 45 105 105 C 55 185 95 390 210 570 Z",
    "M 220 520 C 170 470 150 400 165 340 C 190 245 270 195 355 195 C 440 195 500 235 570 285 C 635 330 720 360 795 340 C 875 320 915 250 905 180 C 892 95 810 60 730 85 C 650 110 605 175 530 205 C 445 240 365 230 300 185 C 235 140 210 80 205 40 C 195 -30 115 -10 95 75 C 70 180 110 365 220 520 Z",
    "M 100 520 C 90 440 120 330 180 280 C 260 210 380 225 460 290 C 520 340 555 410 620 460 C 690 515 800 525 875 460 C 940 405 940 300 875 245 C 820 200 740 205 685 165 C 620 115 600 40 540 25 C 470 5 415 65 365 120 C 320 170 260 185 200 160 C 140 135 110 90 95 50 C 70 -15 0 15 0 95 C 0 235 40 400 100 520 Z",
    "M 240 610 C 170 525 155 410 200 320 C 255 215 360 175 470 205 C 565 230 640 305 700 385 C 760 465 845 510 920 470 C 980 438 1000 370 975 300 C 950 230 885 190 810 200 C 730 210 670 185 620 125 C 570 65 510 30 445 55 C 370 84 360 170 295 205 C 235 238 170 220 130 170 C 90 120 25 140 15 225 C 0 350 90 530 240 610 Z",
  ];

  let currentIndex = -1;

  const pickNextIndex = () => {
    let nextIndex = Math.floor(Math.random() * trackShapes.length);
    if (trackShapes.length > 1 && nextIndex === currentIndex) {
      nextIndex = (nextIndex + 1) % trackShapes.length;
    }
    return nextIndex;
  };

  const drawTrack = (index) => {
    const pathData = trackShapes[index];
    trackOuter.setAttribute("d", pathData);
    trackInner.setAttribute("d", pathData);
    trackCore.setAttribute("d", pathData);

    const rotation = (Math.random() * 14) - 7;
    const shiftX = (Math.random() * 30) - 15;
    const shiftY = (Math.random() * 18) - 9;
    const scale = 0.96 + (Math.random() * 0.08);
    trackGroup.style.transform = `translate(${shiftX}px, ${shiftY}px) rotate(${rotation}deg) scale(${scale})`;
  };

  const swapTrack = () => {
    const nextIndex = pickNextIndex();
    trackBg.classList.add("switching");
    setTimeout(() => {
      drawTrack(nextIndex);
      trackBg.classList.remove("switching");
      currentIndex = nextIndex;
    }, 220);
  };

  const firstIndex = pickNextIndex();
  drawTrack(firstIndex);
  currentIndex = firstIndex;
  setInterval(swapTrack, 4500);
}
