from __future__ import annotations

import asyncio
import base64
import json
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

BASE_DIR = Path(__file__).resolve().parent
PENALTY_SECONDS = 1.0
JPEG_QUALITY = 72

GUIDE_POINTS = np.array([
    [4, 176], [68, 177], [116, 176], [139, 168], [152, 153], [157, 136],
    [159, 113], [162, 91], [174, 76], [196, 63], [212, 61], [231, 65],
    [243, 79], [246, 96], [247, 123], [247, 149], [248, 177], [248, 206],
    [248, 233], [250, 255], [259, 275], [273, 288], [291, 291], [308, 284],
    [317, 268], [320, 247], [323, 226], [323, 207], [330, 192], [348, 183],
    [367, 183], [388, 183], [408, 181], [425, 175], [438, 163], [448, 148],
    [451, 129], [453, 110], [455, 92], [466, 78], [480, 69], [499, 66],
    [515, 69], [525, 76], [534, 91], [536, 112], [537, 140], [537, 190],
    [538, 266], [540, 355],
], dtype=np.float32)

GUIDE_W = 640
GUIDE_H = 360

# Wider green range for easier debugging.
HSV_LOWER = np.array([30, 35, 35], dtype=np.uint8)
HSV_UPPER = np.array([95, 255, 255], dtype=np.uint8)
MIN_CONTOUR_AREA = 120.0


def normalize(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    if norm == 0:
        return vec
    return vec / norm


def point_is_inside_lane(x: int, y: int, mask: np.ndarray) -> bool:
    if 0 <= x < mask.shape[1] and 0 <= y < mask.shape[0]:
        return bool(mask[y, x] > 0)
    return False


def point_has_passed_line(point: tuple[int, int], line_point: np.ndarray, direction_vec: np.ndarray) -> bool:
    p = np.array(point, dtype=np.float32)
    lp = np.array(line_point, dtype=np.float32)
    return bool(np.dot(p - lp, direction_vec) >= 0)


class RaceEngine:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.clients_lock = asyncio.Lock()

        self.geometry_ready = False
        self.cam_h = 0
        self.cam_w = 0
        self.track_points: np.ndarray | None = None
        self.lane_mask: np.ndarray | None = None
        self.road_thickness = 0
        self.start_pt: np.ndarray | None = None
        self.end_pt: np.ndarray | None = None
        self.finish_dir: np.ndarray | None = None
        self.start_line_a: tuple[int, int] | None = None
        self.start_line_b: tuple[int, int] | None = None
        self.finish_line_a: tuple[int, int] | None = None
        self.finish_line_b: tuple[int, int] | None = None

        self.preview_enabled = True
        self.preview_frame_counter = 0
        self.last_status = "Backend ready. Waiting for browser camera frames."
        self.last_debug_text = "No frame processed yet."

        self.reset_game(initial=True)

    def reset_game(self, *, initial: bool = False) -> None:
        self.game_running = False
        self.timer_finished = False
        self.start_time = 0.0
        self.raw_time = 0.0
        self.final_time = 0.0
        self.outside_count = 0
        self.was_inside_lane = True
        self.was_before_finish = True
        self.has_seen_car = False
        self.preview_frame_counter = 0
        self.last_debug_text = "Waiting for incoming browser frames."
        if not initial:
            self.last_status = "Run reset. Waiting for Start from the website."

    def start_game(self) -> None:
        self.reset_game(initial=True)
        self.game_running = True
        self.start_time = time.time()
        self.last_status = "Race running. Python is processing browser camera frames."

    def stop_game(self) -> None:
        if self.game_running:
            self.raw_time = max(0.0, time.time() - self.start_time)
        self.game_running = False
        self.timer_finished = False
        self.last_status = "Race stopped from the website."

    def state_payload(self, state: str | None = None) -> dict[str, Any]:
        if state is None:
            if self.game_running:
                state = "running"
            elif self.timer_finished:
                state = "finished"
            else:
                state = "idle"

        penalty_time = self.outside_count * PENALTY_SECONDS
        return {
            "type": "state",
            "state": state,
            "rawTime": self.raw_time,
            "rawMs": int(round(self.raw_time * 1000)),
            "finalTime": self.final_time,
            "finalMs": int(round(self.final_time * 1000)),
            "penaltyCount": self.outside_count,
            "penaltySeconds": PENALTY_SECONDS,
            "penaltyTime": penalty_time,
            "penaltyMs": int(round(penalty_time * 1000)),
            "message": self.last_status,
            "previewEnabled": self.preview_enabled,
            "debugText": self.last_debug_text,
        }

    def configure_geometry(self, frame_shape: tuple[int, int, int]) -> None:
        cam_h, cam_w = frame_shape[:2]
        if self.geometry_ready and cam_h == self.cam_h and cam_w == self.cam_w:
            return

        self.cam_h = cam_h
        self.cam_w = cam_w

        scale_x = cam_w / GUIDE_W
        scale_y = cam_h / GUIDE_H
        track_points = GUIDE_POINTS.copy()
        track_points[:, 0] *= scale_x
        track_points[:, 1] *= scale_y
        track_points = track_points.astype(np.int32)

        road_thickness = max(30, int(min(cam_w, cam_h) * 0.15))
        lane_mask = np.zeros((cam_h, cam_w), dtype=np.uint8)
        cv2.polylines(
            lane_mask,
            [track_points],
            False,
            255,
            thickness=road_thickness,
            lineType=cv2.LINE_AA,
        )
        lane_mask = cv2.dilate(lane_mask, np.ones((7, 7), np.uint8), iterations=1)

        start_pt = track_points[0].astype(np.float32)
        next_start_pt = track_points[1].astype(np.float32)
        end_prev_pt = track_points[-2].astype(np.float32)
        end_pt = track_points[-1].astype(np.float32)

        start_dir = normalize(next_start_pt - start_pt)
        finish_dir = normalize(end_pt - end_prev_pt)
        start_perp = np.array([-start_dir[1], start_dir[0]], dtype=np.float32)
        finish_perp = np.array([-finish_dir[1], finish_dir[0]], dtype=np.float32)
        line_half = road_thickness // 2 + 10

        self.track_points = track_points
        self.lane_mask = lane_mask
        self.road_thickness = road_thickness
        self.start_pt = start_pt
        self.end_pt = end_pt
        self.finish_dir = finish_dir
        self.start_line_a = tuple((start_pt + start_perp * line_half).astype(int))
        self.start_line_b = tuple((start_pt - start_perp * line_half).astype(int))
        self.finish_line_a = tuple((end_pt + finish_perp * line_half).astype(int))
        self.finish_line_b = tuple((end_pt - finish_perp * line_half).astype(int))
        self.geometry_ready = True
        self.last_status = f"Geometry ready for {cam_w}x{cam_h} frames."

    def _draw_overlay(
        self,
        frame: np.ndarray,
        cx: int | None,
        cy: int | None,
        car_inside_lane: bool,
        bounding_box: tuple[int, int, int, int] | None,
        contour_area: float,
        mask_ratio: float,
    ) -> np.ndarray:
        assert self.track_points is not None
        assert self.start_line_a is not None and self.start_line_b is not None
        assert self.finish_line_a is not None and self.finish_line_b is not None

        overlay = frame.copy()
        cv2.polylines(
            overlay,
            [self.track_points],
            False,
            (255, 255, 255),
            thickness=self.road_thickness,
            lineType=cv2.LINE_AA,
        )
        cv2.line(overlay, self.start_line_a, self.start_line_b, (0, 0, 255), 3)
        cv2.line(overlay, self.finish_line_a, self.finish_line_b, (255, 0, 0), 3)
        view = cv2.addWeighted(overlay, 0.45, frame, 0.55, 0)

        if bounding_box is not None:
            x, y, w, h = bounding_box
            cv2.rectangle(view, (x, y), (x + w, y + h), (0, 255, 255), 2)

        if cx is None or cy is None:
            cv2.putText(view, "NO CAR DETECTED", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        else:
            cv2.circle(view, (cx, cy), 10, (0, 255, 0), -1)
            cv2.putText(view, f"({cx},{cy})", (cx + 10, cy - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
            label = "INSIDE LANE" if car_inside_lane else "OUT OF LANE"
            color = (0, 255, 0) if car_inside_lane else (0, 0, 255)
            cv2.putText(view, label, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)

        if self.game_running:
            display_time = max(0.0, time.time() - self.start_time)
            cv2.putText(view, f"TIME: {display_time:.2f}s", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
        elif self.timer_finished:
            cv2.putText(view, f"RAW TIME: {self.raw_time:.2f}s", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 0), 2)
            cv2.putText(view, f"OUTSIDE COUNT: {self.outside_count}", (20, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 165, 255), 2)
            cv2.putText(view, f"FINAL TIME: {self.final_time:.2f}s", (20, 160), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        else:
            cv2.putText(view, "Preview mode. Press Start in browser.", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)

        cv2.putText(view, f"PENALTY COUNT: {self.outside_count}", (20, self.cam_h - 60), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)
        cv2.putText(view, f"AREA: {contour_area:.0f}  MASK: {mask_ratio:.3f}", (20, self.cam_h - 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(view, "START", (self.start_line_a[0] - 20, self.start_line_a[1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        cv2.putText(view, "FINISH", (self.finish_line_a[0] - 30, self.finish_line_a[1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 0), 2)
        return view

    def process_frame(self, frame: np.ndarray) -> list[dict[str, Any]]:
        self.configure_geometry(frame.shape)
        assert self.lane_mask is not None
        assert self.end_pt is not None
        assert self.finish_dir is not None

        events: list[dict[str, Any]] = []

        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        green_mask = cv2.inRange(hsv, HSV_LOWER, HSV_UPPER)
        kernel = np.ones((5, 5), np.uint8)
        green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_OPEN, kernel, iterations=1)
        green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_DILATE, kernel, iterations=1)
        contours, _ = cv2.findContours(green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        cx: int | None = None
        cy: int | None = None
        car_inside_lane = False
        bounding_box: tuple[int, int, int, int] | None = None
        biggest_area = 0.0

        biggest = None
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > MIN_CONTOUR_AREA and area > biggest_area:
                biggest = contour
                biggest_area = area

        if biggest is not None:
            x, y, w, h = cv2.boundingRect(biggest)
            bounding_box = (x, y, w, h)
            cx = x + w // 2
            cy = y + h // 2
            car_inside_lane = point_is_inside_lane(cx, cy, self.lane_mask)

            if self.game_running:
                current_before_finish = not point_has_passed_line((cx, cy), self.end_pt, self.finish_dir)

                if not self.has_seen_car:
                    self.was_inside_lane = car_inside_lane
                    self.was_before_finish = current_before_finish
                    self.has_seen_car = True
                else:
                    if self.was_inside_lane and not car_inside_lane:
                        self.outside_count += 1
                        events.append({
                            "type": "penalty_update",
                            "penaltyCount": self.outside_count,
                            "penaltySeconds": PENALTY_SECONDS,
                            "penaltyTime": self.outside_count * PENALTY_SECONDS,
                            "penaltyMs": int(round(self.outside_count * PENALTY_SECONDS * 1000)),
                        })
                    self.was_inside_lane = car_inside_lane

                    if not current_before_finish:
                        self.raw_time = max(0.0, time.time() - self.start_time)
                        self.final_time = self.raw_time + self.outside_count * PENALTY_SECONDS
                        self.game_running = False
                        self.timer_finished = True
                        self.last_status = "Finish line crossed. Final result sent to the browser."
                        events.append({
                            "type": "final_result",
                            "state": "finished",
                            "rawTime": self.raw_time,
                            "rawMs": int(round(self.raw_time * 1000)),
                            "finalTime": self.final_time,
                            "finalMs": int(round(self.final_time * 1000)),
                            "penaltyCount": self.outside_count,
                            "penaltySeconds": PENALTY_SECONDS,
                            "penaltyTime": self.outside_count * PENALTY_SECONDS,
                            "penaltyMs": int(round(self.outside_count * PENALTY_SECONDS * 1000)),
                        })
                        events.append(self.state_payload("finished"))
                    self.was_before_finish = current_before_finish

        mask_ratio = float(np.count_nonzero(green_mask)) / float(green_mask.size)
        if cx is None or cy is None:
            self.last_debug_text = (
                f"No contour above area>{MIN_CONTOUR_AREA:.0f}. "
                f"Mask ratio={mask_ratio:.4f}; check marker color, lighting, or HSV."
            )
        else:
            lane_label = "inside lane" if car_inside_lane else "outside lane"
            self.last_debug_text = (
                f"car=({cx},{cy}) area={biggest_area:.0f} {lane_label}; "
                f"mask ratio={mask_ratio:.4f}"
            )

        if self.preview_enabled:
            self.preview_frame_counter += 1
            if self.preview_frame_counter % 2 == 0:
                preview = self._draw_overlay(frame, cx, cy, car_inside_lane, bounding_box, biggest_area, mask_ratio)
                ok, encoded = cv2.imencode(
                    ".jpg",
                    preview,
                    [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY],
                )
                if ok:
                    events.append({
                        "type": "preview",
                        "imageBase64": base64.b64encode(encoded.tobytes()).decode("ascii"),
                        "encoding": "base64-jpeg",
                        "debugText": self.last_debug_text,
                    })

        return events

    async def broadcast_json(self, payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        async with self.clients_lock:
            sockets = list(self.clients)

        for socket in sockets:
            try:
                await socket.send_text(json.dumps(payload))
            except Exception:
                stale.append(socket)

        if stale:
            async with self.clients_lock:
                for socket in stale:
                    self.clients.discard(socket)

    async def add_client(self, websocket: WebSocket) -> None:
        async with self.clients_lock:
            self.clients.add(websocket)

    async def remove_client(self, websocket: WebSocket) -> None:
        async with self.clients_lock:
            self.clients.discard(websocket)


engine = RaceEngine()
app = FastAPI(title="Race Control Backend")


@app.get("/api/health")
async def api_health() -> JSONResponse:
    return JSONResponse({"ok": True, "state": engine.state_payload()})


@app.websocket("/ws/race")
async def race_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    await engine.add_client(websocket)
    await websocket.send_text(json.dumps(engine.state_payload()))
    await websocket.send_text(json.dumps({
        "type": "status",
        "message": engine.last_status,
    }))

    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if message.get("text") is not None:
                try:
                    payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Invalid JSON payload.",
                    }))
                    continue

                command = payload.get("type")
                if command == "start":
                    engine.start_game()
                    await engine.broadcast_json(engine.state_payload("running"))
                    await engine.broadcast_json({
                        "type": "status",
                        "message": engine.last_status,
                    })
                elif command == "reset":
                    engine.reset_game()
                    await engine.broadcast_json(engine.state_payload("idle"))
                    await engine.broadcast_json({
                        "type": "status",
                        "message": engine.last_status,
                    })
                elif command == "stop":
                    engine.stop_game()
                    await engine.broadcast_json(engine.state_payload("stopped"))
                    await engine.broadcast_json({
                        "type": "status",
                        "message": engine.last_status,
                    })
                elif command == "set_preview":
                    engine.preview_enabled = bool(payload.get("enabled", True))
                    engine.last_status = (
                        "Backend preview resumed."
                        if engine.preview_enabled
                        else "Backend preview paused from the browser."
                    )
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "message": engine.last_status,
                    }))
                elif command == "ping":
                    await websocket.send_text(json.dumps({"type": "pong", "time": time.time()}))
                else:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"Unsupported command: {command}",
                    }))
                continue

            frame_bytes = message.get("bytes")
            if frame_bytes is None:
                continue

            np_buffer = np.frombuffer(frame_bytes, dtype=np.uint8)
            frame = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
            if frame is None:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Could not decode browser camera frame.",
                }))
                continue

            events = engine.process_frame(frame)
            for event in events:
                await engine.broadcast_json(event)

    except WebSocketDisconnect:
        pass
    finally:
        await engine.remove_client(websocket)


@app.get("/")
async def serve_root() -> FileResponse:
    return FileResponse(BASE_DIR / "start.html")


@app.get("/{requested_path:path}")
async def serve_files(requested_path: str) -> FileResponse:
    safe_path = (BASE_DIR / requested_path).resolve()
    if not safe_path.exists() or not safe_path.is_file() or BASE_DIR not in safe_path.parents:
        return FileResponse(BASE_DIR / "start.html")
    return FileResponse(safe_path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("camera_test:app", host="0.0.0.0", port=8000, reload=False)
