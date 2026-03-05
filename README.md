# Ticket Insight - Chrome Extension

Chrome extension that displays ticket price points, inventory data, seat map shading, and secondary market comparison on Ticketmaster event pages.

## Features

### Price Points Overlay
- Color-coded price point swatches (green = cheapest, red = most expensive)
- Ticket counts per $10 price bucket
- Total ticket inventory breakdown (primary vs resale)
- Click any price dot to highlight matching seats on the venue map

### Seat Map Shading
- Automatically colors seats on the Ticketmaster venue map by price range
- Click a specific price point to highlight only seats in that price range (others dim out)
- Blue ring indicates the currently selected price tier
- "Shade All Seats" and "Clear Shading" controls in the Customize menu

### Section Inventory (Popup)
- Click the extension icon to see per-section ticket counts
- Filter between All, Primary, and Resale tickets
- Each section shows total count with primary/resale breakdown
- Lowest price per section displayed

### Secondary Market Comparison
- Click the magnifying glass icon in the overlay header
- Quick links to search for the same event on StubHub, Vivid Seats, SeatGeek, Gametime, and TickPick
- Opens in new tabs for easy price comparison

## Installation

1. Clone or download this repo
2. Open Chrome and go to \`chrome://extensions/\`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder
5. Navigate to any Ticketmaster event page - the overlay appears automatically

> **Note:** If you have the Ticket Flipping Toolbox extension installed, disable it first to avoid XHR interception conflicts.

## How It Works

1. **XHR Interception** (\`inject/xhr.js\`): Intercepts Ticketmaster's ISMDS API responses containing event facets data
2. **Data Processing** (\`content.js\`): Parses facets into price buckets, section-level inventory, and primary/resale breakdowns
3. **Overlay Rendering** (\`content.js\`): Builds the Price Points overlay with clickable swatches, filters, and section details
4. **Seat Map Shading** (\`content.js\`): Colors SVG seat map elements to match price tiers
5. **Secondary Market** (\`content.js\`): Generates search links for secondary ticket marketplaces
6. **Popup UI** (\`popup.html\` + \`popup.js\`): Extension icon popup showing section-level inventory with filtering

## File Structure

\`\`\`
ticket-insight-extension/
  inject/
    xhr.js          # XHR interceptor for ISMDS API
  content.js        # Main content script (overlay, shading, secondary market)
  manifest.json     # Extension manifest (v3)
  popup.html        # Extension popup UI
  popup.js          # Popup logic (section inventory, filters)
  README.md         # This file
\`\`\`
