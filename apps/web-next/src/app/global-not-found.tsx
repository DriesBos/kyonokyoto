import type { Metadata } from 'next';
import NotFoundContent from '@/app/NotFoundContent';
import RootDocument from '@/app/RootDocument';

// URLs that match no route (experimental.globalNotFound in next.config; there is no app/layout).
export const metadata: Metadata = {
  title: 'Page not found | Kyō no Kyōto',
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <RootDocument city="kyoto" locale="en">
      <NotFoundContent />
    </RootDocument>
  );
}
