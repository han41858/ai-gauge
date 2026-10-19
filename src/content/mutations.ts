const ownNode = (node: Node) => {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return !!element?.closest('#ai-gauge-usage-strip');
};

/** True when a mutation batch contains a site change rather than only our own strip moving. */
export function hasExternalChange(records: MutationRecord[]): boolean {
  return records.some(record => {
    if (ownNode(record.target)) return false;
    const changed = [...record.addedNodes, ...record.removedNodes];
    // Insertions/reordering made by either installation must not schedule
    // another mount. A site removing our node alone does require recovery.
    return record.type !== 'childList' || changed.length === 0 || changed.some(node => !ownNode(node))
      || [...record.removedNodes].some(node => !node.isConnected);
  });
}

export const OBSERVED_ATTRIBUTES = ['hidden', 'aria-hidden', 'inert', 'open', 'role', 'style', 'class', 'contenteditable', 'aria-label', 'data-testid', 'data-test-id', 'data-cds'];
