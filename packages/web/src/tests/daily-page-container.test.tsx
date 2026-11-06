/**
 * The Daily Report pages with a fixed bottom bar (notes & photos, review) need
 * bottom padding at EVERY breakpoint, or the last control on the page ends up
 * under the bar. Regression: `md:py-6` used to override `pb-32` from 768 px up,
 * leaving "Generate a new draft" unclickable on tablets and desktops.
 */
import type { ReactElement } from 'react';
import { PageContainer } from '@/components/daily/ui';

const classesOf = (el: ReactElement) => String((el.props as { className?: string }).className ?? '').split(/\s+/);

describe('PageContainer bottom-bar padding', () => {
  it('keeps the bottom-bar clearance at md and up, not only on phones', () => {
    const classes = classesOf(PageContainer({ children: 'content', withBottomBar: true }) as ReactElement);
    expect(classes).toContain('pb-32');
    expect(classes).toContain('md:pb-32');
  });

  it('adds no bottom-bar clearance when there is no bottom bar', () => {
    const classes = classesOf(PageContainer({ children: 'content' }) as ReactElement);
    expect(classes).not.toContain('pb-32');
    expect(classes).not.toContain('md:pb-32');
  });
});
