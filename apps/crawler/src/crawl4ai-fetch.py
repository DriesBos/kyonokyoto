#!/usr/bin/env python3
"""Render URLs with Crawl4AI and print compact JSON payloads.

The Node crawler owns source selection, extraction, normalization, and database
writes. This script is only a browser-rendering bridge for pages that need JS
or scroll-triggered lazy images.

`crawl4ai-fetch.py URL --allowed-domain D` renders one page and exits.
`crawl4ai-fetch.py --serve` keeps one browser open and answers JSON-lines
requests on stdin, one response line per request on stdout.
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

# Not needed for extraction: fonts, audio/video and analytics only slow renders.
SKIPPED_RESOURCE_TYPES = {"font", "media"}
SKIPPED_HOSTS = [
    "google-analytics.com",
    "googletagmanager.com",
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "connect.facebook.net",
    "hotjar.com",
    "clarity.ms",
    "analytics.tiktok.com",
    "static.ads-twitter.com",
]


def build_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--user-agent", default="kyo-no-kyoto-bot/0.1")
    parser.add_argument("--timeout-ms", type=int, default=45000)
    parser.add_argument("--scroll-delay", type=float, default=0.5)
    parser.add_argument("--target-element", action="append", default=[])
    parser.add_argument("--wait-for")
    parser.add_argument("--wait-for-images", action="store_true")
    parser.add_argument("--scan-full-page", action="store_true")
    parser.add_argument("--allowed-domain", action="append", default=[])
    parser.add_argument("--max-renders", type=int, default=100)
    return parser


def request_from_args(args):
    return {
        "url": args.url,
        "timeout_ms": args.timeout_ms,
        "scroll_delay": args.scroll_delay,
        "target_elements": args.target_element,
        "wait_for": args.wait_for,
        "wait_for_images": args.wait_for_images,
        "scan_full_page": args.scan_full_page,
        "allowed_domains": args.allowed_domain,
    }


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


MAX_SAME_ORIGIN_NAVIGATIONS = 3


def same_origin_navigation(value, initial_url):
    # Client-side redirects (e.g. an SPA rewriting /exhibitions to
    # /exhibitions?year=2026) stay on the exact scheme/host/port of the URL
    # Node already vetted for robots.txt and allowed domains.
    target = canonical_navigation_url(value)
    initial = canonical_navigation_url(initial_url)
    return bool(target and initial and target[:3] == initial[:3])


def navigation_request_allowed(state, url, is_top_frame):
    if not is_top_frame or not hostname_allowed(urlsplit(url).hostname, state["allowed_domains"]):
        return False
    if state["initial_navigation_pending"]:
        return canonical_navigation_url(url) == canonical_navigation_url(state["url"])
    return (
        state["same_origin_navigations_remaining"] > 0
        and same_origin_navigation(url, state["url"])
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


def is_skippable_resource(request):
    if request.resource_type in SKIPPED_RESOURCE_TYPES:
        return True
    return hostname_allowed(urlsplit(request.url).hostname, SKIPPED_HOSTS)


def failure_payload(url, error):
    return {
        "success": False,
        "url": url,
        "html": "",
        "cleaned_html": "",
        "fit_html": "",
        "media": {},
        "metadata": {},
        "error_message": str(error),
    }


class Renderer:
    """One headless browser reused across renders; requests are handled one at a time."""

    def __init__(self, user_agent, max_renders=100):
        self.user_agent = user_agent
        self.max_renders = max_renders
        self.crawler = None
        self.render_count = 0
        self.request = None

    async def start(self):
        if sys.version_info < (3, 10):
            raise RuntimeError("Crawl4AI requires Python 3.10 or newer")

        from crawl4ai import AsyncWebCrawler, BrowserConfig

        browser_config = BrowserConfig(
            headless=True,
            viewport_width=1920,
            viewport_height=1080,
            user_agent=self.user_agent,
            ignore_https_errors=False,
            extra_args=["--disable-features=ServiceWorker"],
            verbose=False,
        )
        crawler = AsyncWebCrawler(config=browser_config)
        crawler.crawler_strategy.set_hook("on_page_context_created", self.on_page_created)
        await crawler.start()
        self.crawler = crawler
        self.render_count = 0

    async def close(self):
        crawler, self.crawler = self.crawler, None
        if crawler is not None:
            try:
                await crawler.close()
            except Exception:
                pass

    async def on_page_created(self, page, context, **_kwargs):
        # Contexts are shared between renders, so every guard is page-scoped and
        # disappears when Crawl4AI closes the page.
        state = self.request
        await page.add_init_script(SERVICE_WORKER_BLOCK_SCRIPT)

        route_web_socket = getattr(page, "route_web_socket", None)
        if not callable(route_web_socket):
            raise RuntimeError("Playwright WebSocket routing unavailable; refusing renderer")

        async def block_web_socket(web_socket):
            state["blocked_request_count"] += 1
            await web_socket.close(code=1008, reason="Crawler network policy")

        await route_web_socket("**", block_web_socket)

        async def route_filter(route):
            request = route.request
            if not request.is_navigation_request() and is_skippable_resource(request):
                state["skipped_request_count"] += 1
                await route.abort("blockedbyclient")
                return

            safe = await is_safe_request_url(request.url, state["dns_cache"])
            navigation_allowed = not request.is_navigation_request() or navigation_request_allowed(
                state, request.url, request.frame.parent_frame is None
            )

            if safe and navigation_allowed:
                if request.is_navigation_request():
                    if not state["initial_navigation_pending"]:
                        state["same_origin_navigations_remaining"] -= 1
                    state["initial_navigation_pending"] = False
                await route.continue_()
                return

            state["blocked_request_count"] += 1
            await route.abort("blockedbyclient")

        # ponytail: DNS is checked at route time; network isolation is needed to eliminate rebinding TOCTOU.
        await page.route("**", route_filter)
        return page

    async def render(self, request):
        if not request.get("allowed_domains"):
            raise RuntimeError("Renderer requires at least one allowed domain")

        from crawl4ai import CrawlerRunConfig, CacheMode
        from crawl4ai.content_filter_strategy import PruningContentFilter
        from crawl4ai.markdown_generation_strategy import DefaultMarkdownGenerator

        if self.crawler is not None and self.render_count >= self.max_renders:
            await self.close()
        if self.crawler is None:
            await self.start()

        crawler_config = CrawlerRunConfig(
            cache_mode=CacheMode.DISABLED,
            check_robots_txt=True,
            excluded_tags=["nav", "footer", "aside", "form"],
            target_elements=request.get("target_elements") or None,
            markdown_generator=DefaultMarkdownGenerator(
                content_filter=PruningContentFilter(
                    threshold=0.45,
                    threshold_type="dynamic",
                    min_word_threshold=0,
                )
            ),
            page_timeout=int(request.get("timeout_ms") or 45000),
            remove_overlay_elements=True,
            wait_for_images=bool(request.get("wait_for_images")),
            scan_full_page=bool(request.get("scan_full_page")),
            scroll_delay=float(request.get("scroll_delay") or 0.5),
            wait_for=request.get("wait_for") or None,
            verbose=False,
        )

        url = request["url"]
        started_at = monotonic()
        state = {
            "url": url,
            "allowed_domains": request["allowed_domains"],
            "blocked_request_count": 0,
            "skipped_request_count": 0,
            "dns_cache": {},
            "initial_navigation_pending": True,
            "same_origin_navigations_remaining": MAX_SAME_ORIGIN_NAVIGATIONS,
        }
        self.request = state
        self.render_count += 1
        try:
            result = await self.crawler.arun(url, config=crawler_config)
        except Exception:
            # A crashed or wedged browser should not poison later renders.
            await self.close()
            raise
        finally:
            self.request = None

        media = getattr(result, "media", {}) or {}
        metadata = getattr(result, "metadata", {}) or {}
        markdown = getattr(result, "markdown", None)
        return {
            "success": bool(getattr(result, "success", False)),
            "url": getattr(result, "url", url),
            "html": getattr(result, "html", "") or "",
            "cleaned_html": getattr(result, "cleaned_html", "") or "",
            "fit_html": getattr(markdown, "fit_html", "") or "",
            "media": safe_json(media),
            "metadata": safe_json(metadata),
            "status_code": getattr(result, "status_code", None),
            "redirected_status_code": getattr(result, "redirected_status_code", None),
            "crawl4ai_version": version("crawl4ai"),
            "duration_ms": round((monotonic() - started_at) * 1000),
            "blocked_request_count": state["blocked_request_count"],
            "skipped_request_count": state["skipped_request_count"],
            "browser_render_index": self.render_count,
            "error_message": getattr(result, "error_message", None),
        }


async def render_once(args):
    renderer = Renderer(args.user_agent)
    try:
        return await renderer.render(request_from_args(args))
    finally:
        await renderer.close()


async def serve(args):
    """JSON-lines loop: one request per stdin line, one response per stdout line."""
    # Crawl4AI, Playwright and Chromium may write to stdout; keep that stream
    # for protocol lines only by pointing fd 1 at stderr.
    protocol = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    renderer = Renderer(args.user_agent, max_renders=max(1, args.max_renders))
    loop = asyncio.get_running_loop()
    try:
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            if not line.strip():
                continue

            request_id = None
            url = None
            try:
                request = json.loads(line)
                request_id = request.get("id")
                url = request.get("url")
                payload = await renderer.render(request)
            except Exception as error:
                payload = failure_payload(url, error)

            payload["id"] = request_id
            protocol.write(json.dumps(payload, ensure_ascii=False) + "\n")
            protocol.flush()
    finally:
        await renderer.close()


async def main():
    args = build_parser().parse_args()

    if args.serve:
        await serve(args)
        return 0

    try:
        payload = await render_once(args)
    except Exception as error:
        payload = failure_payload(args.url, error)

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
