const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const SCREEN_SOURCE_ID = "__screen_share__";
export const REMOTE_SOURCE_PREFIX = "__remote__:";
export const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export const normalizeRoomCode = (value) => (
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6)
);

export const createRoomCode = () => {
  const array = new Uint32Array(6);
  crypto.getRandomValues(array);
  return Array.from(array, (value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join("");
};

export const buildWebSocketUrl = (locationLike = window.location) => {
  if (!locationLike || !locationLike.host) return null;
  const protocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${locationLike.host}/ws`;
};

export const isRemoteSourceId = (value) => String(value || "").startsWith(REMOTE_SOURCE_PREFIX);

export const makeRemoteSourceId = (cameraId) => `${REMOTE_SOURCE_PREFIX}${cameraId}`;
