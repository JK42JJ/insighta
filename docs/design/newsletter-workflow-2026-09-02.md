# The brief pipeline, and what makes it checkable

2026-09-02. Supersedes nothing — this is the first version that describes a
process a second person can audit.

## Why this exists

Issue 1 shipped and cannot be verified. Not partly: the five videos it
recommends carry no ids, the seven sources it cites carry no URLs, and the
funnel it prints ("2,714 harvested, 1,042 reviewed") cites Insighta's own count
against a harvest whose result was never stored. The project's own record for
the day says the rest plainly — *"외부 수치를 검색 없이 생성. §12 위반. 사후
검증에서 2건 오류"*: external figures were produced without looking them up, and
post-hoc checking found two wrong.

Five more were caught before publication and are listed in
`src/modules/newsletter/issues/README.md`. Those five were caught by a person
reading carefully. That is not a process.

So the requirement is not "write a better issue". It is: **make an issue that
someone else can check, and make the parts that cannot be checked impossible to
print.**

## The rule the pipeline is built on

> A stage that ends without a ledger row did not happen.
> A number that cannot be read back out of the ledger does not go on the page.

`newsletter_pipeline_runs` and `newsletter_pipeline_steps` hold that. The
ledger refuses arithmetic it cannot justify — a stage whose drop reasons do not
account for every dropped item throws rather than warns, because a ledger that
accepts unexplained numbers is worse than none: it looks like evidence.

## The eight stages

| | Stage | What it does | Machine or person |
|---|---|---|---|
| S0 | harvest | Trusted channels first, then search | machine |
| S1 | format | Shorts, under four minutes, duplicates | machine, no model |
| S2 | domain | Topic boundary, applied at intake | machine |
| S3 | judge | safe · learnable · practitioner-relevant | model |
| S4 | deep | Transcript to summary for survivors | model, the expensive one |
| S5 | cross | One channel is a claim; independent channels are an event | machine + person |
| S6 | stats | The shape of what was dropped — which is itself the article | machine |
| S7 | draft | A person writes. The machine hands over evidence, not prose | person |

### S0 — harvest, in two layers

```
layer 1   trusted channels    playlistItems.list    1 unit each
layer 2   the topic's queries  search.list        100 units each
```

Layer 1 guarantees the channels an editor decided matter are never missed
because a query happened not to match them. Layer 2 finds channels nobody has
decided about yet. A channel that keeps surfacing in layer 2 gets promoted to
layer 1 by hand, so the list grows from evidence rather than from memory.

Trust decides what enters the corpus. It does not exempt anything from S1–S5.

### S2 — the boundary is written down

`ai-tech` is not "AI and technology". The master spec (§23) lists **AI** and
**개발** as separate briefs, and the code's `CATEGORY_KEYS` matches. So this
brief is the change in AI itself — models, pricing, agents, inference, the
tooling around them — and general programming belongs to `dev`.

`videoCategoryId 28` (Science & Technology) only. Category 27 (Education) is
excluded: it is where lecture courses, language study and exam prep live, and
issue 1's own funnel records dropping stock and property videos that got in
through it. Blocking at intake beats filtering after.

### S5 — the rule that survived issue 1

> A claim that appears on fewer than three independent channels is not written
> as fact. It is written as "this is circulating", or it is dropped.

Issue 1 applied this by hand to the Furiosa story and was right to. It is a
rule here so the next editor does not have to rediscover it.

## The gates before anything is published

These are conditions, not advice. An issue that fails one does not go out.

**Every recommended video has an id, and the id resolves.** `videoId` present,
`videos.list` returns it, and the title, channel and view count printed on the
page come from that response — not from what the draft said they were. Issue 1
recommended five videos with zero ids.

**Every graded claim has a source with a URL.** `findUngroundedClaims` already
refuses a grade with no reference. It does not check that the reference has a
URL, or that the reference is about the claim — issue 1 has a `확인` badge on
Anthropic's pricing citing DeepSeek's price table. Both become gates:

```
ref.url            required when any claim citing it is graded
ref ↔ claim        the source must be about the thing it is cited for
```

**No figure without a source.** If a number cannot be traced to a first-party
page or the ledger, the sentence containing it is cut. Not softened, not
hedged — cut. This is the rule issue 1 broke.

**The funnel comes from the ledger.** The counts printed on the page are read
from `newsletter_pipeline_steps`, never typed.

## Where a person is required

Three places, and they are not review-by-glance:

1. **S5 → S7** — deciding what the week's story actually is. The machine hands
   over graded claims with sources; it does not decide which four matter.
2. **The register pass** — the draft goes to Claude web (Fable) with one job:
   remove what reads as machine-written. Set phrases, hedging tails, the
   particle habits that mark generated Korean. This runs on the draft, after
   the facts are locked, so a rewrite cannot introduce a claim.
3. **Publication** — the issue is registered as a draft and stays a draft until
   a person publishes it. `published_at NULL` is unreachable by slug, so a
   draft cannot leak by someone guessing the URL.

## What is built, and what is not

| Piece | State |
|---|---|
| `newsletter_pipeline_runs` / `_steps` + ledger module | **built**, arithmetic enforcement verified |
| `newsletter_trusted_channels` + admin screen | **built**, resolution verified against the live API |
| Issue schema, three renderers, admin registration, DB serving | built, live |
| `findUngroundedClaims` (structural) | built, live |
| Topic definition file (`topics/ai-tech.ts`) | not yet |
| S0 harvest (both layers) | not yet |
| S1 format gate | not yet |
| Link and source verification gates | not yet |
| S3 judge wiring | not yet — needs a decision on LLM spend |
| Register pass via Claude web | not yet |

## What this does not fix

The pipeline cannot tell whether a sourced figure is the right figure. A page
that cites a real article for a number the article does not contain passes every
gate here. That is the editorial gate, and it stays a person's job — the gates
above exist to make sure that person is looking at claims that have sources
attached, rather than at prose with numbers in it.
