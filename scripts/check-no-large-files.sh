#!/usr/bin/env bash
# Fail if any git-tracked file exceeds 1 MB. Run before pushing.
set -euo pipefail

max_bytes=$((1024 * 1024))
found=0

while IFS= read -r -d '' file; do
  size=$(stat -c%s "$file")
  if [ "$size" -gt "$max_bytes" ]; then
    echo "error: tracked file too large: $file (${size} bytes, limit ${max_bytes})" >&2
    found=1
  fi
done < <(git ls-files -z)

exit "$found"
