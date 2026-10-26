import type { ReactNode } from 'react';
import RootDocument, { rootMetadata, rootViewport } from '@/app/RootDocument';

export const metadata = rootMetadata;
export const viewport = rootViewport;

export default function DevLayout({ children }: { children: ReactNode }) {
  return (
    <RootDocument city="kyoto" locale="en">
      {children}
    </RootDocument>
  );
}
