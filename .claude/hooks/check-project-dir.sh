#!/bin/bash
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd')
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

if [[ "$CWD" == "$PROJECT_ROOT"* ]]; then
  exit 0  # allow
else
  echo "Bash commands only allowed within project root: $PROJECT_ROOT" >&2
  exit 2  # block
fi
