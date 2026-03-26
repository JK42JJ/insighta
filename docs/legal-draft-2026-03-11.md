# Legal Pages Draft — 2026-03-11

Curator.io 참고하여 보강한 Privacy Policy + Terms of Service 초안.

---

## Privacy Policy

**Last updated: March 11, 2026**

### 1. Overview

Insighta ("we", "our", "the Service") is a personal knowledge management platform that syncs YouTube playlists, generates AI-powered summaries from video captions, and provides note-taking tools for learning purposes. We take your privacy seriously. This policy explains what information we collect, how we use it, and what rights you have in relation to it.

### 2. Data We Collect

#### 2.1 Account Information
When you sign in with Google, we receive your email address and display name via Google OAuth.

#### 2.2 YouTube Data
Playlist metadata, video titles, descriptions, thumbnails, and captions from your YouTube playlists (read-only access via the `https://www.googleapis.com/auth/youtube.readonly` scope). We never modify or delete any YouTube content.

#### 2.3 User-Generated Content
Notes, cards, and settings you create within the Service.

#### 2.4 Website Visitors
Like most website operators, we collect non-personally-identifying information such as browser type, language preference, referring site, and the date and time of each request. We may publish aggregated, non-identifying statistics (e.g., trends in usage) from time to time.

### 3. How We Use Your Data

- To authenticate your identity and provide access to the Service.
- To sync and display your YouTube playlist data within the app.
- To store your notes and learning progress.
- To generate AI-powered summaries of video content using Google Gemini. Video captions are transmitted to this service solely for summary generation and are not stored by the AI provider beyond the processing request.
- To improve the Service through aggregated, anonymized usage statistics.

We do **not** sell, share, or transmit your personal data to third parties for marketing purposes. Your data is used solely to provide and improve the Service.

### 4. YouTube API Services

This application uses the YouTube API Services. By using this Service, you agree to be bound by the [YouTube Terms of Service](https://www.youtube.com/t/terms), the [Google Privacy Policy](https://policies.google.com/privacy), and the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).

We request the `https://www.googleapis.com/auth/youtube.readonly` scope (read-only access to your YouTube account) to read your playlist and video metadata. We never modify or delete any YouTube content.

Insighta's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

### 5. Cookies

A cookie is a small piece of data stored on your computer by your web browser. We use cookies to maintain your session and preferences. We do not use cookies to track you across other websites.

You can configure your browser to refuse cookies, with the understanding that some features of the Service may not function properly without them.

### 6. Third-Party Service Providers

We use the following third-party services to operate the Service:

- **Supabase** (database, authentication, and edge functions hosting, AWS us-west-2 region) — [Supabase Privacy Policy](https://supabase.com/privacy)
- **Google / YouTube API Services** — [Google Privacy Policy](https://policies.google.com/privacy)
- **Google Gemini** (AI summary generation from video captions) — [Google Privacy Policy](https://policies.google.com/privacy)

We do not use any third-party advertising networks or retargeting services.

### 7. Data Storage & Security

- All data is stored in a secured PostgreSQL database hosted on Supabase Cloud (AWS us-west-2 region).
- Authentication is handled by Supabase Auth. OAuth tokens and session tokens (JWT) are managed securely by the Supabase platform.
- All connections use HTTPS/TLS encryption.

### 8. Data Retention & Deletion

We retain your data only for as long as your account is active. YouTube playlist metadata is refreshed on each sync and not stored beyond what is displayed in the app. OAuth tokens are retained only while your YouTube account is connected.

You can disconnect your YouTube account at any time from the Settings page, which immediately revokes our access and deletes stored OAuth tokens. To request full account and data deletion, contact us at the email below. We will process deletion requests within 30 days.

### 9. Your Rights

You have the right to:

- Access your personal data stored in the Service.
- Request correction or deletion of your data.
- Request restriction of processing of your data.
- Request a portable copy of your data in a structured format.
- Revoke Google/YouTube access at any time via [Google Account Permissions](https://myaccount.google.com/permissions).
- Lodge a complaint with your local data protection authority if you believe your data has been mishandled.

To exercise any of these rights, contact us at the email below. We will respond within 30 days.

### 10. Business Transfers

If Insighta or substantially all of its assets were acquired, or in the unlikely event that Insighta goes out of business, user information would be one of the assets transferred to the acquiring party. You acknowledge that such transfers may occur, and that any acquirer may continue to use your personal information as set forth in this policy.

### 11. Privacy Policy Changes

We may update this Privacy Policy from time to time. We encourage you to frequently check this page for any changes. Your continued use of the Service after any change in this Privacy Policy will constitute your acceptance of such change.

### 12. Contact

For privacy-related questions, contact: [admin@insighta.one](mailto:admin@insighta.one)

---

## Terms of Service

**Last updated: March 11, 2026**

### 1. Acceptance of Terms

By accessing or using Insighta ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not access or use the Service.

### 2. Description of Service

Insighta is a personal knowledge management platform that allows you to sync YouTube playlists, generate AI-powered summaries from video captions, take notes, and manage learning progress. The Service is provided as-is and may be updated, modified, or discontinued at any time without prior notice.

### 3. User Accounts

- You must sign in with a valid Google account to use the Service.
- You are responsible for maintaining the security of your account.
- You must not share your account or use the Service for unauthorized purposes.
- You may delete your account at any time by contacting us. Upon deletion, your data will be removed within 30 days.

### 4. Subscription & Payment

The Service currently offers a free tier. If paid plans are introduced in the future, the following terms will apply:

- Paid subscriptions are billed on a recurring basis (monthly or annually).
- Your subscription will automatically renew unless you cancel before the renewal date.
- You may cancel your subscription at any time from your account settings. Cancellation takes effect at the end of the current billing period.
- Refunds are generally not provided for partial billing periods, except where required by applicable law.

### 5. YouTube API Usage

The Service accesses YouTube data through the YouTube API Services. By using this feature, you also agree to the [YouTube Terms of Service](https://www.youtube.com/t/terms) and the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).

### 6. AI-Generated Content

The Service uses Google Gemini to generate summaries from video captions. By using the AI summary feature, you acknowledge that:

- Video captions are transmitted to Google Gemini solely for summary generation and are not stored by the AI provider beyond the processing request.
- AI-generated summaries are provided for informational purposes and may not be fully accurate.
- You retain ownership of any notes or edits you make to AI-generated content within the Service.

### 7. User Content

Content you create within the Service (notes, cards, settings) remains yours. You retain all ownership rights to your content.

By submitting content to the Service, you grant Insighta a limited, non-exclusive, royalty-free license to use, store, and display your content solely for the purpose of operating and providing the Service to you. This license terminates when you delete your content or your account.

YouTube content displayed in the Service belongs to its respective creators and is subject to YouTube's terms.

### 8. Acceptable Use

You agree not to:

- Use the Service to violate any laws or regulations.
- Attempt to circumvent security measures or access controls.
- Use automated tools to scrape or abuse the Service.
- Interfere with the Service's operation or other users' access.
- Upload or transmit viruses or other malicious code.

### 9. Third-Party Links

The Service may contain links to third-party websites or services that are not owned or controlled by Insighta. We have no control over, and assume no responsibility for, the content, privacy policies, or practices of any third-party websites or services. Use of the Service does not grant you any rights to the trademarks or intellectual property of third parties.

### 10. Service Availability

We strive to keep the Service available at all times, but we do not guarantee uninterrupted access. The Service may be temporarily unavailable due to maintenance, updates, or circumstances beyond our control. We reserve the right to modify, suspend, or discontinue the Service at any time.

### 11. Limitation of Liability

The Service is provided "as is" and "as available" without warranties of any kind, either express or implied. To the fullest extent permitted by law, Insighta shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of data, profits, or goodwill arising from your use of the Service.

### 12. Indemnification

You agree to indemnify and hold harmless Insighta, its operators, and their respective officers, employees, and agents from and against any and all claims, damages, obligations, losses, and expenses arising from your use of the Service or your violation of these Terms.

### 13. Termination

We may suspend or terminate your access at any time for violation of these Terms. You may stop using the Service at any time by disconnecting your accounts and requesting data deletion. Upon termination, your right to use the Service ceases immediately.

### 14. Governing Law

These Terms shall be governed by and construed in accordance with the laws of the Republic of Korea, without regard to its conflict of law provisions. Any disputes arising from these Terms or the Service shall be subject to the exclusive jurisdiction of the courts located in Seoul, Republic of Korea.

### 15. Changes to Terms

We may update these Terms from time to time. We will notify users of material changes by posting the updated Terms on this page with a revised "Last updated" date. Continued use of the Service after changes constitutes acceptance of the updated Terms.

### 16. Contact

For questions about these Terms, contact: [admin@insighta.one](mailto:admin@insighta.one)

---

## 변경 내역 (vs 이전 버전)

### Privacy Policy 추가 항목
| # | 섹션 | 내용 |
|---|------|------|
| 1 | Overview (보강) | AI 요약 기능 서비스 설명 추가 |
| 2.2 | YouTube Data (보강) | captions 추가, full scope URL 표기 |
| 2.4 | Website Visitors | 비식별 방문자 데이터 수집 명시 |
| 3 | How We Use (보강) | Google Gemini AI 데이터 전송 고지 |
| 4 | YouTube API (보강) | full scope URL (`googleapis.com/auth/youtube.readonly`) |
| 5 | Cookies | 쿠키 사용 목적, 거부 방법 |
| 6 | Third-Party (보강) | Supabase 역할 정확화 (DB+Auth+Edge Functions), Google Gemini 추가 |
| 7 | Data Storage (보강) | PostgreSQL on Supabase Cloud 명시, JWT 세션 토큰 보안 |
| 9 | Your Rights (보강) | 처리 제한권, 이동권, DPA 민원권 추가 |
| 10 | Business Transfers | 인수/파산 시 데이터 처리 |
| 11 | Privacy Policy Changes | 변경 고지 방법 |

### Terms of Service 추가 항목
| # | 섹션 | 내용 |
|---|------|------|
| 2 | Description (보강) | AI 요약 기능 서비스 설명 추가 |
| 3 | User Accounts (보강) | 계정 삭제 절차 (30일) |
| 4 | Subscription & Payment | 무료/유료 플랜, 갱신, 해지, 환불 |
| 6 | AI-Generated Content (신규) | Gemini 데이터 전송, 정확성 면책, 소유권 |
| 7 | User Content (보강) | 서비스 운영 라이선스 부여 조항 |
| 9 | Third-Party Links | 외부 링크 면책 |
| 10 | Service Availability | 가용성/중단 면책 |
| 11 | Limitation of Liability (보강) | "as available" + 구체적 면책 범위 |
| 12 | Indemnification | 면책 조항 |
| 14 | Governing Law | 대한민국법, 서울법원 관할 |
