# Ticket Insight - Chrome Extension v2.0

Chrome extension that displays ticket price points, inventory data, seat map shading, and secondary market comparison on Ticketmaster event pages.

## Features

### Price Points Overlay
- Color-coded price point swatches (green = cheapest, red = most expensive)
- - Ticket counts per $10 price bucket
  - - Total ticket inventory breakdown (primary vs resale)
    - - Click any price dot to highlight matching seats on the venue map
      - - Auto-shading with MutationObserver for dynamic map updates
       
        - ### Seat Map Shading
        - - Automatically colors seat dots on the Ticketmaster venue map by price range
          - - Uses `data-section-name` on `svg__block` elements for accurate section mapping
            - - Click a specific price point to highlight only seats in that price range (others dim out)
              - - Blue ring indicates the currently selected price tier
                - - "Shade All" and "Clear" controls in the Customize menu
                  - - Periodic re-shading to handle TM's dynamic seat map updates
                   
                    - ### Section Inventory (Popup)
                    - - Click the extension icon to see per-section ticket counts
                      - - **Search** sections by number (supports "300s" prefix matching)
                        - - **Sort** by section, price (low/high), or ticket count
                          - - **Filter** by price level ($30-60, $60-100, $100+)
                            - - **Resale toggle** - resale hidden by default, toggle to show
                              - - Proper **Primary / Resale separation** with distinct headers and color coding
                                - - Minimum price prominently displayed in summary
                                  - - **Copy All Data** button exports full report to clipboard
                                   
                                    - ### Secondary Market Comparison
                                    - - Click the search icon to open secondary market links
                                      - - Quick links to StubHub, Vivid Seats, SeatGeek, Gametime, and TickPick
                                       
                                        - ## Installation
                                       
                                        - 1. Clone or download this repository
                                          2. 2. Open Chrome and go to `chrome://extensions`
                                             3. 3. Enable "Developer mode" (top right)
                                                4. 4. Click "Load unpacked" and select the extension folder
                                                   5. 5. Navigate to any Ticketmaster event page
                                                     
                                                      6. ## File Structure
                                                     
                                                      7. - `manifest.json` - Extension manifest (Manifest V3)
                                                         - - `content.js` - Content script: data processing, overlay rendering, seat map shading
                                                           - - `popup.html` - Popup UI with search, sort, filter controls
                                                             - - `popup.js` - Popup logic: primary/resale separation, search, sort, copy
                                                               - - `inject/xhr.js` - XHR + Fetch interceptor for ISMDS API data capture
                                                                
                                                                 - ## How It Works
                                                                
                                                                 - 1. `inject/xhr.js` intercepts both XHR and Fetch requests to Ticketmaster's ISMDS API
                                                                   2. 2. When EventFacets data is captured, it's passed to `content.js` via `postMessage`
                                                                      3. 3. `content.js` processes the data into price buckets and section inventory
                                                                         4. 4. The Price Points overlay renders with clickable swatches that shade the seat map
                                                                            5. 5. The popup communicates with `content.js` via `chrome.runtime.sendMessage` to display inventory
