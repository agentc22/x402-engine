#!/bin/bash
# Full x402 sweep — runs 4x/day (every 6 hours) via crontab
# Exercises all payment rails end-to-end: Base, MegaETH, Solana

set -euo pipefail

LOG_DIR="$HOME/x402-gateway/logs"
ALERT_LOG="$LOG_DIR/healthcheck-alerts.log"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SWEEP_SCRIPT="$HOME/.openclaw/workspace/scripts/x402_newbie_sweep_all_rails.mjs"

mkdir -p "$LOG_DIR"

echo "[$TS] Starting scheduled sweep" >> "$LOG_DIR/sweep.log"

# Source nvm/fnm/node if needed (cron has minimal PATH)
export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$HOME/.openclaw/workspace/scripts"

if node "$SWEEP_SCRIPT" >> "$LOG_DIR/sweep.log" 2>&1; then
  echo "[$TS] Sweep completed successfully" >> "$LOG_DIR/sweep.log"
else
  EXIT_CODE=$?
  echo "[$TS] ALERT: Sweep failed with exit code $EXIT_CODE" | tee -a "$ALERT_LOG" >> "$LOG_DIR/sweep.log"
fi
