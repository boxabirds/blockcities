"""
What each weather effect costs, against the 60 frames a second the game has to hold.

    uv run --with playwright scripts/weather-budget.py [url]        (npm run weather:budget)

Opens the weather designer in real Chrome with the display's frame cap lifted, so the frame rate is how fast the
graphics card can actually go, not a flat 60, and at a Retina display's pixel density. Each effect is switched on
alone and then all together, from each view, with the drops fully collected and the rain at full strength; the settings are interleaved and repeated, and the middle result kept,
so a slow moment on the machine does not land on one of them. Exits 1 if any setting falls under the budget.

The dials are left at the designer's defaults. Needs the dev server (npm run dev) to be running.
"""
import statistics
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5173/weather.html"
BUDGET_FPS = 60
VIEWPORT = {"width": 1440, "height": 900}
DEVICE_SCALE = 2
ROUNDS = 3
SETTLE_MS = 1500
MEASURE_SECONDS = 2
BOOT_TIMEOUT_MS = 90_000
CHROME_ARGS = [
    "--enable-unsafe-webgpu", "--enable-features=WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist",
    "--disable-frame-rate-limit", "--disable-gpu-vsync",
]
VIEWS = ["City", "Roofs", "Street"]
NO_DROPS = {"pools": False, "cling": False, "runs": False, "puddles": False}
ALL_DROPS = {"pools": True, "cling": True, "runs": True, "puddles": True}
# Each setting: which drops are drawn on the bricks, and whether rain is falling. Drops are measured fully collected.
SETTINGS = {
    "dry": (NO_DROPS, False),
    "falling": (NO_DROPS, True),
    "pools": ({**NO_DROPS, "pools": True}, False),
    "cling": ({**NO_DROPS, "cling": True}, False),
    "runs": ({**NO_DROPS, "runs": True}, False),
    "puddles": ({**NO_DROPS, "puddles": True}, False),
    "drops": (ALL_DROPS, False),
    "all": (ALL_DROPS, True),
}
RAIN_STRENGTH = 1


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=CHROME_ARGS)
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=DEVICE_SCALE)
        page.on("pageerror", lambda error: print("[pageerror]", str(error)[:300]))
        page.goto(URL)
        page.wait_for_function("window.__weather !== undefined", timeout=BOOT_TIMEOUT_MS)
        results: dict[tuple[str, str], list[float]] = {}
        for view in VIEWS:
            page.evaluate("view => window.__weather.look(view)", view)
            for _ in range(ROUNDS):
                for name, (features, falling) in SETTINGS.items():
                    page.evaluate("features => window.__weather.features(features)", features)
                    page.evaluate("([on, strength]) => window.__weather.rain(on, strength)", [falling, RAIN_STRENGTH])
                    page.evaluate("window.__weather.set('amount', 1)")
                    page.wait_for_timeout(SETTLE_MS)
                    measured = page.evaluate("seconds => window.__weather.measure(seconds)", MEASURE_SECONDS)
                    results.setdefault((view, name), []).append(measured["fps"])
        browser.close()

    failed = False
    print(f"Frames a second with the frame cap lifted, {VIEWPORT['width']}x{VIEWPORT['height']} at {DEVICE_SCALE}x. Budget {BUDGET_FPS}.\n")
    print(f"{'view':8}{'setting':9}{'fps':>7}{'ms':>8}{'added ms':>10}   budget")
    for view in VIEWS:
        dry = statistics.median(results[(view, "dry")])
        for name in SETTINGS:
            fps = statistics.median(results[(view, name)])
            ok = fps >= BUDGET_FPS
            failed = failed or not ok
            print(f"{view:8}{name:9}{fps:7.1f}{1000 / fps:8.2f}{1000 / fps - 1000 / dry:10.2f}   {'ok' if ok else 'MISSED'}")
        print()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
