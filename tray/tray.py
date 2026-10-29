"""Claude usage tray icon: reads ~/.claude/tray-state.json, shows the 5-hour percentage on the icon
and opens a small usage card (5-hour and weekly rings) when the icon is clicked."""
import ctypes, json, math, os, queue, sys, threading, time
import tkinter as tk
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont, ImageTk
import pystray

STATE = sys.argv[sys.argv.index("--state") + 1] if "--state" in sys.argv else \
    os.path.join(os.path.expanduser("~"), ".claude", "tray-state.json")
REFRESH = 30          # seconds
STALE = 30 * 60       # file not updated for 30 min -> grey "--"
SIZE = 64
TITLE = "Claude usage"


def load():
    try:
        with open(STATE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def num(v):
    return v if isinstance(v, (int, float)) else None


def left(ts, now):
    m = max(0, int((ts - now) // 60))
    d, h = m // 1440, m % 1440 // 60
    return f"{d}d {h}h" if d else (f"{h}h {m % 60}m" if h else f"{m}m")


def color(pct):
    if pct is None:
        return (120, 120, 120)
    if pct < 60:
        return (46, 160, 67)
    if pct < 85:
        return (210, 153, 34)
    return (218, 54, 51)


def font(size):
    for name in ("arialbd.ttf", "arial.ttf", "segoeuib.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            pass
    return ImageFont.load_default()


def make_icon(pct):
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=12, fill=color(pct))
    text = "--" if pct is None else str(min(int(round(pct)), 99)) if pct < 99.5 else "99"
    size = 44 if len(text) < 3 else 34
    f = font(size)
    mask = Image.new("L", (SIZE * 2, SIZE * 2), 0)
    ImageDraw.Draw(mask).text((SIZE, SIZE), text, font=f, fill=255, anchor="mm")
    l, t, r, b = mask.getbbox()  # ink box, so digits like "1" centre by what is drawn
    img.paste("white", ((SIZE - l - r) // 2, (SIZE - t - b) // 2), mask)
    return img


def read():
    """-> ((pct, resets_at) for 5h, same for week, file update time, now); pct is None when unusable."""
    s = load()
    now = time.time()
    upd = num(s.get("updated"))
    fresh = upd is not None and now - upd < STALE

    def win(key):
        w = s.get(key) if isinstance(s.get(key), dict) else {}
        r = num(w.get("resets_at"))
        ok = fresh and num(w.get("pct")) is not None and (r is None or r > now)  # reset passed -> void
        return (w["pct"] if ok else None), r
    return win("five_hour"), win("seven_day"), upd, now


def dark_mode():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as k:
            return winreg.QueryValueEx(k, "AppsUseLightTheme")[0] == 0
    except Exception:
        return False


def shade(pct, dark=False):
    """(ring colour, text colour) in Apple system colours, same thresholds as the usage band."""
    if pct is None:
        return (142, 142, 147), (142, 142, 147)
    if pct >= 85:
        return (255, 59, 48), ((255, 69, 58) if dark else (215, 0, 21))
    if pct >= 60:
        return (255, 149, 0), ((255, 159, 10) if dark else (201, 52, 0))
    return (52, 199, 89), ((48, 209, 88) if dark else (36, 138, 61))


def mix(a, b, t):
    return tuple(round(x * t + y * (1 - t)) for x, y in zip(a, b))


def ring_image(d, pct, bg):
    """One activity ring like the band's: faint track, round-capped arc (supersampled for smooth edges)."""
    S = 4
    col = shade(pct)[0]
    D, w = d * S, d * 0.156 * S
    img = Image.new("RGBA", (D, D), bg + (255,))
    g = ImageDraw.Draw(img)
    box = (0, 0, D - 1, D - 1)  # Pillow draws a wide stroke inward from the box edge
    g.ellipse(box, outline=mix(col, bg, 0.22), width=round(w))
    if pct is not None:
        end = -90 + 360 * min(max(pct, 0.5), 99.9) / 100
        g.arc(box, -90, end, fill=col, width=round(w))
        rm = D / 2 - w / 2
        for ang in (-90, end):  # round caps
            ex, ey = D / 2 + rm * math.cos(math.radians(ang)), D / 2 + rm * math.sin(math.radians(ang))
            g.ellipse((ex - w / 2, ey - w / 2, ex + w / 2, ey + w / 2), fill=col)
    return img.resize((d, d), Image.LANCZOS)


def hexc(c):
    return "#%02x%02x%02x" % c


class Popup:
    W, H = 231, 70  # logical pixels

    def __init__(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.k = self.root.winfo_fpixels("1i") / 96
        self.win = None
        self.closed_at = 0.0
        self.q = queue.Queue()
        self.root.after(100, self.poll)

    def poll(self):
        try:
            while True:
                self.q.get_nowait()
                self.toggle()
        except queue.Empty:
            pass
        self.root.after(100, self.poll)

    def toggle(self):
        if self.win:
            self.close()
        elif time.time() - self.closed_at > 0.3:  # a click that just dismissed it must not reopen it
            self.show()

    def close(self, *_):
        if self.win:
            self.win.destroy()
            self.win = None
            self.closed_at = time.time()

    def show(self, pos=None):
        k = self.k
        w, h = int(self.W * k), int(self.H * k)
        px, py = pos or (self.root.winfo_pointerx(), self.root.winfo_pointery())
        x = min(max(px - w // 2, 8), self.root.winfo_screenwidth() - w - 8)
        y = max(py - h - int(30 * k), 8)
        dark = dark_mode()
        bg, dim, edge = ((28, 28, 30), (152, 152, 157), (58, 58, 60)) if dark else ((249, 249, 249), (110, 110, 115), (208, 208, 208))
        win = self.win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.attributes("-topmost", True)
        c = tk.Canvas(win, width=w, height=h, bg=hexc(bg), highlightthickness=1, highlightbackground=hexc(edge))
        c.pack()
        (p5, r5), (p7, r7), upd, now = read()
        win.rings = []  # keep the images alive
        for i, (name, p, r) in enumerate((("5-hour", p5, r5), ("Weekly", p7, r7))):
            x0 = (15 + 112 * i) * k
            img = ImageTk.PhotoImage(ring_image(int(47 * k), p, bg), master=win)
            win.rings.append(img)
            c.create_image(x0, 11.5 * k, image=img, anchor="nw")
            tx = x0 + 58.3 * k
            small, big = -round(9.7 * k), -round(15.4 * k)  # negative = pixels
            c.create_text(tx, 18.4 * k, text=name, anchor="w", fill=hexc(dim), font=("Segoe UI", small))
            c.create_text(tx, 33.8 * k, text="--" if p is None else f"{p:.0f}%", anchor="w",
                          fill=hexc(shade(p, dark)[1]), font=("Segoe UI Semibold", big))
            c.create_text(tx, 49.2 * k, text="" if p is None or r is None else left(r, now), anchor="w",
                          fill=hexc(dim), font=("Segoe UI", small))
        win.geometry(f"{w}x{h}+{x}+{y}")
        win.update_idletasks()
        try:  # rounded corners on Windows 11
            hwnd = ctypes.windll.user32.GetParent(win.winfo_id()) or win.winfo_id()
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(ctypes.c_int(2)), 4)
        except Exception:
            pass
        win.focus_force()
        win.bind("<FocusOut>", self.close)
        win.bind("<Escape>", self.close)


def main():
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass
    box, ready = {}, threading.Event()

    def tk_thread():
        box["popup"] = Popup()
        ready.set()
        box["popup"].root.mainloop()

    threading.Thread(target=tk_thread, daemon=True).start()
    ready.wait()

    icon = pystray.Icon("claude-tray", make_icon(None), TITLE, menu=pystray.Menu(
        pystray.MenuItem("Open", lambda i, _: box["popup"].q.put(1), default=True, visible=False),
        pystray.MenuItem("Quit", lambda i, _: i.stop())))

    def loop():
        last = None
        while True:
            p5 = read()[0][0]
            if p5 != last:
                icon.icon = make_icon(p5)
                last = p5
            time.sleep(REFRESH)

    def setup(i):
        i.visible = True
        threading.Thread(target=loop, daemon=True).start()

    icon.run(setup)


if __name__ == "__main__":
    main()
