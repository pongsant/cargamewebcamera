import {
  RTC_CONFIG,
  buildWebSocketUrl,
  normalizeRoomCode,
} from "./rtc-shared.js";

const roomInput = document.getElementById("roomInput");
const cameraNameInput = document.getElementById("cameraNameInput");
const facingModeSelect = document.getElementById("facingModeSelect");
const joinCameraBtn = document.getElementById("joinCameraBtn");
const leaveCameraBtn = document.getElementById("leaveCameraBtn");
const phoneStatus = document.getElementById("phoneStatus");
const phonePreview = document.getElementById("phonePreview");

const pageParams = new URLSearchParams(window.location.search);
const initialRoom = normalizeRoomCode(pageParams.get("room"));
if (roomInput && initialRoom) {
  roomInput.value = initialRoom;
}
if (cameraNameInput) {
  cameraNameInput.value = "Phone Cam";
}

let socket = null;
let peerConnection = null;
let localStream = null;

const setStatus = (message) => {
  if (phoneStatus) phoneStatus.textContent = message;
};

const stopStream = (stream) => {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
};

const showPreview = (stream) => {
  if (!phonePreview) return;
  phonePreview.srcObject = stream;
  phonePreview.play().catch(() => {});
};

const replaceTrackIfNeeded = async () => {
  if (!peerConnection || !localStream) return;
  const localTrack = localStream.getVideoTracks()[0];
  if (!localTrack) return;

  const sender = peerConnection.getSenders().find((currentSender) => currentSender.track?.kind === "video");
  if (sender) {
    await sender.replaceTrack(localTrack);
    return;
  }

  peerConnection.addTrack(localTrack, localStream);
};

const startLocalCamera = async () => {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("Camera API is not supported in this browser.");
  }

  if (!window.isSecureContext) {
    throw new Error("Phone camera access needs HTTPS or localhost in this browser.");
  }

  const nextStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facingModeSelect?.value || "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  const previousStream = localStream;
  localStream = nextStream;
  showPreview(localStream);
  await replaceTrackIfNeeded();
  stopStream(previousStream);
};

const cleanupPeerConnection = () => {
  if (!peerConnection) return;
  peerConnection.onicecandidate = null;
  peerConnection.onconnectionstatechange = null;
  peerConnection.close();
  peerConnection = null;
};

const ensurePeerConnection = () => {
  if (peerConnection) return peerConnection;

  peerConnection = new RTCPeerConnection(RTC_CONFIG);
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.onicecandidate = (event) => {
    if (!event.candidate || !socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({
      type: "signal",
      data: {
        candidate: event.candidate,
      },
    }));
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    if (state === "connected") {
      setStatus("Live on the dashboard.");
    } else if (state === "failed" || state === "closed") {
      setStatus("Connection dropped. Tap Join Camera to reconnect.");
    } else if (state === "connecting") {
      setStatus("Connecting to the dashboard...");
    }
  };

  return peerConnection;
};

const disconnectSocket = () => {
  if (!socket) return;
  socket.close();
  socket = null;
};

const leaveRoom = () => {
  disconnectSocket();
  cleanupPeerConnection();
  stopStream(localStream);
  localStream = null;
  if (phonePreview) phonePreview.srcObject = null;
  setStatus("Disconnected.");
};

const connectToRoom = async () => {
  const roomId = normalizeRoomCode(roomInput?.value);
  if (!roomId) {
    setStatus("Enter the 6-character room code first.");
    return;
  }

  if (!window.location.protocol.startsWith("http")) {
    setStatus("Open this page through the local server or an HTTPS URL.");
    return;
  }

  const wsUrl = buildWebSocketUrl(window.location);
  if (!wsUrl) {
    setStatus("Cannot build the WebSocket URL for this page.");
    return;
  }

  try {
    setStatus("Starting camera...");
    await startLocalCamera();
  } catch (error) {
    setStatus(error.message || "Could not start the camera.");
    console.error(error);
    return;
  }

  cleanupPeerConnection();
  disconnectSocket();

  socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {
    setStatus("Joining room...");
    socket.send(JSON.stringify({
      type: "join_room",
      role: "camera",
      roomId,
      name: cameraNameInput?.value.trim() || "Phone Cam",
    }));
  });

  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "error") {
      setStatus(message.message || "Room error.");
      return;
    }

    if (message.type === "waiting_for_host") {
      setStatus("Waiting for the dashboard to open this room...");
      return;
    }

    if (message.type === "host_ready") {
      setStatus("Dashboard found. Waiting for connection...");
      return;
    }

    if (message.type === "host_left") {
      cleanupPeerConnection();
      setStatus("Dashboard left the room. Waiting...");
      return;
    }

    if (message.type === "signal") {
      const currentPeer = ensurePeerConnection();
      const data = message.data || {};

      if (data.description?.type === "offer") {
        await currentPeer.setRemoteDescription(data.description);
        const answer = await currentPeer.createAnswer();
        await currentPeer.setLocalDescription(answer);
        socket.send(JSON.stringify({
          type: "signal",
          data: {
            description: currentPeer.localDescription,
          },
        }));
      }

      if (data.candidate) {
        await currentPeer.addIceCandidate(data.candidate);
      }
    }
  });

  socket.addEventListener("close", () => {
    if (socket) {
      setStatus("Room connection closed.");
    }
    socket = null;
  });
};

joinCameraBtn?.addEventListener("click", () => {
  connectToRoom();
});

leaveCameraBtn?.addEventListener("click", () => {
  leaveRoom();
});

facingModeSelect?.addEventListener("change", async () => {
  if (!localStream) return;

  try {
    await startLocalCamera();
    setStatus("Camera lens updated.");
  } catch (error) {
    setStatus(error.message || "Could not switch the camera.");
    console.error(error);
  }
});
