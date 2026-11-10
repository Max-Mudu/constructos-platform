"""Reads `xcrun simctl list devices available -j` on stdin and prints
"<udid>\t<ios version>\t<device name>" for an iPhone on the newest iOS runtime."""
import json
import re
import sys

devices = json.load(sys.stdin)["devices"]
best = None
for runtime, items in devices.items():
    m = re.search(r"SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?$", runtime)
    if not m:
        continue
    version = tuple(int(part or 0) for part in m.groups())
    for device in items:
        name = device.get("name", "")
        if not name.startswith("iPhone") or not device.get("isAvailable", True):
            continue
        # Prefer the plain model ("iPhone 17") over Pro / Max / e variants.
        plain = 1 if re.fullmatch(r"iPhone \d+", name) else 0
        key = (version, plain, name)
        if best is None or key > best[0]:
            best = (key, device["udid"], "%d.%d" % version[:2], name)

if best is None:
    sys.exit("No available iPhone simulator on this runner")
print("\t".join(best[1:]))
