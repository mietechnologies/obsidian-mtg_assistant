# TODO

- Bulk purchase export for TCGPlayer:
  Turn missing or selected cards into a bulk purchase list that can be sent to TCGPlayer for cart-building or order preparation.
- Richer card popover:
  Show more cached metadata in the hover preview, such as mana cost, type line, rarity, power/toughness, and legality context.
- Printing and set selection:
  Support choosing a preferred printing or set so deck and collection workflows can target the correct version of a card.
- Deck validation and analytics:
  Add commander legality checks, singleton validation, card-count validation, mana curve, color identity summary, and other deckbuilding insights.
- Deck list metadata:
  Allow a deck list to declare its format and surface derived metadata such as mana curve, color identity, legality, and related summary details in the rendered output.
- Collection rollups across notes:
  Aggregate collection blocks across the configured collection folder to show total inventory, value, duplicates, and unused cards.
- Editor autocomplete and card search:
  Add inline completion for `[mtg:...]` references to reduce typos and speed up entry.
- Commands and quick actions:
  Add command palette actions for inserting card references, creating deck or collection blocks, refreshing cache, and opening external card pages.
- Bulk prefetch and cache warming:
  Allow users to resolve or refresh all cards in the current note or block ahead of time to reduce hover latency.
- Consider reusing collection-style quantity controls for future deck wishlist or inventory workflows.
