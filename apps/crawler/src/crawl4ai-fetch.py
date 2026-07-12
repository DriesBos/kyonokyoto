#!/usr/bin/env python3
"""Render one URL with Crawl4AI and print a compact JSON payload.

The Node crawler owns source selection, extraction, normalization, and database
writes. This script is only a browser-rendering bridge for pages that need JS
or scroll-triggered lazy images.
"""

import argparse
import asyncio
from importlib.metadata import version
import ipaddress
import json
import os
from pathlib import Path
import sys
from time import monotonic
from urllib.parse import urlsplit

os.environ.setdefault(
    "CRAWL4_AI_BASE_DIRECTORY", str(Path(__file__).resolve().parent.parent / ".cache")
)

SERVICE_WORKER_BLOCK_SCRIPT = """
if (typeof ServiceWorkerContainer !== "undefined") {
  Object.defineProperty(ServiceWorkerContainer.prototype, "register", {
    configurable: false,
    writable: false,
    value: () => Promise.reject(new DOMException("Service workers disabled", "SecurityError")),
  });
}
"""


def build_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--user-agent", default="kyo-no-kyoto-bot/0.1")
    parser.add_argument("--timeout-ms", type=int, default=45000)
    parser.add_argument("--scroll-delay", type=float, default=0.5)
    parser.add_argument("--target-element", action="append", default=[])
    parser.add_argument("--wait-for")
    parser.add_argument("--wait-for-images", action="store_true")
    parser.add_argument("--scan-full-page", action="store_true")
    parser.add_argument("--bypass-cache", action="store_true")
    parser.add_argument("--allowed-domain", action="append", default=[])
    return parser


def safe_json(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def hostname_allowed(hostname, allowed_domains):
    hostname = str(hostname or "").lower().rstrip(".")
    domains = [str(domain).lower().rstrip(".") for domain in allowed_domains]
    return any(hostname == domain or hostname.endswith(f".{domain}") for domain in domains)


def canonical_navigation_url(value):
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None

    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    if (parsed.scheme == "http" and port == 80) or (parsed.scheme == "https" and port == 443):
        port = None

    return (
        parsed.scheme.lower(),
        parsed.hostname.lower().rstrip("."),
        port,
        parsed.path or "/",
        parsed.query,
    )


async def is_safe_request_url(value, dns_cache=None, resolver=None):
    dns_cache = dns_cache if dns_cache is not None else {}

    try:
        parsed = urlsplit(value)
    except ValueError:
        return False

    if parsed.scheme in {"about", "blob", "data"}:
        return True
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    if parsed.username or parsed.password:
        return False

    hostname = parsed.hostname.lower().rstrip(".")
    if hostname in dns_cache:
        return dns_cache[hostname]

    try:
        addresses = [ipaddress.ip_address(hostname)]
    except ValueError:
        try:
            if resolver is None:
                resolver = asyncio.get_running_loop().getaddrinfo
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            resolved = await resolver(hostname, port)
            addresses = list(
                {
                    ipaddress.ip_address(entry[4][0].split("%")[0])
                    for entry in resolved
                    if entry[4]
                }
            )
        except (OSError, ValueError):
            addresses = []

    safe = bool(addresses) and all(address.is_global for address in addresses)
    dns_cache[hostname] = safe
    return safe


async def render(args):
    if sys.version_info < (3, 10):
        raise RuntimeError("Crawl4AI requires Python 3.10 or newer")
    if not args.allowed_domain:
        raise RuntimeError("Renderer requires at least one allowed domain")

    from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
    from crawl4ai.content_filter_strategy import PruningContentFilter
    from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

    browser_config = BrowserConfig(
        headless=True,
        viewport_width=1920,
        viewport_height=1080,
        user_agent=args.user_agent,
        ignore_https_errors=False,
        extra_args=["--disable-features=ServiceWorker"],
    )

    crawler_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS if args.bypass_cache else CacheMode.ENABLED,
        check_robots_txt=True,
        excluded_tags=["nav", "footer", "aside", "form"],
        target_elements=args.target_element or None,
        markdown_generator=DefaultMarkdownGenerator(
            content_filter=PruningContentFilter(
                threshold=0.45,
                threshold_type="dynamic",
                min_word_threshold=0,
            )
        ),
        page_timeout=args.timeout_ms,
        remove_overlay_elements=True,
        wait_for_images=args.wait_for_images,
        scan_full_page=args.scan_full_page,
        scroll_delay=args.scroll_delay,
        wait_for=args.wait_for,
    )

    started_at = monotonic()
    blocked_request_count = 0
    dns_cache = {}
    initial_navigation_pending = True
    crawler = AsyncWebCrawler(config=browser_config)

    async def on_page_context_created(page, context, **_kwargs):
        await context.add_init_script(SERVICE_WORKER_BLOCK_SCRIPT)

        route_web_socket = getattr(context, "route_web_socket", None)
        if not callable(route_web_socket):
            raise RuntimeError("Playwright WebSocket routing unavailable; refusing renderer")

        async def block_web_socket(web_socket):
            nonlocal blocked_request_count
            blocked_request_count += 1
            await web_socket.close(code=1008, reason="Crawler network policy")

        await route_web_socket("**", block_web_socket)

        async def route_filter(route):
            nonlocal blocked_request_count, initial_navigation_pending
            request = route.request
            parsed = urlsplit(request.url)
            safe = await is_safe_request_url(request.url, dns_cache)
            navigation_allowed = not request.is_navigation_request() or (
                initial_navigation_pending
                and request.frame.parent_frame is None
                and hostname_allowed(parsed.hostname, args.allowed_domain)
                and canonical_navigation_url(request.url)
                == canonical_navigation_url(args.url)
            )

            if safe and navigation_allowed:
                if request.is_navigation_request():
                    initial_navigation_pending = False
                await route.continue_()
                return

            blocked_request_count += 1
            await route.abort("blockedbyclient")

        # ponytail: DNS is checked at route time; network isolation is needed to eliminate rebinding TOCTOU.
        await context.route("**", route_filter)
        return page

    crawler.crawler_strategy.set_hook("on_page_context_created", on_page_context_created)

    async with crawler:
        result = await crawler.arun(args.url, config=crawler_config)

    media = getattr(result, "media", {}) or {}
    metadata = getattr(result, "metadata", {}) or {}
    markdown = getattr(result, "markdown", None)
    payload = {
        "success": bool(getattr(result, "success", False)),
        "url": getattr(result, "url", args.url),
        "html": getattr(result, "html", "") or "",
        "cleaned_html": getattr(result, "cleaned_html", "") or "",
        "fit_html": getattr(markdown, "fit_html", "") or "",
        "media": safe_json(media),
        "metadata": safe_json(metadata),
        "status_code": getattr(result, "status_code", None),
        "redirected_status_code": getattr(result, "redirected_status_code", None),
        "crawl4ai_version": version("crawl4ai"),
        "duration_ms": round((monotonic() - started_at) * 1000),
        "blocked_request_count": blocked_request_count,
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
            "cleaned_html": "",
            "fit_html": "",
            "media": {},
            "metadata": {},
            "error_message": str(error),
        }

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
