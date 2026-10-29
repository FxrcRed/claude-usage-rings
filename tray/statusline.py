"""Claude Code statusLine script: writes usage/model/session from the stdin JSON to ~/.claude/tray-state.json and prints one status line."""
import json, os, sys, time

STATE = os.path.join(os.path.expanduser("~"), ".claude", "tray-state.json")
KEEP_SECONDS = 3600  # sessions not updated for over an hour are dropped from the file


def main():
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except Exception:
        data = {}
    now = time.time()
    model = (data.get("model") or {}).get("display_name") or ""
    rl = data.get("rate_limits") or {}
    five = rl.get("five_hour") or {}
    week = rl.get("seven_day") or {}

    try:
        with open(STATE, encoding="utf-8") as f:
            state = json.load(f)
        if not isinstance(state, dict):
            state = {}
    except Exception:
        state = {}

    sessions = state.get("sessions") if isinstance(state.get("sessions"), dict) else {}
    sid = data.get("session_id")
    if sid:
        sessions[sid] = {"updated": now, "model": model}
    state["sessions"] = {k: v for k, v in sessions.items()
                         if isinstance(v, dict) and now - v.get("updated", 0) < KEEP_SECONDS}
    state["model"] = model or state.get("model", "")
    state["updated"] = now
    # if a usage window is missing, keep the old value instead of overwriting with empty
    if five.get("used_percentage") is not None:
        state["five_hour"] = {"pct": five["used_percentage"], "resets_at": five.get("resets_at")}
    if week.get("used_percentage") is not None:
        state["seven_day"] = {"pct": week["used_percentage"], "resets_at": week.get("resets_at")}
    if sid or five or week:
        try:
            tmp = STATE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(state, f)
            os.replace(tmp, STATE)
        except Exception:
            pass

    p = five.get("used_percentage")
    print(f"[{model or '?'}]" + (f" 5h {p:.0f}%" if p is not None else ""))


if __name__ == "__main__":
    main()
