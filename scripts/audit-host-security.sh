#!/usr/bin/env bash
set -u

# Read-only host evidence collector. It never changes SSH, firewall, Docker, or network state.
failures=0
warn() { printf 'WARN %s\n' "$1"; }
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }

printf '# host-security-audit UTC=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if command -v sshd >/dev/null 2>&1; then
  permit_root=$(sshd -T 2>/dev/null | awk '$1=="permitrootlogin" {print $2; exit}')
  password_auth=$(sshd -T 2>/dev/null | awk '$1=="passwordauthentication" {print $2; exit}')
  [[ "$permit_root" == "no" ]] && pass 'sshd PermitRootLogin=no' || fail "sshd PermitRootLogin=${permit_root:-unknown}"
  [[ "$password_auth" == "no" ]] && pass 'sshd PasswordAuthentication=no' || fail "sshd PasswordAuthentication=${password_auth:-unknown}"
else
  warn 'sshd -T unavailable; verify effective SSH configuration manually'
fi

if command -v ufw >/dev/null 2>&1; then
  ufw_status=$(ufw status 2>/dev/null | head -n 1)
  printf 'INFO firewall=%s\n' "$ufw_status"
  grep -qi 'Status: active' <<<"$ufw_status" && pass 'UFW active' || fail 'UFW is not active'
  ufw status verbose 2>/dev/null | sed -n '1,24p' | sed 's/[[:space:]]\+$//' || true
else
  warn 'ufw unavailable; verify the approved host firewall manually'
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl is-enabled docker >/dev/null 2>&1 && pass 'Docker enabled at boot' || fail 'Docker is not enabled at boot'
  systemctl is-active docker >/dev/null 2>&1 && pass 'Docker active' || fail 'Docker is not active'
else
  warn 'systemctl unavailable; verify Docker boot and active state manually'
fi

if command -v ss >/dev/null 2>&1; then
  printf 'INFO listening TCP sockets (review against approved exposure):\n'
  ss -ltnH 2>/dev/null | awk '{print $1, $4}' | sed -n '1,80p'
else
  warn 'ss unavailable; verify listening ports manually'
fi

if (( failures > 0 )); then
  printf 'RESULT FAIL checks=%d\n' "$failures"
  exit 1
fi
printf 'RESULT PASS no automated failures; owner review of listeners and firewall sources is required\n'
