# Releasing Mack

Installed copies of Mack update themselves from GitHub Releases
(`electron-updater`): they check on launch and every 6 hours, download a new
version in the background, and install it when Mack quits or when the person
clicks **Restart and update**. Settings → Updates turns this off.

## Cutting a release

1. Bump `version` in `package.json` (for example `0.2.0`) on a branch, open
   a PR and merge it.
2. Tag the merge commit and push the tag:

   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. `.github/workflows/release.yml` checks that the tag matches
   `package.json`, runs the type check and tests, builds the installer, and
   publishes `Mack-Setup-<version>.exe` with `latest.yml` (what the updater
   reads) as a GitHub Release.

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
