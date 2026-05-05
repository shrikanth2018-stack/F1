# 1stOne F1 — EAS Submission Setup

> One-time setup for `eas submit --platform <ios|android>`. Required before the first public submission to either store. Each step is independent of the other; do iOS or Android in any order.

## Android — Play Console service account JSON

`eas.json → submit.production.android.serviceAccountKeyPath` points at `./play-store-service-account.json`. That file is **gitignored**; you generate it once and place it locally before the first `eas submit --platform android`.

Provisioning steps:

1. **Google Play Console** → Setup → API access. Create or link a Google Cloud project.
2. In the linked Google Cloud project's Console → IAM & Admin → Service Accounts → Create. Name it e.g. `eas-play-submit`. Skip role grants on the GCP side.
3. On the new service account → Keys → Add Key → Create JSON. Download.
4. Back in Play Console → API access → grant the service account these permissions on your `1stone` app: **Release apps to testing tracks**, **Manage production releases** (the EAS docs call out the exact list — match whatever they recommend at submit time).
5. Rename the downloaded JSON to `play-store-service-account.json` and place it at the repo root (next to `eas.json`). `.gitignore` keeps it out of git.

After that, `eas submit --platform android --profile production` reads the file and uploads to the `internal` track (per `eas.json`). Promote to closed / open / production tracks via Play Console UI.

**Historical note:** before this cleanup (FT-01, 2026-05-05) the path mistakenly pointed at `./google-services.json` — that's the FCM client config (push notifications), not a service account. Wrong file shape; would have failed at submit time. Fixed now.

## iOS — App Store Connect identifiers

`eas.json → submit.production.ios` has three placeholders:

```json
"appleId":     "REPLACE_WITH_APPLE_ID"
"ascAppId":    "REPLACE_WITH_ASC_APP_ID"
"appleTeamId": "REPLACE_WITH_TEAM_ID"
```

Replace these once before the first iOS submission:

- **`appleId`** — the Apple ID email registered on the Apple Developer team (the account that owns the app record in App Store Connect).
- **`ascAppId`** — the numeric app ID from App Store Connect → My Apps → 1stOne → App Information → Apple ID. Looks like `1234567890`.
- **`appleTeamId`** — the team ID from developer.apple.com → Account → Membership. Looks like `ABCDE12345`.

EAS prompts for an app-specific password the first time `eas submit --platform ios` runs and caches it; no extra file needed.

## Tracks and channels

- **EAS build channels:** `eas.json` defines `development`, `preview`, `production`. Mobile auto-update OTA channels follow the same names.
- **Android track:** `production` profile submits to Play Console's `internal` track. Promote via Play Console UI.
- **iOS track:** App Store Connect TestFlight is the equivalent of Android's internal track; submitting promotes the build to TestFlight by default.
