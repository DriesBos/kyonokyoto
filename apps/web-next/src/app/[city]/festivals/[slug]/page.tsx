import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import FestivalPage from '@/app/FestivalPage';
import { cityConfigFor, defaultLocaleForCity } from '@/lib/cities';
import { buildFestivalMetadata } from '@/lib/festivalMetadata';

type RouteProps = { params: Promise<{ city: string; slug: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const values = await params;
  const city = cityConfigFor(values.city);
  if (!city || city.locales.length !== 1) return {};
  return buildFestivalMetadata({ city, locale: defaultLocaleForCity(city), slug: values.slug });
}

export async function generateViewport({ params }: RouteProps): Promise<Viewport> {
  const city = cityConfigFor((await params).city);
  return { themeColor: city?.themeColor ?? '#d2d3d5', width: 'device-width', initialScale: 1 };
}

export default async function FestivalRoute({ params }: RouteProps) {
  const values = await params;
  const city = cityConfigFor(values.city);
  if (!city || city.locales.length !== 1 || !values.slug) notFound();
  return <FestivalPage city={city} locale={defaultLocaleForCity(city)} slug={values.slug} />;
}
