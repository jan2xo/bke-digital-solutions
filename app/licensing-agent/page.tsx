const platforms = [
  ["Windows", "/licensing-agent/windows/download"],
  ["macOS", "/licensing-agent/macos/download"],
  ["Linux", "/licensing-agent/linux/download"],
] as const;

export default function LicensingAgentPage() {
  return (
    <main className="shell">
      <section className="card" aria-labelledby="licensing-agent-title">
        <p className="eyebrow">BKES Digital Solutions</p>
        <h1 id="licensing-agent-title">Licensing Agent</h1>
        <p>Required by Air Stack, Render Dock, and supported BKES software.</p>
        <p>Download the installer for your operating system.</p>
        <div className="button-row" aria-label="Licensing Agent downloads">
          {platforms.map(([name, href]) => (
            <div key={name}>
              <span className="button button-secondary" aria-disabled="true">{name}: Coming soon</span>
              <a className="sr-only" href={href}>{`Download for ${name}`}</a>
            </div>
          ))}
        </div>
        <p className="muted">Installers will be published here as they become available.</p>
        <footer>© 2026 BKES Digital Solutions. All rights reserved.</footer>
      </section>
    </main>
  );
}
