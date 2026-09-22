export const metadata = {
  title: "Download BKE",
  description: "BKE is the desktop home for installing and managing BKE software.",
};

function configuredDownloadUrl() {
  const value = process.env.BKE_PUBLIC_DOWNLOAD_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function BkeDownloadPage() {
  const downloadUrl = configuredDownloadUrl();

  return <section className="shell py-16 motion-fade-up">
    <p className="font-bold text-[#ffe08a]">BKE DESKTOP</p>
    <h1 className="mt-2 max-w-4xl text-5xl font-black">One app for your BKE software.</h1>
    <p className="mt-6 max-w-3xl text-lg leading-8 text-[#a8b5c4]">BKE is the customer desktop for My Software, installation, updates, repair, launch, removal, account state, and notifications. Managed BKE products are delivered through BKE instead of separate customer-facing installers.</p>
    <div className="mt-10 card max-w-3xl p-8">
      {downloadUrl
        ? <><h2 className="text-2xl font-black">Download BKE</h2><p className="mt-3 text-[#a8b5c4]">Install BKE once. The compatible Licensing Agent is provisioned underneath it, and your entitled software appears in My Software.</p><a className="button button-yellow mt-6" href={downloadUrl}>Download BKE</a></>
        : <><h2 className="text-2xl font-black">BKE installer publishing is being prepared.</h2><p className="mt-3 text-[#a8b5c4]">This is the canonical customer download surface. A public installer will appear here after BKE packaging is certified; individual managed-product installers are no longer the intended customer path.</p></>}
    </div>
  </section>;
}
