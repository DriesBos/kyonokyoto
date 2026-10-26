// The /dev design-system page and its header button exist only in local development:
// production builds 404 the route and drop the button (NODE_ENV is inlined at build time).
export const DEV_PAGE_ENABLED = process.env.NODE_ENV !== 'production';
export const DEV_PAGE_PATH = '/dev/';
