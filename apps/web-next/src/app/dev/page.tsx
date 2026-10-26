import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { rootViewport } from '@/app/RootDocument';
import { cityConfigFor } from '@/lib/cities';
import { DEV_PAGE_ENABLED } from '@/lib/devPage';
import DesignSystem from './DesignSystem';

// Local-only playground and design system. The proxy maps /dev to the Kyoto theme.
export const metadata: Metadata = {
  title: 'dev | Kyō no Kyōto',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  ...rootViewport,
  themeColor: cityConfigFor('kyoto')!.themeColor,
};

export default function DevPage() {
  if (!DEV_PAGE_ENABLED) notFound();
  return <DesignSystem />;
}
