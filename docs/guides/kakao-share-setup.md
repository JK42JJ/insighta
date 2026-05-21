# Kakao Share — Developer Console Setup Guide

**Context:** Learning Page share menu (CP454+) supports 4 channels — 링크 복사 / 카카오톡 / X / 네이버. Three of those work without any external setup. **Kakao alone requires a JavaScript Key issued from the Kakao Developers console**, plus the Web platform domain to be registered so the SDK accepts requests from `insighta.one` and `localhost:8081`.

Until `VITE_KAKAO_JS_KEY` is set in the environment, the 카카오톡 channel in `LearningShareMenu` shows a `disabled` state with the "준비중 / Coming soon" label. The 3 other channels keep working unchanged.

---

## 1. Create the app

1. Sign in at https://developers.kakao.com (use any Kakao account — the same one that will manage the app long-term).
2. Top nav → **내 애플리케이션 / My Applications** → **애플리케이션 추가하기**.
3. Fill out:
   - **앱 이름**: `Insighta`
   - **사업자명 / Business name**: 사용자 본인 또는 사업자명
   - **카테고리**: `교육` (Education)
4. Save. You land on the **앱 키 / App Keys** page.

## 2. Copy the JavaScript Key

The keys page shows 4 keys:
- 네이티브 앱 키 (Android / iOS — not used here)
- REST API 키 (server-side — not used here)
- **JavaScript 키** ← **this is what we need**
- Admin 키 (do NOT use in client code)

Copy the **JavaScript Key** (looks like a 32-char alphanumeric string). It is **safe to ship in the bundled client** — Kakao security relies on the Web platform domain check (next step) rather than key secrecy.

## 3. Register the Web platform

1. Left nav → **앱 설정 / App Settings** → **플랫폼 / Platform**.
2. Click **Web 플랫폼 등록** → add **both** of the following domains (one per line is fine):
   - `https://insighta.one`
   - `http://localhost:8081`
3. Save.

> Without the domain registration the SDK init succeeds but `Kakao.Share.sendDefault()` errors at runtime with a vague "AppKey is not registered" message.

## 4. (Optional, do not enable) — Kakao Login, OAuth, Push

The share feature uses only **Kakao Share JS SDK → Message → Feed template**, which is permission-free. Do NOT enable Kakao Login or OAuth for this feature; that triggers a Kakao app review process that is unrelated.

## 5. Wire the key into the deployment

### Dev (local)

Add to `frontend/.env`:

```
VITE_KAKAO_JS_KEY=<paste the JavaScript Key>
```

> `.env` files are immutable per CLAUDE.md (§.env 불변). Use the inline approach instead:

```bash
VITE_KAKAO_JS_KEY=<paste the JavaScript Key> npm run dev
```

### Prod (GitHub Secret → EC2 .env via deploy.yml)

```bash
gh secret set VITE_KAKAO_JS_KEY --body "<paste the JavaScript Key>"
```

Then add the sync line inside `.github/workflows/deploy.yml` (in the `envs` list + the env block + the sed write block — search for an existing `VITE_*` secret like `VITE_POSTHOG_KEY` and mirror that pattern). After the next deploy, the EC2 frontend Docker image is rebuilt with the key embedded.

Once the env is set, the disabled-state and "준비중" badge in the share menu disappear automatically — no code change needed.

## 6. Update credentials.md

Add a row in `memory/credentials.md` § L6 (GitHub Secrets):

| Secret name | Used by | Env var on prod (L7) | Notes |
|-------------|---------|----------------------|-------|
| `VITE_KAKAO_JS_KEY` | Learning Page share menu — Kakao Feed | `VITE_KAKAO_JS_KEY` | CP454+ 2026-05-21. Client-bundled JavaScript Key (domain-scoped). Rotate if domain is compromised. |

## 7. (Optional) Add an SDK preload `<script>` tag

For zero first-click latency, add this to `frontend/index.html`'s `<head>`:

```html
<script defer src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js"
        integrity="sha384-DKYJZ8NLiK8MN4/C5P2dtSmLQ4KwPaoqAfyA/DfmEc1VDxu4yyC7wy6K1Hs90nka"
        crossorigin="anonymous"></script>
```

If you skip this step, the menu code can lazy-load the script on first click — slightly slower but no HTML edit required.

## 8. Verification

After `VITE_KAKAO_JS_KEY` is set and the dev server is restarted:

1. Open `/learning/:mandalaId/:videoId`
2. Click the share button (next to the ⚡ HighlightReel button).
3. The dropdown opens. Verify the **카카오톡** row is enabled (no opacity-50 + no "준비중" badge).
4. Click 카카오톡 → a popup window opens with the Insighta video share card (thumbnail + title + first-sentence summary + "영상 보기" button).
5. Send to yourself in a Kakao chat → verify the card renders with the OG meta from `/api/v1/og/learning/:mandalaId/:videoId`.

## 9. Rollback

If anything breaks: `gh secret delete VITE_KAKAO_JS_KEY` + redeploy. The 카카오톡 channel reverts to disabled-state automatically.
