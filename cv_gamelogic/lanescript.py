import cv2
import numpy as np

PREFERRED_CAMERA_INDEX = 1
CAMERA_FALLBACK_INDICES = (PREFERRED_CAMERA_INDEX, 0, 2)
WINDOW_NAME = "trace lane (camera)"
TEXT_COLOR = (255, 255, 255)
TEXT_BG_COLOR = (0, 0, 0)

points = []
latest_frame = None
frozen_frame = None
freeze_mode = False


def open_camera():
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


def draw_points(base_frame, traced_points):
    preview = base_frame.copy()

    for i, point in enumerate(traced_points):
        cv2.circle(preview, point, 4, (0, 255, 0), -1)
        cv2.putText(
            preview,
            str(i),
            (point[0] + 5, point[1] - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (0, 255, 0),
            1,
            cv2.LINE_AA,
        )

        if i > 0:
            cv2.line(preview, traced_points[i - 1], point, (255, 0, 0), 2, cv2.LINE_AA)

    return preview


def draw_hud(frame, *, camera_index, freeze_enabled):
    mode_label = "FROZEN" if freeze_enabled else "LIVE"
    lines = [
        f"Camera index: {camera_index} | Mode: {mode_label}",
        "Left click: add point | Z: undo | C: clear | P: print points | SPACE: freeze/resume | ESC: quit",
    ]

    y = 25
    for line in lines:
        (text_w, text_h), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.rectangle(frame, (8, y - text_h - 8), (12 + text_w, y + 6), TEXT_BG_COLOR, -1)
        cv2.putText(
            frame,
            line,
            (12, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            TEXT_COLOR,
            1,
            cv2.LINE_AA,
        )
        y += 28


def click_event(event, x, y, flags, param):
    del flags, param
    global points
    if event == cv2.EVENT_LBUTTONDOWN:
        points.append((x, y))
        print(f"({x}, {y}),")


cap, active_camera_index = open_camera()
if cap is None:
    print("Could not open any camera. Tried indices:", CAMERA_FALLBACK_INDICES)
    raise SystemExit(1)

print(f"Tracing lane from camera index {active_camera_index}")
print("Controls: left click add | z undo | c clear | p print | space freeze/resume | esc quit")

cv2.namedWindow(WINDOW_NAME)
cv2.setMouseCallback(WINDOW_NAME, click_event)

try:
    while True:
        ret, frame = cap.read()
        if ret and frame is not None:
            latest_frame = frame

        if latest_frame is None:
            key = cv2.waitKey(10) & 0xFF
            if key == 27:
                break
            continue

        if freeze_mode and frozen_frame is not None:
            base_frame = frozen_frame
        else:
            base_frame = latest_frame

        preview = draw_points(base_frame, points)
        draw_hud(preview, camera_index=active_camera_index, freeze_enabled=freeze_mode)
        cv2.imshow(WINDOW_NAME, preview)

        key = cv2.waitKey(1) & 0xFF

        if key == ord("z") and points:
            removed_point = points.pop()
            print(f"Undo: {removed_point}")
        elif key == ord("c"):
            points.clear()
            print("Cleared all points.")
        elif key == ord("p"):
            print("\ntrack_points = np.array([")
            for point in points:
                print(f"    [{point[0]}, {point[1]}],")
            print("], dtype=np.int32)\n")
        elif key == ord(" "):
            freeze_mode = not freeze_mode
            if freeze_mode:
                frozen_frame = latest_frame.copy()
                print("Frame frozen. Click points on this frame.")
            else:
                frozen_frame = None
                print("Live camera resumed.")
        elif key == 27:
            break
finally:
    cap.release()
    cv2.destroyAllWindows()
