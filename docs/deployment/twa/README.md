# TWA — the Play Store wrapper around the mobile PWA

The Android app on Play is a Trusted Web Activity: a thin native shell that
opens `https://insighta.one/mobile/` full-screen. There is no second codebase.
Shipping a dial change ships an app change; the only reason to rebuild the app
is a change to what is in this folder.

## What lives where

| | |
|---|---|
| `twa-manifest.json` | the whole app definition — package id, name, colors, start URL, orientation |
| `nginx-host.conf` | the one change production nginx needs, with why and how to verify |
| `frontend/public/.well-known/assetlinks.json` | **the fingerprint. Single source of truth** — it ships with the frontend build, so rotating keys is a code change |
| `~/.bubblewrap/insighta-twa/android.keystore` | signing key, mode 600, **never in git** |
| `~/.bubblewrap/insighta-keystore.pass` | its password, mode 600 |
| `~/insighta-twa-release/` | built AAB/APK, kept out of the repo |

**Losing the keystore ends the app.** Play identifies an app by its signing
key, so a lost key means no updates to `one.insighta.app` — ever, under any
account. Back it up somewhere that survives this laptop.

## Build

```bash
cd <scratch dir>
cp <repo>/docs/deployment/twa/twa-manifest.json .
cp ~/.bubblewrap/insighta-twa/android.keystore .

export ANDROID_HOME=~/.bubblewrap/android_sdk
export BUBBLEWRAP_KEYSTORE_PASSWORD=$(cat ~/.bubblewrap/insighta-keystore.pass)
export BUBBLEWRAP_KEY_PASSWORD=$BUBBLEWRAP_KEYSTORE_PASSWORD

bubblewrap update --skipVersionUpgrade   # generates the project + checksum
bubblewrap build --skipPwaValidation     # → app-release-bundle.aab
```

`update` first is not optional. `build` prompts for a version name when
`manifest-checksum.txt` is missing, and the prompt cannot be answered by piping
— `yes ""` sends empty input, which the validator rejects, and it loops. Run
`update` and `build` never asks.

### Three things that were wrong on the first attempt

Worth keeping, because each cost a debugging round and none of them announce
themselves.

**The SDK looked complete and was rejected.** `AndroidSdkTools.validatePath`
wants `<sdk>/tools` or `<sdk>/bin` at the SDK root. A modern SDK has neither —
its binaries are at `cmdline-tools/latest/bin`. Fix:

```bash
ln -sfn ~/.bubblewrap/android_sdk/cmdline-tools/latest ~/.bubblewrap/android_sdk/tools
```

That one link does double duty: it satisfies the check, and it puts
`sdkmanager` where `installBuildTools` looks for it (`tools/bin/sdkmanager`).
`sdkmanager` warns about a duplicate package location afterwards; harmless.

**bubblewrap 1.25.0 wants build-tools 36.1.0, not whatever is installed.**
The version is hardcoded, and `zipalign` and `apksigner` are invoked from that
exact directory. Install ahead of time so the build does not stop to ask:

```bash
yes | ~/.bubblewrap/android_sdk/cmdline-tools/latest/bin/sdkmanager \
  --sdk_root=~/.bubblewrap/android_sdk "build-tools;36.1.0" "platforms;android-36"
```

**`jdkPath` must be the `.jdk` bundle, not its `Contents/Home`.** On macOS
bubblewrap appends `/Contents/Home/` itself, so a config pointing at
`.../temurin-17.jdk/Contents/Home` produces `.../Contents/Home/Contents/Home/`
and Gradle reports an invalid `JAVA_HOME` — with a path that looks almost
right, which is why it reads as a JDK problem rather than a config one.

```bash
bubblewrap updateConfig --jdkPath /Library/Java/JavaVirtualMachines/temurin-17.jdk
bubblewrap doctor        # must say both paths are valid
```

## Verify before uploading

Fingerprint mismatch is the failure that costs the most, because nothing errors
— the app installs, works, and simply keeps its URL bar. Check the two match:

```bash
$ANDROID_HOME/build-tools/36.1.0/apksigner verify --print-certs app-release-signed.apk \
  | grep -i 'SHA-256'
jq -r '.[0].target.sha256_cert_fingerprints[0]' \
  <repo>/frontend/public/.well-known/assetlinks.json
```

One prints lowercase unseparated, the other colon-separated uppercase. Same
bytes. Also confirm the package id, which must equal what Play has:

```bash
$ANDROID_HOME/build-tools/36.1.0/aapt2 dump badging app-release-signed.apk | head -1
# package: name='one.insighta.app' versionCode='1' versionName='1.0.0'
```

Verified for the 1.0.0 build on 2026-08-11: fingerprint matches, `jarsigner
-verify` reports `jar verified`, package and version as above.

## Asset Links

Chrome fetches `https://insighta.one/.well-known/assetlinks.json` over HTTPS to
confirm the app and the site have the same publisher. Until it returns 200 the
app shows a URL bar. It measured **403** before this work, because both nginx
layers end with:

```nginx
location ~ /\. { deny all; }
```

which matches any URI containing `/.`. The ACME challenge escapes it only by
living in the port-80 block. Both layers need an exact-match exception, since a
regex location outranks a prefix one:

- container — already in `frontend/nginx/nginx.conf.template` (this repo)
- host — `nginx-host.conf`, applied by James

Deploy the frontend first. If nginx is fixed while the file is missing, the
proxy returns the SPA shell with a 200 and a status-code check passes on the
wrong body. Assert the package name, not the status.

## Releasing a new version

Bump `appVersionCode` (must strictly increase — Play rejects a repeat) and
`appVersionName` in `twa-manifest.json`, rebuild, upload. Content changes on
`/mobile/` need no rebuild at all.
