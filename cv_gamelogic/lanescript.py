import cv2
import numpy as np

# load guide image
img = cv2.imread("lane.jpeg")
if img is None:
    print("Could not load lane.jpeg")
    exit()

points = []

def click_event(event, x, y, flags, param):
    global img, points

    if event == cv2.EVENT_LBUTTONDOWN:
        points.append((x, y))
        print(f"({x}, {y}),")

        # draw clicked point
        cv2.circle(img, (x, y), 4, (0, 255, 0), -1)

        # draw line from previous point
        if len(points) > 1:
            cv2.line(img, points[-2], points[-1], (255, 0, 0), 2)

cv2.namedWindow("trace lane")
cv2.setMouseCallback("trace lane", click_event)

while True:
    preview = img.copy()

    # show all clicked points
    for i, p in enumerate(points):
        cv2.circle(preview, p, 4, (0, 255, 0), -1)
        cv2.putText(preview, str(i), (p[0] + 5, p[1] - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

    cv2.imshow("trace lane", preview)

    key = cv2.waitKey(1) & 0xFF

    # press z to undo last point
    if key == ord("z") and len(points) > 0:
        points.pop()
        img = cv2.imread("lane.png")

        for i, p in enumerate(points):
            cv2.circle(img, p, 4, (0, 255, 0), -1)
            if i > 0:
                cv2.line(img, points[i-1], points[i], (255, 0, 0), 2)

    # press p to print as numpy array
    elif key == ord("p"):
        print("\ntrack_points = np.array([")
        for p in points:
            print(f"    [{p[0]}, {p[1]}],")
        print("], dtype=np.int32)\n")

    # esc to quit
    elif key == 27:
        break

cv2.destroyAllWindows()