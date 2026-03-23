import {
  RTC_CONFIG,
  buildWebSocketUrl,
  isRemoteSourceId,
  makeRemoteSourceId,
} from "./rtc-shared.js";

export const createRemoteRoomHost = ({
  roomId,
  onStatus,
  onRosterChange,
  onSourcesChange,
}) => {
  const peerConnections = new Map();
  const remoteSources = new Map();
  const roster = new Map();
  let socket = null;

  const emitRoster = () => {
    onRosterChange?.(
      Array.from(roster.values()).map((entry) => ({
        ...entry,
        sourceId: makeRemoteSourceId(entry.id),
        live: remoteSources.has(makeRemoteSourceId(entry.id)),
      }))
    );
  };

  const emitSources = () => {
    onSourcesChange?.(new Map(remoteSources));
  };

  const setStatus = (message) => {
    onStatus?.(message);
  };

  const sendSignal = (targetId, data) => {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({
      type: "signal",
      targetId,
      data,
    }));
  };

  const removeCamera = (cameraId) => {
    const sourceId = makeRemoteSourceId(cameraId);
    remoteSources.delete(sourceId);

    const peerConnection = peerConnections.get(cameraId);
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnections.delete(cameraId);
    }

    roster.delete(cameraId);
    emitSources();
    emitRoster();
    setStatus(`Remote cameras live: ${remoteSources.size}`);
  };

  const ensurePeerConnection = (cameraId) => {
    if (peerConnections.has(cameraId)) {
      return peerConnections.get(cameraId);
    }

    const peerConnection = new RTCPeerConnection(RTC_CONFIG);
    peerConnection.addTransceiver("video", { direction: "recvonly" });

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) return;
      sendSignal(cameraId, { candidate: event.candidate });
    };

    peerConnection.ontrack = (event) => {
      const sourceId = makeRemoteSourceId(cameraId);
      const stream = event.streams[0] || new MediaStream([event.track]);
      const cameraName = roster.get(cameraId)?.name || `Phone ${cameraId.slice(0, 4)}`;
      remoteSources.set(sourceId, {
        id: sourceId,
        cameraId,
        label: cameraName,
        stream,
      });
      emitSources();
      emitRoster();
      setStatus(`Remote cameras live: ${remoteSources.size}`);
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      if (state === "failed" || state === "closed") {
        removeCamera(cameraId);
      }
    };

    peerConnections.set(cameraId, peerConnection);
    return peerConnection;
  };

  const startOffer = async (cameraId) => {
    const peerConnection = ensurePeerConnection(cameraId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal(cameraId, { description: peerConnection.localDescription });
  };

  const handleSignal = async (fromId, data) => {
    const peerConnection = ensurePeerConnection(fromId);

    if (data?.description?.type === "answer") {
      await peerConnection.setRemoteDescription(data.description);
    }

    if (data?.candidate) {
      await peerConnection.addIceCandidate(data.candidate);
    }
  };

  const connect = () => {
    const wsUrl = buildWebSocketUrl(window.location);
    if (!wsUrl || !window.location.protocol.startsWith("http")) {
      setStatus("Remote phone join works only when this dashboard is opened through the local server.");
      return;
    }

    socket = new WebSocket(wsUrl);

    socket.addEventListener("open", () => {
      setStatus("Remote room live. Share the join link with other phones.");
      socket.send(JSON.stringify({
        type: "join_room",
        role: "host",
        roomId,
        name: "Dashboard",
      }));
    });

    socket.addEventListener("message", async (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "error") {
        setStatus(message.message || "Remote room error.");
        return;
      }

      if (message.type === "room_state") {
        message.cameras.forEach((camera) => {
          roster.set(camera.id, { id: camera.id, name: camera.name || `Phone ${camera.id.slice(0, 4)}` });
        });
        emitRoster();
        for (const camera of message.cameras) {
          await startOffer(camera.id);
        }
        return;
      }

      if (message.type === "camera_joined") {
        const camera = message.camera;
        roster.set(camera.id, { id: camera.id, name: camera.name || `Phone ${camera.id.slice(0, 4)}` });
        emitRoster();
        await startOffer(camera.id);
        return;
      }

      if (message.type === "camera_left") {
        removeCamera(message.cameraId);
        return;
      }

      if (message.type === "signal") {
        await handleSignal(message.fromId, message.data);
      }
    });

    socket.addEventListener("close", () => {
      peerConnections.forEach((peerConnection) => peerConnection.close());
      peerConnections.clear();
      remoteSources.clear();
      roster.clear();
      emitSources();
      emitRoster();
      setStatus("Remote room disconnected. Restart the local server and reload if needed.");
    });
  };

  return {
    connect,
  };
};
