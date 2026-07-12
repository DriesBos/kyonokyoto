export const serializeInlineJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
