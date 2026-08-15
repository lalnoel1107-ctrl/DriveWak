simport os
import threading
import time
import tkinter as tk
from tkinter import ttk
import winsound

try:
    import cv2
except ImportError as exc:
    raise SystemExit("OpenCV is required. Install it with: pip install opencv-python") from exc


class DriveWakeApp:
    def __init__(self, root):
        self.root = root
        self.root.title("DriveWake")
        self.root.geometry("760x560")
        self.root.configure(bg="#111827")

        self.running = False
        self.thread = None
        self.cap = None
        self.alarm_active = False
        self.closed_frames = 0
        self.status = "Idle"
        self.latest_frame = None

        self.face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        self.eye_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_eye.xml"
        )

        if not os.path.exists(cv2.data.haarcascades + "haarcascade_frontalface_default.xml"):
            raise SystemExit("Face detection model not found.")

        self.build_ui()
        threading.Thread(target=self.fetch_location, daemon=True).start()

    def build_ui(self):
        title = ttk.Label(self.root, text="DriveWake", font=("Segoe UI", 24, "bold"), foreground="#f9fafb", background="#111827")
        title.pack(pady=(16, 8))

        subtitle = ttk.Label(
            self.root,
            text="Detects drowsiness by watching your eyes and alerts you immediately if you appear asleep.",
            font=("Segoe UI", 11),
            foreground="#d1d5db",
            background="#111827",
        )
        subtitle.pack(pady=(0, 12))

        self.status_label = ttk.Label(
            self.root,
            text="Status: Idle",
            font=("Segoe UI", 14, "bold"),
            foreground="#fbbf24",
            background="#111827",
        )
        self.status_label.pack(pady=(0, 8))

        self.location_label = ttk.Label(
            self.root,
            text="Location: Determining…",
            font=("Segoe UI", 10),
            foreground="#d1d5db",
            background="#111827",
        )
        self.location_label.pack(pady=(0, 12))

        self.canvas = tk.Canvas(self.root, width=640, height=480, bg="#0f172a", highlightthickness=0)
        self.canvas.pack(pady=8)

        button_frame = ttk.Frame(self.root, style="TFrame")
        button_frame.pack(pady=10)

        self.start_button = ttk.Button(button_frame, text="Start monitoring", command=self.start_monitoring)
        self.start_button.grid(row=0, column=0, padx=6)

        self.stop_button = ttk.Button(button_frame, text="Stop", command=self.stop_monitoring)
        self.stop_button.grid(row=0, column=1, padx=6)

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def start_monitoring(self):
        if self.running:
            return

        self.running = True
        self.status = "Watching"
        self.alarm_active = False
        self.closed_frames = 0
        self.update_status("Status: Watching")
        self.cap = cv2.VideoCapture(0)

        if not self.cap.isOpened():
            self.update_status("Status: No camera detected")
            self.running = False
            return

        self.thread = threading.Thread(target=self.processing_loop, daemon=True)
        self.thread.start()
        threading.Thread(target=self.fetch_location, daemon=True).start()

    def stop_monitoring(self):
        self.running = False
        self.alarm_active = False
        self.closed_frames = 0
        self.update_status("Status: Stopped")
        if self.cap is not None:
            self.cap.release()
            self.cap = None

    def processing_loop(self):
        while self.running:
            ret, frame = self.cap.read()
            if not ret:
                break

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(gray, 1.3, 5)

            if len(faces) == 0:
                self.closed_frames = 0
                self.alarm_active = False
                self.status = "No face"
                self.show_frame(frame)
                self.update_status("Status: No face detected")
                time.sleep(0.05)
                continue

            for (x, y, w, h) in faces:
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                roi_gray = gray[y : y + h, x : x + w]
                roi_color = frame[y : y + h, x : x + w]
                eyes = self.eye_cascade.detectMultiScale(roi_gray, 1.1, 3)

                if len(eyes) >= 2:
                    self.closed_frames = 0
                    self.alarm_active = False
                    self.status = "Awake"
                    for (ex, ey, ew, eh) in eyes:
                        cv2.rectangle(roi_color, (ex, ey), (ex + ew, ey + eh), (255, 0, 0), 2)
                else:
                    self.closed_frames += 1
                    self.status = "Possible drowsiness"
                    if self.closed_frames >= 12 and not self.alarm_active:
                        self.alarm_active = True
                        self.status = "Sleep detected"
                        winsound.Beep(1200, 1000)
                        winsound.Beep(800, 1000)

            self.show_frame(frame)
            self.update_status(f"Status: {self.status}")
            time.sleep(0.05)

        self.stop_monitoring()

    def show_frame(self, frame):
        self.latest_frame = frame
        self.root.after(0, self._render_frame)

    def _render_frame(self):
        if self.latest_frame is None:
            return

        frame = cv2.cvtColor(self.latest_frame, cv2.COLOR_BGR2RGB)
        img = cv2.resize(frame, (640, 480))
        photo = tk.PhotoImage(data=self._img_to_tk(img))
        self.canvas.create_image(0, 0, anchor="nw", image=photo)
        self.canvas.image = photo

    def _img_to_tk(self, img):
        import io
        from PIL import Image

        pil_image = Image.fromarray(img)
        buffer = io.BytesIO()
        pil_image.save(buffer, format="ppm")
        return buffer.getvalue()

    def update_status(self, text):
        self.root.after(0, lambda: self.status_label.config(text=text))

    def update_location(self, text):
        self.root.after(0, lambda: self.location_label.config(text=f"Location: {text}"))

    def fetch_location(self):
        def try_request(url):
            import urllib.request
            import json
            req = urllib.request.Request(url, headers={"User-Agent": "DriveWake/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.load(resp)

        sources = [
            "https://ipapi.co/json/",
            "https://ipinfo.io/json",
        ]
        for source in sources:
            try:
                data = try_request(source)
                if source.endswith("ipapi.co/json/"):
                    city = data.get("city")
                    region = data.get("region")
                    country = data.get("country_name")
                    lat = data.get("latitude")
                    lon = data.get("longitude")
                else:
                    city = data.get("city")
                    region = data.get("region")
                    country = data.get("country")
                    loc = data.get("loc", "")
                    lat, lon = (loc.split(",") if "," in loc else (None, None))
                parts = [part for part in [city, region, country] if part]
                if parts:
                    coords = f" ({float(lat):.4f}, {float(lon):.4f})" if lat and lon else ""
                    self.update_location("".join([", ".join(parts), coords]))
                    return
            except Exception:
                continue
        self.update_location("Unable to determine location")

    def on_close(self):
        self.stop_monitoring()
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = DriveWakeApp(root)
    root.mainloop()