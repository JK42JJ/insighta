#
프런트엔드를 SYNC-YOUTUBE-PLAYLISTS 프로젝트에 통합하기 위한 플랜을 세워(모노레포로 관리).
프런트엔드 깃헙주소: https://github.com/JK42JJ/tube-mandala

clone 한 프런트엔드 코드는 루트에 frontend 폴더를 만들어서 subAgent 를 이용해서 작업해(subAgent 는 mcp superclaude 사용해서 최적의 페르소나와 계획/도구 등을 사용해서 만들것)
프런트엔드는 배포할 때 도커를 사용할수 있도록 작업해(SYNC-YOUTUBE-PLAYLISTS 와 동일한 방식)

#
모노레포로 프로젝트를 통합했으니 불필요한 파일, 정보가 있는지 검토 해 줄래? (subagent 사용해서 시간효율적으로 처리해줘)

#
아니 우선 검토 내용을 1차 검토로 해서 .md 로 작성해 둘레, 이후에 코드 작성후 추가로 검토할때 다시한번 확인하는것이 좋을것 같아.

#
로컬에는 supabase 가 설치되어 있어 (환경파일: /Users/jeonhokim/cursor/superbase/.env.dev)
따라서, frontend와 backend 모두를 로컬에 도커로 올리고,
로컬에 있는 supabase 와 연동해서 서비스가 돌아가도록 하고 싶어.
이과 관련해 작업을 계획하고 작업수행을 관리해 줄래?

모든 작업은 subagent 를 사용하고 작업관리는 Superclaude 를 사용해
또, subagent 는 가용한 도구를 사용하거나 필요시 만들어서 사용해(mcps, skills, hooks, commands, scripts, etc)
ex. 가령 supabase 는 mcp-cli 를 사용하는것이 좋겠어.

모든 작업은 진행/완료 상황을 볼수 있도록 완료된 작업은 체크박스로 하나씩 체크하면서 진행해.

현재 상태

  | 항목       | 현재 설정            | 목표                     |
  |------------|----------------------|--------------------------|
  | Backend DB | SQLite (개발용)      | 로컬 Supabase PostgreSQL |
  | Frontend   | Supabase Cloud 연결  | 로컬 Supabase 연결       |
  | Docker     | 외부 PostgreSQL 가정 | 로컬 Supabase 연동       |


  ⏺ ✅ Docker + Local Supabase 연동 완료

  모든 설정이 완료되었습니다. 현재 상태:

  | 서비스   | 상태         | URL                                 |
  |----------|--------------|-------------------------------------|
  | API      | ✅ Healthy   | http://localhost:3000               |
  | Frontend | ✅ Healthy   | http://localhost:8080               |
  | API Docs | ✅ Available | http://localhost:3000/documentation |
  | Supabase | ✅ Connected | supabase-db-dev:5432                |

  주요 수정 사항

  Nginx non-root 실행 문제 해결:
  - nginx.conf: pid 경로를 /tmp/nginx.pid로 변경
  - Dockerfile: nginx 설정 파일들의 권한 설정 추가

  해결된 에러들:
  1. Supabase 클라이언트 누락 → client.ts 생성
  2. 데이터베이스 연결 실패 → 호스트명 supabase-db-dev 수정
  3. Prisma OpenSSL 호환성 → runner 스테이지에서 재생성
  4. Nginx 권한 문제 → non-root 사용자용 설정 수정

  사용법

  # 시작
  ./scripts/dev-docker.sh start

  # 로그 확인
  ./scripts/dev-docker.sh logs

  # 중지
  ./scripts/dev-docker.sh stop




#
index.html 에 다음 코드가 삽입되어 있어.

- 아래 -
    <script type="module">
      if (import.meta.env.DEV) {
        import("react-grab");
      }
    </script>

목적은, frontend 의 ui element 를 확인하고 claude  에게 올바르게 요청하기 위한 것으로, https://www.react-grab.com/ 의 서비스야.

그런데 올바르게 동작하지 않아. 문제를 확인해 줄래?

의도는 TubeArchive 메인페이지에서 수정이 필요한 element 를 정확히 확인하고 claude 에게 요청하고싶어.


#
⏺ 코드 변경 없이 react-grab을 사용할 수 있습니다. 다음과 같이 실행하세요:

  1. API 서버 (Docker)
  docker-compose up api

  2. Frontend 개발 서버 (별도 터미널)
  cd frontend
  npm run dev

  3. react-grab 사용
  - 브라우저에서 http://localhost:8080 접속
  - Cmd+C를 누른 상태에서 수정할 UI 요소 클릭
  - 요소 정보가 클립보드에 복사됨
  - Claude에게 붙여넣기하여 정확한 수정 요청 가능


  #
  frontend 작업 및 backend 연동

  설정화면에 youtube palylist sync 설정 화면을 추가하고,
  해당 동영상을 "주기" 적으로 로딩해서 db(supabase)에 추가한뒤
  해당 동영상 리스트를 "아이디에이션" 팔레트에 로드하는 작업이야



  ##
  Implementation Order

 | Step | Task                                     | Est. Time |
 |------|------------------------------------------|-----------|
 | 1    | Supabase 테이블 생성 (SQL migration)     | 1h        |
 | 2    | Edge Function: youtube-auth (OAuth)      | 3h        |
 | 3    | Edge Function: youtube-sync              | 4h        |
 | 4    | useYouTubeAuth hook                      | 1h        |
 | 5    | useYouTubeSync hook                      | 2h        |
 | 6    | YouTubeConnectButton component           | 1h        |
 | 7    | PlaylistItem component                   | 1h        |
 | 8    | YouTubeSyncCard component                | 2h        |
 | 9    | Settings.tsx 수정                        | 0.5h      |
 | 10   | youtubeToInsightCard utility             | 0.5h      |
 | 11   | useIdeationVideos hook                   | 1h        |
 | 12   | Index.tsx 수정 (FloatingScratchPad 연동) | 1h        |
 | 13   | Edge Function: scheduled-sync + pg_cron  | 2h        |
 | 14   | 테스트 및 버그 수정                      | 2h        |

 Total: ~22 hours

 ---
 Critical Files Reference

 | File                                           | Purpose                       |
 |------------------------------------------------|-------------------------------|
 | frontend/src/pages/Settings.tsx                | 설정 카드 추가 위치           |
 | frontend/src/pages/Index.tsx                   | FloatingScratchPad props 수정 |
 | frontend/src/components/FloatingScratchPad.tsx | InsightCard 타입 참조         |
 | frontend/src/integrations/supabase/client.ts   | Supabase 클라이언트           |
 | frontend/src/types/mandala.ts                  | InsightCard 타입 정의         |

 ---
 Environment Variables Required

 Frontend (.env)

 VITE_SUPABASE_URL=https://xxx.supabase.co
 VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...

 Supabase Edge Functions (Secrets)

 YOUTUBE_API_KEY=AIza...
 YOUTUBE_CLIENT_ID=xxx.apps.googleusercontent.com
 YOUTUBE_CLIENT_SECRET=xxx


 ## Edge Function 문제 확인 중.
 ⏺ YouTube 연결 상태 오류를 조사하겠습니다. Edge Function 호출 시 API 키가 누락되는 문제를 확인합니다.

⏺ Read(frontend/src/hooks/useYouTubeAuth.ts)
  ⎿  Read 236 lines

⏺ Search(pattern: "**/supabase/functions/**/*", path: "~/cursor/superbase")
  ⎿  Found 0 files

⏺ Edge Function이 self-hosted Supabase에 배포되지 않았습니다. 프로젝트 내 Edge Function 코드를 확인합니다.

⏺ Search(pattern: "**/functions/**/*.ts", path: "~/cursor/sync-youtube-playlists")
  ⎿  Found 27 files (ctrl+o to expand)

⏺ Search(pattern: "**/supabase/**/*", path: "~/cursor/sync-youtube-playlists")
  ⎿  Found 8 files (ctrl+o to expand)

⏺ youtube-auth Edge Function 코드를 확인합니다.

⏺ Read(frontend/supabase/functions/youtube-auth/index.ts)
  ⎿  Read 382 lines

⏺ Read(frontend/supabase/config.toml)
  ⎿  Read 5 lines

⏺ 문제 발견: Self-hosted Supabase는 Edge Functions을 기본적으로 지원하지 않습니다. Frontend가 youtube-auth Edge Function을 호출하지만, 해당 함수가 배포되지 않았습니다.

  해결 방안: Backend API에 YouTube OAuth 엔드포인트가 있는지 확인하고, Frontend를 Backend API로 연결합니다.

⏺ Search(pattern: "src/api/routes/**/*.ts", path: "~/cursor/sync-youtube-playlists")
  ⎿  Found 7 files (ctrl+o to expand)

⏺ Read(src/api/routes/auth.ts)
  ⎿  Read 377 lines

⏺ Backend에는 YouTube OAuth가 없습니다. Self-hosted Supabase의 Edge Functions 서비스 상태를 확인합니다.

⏺ Bash(docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -E "(supabase|functions)" || echo "No
      matching containers")
  ⎿  supabase-kong-dev            Up 19 minutes (healthy)     8001/tcp, 0.0.0.0:8000->8000/tcp, 8443-8444/tcp
     supabase-studio-dev          Up 19 minutes (healthy)     3000/tcp
     supabase-auth-dev            Up 19 minutes (healthy)
     … +11 lines (ctrl+o to expand)

⏺ supabase-functions-dev 컨테이너가 실행 중입니다. Edge Function 배포 방법을 확인합니다.

⏺ Bash(docker exec supabase-functions-dev ls -la /home/deno/functions 2>/dev/null || echo "Cannot access functions directory")
  ⎿  total 4
     drwxr-xr-x 3 root root   96 Dec 21 05:56 .
     drwxr-xr-x 3 root root 4096 Dec 21 06:05 ..
     drwx------ 3 root root   96 Dec 21 06:00 main

⏺ Search(pattern: "**/docker-compose*.yml", path: "~/cursor/superbase")
  ⎿  Found 2 files (ctrl+o to expand)

⏺ Read(~/cursor/superbase/docker-compose.dev.yml)
  ⎿  Read 474 lines

⏺ Edge Functions 볼륨 구조를 확인하고 youtube-auth 함수를 배포합니다.

⏺ Bash(ls -la /Users/jeonhokim/cursor/superbase/volumes/functions/ 2>/dev/null || echo "Directory not found")
  ⎿  total 0
     drwxr-xr-x  3 jeonhokim  staff   96 Dec 21 14:56 .
     drwxr-xr-x  7 jeonhokim  staff  224 Dec 21 14:41 ..
     drwx------  3 jeonhokim  staff   96 Dec 21 15:00 main

⏺ Bash(mkdir -p /Users/jeonhokim/cursor/superbase/volumes/functions/youtube-auth && cp
      /Users/jeonhokim/cursor/sync-youtube-playlists/frontend/supabase/functions/youtu…)
  ⎿  (No content)

⏺ Bash(grep -E "^YOUTUBE|^GOOGLE" /Users/jeonhokim/cursor/superbase/.env.dev 2>/dev/null | head -10)
  ⎿  GOOGLE_CLIENT_ID=1014306212181-4ngpusiopta8matoh8gu4nvf2kqaavnr.apps.googleusercontent.com
     GOOGLE_CLIENT_SECRET=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

⏺ YouTube OAuth 환경변수를 Edge Functions 서비스에 추가해야 합니다.

⏺ Read(~/cursor/superbase/.env.dev)
  ⎿  Read 141 lines

⏺ YouTube OAuth 환경변수를 추가합니다.

⏺ Update(~/cursor/superbase/.env.dev)
  ⎿  Added 7 lines
      138  # Edge Functions Configuration
      139  ############
      140  FUNCTIONS_VERIFY_JWT=false
      141 +
      142 +############
      143 +# YouTube OAuth (for Edge Functions)
      144 +############
      145 +YOUTUBE_CLIENT_ID=1014306212181-4ngpusiopta8matoh8gu4nvf2kqaavnr.apps.googleusercontent.com
      146 +YOUTUBE_CLIENT_SECRET=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
      147 +YOUTUBE_REDIRECT_URI=http://localhost:8000/functions/v1/youtube-auth?action=callback

⏺ docker-compose.dev.yml의 functions 서비스에 YouTube OAuth 환경변수를 추가합니다.

⏺ Update(~/cursor/superbase/docker-compose.dev.yml)
  ⎿  Added 4 lines
      386        SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      387        SUPABASE_DB_URL: postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-postgres}
      388        VERIFY_JWT: ${FUNCTIONS_VERIFY_JWT:-false}
      389 +      # YouTube OAuth for Edge Functions
      390 +      YOUTUBE_CLIENT_ID: ${YOUTUBE_CLIENT_ID}
      391 +      YOUTUBE_CLIENT_SECRET: ${YOUTUBE_CLIENT_SECRET}
      392 +      YOUTUBE_REDIRECT_URI: ${YOUTUBE_REDIRECT_URI}
      393      volumes:
      394        - ./volumes/functions:/home/deno/functions:Z
      395      healthcheck:

⏺ Bash(cd /Users/jeonhokim/cursor/superbase && docker compose -f docker-compose.dev.yml --env-file .env.dev restart functions)
  ⎿   Container supabase-functions-dev  Restarting
      Container supabase-functions-dev  Started
  ⎿  Shell cwd was reset to /Users/jeonhokim/cursor/sync-youtube-playlists

⏺ Edge Function 상태를 테스트합니다.

⏺ Bash(sleep 5 && docker ps --format "table {{.Names}}\t{{.Status}}" | grep functions)
  ⎿  supabase-functions-dev       Up 11 seconds (healthy)

⏺ Bash(docker exec supabase-functions-dev ls -la /home/deno/functions/ 2>/dev/null)
  ⎿  total 4
     drwxr-xr-x 4 root root  128 Dec 21 07:19 .
     drwxr-xr-x 3 root root 4096 Dec 21 06:05 ..
     … +2 lines (ctrl+o to expand)

⏺ Bash(curl -s "http://localhost:8000/functions/v1/youtube-auth?action=status" | head -c 500)
  ⎿  {
       "message":"No API key found in request"
     }

⏺ Read(~/cursor/superbase/volumes/api/kong.template.yml)
  ⎿  Read 273 lines

⏺ Kong API Gateway는 Edge Functions에 apikey 헤더를 요구합니다. 테스트해봅니다.

⏺ Bash(ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzY2MjI3MDk2LCJleHAiOjE5Mj
      M5MDcwOTZ9._PPvvvOcDKL3jmTJqVhstKC4…)
  ⎿  curl: option : blank argument where content is expected
     curl: try 'curl --help' or 'curl --manual' for more information

⏺ Bash(curl -s "http://localhost:8000/functions/v1/youtube-auth?action=status" -H "apikey:
      eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9…)
  ⎿  {
       "error": "Function not found",
       "path": "/youtube-auth"
     }

⏺ Edge Runtime이 main 함수만 로드하고 있습니다. 모든 함수를 자동 발견하도록 설정을 변경합니다.

⏺ Bash(docker exec supabase-functions-dev edge-runtime --help 2>&1 | head -50)
  ⎿  A server based on Deno runtime, capable of running JavaScript, TypeScript, and WASM services

     Usage: edge-runtime [OPTIONS] [COMMAND]
     … +14 lines (ctrl+o to expand)

⏺ Bash(docker exec supabase-functions-dev edge-runtime start --help 2>&1 | head -60)
  ⎿  Start the server

     Usage: edge-runtime start [OPTIONS]
     … +62 lines (ctrl+o to expand)

⏺ Bash(docker exec supabase-functions-dev cat /home/deno/functions/main/index.ts 2>/dev/null || docker exec supabase-functions-dev
      ls -la /home/deno/functions/main/)
  ⎿  // Edge Functions main service
     // This is the entry point for all edge function requests
     … +25 lines (ctrl+o to expand)

⏺ main 함수가 라우터 역할을 합니다. youtube-auth 함수로 라우팅하도록 업데이트합니다.

⏺ Read(~/cursor/superbase/volumes/functions/main/index.ts)
  ⎿  Read 29 lines

⏺ Write(~/cursor/superbase/volumes/functions/main/index.ts)
  ⎿  Added 385 lines, removed 2 lines
        1  // Edge Functions main service
        2  // This is the entry point for all edge function requests
        3
        4 +import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
        5 +
        6 +const corsHeaders = {
        7 +  'Access-Control-Allow-Origin': '*',
        8 +  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        9 +};
       10 +
       11 +// YouTube OAuth 2.0 endpoints
       12 +const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
       13 +const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
       14 +
       15 +// Required scopes for YouTube playlist access
       16 +const SCOPES = [
       17 +  'https://www.googleapis.com/auth/youtube.readonly',
       18 +];
       19 +
       20 +interface TokenResponse {
       21 +  access_token: string;
       22 +  refresh_token?: string;
       23 +  expires_in: number;
       24 +  token_type: string;
       25 +  scope: string;
       26 +}
       27 +
       28 +async function handleYouTubeAuth(req: Request): Promise<Response> {
       29 +  // Handle CORS preflight requests
       30 +  if (req.method === 'OPTIONS') {
       31 +    return new Response(null, { headers: corsHeaders });
       32 +  }
       33 +
       34 +  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
       35 +  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
       36 +  const clientId = Deno.env.get('YOUTUBE_CLIENT_ID');
       37 +  const clientSecret = Deno.env.get('YOUTUBE_CLIENT_SECRET');
       38 +  const redirectUri = Deno.env.get('YOUTUBE_REDIRECT_URI');
       39 +
       40 +  if (!clientId || !clientSecret || !redirectUri) {
       41 +    console.error('Missing YouTube OAuth configuration');
       42 +    return new Response(
       43 +      JSON.stringify({ error: 'YouTube OAuth is not configured' }),
       44 +      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       45 +    );
       46 +  }
       47 +
       48 +  const supabase = createClient(supabaseUrl, supabaseServiceKey);
       49 +  const url = new URL(req.url);
       50 +  const action = url.searchParams.get('action');
       51 +
       52 +  try {
       53 +    switch (action) {
       54 +      case 'auth-url': {
       55 +        // Generate OAuth authorization URL
       56 +        const state = crypto.randomUUID();
       57 +
       58 +        // Get user from authorization header
       59 +        const authHeader = req.headers.get('Authorization');
       60 +        if (!authHeader) {
       61 +          return new Response(
       62 +            JSON.stringify({ error: 'Authorization required' }),
       63 +            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       64 +          );
       65 +        }
       66 +
       67 +        const token = authHeader.replace('Bearer ', '');
       68 +        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
       69 +
       70 +        if (userError || !user) {
       71 +          return new Response(
       72 +            JSON.stringify({ error: 'Invalid user token' }),
       73 +            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       74 +          );
       75 +        }
       76 +
       77 +        const authUrl = new URL(GOOGLE_AUTH_URL);
       78 +        authUrl.searchParams.set('client_id', clientId);
       79 +        authUrl.searchParams.set('redirect_uri', redirectUri);
       80 +        authUrl.searchParams.set('response_type', 'code');
       81 +        authUrl.searchParams.set('scope', SCOPES.join(' '));
       82 +        authUrl.searchParams.set('access_type', 'offline');
       83 +        authUrl.searchParams.set('prompt', 'consent');
       84 +        authUrl.searchParams.set('state', `${state}:${user.id}`);
       85 +
       86 +        return new Response(
       87 +          JSON.stringify({ authUrl: authUrl.toString() }),
       88 +          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
       89 +        );
       90 +      }
       91 +
       92 +      case 'callback': {
       93 +        // Handle OAuth callback
       94 +        const code = url.searchParams.get('code');
       95 +        const state = url.searchParams.get('state');
       96 +        const error = url.searchParams.get('error');
       97 +
       98 +        if (error) {
       99 +          console.error('OAuth error:', error);
      100 +          return new Response(
      101 +            JSON.stringify({ error: `OAuth error: ${error}` }),
      102 +            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      103 +          );
      104 +        }
      105 +
      106 +        if (!code || !state) {
      107 +          return new Response(
      108 +            JSON.stringify({ error: 'Missing code or state parameter' }),
      109 +            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      110 +          );
      111 +        }
      112 +
      113 +        // Extract user ID from state
      114 +        const [, userId] = state.split(':');
      115 +        if (!userId) {
      116 +          return new Response(
      117 +            JSON.stringify({ error: 'Invalid state parameter' }),
      118 +            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      119 +          );
      120 +        }
      121 +
      122 +        // Exchange code for tokens
      123 +        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      124 +          method: 'POST',
      125 +          headers: {
      126 +            'Content-Type': 'application/x-www-form-urlencoded',
      127 +          },
      128 +          body: new URLSearchParams({
      129 +            code,
      130 +            client_id: clientId,
      131 +            client_secret: clientSecret,
      132 +            redirect_uri: redirectUri,
      133 +            grant_type: 'authorization_code',
      134 +          }),
      135 +        });
      136 +
      137 +        if (!tokenResponse.ok) {
      138 +          const errorText = await tokenResponse.text();
      139 +          console.error('Token exchange failed:', errorText);
      140 +          return new Response(
      141 +            JSON.stringify({ error: 'Failed to exchange code for tokens' }),
      142 +            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      143 +          );
      144 +        }
      145 +
      146 +        const tokens: TokenResponse = await tokenResponse.json();
      147 +        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      148 +
      149 +        // Save tokens to database
      150 +        const { error: upsertError } = await supabase
      151 +          .from('youtube_sync_settings')
      152 +          .upsert({
      153 +            user_id: userId,
      154 +            youtube_access_token: tokens.access_token,
      155 +            youtube_refresh_token: tokens.refresh_token || null,
      156 +            youtube_token_expires_at: expiresAt,
      157 +            updated_at: new Date().toISOString(),
      158 +          }, {
      159 +            onConflict: 'user_id',
      160 +          });
      161 +
      162 +        if (upsertError) {
      163 +          console.error('Failed to save tokens:', upsertError);
      164 +          return new Response(
      165 +            JSON.stringify({ error: 'Failed to save authentication' }),
      166 +            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      167 +          );
      168 +        }
      169 +
      170 +        // Return HTML that closes the popup and notifies parent
      171 +        const html = `
      172 +          <!DOCTYPE html>
      173 +          <html>
      174 +            <head>
      175 +              <title>YouTube 연결 완료</title>
      176 +            </head>
      177 +            <body>
      178 +              <script>
      179 +                if (window.opener) {
      180 +                  window.opener.postMessage({ type: 'youtube-auth-success' }, '*');
      181 +                  window.close();
      182 +                } else {
      183 +                  document.body.innerHTML = '<h1>YouTube 계정이 연결되었습니다. 이 창을 닫아주세요.</h1>';
      184 +                }
      185 +              </script>
      186 +              <h1>YouTube 계정 연결 완료</h1>
      187 +              <p>이 창을 닫아주세요.</p>
      188 +            </body>
      189 +          </html>
      190 +        `;
      191 +
      192 +        return new Response(html, {
      193 +          headers: { ...corsHeaders, 'Content-Type': 'text/html' },
      194 +        });
      195 +      }
      196 +
      197 +      case 'refresh': {
      198 +        // Refresh access token
      199 +        const authHeader = req.headers.get('Authorization');
      200 +        if (!authHeader) {
      201 +          return new Response(
      202 +            JSON.stringify({ error: 'Authorization required' }),
      203 +            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      204 +          );
      205 +        }
      206 +
      207 +        const token = authHeader.replace('Bearer ', '');
      208 +        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      209 +
      210 +        if (userError || !user) {
      211 +          return new Response(
      212 +            JSON.stringify({ error: 'Invalid user token' }),
      213 +            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      214 +          );
      215 +        }
      216 +
      217 +        // Get current refresh token
      218 +        const { data: settings, error: settingsError } = await supabase
      219 +          .from('youtube_sync_settings')
      220 +          .select('youtube_refresh_token')
      221 +          .eq('user_id', user.id)
      222 +          .single();
      223 +
      224 +        if (settingsError || !settings?.youtube_refresh_token) {
      225 +          return new Response(
      226 +            JSON.stringify({ error: 'No refresh token available' }),
      227 +            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      228 +          );
      229 +        }
      230 +
      231 +        // Refresh the token
      232 +        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      233 +          method: 'POST',
      234 +          headers: {
      235 +            'Content-Type': 'application/x-www-form-urlencoded',
      236 +          },
      237 +          body: new URLSearchParams({
      238 +            refresh_token: settings.youtube_refresh_token,
      239 +            client_id: clientId,
      240 +            client_secret: clientSecret,
      241 +            grant_type: 'refresh_token',
      242 +          }),
      243 +        });
      244 +
      245 +        if (!tokenResponse.ok) {
      246 +          const errorText = await tokenResponse.text();
      247 +          console.error('Token refresh failed:', errorText);
      248 +          return new Response(
      249 +            JSON.stringify({ error: 'Failed to refresh token' }),
      250 +            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      251 +          );
      252 +        }
      253 +
      254 +        const tokens: TokenResponse = await tokenResponse.json();
      255 +        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      256 +
      257 +        // Update tokens in database
      258 +        const { error: updateError } = await supabase
      259 +          .from('youtube_sync_settings')
      260 +          .update({
      261 +            youtube_access_token: tokens.access_token,
      262 +            youtube_token_expires_at: expiresAt,
      263 +            updated_at: new Date().toISOString(),
      264 +          })
      265 +          .eq('user_id', user.id);
      266 +
      267 +        if (updateError) {
      268 +          console.error('Failed to update tokens:', updateError);
      269 +          return new Response(
      270 +            JSON.stringify({ error: 'Failed to save refreshed token' }),
      271 +            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      272 +          );
      273 +        }
      274 +
      275 +        return new Response(
      276 +          JSON.stringify({ success: true, expiresAt }),
      277 +          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      278 +        );
      279 +      }
      280 +
      281 +      case 'disconnect': {
      282 +        // Disconnect YouTube account
      283 +        const authHeader = req.headers.get('Authorization');
      284 +        if (!authHeader) {
      285 +          return new Response(
      286 +            JSON.stringify({ error: 'Authorization required' }),
      287 +            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      288 +          );
      289 +        }
      290 +
      291 +        const token = authHeader.replace('Bearer ', '');
      292 +        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      293 +
      294 +        if (userError || !user) {
      295 +          return new Response(
      296 +            JSON.stringify({ error: 'Invalid user token' }),
      297 +            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      298 +          );
      299 +        }
      300 +
      301 +        // Clear tokens from database
      302 +        const { error: updateError } = await supabase
      303 +          .from('youtube_sync_settings')
      304 +          .update({
      305 +            youtube_access_token: null,
      306 +            youtube_refresh_token: null,
      307 +            youtube_token_expires_at: null,
      308 +            updated_at: new Date().toISOString(),
      309 +          })
      310 +          .eq('user_id', user.id);
      311 +
      312 +        if (updateError) {
      313 +          console.error('Failed to disconnect:', updateError);
      314 +          return new Response(
      315 +            JSON.stringify({ error: 'Failed to disconnect YouTube account' }),
      316 +            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      317 +          );
      318 +        }
      319 +
      320 +        return new Response(
      321 +          JSON.stringify({ success: true }),
      322 +          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      323 +        );
      324 +      }
      325 +
      326 +      case 'status': {
      327 +        // Check connection status
      328 +        const authHeader = req.headers.get('Authorization');
      329 +        if (!authHeader) {
      330 +          return new Response(
      331 +            JSON.stringify({ error: 'Authorization required' }),
      332 +            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      333 +          );
      334 +        }
      335 +
      336 +        const token = authHeader.replace('Bearer ', '');
      337 +        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      338 +
      339 +        if (userError || !user) {
      340 +          return new Response(
      341 +            JSON.stringify({ error: 'Invalid user token' }),
      342 +            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      343 +          );
      344 +        }
      345 +
      346 +        const { data: settings } = await supabase
      347 +          .from('youtube_sync_settings')
      348 +          .select('youtube_access_token, youtube_token_expires_at, sync_interval, auto_sync_enabled')
      349 +          .eq('user_id', user.id)
      350 +          .single();
      351 +
      352 +        const isConnected = !!settings?.youtube_access_token;
      353 +        const isExpired = settings?.youtube_token_expires_at
      354 +          ? new Date(settings.youtube_token_expires_at) < new Date()
      355 +          : true;
      356 +
      357 +        return new Response(
      358 +          JSON.stringify({
      359 +            isConnected,
      360 +            isExpired: isConnected ? isExpired : null,
      361 +            expiresAt: settings?.youtube_token_expires_at || null,
      362 +            syncInterval: settings?.sync_interval || 'manual',
      363 +            autoSyncEnabled: settings?.auto_sync_enabled || false,
      364 +          }),
      365 +          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      366 +        );
      367 +      }
      368 +
      369 +      default:
      370 +        return new Response(
      371 +          JSON.stringify({ error: 'Invalid action. Use: auth-url, callback, refresh, disconnect, status' }),
      372 +          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      373 +        );
      374 +    }
      375 +  } catch (error: unknown) {
      376 +    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      377 +    console.error('YouTube auth error:', errorMessage);
      378 +    return new Response(
      379 +      JSON.stringify({ error: 'Internal server error' }),
      380 +      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      381 +    );
      382 +  }
      383 +}
      384 +
      385  console.log("Edge Functions main service loaded");
      386
      387  Deno.serve(async (req) => {
     ...
      396      });
      397    }
      398
       18 -  // Function router - add your functions here
       19 -  // Example: if (pathname.startsWith("/hello")) { return new Response("Hello!"); }
      399 +  // YouTube Auth function
      400 +  if (pathname === "/youtube-auth" || pathname.startsWith("/youtube-auth?")) {
      401 +    return handleYouTubeAuth(req);
      402 +  }
      403
      404    return new Response(JSON.stringify({
      405      error: "Function not found",

⏺ Edge Functions 컨테이너를 재시작합니다.

⏺ Bash(cd /Users/jeonhokim/cursor/superbase && docker compose -f docker-compose.dev.yml --env-file .env.dev restart functions &&
      sleep 5 && docker logs supabase-functi…)
  ⎿  Edge Functions main service loaded
     Edge Functions main service loaded
     Edge Functions main service loaded
     … +5 lines (ctrl+o to expand)
  ⎿  Shell cwd was reset to /Users/jeonhokim/cursor/sync-youtube-playlists

⏺ Bash(sleep 3 && docker logs supabase-functions-dev --tail 5 2>&1)
  ⎿  Edge Functions main service loaded
     shutdown signal received: 15
     Edge Functions main service loaded
     … +2 lines (ctrl+o to expand)

⏺ Bash(docker ps --format "table {{.Names}}\t{{.Status}}" | grep functions && curl -s
      "http://localhost:8000/functions/v1/youtube-auth?action=status" -H "apikey: eyJhb…)
  ⎿  supabase-functions-dev       Up 23 seconds (healthy)
     {
       "error": "YouTube OAuth is not configured"
     }

⏺ 함수가 작동하지만 환경변수가 전달되지 않았습니다. 컨테이너 환경변수를 확인합니다.

⏺ Bash(docker exec supabase-functions-dev printenv | grep -E "YOUTUBE|SUPABASE" | head -10)
  ⎿ SUPABASE_URL=http://kong:8000
    SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzY2MjI3MDk2LCJl
    eHAiOjE5MjM5MDcwOTZ9._PPvvvOcDKL3jmTJqVhstKC4g7fJg_EjjKDdQA43mSA
    … +3 lines (ctrl+o to expand)


⏺ 환경변수가 컨테이너에 전달되지 않았습니다. 컨테이너를 완전히 재생성해야 합니다.

⏺ Bash(cd /Users/jeonhokim/cursor/superbase && docker compose -f docker-compose.dev.yml --env-file .env.dev up -d functions && sleep
       5)
  ⎿   Container supabase-db-dev  Running
      Container supabase-analytics-dev  Running
      Container supabase-functions-dev  Recreate
     … +7 lines (ctrl+o to expand)
  ⎿  Shell cwd was reset to /Users/jeonhokim/cursor/sync-youtube-playlists





#
요구사항: 구글 계정 크레덴셜은 설정내에서 서브 화면을 만들어서 추가/삭제/수정 등 개인이 관리할 수 있도록 기능을 추가해줄래? 


#
 지금까지 진행된 사항에 대해 문서 및 각종 상태 업데이트 하고 전체 프로젝트 일관성을 유지할수 있도록 해줘. (구현을 위해 임시 
혹은 편의상 작성된 코드는 장기적으로 todo 에 개선사항으로 반드시 등록해야해. ) 



##
⏺ 서버 실행 경로

  | 서버     | Entry Point       | 명령어                      |
  |----------|-------------------|-----------------------------|
  | Backend  | src/api/server.ts | npm run api:dev (tsx watch) |
  | Frontend | frontend/ (Vite)  | npm run dev:frontend        |

  상세 경로

  sync-youtube-playlists/
  ├── src/api/server.ts          ← Backend (Fastify, 포트 3000)
  └── frontend/                   ← Frontend (Vite, 포트 5173)
      └── vite.config.ts

  Backend 구조 (src/api/)

  - server.ts - Fastify 서버 설정
  - routes/ - auth, playlists, videos, notes, analytics, sync, quota
  - plugins/auth.ts - 인증 플러그인



## 확인해 보니, docker, npm run dev 가 각 808/ 8081 로 띄워지고 있었음. (하나로 통일)
     목표

     Frontend 포트를 8081로 통일 (Docker / npm run dev 둘 중 하나만 실행)

     수정 대상 파일

     1. Vite 개발 서버

     | 파일                       | 변경                    |
     |----------------------------|-------------------------|
     | frontend/vite.config.ts:14 | port: 8080 → port: 8081 |

     2. Docker 설정

     | 파일                     | 변경                                                                                
     |
     |--------------------------|-------------------------------------------------------------------------------------
     |
     | frontend/Dockerfile      | NGINX_PORT=8080 → 8081, EXPOSE 8080 → 8081, healthcheck URL                         
     |
     | docker-compose.yml       | ${FRONTEND_PORT:-8080}:8080 → ${FRONTEND_PORT:-8081}:8081, CORS_ORIGIN, healthcheck 
     |
     | docker-compose.local.yml | 동일하게 8081로 변경                                                                
     |

     3. 환경 변수

     | 파일              | 변경                                                      |
     |-------------------|-----------------------------------------------------------|
     | .env.docker.local | FRONTEND_PORT=8081, CORS_ORIGIN=http://localhost:8081,... |

     실행 순서

     1. frontend/vite.config.ts 수정
     2. frontend/Dockerfile 수정
     3. docker-compose.yml 수정
     4. docker-compose.local.yml 수정
     5. .env.docker.local 수정
     6. 서버 재시작하여 확인

     ## 결과:
     ⏺ 완료

  Frontend 포트 8081 통일 완료

  | 파일                        | 변경                         |
  |-----------------------------|------------------------------|
  | ✅ frontend/vite.config.ts  | port: 8081                   |
  | ✅ frontend/Dockerfile      | NGINX_PORT=8081, EXPOSE 8081 |
  | ✅ docker-compose.yml       | 8081:8081, CORS              |
  | ✅ docker-compose.local.yml | 8081:8081, CORS              |
  | ✅ .env.docker.local        | FRONTEND_PORT=8081           |

  현재 상태

  Frontend (npm run dev): http://localhost:8081 ✅ 실행 중
  Backend: ❌ 미실행 (포트 3000 Docker 점유)

  이제 npm run dev든 Docker든 항상 8081 포트로 실행됩니다.

#

> 추가로 .md, rss feed, 그리고 어뎁터는 계속 늘어날 수 있는 구조이어야 해. 

⏺ 네, 확장 가능한 플러그인 기반 어댑터 시스템을 설계하겠습니다.

  확장 가능한 Adapter Architecture

  핵심 설계 원칙

  ┌─────────────────────────────────────────────────────────────────┐
  │                      Adapter Registry                           │
  │  ┌─────────┬─────────┬─────────┬─────────┬─────────┬────────┐  │
  │  │YouTube  │ Notion  │ Drive   │ RSS     │ File    │  ...   │  │
  │  │Adapter  │ Adapter │ Adapter │ Adapter │ Adapter │ (new)  │  │
  │  └────┬────┴────┬────┴────┬────┴────┬────┴────┬────┴────────┘  │
  │       │         │         │         │         │                 │
  │  ┌────▼─────────▼─────────▼─────────▼─────────▼────┐           │
  │  │            Base Adapter Interface               │           │
  │  │  - authenticate() - sync() - parse() - etc.     │           │
  │  └─────────────────────────────────────────────────┘           │
  └─────────────────────────────────────────────────────────────────┘

  1. Adapter 분류 체계

  | Category       | Adapters                                | Auth Type    | 특징           |
  |----------------|-----------------------------------------|--------------|----------------|
  | OAuth Services | YouTube, Google Drive, Notion, LinkedIn | OAuth 2.0    | 토큰 갱신 필요 |
  | API Services   | RSS Feed                                | None/API Key | 공개 데이터    |
  | File Parsers   | PDF, DOCX, PPTX, MD, TXT                | None         | 로컬 파싱      |
  | Future         | Slack, Twitter, Pocket, Instapaper...   | Various      | 확장 예정      |

  2. 디렉토리 구조

  src/
  ├── adapters/
  │   ├── core/
  │   │   ├── adapter.interface.ts      # 기본 인터페이스
  │   │   ├── adapter.registry.ts       # 어댑터 자동 등록
  │   │   ├── adapter.factory.ts        # 어댑터 생성
  │   │   └── types/
  │   │       ├── auth.types.ts
  │   │       ├── content.types.ts
  │   │       └── sync.types.ts
  │   │
  │   ├── oauth/                        # OAuth 기반 서비스
  │   │   ├── base.oauth.adapter.ts     # OAuth 공통 로직
  │   │   ├── youtube/
  │   │   │   ├── youtube.adapter.ts
  │   │   │   ├── youtube.parser.ts
  │   │   │   └── index.ts
  │   │   ├── notion/
  │   │   ├── google-drive/
  │   │   └── linkedin/
  │   │
  │   ├── feed/                         # 피드 기반 서비스
  │   │   ├── base.feed.adapter.ts
  │   │   └── rss/
  │   │       ├── rss.adapter.ts
  │   │       ├── rss.parser.ts
  │   │       └── index.ts
  │   │
  │   └── file/                         # 파일 파서
  │       ├── base.file.adapter.ts
  │       ├── pdf/
  │       ├── docx/
  │       ├── pptx/
  │       ├── markdown/
  │       └── txt/

  3. Core Interfaces

  // adapters/core/adapter.interface.ts

  export interface AdapterMetadata {
    id: string;                    // 'youtube', 'notion', 'rss', 'pdf'
    name: string;                  // 'YouTube'
    description: string;
    icon: string;                  // URL or icon name
    category: 'oauth' | 'feed' | 'file';
    authType: 'oauth2' | 'api_key' | 'none';
    supportedContentTypes: ContentType[];
    configSchema: JSONSchema;      // 설정 UI 자동 생성용
  }

  export interface IAdapter {
    readonly metadata: AdapterMetadata;

    // Lifecycle
    initialize(config: AdapterConfig): Promise<void>;
    dispose(): Promise<void>;

    // Validation
    validateConfig(config: unknown): ValidationResult;
    testConnection(credentials: Credentials): Promise<ConnectionTestResult>;
  }

  export interface IOAuthAdapter extends IAdapter {
    getAuthUrl(state: string): string;
    handleCallback(code: string): Promise<TokenSet>;
    refreshTokens(refreshToken: string): Promise<TokenSet>;
  }

  export interface ISyncAdapter extends IAdapter {
    sync(options: SyncOptions): AsyncGenerator<SyncProgress, SyncResult>;
    fetchItem(itemId: string): Promise<ContentItem>;
    listItems(cursor?: string): Promise<PaginatedList<ContentItem>>;
  }

  export interface IFileAdapter extends IAdapter {
    supportedExtensions: string[];
    parseFile(file: Buffer, filename: string): Promise<ParsedContent>;
    extractMetadata(file: Buffer): Promise<FileMetadata>;
  }

  4. 자동 등록 시스템

  // adapters/core/adapter.registry.ts

  class AdapterRegistry {
    private static adapters = new Map<string, AdapterConstructor>();

    // 데코레이터를 통한 자동 등록
    static register(metadata: AdapterMetadata) {
      return (constructor: AdapterConstructor) => {
        this.adapters.set(metadata.id, constructor);
        console.log(`✅ Adapter registered: ${metadata.id}`);
        return constructor;
      };
    }

    static get(id: string): AdapterConstructor | undefined {
      return this.adapters.get(id);
    }

    static getAll(): AdapterMetadata[] {
      return Array.from(this.adapters.values())
        .map(ctor => new ctor().metadata);
    }

    static getByCategory(category: string): AdapterMetadata[] {
      return this.getAll().filter(m => m.category === category);
    }
  }

  // 사용 예시 - 새 어댑터 추가 시
  @AdapterRegistry.register({
    id: 'rss',
    name: 'RSS Feed',
    category: 'feed',
    authType: 'none',
    // ...
  })
  export class RssAdapter extends BaseFeedAdapter {
    // 구현
  }

  5. 새 어댑터 추가 예시

  RSS Adapter 추가:

  // adapters/feed/rss/rss.adapter.ts

  import { AdapterRegistry, BaseFeedAdapter } from '../../core';
  import Parser from 'rss-parser';

  @AdapterRegistry.register({
    id: 'rss',
    name: 'RSS Feed',
    description: 'Subscribe to RSS/Atom feeds',
    icon: 'rss',
    category: 'feed',
    authType: 'none',
    supportedContentTypes: ['article', 'podcast'],
    configSchema: {
      type: 'object',
      properties: {
        feedUrl: { type: 'string', format: 'uri' },
        refreshInterval: { type: 'number', default: 3600 }
      },
      required: ['feedUrl']
    }
  })
  export class RssAdapter extends BaseFeedAdapter implements ISyncAdapter {
    private parser = new Parser();

    async *sync(options: SyncOptions): AsyncGenerator<SyncProgress, SyncResult> {
      const feed = await this.parser.parseURL(options.config.feedUrl);

      for (const [index, item] of feed.items.entries()) {
        yield { current: index + 1, total: feed.items.length, item: item.title };

        await this.saveItem({
          sourceId: item.guid || item.link,
          title: item.title,
          content: item.content || item.contentSnippet,
          url: item.link,
          publishedAt: new Date(item.pubDate),
          metadata: { author: item.creator, categories: item.categories }
        });
      }

      return { itemsProcessed: feed.items.length, status: 'completed' };
    }
  }

  Markdown Adapter 추가:

  // adapters/file/markdown/markdown.adapter.ts

  @AdapterRegistry.register({
    id: 'markdown',
    name: 'Markdown',
    description: 'Parse Markdown files',
    icon: 'file-text',
    category: 'file',
    authType: 'none',
    supportedContentTypes: ['document'],
    configSchema: {}
  })
  export class MarkdownAdapter extends BaseFileAdapter implements IFileAdapter {
    supportedExtensions = ['.md', '.markdown', '.mdx'];

    async parseFile(file: Buffer, filename: string): Promise<ParsedContent> {
      const content = file.toString('utf-8');
      const { data: frontmatter, content: body } = matter(content);
      const html = marked.parse(body);

      return {
        title: frontmatter.title || this.extractTitle(body),
        content: body,
        html,
        metadata: frontmatter,
        headings: this.extractHeadings(body),
        links: this.extractLinks(body)
      };
    }
  }

  6. Frontend 연동 설정 UI 자동 생성

  // API: GET /api/adapters
  // Response:
  {
    "adapters": [
      {
        "id": "youtube",
        "name": "YouTube",
        "icon": "youtube",
        "category": "oauth",
        "authType": "oauth2",
        "configSchema": { /* JSON Schema */ }
      },
      {
        "id": "rss",
        "name": "RSS Feed",
        "icon": "rss",
        "category": "feed",
        "authType": "none",
        "configSchema": {
          "properties": {
            "feedUrl": { "type": "string", "format": "uri", "title": "Feed URL" }
          }
        }
      },
      // ... 등록된 모든 어댑터
    ]
  }

  Frontend에서 configSchema를 기반으로 설정 폼 자동 생성:

  // frontend: 동적 설정 폼
  <IntegrationSettings
    adapter={selectedAdapter}
    schema={adapter.configSchema}  // JSON Schema → Form 자동 생성
    onSave={handleSave}
  />

  7. 확장 로드맵

  Phase 1 (Current)     Phase 2              Phase 3
  ─────────────────     ─────────────────    ─────────────────
  ✅ YouTube            📋 Notion            📋 Slack
  ✅ Google Drive       📋 LinkedIn          📋 Twitter/X
  📋 RSS Feed           📋 Pocket            📋 Instapaper
  📋 PDF                📋 Evernote          📋 Raindrop
  📋 Markdown           📋 Obsidian Export   📋 Readwise
  📋 DOCX/PPTX/TXT      📋 Kindle Highlights 📋 Custom Webhook

  요약

  | 특징                  | 설명                                     |
  |-----------------------|------------------------------------------|
  | 데코레이터 기반 등록  | @AdapterRegistry.register() 로 자동 등록 |
  | JSON Schema 설정      | Frontend 폼 자동 생성                    |
  | 카테고리별 Base Class | OAuth, Feed, File 공통 로직 재사용       |
  | 플러그인 구조         | 새 어댑터 = 새 폴더 + 인터페이스 구현    |
  | Zero Core Changes     | 코어 수정 없이 어댑터 추가 가능          |

  이 구조로 진행할까요? Plan mode에서 구체적인 마이그레이션 및 구현 계획을 수립할 수 있습니다.

> 좋습니다. 추가로 adapter-dev.md(subagent) 가 본 내용을 일임해서 개발할수 있도록 해주세요. 매인 Agent 는 전체 개발 
관리를 하고 어뎁터 개발은 adapter-dev 가 하도록 해 주세요. (개발에 필요한 자원들은 미리 준비해 주세요 (mcps, skills, 
hooks, commands, scripts, etc)) 



#
 이제, frontend 의 통합 테스트를 진행해. 그리고 그 결과를 가지고 이후 개발 내용을 정리해. 단, 테스트 케이스는 상용 
서비스 론칭 수준 이상으로 준비되어야 해.

##
Current Test Status Summary

  | Metric     | Current | Target | Status     |
  |------------|---------|--------|------------|
  | Statements | 77.2%   | 80%    | ❌ -2.8%   |
  | Branches   | 64.41%  | 75%    | ❌ -10.59% |
  | Functions  | 84.5%   | 80%    | ✅         |
  | Lines      | 77.8%   | 80%    | ❌ -2.2%   |

  Tests Passing: 285 tests (11 files) including the just-fixed VideoPlayerModal (36 tests)

  Critical Gaps:
  - FloatingScratchPad (1,157 LOC) - No tests
  - CardList, InsightCardItem, MandalaGrid - No tests
  - useDragSelect hook - No tests
  - E2E flows - Structure exists but minimal coverage

  # 테스트 계획
  iridescent-singing-coral.md

  