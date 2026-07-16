export const MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX = 540;

export const filterEventMediaByMinimumHeight = (event) => {
  const measuredHeightByUrl = new Map(
    (event.image_metadata ?? [])
      .filter((image) => Number.isFinite(image.height) && image.height > 0)
      .map((image) => [image.url, image.height]),
  );
  const isEligible = (url) => {
    const height = measuredHeightByUrl.get(url);
    return height === undefined || height >= MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX;
  };
  const imageUrls = (event.image_urls ?? []).filter(isEligible);

  return {
    ...event,
    primary_image_url:
      event.primary_image_url && isEligible(event.primary_image_url)
        ? event.primary_image_url
        : (imageUrls[0] ?? null),
    image_urls: event.image_urls === null ? null : imageUrls,
    image_metadata:
      event.image_metadata === null
        ? null
        : (event.image_metadata ?? []).filter((image) => isEligible(image.url)),
  };
};
