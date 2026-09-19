#!/bin/bash
SRC="$HOME/ProcureNepal"
GDRIVE="$HOME/Library/CloudStorage/GoogleDrive-shishir1213@apollointcollege.edu.np/My Drive/ProcureNepal-Backups"
DATE=$(date +%Y%m%d-%H%M%S)
TARGET="$GDRIVE/backup-$DATE"

echo "📦 Backing up → $TARGET"
mkdir -p "$TARGET"

rsync -a \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.angular' \
  --exclude='.next' \
  --exclude='.venv' \
  --exclude='venv' \
  --exclude='.git' \
  "$SRC/" "$TARGET/"

echo "✅ Backup complete: $TARGET"
