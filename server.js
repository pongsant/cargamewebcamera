import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const rootDir = process.cwd();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const rooms = new Map();

const sendJson = (socket, payload) => {
  if (!socket || socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
};

const getRoom = (roomId) => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      host: null,
      cameras: new Map(),
    });
  }
  return rooms.get(roomId);
};

const cleanupRoom = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) return;
  if (!room.host && room.cameras.size === 0) {
    rooms.delete(roomId);
  }
};

const fileFromPathname = (pathname) => {
  if (pathname === "/") return "start.html";
  if (pathname === "/dashboard") return "index.html";
  if (pathname === "/phone") return "phone.html";

  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  return safePath.startsWith("/") ? safePath.slice(1) : safePath;
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const relativePath = fileFromPathname(url.pathname);
  const absolutePath = join(rootDir, relativePath);

  try {
    const fileStats = await stat(absolutePath);
    if (!fileStats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = extname(absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    createReadStream(absolutePath).pipe(res);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.clientId = randomUUID();
  socket.roomId = null;
  socket.role = null;
  socket.displayName = "";

  socket.on("message", (rawData) => {
    let message = null;

    try {
      message = JSON.parse(rawData.toString());
    } catch (error) {
      sendJson(socket, { type: "error", message: "Invalid message payload." });
      return;
    }

    if (message.type === "join_room") {
      const roomId = String(message.roomId || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      const role = message.role === "host" ? "host" : "camera";
      const displayName = String(message.name || (role === "host" ? "Dashboard" : "Phone Camera")).trim().slice(0, 40);

      if (!roomId) {
        sendJson(socket, { type: "error", message: "Missing room code." });
        return;
      }

      const room = getRoom(roomId);

      if (role === "host") {
        if (room.host && room.host !== socket && room.host.readyState === 1) {
          sendJson(socket, { type: "error", message: "A dashboard is already open for this room." });
          return;
        }

        socket.roomId = roomId;
        socket.role = role;
        socket.displayName = displayName || "Dashboard";
        room.host = socket;
        sendJson(socket, {
          type: "joined",
          role: "host",
          roomId,
          clientId: socket.clientId,
        });
        sendJson(socket, {
          type: "room_state",
          cameras: Array.from(room.cameras.values()).map((cameraSocket) => ({
            id: cameraSocket.clientId,
            name: cameraSocket.displayName,
          })),
        });

        room.cameras.forEach((cameraSocket) => {
          sendJson(cameraSocket, { type: "host_ready" });
        });

        return;
      }

      socket.roomId = roomId;
      socket.role = role;
      socket.displayName = displayName || "Phone Camera";
      room.cameras.set(socket.clientId, socket);
      sendJson(socket, {
        type: "joined",
        role: "camera",
        roomId,
        clientId: socket.clientId,
      });

      if (room.host) {
        sendJson(socket, { type: "host_ready" });
        sendJson(room.host, {
          type: "camera_joined",
          camera: {
            id: socket.clientId,
            name: socket.displayName,
          },
        });
      } else {
        sendJson(socket, { type: "waiting_for_host" });
      }

      return;
    }

    if (message.type === "signal") {
      const room = socket.roomId ? rooms.get(socket.roomId) : null;
      if (!room) return;

      let target = null;

      if (socket.role === "host") {
        target = room.cameras.get(String(message.targetId || ""));
      } else {
        target = room.host;
      }

      if (!target) return;

      sendJson(target, {
        type: "signal",
        fromId: socket.clientId,
        data: message.data || null,
      });
    }
  });

  socket.on("close", () => {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);
    if (!room) return;

    if (socket.role === "host") {
      if (room.host === socket) {
        room.host = null;
        room.cameras.forEach((cameraSocket) => {
          sendJson(cameraSocket, { type: "host_left" });
        });
      }
      cleanupRoom(socket.roomId);
      return;
    }

    room.cameras.delete(socket.clientId);
    if (room.host) {
      sendJson(room.host, {
        type: "camera_left",
        cameraId: socket.clientId,
      });
    }
    cleanupRoom(socket.roomId);
  });
});

server.listen(port, () => {
  console.log(`Race control server running at http://localhost:${port}`);
});
