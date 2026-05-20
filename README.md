# MTG Assistant

MTG Assistant is an Obsidian plugin for working with Magic: The Gathering cards directly inside your notes. It supports inline card references, rendered deck lists, rendered collection lists, collection coverage checks, and a searchable collection overview powered by Scryfall data.

## Features

- Inline card references with hover previews in Reading View and Live Preview.
- Rendered deck lists from fenced code blocks.
- Rendered collection lists from fenced code blocks.
- Deck analytics and deck-format validation for supported formats.
- Deck-vs-collection coverage checks, including missing-card cost estimates.
- Editable collection quantities from rendered collection blocks.
- Editable collection quantities from the collection overview view.
- Local caching for card metadata and card images.
- Retry controls for rate-limited lookups.

## Disclosures

- Network use: the plugin sends card lookup and image requests to Scryfall to resolve card metadata, legality, prices, and preview images.
- External links: the plugin can generate TCGPlayer links for missing-card shopping, but it does not send your collection data to TCGPlayer unless you choose to open that link.
- Local file access: the plugin reads markdown notes in your configured collection folder and stores local cache files for card metadata and images in your Obsidian config directory under the plugin folder.
- Note modifications: when you use quantity steppers in rendered collection views or the collection overview, the plugin edits the underlying collection code block in the corresponding note.
- Telemetry and ads: the plugin does not include telemetry, analytics, or advertising.

## Inline Card References

Use inline references like this anywhere in a note:

```md
[mtg:Lightning Bolt]
[mtg:Sol Ring]
[mtg:Archangel Avacyn]
```

The plugin renders the reference text as the card name and shows a hover preview with:

- Card image
- Price data when available
- Format legality badges

The card prefix is configurable in plugin settings. The default prefix is `mtg`.

## Deck Lists

Deck lists are rendered from fenced code blocks. The default code block tag is `mtg-deck`.

~~~md
```mtg-deck
format: commander
commander: Atraxa, Praetors' Voice

- Creatures:
Birds of Paradise
1 Llanowar Elves

- Artifacts:
Sol Ring
Arcane Signet
```
~~~

Deck list behavior:

- One card per line.
- Explicit quantities like `4 Lightning Bolt` are supported.
- Bare card lines like `Sol Ring` are treated as quantity `1`.
- An inline `commander:` line is supported and preferred for commander-style formats.
- Optional section labels are supported.
- A configurable legacy commander section marker is still supported.
- An optional `format:` line enables format-specific validation.

Supported deck formats:

- `standard`
- `pioneer`
- `modern`
- `pauper`
- `commander`
- `brawl`
- `duel`
- `oathbreaker`
- `legacy`
- `vintage`

Rendered deck features:

- Sectioned deck table with current price totals
- Hover previews on card names
- Deck legality warnings for banned, not-legal, and restricted cards
- Deck validation for deck size, commander count, singleton rules, and Vintage restricted cards
- Collection coverage against notes in your configured collection folder
- Estimated missing-card cost
- TCGPlayer mass-entry link for missing cards
- Deck analytics including mana curve, type distribution, color identity, and keyword summaries

## Collection Lists

Collection lists are rendered from fenced code blocks. The default code block tag is `mtg-collection`.

~~~md
```mtg-collection
- Creatures:
4 Llanowar Elves
2 Birds of Paradise

- Artifacts:
1 Sol Ring
```
~~~

Rendered collection features:

- Sectioned collection table
- Hover previews on card names
- Color identity badges
- Current unit prices when available
- Inline quantity steppers
- Optional automatic row removal when quantity reaches zero

Collection lists are writable from the rendered view. Adjusting a quantity updates the underlying code block in the note.

## Collection Overview

The plugin includes a command:

- `Open collection overview`

The collection overview aggregates collection blocks from the configured collection folder and shows:

- Total cards
- Unique cards
- Estimated collection value
- Search filtering
- Type filtering
- Sorting by mana value, quantity, name, type, collection, unit price, and total value
- Quantity steppers for updating cards directly from the overview

When a card appears in multiple collection notes, the overview still aggregates it into one row while keeping track of the underlying source blocks for edits.

## Settings

The settings tab includes:

- `Card prefix`
- `Card image width`
- `Foil price suffix`
- `Etched price suffix`
- `Deck list code block tag`
- `Commander marker (legacy)`
- `Collection list code block tag`
- `Collections folder`
- `Remove collection rows at zero quantity`
- `Image cache duration in days`
- `Metadata cache duration in hours`
- `Clear metadata cache`
- `Clear image cache`

## Caching

MTG Assistant caches both metadata and images locally to reduce repeated Scryfall requests and improve responsiveness.

- Metadata cache stores resolved card data and price information.
- Image cache stores downloaded card images for hover previews.
- Failed and rate-limited lookups are also handled to avoid wasteful repeated requests.

## Example Workflow

1. Add inline card references to regular notes for quick previews.
2. Keep deck lists in `mtg-deck` code blocks.
3. Keep owned cards in `mtg-collection` code blocks inside your collection folder.
4. Open collection overview to browse and adjust your inventory.
5. Use deck rendering to compare a deck against your collection and see what is missing.

## Development

For local development in an Obsidian vault:

1. Run `npm install`.
2. Run `npm run dev` or `npm run build`.
3. Reload Obsidian.
4. Enable `MTG Assistant` in Community Plugins.

## Current Limitations

- Card resolution uses Scryfall lookup behavior, so ambiguous names may resolve to an unexpected card or printing.
- Source Mode intentionally leaves inline references and code blocks unrendered.
- Collection coverage is based on parsed quantities in collection blocks, not separate database records.
- When a card exists in multiple collection source blocks, overview quantity edits target one tracked source block per adjustment rather than asking you which note to update.
