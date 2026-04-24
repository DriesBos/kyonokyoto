#!/usr/bin/env python3
"""Render one URL with Crawl4AI and print a compact JSON payload.

The Node crawler owns source selection, extraction, normalization, and database
writes. This script is only a browser-rendering bridge for pages that need JS
or scroll-triggered lazy images.
"""

import argparse
import asyncio
import json
import sys


def build_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--user-agent", default="kyo-no-kyoto-bot/0.1")
    parser.add_argument("--timeout-ms", type=int, default=45000)
    parser.add_argument("--scroll-delay", type=float, default=0.5)
    parser.add_argument("--wait-for-images", action="store_true")
    parser.add_argument("--scan-full-page", action="store_true")
    parser.add_argument("--bypass-cache", action="store_true")
    return parser


def safe_json(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


async def render(args):
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode

    browser_config = BrowserConfig(
        headless=True,
        viewport_width=1920,
        viewport_height=1080,
        user_agent=args.user_agent,
    )

    crawler_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS if args.bypass_cache else CacheMode.ENABLED,
        page_timeout=args.timeout_ms,
        remove_overlay_elements=True,
        wait_for_images=args.wait_for_images,
        scan_full_page=args.scan_full_page,
        scroll_delay=args.scroll_delay,
    )

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(args.url, config=crawler_config)

    media = getattr(result, "media", {}) or {}
    metadata = getattr(result, "metadata", {}) or {}
    payload = {
        "success": bool(getattr(result, "success", False)),
        "url": getattr(result, "url", args.url),
        "html": getattr(result, "html", "") or "",
        "media": safe_json(media),
        "metadata": safe_json(metadata),
        "error_message": getattr(result, "error_message", None),
    }
    return payload


async def main():
    args = build_parser().parse_args()

    try:
        payload = await render(args)
    except Exception as error:
        payload = {
            "success": False,
            "url": args.url,
            "html": "",
            "media": {},
            "metadata": {},
            "error_message": str(error),
        }

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
