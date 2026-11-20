interface LineItemIdentity {
  description: string;
  quantity: number;
  unitAmountPaise: string;
}

/**
 * Invoice line items have no id, and two lines can be identical. Each gets a React key from its
 * content plus how many identical lines came before it.
 */
export function keyedLineItems<T extends LineItemIdentity>(
  items: readonly T[],
): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = `${item.description}|${item.quantity}|${item.unitAmountPaise}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { key: `${base}#${count}`, item };
  });
}
