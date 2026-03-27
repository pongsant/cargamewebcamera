import asyncio
import base64
import contextlib
import json
import os
import queue
import threading
import time

import cv2
import numpy as np
import websockets

HOST = "0.0.0.0"
PORT = 8765
PREFERRED_CAMERA_LABEL = "Prum iPhone 17 Pro"
PREFERRED_CAMERA_INDEX = 1
CAMERA_FALLBACK_INDICES = (PREFERRED_CAMERA_INDEX, 0, 2)
PENALTY_SECONDS = 5.0
FRAME_QUEUE_MAX = 4
FRAME_IDLE_SLEEP = 0.01
WEBSOCKET_MAX_SIZE = 8_000_000
WAIT_FOR_BROWSER_FIRST_FRAME_SECONDS = 10.0
INTRO_VIDEO_FILENAME = "Race_Track_done.MP4"
INTRO_VIDEO_MAX_SECONDS = 10.0
FIELD_BACKGROUND_FILENAME = "f1_car_field.png"
DISPLAY_WINDOW_NAME = "Race Track Game"
HUD_PANEL_HEIGHT = 205
FINISH_COLOR = (255, 0, 0)  # blue in OpenCV BGR

command_queue = queue.Queue()
frame_queue = queue.Queue(maxsize=FRAME_QUEUE_MAX)
clients = set()
clients_lock = threading.Lock()
server_loop = None
intro_has_played = False


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
            if command_type in {"arm", "reset", "stop", "play_intro"}:
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


def open_local_fallback_camera():
    attempted = set()

    for camera_index in CAMERA_FALLBACK_INDICES:
        if camera_index in attempted:
            continue
        attempted.add(camera_index)

        capture = cv2.VideoCapture(camera_index)
        if capture.isOpened():
            return capture, camera_index
        capture.release()

    return None, None


def read_next_frame(capture, local_source_label):
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
        source_label=local_source_label,
        source_key="local",
        is_web=False,
    )


def open_intro_clip():
    clip_path = os.path.join(os.path.dirname(__file__), INTRO_VIDEO_FILENAME)
    if not os.path.exists(clip_path):
        print(f"Intro clip not found: {clip_path}. Using field image only.")
        return None

    clip_cap = cv2.VideoCapture(clip_path)
    if not clip_cap.isOpened():
        print(f"Could not open intro clip: {clip_path}. Using field image only.")
        return None

    return clip_cap


def read_intro_frame(clip_cap, width, height):
    if clip_cap is None:
        return None

    ok, clip_frame = clip_cap.read()
    if not ok or clip_frame is None:
        return None

    if clip_frame.shape[0] != height or clip_frame.shape[1] != width:
        clip_frame = cv2.resize(clip_frame, (width, height), interpolation=cv2.INTER_LINEAR)
    return clip_frame


def load_field_background(width, height):
    field_path = os.path.join(os.path.dirname(__file__), FIELD_BACKGROUND_FILENAME)
    if not os.path.exists(field_path):
        print(f"Field image not found: {field_path}. Using camera frame as fallback background.")
        return None

    field_image = cv2.imread(field_path, cv2.IMREAD_COLOR)
    if field_image is None:
        print(f"Could not read field image: {field_path}. Using camera frame as fallback background.")
        return None

    if field_image.shape[0] != height or field_image.shape[1] != width:
        field_image = cv2.resize(field_image, (width, height), interpolation=cv2.INTER_LINEAR)

    # The field artwork has a baked-in green "FINISH" label on the right side.
    # Recolor green-dominant pixels to blue so the finish marker matches the UI.
    converted = field_image.copy()
    blue = converted[:, :, 0]
    green = converted[:, :, 1]
    red = converted[:, :, 2]
    green_mask = (green > 90) & (green > red + 35) & (green > blue + 35)
    if np.any(green_mask):
        blue[green_mask] = green[green_mask]
        green[green_mask] = 0
        red[green_mask] = 0
    field_image = converted

    return field_image


def process_wait_phase_commands():
    try:
        command = command_queue.get_nowait()
    except queue.Empty:
        return

    if command != "play_intro":
        command_queue.put(command)
        return

    push_event({
        "type": "status",
        "message": "Intro command ignored. Video plays once on first Start Game.",
    })


server_thread = threading.Thread(target=start_websocket_server, daemon=True)
server_thread.start()

fallback_cap, fallback_camera_index = open_local_fallback_camera()
if not fallback_cap:
    fallback_camera_index = None
    local_fallback_source_label = "Local Camera"
    print("Could not open local camera. Waiting for browser frames from the website.")
else:
    if fallback_camera_index == PREFERRED_CAMERA_INDEX:
        local_fallback_source_label = PREFERRED_CAMERA_LABEL
        print(
            f"Opened preferred local camera '{PREFERRED_CAMERA_LABEL}' "
            f"(index {fallback_camera_index}) as fallback source."
        )
    else:
        local_fallback_source_label = f"Local Camera (index {fallback_camera_index})"
        print(
            f"Preferred local camera '{PREFERRED_CAMERA_LABEL}' not found. "
            f"Opened local camera index {fallback_camera_index} as fallback source."
        )

# ----------------------------
# green marker range (HSV)
# ----------------------------
lower = np.array([40, 70, 70])
upper = np.array([80, 255, 255])

# ----------------------------
# traced points from guide image
# ----------------------------
guide_points = np.array([
    [575, 515],
    [631, 521],
    [675, 524],
    [716, 524],
    [743, 515],
    [771, 491],
    [780, 463],
    [785, 427],
    [800, 396],
    [831, 384],
    [871, 389],
    [891, 408],
    [892, 449],
    [890, 487],
    [883, 619],
    [889, 661],
    [916, 686],
    [957, 688],
    [981, 655],
    [987, 616],
    [988, 574],
    [1006, 551],
    [1043, 547],
    [1081, 549],
    [1126, 538],
    [1151, 509],
    [1161, 475],
    [1169, 432],
    [1204, 401],
    [1253, 408],
    [1270, 445],
    [1275, 488],
    [1264, 783],
], dtype=np.float32)

print("Waiting for first frame from website (Chrome/iPhone) or local camera...")
frame_packet = None

if fallback_cap is None:
    while frame_packet is None:
        process_wait_phase_commands()
        frame_packet = pop_latest_browser_frame()
        if frame_packet is None:
            time.sleep(FRAME_IDLE_SLEEP)
else:
    wait_deadline = time.time() + WAIT_FOR_BROWSER_FIRST_FRAME_SECONDS
    while frame_packet is None and time.time() < wait_deadline:
        process_wait_phase_commands()
        frame_packet = pop_latest_browser_frame()
        if frame_packet is None:
            time.sleep(FRAME_IDLE_SLEEP)

    while frame_packet is None:
        process_wait_phase_commands()
        frame_packet = read_next_frame(fallback_cap, local_fallback_source_label)
        if frame_packet is None:
            time.sleep(FRAME_IDLE_SLEEP)

frame = frame_packet["frame"]
print(f"Detection source selected: {frame_packet['sourceLabel']}")

cam_h, cam_w = frame.shape[:2]
intro_clip_cap = open_intro_clip()
field_background = load_field_background(cam_w, cam_h)

track_points = guide_points.astype(np.int32)
track_points[:, 0] = np.clip(track_points[:, 0], 0, cam_w - 1)
track_points[:, 1] = np.clip(track_points[:, 1], 0, cam_h - 1)

road_thickness = max(16, int(min(cam_w, cam_h) * 0.05))

lane_mask = np.zeros((cam_h, cam_w), dtype=np.uint8)
cv2.polylines(
    lane_mask,
    [track_points],
    False,
    255,
    thickness=road_thickness,
    lineType=cv2.LINE_AA,
)

kernel = np.ones((5, 5), np.uint8)
lane_mask = cv2.dilate(lane_mask, kernel, iterations=1)

start_pt = track_points[0].astype(np.float32)
next_start_pt = track_points[1].astype(np.float32)
end_pt = track_points[-1].astype(np.float32)

start_dir = normalize(next_start_pt - start_pt)

start_perp = np.array([-start_dir[1], start_dir[0]], dtype=np.float32)
line_half = road_thickness // 2 + 10

start_line_a = tuple((start_pt + start_perp * line_half).astype(int))
start_line_b = tuple((start_pt - start_perp * line_half).astype(int))
# Finish line: use the LAST lane coordinate, draw horizontal (x-axis),
# and set width equal to lane thickness.
finish_line_point = end_pt.copy()
finish_center_x = int(round(finish_line_point[0]))
finish_y = int(round(finish_line_point[1]))
finish_half_width = max(6, road_thickness // 2)
finish_x_min = max(0, finish_center_x - finish_half_width)
finish_x_max = min(cam_w - 1, finish_center_x + finish_half_width)
finish_line_a = (finish_x_min, finish_y)
finish_line_b = (finish_x_max, finish_y)
finish_stop_radius = max(18, int(road_thickness * 0.75))

print(
    f"Finish line locked to last coordinate at ({finish_center_x}, {finish_y}), "
    f"x-span [{finish_x_min}, {finish_x_max}], stop radius {finish_stop_radius}px."
)

game = reset_game()
push_event(make_state_payload("idle"))
last_source_label = ""
intro_video_active = False
intro_video_started_at = 0.0

try:
    while True:
        while True:
            try:
                command = command_queue.get_nowait()
            except queue.Empty:
                break

            if command == "arm":
                if not intro_has_played:
                    intro_has_played = True
                    if intro_clip_cap is not None:
                        intro_clip_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        intro_video_active = True
                        intro_video_started_at = time.time()
                        push_event({
                            "type": "status",
                            "message": "Race intro video started (10s).",
                        })
                    else:
                        push_event({
                            "type": "status",
                            "message": "Intro video unavailable. Starting game on field image.",
                        })
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
            elif command == "play_intro":
                push_event({
                    "type": "status",
                    "message": "Intro command ignored. Video plays once (10s) on first Start Game.",
                })

        frame_packet = read_next_frame(fallback_cap, local_fallback_source_label)
        if frame_packet is None:
            time.sleep(FRAME_IDLE_SLEEP)
            continue

        detection_frame = frame_packet["frame"]
        source_label = str(frame_packet.get("sourceLabel") or "Unknown source")
        source_transport = "WEB" if frame_packet.get("isWeb") else "LOCAL"
        if source_label != last_source_label:
            push_event({
                "type": "status",
                "message": f"Python detection source: {source_label}",
            })
            last_source_label = source_label

        if detection_frame.shape[0] != cam_h or detection_frame.shape[1] != cam_w:
            detection_frame = cv2.resize(detection_frame, (cam_w, cam_h), interpolation=cv2.INTER_LINEAR)

        frame = None
        if intro_video_active:
            intro_elapsed = time.time() - intro_video_started_at
            if intro_elapsed >= INTRO_VIDEO_MAX_SECONDS:
                intro_video_active = False
                push_event({
                    "type": "status",
                    "message": "Intro finished. Switched to field view.",
                })
            else:
                intro_frame = read_intro_frame(intro_clip_cap, cam_w, cam_h)
                if intro_frame is None:
                    intro_video_active = False
                    push_event({
                        "type": "status",
                        "message": "Intro ended early. Switched to field view.",
                    })
                else:
                    frame = intro_frame

        if frame is None:
            if field_background is not None:
                frame = field_background.copy()
            else:
                frame = detection_frame.copy()

        hsv = cv2.cvtColor(detection_frame, cv2.COLOR_BGR2HSV)
        green_mask = cv2.inRange(hsv, lower, upper)
        contours, _ = cv2.findContours(green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

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

            distance_to_finish = float(np.hypot(cx - finish_line_point[0], cy - finish_line_point[1]))
            near_finish_point = distance_to_finish <= finish_stop_radius

            if game["game_running"] and near_finish_point:
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

        display_time = 0.0
        if game["game_running"]:
            display_time = time.time() - game["start_time"]
        elif game["timer_finished"]:
            display_time = game["raw_time"]

        hud_overlay = frame.copy()
        cv2.rectangle(hud_overlay, (0, 0), (cam_w, min(HUD_PANEL_HEIGHT, cam_h)), (0, 0, 0), -1)
        frame = cv2.addWeighted(hud_overlay, 0.5, frame, 0.5, 0)

        if cx is None:
            cv2.putText(frame, "NO CAR DETECTED", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
        elif car_inside_lane:
            cv2.putText(frame, "INSIDE LANE", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        else:
            cv2.putText(frame, "OUT OF LANE", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

        if game["game_running"]:
            cv2.putText(frame, f"TIME: {display_time:.2f}s", (20, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 0), 2)
            cv2.putText(
                frame,
                f"PENALTY COUNT: {game['outside_count']} (+{game['outside_count'] * PENALTY_SECONDS:.2f}s)",
                (20, 110),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 165, 255),
                2,
            )
            running_final_score = display_time + game["outside_count"] * PENALTY_SECONDS
            cv2.putText(frame, f"FINAL SCORE: {running_final_score:.2f}s", (20, 145), cv2.FONT_HERSHEY_SIMPLEX, 0.95, (0, 255, 255), 2)
        elif game["timer_finished"]:
            cv2.putText(frame, f"RAW TIME: {game['raw_time']:.2f}s", (20, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (255, 255, 0), 2)
            cv2.putText(
                frame,
                f"PENALTY COUNT: {game['outside_count']} (+{game['outside_count'] * PENALTY_SECONDS:.2f}s)",
                (20, 110),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 165, 255),
                2,
            )
            cv2.putText(frame, f"FINAL SCORE: {game['final_time']:.2f}s", (20, 145), cv2.FONT_HERSHEY_SIMPLEX, 0.95, (0, 255, 255), 2)
        else:
            cv2.putText(frame, "TIME: 0.00s", (20, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 0), 2)
            cv2.putText(frame, "PENALTY COUNT: 0 (+0.00s)", (20, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)
            cv2.putText(frame, "FINAL SCORE: 0.00s", (20, 145), cv2.FONT_HERSHEY_SIMPLEX, 0.95, (0, 255, 255), 2)
            cv2.putText(frame, "Press Start on the website", (20, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        cv2.putText(frame, f"SOURCE ({source_transport}): {source_label}", (20, min(165, cam_h - 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 220, 120), 2)
        cv2.putText(frame, "FINISH", (max(20, cam_w - 150), 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, FINISH_COLOR, 2)

        cv2.imshow(DISPLAY_WINDOW_NAME, frame)

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
    if intro_clip_cap is not None:
        intro_clip_cap.release()
    cv2.destroyAllWindows()
    if server_loop is not None:
        server_loop.call_soon_threadsafe(server_loop.stop)
        with contextlib.suppress(Exception):
            server_thread.join(timeout=1)
