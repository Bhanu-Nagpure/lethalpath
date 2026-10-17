# Live evidence

Uncut run logs produced by [`scripts/evidence.sh`](../../scripts/evidence.sh):
the engine image, corpus hashes, the whole test output, one real `scan`, one
real `fix`, the abstention, and (once the guard ships) its demo — in a single
tee'd log with nothing trimmed between sections.

Re-run it any time; each run is a new timestamped file. The logs are committed
unmodified, including failures if there are any.
