# TODO

- Printing and set selection:
  Support choosing a preferred printing or set so deck and collection workflows can target the correct version of a card.
- Editor autocomplete and card search:
  Add inline completion for `[mtg:...]` references to reduce typos and speed up entry.
- Commands and quick actions:
  Add command palette actions for inserting card references, creating deck or collection blocks, refreshing cache, and opening external card pages.
- Deck list upgrades:
    - Add rendered deck controls for incrementing and decrementing inline `have` counts.
    - mtg-deck blocks should be included in the broad collection, but mtg-deck blocks should not count the cards in other mtg-deck blocks.
    - Popover in `mtg-deck` blocks should also state where the card exists. The note name should be shown with a link to that note.
    - Add "name" field to collection/deck blocks to make identification easier.
