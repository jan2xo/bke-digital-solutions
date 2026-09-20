# Licensing Agent distribution

The shared customer-facing component is **Licensing Agent**. Air Stack, Render Dock, and future protected BKES desktop products use the fixed recovery page `https://jl-bke.com/licensing-agent`; the Agent is not a commercial Product and has no Product ID, entitlement, purchase, or release catalog.

## Stable delivery

The current installer for each platform is served from a fixed URL:

| Platform | URL | File |
| --- | --- | --- |
| Windows | `/licensing-agent/windows/download` | `BKELicensingAgentSetup.exe` |
| macOS | `/licensing-agent/macos/download` | `BKELicensingAgentSetup.pkg` |
| Linux | `/licensing-agent/linux/download` | `BKELicensingAgentSetup.deb` |

The landing page always presents the three fixed platform links. It has no installer-availability state and does not inspect the filesystem. Caddy maps only these three paths to the read-only host directory `/opt/bkes/licensing-agent`. There is no directory listing or arbitrary filesystem route. If a platform file is absent, its stable URL returns the existing controlled unavailable response. Installer binaries are never committed to Git.

## One-time deployment

Run these later, from the deployed repository directory. Do not run them during development. First inspect the Caddy container identity with `docker compose ... run --rm caddy id`, then grant that identity read/traverse access without granting write access. Do not guess a host owner or group.

```bash
sudo install -d -m 0755 /opt/bkes/licensing-agent/windows /opt/bkes/licensing-agent/macos /opt/bkes/licensing-agent/linux
sudo install -m 0644 BKELicensingAgentSetup.exe /opt/bkes/licensing-agent/windows/BKELicensingAgentSetup.exe
sudo install -m 0644 BKELicensingAgentSetup.pkg /opt/bkes/licensing-agent/macos/BKELicensingAgentSetup.pkg
sudo install -m 0644 BKELicensingAgentSetup.deb /opt/bkes/licensing-agent/linux/BKELicensingAgentSetup.deb
docker compose --env-file .env.production -f docker-compose.production.yml config
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build migrate app caddy
```

The first deployment creates the static mount and Caddy routes. It is the only application deployment required to introduce this capability.

## Routine replacement and rollback

Keep the immediately previous known-good file privately, outside the public directories. Verify the new artifact before the atomic rename:

```bash
sha256sum /tmp/BKELicensingAgentSetup.exe
sudo install -m 0644 /tmp/BKELicensingAgentSetup.exe /opt/bkes/licensing-agent/windows/BKELicensingAgentSetup.exe.new
sudo mv /opt/bkes/licensing-agent/windows/BKELicensingAgentSetup.exe.new /opt/bkes/licensing-agent/windows/BKELicensingAgentSetup.exe
curl -fsSI https://jl-bke.com/licensing-agent/windows/download
```

Use the same pattern with `BKELicensingAgentSetup.pkg` and `.deb` in their platform directories. To roll back, atomically move the privately retained known-good file into the same `.new` path and then `mv` it into place. Do not overwrite an active file in place. Replacing a file after the one-time deployment requires no Git commit, website rebuild, application/Docker rebuild, database migration, application restart, or Caddy restart.

## Verification and security

```bash
curl -fsS https://jl-bke.com/licensing-agent
curl -I https://jl-bke.com/licensing-agent/windows/download
curl -I https://jl-bke.com/licensing-agent/macos/download
curl -I https://jl-bke.com/licensing-agent/linux/download
```

Only trusted VPS operators may place or replace installers. HTTPS, fixed mappings, read-only Caddy storage, no upload endpoint, no Admin UI, no public write API, and no remote installer execution are intentional boundaries. Desktop products open only the fixed recovery page in the default browser; they never download or execute an installer directly.

Future protected products should imitate Air Stack and Render Dock: use the localhost Licensing Agent contract, use `https://jl-bke.com/licensing-agent` for AgentUnavailable recovery, keep product-specific `displayName` and immutable `bke-<normalized-name>` identity, and do not implement licensing, lease, signature, installer, updater, or commercial entitlement logic themselves.
