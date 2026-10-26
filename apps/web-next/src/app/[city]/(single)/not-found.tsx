'use client';

import { useParams } from 'next/navigation';
import NotFoundContent from '@/app/NotFoundContent';
import { normalizeCity } from '@/lib/cities';

// Missing festivals under /<city>/festivals/, in that city's colours.
export default function CityNotFound() {
  const params = useParams<{ city: string }>();
  return <NotFoundContent city={normalizeCity(params.city) ?? 'kyoto'} />;
}
