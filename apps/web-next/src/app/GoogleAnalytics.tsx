import Script from 'next/script';

const GA_MEASUREMENT_ID = 'G-4EYJPD08Y4';

// Same property as apps/web. lazyOnload keeps gtag off the critical path, which apps/web gets
// from Partytown. GA4 enhanced measurement records client-side route changes as page views.
export default function GoogleAnalytics() {
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="lazyOnload"
      />
      <Script id="google-analytics" strategy="lazyOnload">
        {`window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`}
      </Script>
    </>
  );
}
