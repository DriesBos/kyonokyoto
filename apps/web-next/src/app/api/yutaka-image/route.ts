import { proxyYutakaImage } from '@/lib/mediaDelivery';

export const GET = (request: Request) => proxyYutakaImage(request);
