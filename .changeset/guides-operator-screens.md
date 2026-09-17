---
'@bedrock-core/regolith-filters_guides': minor
---

A guide with anything gated compiles a second set of screen modules, for operators. The ordinary `guide_home`, `guide_home_back`, `guide_index` and `guide_<page>` leave the gated pages out; `guideop_home`, `guideop_home_back`, `guideop_index` and `guideop_<page>` cover every page and build each screen with `audience: "op"`. An ordinary name never matches an operators' one, whatever a page is called, and the check that refuses two pages compiling to one screen covers both sets. The manifest's `screens` names each page's screen in the ordinary set and `opScreens` in the operators' set. A guide with nothing gated compiles the ordinary set alone.
