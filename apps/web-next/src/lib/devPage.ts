// Local-only dev tools (/dev/landing and its API): production builds 404 them (NODE_ENV is
// inlined at build time).
export const DEV_PAGE_ENABLED = process.env.NODE_ENV !== 'production';
