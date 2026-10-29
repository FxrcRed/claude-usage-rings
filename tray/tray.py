"""Claude usage tray icon: reads ~/.claude/tray-state.json and draws the 5-hour usage percentage."""
import json, os, sys, threading, time
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
import pystray

STATE = sys.argv[sys.argv.index("--state") + 1] if "--state" in sys.argv else \
    os.path.join(os.path.expanduser("~"), ".claude", "tray-state.json")
REFRESH = 30          # seconds
STALE = 30 * 60       # file not updated for 30 min -> grey "--"
ACTIVE = 120          # sessions updated within 2 min count as "running"
SIZE = 64


def load():
    try:
        with open(STATE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def num(v):
    return v if isinstance(v, (int, float)) else None


def fmt_reset(ts):
    ts = num(ts)
    if ts is None:
        return "?"
    return datetime.fromtimestamp(ts).strftime("%m-%d %H:%M")


def left(ts, now):
    ts = num(ts)
    if ts is None:
        return ""
    m = max(0, int((ts - now) // 60))
    d, h = m // 1440, m % 1440 // 60
    return f"{d}d {h}h" if d else (f"{h}h {m % 60}m" if h else f"{m}m")


def bar(name, pct, resets_at, now, n=10):
    if pct is None:
        return f"{name}  " + "▱" * n + "  " + "--".rjust(4, " ")
    k = max(0, min(n, round(pct / 100 * n)))
    return (f"{name}  " + "▰" * k + "▱" * (n - k)
            + "  " + f"{pct:.0f}%".rjust(4, " ") + "  " + left(resets_at, now).rjust(6, " "))


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


def snapshot():
    s = load()
    now = time.time()
    fresh = num(s.get("updated")) is not None and now - s["updated"] < STALE
    five = s.get("five_hour") if isinstance(s.get("five_hour"), dict) else {}
    week = s.get("seven_day") if isinstance(s.get("seven_day"), dict) else {}
    # window reset time has passed -> data is void
    def valid(w):
        r = num(w.get("resets_at"))
        return num(w.get("pct")) is not None and (r is None or r > now)
    p5 = five["pct"] if fresh and valid(five) else None
    p7 = week["pct"] if fresh and valid(week) else None
    sessions = s.get("sessions") if isinstance(s.get("sessions"), dict) else {}
    running = sum(1 for v in sessions.values()
                  if isinstance(v, dict) and now - (num(v.get("updated")) or 0) < ACTIVE)
    lines = [
        bar("5H", p5, five.get("resets_at"), now),
        bar("WK", p7, week.get("resets_at"), now),
        f"Running: {running}" + ("" if fresh else "  (stale)"),
    ]
    return p5, "\n".join(lines)


def main():
    icon = pystray.Icon("claude-tray", make_icon(None), "Claude usage",
                        menu=pystray.Menu(pystray.MenuItem("Quit", lambda i, _: i.stop())))

    def loop():
        last = None
        while True:
            p5, tip = snapshot()
            if (p5, tip) != last:
                icon.icon = make_icon(p5)
                icon.title = tip[:127]  # Windows tooltip limit: 127 characters
                last = (p5, tip)
            time.sleep(REFRESH)

    def setup(i):
        i.visible = True
        threading.Thread(target=loop, daemon=True).start()

    icon.run(setup)


if __name__ == "__main__":
    main()
