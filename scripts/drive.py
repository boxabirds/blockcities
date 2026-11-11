"""Drive Block Cities in real Chrome (WebGPU) and capture evidence.

Usage: uv run --with playwright scripts/drive.py <url> <out-dir> [script]
The script is a semicolon-separated list of steps:
  shot:name            screenshot
  wait:seconds
  snap                 print the debug snapshot
  js:expression        evaluate in the page and print the result (the automation hook is window.__blockcities)
  run:file.js          evaluate a file in the page and print the result
  api:tool/x0/z0/x1/z1 one drag through the automation hook
  click:selector       real mouse click on an interface element
  drag:x0/z0/x1/z1     real mouse drag between two tiles with the tool in hand
  hover:x/z            move the real mouse over a tile
  down:x/z, up         press and release the real mouse button, to look at a drag half way
  fill:selector=value  set a form control (the tax slider) the way a user would
  key:Key              press a key
  advance:days         simulate days at once
  look:x/z/distance/yaw/pitch   place the camera (tiles, studs, radians)
  new:seed             start a new city with this seed
  reload               save, reload the page and wait for the game to start again
  frames:seconds       frame-time statistics
Env VIEW_W, VIEW_H and DSF set the window.
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

VIEWPORT = {"width": int(os.environ.get("VIEW_W", 1440)), "height": int(os.environ.get("VIEW_H", 900))}
DEVICE_SCALE = float(os.environ.get("DSF", 1))
BOOT_TIMEOUT_MS = 60_000
DRAG_STEPS = 12
DEFAULT_SCRIPT = "wait:1;shot:start;snap"
CHROME_ARGS = ["--enable-unsafe-webgpu", "--enable-features=WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"]
HOOK = "window.__blockcities"


def screen_of(page, x, z):
    point = page.evaluate(f"{HOOK}.screenOf({x}, {z})")
    return point["x"], point["y"]


def main() -> int:
    url, out = sys.argv[1], sys.argv[2]
    steps = (sys.argv[3] if len(sys.argv) > 3 else DEFAULT_SCRIPT).split(";")
    os.makedirs(out, exist_ok=True)
    status = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=CHROME_ARGS)
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=DEVICE_SCALE)

        def on_console(message):
            if message.type in ("error", "warning"):
                print(f"[console.{message.type}] {message.text}")

        page.on("console", on_console)
        page.on("pageerror", lambda e: print(f"[pageerror] {e}"))
        page.goto(url)
        try:
            page.wait_for_function(
                "document.querySelector('#loading').classList.contains('hidden') || document.querySelector('#loading').classList.contains('failed')",
                timeout=BOOT_TIMEOUT_MS,
            )
        except Exception as error:  # still capture what is on screen
            print(f"[boot] {error}")
        if page.evaluate("document.querySelector('#loading').classList.contains('failed')"):
            print("[fatal]", page.evaluate("document.querySelector('#fatal').textContent"))
            page.screenshot(path=f"{out}/fatal.png")
            browser.close()
            return 1
        for step in steps:
            kind, _, arg = step.strip().partition(":")
            parts = arg.split("/")
            if kind == "wait":
                time.sleep(float(arg))
            elif kind == "shot":
                page.screenshot(path=f"{out}/{arg}.png")
            elif kind == "snap":
                print("[snap]", json.dumps(page.evaluate(f"{HOOK}.snapshot()")))
            elif kind == "js":
                print("[js]", json.dumps(page.evaluate(arg)))
            elif kind == "run":
                with open(arg, encoding="utf-8") as source:
                    print("[run]", json.dumps(page.evaluate(source.read())))
            elif kind == "api":
                plan = page.evaluate(f"{HOOK}.apply('{parts[0]}', {', '.join(parts[1:])})")
                print(f"[api] {arg}: ok={plan['ok']} cost={plan['cost']} reason={plan['reason']!r}")
            elif kind == "click":
                page.click(arg)
            elif kind == "drag":
                x0, y0 = screen_of(page, parts[0], parts[1])
                x1, y1 = screen_of(page, parts[2], parts[3])
                page.mouse.move(x0, y0)
                page.mouse.down()
                page.mouse.move(x1, y1, steps=DRAG_STEPS)
                page.mouse.up()
            elif kind == "hover":
                x, y = screen_of(page, parts[0], parts[1])
                page.mouse.move(x, y, steps=DRAG_STEPS)
            elif kind == "down":
                x, y = screen_of(page, parts[0], parts[1])
                page.mouse.move(x, y)
                page.mouse.down()
            elif kind == "up":
                page.mouse.up()
            elif kind == "fill":
                selector, _, value = arg.partition("=")
                page.fill(selector, value)
            elif kind == "key":
                page.keyboard.press(arg)
            elif kind == "advance":
                page.evaluate(f"{HOOK}.advance({arg})")
            elif kind == "look":
                names = ["x", "z", "distance", "yaw", "pitch"]
                view = ", ".join(f"{name}: {value}" for name, value in zip(names, parts) if value != "")
                page.evaluate(f"{HOOK}.look({{{view}}})")
            elif kind == "new":
                page.evaluate(f"{HOOK}.newCity({arg})")
            elif kind == "reload":
                page.evaluate(f"{HOOK}.save()")
                page.reload()
                page.wait_for_function("document.querySelector('#loading').classList.contains('hidden')", timeout=BOOT_TIMEOUT_MS)
            elif kind == "frames":
                stats = page.evaluate("""async (seconds) => {
                    const deltas = [];
                    let last = performance.now();
                    const end = last + seconds * 1000;
                    await new Promise(resolve => {
                        const tick = now => { deltas.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(); };
                        requestAnimationFrame(tick);
                    });
                    deltas.shift();
                    const sorted = [...deltas].sort((a, b) => a - b);
                    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
                    return { fps: 1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length), p50: at(0.5), p95: at(0.95), worst: sorted[sorted.length - 1], over33: deltas.filter(d => d > 33).length, n: deltas.length };
                }""", float(arg))
                print(f"[frames] fps {stats['fps']:.1f}  median {stats['p50']:.1f} ms  p95 {stats['p95']:.1f} ms  worst {stats['worst']:.1f} ms  frames>33ms {stats['over33']}/{stats['n']}")
            elif kind:
                print(f"[unknown step] {step}")
                status = 2
        browser.close()
    return status


if __name__ == "__main__":
    sys.exit(main())
