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
    - Add card transfer controls to `mtg-deck` and `mtg-collection` rows.
      Add a row action button that opens a modal or side panel with the card name, source note/block, available quantity, destination note dropdown, destination block dropdown, quantity stepper/input, and an Apply button. Treat this as an inventory transfer: collection sources decrement row quantity, deck sources decrement inline `have` without changing deck `Need`, collection targets increment row quantity, and deck targets increment inline `have` or add `1 Card Name [have: n]` when absent. Build this around a block index, source row metadata, safe source/destination block rewrite helpers, and view/index refresh after apply.
    - Popover in `mtg-deck` blocks should also state where the card exists. The note name should be shown with a link to that note.
