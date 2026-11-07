#!/usr/bin/env bash
# Nasazení: zvýší version.json (aplikace se podle něj sama obnoví), commitne a pushne na GitHub Pages.
# Použití: bash nasadit.sh "Popis změny"
set -e
cd "$(dirname "$0")"
msg="${1:-Úprava aplikace}"
printf '{"v":"%s"}\n' "$(date +%Y%m%d-%H%M%S)" > version.json
git add -A
git commit -q -m "$msg" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin HEAD
echo "Nasazeno: $(cat version.json)"
