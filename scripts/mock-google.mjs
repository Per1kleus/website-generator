#!/usr/bin/env node
/**
 * A stand-in for Google OAuth, Sheets and Drive.
 *
 * There are no real Google credentials in CI or in this container, and
 * "it will probably work" is not verification. This implements the exact
 * endpoints and response shapes the app uses, so the OAuth exchange, token
 * refresh, spreadsheet listing, value reading and Drive image download are all
 * genuinely exercised.
 *
 * The fixture sheet deliberately contains bad rows — an empty name, a bad
 * price, a junk checkbox and an unreachable image — so per-row validation is
 * tested rather than assumed.
 *
 *   node scripts/mock-google.mjs [port]
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const port = Number(process.argv[2] || 11700);

/* A tiny real PNG, built by hand so the resolver has actual image bytes. */
function png(r, g, b) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, crcBuf]);
  };

  const size = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const IMAGES = {
  "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbsGREEKSAL": png(0x2e, 0x7d, 0x32),
  "1CyjNWt1YSB6oGNeLwCeCakhnVVrqumctBURGERPAT": png(0x8d, 0x4b, 0x1f),
  "1DzkOXu2ZTC7pHOfMxDfDblioWWsrvndCHEESECAKE": png(0xd8, 0xc0, 0x8a),
};

/**
 * The fixture menu. Column headers are exactly as specified, and the rows mix
 * Drive link shapes so the resolver's extraction is covered.
 */
const SHEETS = {
  "sheet-menu": {
    name: "Restaurant Menu",
    tabs: {
      Menu: [
        ["name", "price", "description", "chefs choice", "category", "imageurl"],
        ["Greek Salad", 8.5, "Fresh tomatoes, feta and olives", true, "Starters",
          "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbsGREEKSAL/view?usp=sharing"],
        ["Bruschetta", 6, "Grilled bread, tomato and basil", false, "Starters", ""],
        ["Beef Burger", 14, "Beef patty with fries", false, "Main Courses",
          "https://drive.google.com/open?id=1CyjNWt1YSB6oGNeLwCeCakhnVVrqumctBURGERPAT"],
        ["Grilled Salmon", 18.5, "With seasonal greens", true, "Main Courses", ""],
        // Bad price: must be reported and the row skipped.
        ["Mystery Dish", "ask the chef", "Nobody knows", false, "Main Courses", ""],
        // Empty name: must be reported and the row skipped.
        ["", 5, "An orphan row", false, "Desserts", ""],
        ["Cheesecake", 7, "Homemade cheesecake", false, "Desserts",
          "1DzkOXu2ZTC7pHOfMxDfDblioWWsrvndCHEESECAKE"],
        // Junk checkbox: warned about, but the dish still shows.
        ["Tiramisu", 7.5, "Classic tiramisu", "maybe", "Desserts", ""],
        // Unreachable image: warned about, dish shows without a photo.
        ["Espresso", 2.5, "Single shot", false, "Coffee",
          "https://drive.google.com/file/d/1EalPYv3aUD8qIPgNyEgEcmjpXXtswoeMISSINGFIL/view"],
        // Blank padding row: silently ignored, not an error.
        ["", "", "", "", "", ""],
      ],
      "Old menu": [["name", "price"], ["Something", 1]],
    },
  },
  "sheet-broken": {
    name: "Menu missing a column",
    tabs: {
      Sheet1: [
        ["name", "price", "description", "chefs choice", "category"],
        ["Greek Salad", 8.5, "Fresh", true, "Starters"],
      ],
    },
  },
};

let issuedRefresh = 0;
let lastChallenge = null;
let lastChallengeMethod = null;

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const send = (code, body, type = "application/json") => {
    res.writeHead(code, { "Content-Type": type });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const auth = req.headers.authorization ?? "";
  const authed = auth.startsWith("Bearer mock-access");

  /* ------------------------------- OAuth -------------------------------- */
  if (url.pathname === "/o/oauth2/v2/auth") {
    // Stand in for the consent screen: bounce straight back with a code.
    const redirect = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    // A Desktop client must present a PKCE challenge; remember it so the
    // token exchange can be verified the way Google verifies it.
    lastChallenge = url.searchParams.get("code_challenge");
    lastChallengeMethod = url.searchParams.get("code_challenge_method");
    res.writeHead(302, { Location: `${redirect}?code=mock-code&state=${encodeURIComponent(state ?? "")}` });
    return res.end();
  }

  if (url.pathname === "/token" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    return req.on("end", () => {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "refresh_token") {
        issuedRefresh += 1;
        return send(200, { access_token: "mock-access-refreshed", expires_in: 3600 });
      }
      if (form.get("code") !== "mock-code") return send(400, { error: "invalid_grant" });

      // PKCE: when a challenge was presented, the verifier must hash to it.
      if (lastChallenge) {
        const verifier = form.get("code_verifier");
        if (!verifier) {
          return send(400, { error: "invalid_grant", error_description: "code_verifier required" });
        }
        if (lastChallengeMethod !== "S256") {
          return send(400, { error: "invalid_request", error_description: "S256 required" });
        }
        const digest = createHash("sha256").update(verifier).digest("base64url");
        if (digest !== lastChallenge) {
          return send(400, { error: "invalid_grant", error_description: "PKCE mismatch" });
        }
      }
      send(200, {
        access_token: "mock-access",
        refresh_token: "mock-refresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
      });
    });
  }

  if (url.pathname === "/oauth2/v2/userinfo") {
    if (!authed) return send(401, { error: "unauthorized" });
    return send(200, { email: "chef@example.com" });
  }

  if (!authed) return send(401, { error: { message: "Invalid Credentials" } });

  /* ------------------------------- Drive -------------------------------- */
  if (url.pathname === "/drive/v3/files" && req.method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const nameFilter = q.match(/name contains '([^']*)'/)?.[1]?.toLowerCase() ?? "";
    const files = Object.entries(SHEETS)
      .filter(([, v]) => !nameFilter || v.name.toLowerCase().includes(nameFilter))
      .map(([id, v]) => ({ id, name: v.name, modifiedTime: "2026-09-09T10:00:00.000Z" }));
    return send(200, { files });
  }

  const driveFile = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (driveFile) {
    const fileId = decodeURIComponent(driveFile[1]);
    const image = IMAGES[fileId];
    if (!image) return send(404, { error: { message: "File not found" } });
    if (url.searchParams.get("alt") === "media") {
      return send(200, image, "image/png");
    }
    return send(200, {
      id: fileId,
      name: `${fileId}.png`,
      mimeType: "image/png",
      size: String(image.length),
    });
  }

  /* ------------------------------- Sheets ------------------------------- */
  const values = url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/);
  if (values) {
    const book = SHEETS[decodeURIComponent(values[1])];
    if (!book) return send(404, { error: { message: "Requested entity was not found." } });
    const title = decodeURIComponent(values[2]).replace(/^'|'$/g, "").replace(/''/g, "'");
    const rows = book.tabs[title];
    if (!rows) return send(400, { error: { message: "Unable to parse range" } });
    return send(200, { range: title, values: rows });
  }

  const book = url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)$/);
  if (book) {
    const found = SHEETS[decodeURIComponent(book[1])];
    if (!found) return send(404, { error: { message: "Requested entity was not found." } });
    return send(200, {
      properties: { title: found.name },
      sheets: Object.entries(found.tabs).map(([title, rows], i) => ({
        properties: { sheetId: i, title, gridProperties: { rowCount: rows.length } },
      })),
    });
  }

  send(404, { error: { message: "not found" } });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock-google listening on http://127.0.0.1:${port}`);
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
