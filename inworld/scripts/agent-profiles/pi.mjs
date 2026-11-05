// Host-specific contract; adding this file opts this host into packaging.
export default {
  id: "pi",
  label: "Pi",
  format: "pi-package",
  skillsPath: ".pi/skills",
  source: "pi-plugin",
  docs: "https://pi.dev/docs/latest/packages",
  installNotes: "Native route: pi install --local /absolute/path/to/package. The Pi package contains integration skills. Its terminal adapter can discover tools and run local speech-text checks; it cannot make authenticated API calls. Configure credentials in your app when implementing an Inworld integration.",
  async emit({ out, manifest, bundlePackage, json, mkdir, join, servers }) {
    bundlePackage.keywords = ['pi-package'];
    bundlePackage.pi = { skills: ['./skills'] };
  },
};
