import assert from "node:assert/strict";
import test from "node:test";

import { mapSourcesForEvents } from "../src/lib/sources.ts";

test("map sources include permanent events without source config rows", () => {
  const event = {
    id: "permanent:sayuu",
    source_id: "sayuu",
    title: "Permanent collection",
    categories: ["craft", "gallery"],
    date_text: "Permanent",
    institution_name: "SAYUU",
    venue_name: null,
    address_text: "15-1 Nyakuoji-cho, Sakyo-ku, Kyoto 606-8444 Japan",
    directions_query: "京都市左京区若王子町15-1",
    lat: 35.0155614,
    lng: 135.7955184,
    start_date: null,
    end_date: null,
    calendar_starts_at: null,
    calendar_ends_at: null,
    primary_image_url: null,
    image_urls: [],
    source_url: "https://sayuu.jp/",
    description: null,
    timing: "permanent",
  };

  const mapSources = mapSourcesForEvents([event], new Map([[event.id, "sayuu"]]), []);

  assert.deepEqual(mapSources, [
    {
      id: "sayuu:35.015561:135.795518:sayuu",
      sourceSlug: "sayuu",
      name: "SAYUU",
      categories: ["craft", "gallery"],
      lat: 35.0155614,
      lng: 135.7955184,
    },
  ]);
});
