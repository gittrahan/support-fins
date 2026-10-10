/** A rejected asynchronous placement is not an undoable action. */
export function retractPlacement(undo, redo, token, historyKey) {
  if (!token) return;
  const index = undo.indexOf(token.state);
  const wasLatest = index >= 0 && index === undo.length - 1 && redo.length === 0;
  if (index >= 0) undo.splice(index, 1);
  // Consecutive pending placements may all fail. Carry the prior redo through
  // that chain, but an intervening real edit deliberately invalidates it.
  if (!wasLatest && index >= 0 && undo[index]?.placementRedo) {
    undo[index].placementRedo.unshift(...token.redoBefore);
  }
  const redone = redo.indexOf(token.state);
  if (redone >= 0) redo.splice(redone, 1);
  // Later edits may have captured the pending wall. Undo must not resurrect it.
  for (const state of [...undo, ...redo, ...token.redoBefore]) {
    state.walls = state.walls.filter((w) => w.historyKey !== historyKey);
  }
  if (wasLatest) redo.push(...token.redoBefore);
}
