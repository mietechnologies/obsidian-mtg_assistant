# MTG Assistant

MTG Assistant is an Obsidian plugin that turns lightweight card references like `[mtg:Lightning Bolt]` into clean inline text with hover previews powered by Scryfall.

## What it does

- Replaces `[mtg:Card Name]` with `Card Name` in Reading View.
- Replaces the same syntax in Live Preview while leaving Source Mode untouched.
- Shows a floating preview on hover or keyboard focus.
- Downloads card art locally and reuses the cached file on later hovers.
- Caches failed lookups to avoid repeatedly hitting Scryfall for bad references.

## Settings

- Card prefix, default `mtg`
- Maximum image width, default `265px`
- Show card name under image
- Enable in Reading View
- Enable in Live Preview
- Cache TTL in days, default `30`
- Clear metadata cache
- Clear local image cache

## Example note content

```md
[mtg:Lightning Bolt]
[mtg:Sol Ring]
[mtg:Archangel Avacyn]
```

## Testing in a vault

1. Run `npm install`.
2. Run `npm run dev` while the plugin folder is inside your vault at `.obsidian/plugins/mtg_assistant/`.
3. Reload Obsidian.
4. Enable **Settings → Community plugins → MTG Assistant**.
5. Open a note in Reading View or Live Preview and hover one of the example references.

## Cache location

- Metadata: `.obsidian/plugins/mtg_assistant/cache/metadata.json`
- Images: `.obsidian/plugins/mtg_assistant/cache/images/`

## Known MVP limitations

- Card lookup currently uses Scryfall fuzzy matching, so ambiguous names can still resolve to an unexpected printing.
- Source Mode intentionally shows the raw shortcode syntax.
- The preview is loaded on hover rather than prefetching cards ahead of time.

## Next improvements

- Preferred set or printing selection.
- Optional click action to open the Scryfall card page.
- Better treatment for split, transform, and multi-face cards in the preview UI.
