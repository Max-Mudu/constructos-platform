#!/usr/bin/env bash
# Picks an iPhone simulator on the newest installed iOS runtime, records which
# one in the job log and starts booting it (launch.sh waits for the boot).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

PICK="$(xcrun simctl list devices available -j | python3 "$HERE/pick-simulator.py")"
SIM_UDID="$(echo "$PICK" | cut -f1)"
SIM_RUNTIME="$(echo "$PICK" | cut -f2)"
SIM_NAME="$(echo "$PICK" | cut -f3)"

echo "Simulator device: $SIM_NAME"
echo "Simulator iOS runtime: $SIM_RUNTIME"
echo "Simulator UDID: $SIM_UDID"
{
  echo "SIM_UDID=$SIM_UDID"
  echo "SIM_NAME=$SIM_NAME"
  echo "SIM_RUNTIME=$SIM_RUNTIME"
} >> "$GITHUB_ENV"

xcrun simctl boot "$SIM_UDID"
echo "Boot requested"
