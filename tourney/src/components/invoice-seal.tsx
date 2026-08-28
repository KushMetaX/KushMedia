function cellsFrom(code: string) {
  const size = 11;
  const bits: boolean[] = [];
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  for (let i = 0; i < size * size; i++) {
    h ^= i * 2654435761;
    h = Math.imul(h, 1597334677);
    bits.push((h >>> 0) % 3 !== 0);
  }
  for (let i = 0; i < size; i++) {
    bits[i] = true;
    bits[(size - 1) * size + i] = true;
    bits[i * size] = true;
    bits[i * size + size - 1] = true;
  }
  return { size, bits };
}

export function InvoiceSeal({ code }: { code: string }) {
  const { size, bits } = cellsFrom(code);
  return (
    <div
      className="grid size-36 shrink-0 gap-px rounded-md bg-primary-fg p-2 shadow-[var(--shadow-border)]"
      style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      aria-hidden
    >
      {bits.map((on, i) => (
        <span key={i} className={on ? "bg-primary" : "bg-transparent"} />
      ))}
    </div>
  );
}
