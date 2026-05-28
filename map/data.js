/* Voyager — Nova Scotia map data (regions, POIs, link overrides, heat).
 * Ported verbatim from the NovaScotiaVoyage Next.js source so the standalone
 * map renders identical content. Updating this file is the source of truth for
 * what shows up on /map. */
(function attachVoyagerData(global) {
  "use strict";

  var CATEGORY_COLORS = {
    adventure:    "#f97316",
    culture:      "#a855f7",
    food:         "#eab308",
    "hidden-gems":"#f43f5e",
    nightlife:    "#8b5cf6",
    "water-sports":"#06b6d4",
    music:        "#ef4444",
    art:          "#d946ef",
    creative:     "#ec4899",
    wildlife:     "#22c55e",
    scenic:       "#3b82f6"
  };

  var CATEGORY_LABELS = {
    adventure:     "Adventure",
    culture:       "Culture & Heritage",
    food:          "Food & Drink",
    "hidden-gems": "Hidden Gem Eats",
    nightlife:     "Bars & Nightlife",
    "water-sports":"Water Activities",
    music:         "Live Music",
    art:           "Art & Galleries",
    creative:      "Creative Workshops",
    wildlife:      "Wildlife",
    scenic:        "Scenic Views"
  };

  var CATEGORY_ICONS = {
    adventure:     "\uD83C\uDFD4\uFE0F",
    culture:       "\uD83C\uDFDB\uFE0F",
    food:          "\uD83C\uDF7D\uFE0F",
    "hidden-gems": "\uD83D\uDC8E",
    nightlife:     "\uD83C\uDF78",
    "water-sports":"\uD83C\uDF0A",
    music:         "\uD83C\uDFB5",
    art:           "\uD83C\uDFA8",
    creative:      "\u2728",
    wildlife:      "\uD83D\uDC0B",
    scenic:        "\uD83D\uDCF8"
  };

  var regions = [
    { id:"halifax-metro",     name:"Halifax & Central",     slug:"halifax-metro",     description:"Urban waterfront culture, historic citadel, craft breweries, and Peggy's Cove lighthouse adventures.", tagline:"Atlantic Canada's vibrant capital region",   color:"#0ea5e9", center:[-63.575,44.648], zoom:9.5, highlightCount:142 },
    { id:"south-shore",       name:"South Shore",           slug:"south-shore",       description:"UNESCO Lunenburg, Mahone Bay charm, surf at Lawrencetown, and iconic coastal drives.",                  tagline:"Lighthouses, fishing villages & surf",        color:"#14b8a6", center:[-64.316,44.377], zoom:8.8, highlightCount:98  },
    { id:"annapolis-valley",  name:"Annapolis Valley",      slug:"annapolis-valley",  description:"Wine country, u-pick orchards, tidal bore rafting, and Acadian heritage in Grand-Pré.",                  tagline:"Vineyards, orchards & tidal rivers",          color:"#84cc16", center:[-64.736,45.088], zoom:8.5, highlightCount:76  },
    { id:"bay-of-fundy",      name:"Bay of Fundy",          slug:"bay-of-fundy",      description:"World's highest tides, fossil cliffs at Joggins, whale watching, and rugged coastal trails.",            tagline:"Tides, fossils & whale migrations",           color:"#6366f1", center:[-64.368,45.372], zoom:8.2, highlightCount:84  },
    { id:"eastern-shore",     name:"Eastern Shore",         slug:"eastern-shore",     description:"Wild surf beaches, sea kayaking, wilderness islands, and authentic fishing communities.",                tagline:"Untamed coastline & wilderness",              color:"#0891b2", center:[-62.454,44.934], zoom:8.0, highlightCount:52  },
    { id:"cape-breton",       name:"Cape Breton Island",    slug:"cape-breton",       description:"Cabot Trail drives, Celtic culture, Highlands hiking, Bras d'Or Lake sailing, and ceilidhs.",              tagline:"Highlands, Celtic soul & Cabot Trail",        color:"#f97316", center:[-60.75,46.25],   zoom:8.0, highlightCount:118 },
    { id:"yarmouth-acadian",  name:"Yarmouth & Acadian Shore", slug:"yarmouth-acadian", description:"Acadian culture, Cape Forchu lighthouse, deep-sea fishing charters, and artisan communities.",            tagline:"Acadian heritage & deep-sea adventures",      color:"#a855f7", center:[-66.12,43.837],  zoom:8.5, highlightCount:64  }
  ];

  var regionsGeoJSON = {
    type: "FeatureCollection",
    features: [
      { type:"Feature", properties:{ id:"halifax-metro",    name:"Halifax & Central",     color:"#0ea5e9" }, geometry:{ type:"Polygon", coordinates:[[[-64.05,44.35],[-63.0,44.35],[-62.85,44.75],[-63.1,45.05],[-64.2,45.0],[-64.05,44.35]]] } },
      { type:"Feature", properties:{ id:"south-shore",      name:"South Shore",           color:"#14b8a6" }, geometry:{ type:"Polygon", coordinates:[[[-65.2,43.85],[-63.8,43.85],[-63.5,44.35],[-64.2,44.75],[-65.2,44.5],[-65.2,43.85]]] } },
      { type:"Feature", properties:{ id:"annapolis-valley", name:"Annapolis Valley",      color:"#84cc16" }, geometry:{ type:"Polygon", coordinates:[[[-65.4,44.75],[-64.0,44.75],[-63.9,45.45],[-65.0,45.45],[-65.4,44.75]]] } },
      { type:"Feature", properties:{ id:"bay-of-fundy",     name:"Bay of Fundy",          color:"#6366f1" }, geometry:{ type:"Polygon", coordinates:[[[-66.0,44.9],[-64.8,44.9],[-64.5,45.8],[-65.8,45.8],[-66.0,44.9]]] } },
      { type:"Feature", properties:{ id:"eastern-shore",    name:"Eastern Shore",         color:"#0891b2" }, geometry:{ type:"Polygon", coordinates:[[[-63.0,44.5],[-61.5,44.5],[-61.2,45.4],[-62.5,45.4],[-63.0,44.5]]] } },
      { type:"Feature", properties:{ id:"cape-breton",      name:"Cape Breton Island",    color:"#f97316" }, geometry:{ type:"Polygon", coordinates:[[[-61.5,45.5],[-59.7,45.5],[-59.7,47.1],[-61.5,47.1],[-61.5,45.5]]] } },
      { type:"Feature", properties:{ id:"yarmouth-acadian", name:"Yarmouth & Acadian Shore", color:"#a855f7" }, geometry:{ type:"Polygon", coordinates:[[[-66.5,43.4],[-65.0,43.4],[-64.9,44.5],[-66.5,44.5],[-66.5,43.4]]] } }
    ]
  };

  var POI_LINK_OVERRIDES = {
    "peggys-cove":               { websiteUrl:"https://visitpeggyscove.ca" },
    "halifax-waterfront":        { websiteUrl:"https://buildns.ca/visit/halifax/" },
    "citadel-hill":              { websiteUrl:"https://parks.canada.ca/lhn-nhs/ns/halifax", instagramUrl:"https://instagram.com/halifaxcitadel", facebookUrl:"https://facebook.com/ParksCanadaHalifax" },
    "lunenburg-unesco":          { websiteUrl:"https://townoflunenburg.ca", instagramUrl:"https://instagram.com/townoflunenburgns", facebookUrl:"https://facebook.com/townoflunenburgns" },
    "lawrencetown-surf":         { websiteUrl:"https://ecsurfschool.com", bookingUrl:"https://bookeo.com/ecsurfschool" },
    "mahone-bay-kayak":          { websiteUrl:"https://capelahaveadventures.ca", instagramUrl:"https://instagram.com/capelahaveadventures", bookingUrl:"https://capelahaveadventures.ca" },
    "wolfville-wineries":        { websiteUrl:"https://winesofnovascotia.ca", instagramUrl:"https://instagram.com/winesofns", facebookUrl:"https://facebook.com/winesofns" },
    "tidal-bore-rafting":        { websiteUrl:"https://riverrunnersns.com", bookingUrl:"https://riverrunnersns.com" },
    "grand-pre":                 { websiteUrl:"https://parks.canada.ca/lhn-nhs/ns/grandpre" },
    "joggins-fossils":           { websiteUrl:"https://jogginsfossilcliffs.net", instagramUrl:"https://instagram.com/jogginsfossilcliffs", facebookUrl:"https://facebook.com/Joggins.Fossil.Cliffs", bookingUrl:"https://jogginsfossilcliffs.checkfront.com/reserve/" },
    "cape-split":                { websiteUrl:"https://parks.novascotia.ca/park/cape-split" },
    "balancing-rock":            { websiteUrl:"https://digbyarea.ca/plan-your-visit/digby-neck-and-islands/balancing-rock/" },
    "canso-wildlife":            { websiteUrl:"https://parks.canada.ca/lhn-nhs/ns/canso" },
    "taylor-head":               { websiteUrl:"https://parks.novascotia.ca/park/taylor-head" },
    "cabot-trail":               { websiteUrl:"https://www.cbisland.com/en/regions/cabot-trail", instagramUrl:"https://instagram.com/visitcapebretonisland", facebookUrl:"https://facebook.com/TourismCB" },
    "skyline-trail":             { websiteUrl:"https://parks.canada.ca/pn-np/ns/cbreton/activ/randonnee-hiking/skyline", bookingUrl:"https://reservation.pc.gc.ca/" },
    "bras-dor-sailing":          { websiteUrl:"https://sailingcbi.com", instagramUrl:"https://instagram.com/sailingcbi", facebookUrl:"https://facebook.com/sailingcbi", bookingUrl:"https://sailingcbi.com" },
    "celtic-colours":            { websiteUrl:"https://celtic-colours.com", instagramUrl:"https://instagram.com/celticcolours", facebookUrl:"https://facebook.com/celticcolours", bookingUrl:"https://tickets.celtic-colours.com" },
    "cape-forchu":               { websiteUrl:"https://capeforchu.com", facebookUrl:"https://facebook.com/capeforchu" },
    "shark-fishing-yarmouth":    { websiteUrl:"https://www.bluesharkcharters.com", bookingUrl:"https://www.bluesharkcharters.com" },
    "glass-art-workshop":        { websiteUrl:"https://www.acadianglassart.com", facebookUrl:"https://facebook.com/acadianglass.art" },
    "halifax-food-tour":         { websiteUrl:"https://www.halifaxfoodtours.com", bookingUrl:"https://www.halifaxfoodtours.com" },
    "cage-diving":               { websiteUrl:"https://atlanticsharkexp.com", bookingUrl:"https://atlanticsharkexp.com/product/halifax-shark-cage-diving-expedition/" },
    "the-wooden-monkey":         { websiteUrl:"https://www.thewoodenmonkey.ca", instagramUrl:"https://instagram.com/thewoodenmonkeyrestaurants", facebookUrl:"https://facebook.com/TheWoodenMonkey", bookingUrl:"https://www.thewoodenmonkey.ca/reservations" },
    "morris-east-pizza":         { websiteUrl:"https://www.morriseast.com" },
    "tare-tare-ramen":           { websiteUrl:"https://butaramen.ca", facebookUrl:"https://facebook.com/buta-ramen5190" },
    "the-salty-dog":             { websiteUrl:"http://www.mishoos.ca" },
    "fishermans-daughter":       { websiteUrl:"http://www.southshorefishshack.com" },
    "the-kitchen-witch":         { websiteUrl:"https://joannsdelimarket.ca" },
    "bridgewater-burger":        { facebookUrl:"https://facebook.com/Jacsburgersandshakes" },
    "tidal-bay-oysters":         { websiteUrl:"https://www.wolfvillefarmersmarket.ca" },
    "grand-pre-farm-kitchen":    { websiteUrl:"https://grandprewines.com", bookingUrl:"https://resy.com/cities/grndp/le-caveau" },
    "port-williams-cafe":        { websiteUrl:"http://www.theportpub.com" },
    "parsboro-chowder":          { websiteUrl:"https://harbourviewns.ca", facebookUrl:"https://facebook.com/harbourviewresto" },
    "advocate-harbour-pie":      { websiteUrl:"https://wildcaraway.com", instagramUrl:"https://instagram.com/wildcaraway", facebookUrl:"https://facebook.com/wildcaraway", bookingUrl:"https://portal.freetobook.com/reservations?w_id=47651" },
    "sheet-harbour-diner":       { websiteUrl:"https://www.henleyhouse.ca" },
    "guysborough-galley":        { websiteUrl:"https://www.authenticseacoast.com" },
    "baddeck-bakery":            { websiteUrl:"https://visitbaddeck.com/highwheeler-cafe", instagramUrl:"https://instagram.com/highwheelercafe", facebookUrl:"https://facebook.com/baddeckcafe" },
    "ch\u00E9ticamp-co-op":      { websiteUrl:"https://legabriel.com" },
    "ingonish-cliff-cafe":       { instagramUrl:"https://instagram.com/mainstreetrestaurant_bakery", facebookUrl:"https://facebook.com/mainstreetrestaurantingonish" },
    "wedgeport-lobster":         { facebookUrl:"https://facebook.com/DennisPointCafe" },
    "meteghan-fish-fry":         { websiteUrl:"https://www.sipcafe.ca", facebookUrl:"https://facebook.com/Sipmeteghan" },
    "the-marquee":               { websiteUrl:"https://2037gottingen.ca/marquee/", instagramUrl:"https://instagram.com/2037gottingen", facebookUrl:"https://facebook.com/2037gottingen" },
    "propeller-brewing":         { websiteUrl:"https://drinkpropeller.ca", instagramUrl:"https://instagram.com/propellerbeer", facebookUrl:"https://facebook.com/propellerbeer" },
    "the-lower-deck":            { websiteUrl:"https://lowerdeck.ca", instagramUrl:"https://instagram.com/thelowerdeckhfx", facebookUrl:"https://facebook.com/TheLowerDeckHFX" },
    "stillwell-beer-bar":        { websiteUrl:"https://www.barstillwell.com", instagramUrl:"https://instagram.com/barstillwell", facebookUrl:"https://facebook.com/barstillwell" },
    "the-wardroom":              { websiteUrl:"https://ksu.ca/the-wardy-the-galley/", instagramUrl:"https://instagram.com/thewardroom" },
    "mahone-bay-brewing":        { websiteUrl:"https://saltboxbrewingcompany.ca" },
    "wolfville-pubs":            { websiteUrl:"https://paddyswolfville.ca/welcome", instagramUrl:"https://instagram.com/paddyswolfville", facebookUrl:"https://facebook.com/143186965715096/" },
    "luckett-vineyards-bar":     { websiteUrl:"https://www.luckettvineyards.com", instagramUrl:"https://instagram.com/luckettvineyards", facebookUrl:"https://facebook.com/luckettvineyards" },
    "sydney-waterfront-pub":     { websiteUrl:"https://governorseatery.com", instagramUrl:"https://instagram.com/governors_pub", facebookUrl:"https://facebook.com/GovernorsPub" },
    "yarmouth-rudder":           { websiteUrl:"https://ruddersbrewpub.com", instagramUrl:"https://instagram.com/ruddersbrewpub", facebookUrl:"https://facebook.com/ruddersbrewpub" },
    "the-local":                 { websiteUrl:"https://2037gottingen.ca/local/", instagramUrl:"https://instagram.com/thelocalhfx", facebookUrl:"https://facebook.com/thelocalhfx" },
    "halifax-harbour-kayak":     { websiteUrl:"https://www.eastcoastoutfitters.com", instagramUrl:"https://instagram.com/ecokayakns", bookingUrl:"https://www.eastcoastoutfitters.com/tours/" },
    "eastern-passage-sup":       { websiteUrl:"https://lunar-adventures.com", instagramUrl:"https://instagram.com/lunaradventureshfx", facebookUrl:"https://facebook.com/p/Lunar-Adventures-100094980842804", bookingUrl:"https://lunar-adventures.com" },
    "peggys-cove-boat-tour":     { websiteUrl:"https://www.peggyscoveboattours.com", facebookUrl:"https://facebook.com/peggyscoveboattours", bookingUrl:"https://www.peggyscoveboattours.com/tours/book-a-tour.html" },
    "bluenose-sailing":          { websiteUrl:"https://bluenose.novascotia.ca", instagramUrl:"https://instagram.com/sailbluenoseii", facebookUrl:"https://facebook.com/sailbluenoseii", bookingUrl:"https://bluenose.novascotia.ca/schedule" },
    "white-point-snorkel":       { websiteUrl:"https://www.whitepoint.com", instagramUrl:"https://instagram.com/whitepointbeachresort", facebookUrl:"https://facebook.com/whitepointbeachresort" },
    "river-rafting-annapolis":   { websiteUrl:"https://www.dunromincampground.ca", bookingUrl:"https://www.dunromincampground.ca/boating/" },
    "burntcoat-head-tidal":      { websiteUrl:"https://www.burntcoatheadpark.ca", instagramUrl:"https://instagram.com/burntcoatheadpark", facebookUrl:"https://facebook.com/Burntcoat.Head.Park", bookingUrl:"https://www.burntcoatheadpark.ca/guided-ocean-floor-tours/" },
    "hopewell-kayak":            { websiteUrl:"https://www.baymountadventures.com", bookingUrl:"https://www.baymountadventures.com" },
    "advocate-kayak":            { websiteUrl:"https://novashores.com", instagramUrl:"https://instagram.com/kayaknovashores", facebookUrl:"https://facebook.com/kayaknovascotia", bookingUrl:"https://novashores.com" },
    "taylor-head-kayak":         { websiteUrl:"https://www.coastaladventures.com", instagramUrl:"https://instagram.com/coastaladventures.ns", bookingUrl:"https://www.coastaladventures.com" },
    "liscomb-river-paddle":      { websiteUrl:"https://www.liscombelodge.ca" },
    "ingonish-beach-surf":       { websiteUrl:"https://www.richmondcounty.ca/surfing.html" },
    "whycocomagh-kayak":         { websiteUrl:"https://kayakcapebreton.squarespace.com", bookingUrl:"https://kayakcapebreton.squarespace.com/boat-rentals" },
    "cheticamp-whale-paddle":    { websiteUrl:"https://www.cabottrailadventures.com", facebookUrl:"https://facebook.com/riverside1108", bookingUrl:"https://www.cabottrailadventures.com" },
    "tuna-charters-yarmouth":    { websiteUrl:"https://jacquardstuna.ca" },
    "lake-milo-swim":            { websiteUrl:"https://yarmouthrecreation.ca/facilities/lake-milo-aquatic-club/" },
    "halifax-whale-watch":       { websiteUrl:"http://www.amseacharters.com" },
    "crystal-crescent-snorkel":  { websiteUrl:"https://torpedorays.com", instagramUrl:"https://instagram.com/torpedorays", facebookUrl:"https://facebook.com/TorpedoRays", bookingUrl:"https://torpedorays.com" },
    "carleton-music-bar":        { websiteUrl:"https://www.thecarleton.ca", instagramUrl:"https://instagram.com/carletonhalifax", bookingUrl:"https://www.thecarleton.ca/events/" },
    "dee-dees":                  { websiteUrl:"https://deedees.ca", instagramUrl:"https://instagram.com/deedeesicecream", facebookUrl:"https://facebook.com/DeeDees.IceCream" },
    "halifax-jazz-festival":     { websiteUrl:"https://www.halifaxjazzfestival.ca", instagramUrl:"https://instagram.com/hfxjazzfest", facebookUrl:"https://facebook.com/hfxjazzfest", bookingUrl:"https://www.tixr.com/groups/halifaxjazzfest" },
    "neptune-theatre":           { websiteUrl:"https://www.neptunetheatre.com", instagramUrl:"https://instagram.com/neptunetheatre", facebookUrl:"https://facebook.com/neptunetheatre", bookingUrl:"https://www.neptunetheatre.com" },
    "lunenburg-folk-harbour":    { websiteUrl:"https://folkharbour.com", instagramUrl:"https://instagram.com/folkharbour", facebookUrl:"https://facebook.com/LunenburgFolkHarbourSociety", bookingUrl:"https://tproatlantic.ticketpro.ca/en/pages/LFHF2026" },
    "devour-food-film-music":    { websiteUrl:"https://devourfest.com", instagramUrl:"https://instagram.com/devour_fest", facebookUrl:"https://facebook.com/devour_fest", bookingUrl:"https://devourfest.com" },
    "sydney-cape-breton-fiddlers":{ websiteUrl:"https://capebretonfiddlers.com" },
    "red-shoe-pub":              { websiteUrl:"https://www.redshoepub.com", instagramUrl:"https://instagram.com/redshoepub_official", facebookUrl:"https://facebook.com/redshoepub" },
    "strathspey-pavilion":       { websiteUrl:"https://www.strathspeyplace.com", instagramUrl:"https://instagram.com/strathspeymabou", facebookUrl:"https://facebook.com/StrathspeyPerformingArtsCentre", bookingUrl:"https://www.strathspeyplace.com/performances/" },
    "ch\u00E9ticamp-acadian-music":{ websiteUrl:"https://www.micareme.com", instagramUrl:"https://instagram.com/lamicareme", facebookUrl:"https://facebook.com/lamicareme" },
    "art-gallery-ns-concert":    { websiteUrl:"https://www.agns.ca", instagramUrl:"https://instagram.com/artgalleryns", facebookUrl:"https://facebook.com/ArtGalleryNS", bookingUrl:"https://www.agns.ca/events/" },
    "art-gallery-ns":            { websiteUrl:"https://agns.ca", instagramUrl:"https://instagram.com/artgalleryns", facebookUrl:"https://facebook.com/ArtGalleryNS", bookingUrl:"https://shopagns.ca/products/admissions" },
    "halifax-graffiti-alley":    { websiteUrl:"https://downtownhalifax.ca/arttour" },
    "downtown-galleries":        { websiteUrl:"https://www.argylefineart.com", instagramUrl:"https://instagram.com/argyle_fine_art", facebookUrl:"https://facebook.com/argyle_fine_art" },
    "ns-college-art-design":     { websiteUrl:"https://theanna.nscad.ca", instagramUrl:"https://instagram.com/annaleonowensgallery" },
    "lunenburg-art-gallery":     { websiteUrl:"https://www.lunenburgartgallery.com", instagramUrl:"https://instagram.com/lunenburgartsociety", facebookUrl:"https://facebook.com/lunartgallery" },
    "fisheries-museum-art":      { websiteUrl:"https://fisheriesmuseum.novascotia.ca", instagramUrl:"https://instagram.com/fisheriesmuseumoftheatlantic", facebookUrl:"https://facebook.com/FisheriesMuseumoftheAtlantic" },
    "acadia-university-art":     { websiteUrl:"https://gallery.acadiau.ca", instagramUrl:"https://instagram.com/acadiagallery", facebookUrl:"https://facebook.com/artgallery.acadiauniversity" },
    "joggins-fossil-centre-art": { websiteUrl:"https://jogginsfossilcliffs.net", instagramUrl:"https://instagram.com/jogginsfossilcliffs", facebookUrl:"https://facebook.com/jogginsfossilcliffs", bookingUrl:"https://jogginsfossilcliffs.checkfront.com/reserve/" },
    "cheticamp-rug-hooking":     { websiteUrl:"https://www.lestroispignons.com/en/", instagramUrl:"https://instagram.com/lestroispignons", facebookUrl:"https://facebook.com/lestroispignons" },
    "membertou-heritage-park":   { websiteUrl:"https://www.membertouheritagepark.com", facebookUrl:"https://facebook.com/people/Membertou-Heritage-Park/100054356507918" },
    "alexander-graham-bell-museum":{ websiteUrl:"https://www.parks.canada.ca/lhn-nhs/ns/grahambell", facebookUrl:"https://facebook.com/AGBNHS", bookingUrl:"https://reservation.pc.gc.ca" },
    "yarmouth-art-society":      { websiteUrl:"https://www.yarmouthartsociety.ca" },
    "acadian-museum-art":        { websiteUrl:"https://www.museeacadien.ca", facebookUrl:"https://facebook.com/museeacadiendespubnicos" },
    "point-pleasant-sculpture":  { websiteUrl:"https://www.halifax.ca/parks-recreation/parks-trails-gardens/parks-outdoor-spaces/point-pleasant-park" },
    "the-five-fishermen":        { websiteUrl:"https://www.fivefishermen.com", instagramUrl:"https://instagram.com/5fishermen", facebookUrl:"https://facebook.com/Fivefishermen", bookingUrl:"https://www.opentable.ca/the-five-fishermen" },
    "bicycle-thief":             { websiteUrl:"https://bicyclethief.ca", instagramUrl:"https://instagram.com/ourbicyclethief", facebookUrl:"https://facebook.com/bicyclethief1475" },
    "tonys-donair":              { websiteUrl:"https://www.tonysdonair.com" },
    "two-if-by-sea":             { websiteUrl:"https://www.twoifbysea.cafe", instagramUrl:"https://instagram.com/twoifbyseacafe", facebookUrl:"https://facebook.com/tibscafe" },
    "grand-banker":              { websiteUrl:"https://grandbanker.com", instagramUrl:"https://instagram.com/the_grand_banker", facebookUrl:"https://facebook.com/the_grand_banker" },
    "luckett-vineyards":         { websiteUrl:"https://www.luckettvineyards.com", instagramUrl:"https://instagram.com/luckettvineyards", facebookUrl:"https://facebook.com/luckettvineyards" },
    "domaine-de-grand-pre":      { websiteUrl:"https://grandprewines.com", instagramUrl:"https://instagram.com/grandprewines", facebookUrl:"https://facebook.com/GrandPreWines" },
    "hall-harbour-lobster":      { websiteUrl:"https://hallsharbourlobster.com", instagramUrl:"https://instagram.com/hallsharbourlobsterpound", facebookUrl:"https://facebook.com/HallsHarbourLobsterPoundRestaurant" },
    "digby-scallops":            { websiteUrl:"https://digbyscallopdays.square.site" },
    "lobster-supper-mabou":      { websiteUrl:"https://www.redshoepub.com", instagramUrl:"https://instagram.com/redshoepub_official", facebookUrl:"https://facebook.com/redshoepub" },
    "polly-cove-hike":           { websiteUrl:"https://www.halifaxtrails.ca/pollys-cove/" },
    "mcnabs-island":             { websiteUrl:"https://mcnabsisland.ca", instagramUrl:"https://instagram.com/friendsofmcnabsisland", facebookUrl:"https://facebook.com/McNabsIsland", bookingUrl:"https://www.eventbrite.com/o/friends-of-mcnabs-island-society-10724104906" },
    "bluff-wilderness":          { websiteUrl:"https://wrweo.ca/wp/the-bluff-trail/" },
    "crystal-crescent-hike":     { websiteUrl:"https://parks.novascotia.ca/park/crystal-crescent-beach" },
    "kejimkujik-canoe":          { websiteUrl:"https://parks.canada.ca/pn-np/ns/kejimkujik", bookingUrl:"https://www.whynotadventure.ca" },
    "bear-river-biking":         { websiteUrl:"https://annapoliscounty.ca" },
    "economy-falls":             { websiteUrl:"https://novascotia.ca/nse/protectedareas/wa_economyriver.asp" },
    "three-sisters-hike":        { websiteUrl:"https://parks.novascotia.ca/park/eatonville-day-use-area-cape-chignecto" },
    "sable-island-expedition":   { websiteUrl:"https://parks.canada.ca/pn-np/ns/sable", instagramUrl:"https://instagram.com/kattukexpeditions", facebookUrl:"https://facebook.com/kattukexpeditions", bookingUrl:"https://www.kattukexpeditions.com/sableislandhelicopter" },
    "cape-breton-highlands-biking":{ websiteUrl:"https://parks.canada.ca/pn-np/ns/cbreton/activ/cyclisme-cycling" },
    "middle-head-hike":          { websiteUrl:"https://parks.canada.ca/pn-np/ns/cbreton/activ/randonnee-hiking/middlehead", bookingUrl:"https://reservation.pc.gc.ca" },
    "pottery-workshop-lunenburg":{ websiteUrl:"https://lunenburgarts.org", instagramUrl:"https://instagram.com/the.lsa", facebookUrl:"https://facebook.com/LunenburgSchoolOfTheArts", bookingUrl:"https://lunenburgarts.org" },
    "hooking-workshop-ch\u00E9ticamp":{ websiteUrl:"https://www.lestroispignons.com/en/", instagramUrl:"https://instagram.com/lestroispignons", facebookUrl:"https://facebook.com/lestroispignons" },
    "whale-watching-brier-island":{ websiteUrl:"https://brierislandwhalewatch.com", instagramUrl:"https://instagram.com/brierislandwhalewatch", facebookUrl:"https://facebook.com/BrierIslandWhaleWatch", bookingUrl:"https://brierislandwhalewatch.com/reservations/" }
  };

  global.VOYAGER_DATA = global.VOYAGER_DATA || {};
  global.VOYAGER_DATA.regions = regions;
  global.VOYAGER_DATA.regionsGeoJSON = regionsGeoJSON;
  global.VOYAGER_DATA.categoryColors = CATEGORY_COLORS;
  global.VOYAGER_DATA.categoryLabels = CATEGORY_LABELS;
  global.VOYAGER_DATA.categoryIcons = CATEGORY_ICONS;
  global.VOYAGER_DATA.linkOverrides = POI_LINK_OVERRIDES;
  global.VOYAGER_DATA.heatClusterCenters = [
    { center:[-63.57,44.65],  regionId:"halifax-metro",    count:35, weight:1.0  },
    { center:[-64.31,44.38],  regionId:"south-shore",      count:28, weight:0.9  },
    { center:[-64.37,45.09],  regionId:"annapolis-valley", count:22, weight:0.75 },
    { center:[-64.42,45.35],  regionId:"bay-of-fundy",     count:24, weight:0.8  },
    { center:[-62.45,44.93],  regionId:"eastern-shore",    count:14, weight:0.55 },
    { center:[-60.75,46.25],  regionId:"cape-breton",      count:32, weight:0.95 },
    { center:[-66.12,43.84],  regionId:"yarmouth-acadian", count:18, weight:0.65 }
  ];
  global.VOYAGER_DATA.bounds = [[-66.5, 43.3], [-59.5, 47.2]];
  global.VOYAGER_DATA.defaultCenter = [-63.0, 45.0];
  global.VOYAGER_DATA.defaultZoom = 6.2;
  global.VOYAGER_DATA.mapboxStyle = "mapbox://styles/mapbox/dark-v11";
})(window);
