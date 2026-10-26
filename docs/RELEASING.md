# Releasing Mack

Installed copies of Mack update themselves from GitHub Releases
(`electron-updater`): they check on launch and every 6 hours, download a new
version in the background, and install it when Mack quits or when the person
clicks **Restart and update**. Settings → Updates turns this off.

## Releases

Every merge to `main` is a release: `.github/workflows/release.yml` sets the
version to `<major>.<minor>.<run number>` (major and minor from
`package.json`, so each release is newer than the last with no bump commit),
runs the type check and tests, builds the installer, and publishes
`Mack-Setup-<version>.exe` with `latest.yml` (what the updater reads) as the
GitHub Release `v<version>`. It can also be run by hand from the Actions tab.

To start a new minor or major series, change `version` in `package.json`
(for example to `0.3.0`) in a PR; the patch number keeps counting runs.

## Installing on another computer

Download `Mack-Setup-<version>.exe` from the latest release
(https://github.com/JorgeOchoaReyes/Mack/releases/latest), run it, and add a
model key in Setup. From then on the copy updates itself after each merge.

Mack's upstream check also reads the latest release's `upstream.json`: when a
newer release is aligned with a later Open Math Harness commit than the
installed copy, the banner says that updating Mack brings what it ports.

## Code signing

Without a signature Windows SmartScreen warns on first run ("Windows
protected your PC" → More info → Run anyway). Signing needs a certificate
that only the maintainer can obtain; nothing in this repo can provide one.
Options:

- **Azure Trusted Signing** (cheapest; reputation is established quickly).
  electron-builder supports it through `win.azureSignOptions` in
  `package.json` and the `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and
  `AZURE_CLIENT_SECRET` environment variables in the release workflow.
- **An OV or EV code-signing certificate** as a `.pfx`. Store it base64-encoded
  in the repository secret `WIN_CSC_LINK` and its password in
  `WIN_CSC_KEY_PASSWORD`; the release workflow passes them to
  electron-builder, which signs the installer and the app. An OV certificate
  still shows SmartScreen warnings until downloads build reputation; EV
  certificates start trusted.

Once releases are signed, add the certificate's subject name to
`build.win.signtoolOptions.publisherName` in `package.json`, so the updater
also refuses an update signed by anyone else. Do not add it before releases
are signed: the updater would then refuse every unsigned update.
