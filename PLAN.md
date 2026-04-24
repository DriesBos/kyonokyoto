# Plan

## Product

Build a Kyoto cultural events app that crawls museums, galleries, festival pages, and venue sites, then turns that data into a clean editorial cultural event calendar.

## MVP Scope

- Start with 5-10 Kyoto source websites
- Crawl only event-related pages
- Extract: title, subtitle, date, venue, image, description, source URL
- Store both raw page data and normalized event records
- Publish directly after crawl, extraction, and deduplication

## Build Steps

1. Make a source list of Kyoto museums, galleries, and event sites.
2. Define the event schema and give examples of source schemas.
3. Set up the crawler locally and crawl a few seed sites.
4. Add extraction rules for dates, venue names, titles, and images.
5. Normalize and deduplicate events.
6. Other crawler finetuning if needed.
7. Save events into a small database and publish directly.
8. Scaffold the frontend.
9. Connect Figma through MCP and build a shared design system (style spacing, color, font constants) and reusable components.
10. Build the public list UI from the Figma design.
11. Add scheduled recrawls and basic crawl logs.

## Tech Stack

- Frontend: Astro, hosted on Netlify
- Database: Postgres via Supabase, hosted on a Supabase free tier
- Crawler worker: Crawl4AI, running daily using CRON from a VPS and Python venv
- VPS: AWS Lightsail
- Git: GitHub
- Design: Figma
- Other: Fallow (codebase analysis)

## First Milestone

- Scaffold the tech stack

## Learning

For every project I try to learn something new. Please give explainers and context where relevant. My learning goals for this porject are:

1. To learn more about crawlers, how they work, and how to set them up in a project.
2. To learn about Astro, experience development with Astro and its speed and tradeoffs.
3. To learn about using and implementing a simple postgres database.
