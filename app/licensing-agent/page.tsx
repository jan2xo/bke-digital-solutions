const platforms = [
  ["Windows", "/licensing-agent/windows/download"],
  ["macOS", "/licensing-agent/macos/download"],
  ["Linux", "/licensing-agent/linux/download"],
] as const;

export default function LicensingAgentPage() {
  return (
    <main className="shell">
      <section className="card" aria-labelledby="licensing-agent-title">
        <h1 id="licensing-agent-title">Licensing Agent</h1>
        <div className="button-row" aria-label="Licensing Agent downloads">
          {platforms.map(([name, href]) => (
            <a className="button button-secondary" href={href} key={name}>{name}</a>
          ))}
        </div>
        <p className="muted">Note: Licensing Agent installers will be published here as they become available.</p>
      </section>
    </main>
  );
}
