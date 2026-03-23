import cv2
import numpy as np
import time

cap = cv2.VideoCapture(2)

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

# size of guide image used when tracing
GUIDE_W = 640
GUIDE_H = 360

# ----------------------------
# read one frame to get camera size
# ----------------------------
ret, frame = cap.read()
if not ret:
    print("Could not read camera")
    cap.release()
    raise SystemExit

cam_h, cam_w = frame.shape[:2]

# ----------------------------
# scale guide points to camera size
# ----------------------------
scale_x = cam_w / GUIDE_W
scale_y = cam_h / GUIDE_H

track_points = guide_points.copy()
track_points[:, 0] *= scale_x
track_points[:, 1] *= scale_y
track_points = track_points.astype(np.int32)

# lane width
road_thickness = max(30, int(min(cam_w, cam_h) * 0.15))

# ----------------------------
# make lane mask
# ----------------------------
lane_mask = np.zeros((cam_h, cam_w), dtype=np.uint8)
cv2.polylines(
    lane_mask,
    [track_points],
    False,
    255,
    thickness=road_thickness,
    lineType=cv2.LINE_AA
)

# make lane slightly more forgiving
kernel = np.ones((7, 7), np.uint8)
lane_mask = cv2.dilate(lane_mask, kernel, iterations=1)

# ----------------------------
# start / finish geometry from path
# ----------------------------
start_pt = track_points[0].astype(np.float32)
next_start_pt = track_points[1].astype(np.float32)

end_prev_pt = track_points[-2].astype(np.float32)
end_pt = track_points[-1].astype(np.float32)

def normalize(v):
    n = np.linalg.norm(v)
    if n == 0:
        return v
    return v / n

# path direction at start and finish
start_dir = normalize(next_start_pt - start_pt)
finish_dir = normalize(end_pt - end_prev_pt)

# perpendicular vectors for drawing line across lane
start_perp = np.array([-start_dir[1], start_dir[0]], dtype=np.float32)
finish_perp = np.array([-finish_dir[1], finish_dir[0]], dtype=np.float32)

line_half = road_thickness // 2 + 10

start_line_a = tuple((start_pt + start_perp * line_half).astype(int))
start_line_b = tuple((start_pt - start_perp * line_half).astype(int))

finish_line_a = tuple((end_pt + finish_perp * line_half).astype(int))
finish_line_b = tuple((end_pt - finish_perp * line_half).astype(int))

# ----------------------------
# game state
# ----------------------------
game_armed = False          # pressed S, waiting to cross start
timer_started = False
timer_finished = False

start_time = 0.0
raw_time = 0.0
final_time = 0.0

outside_count = 0
penalty_seconds = 1.0       # add 1 sec for each outside event

was_inside_lane = True
was_before_start = True
was_before_finish = True

# ----------------------------
# helper functions
# ----------------------------
def point_is_inside_lane(x, y, mask):
    if 0 <= x < mask.shape[1] and 0 <= y < mask.shape[0]:
        return mask[y, x] > 0
    return False

def point_has_passed_line(point, line_point, direction_vec):
    """
    True if point is beyond the line_point in the direction of travel.
    Uses dot product.
    """
    p = np.array(point, dtype=np.float32)
    lp = np.array(line_point, dtype=np.float32)
    return np.dot(p - lp, direction_vec) >= 0

# ----------------------------
# main loop
# ----------------------------
while True:
    ret, frame = cap.read()
    if not ret:
        break

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    green_mask = cv2.inRange(hsv, lower, upper)

    contours, _ = cv2.findContours(
        green_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    # draw lane overlay
    overlay = frame.copy()
    cv2.polylines(
        overlay,
        [track_points],
        False,
        (255, 255, 255),
        thickness=road_thickness,
        lineType=cv2.LINE_AA
    )

    # draw start / finish lines
    cv2.line(overlay, start_line_a, start_line_b, (0, 0, 255), 3)
    cv2.line(overlay, finish_line_a, finish_line_b, (0, 255, 0), 3)

    frame = cv2.addWeighted(overlay, 0.45, frame, 0.55, 0)

    cx, cy = None, None
    car_inside_lane = False

    # pick biggest green blob
    biggest = None
    biggest_area = 0
    for c in contours:
        area = cv2.contourArea(c)
        if area > 300 and area > biggest_area:
            biggest = c
            biggest_area = area

    if biggest is not None:
        x, y, w, h = cv2.boundingRect(biggest)
        cx = x + w // 2
        cy = y + h // 2

        cv2.circle(frame, (cx, cy), 10, (0, 255, 0), -1)
        cv2.putText(
            frame, f"({cx},{cy})", (cx + 10, cy - 10),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1
        )

        car_inside_lane = point_is_inside_lane(cx, cy, lane_mask)

        # ----------------------------
        # start logic
        # press S to arm, then crossing start line begins timer
        # ----------------------------
        current_before_start = not point_has_passed_line(
            (cx, cy), start_pt, start_dir
        )

        if game_armed and not timer_started and not timer_finished:
            if was_before_start and not current_before_start:
                timer_started = True
                game_armed = False
                start_time = time.time()
                raw_time = 0.0
                final_time = 0.0
                outside_count = 0
                was_inside_lane = car_inside_lane

        was_before_start = current_before_start

        # ----------------------------
        # count outside-lane events
        # only count inside -> outside transitions
        # ----------------------------
        if timer_started and not timer_finished:
            if was_inside_lane and not car_inside_lane:
                outside_count += 1
            was_inside_lane = car_inside_lane

        # ----------------------------
        # finish logic
        # detect when car passes beyond the last point
        # ----------------------------
        current_before_finish = not point_has_passed_line(
            (cx, cy), end_pt, finish_dir
        )

        if timer_started and not timer_finished:
            if was_before_finish and not current_before_finish:
                raw_time = time.time() - start_time
                final_time = raw_time + outside_count * penalty_seconds
                timer_started = False
                timer_finished = True

        was_before_finish = current_before_finish

    # live timer
    display_time = 0.0
    if timer_started:
        display_time = time.time() - start_time
    elif timer_finished:
        display_time = raw_time

    # ----------------------------
    # UI text
    # ----------------------------
    if cx is None:
        cv2.putText(frame, "NO CAR DETECTED", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
    elif car_inside_lane:
        cv2.putText(frame, "INSIDE LANE", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
    else:
        cv2.putText(frame, "OUT OF LANE", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

    if game_armed and not timer_started and not timer_finished:
        cv2.putText(frame, "ARMED - CROSS START", (20, 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    elif timer_started:
        cv2.putText(frame, f"TIME: {display_time:.2f}s", (20, 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
    elif timer_finished:
        cv2.putText(frame, f"RAW TIME: {raw_time:.2f}s", (20, 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 0), 2)
        cv2.putText(frame, f"OUTSIDE COUNT: {outside_count}", (20, 120),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 165, 255), 2)
        cv2.putText(frame, f"FINAL TIME: {final_time:.2f}s", (20, 160),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
    else:
        cv2.putText(frame, "Press S to Arm", (20, 80),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

    cv2.putText(frame, f"PENALTY COUNT: {outside_count}", (20, cam_h - 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)

    cv2.putText(frame, "START", (start_line_a[0] - 20, start_line_a[1] - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
    cv2.putText(frame, "FINISH", (finish_line_a[0] - 30, finish_line_a[1] - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

    cv2.imshow("frame", frame)
    cv2.imshow("green mask", green_mask)
    cv2.imshow("lane mask", lane_mask)

    key = cv2.waitKey(1) & 0xFF

    # arm / restart game
    if key == ord('s'):
        game_armed = True
        timer_started = False
        timer_finished = False
        start_time = 0.0
        raw_time = 0.0
        final_time = 0.0
        outside_count = 0
        was_inside_lane = True
        was_before_start = True
        was_before_finish = True

    # esc to quit
    if key == 27:
        break

cap.release()
cv2.destroyAllWindows()