from django.test import TestCase, override_settings
from django.urls import clear_url_caches
from importlib import reload


class HealthAndDocsTests(TestCase):
    def test_health_is_public_and_reports_ok(self):
        r = self.client.get("/api/health/")
        self.assertEqual((r.status_code, r.json()["status"]), (200, "ok"))

    def test_docs_schema_generates_without_errors(self):
        r = self.client.get("/api/schema/")
        self.assertEqual(r.status_code, 200)
        self.assertIn(b"/api/leases/", r.content)

    def test_docs_disabled_by_setting(self):
        import config.urls
        with override_settings(API_DOCS_ENABLED=False):
            clear_url_caches()
            reload(config.urls)
            try:
                self.assertEqual(self.client.get("/api/schema/").status_code, 404)
            finally:
                pass
        clear_url_caches()
        reload(config.urls)
