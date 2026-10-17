# Live evidence

Uncut run logs produced by [`scripts/evidence.sh`](../../scripts/evidence.sh):
the engine image, corpus hashes, the whole test output, one real `scan`, one
real `fix`, the abstention, the 40-tool fallback config, the mcp config
through the labeler, and the guard demo — in a single tee'd log with nothing
trimmed between sections.

Re-run it any time; each run is a new timestamped file. The logs are committed
unmodified, including failures if there are any.
