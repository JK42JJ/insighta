# LLM Benchmark Results

**Date**: 2026-03-19
**Purpose**: Select optimal cloud LLM for Insighta card summarization (EC2 has no GPU)

## Models Tested

| Model | Input $/M | Output $/M |
|-------|-----------|------------|
| Qwen3 8B (qwen/qwen3-8b) | $0.05 | $0.15 |
| Qwen3 30B MoE (qwen/qwen3-30b-a3b) | $0.07 | $0.12 |
| Mistral Small 3.1 (mistralai/mistral-small-3.1-24b-instruct) | $0.1 | $0.3 |
| Gemini Flash 1.5 (google/gemini-flash-1.5) | $0.075 | $0.3 |
| Llama 4 Scout (meta-llama/llama-4-scout) | $0.15 | $0.4 |

## Summary Table

| Model | JSON % | Avg Latency | Total In | Total Out | Est $/card | Errors |
|-------|--------|-------------|----------|-----------|------------|--------|
| Qwen3 8B | 100% | 468ms | 962 | 5644 | $0.000358 | 0 |
| Qwen3 30B MoE | 100% | 525ms | 968 | 4083 | $0.000223 | 0 |
| Mistral Small 3.1 | 100% | 1984ms | 864 | 735 | $0.000123 | 0 |
| Gemini Flash 1.5 | 0% | 0ms | 0 | 0 | $0.000000 | 10 |
| Llama 4 Scout | 100% | 293ms | 861 | 831 | $0.000185 | 0 |

## Detailed Outputs

### Qwen3 8B

**Summary EN (short)** [1267ms, JSON: PASS]

```
{"summary": "This video explains React Server Components, which render on the server to reduce client-side JavaScript bundles. Unlike traditional SSR, they don't hydrate on the client and can directly access databases/filesystems, making them ideal for data-heavy pages with minimal interactivity.", "tags": ["React Server Components", "Server-Side Rendering", "JavaScript Bundles", "Hydration", "Data-Heavy Pages", "Performance Optimization", "React", "Web Development", "Frontend", "Backend Integration"]}
```

**Summary KO (short)** [285ms, JSON: PASS]

```
{"summary": "이 영상은 시간 관리의 핵심인 우선순위 설정 방법을 소개하며, 아이젠하워 매트릭스와 포모도로 기법을 활용한 집중력 향상 전략을 설명합니다. 멀티태스킹 대신 하나의 작업에 집중하는 것이 생산성을 높인다고 강조합니다.", "tags": ["시간 관리", "아이젠하워 매트릭스", "포모도로 기법", "생산성", "집중력", "우선순위", "멀티태스킹", "효율성", "작업 습관", "작업 관리"]}
```

**Chunk EN #1** [298ms, JSON: N/A]

```
TypeScript generics enable reusable components that can handle multiple types through type parameters specified in angle brackets.
```

**Chunk EN #2** [214ms, JSON: N/A]

```
Generic classes and mapped types enable advanced transformations, with utility types like Partial and Pick relying on generics internally.
```

**Chunk KO #1** [261ms, JSON: N/A]

```
2026년 한국 경제는 수출 회복과 내수 부진이 공존하며, 반도체 산업이 AI 수요로 수출 성장을 견인하고 있다.
```

**Chunk KO #2** [606ms, JSON: N/A]

```
The stock market is witnessing heightened interest in AI-related stocks and the bio sector, alongside growing popularity of ETFs for global diversification.
```

**Merge EN** [346ms, JSON: PASS]

```
{
  "summary": "TypeScript generics enable reusable components with type parameters, allowing flexible type handling across different data types. They use constraints like 'extends' to narrow types, ensuring type safety, and support advanced features like mapped types and utility types (e.g., Partial, Pick). These generics are crucial for building type-safe applications and underpin libraries such as React, Express, and Prisma.",
  "tags": ["TypeScript Generics", "Type Safety"]
}
```

**Merge KO** [307ms, JSON: PASS]

```
{
  "summary": "2026년 한국 경제는 수출 회복과 내수 부진이 공존하며, 반도체 산업의 AI 수요로 수출 성장이 이어지고 있습니다. 고금리로 인한 소비 위축과 부동산 시장 조정이 내수 회복을 지연시키고 있으며, 주식 시장에서는 AI 관련주와 바이오 섹터가 주목받고 있습니다. 전문가들은 기술 혁신과 고령화에 따른 노동력 감소가 경제의 방향을 결정할 것으로 전망합니다.",
  "tags": ["AI", "High Interest Rates"]
}
```

**Translate EN→KO** [800ms, JSON: N/A]

```
리액트 서버 컴포넌트는 서버에서 렌더링을 가능하게 해 클라이언트 측 자바스크립트를 줄여줍니다. 이들은 수동화되지 않으며 직접 데이터베이스에 접근할 수 있습니다.
```

**Translate KO→EN** [293ms, JSON: N/A]

```
The key to time management is setting priorities. The Pomodoro Technique enhances concentration by repeating 25 minutes of focused work followed by 5 minutes of rest.
```

### Qwen3 30B MoE

**Summary EN (short)** [574ms, JSON: PASS]

```
{"summary": "The video explains React Server Components, a feature that enables server-side rendering of components, reducing client-side JavaScript load. It highlights their ability to access databases and file systems directly without hydrating on the client, making them suitable for data-heavy, minimally interactive pages.", "tags": ["React Server Components", "server-side rendering", "JavaScript optimization", "database access", "web development", "React framework", "performance tuning", "data-heavy apps", "server components", "client-side hydration"]}
```

**Summary KO (short)** [611ms, JSON: PASS]

```
{"summary": "이 영상은 효과적인 시간 관리 방법을 설명합니다. 아이젠하워 매트릭스를 활용한 우선순위 설정, 포모도로 기법을 통한 집중력 향상, 그리고 멀티태스킹 대신 단일 작업에 집중하는 전략을 다룹니다.", "tags": ["시간 관리", "아이젠하워 매트릭스", "포모도로 기법", "생산성", "업무 우선순위", "집중력", "작업 효율성", "시간 관리 팁", "프로덕티브", "집중력 향상"]}
```

**Chunk EN #1** [290ms, JSON: N/A]

```
TypeScript generics enable reusable components that handle various types using type parameters enclosed in angle brackets.
```

**Chunk EN #2** [285ms, JSON: N/A]

```
Generic classes and mapped types enable advanced type transformations, with utility types like Partial and Pick relying on generics internally.
```

**Chunk KO #1** [338ms, JSON: N/A]

```
2026년 한국 경제는 수출 회복과 내수 부진이 공존하며, 반도체 산업이 AI 수요로 인해 수출 성장을 주도하고 있다.
```

**Chunk KO #2** [1015ms, JSON: N/A]

```
주식 시장에서 AI 및 바이오 섹터가 주목받고 있으며, ETF를 통한 글로벌 분산 투자가 인기를 끌고 있습니다.
```

**Merge EN** [254ms, JSON: PASS]

```
{
  "summary": "TypeScript generics enable reusable, type-safe components by using type parameters in angle brackets. They allow constraints with 'extends' to limit types (e.g., requiring a 'length' property) and support advanced patterns like generic classes, mapped types, and utility types (e.g., Partial, Pick). Mastering generics is critical for building robust libraries and applications in TypeScript.",
  "tags": ["TypeScript", "Generics", "Type Parameters", "Constraints", "Utility Types", "Type Safety"]
}
```

**Merge KO** [790ms, JSON: PASS]

```
{"summary":"2026년 한국 경제는 반도체 산업의 AI 수요에 따른 수출 회복과 고금리로 인한 내수 부진이 공존하며, 주식 시장에서는 AI 및 바이오 섹터와 ETF를 통한 글로벌 분산 투자가 주목받고 있다. 전문가들은 기술 혁신과 고령화로 인한 노동력 감소가 경제 전망에 결정적 영향을 미칠 것으로 전망한다.","tags":["한국 경제","AI 수요","고금리","주식 시장","ETF 투자","기술 혁신","고령화"]}
```

**Translate EN→KO** [365ms, JSON: N/A]

```
리액트 서버 컴포넌트는 서버에서 렌더링을 가능하게 하여 클라이언트 자바스크립트를
```

**Translate KO→EN** [725ms, JSON: N/A]

```
The key to time management is setting priorities. The Pomodoro Technique enhances focus by repeating 25 minutes of work followed by 5 minutes of rest.
```

### Mistral Small 3.1

**Summary EN (short)** [4556ms, JSON: PASS]

```
```json
{
  "summary": "The video explains React Server Components, which render components on the server to reduce the JavaScript bundle sent to the client. Unlike traditional server-side rendering, these components do not hydrate on the client side and can directly access databases and file systems, making them suitable for data-heavy, minimally interactive pages.",
  "tags": ["React Server Components", "Server-Side Rendering", "JavaScript Bundle", "Client-Side Hydration", "Database Access", "File System Access", "Data-Heavy Pages", "Minimal Interactivity", "Web Development", "React Framework"]
}
```
```

**Summary KO (short)** [10020ms, JSON: PASS]

```
```json
{
  "summary": "이 비디오는 아이젠하워 매트릭스와 포모도로 기법을 활용한 시간 관리 방법에 대해 설명하며, 멀티태스킹 대신 하나의 작업에 집중하는 것이 생산성을 높이는 방법에 대해 다룹니다.",
  "tags": ["시간 관리", "아이젠하워 매트릭스", "포모도로 기법", "우선순위 정하기", "집중력", "생산성", "멀티태스킹", "효과적인 시간 관리"]
}
```
```

**Chunk EN #1** [383ms, JSON: N/A]

```
TypeScript generics allow for the creation of reusable components that can work with multiple types by using type parameters enclosed in angle brackets.
```

**Chunk EN #2** [135ms, JSON: N/A]

```
Generic classes and mapped types facilitate complex data transformations, while utility types such as `Partial` and `Pick` leverage generics to modify type structures.
```

**Chunk KO #1** [540ms, JSON: N/A]

```
2026년 한국 경제는 반도체 산업의 AI 수요로 인한 수출 회복과 내수 부진이 동시에 나타날 것으로 예상됩니다.
```

**Chunk KO #2** [653ms, JSON: N/A]

```
주식 시장에서 AI 관련주와 바이오 섹터가 주목받고 있으며, 글로벌 분산 투자를 위한 ETF가 인기를 끌고 있습니다.
```

**Merge EN** [141ms, JSON: PASS]

```
Here is the combined summary in JSON format:

```json
{
  "summary": "TypeScript generics allow for the creation of reusable components that can work with multiple types using type parameters. They are essential for type safety and are used extensively in libraries like React, Express, and Prisma, with features like generic constraints, classes, and mapped types enabling advanced type transformations.",
  "tags": ["TypeScript", "Generics", "Type Safety", "Reusable Components", "Type Parameters"]
}
```
```

**Merge KO** [2142ms, JSON: PASS]

```
```json
{
  "summary": "한국 경제는 2026년 반도체 산업의 AI 수요로 수출이 회복되지만, 고금리 장기화로 인해 내수 회복이 지연되고 있습니다. 주식 시장은 AI 관련주와 바이오 섹터가 주목받고 있으며, 기술 혁신과 고령화에 따른 노동력 감소가 경제의 방향을 결정할 것으로 예상됩니다.",
  "tags": ["한국 경제 전망", "반도체 산업", "AI 수요", "고금리", "내수 회복", "주식 시장", "AI 관련주", "바이오 섹터", "기술 혁신", "고령화"]
}
```
```

**Translate EN→KO** [737ms, JSON: N/A]

```
React 서버 컴포넌트는 서버에서 렌더링을 허용하여 클라이언트 측 JavaScript를 줄입니다. 이들은 하이드레이션을 하지 않으며, 데이터베이스에 직접 접근할 수 있습니다.
```

**Translate KO→EN** [529ms, JSON: N/A]

```
The core of time management is setting priorities. The Pomodoro Technique involves repeating cycles of 25 minutes of focused work followed by a 5-minute break to enhance concentration.
```

### Gemini Flash 1.5

**Summary EN (short)** [21ms, JSON: FAIL]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

**Summary KO (short)** [16ms, JSON: FAIL]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

**Chunk EN #1** [16ms, JSON: N/A]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

**Chunk EN #2** [15ms, JSON: N/A]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

**Chunk KO #1** [15ms, JSON: N/A]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

**Chunk KO #2** [15ms, JSON: N/A]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

**Merge EN** [17ms, JSON: FAIL]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

**Merge KO** [14ms, JSON: FAIL]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

**Translate EN→KO** [14ms, JSON: N/A]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

**Translate KO→EN** [15ms, JSON: N/A]

> ERROR: HTTP 404: {"error":{"message":"No endpoints found for google/gemini-flash-1.5.","code":404},"user_id":"user_3B9zdoCeuQPtc6PSqBHJVX2wU2r"}

### Llama 4 Scout

**Summary EN (short)** [217ms, JSON: PASS]

```
Here is the response:

```
{
  "summary": "This video explains React Server Components, a feature that enables rendering components on the server, reducing client-side JavaScript bundle size. Server components can access databases and file systems directly, making them suitable for data-heavy pages with minimal interactivity. They differ from traditional Server-Side Rendering (SSR) in that they don't hydrate on the client side.",
  "tags": [
    "React Server Components",
    "Server-Side Rendering",
    "React",
    "JavaScript",
    "Server Components",
    "Data-Heavy Pages",
    "Interactivity",
    "Web Development",
    "Frontend Development"
  ]
}
```
```

**Summary KO (short)** [267ms, JSON: PASS]

```
Here is the response:

```
{
  "summary": "이 영상은 효과적인 시간 관리 방법에 대해 설명합니다. 시간 관리의 핵심은 우선순위를 정하고 집중력을 높이는 것이며, 아이젠하워 매트릭스와 포모도로 기법 같은 방법을 소개합니다.",
  "tags": ["시간 관리", "우선순위", "아이젠하워 매트릭스", "포모도로 기법", "집중력", "생산성", "멀티태스킹"]
}
```
```

**Chunk EN #1** [219ms, JSON: N/A]

```
**TypeScript generics enable reusable code components that work with multiple types, specified using type parameters in angle brackets.**
```

**Chunk EN #2** [279ms, JSON: N/A]

```
Generic classes and mapped types, which utilize generics internally, facilitate advanced transformations in TypeScript, as seen in utility types such as Partial and Pick.
```

**Chunk KO #1** [238ms, JSON: N/A]

```
2026년 한국 경제는 반도체 산업의 수출 성장으로 수출이 회복세를 보이지만, 내수 부진은 지속될 것으로 예상됩니다.
```

**Chunk KO #2** [416ms, JSON: N/A]

```
The stock market is seeing a surge in AI-related stocks and the bio sector, with global diversified investments through ETFs gaining popularity.
```

**Merge EN** [409ms, JSON: PASS]

```
Here is a JSON object summarizing the video on TypeScript Generics:

```json
{
  "summary": "TypeScript generics enable reusable components with multiple types using type parameters. They provide type safety with constraints and are used in utility types and libraries like React and Express. Understanding generics is essential for type-safe TypeScript development.",
  "tags": ["TypeScript", "Generics", "TypeSafety"]
}
```
```

**Merge KO** [432ms, JSON: PASS]

```
Here is the combined JSON:

```
{
  "summary": "2026년 한국 경제는 수출 회복과 내수 부진이 공존할 것으로 전망됩니다. 반도체 산업이 AI 수요로 수출 성장을 견인하며, 고금리 장기화로 소비 위축과 부동산 시장 조정이 내수 회복을 지연시키고 있습니다. 주식 시장에서는 AI 관련주와 바이오 섹터가 주목받고 있습니다.",
  "tags": ["한국 경제", "수출 회복", "내수 부진", "반도체 산업", "AI 수요", "고금리", "주식 시장", "AI 관련주", "바이오 섹터"]
}
```

Let me know if you'd like me to adjust anything! 

Alternatively, here is another version with a slightly shorter summary:

```
{
  "summary": "2026년 한국 경제는 수출 회복과 내수 부진이 공존할 것으로 전망됩니다. 반도체 산업이 AI 수요로 수출 성장을 견인하지만, 고금리 장기화로 내수 회복이 지연되고 있습니다.",
  "tags": ["한국 경제", "수출 회복", "내수 부진", "반도체 산업", "AI 수요", "고금리"]
}
```
```

**Translate EN→KO** [215ms, JSON: N/A]

```
Here is the translation:

React Server Components는 서버에서 렌더링을 허용하여 클라이언트측 JavaScript를 줄여줍니다. 이들은 절대로 하이드레이트되지 않으며 데이터베이스에 직접 접근할 수 있습니다. 

Or, in a slightly more polished tone:

React Server Components를 사용하면 서버에서 렌더링이 가능해 클라이언트측 JavaScript를 줄일 수 있습니다. 또한, 이들은 하이드레이트되지 않으며 데이터베이스에 직접 접근할 수 있습니다.
```

**Translate KO→EN** [242ms, JSON: N/A]

```
The key to time management is prioritization. The Pomodoro Technique enhances focus by working in 25-minute concentrated intervals, followed by a 5-minute break. This method helps maintain productivity through structured work and rest periods.
```


## Scoring Guide (Manual Evaluation)

| # | Metric | Weight | Notes |
|---|--------|--------|-------|
| 1 | JSON Compliance | 25 | Auto-scored above |
| 2 | Summary Quality | 25 | Information coverage, conciseness, naturalness (1-5 scale) |
| 3 | Translation Quality | 20 | Meaning preservation, grammar, naturalness (1-5 scale) |
| 4 | Tag Relevance | 10 | Count (5-10), topic fit, specificity (1-5 scale) |
| 5 | Latency | 10 | Auto-scored above |
| 6 | Cost Efficiency | 10 | Auto-scored above |

## Final Scores (fill after manual review)

| Model | JSON /25 | Summary /25 | Translate /20 | Tags /10 | Latency /10 | Cost /10 | Total /100 |
|-------|----------|-------------|---------------|----------|-------------|----------|------------|
| Qwen3 8B | | | | | | | |
| Qwen3 30B MoE | | | | | | | |
| Mistral Small 3.1 | | | | | | | |
| Gemini Flash 1.5 | | | | | | | |
| Llama 4 Scout | | | | | | | |
