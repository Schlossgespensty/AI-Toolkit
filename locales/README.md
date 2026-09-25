# Interface languages

YAML in this directory is the editable source of interface text. registry.yaml
matches the UCP language list; the legacy UCP ch code maps to BCP 47 zh-CN.
Language selection is an editor preference. It never changes project dialogue,
serialized field names, enum values, building IDs, or file formats.

Each language uses the same namespaces:

- common, interface, native: shared actions, page labels, native menus/dialogs.
- character, fields, help, sections, options: character editor labels and help.
- castle, categories, items, viewport, shortcuts: castle tools and views.
- library, content, costs, updates: the other editor areas.
- quantity, details: counts and shared status/description text.
- nativeErrors: stable backend error codes; interpolated paths remain verbatim.

Call toolkitI18n.t('namespace:key', { name, count }) at the UI boundary. For
HTML templates, use toolkitI18n.html() to escape interpolated text. Static HTML
uses data-i18n="namespace:key" or
data-i18n-attrs="title=namespace:key;aria-label=namespace:other_key".
Bindings change labels and attributes; they do not replace input values.
Detached windows opt in with toolkitI18n.attachWindow(window).

Keep domain calculations language-independent. Translate their results when
displaying them, and cache labels outside rendering loops. Do not translate a
stored enum to use it as a lookup key. Custom names are user content and retain
their original spelling.

Plural messages use i18next/CLDR suffixes such as _one, _other, _few, and _many,
with a numeric count. Never append an English s. Keep all {{placeholders}} in
each translation, but reorder them naturally for the language. Translations
should express the action or meaning, using established game terms. Do not fill
unfinished catalogs with copied English to pass validation.

Run node scripts/build-locales.js to generate compact JSON, the English startup
bundle, vendor i18next, and the TypeScript key union. Run
node scripts/build-locales.js --check --strict to verify every language has the
complete key set with matching interpolation. tests/localization.test.js also
covers live switching, namespaces, Russian plurals, Persian RTL, escaping, and
preservation of user content.

Completeness checks are structural, not a claim of linguistic quality. Review
translations in the actual workspace: button width, field meaning, terminology,
plural forms, and RTL behavior matter as much as having all the keys.
