#!/usr/bin/env bash
# Acko product build – setup check for the SDE role (Contract Guard and Dependency Watch)
# Run on macOS, Linux, or Windows inside WSL 2:   bash setup-check-sde.sh
# Works with Docker or Podman.
# Non-interactive (no questions asked):            bash setup-check-sde.sh --non-interactive
# It writes setup-report-sde.txt in the current folder. Send that file to your placement team.

set -u
NONINTERACTIVE=0
[ "${1:-}" = "--non-interactive" ] && NONINTERACTIVE=1

REPORT="setup-report-sde.txt"
PASS=0; WARN=0; FAIL=0
# Base images used by the build-day starter kits. Pulling them now saves time and bandwidth on the day.
IMAGES="python:3.12-slim node:20-slim postgres:16-alpine redis:7-alpine nginx:1.27-alpine"
# Ports the SDE starter kits use: 7100 vulnerability feed (Dependency Watch), 9900 webhook receiver (both kits).
PORTS="7100 9900"

: > "$REPORT"
log()  { echo "$1" | tee -a "$REPORT"; }
ok()   { PASS=$((PASS+1)); log "  [PASS] $1"; }
warn() { WARN=$((WARN+1)); log "  [WARN] $1"; }
bad()  { FAIL=$((FAIL+1)); log "  [FAIL] $1"; }
has()  { command -v "$1" >/dev/null 2>&1; }
ask()  { # ask "question" default
  if [ $NONINTERACTIVE -eq 1 ]; then echo "$2"; return; fi
  read -r -p "$1 " ans; echo "${ans:-$2}"; }

log "Acko product build – setup check (SDE role)"
log "Date: $(date)"
NAME=$(ask "Your full name:" "not given");      log "Name: $NAME"
COLLEGE=$(ask "Your college:" "not given");     log "College: $COLLEGE"
log ""

# ---------------------------------------------------------------- system
log "1. System"
OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  ok "macOS $(sw_vers -productVersion 2>/dev/null)"
  MEM_GB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 ))
elif [ "$OS" = "Linux" ]; then
  if grep -qi microsoft /proc/version 2>/dev/null; then ok "Windows with WSL 2 (Linux kernel $(uname -r))"; else ok "Linux ($(uname -r))"; fi
  MEM_GB=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1048576 ))
else
  bad "Unsupported system: $OS. On Windows, run this inside WSL 2."
  MEM_GB=0
fi
if   [ "$MEM_GB" -ge 15 ]; then ok "Memory: ${MEM_GB} GB"
elif [ "$MEM_GB" -ge 7 ];  then warn "Memory: ${MEM_GB} GB (8 GB is the minimum; 16 GB recommended). Close other apps on the day."
else bad "Memory: ${MEM_GB} GB (8 GB minimum)"; fi
DISK_GB=$(( $(df -Pk "$HOME" | awk 'NR==2 {print $4}') / 1048576 ))
if   [ "$DISK_GB" -ge 40 ]; then ok "Free disk: ${DISK_GB} GB"
elif [ "$DISK_GB" -ge 20 ]; then warn "Free disk: ${DISK_GB} GB (20 GB minimum; 40 GB recommended)"
else bad "Free disk: ${DISK_GB} GB (20 GB minimum)"; fi
log ""

# ---------------------------------------------------------------- internet
log "2. Internet"
if has curl && curl -fsS -m 10 -o /dev/null https://github.com; then ok "Internet reachable (github.com)"
else bad "Cannot reach github.com. Check your connection or proxy."; fi
log ""

# ---------------------------------------------------------------- git
log "3. Git"
if has git; then
  ok "$(git --version)"
  if [ -n "$(git config --global user.name 2>/dev/null)" ] && [ -n "$(git config --global user.email 2>/dev/null)" ]; then
    ok "Git identity set: $(git config --global user.name) <$(git config --global user.email)>"
  else
    bad "Git name or email not set. Run: git config --global user.name \"Your Name\" and git config --global user.email \"you@example.com\""
  fi
else bad "Git is not installed"; fi
log ""

# ---------------------------------------------------------------- containers
log "4. Containers (Docker or Podman)"
ENGINE=""; ENGINE_OK=0
if has docker && docker info >/dev/null 2>&1; then ENGINE=docker
elif has podman && podman info >/dev/null 2>&1; then ENGINE=podman
elif has docker; then ENGINE=docker
elif has podman; then ENGINE=podman
fi
if [ -z "$ENGINE" ]; then
  bad "Neither Docker nor Podman is installed"
else
  ok "$($ENGINE --version)"
  if $ENGINE info >/dev/null 2>&1; then ok "$ENGINE is running"; ENGINE_OK=1
  elif [ "$ENGINE" = podman ]; then bad "Podman is installed but not running. Run: podman machine init (first time only), then podman machine start"
  else bad "Docker is installed but not running (start Docker Desktop, or the docker service on Linux)"; fi
  if $ENGINE compose version >/dev/null 2>&1; then v=$($ENGINE compose version 2>/dev/null | head -1); ok "Compose: ${v:-$ENGINE compose}"
  elif [ "$ENGINE" = podman ] && has podman-compose; then v=$(podman-compose version 2>/dev/null | tail -1); ok "Compose: ${v:-podman-compose}"
  elif has docker-compose; then v=$(docker-compose version 2>/dev/null | head -1); ok "Compose: ${v:-docker-compose}"
  else bad "No compose tool found. Docker: install Docker Compose. Podman: install podman-compose"
       log "         (for example: brew install podman-compose, or pip install podman-compose)"; fi
fi
if [ $ENGINE_OK -eq 1 ]; then
  if $ENGINE run --rm docker.io/library/hello-world >/dev/null 2>&1; then ok "Test container ran successfully"
  else bad "Could not run a test container ($ENGINE run docker.io/library/hello-world)"; fi
  log "  Downloading base images for the build day (this can take a few minutes)..."
  for img in $IMAGES; do
    if $ENGINE pull -q "docker.io/library/$img" >/dev/null 2>&1; then ok "Image ready: $img"; else bad "Could not download image: $img"; fi
  done
fi
log ""

# ---------------------------------------------------------------- ports
log "5. Ports used by the starter kits"
for p in $PORTS; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    if [ "$p" = "5000" ] && [ "$OS" = "Darwin" ]; then
      warn "Port 5000 is in use. On macOS this is usually AirPlay Receiver: turn it off in System Settings > General > AirDrop & Handoff."
    else warn "Port $p is in use by another program. Stop it before the build day."; fi
  else ok "Port $p is free"; fi
done
log ""

# ---------------------------------------------------------------- languages
log "6. Programming language (at least one needed)"
LANGS=0
for c in python3 node go java; do
  if has "$c"; then
    case $c in
      python3) v=$(python3 --version 2>&1);;
      node)    v="Node.js $(node --version 2>&1)";;
      go)      v=$(go version 2>&1);;
      java)    v=$(java -version 2>&1 | head -1);;
    esac
    ok "$v"; LANGS=$((LANGS+1))
  fi
done
[ $LANGS -eq 0 ] && bad "No Python, Node.js, Go or Java found. Install the language you plan to use."
log ""

# ---------------------------------------------------------------- AI tool
log "7. AI coding tool"
FOUND=""
for c in claude codex opencode gemini aider cursor-agent; do has "$c" && FOUND="$FOUND $c"; done
if [ -n "$FOUND" ]; then ok "AI coding tool(s) found:$FOUND"
else warn "No common AI coding command found (claude, codex, opencode, ...). That's fine if you use an editor-based tool."; fi
TOOL=$(ask "Which AI coding tool will you use on the day?" "not given")
log "  Tool you will use: $TOOL"
WORKS=$(ask "Have you used it with your university AI access, and did it answer a prompt? (y/n)" "not confirmed")
case "$WORKS" in
  y|Y|yes|Yes) ok "AI tool confirmed working with university AI access";;
  *) bad "AI tool not confirmed working with your university AI access. Fix this before the build day.";;
esac
SAVE=$(ask "Do you know how to save or export your AI tool's session transcripts? (y/n)" "not confirmed")
case "$SAVE" in
  y|Y|yes|Yes) ok "Knows how to export session transcripts";;
  *) warn "Find out how your AI tool saves or exports its sessions; you must submit them.";;
esac
log ""

# ---------------------------------------------------------------- summary
log "Summary: $PASS passed, $WARN warnings, $FAIL failed"
if [ $FAIL -eq 0 ]; then log "RESULT: READY"; else log "RESULT: NOT READY – fix the [FAIL] items and run this again"; fi
echo
echo "Report saved to $REPORT. Send it to your placement team."
