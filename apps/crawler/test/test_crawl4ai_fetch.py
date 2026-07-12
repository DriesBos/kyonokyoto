import asyncio
import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "src" / "crawl4ai-fetch.py"
SPEC = importlib.util.spec_from_file_location("crawl4ai_fetch", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Crawl4AiNetworkGuardTest(unittest.TestCase):
    def test_request_url_guard_blocks_private_and_unsupported_targets(self):
        check = MODULE.is_safe_request_url

        async def mixed_address_resolver(_hostname, _port):
            return [
                (None, None, None, None, ("8.8.8.8", 443)),
                (None, None, None, None, ("127.0.0.1", 443)),
            ]

        self.assertTrue(asyncio.run(check("https://8.8.8.8/image.jpg")))
        self.assertFalse(asyncio.run(check("http://127.0.0.1/admin")))
        self.assertFalse(asyncio.run(check("http://169.254.169.254/latest/meta-data")))
        self.assertFalse(
            asyncio.run(
                check("https://mixed.example/image.jpg", resolver=mixed_address_resolver)
            )
        )
        self.assertFalse(asyncio.run(check("file:///etc/passwd")))
        self.assertTrue(asyncio.run(check("data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yw=")))

    def test_main_navigation_domain_matching_allows_subdomains_only(self):
        allowed = ["museum.example"]

        self.assertTrue(MODULE.hostname_allowed("www.museum.example", allowed))
        self.assertFalse(MODULE.hostname_allowed("museum.example.attacker.test", allowed))
        self.assertEqual(
            MODULE.canonical_navigation_url("https://Museum.Example:443/event#section"),
            MODULE.canonical_navigation_url("https://museum.example/event"),
        )
        self.assertNotEqual(
            MODULE.canonical_navigation_url("https://museum.example/event"),
            MODULE.canonical_navigation_url("https://museum.example/other"),
        )

    def test_renderer_disables_service_workers_and_routes_websockets(self):
        source = MODULE_PATH.read_text(encoding="utf-8")

        self.assertIn('extra_args=["--disable-features=ServiceWorker"]', source)
        self.assertIn("ignore_https_errors=False", source)
        self.assertIn('route_web_socket("**", block_web_socket)', source)
        self.assertIn("ServiceWorkerContainer.prototype", MODULE.SERVICE_WORKER_BLOCK_SCRIPT)


if __name__ == "__main__":
    unittest.main()
