#!/bin/bash
# =============================================================================
# clean-orphans.sh — Smart cleanup of dangling Chrome & WebDrivers
# Only kills Chrome/chromedriver processes if:
#   1. PPID (Parent PID) is 1 (orphaned child whose parent crashed)
#   2. OR they have been running for more than 60 minutes (stuck session)
# =============================================================================

echo "=== Running Orphan Cleanup: $(date) ==="

# 1. Clean Chrome/chromedriver processes with PPID = 1
orphans=$(ps -ef | grep -E 'chrome|chromium|chromedriver' | grep -v grep | awk '$3 == 1 {print $2}')

if [ -n "$orphans" ]; then
    echo "🔍 Found orphaned processes (PPID=1):"
    ps -p $orphans -o pid,ppid,cmd,etime
    echo "⚠️ Killing orphaned processes..."
    echo $orphans | xargs kill -9
else
    echo "✅ No PPID=1 orphaned Chrome processes found."
fi

# 2. Clean Chrome/chromedriver processes running for more than 60 minutes
# This catches processes that didn't get orphaned (parent still alive but stuck) but are frozen
long_running=$(ps -eo pid,etime,cmd | grep -E 'chrome|chromium|chromedriver' | grep -v grep | while read -r pid etime cmd; do
    # etime format can be: dd-hh:mm:ss, hh:mm:ss, or mm:ss
    # If it contains '-' (days) or has hours (e.g. 01:23:45 or 12:34:56), it has been running for > 1 hour.
    if [[ "$etime" == *"-"* ]] || [[ $(echo "$etime" | tr -cd ':' | wc -c) -eq 2 ]]; then
        echo "$pid"
    fi
done)

if [ -n "$long_running" ]; then
    echo "🔍 Found stuck processes running for > 60 mins:"
    ps -p $long_running -o pid,etime,cmd
    echo "⚠️ Killing stuck processes..."
    echo $long_running | xargs kill -9
else
    echo "✅ No long-running (> 60m) Chrome processes found."
fi

echo "=== Cleanup Finished ==="
