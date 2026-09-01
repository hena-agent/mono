#!/usr/bin/env bash
set -euo pipefail

REVIEW_DIRECTORY=${1:?review directory is required}

git -C "$REVIEW_DIRECTORY" ls-files -s -z | while IFS= read -r -d '' ENTRY; do
  MODE=${ENTRY%% *}
  REST=${ENTRY#* }
  OBJECT=${REST%% *}
  FILE=${ENTRY#*$'\t'}

  case "$FILE" in
    AGENTS.md | */AGENTS.md | CLAUDE.md | */CLAUDE.md | CONTEXT.md | */CONTEXT.md)
      if [ "$MODE" = "160000" ]; then
        rmdir -- "$REVIEW_DIRECTORY/$FILE"
        continue
      fi
      rm -- "$REVIEW_DIRECTORY/$FILE"
      continue
      ;;
  esac

  if [ "$MODE" = "120000" ]; then
    rm -- "$REVIEW_DIRECTORY/$FILE"
    git -C "$REVIEW_DIRECTORY" cat-file blob "$OBJECT" > "$REVIEW_DIRECTORY/$FILE"
  fi
done
