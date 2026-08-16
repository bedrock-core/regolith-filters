// Seeded by `regolith install` so the module resolves before the first build;
// the i18n filter replaces this file with the fully typed declaration
// (your resources at the root, library and vanilla branches grafted on)
// every time it runs.
declare module '@bedrock-core/generated/i18n' {
	const bundle: {
		readonly namespace: string;
		readonly defaultLocale: string;
		readonly libs: readonly string[];
		/** locale → flat path → template ({{var}} form; vanilla entries only where referenced) */
		readonly locales: Record<string, Record<string, string>>;
		/** flat path → interpolation argument order (default locale appearance order) */
		readonly args: Record<string, readonly string[]>;
		/** locale → REAL key → value: .lang passthrough (guides, hand-written) for measurement */
		readonly extra: Record<string, Record<string, string>>;
		/** Type-only: the tree the t()/key()/raw() selectors navigate. Absent at runtime. */
		readonly resources?: unknown;
	};
	export default bundle;
}
