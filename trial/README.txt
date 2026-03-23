Race Control - Integrated Build
================================

HOW TO RUN (No terminal needed after setup)
--------------------------------------------

Windows:
  Double-click  launch.bat
  - It installs dependencies automatically on first run
  - Starts the Python backend in the background
  - Opens http://localhost:8000 in your browser

Mac / Linux:
  1. Open Terminal once (only needed the first time)
  2. Run:  chmod +x launch.sh
  3. After that, double-click launch.sh to start everything

That's it. The browser is the only interface you need.


HOW IT WORKS
------------
- camera_test.py is a FastAPI server that serves the website AND runs the game logic.
- When you press Start in the browser, it activates your webcam and begins sending
  frames to Python over WebSocket.
- Python runs OpenCV lane detection on those frames and sends back:
    - Penalty count / time (whenever the car goes out of the lane)
    - Final result (when the car crosses the finish line)
- No OpenCV windows open. Everything is shown in the browser.


FILE STRUCTURE
--------------
  launch.bat          <-- Double-click to run (Windows)
  launch.sh           <-- Double-click to run (Mac/Linux)
  camera_test.py      <-- Python backend + game logic (FastAPI + OpenCV)
  index.html          <-- Main dashboard
  start.html          <-- Entry / splash screen
  app.js              <-- Frontend logic (timer, WebSocket, camera)
  styles.css          <-- Styling
  requirements.txt    <-- Python dependencies
  model/              <-- 3D logo files (keep this folder next to the files)


REQUIREMENTS
------------
- Python 3.10 or higher  (https://python.org)
- A webcam connected to your computer
- A modern browser (Chrome or Edge recommended)


MANUAL START (if launchers don't work)
---------------------------------------
  pip install -r requirements.txt
  python camera_test.py
  Open http://localhost:8000
