/**
 * Google Maps links pasted from a phone come in many shapes:
 *   https://maps.app.goo.gl/XXXX                (share sheet short link)
 *   https://www.google.com/maps/place/Name/@lat,lng,17z/...
 *   https://goo.gl/maps/XXXX
 *   https://maps.google.com/?q=Name+Address
 * We extract whatever we can locally and let the generator research the rest.
 */
export type MapsInfo = {
  valid: boolean;
  placeName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  shortLink: boolean;
};

const MAPS_HOSTS = [
  "maps.app.goo.gl", "goo.gl", "maps.google.com", "www.google.com",
  "google.com", "g.co", "maps.google.co.uk",
];

export function parseMapsUrl(raw: string): MapsInfo {
  const empty: MapsInfo = {
    valid: false, placeName: "", address: "", lat: null, lng: null, shortLink: false,
  };
  const input = (raw ?? "").trim();
  if (!input) return empty;

  let url: URL;
  try {
    url = new URL(input.startsWith("http") ? input : `https://${input}`);
  } catch {
    return empty;
  }

  const host = url.hostname.toLowerCase();
  const isMaps =
    MAPS_HOSTS.includes(host) &&
    (host.includes("goo.gl") || host.includes("g.co") || url.pathname.includes("/maps"));
  if (!isMaps) return empty;

  const shortLink = host.includes("goo.gl") || host.includes("g.co");
  if (shortLink) return { ...empty, valid: true, shortLink: true };

  // /maps/place/<Name>/@lat,lng,zoom/...
  let placeName = "";
  const placeMatch = url.pathname.match(/\/maps\/place\/([^/@]+)/);
  if (placeMatch) {
    placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, " ")).trim();
  }

  let lat: number | null = null;
  let lng: number | null = null;
  const at = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) {
    lat = Number(at[1]);
    lng = Number(at[2]);
  }

  const q = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
  let address = "";
  if (q && !/^-?\d+\.\d+,/.test(q)) {
    const parts = q.split(",");
    if (!placeName) placeName = parts[0].trim();
    address = q.trim();
  }

  return { valid: true, placeName, address, lat, lng, shortLink: false };
}

export function isProbablyMapsUrl(raw: string): boolean {
  return parseMapsUrl(raw).valid;
}
