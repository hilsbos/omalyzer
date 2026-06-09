import styles from './OmLockup.module.css';

/**
 * The Om mark — a hand-authored, stylized ॐ vector (three sub-paths: body+tail
 * outline, crescent, bindu). Single-color-fillable AND stroke-drawable (the
 * inscription motion). Fill is `currentColor` so the mark inherits text color.
 *
 * The path geometry is duplicated across this file, web/public/favicon.svg, and
 * the lockup markup — if you change the path, update all three together.
 */
export interface OmMarkProps {
  /** When true, attaches the .isDrawing class so the stroke-draw animation runs. */
  drawing?: boolean;
  /** Extra class for sizing/overrides (the default --mark size lives in CSS). */
  className?: string;
  style?: React.CSSProperties;
}

const BODY_PATH =
  'M 30 58 C 22 58 16 64 16 72 C 16 82 24 90 35 90 C 47 90 56 81 56 68 ' +
  'C 56 60 52 54 45 51 C 51 49 56 44 56 37 C 56 27 48 20 38 20 ' +
  'C 30 20 24 25 22 32 L 31 35 C 32 31 35 29 38 29 C 42 29 46 32 46 37 ' +
  'C 46 43 41 46 34 46 L 34 55 C 42 55 46 60 46 67 C 46 75 41 81 35 81 ' +
  'C 28 81 24 76 24 71 C 24 66 27 62 31 62 Z ' +
  'M 60 50 C 60 38 67 30 78 30 C 84 30 89 33 92 38 L 84 43 ' +
  'C 82 41 80 40 78 40 C 73 40 70 44 70 50 C 70 60 75 67 84 67 ' +
  'C 88 67 91 65 93 62 L 93 53 L 80 53 L 80 45 L 100 45 L 100 64 ' +
  'C 96 71 89 76 80 76 C 68 76 60 65 60 50 Z';

const CRESCENT_PATH =
  'M 70 18 C 73 13 79 10 85 10 C 91 10 96 13 99 18 ' +
  'C 96 15 91 13 85 13 C 79 13 74 15 70 18 Z';

export default function OmMark({ drawing = false, className, style }: OmMarkProps) {
  const markClass = [styles.mark, drawing ? styles.isDrawing : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <svg
      className={markClass}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      role="img"
      aria-label="Om"
    >
      <g>
        <path className={styles.stroke} fillRule="evenodd" pathLength={1} d={BODY_PATH} />
        <path className={styles.stroke} pathLength={1} d={CRESCENT_PATH} />
        <circle className={styles.bindu} cx={84.5} cy={4.5} r={3.2} />
      </g>
    </svg>
  );
}
