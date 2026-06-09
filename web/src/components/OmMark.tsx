/**
 * The Om mark — the Sanskrit ॐ set in the `--devanagari` face (Tiro Devanagari
 * Sanskrit), a single glyph that inherits `currentColor` so it themes with its
 * context (navy on parchment). Size comes from the global `.om-mark` rule
 * (font-size); the hero scales it up.
 */
export interface OmMarkProps {
  className?: string;
  style?: React.CSSProperties;
}

export default function OmMark({ className, style }: OmMarkProps) {
  return (
    <span
      className={['om-mark', className].filter(Boolean).join(' ')}
      style={style}
      role="img"
      aria-label="Om"
    >
      ॐ
    </span>
  );
}
