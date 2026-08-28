# issues/

Issue documents, staged as JSON until `newsletter_issues` exists.

This directory is a waypoint, not the destination. Once the table lands, an
issue is registered through the admin screen and stored in
`newsletter_issues.content_json`; these files then serve only as fixtures.
Nothing reads them at runtime.

## Corrections applied when porting the launch issue

The design deliverable arrived with example copy filled in, and some of its
figures were never verified. They are fine in a mock and not fine on a page
that sells itself on graded sourcing, so they were corrected here rather than
carried forward:

| Figure in the mock | What shipped | Why |
|---|---|---|
| `964편` 검토 | **1,042편** | 964 has no origin. 2,714 harvested minus 1,672 filtered is 1,042, which is also the count this issue's corpus actually held. |
| `165,000` stars, 확인 | grade **미확인** | Post-publication fact-check could not confirm it. The number is kept because it is reported; the grade is not. |
| `8/27 종료`, 확인 | grade **미확인** | Same: the Ox Alpha catalogue figures never checked out. |
| Deloitte 2026 TMT | dropped from refs | Cited for a two-thirds claim that stayed unverified. |
| `1.6%` model-call code | **2% 미만** | 1.6 is a precision the source does not support; the brief's own text says "2% 미만". |

`findUngroundedClaims()` catches the structural half of this (a grade with no
source, a source index that does not exist). It cannot catch a figure that is
sourced but wrong -- that stays an editorial gate.
