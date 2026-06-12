import { useEffect } from 'react';

/**
 * Sets document.title for the page that calls it. Every routed page calls
 * this with its own title, so no restore-on-unmount is needed — the next
 * page's effect overwrites it.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
