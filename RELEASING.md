# Release policy

The public repository contains reviewed releases. Development and dogfooding happen separately; never mirror private branches or their history here.

## Version contract

`inworld/package.json` is the source of truth. All host packages share that plugin version. Use semantic versioning: patch for compatible fixes (including skill and documentation corrections), minor for compatible features, major for incompatible installation, configuration or tool changes. Review candidates use `-rc.N` and remain prereleases. Plugin identifiers stay `inworld`.

Run `npm run sync:versions` after changing the version, then `npm run check:versions`. Generators derive other harness manifests from that same version. A new public payload needs a new version; pushing changed files under an unchanged version can leave installed users on a cached copy.

The vendored CLI is independently pinned in `inworld/vendor-source.json`, including its artifact hash. Updating the plugin does not imply updating the CLI. Adopt a new CLI release deliberately, rerun compatibility checks and record the CLI change in the changelog. Do not fetch `latest` during plugin startup or edit the bundled artifact by hand.

## Release checklist

1. Review the sanitized file inventory and changelog. Exclude secrets, customer recordings, private history, internal review notes and raw benchmark traces.
2. Validate versions, all harness packages, offline regressions in development, and a representative upgrade from the prior release. Keep runtime and configuration compatibility explicit. Do not call package-only checks native host acceptance.
3. Merge the reviewed release snapshot into public `main`. Bootstrap the initial branch through the repository's authorized path; do not bypass its protections.
4. Create an immutable annotated `vX.Y.Z` tag at that exact commit and a matching GitHub Release with release notes. Installation uses the Git repository, native host flows or the skills installer. Mark release candidates as prereleases.
5. Verify install and update instructions against those published files. Marketplace submissions/syncs are separate; publishing a GitHub Release does not approve a directory listing or publish an npm package.

Never move a published tag silently. Correct a bad release with a new patch version and describe the rollback/fix. Retain older releases for reproducibility. Keep credentials and user configuration outside generated host adapters.

## Repository layout

- Root README, installation/update guides and changelog: developer-facing entry points.
- `inworld/`: the installable plugin root referenced by the host catalogs.
- `inworld/skills/<name>/`: agent workflows. Supporting `references/`, `assets/` and `scripts/` stay beside the workflow that uses them.
- `inworld/runtime/`, `inworld/voice-lab/` and `inworld/build/`: implementation files; these are one Inworld MCP connection, not separate user-installed products.
- `inworld/scripts/`: package generators, project installation/update helpers and maintenance commands.

Keep host manifests and skill paths stable. A directory rename can break catalog sources, relative imports or installed copies; simplify developer-facing navigation before reorganizing runtime files.
