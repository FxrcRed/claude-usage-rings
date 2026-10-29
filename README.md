# usage-band

A small band above the prompt box in the Claude desktop app that shows your plan usage at a glance.

<!-- TODO: add screenshot(s) here -->

## What it shows

- **Activity rings** (right side): outer ring = 5-hour usage, inner ring = weekly usage.
- **Percent + time left** until each window resets. The weekly figure appears once it reaches 80%.
- **Context length hint** (left side): current context size in `k` tokens, with a nudge when it is time to start a new chat.

### Thresholds

| What | Green | Orange | Red |
| --- | --- | --- | --- |
| 5-hour / weekly usage | < 60% | 60–85% | ≥ 85% |
| Context length | < 180k | ≥ 180k ("Time to start a new chat") | ≥ 230k |

The context figures include roughly 80k tokens of fixed overhead (system prompt, tools, skills). A "5-hour limit almost used" note appears at ≥ 90%.

## Install

At the prompt of a terminal session:

```
/plugin install usage-band --marketplace FxrcRed/claude-usage-rings
```

From a shell:

```
claude plugin install usage-band --marketplace FxrcRed/claude-usage-rings
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `FxrcRed/claude-usage-rings`, then **Add plugin**.

Answer `y` to add the marketplace, then pick a scope. The band is active right away.

## Limitations

- Needs a plan that reports rate-limit data (Pro / Max). On API-key setups there is nothing to show.
- Built for the Claude desktop app. Other surfaces may draw it differently or not at all.
- I could not verify the rendering on every surface; please open an issue if it looks off.

## Optional: Windows tray icon

`tray/` contains a separate, optional tray icon that shows the 5-hour percentage (green / orange / red) with a tooltip of progress bars. Windows only.

```
pip install -r tray/requirements.txt
pythonw tray/tray.py
```

The tray reads `~/.claude/tray-state.json`, which the usage-band mod keeps up to date automatically in the desktop app and the CLI: install the mod, start the tray, done. The tooltip's "Running" count only works if you also use `tray/statusline.py` as the `statusLine` command in `~/.claude/settings.json` (terminal CLI only, optional):

```json
{ "statusLine": { "type": "command", "command": "python /path/to/tray/statusline.py" } }
```

Right-click the icon and choose **Quit** to exit. On Windows 11, drag the icon out of the "^" overflow area to keep it always visible.

## License

MIT, see [LICENSE](LICENSE).
