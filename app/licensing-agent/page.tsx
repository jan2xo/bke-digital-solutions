import { access } from "node:fs/promises";

export const dynamic = "force-dynamic";

const platforms = [
  ["Windows", "/licensing-agent/windows/download", "/opt/bkes/licensing-agent/windows/BKELicensingAgentSetup.exe"],
  ["macOS", "/licensing-agent/macos/download", "/opt/bkes/licensing-agent/macos/BKELicensingAgentSetup.pkg"],
  ["Linux", "/licensing-agent/linux/download", "/opt/bkes/licensing-agent/linux/BKELicensingAgentSetup.deb"],
] as const;

async function installerAvailable(path: string) {
  try { await access(path); return true; } catch { return false; }
}

export default async function LicensingAgentPage() {
  const availability = await Promise.all(platforms.map(([, , path]) => installerAvailable(path)));
  return (
    <main className="shell">
      <section className="card" aria-labelledby="licensing-agent-title">
        <p className="eyebrow">BKES Digital Solutions</p>
        <h1 id="licensing-agent-title">Licensing Agent</h1>
        <p>Required by Air Stack, Render Dock, and supported BKES software.</p>
        <p>Download the installer for your operating system.</p>
        <div className="button-row" aria-label="Licensing Agent downloads">
          {platforms.map(([name, href], index) => (
            <div key={name}>
              {availability[index] ? (
                <a className="button button-secondary" href={href}>{`Download for ${name}`}</a>
              ) : (
                <span className="button button-secondary" aria-disabled="true">{name}: Coming soon</span>
              )}
            </div>
          ))}
        </div>
        <p className="muted">Installers will be published here as they become available.</p>
        <footer>© 2026 BKES Digital Solutions. All rights reserved.</footer>
      </section>
    </main>
  );
}
