import styles from './TabBar.module.css';

export type SecondaryTab = 'pitch' | 'vowel' | 'coherence' | 'state';

const TABS: ReadonlyArray<[SecondaryTab, string]> = [
  ['pitch', 'Pitch'],
  ['vowel', 'Vowel'],
  ['coherence', 'Coherence'],
  ['state', 'State'],
];

/** Phone-only segmented control selecting the ONE visible secondary panel. */
export default function TabBar({
  value,
  onChange,
}: {
  value: SecondaryTab;
  onChange: (t: SecondaryTab) => void;
}) {
  return (
    <div className={styles.tabbar} role="tablist" aria-label="Secondary panels">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          className={styles.tab}
          data-active={value === id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
