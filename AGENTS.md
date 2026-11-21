# StockPilot contributor instructions

Preserve the Next.js static-export frontend, FastAPI APIs, existing accounts,
financial rules, and user changes. The separate Apps in Toss frontend is private;
web UI tasks do not authorize publishing or modifying it.

## StockPilot design workflow

Read [the project design guide](docs/stockpilot-design-guide.md) before changing a
user-facing screen. Use the user's `project-ui-quality` skill and its live-product
library; inspect one relevant current public screen firsthand. Record the user
decision, actual reference and limits, composition, tokens, routes, data contract,
and acceptance criteria in `design.md` before implementation. Preserve unrelated
design records. OpenUI, Stitch, and Figma are optional aids, not sources of
production code, real prices, or evidence that a screen works.

Make one coherent change with working paths and distinct loading, empty, failure,
and completion states. For a substantial change, ask for independent visual and
contract review. Pass the skill path, reference path, scope, and preserved
contracts to any UI reviewer; require evidence from actual rendered screens.
Inspect mobile and desktop screenshots, focus, contrast, wraps and safe areas.
The market workspace takes priority over marketing decoration, and public designs
or shares must never include account identifiers, positions or balances by default.

Repository linkage alone does not authorize commit, push, or deployment. When
publication is requested, follow the user's canonical boclair98 upstream → actual
coders-kr fork synchronization → existing Coders deployment → live verification
workflow. Keep unrelated user changes out of the publication.
