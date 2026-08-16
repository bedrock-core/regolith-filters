# Translation Keys

> **Removed — superseded by [`i18n`](../i18n).**
>
> This filter ran `.lang` → generated JSON, which left translation keys as untyped strings, no
> locale-parity check, and `.lang` as the authoring format. The `i18n` filter runs the other way:
> nested TypeScript objects are the source of truth, and the `.lang` files, the runtime bundle
> and the key types are all generated from them — with typed interpolation, plurals, library
> resources and vanilla keys on top.
>
> The code lives on in this repository's history (any pre-removal tag still resolves and
> installs), but no new versions will be published.
>
> **Migrate:** from your Regolith project root run
>
> ```bash
> node .regolith/cache/filters/i18n/bin/from-lang.js
> ```
>
> (`--namespace <creator_pack>` if the `core.register` scan can't derive it.)
>
> It converts your `.lang` entries into `packs/data/i18n/<locale>.ts` resource modules. Then swap
> the filter in `config.json` (before `bundler`, after `guides`), point your tsconfig alias at
> `@bedrock-core/generated/i18n`, and pass the generated bundle to
> `core.register({ translations: bundle })`. See the [i18n README](../i18n/README.md) for the
> full picture.
