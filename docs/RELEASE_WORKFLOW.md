# STUXS Music — Official Release & In-App Update Workflow

This document describes the step-by-step procedure for publishing a new STUXS Music release and distributing it via **GitHub Pages** and **GitHub Releases**.

## Architecture Overview
```
STUXS Android app
       ↓
GitHub Pages HTTPS (update.json)
https://aayushpatil826-creator.github.io/STUXS-Music/update.json
       ↓
APK Asset from update.json
https://github.com/aayushpatil826-creator/STUXS-Music/releases/download/<RELEASE_TAG>/<APK_FILENAME>
       ↓
Android PackageInstaller
```

---

---

## Production Release Signing & Security Architecture

> [!CAUTION]
> **CRITICAL SECURITY RULES**:
> 1. **NEVER** commit keystores (`.jks`, `.keystore`), passwords, or secrets to Git.
> 2. **NEVER** place signing credentials in repository files, source code, or `update.json`.
> 3. Store the production keystore **outside** the Git repository (e.g. in `~/.keystores/` or a dedicated secure vault).
> 4. Release builds will **fail immediately** if external credentials are not configured. Gradle will never silently fall back to debug signing or produce unsigned release builds.

### Keystore Location
Store the production release keystore outside the project directory:
- **Windows**: `C:\Users\<USER>\.keystores\STUXS-Music-release.jks`
- **Linux/macOS**: `~/.keystores/STUXS-Music-release.jks`

### Generating a Production Keystore (Run Manually If Needed)
If you do not yet have a production keystore, generate one manually using `keytool` (do not run this inside the repository):

```bash
keytool -genkeypair \
  -v \
  -keystore "<PATH_TO_STUXS_RELEASE_KEYSTORE>" \
  -alias "<KEY_ALIAS>" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```
*(Replace `<PATH_TO_STUXS_RELEASE_KEYSTORE>` and `<KEY_ALIAS>` with your desired location and alias).*

### Supplying Credentials Locally to Gradle

Credentials should be supplied outside the repository via `~/.gradle/gradle.properties` or via environment variables.

#### Option 1: User Gradle Properties (`~/.gradle/gradle.properties` — Recommended)
In your user home directory (`C:\Users\<USER>\.gradle\gradle.properties` on Windows or `~/.gradle/gradle.properties` on Unix):
```properties
STUXS_RELEASE_STORE_FILE=C:\\Users\\<USER>\\.keystores\\STUXS-Music-release.jks
STUXS_RELEASE_STORE_PASSWORD=<your_store_password>
STUXS_RELEASE_KEY_ALIAS=<your_key_alias>
STUXS_RELEASE_KEY_PASSWORD=<your_key_password>
```

#### Option 2: Environment Variables
```bash
export STUXS_RELEASE_STORE_FILE="/absolute/path/to/STUXS-Music-release.jks"
export STUXS_RELEASE_STORE_PASSWORD="<your_store_password>"
export STUXS_RELEASE_KEY_ALIAS="<your_key_alias>"
export STUXS_RELEASE_KEY_PASSWORD="<your_key_password>"
```

---

## Step-by-Step Procedure (A – M)

### Step A: Build Signed Release APK
With your credentials configured in `~/.gradle/gradle.properties` or environment variables:
```bash
cd android
./gradlew assembleRelease
```
The output APK will be located at:
`android/app/build/outputs/apk/release/app-release.apk`

> **IMPORTANT**: The release APK must be signed with the exact same production signing certificate across all releases. Android's `PackageInstaller` will reject any update if the certificate does not match (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`).

### Step A.1: Verify APK Signature
Always verify the APK signature using Android SDK `apksigner` before distributing:
```bash
apksigner verify --verbose --print-certs android/app/build/outputs/apk/release/app-release.apk
```
Verify that:
- `Verifies: true`
- Signer certificate Subject and SHA-256 fingerprint match your production certificate.
- Package name is `com.stuxs.music`.

### Step B: Calculate APK SHA-256
Calculate the exact 64-character lowercase SHA-256 hash of the generated signed release APK:
```bash
node scripts/generate-update-manifest.mjs --apk android/app/build/outputs/apk/release/app-release.apk
```

### Step C: Calculate APK File Size
Obtain the exact size in bytes (e.g. `16770028`).

### Step D: Create GitHub Release with a Release Tag
1. In your GitHub repository (`https://github.com/aayushpatil826-creator/STUXS-Music`), navigate to **Releases** → **Draft a new release**.
2. Choose or create a tag (e.g. `v2.0`).
3. Set the release title (e.g. `STUXS Music 2.0`).
4. Add release notes describing user-facing fixes and features.

### Step E: Upload APK as a Release Asset
Attach your signed release APK (e.g. `STUXS-Music-2.0.apk`) to the GitHub Release.

### Step F: Update docs/update.json
Fill out `docs/update.json` with real values (no template placeholders):
```json
{
  "latestVersion": "2.0",
  "latestVersionCode": 5,
  "minimumSupportedVersionCode": 1,
  "releaseDate": "2026-09-10",
  "apkUrl": "https://github.com/aayushpatil826-creator/STUXS-Music/releases/download/<RELEASE_TAG>/STUXS-Music-2.0.apk",
  "apkSize": 16770028,
  "sha256": "<64-char-lowercase-hex-sha256>",
  "mandatory": false,
  "title": "STUXS Music 2.0",
  "releaseNotes": [
    "Playlist scrolling smoothness fixes",
    "Real Indian Trending charts backed by JioSaavn and Gaana",
    "Strict STUXS catalog exclusion from trending candidate pool",
    "Home Carousel and Dedicated See All Trending parity",
    "Native Media3 playback performance optimizations"
  ]
}
```

### Step G: Push update.json to GitHub Pages
Commit and push `docs/update.json` to your `main` branch. GitHub Pages will serve it at:
`https://aayushpatil826-creator.github.io/STUXS-Music/update.json`

### Step H: Open STUXS on an Older Supported Version
Launch the installed app having a lower `versionCode` (e.g. `versionCode 4`).

### Step I: Verify "Update Available"
The app fetches `update.json` over HTTPS, validates the schema, verifies `github.io` and `github.com` host whitelists, and compares version codes (4 < 5). The UpdateBottomSheet appears.

### Step J: Download
User taps **Update Now**. The native updater connects to the GitHub Release asset URL over HTTPS, follows the secure CDN redirect, and streams bytes into application cache.

### Step K: SHA-256 Verification
The downloaded APK is hashed on the fly. The hash is compared against `update.json`. If mismatched, the file is automatically purged.

### Step L: Android Installation
Android `FileProvider` generates a secure `content://` URI and launches the system `PackageInstaller`. The user confirms system installation.

### Step M: Relaunch and Verify
The app relaunches with `versionCode 5`. All user data, playlists, downloads, settings, and auth sessions survive intact.
