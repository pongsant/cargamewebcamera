import asyncio
import base64
import contextlib
import json
import queue
import threading
import time

import cv2
import numpy as np
import websockets

HOST = "0.0.0.0"
PORT = 8765
CAMERA_INDEX = 0
PENALTY_SECONDS = 1.0
FRAME_QUEUE_MAX = 4
FRAME_IDLE_SLEEP = 0.01
WEBSOCKET_MAX_SIZE = 8_000_000
WAIT_FOR_BROWSER_FIRST_FRAME_SECONDS = 10.0

command_queue = queue.Queue()
frame_queue = queue.Queue(maxsize=FRAME_QUEUE_MAX)
clients = set()
clients_lock = threading.Lock()
server_loop = None


def make_state_payload(state, *, raw_time=0.0, final_time=0.0, penalty_count=0):
    penalty_time = penalty_count * PENALTY_SECONDS
    return {
        "type": "state",
        "state": state,
        "rawTime": raw_time,
        "rawMs": int(round(raw_time * 1000)),
        "finalTime": final_time,
        "finalMs": int(round(final_time * 1000)),
        "penaltyCount": penalty_count,
        "penaltySeconds": PENALTY_SECONDS,
        "penaltyTime": penalty_time,
        "penaltyMs": int(round(penalty_time * 1000)),
    }


async def broadcast(payload):
    message = json.dumps(payload)

    with clients_lock:
        sockets = list(clients)

    if not sockets:
        return

    stale = []
    for socket in sockets:
        try:
            await socket.send(message)
        except Exception:
            stale.append(socket)

    if stale:
        with clients_lock:
            for socket in stale:
                clients.discard(socket)


def push_event(payload):
    if server_loop is None:
        return
    asyncio.run_coroutine_threadsafe(broadcast(payload), server_loop)


def build_frame_packet(frame, *, source_label, source_key, is_web):
    return {
        "frame": frame,
        "sourceLabel": source_label,
        "sourceKey": source_key,
        "isWeb": is_web,
    }


def enqueue_frame_from_payload(payload):
    image_payload = payload.get("image")
    if not isinstance(image_payload, str) or not image_payload:
        return False, "Frame payload is missing image data."

    try:
        image_bytes = base64.b64decode(image_payload)
        image_np = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(image_np, cv2.IMREAD_COLOR)
    except Exception:
        return False, "Could not decode frame payload."

    if frame is None:
        return False, "Decoded frame is empty."

    source_label = str(payload.get("sourceLabel") or "Browser Camera").strip()[:120]
    source_key = str(payload.get("source") or "browser").strip()[:40]

    while frame_queue.full():
        try:
            frame_queue.get_nowait()
        except queue.Empty:
            break

    frame_queue.put_nowait(build_frame_packet(
        frame,
        source_label=source_label,
        source_key=source_key,
        is_web=True,
    ))
    return True, None


async def handle_client(websocket):
    with clients_lock:
        clients.add(websocket)

    await websocket.send(json.dumps(make_state_payload("idle")))
    await websocket.send(json.dumps({
        "type": "status",
        "message": "Connected to Python race backend.",
    }))

    try:
        async for message in websocket:
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": "Invalid JSON payload.",
                }))
                continue

            command_type = payload.get("type")
            if command_type in {"arm", "reset", "stop"}:
                command_queue.put(command_type)
                continue

            if command_type == "frame":
                ok, error_message = enqueue_frame_from_payload(payload)
                if not ok:
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": error_message,
                    }))
                continue

            await websocket.send(json.dumps({
                "type": "error",
                "message": f"Unsupported command: {command_type}",
            }))
    finally:
        with clients_lock:
            clients.discard(websocket)


async def websocket_main():
    async with websockets.serve(
        handle_client,
        HOST,
        PORT,
        max_size=WEBSOCKET_MAX_SIZE,
    ):
        print(f"WebSocket server listening on ws://{HOST}:{PORT}")
        await asyncio.Future()


def start_websocket_server():
    global server_loop
    server_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(server_loop)
    server_loop.run_until_complete(websocket_main())


def normalize(v):
    n = np.linalg.norm(v)
    if n == 0:
        return v
    return v / n


def point_is_inside_lane(x, y, mask):
    if 0 <= x < mask.shape[1] and 0 <= y < mask.shape[0]:
        return mask[y, x] > 0
    return False


def point_has_passed_line(point, line_point, direction_vec):
    p = np.array(point, dtype=np.float32)
    lp = np.array(line_point, dtype=np.float32)
    return np.dot(p - lp, direction_vec) >= 0


def reset_game():
    return {
        "game_running": False,
        "timer_finished": False,
        "start_time": 0.0,
        "raw_time": 0.0,
        "final_time": 0.0,
        "outside_count": 0,
        "was_inside_lane": True,
        "was_before_finish": True,
    }


def pop_latest_browser_frame():
    latest_packet = None
    while True:
        try:
            latest_packet = frame_queue.get_nowait()
        except queue.Empty:
            break
    return latest_packet


def read_next_frame(capture):
    packet = pop_latest_browser_frame()
    if packet is not None:
        return packet

    if capture is None:
        return None

    ret, frame = capture.read()
    if not ret:
        return None
    return build_frame_packet(
        frame,
        source_label="Local Camera",
        source_key="local",
        is_web=False,
    )


server_thread = threading.Thread(target=start_websocket_server, daemon=True)
server_thread.start()

fallback_cap = cv2.VideoCapture(CAMERA_INDEX)
if not fallback_cap.isOpened():
    print("Could not open local camera. Waiting for browser frames from the website.")
    fallback_cap.release()
    fallback_cap = None
else:
    print(f"Opened local camera index {CAMERA_INDEX} as fallback source.")

# ----------------------------
# green marker range (HSV)
# ----------------------------
lower = np.array([40, 70, 70])
upper = np.array([80, 255, 255])

# ----------------------------
# traced points from guide image
# ----------------------------
guide_points = np.array([
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

print("Waiting for first frame from website (Chrome/iPhone) or local camera...")
frame_packet = None

if fallback_cap is None:
    while frame_packet is None:
        frame_packet = pop_latest_browser_frame()
        if frame_packet is None:
            time.sleep(FRAME_IDLE_SLEEP)
else:
    wait_deadline = time.time() + WAIT_FOR_BROWSER_FIRST_FRAME_SECONDS
    while frame_packet is None and time.time() < wait_deadline:
        frame_packet = pop_latest_browser_frame()
        if frame_packet is None:
            time.sleep(FRAME_IDLE_SLEEP)

    while frame_packet is None:
        frame_packet = read_next_frame(fallback_cap)
        if frame_packet is None:
            time.sleep(FRAME_IDLE_SLEEP)

frame = frame_packet["frame"]
print(f"Detection source selected: {frame_packet['sourceLabel']}")

cam_h, cam_w = frame.shape[:2]

scale_x = cam_w / GUIDE_W
scale_y = cam_h / GUIDE_H

track_points = guide_points.copy()
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

kernel = np.ones((7, 7), np.uint8)
lane_mask = cv2.dilate(lane_mask, kernel, iterations=1)

start_pt = track_points[0].astype(np.float32)
next_start_pt = track_points[1].astype(np.float32)
end_prev_pt = track_points[-2].astype(np.float32)
end_pt = track_points[-1].astype(np.float32)

start_dir = normalize(next_start_pt - start_pt)
finish_dir = normalize(end_pt - end_prev_pt)

start_perp = np.array([-start_dir[1], start_dir[0]], dtype=np.float32)
finish_perp = np.array([-finish_dir[1], finish_dir[0]], dtype=np.float32)
line_half = road_thickness // 2 + 10

start_line_a = tuple((start_pt + start_perp * line_half).astype(int))
start_line_b = tuple((start_pt - start_perp * line_half).astype(int))
finish_line_a = tuple((end_pt + finish_perp * line_half).astype(int))
finish_line_b = tuple((end_pt - finish_perp * line_half).astype(int))

game = reset_game()
push_event(make_state_payload("idle"))
last_source_label = ""

try:
    while True:
        while True:
            try:
                command = command_queue.get_nowait()
            except queue.Empty:
                break

            if command == "arm":
                game = reset_game()
                game["game_running"] = True
                game["start_time"] = time.time()
                push_event(make_state_payload("running"))
            elif command == "reset":
                game = reset_game()
                push_event(make_state_payload("idle"))
            elif command == "stop":
                if game["game_running"]:
                    game["game_running"] = False
                    push_event(make_state_payload(
                        "stopped",
                        raw_time=game["raw_time"],
                        final_time=game["final_time"],
                        penalty_count=game["outside_count"],
                    ))

        frame_packet = read_next_frame(fallback_cap)
        if frame_packet is None:
            time.sleep(FRAME_IDLE_SLEEP)
            continue

        frame = frame_packet["frame"]
        source_label = str(frame_packet.get("sourceLabel") or "Unknown source")
        source_transport = "WEB" if frame_packet.get("isWeb") else "LOCAL"
        if source_label != last_source_label:
            push_event({
                "type": "status",
                "message": f"Python detection source: {source_label}",
            })
            last_source_label = source_label

        if frame.shape[0] != cam_h or frame.shape[1] != cam_w:
            frame = cv2.resize(frame, (cam_w, cam_h), interpolation=cv2.INTER_LINEAR)

        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        green_mask = cv2.inRange(hsv, lower, upper)
        contours, _ = cv2.findContours(green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        overlay = frame.copy()
        cv2.polylines(
            overlay,
            [track_points],
            False,
            (255, 255, 255),
            thickness=road_thickness,
            lineType=cv2.LINE_AA,
        )
        cv2.line(overlay, start_line_a, start_line_b, (0, 0, 255), 3)
        cv2.line(overlay, finish_line_a, finish_line_b, (0, 255, 0), 3)
        frame = cv2.addWeighted(overlay, 0.45, frame, 0.55, 0)

        cx, cy = None, None
        car_inside_lane = False

        biggest = None
        biggest_area = 0
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > 300 and area > biggest_area:
                biggest = contour
                biggest_area = area

        if biggest is not None:
            x, y, w, h = cv2.boundingRect(biggest)
            cx = x + w // 2
            cy = y + h // 2

            cv2.circle(frame, (cx, cy), 10, (0, 255, 0), -1)
            cv2.putText(
                frame,
                f"({cx},{cy})",
                (cx + 10, cy - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 0),
                1,
            )

            car_inside_lane = point_is_inside_lane(cx, cy, lane_mask)

            if game["game_running"] and game["was_inside_lane"] and not car_inside_lane:
                game["outside_count"] += 1
                push_event({
                    "type": "penalty_update",
                    "penaltyCount": game["outside_count"],
                    "penaltySeconds": PENALTY_SECONDS,
                    "penaltyTime": game["outside_count"] * PENALTY_SECONDS,
                    "penaltyMs": int(round(game["outside_count"] * PENALTY_SECONDS * 1000)),
                })
            game["was_inside_lane"] = car_inside_lane

            current_before_finish = not point_has_passed_line((cx, cy), end_pt, finish_dir)

            if game["game_running"] and game["was_before_finish"] and not current_before_finish:
                game["raw_time"] = time.time() - game["start_time"]
                game["final_time"] = game["raw_time"] + game["outside_count"] * PENALTY_SECONDS
                game["game_running"] = False
                game["timer_finished"] = True
                final_payload = {
                    "type": "final_result",
                    "rawTime": game["raw_time"],
                    "rawMs": int(round(game["raw_time"] * 1000)),
                    "finalTime": game["final_time"],
                    "finalMs": int(round(game["final_time"] * 1000)),
                    "penaltyCount": game["outside_count"],
                    "penaltySeconds": PENALTY_SECONDS,
                    "penaltyTime": game["outside_count"] * PENALTY_SECONDS,
                    "penaltyMs": int(round(game["outside_count"] * PENALTY_SECONDS * 1000)),
                    "state": "finished",
                }
                push_event(final_payload)
                push_event(make_state_payload(
                    "finished",
                    raw_time=game["raw_time"],
                    final_time=game["final_time"],
                    penalty_count=game["outside_count"],
                ))

            game["was_before_finish"] = current_before_finish

        display_time = 0.0
        if game["game_running"]:
            display_time = time.time() - game["start_time"]
        elif game["timer_finished"]:
            display_time = game["raw_time"]

        if cx is None:
            cv2.putText(frame, "NO CAR DETECTED", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        elif car_inside_lane:
            cv2.putText(frame, "INSIDE LANE", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        else:
            cv2.putText(frame, "OUT OF LANE", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

        if game["game_running"]:
            cv2.putText(frame, f"TIME: {display_time:.2f}s", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
        elif game["timer_finished"]:
            cv2.putText(frame, f"RAW TIME: {game['raw_time']:.2f}s", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 0), 2)
            cv2.putText(frame, f"OUTSIDE COUNT: {game['outside_count']}", (20, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 165, 255), 2)
            cv2.putText(frame, f"FINAL TIME: {game['final_time']:.2f}s", (20, 160), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        else:
            cv2.putText(frame, "Press Start on the website", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

        cv2.putText(frame, f"SOURCE ({source_transport}): {source_label}", (20, cam_h - 55), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 220, 120), 2)
        cv2.putText(frame, f"PENALTY COUNT: {game['outside_count']}", (20, cam_h - 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)
        cv2.putText(frame, "START", (start_line_a[0] - 20, start_line_a[1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        cv2.putText(frame, "FINISH", (finish_line_a[0] - 30, finish_line_a[1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

        cv2.imshow("frame", frame)
        cv2.imshow("green mask", green_mask)
        cv2.imshow("lane mask", lane_mask)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("s"):
            command_queue.put("arm")
        if key == ord("r"):
            command_queue.put("reset")
        if key == 27:
            break
finally:
    if fallback_cap is not None:
        fallback_cap.release()
    cv2.destroyAllWindows()
    if server_loop is not None:
        server_loop.call_soon_threadsafe(server_loop.stop)
        with contextlib.suppress(Exception):
            server_thread.join(timeout=1)
