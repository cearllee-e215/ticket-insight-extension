# Ticket Insight - Chrome Extension

Chrome extension that displays ticket price points and inventory data on Ticketmaster event pages.

## Installation

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder
5. Navigate to any Ticketmaster event page — the overlay appears automatically

> **Note:** If you have the Ticket Flipping Toolbox extension installed, disable it first to avoid XHR interception conflicts.

## What It Does

Displays a **Price Points** overlay on Ticketmaster event pages showing:

- All available ticket price points with ticket counts per \$10 bucket
- Color-coded swatches (green = cheapest, red = most expensive)
- Total ticket inventory breakdown (primary vs resale)
- Per-section ticket counts with best (lowest) price per section (expandable)

## How It Works

### 1. XHR Interception (`inject/xhr.js`)

Monkey-patches `XMLHttpRequest.prototype.open` and `.send` to intercept responses from Ticketmaster's **ISMDS** (Inventory & Seat Management Data Service) API. Specifically targets the `/api/ismds/event/{eventId}/facets/` endpoint, which returns the full inventory for an event.

### 2. Data Processing (`content.js`)

Receives the intercepted EventFacets response via `window.postMessage`, parses it, and:

- Groups tickets into \$10 price buckets using `Math.ceil(listPrice / 10) * 10`
- Extracts per-section data from resale offer details (section, row, seat, price)
- Calculates primary vs resale inventory counts

### 3. Overlay UI (`content.js`)

Renders a fixed-position panel with color-coded price point swatches and an expandable section-level detail view.

## Key Data Source

The extension reads the **ISMDS EventFacets API** response which contains:

- `facets[]`: Array of ticket groups with `count`, `listPriceRange`, `inventoryTypes`, and `offers[]`
- `_embedded.offer[]`: Detailed offer data including:
  - **Primary offers**: `listPrice`, `totalPrice`, `charges`, `priceLevelId`
  - **Resale offers**: All of the above plus `section`, `row`, `seatFrom`, `seatTo`, `faceValue`

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (Manifest V3) |
| `content.js` | Content script: injects interceptor, processes data, renders UI |
| `inject/xhr.js` | Page-context script: patches XHR to capture API responses |
