import type { APIRoute } from 'astro';
import { proxyYutakaImage } from '../../lib/mediaDelivery';

export const GET: APIRoute = ({ request }) => proxyYutakaImage(request);
