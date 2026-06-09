/**
 * Evidence-tier dot, mapping the Rust `Evidence` enum verbatim
 * (crates/desktop/src/ui.rs Evidence::dot_color): Strong green, Moderate amber,
 * Experimental grey. The tier is also surfaced as a title/aria-label for
 * non-color affordance.
 */
export type Evidence = 'strong' | 'moderate' | 'experimental';

const COLOR: Record<Evidence, string> = {
  strong: 'var(--evidence-strong)',
  moderate: 'var(--evidence-moderate)',
  experimental: 'var(--evidence-experimental)',
};

const LABEL: Record<Evidence, string> = {
  strong: 'strong evidence',
  moderate: 'moderate evidence',
  experimental: 'experimental',
};

export default function EvidenceDot({ evidence }: { evidence: Evidence }) {
  return (
    <span
      aria-label={LABEL[evidence]}
      title={LABEL[evidence]}
      style={{
        display: 'inline-block',
        width: '0.7em',
        height: '0.7em',
        borderRadius: '50%',
        background: COLOR[evidence],
        flex: '0 0 auto',
      }}
    />
  );
}
