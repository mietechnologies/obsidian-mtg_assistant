# Scryfall `/cards/search` Reference

This note documents the shape of the Scryfall `GET /cards/search` response and the fields most relevant to `MTG Assistant`.

API docs:
- https://scryfall.com/docs/api
- https://scryfall.com/docs/api/cards/search

## Request

Endpoint:

```text
GET https://api.scryfall.com/cards/search
```

Common query parameters:
- `q`: Scryfall search query
- `unique`: dedupe mode
- `order`: sort field
- `dir`: `asc` or `desc`
- `include_extras`: include tokens, art series, etc.
- `include_multilingual`: include non-English printings
- `include_variations`: include variation printings
- `page`: paginated result page

Example:

```text
https://api.scryfall.com/cards/search?q=%21%22Lightning%20Bolt%22&unique=cards
```

## Top-level response shape

Scryfall returns a list wrapper with metadata plus a `data` array of card objects.

```json
{
  "object": "list",
  "total_cards": 1,
  "has_more": false,
  "next_page": "https://api.scryfall.com/cards/search?...",
  "data": [
    {
      "id": "string",
      "oracle_id": "string",
      "name": "Lightning Bolt",
      "lang": "en"
    }
  ],
  "warnings": [
    "string"
  ]
}
```

Common top-level fields:
- `object`: usually `"list"`
- `total_cards`: total number of matching cards
- `has_more`: whether more pages exist
- `next_page`: URL for the next page when `has_more` is true
- `data`: array of card objects
- `warnings`: optional warnings about the query

## Card object fields

Scryfall card objects are large. These are the fields most likely to matter for plugin work.

### Identity

- `id`: Scryfall printing ID
- `oracle_id`: Oracle card ID shared across printings
- `name`: printed or canonical card name
- `lang`: language code
- `layout`: card layout type
- `released_at`: release date

### Gameplay

- `mana_cost`
- `cmc`
- `type_line`
- `oracle_text`
- `power`
- `toughness`
- `loyalty`
- `defense`
- `keywords`

### Color

- `colors`
- `color_identity`

### Print / set metadata

- `set`
- `set_name`
- `set_type`
- `collector_number`
- `rarity`
- `artist`
- `illustration_id`
- `border_color`
- `frame`
- `promo`
- `foil`
- `nonfoil`

### Images

Single-face cards typically expose:

- `image_uris.small`
- `image_uris.normal`
- `image_uris.large`
- `image_uris.png`
- `image_uris.art_crop`
- `image_uris.border_crop`

Multi-face cards often omit top-level `image_uris` and instead use `card_faces`.

### Multi-face cards

For transform, split, modal double-faced, and similar cards:

- `card_faces[]`

Each face may include:
- `name`
- `mana_cost`
- `type_line`
- `oracle_text`
- `power`
- `toughness`
- `loyalty`
- `artist`
- `image_uris`

### Legality / finance / links

- `legalities`
- `games`
- `reserved`
- `prices`
- `scryfall_uri`
- `uri`
- `related_uris`
- `purchase_uris`

## Minimal fields useful for `MTG Assistant`

If the plugin is only doing hover previews, the practical minimum is:

```ts
interface ScryfallSearchResponse {
  object: "list";
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  warnings?: string[];
  data: ScryfallCard[];
}

interface ScryfallCard {
  id: string;
  oracle_id: string;
  name: string;
  lang: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    png?: string;
    art_crop?: string;
    border_crop?: string;
  };
  card_faces?: Array<{
    name: string;
    image_uris?: {
      small?: string;
      normal?: string;
      large?: string;
      png?: string;
      art_crop?: string;
      border_crop?: string;
    };
  }>;
  scryfall_uri: string;
}
```

## Image lookup guidance

Recommended image resolution order:

1. `image_uris.normal`
2. `card_faces[0].image_uris.normal`
3. `image_uris.large` or another fallback size if needed

Notes:
- Many normal cards have top-level `image_uris`.
- Many double-faced or split cards require `card_faces`.
- `png` is larger and lossless; `normal` is usually sufficient for hover previews.

## Search behavior guidance

Useful query patterns:

- Exact name:
  ```text
  q=!"Lightning Bolt"
  ```

- Exact name with set preference:
  ```text
  q=!"Lightning Bolt" set:clb
  ```

- English printing only:
  ```text
  q=!"Lightning Bolt" lang:en
  ```

Suggested defaults for the plugin:
- `unique=cards` to dedupe printings
- exact-name query using `!"Card Name"` when possible
- optional `set:<code>` when a preferred set is configured

## Operational notes

Scryfall expects well-formed requests:
- include a meaningful `User-Agent`
- include an `Accept` header
- use HTTPS
- avoid excessive request volume

Scryfall’s published guidance is to stay under about `10 requests/second`, and malformed or excessive traffic can trigger `403` or `429`.
