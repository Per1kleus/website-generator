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
  /* A second account's spreadsheet. Nothing in account A may ever see it: the
     isolation tests rest on that. */
  "sheet-beach": {
    name: "Beach Bar Menu",
    owner: "b",
    tabs: {
      Drinks: [
        ["name", "price", "description", "chefs choice", "category", "imageurl"],
        ["Mojito", 9, "White rum and mint", true, "Cocktails", ""],
      ],
    },
  },
  /* The same menu, written the way a restaurant owner actually writes it:
     the imageurl column holds file names, not sharing URLs. Resolving these
     is only possible through a connected Drive folder, which is the point. */
  "sheet-folder": {
    name: "Menu by file name",
    owner: "a",
    tabs: {
      Menu: [
        ["name", "price", "description", "chefs choice", "category", "imageurl"],
        ["Greek Salad", 8.5, "Fresh tomatoes, feta and olives", true, "Starters", "greek-salad.png"],
        // No extension, and the file on Drive is "Beef Burger.PNG" — the same
        // name a person would type, in the case they would type it.
        ["Beef Burger", 14, "Beef patty with fries", false, "Main Courses", "beef burger"],
        ["Cheesecake", 7, "Homemade cheesecake", false, "Desserts", "cheesecake.png"],
        // Not in the folder at all: reported, and the dish still shows.
        ["Espresso", 2.5, "Single shot", false, "Coffee", "missing-photo.png"],
      ],
    },
  },
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

/* Drive folders, and what is in them.
   The folder exists so a menu sheet can say `moussaka.jpg` rather than a
   sharing URL, which is the behaviour the resolver has to be tested against. */
const FOLDERS = {
  "folder-dishes": {
    name: "Dish photographs",
    owner: "a",
    files: {
      "greek-salad.png": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbsGREEKSAL",
      "Beef Burger.PNG": "1CyjNWt1YSB6oGNeLwCeCakhnVVrqumctBURGERPAT",
      "cheesecake.png": "1DzkOXu2ZTC7pHOfMxDfDblioWWsrvndCHEESECAKE",
    },
  },
  "folder-beach": { name: "Beach photos", owner: "b", files: {} },
};

/**
 * Two Google accounts, because one cannot demonstrate isolation.
 *
 * A test drives the consent redirect itself, so it can append `mock_account=b`
 * to choose the second one — which is how "project A's credentials can never
 * read project B's material" becomes something that is actually checked rather
 * than reasoned about.
 */
const ACCOUNTS = {
  a: { email: "chef@example.com", token: "mock-access", refresh: "mock-refresh" },
  b: { email: "owner@beachbar.example", token: "mock-access-b", refresh: "mock-refresh-b" },
};

/** Authorisation codes, each remembering what it was granted and by whom. */
const CODES = new Map();

let issuedRefresh = 0;
/** Everything consent has ever granted, as Google accumulates it. */
const grantedScopes = new Set();
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
  // Which account this bearer token belongs to. Every content endpoint below
  // answers only with that account's own material.
  const who = auth.includes("mock-access-b") ? "b" : "a";
  const owns = (record) => (record.owner ?? "a") === who;

  /* ------------------------------- OAuth -------------------------------- */
  if (url.pathname === "/o/oauth2/v2/auth") {
    // Stand in for the consent screen: bounce straight back with a code.
    const redirect = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    // A Desktop client must present a PKCE challenge; remember it so the
    // token exchange can be verified the way Google verifies it.
    lastChallenge = url.searchParams.get("code_challenge");
    lastChallengeMethod = url.searchParams.get("code_challenge_method");
    // Google grants what was asked for, and with include_granted_scopes it
    // keeps what was granted before. Echoing the request rather than a fixed
    // string is what lets incremental consent be tested at all.
    const asked = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
    const incremental = url.searchParams.get("include_granted_scopes") === "true";
    if (incremental) for (const scope of asked) grantedScopes.add(scope);

    // A test may ask for the second account, and may ask for a permission to be
    // refused so partial consent can be exercised.
    const account = url.searchParams.get("mock_account") === "b" ? "b" : "a";
    const refuse = (url.searchParams.get("mock_refuse") ?? "").split(",").filter(Boolean);
    const granted = asked.filter((scope) => !refuse.some((part) => scope.includes(part)));

    const code = account === "b" ? "mock-code-b" : "mock-code";
    CODES.set(code, { account, incremental, granted });
    res.writeHead(302, { Location: `${redirect}?code=${code}&state=${encodeURIComponent(state ?? "")}` });
    return res.end();
  }

  if (url.pathname === "/token" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    return req.on("end", () => {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "refresh_token") {
        issuedRefresh += 1;
        // The refreshed token stays the same account's token, so a refresh can
        // never quietly move a project onto someone else's credentials.
        const account = form.get("refresh_token") === ACCOUNTS.b.refresh ? "b" : "a";
        return send(200, {
          access_token: `${ACCOUNTS[account].token}-refreshed`,
          expires_in: 3600,
        });
      }
      const issued = CODES.get(form.get("code") ?? "");
      if (!issued) return send(400, { error: "invalid_grant" });

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
      // A code is single use, as Google's are.
      CODES.delete(form.get("code") ?? "");
      const account = ACCOUNTS[issued.account];
      send(200, {
        access_token: account.token,
        refresh_token: account.refresh,
        expires_in: 3600,
        /* Exactly what this consent granted. With include_granted_scopes the
           account's whole accumulated set comes back, which is what makes
           incremental consent testable; without it, only what was asked for
           and approved — which is what a client connection link relies on. */
        scope: (issued.incremental ? [...grantedScopes] : issued.granted).join(" "),
      });
    });
  }

  if (url.pathname === "/oauth2/v2/userinfo") {
    if (!authed) return send(401, { error: "unauthorized" });
    return send(200, { email: ACCOUNTS[who].email });
  }

  if (!authed) return send(401, { error: { message: "Invalid Credentials" } });

  /* ------------------------------- Drive -------------------------------- */
  if (url.pathname === "/drive/v3/files" && req.method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const nameFilter = q.match(/name contains '([^']*)'/)?.[1]?.toLowerCase() ?? "";
    const exactName = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, "$1") ?? "";
    const parent = q.match(/'([^']+)' in parents/)?.[1] ?? "";

    // Inside a folder: the images it holds, for this account only.
    if (parent) {
      const folder = FOLDERS[parent];
      if (!folder || !owns(folder)) return send(200, { files: [] });
      const files = Object.entries(folder.files)
        .filter(([name]) => !exactName || name === exactName)
        .map(([name, id]) => ({
          id,
          name,
          mimeType: "image/png",
          size: String(IMAGES[id]?.length ?? 0),
        }));
      return send(200, { files });
    }

    if (q.includes("application/vnd.google-apps.folder")) {
      const files = Object.entries(FOLDERS)
        .filter(([, v]) => owns(v))
        .filter(([, v]) => !nameFilter || v.name.toLowerCase().includes(nameFilter))
        .map(([id, v]) => ({ id, name: v.name, modifiedTime: "2026-09-09T10:00:00.000Z" }));
      return send(200, { files });
    }

    const files = Object.entries(SHEETS)
      .filter(([, v]) => owns(v))
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
    // Another account's spreadsheet is not "not found" to Google — it is
    // forbidden — and the difference is what the application has to report.
    if (book && !owns(book)) return send(403, { error: { message: "The caller does not have permission" } });
    if (!book) return send(404, { error: { message: "Requested entity was not found." } });
    const title = decodeURIComponent(values[2]).replace(/^'|'$/g, "").replace(/''/g, "'");
    const rows = book.tabs[title];
    if (!rows) return send(400, { error: { message: "Unable to parse range" } });
    return send(200, { range: title, values: rows });
  }

  const book = url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)$/);
  if (book) {
    const found = SHEETS[decodeURIComponent(book[1])];
    if (found && !owns(found)) return send(403, { error: { message: "The caller does not have permission" } });
    if (!found) return send(404, { error: { message: "Requested entity was not found." } });
    return send(200, {
      properties: { title: found.name },
      sheets: Object.entries(found.tabs).map(([title, rows], i) => ({
        properties: { sheetId: i, title, gridProperties: { rowCount: rows.length } },
      })),
    });
  }

  /* --------------------------- Google Analytics ------------------------- */

  // The properties this account owns, as the Admin API lists them.
  if (url.pathname === "/v1beta/accountSummaries") {
    if (who === "b") {
      return send(200, {
        accountSummaries: [
          {
            displayName: "Beach Bar",
            propertySummaries: [{ property: "properties/333", displayName: "Beach Bar Web" }],
          },
        ],
      });
    }
    return send(200, {
      accountSummaries: [
        {
          displayName: "Mock Account",
          propertySummaries: [
            { property: "properties/111", displayName: "Ouzeri Mikro" },
            // Deliberately has no web data stream, so "connect" must refuse it
            // rather than store a property that can never report anything.
            { property: "properties/222", displayName: "App Only Property" },
          ],
        },
      ],
    });
  }

  const streams = url.pathname.match(/^\/v1beta\/properties\/([^/]+)\/dataStreams$/);
  if (streams) {
    if (streams[1] === "222") return send(200, { dataStreams: [] });
    // A property belonging to the other account is refused, not answered.
    const ownerOf = streams[1] === "333" ? "b" : "a";
    if (ownerOf !== who) {
      return send(403, { error: { message: "User does not have sufficient permissions" } });
    }
    return send(200, {
      dataStreams: [{ webStreamData: { measurementId: streams[1] === "333" ? "G-BEACH999" : "G-MOCK12345" } }],
    });
  }

  const report = url.pathname.match(/^\/v1beta\/properties\/([^/]+):runReport$/);
  if (report) {
    let body = "";
    req.on("data", (c) => (body += c));
    return req.on("end", () => {
      const asked = JSON.parse(body || "{}");
      const dimension = asked.dimensions?.[0]?.name ?? "";
      if (dimension === "pagePath") {
        return send(200, {
          rows: [
            { dimensionValues: [{ value: "/" }], metricValues: [{ value: "812" }] },
            { dimensionValues: [{ value: "/services" }], metricValues: [{ value: "301" }] },
          ],
        });
      }
      if (dimension === "deviceCategory") {
        return send(200, {
          rows: [
            { dimensionValues: [{ value: "mobile" }], metricValues: [{ value: "1100" }] },
            { dimensionValues: [{ value: "desktop" }], metricValues: [{ value: "437" }] },
          ],
        });
      }
      return send(200, {
        rows: [{ metricValues: [{ value: "1284" }, { value: "1537" }, { value: "3120" }] }],
      });
    });
  }

  /* ------------------------- Google Search Console ----------------------- */

  if (url.pathname === "/webmasters/v3/sites") {
    return send(200, {
      siteEntry: [
        { siteUrl: "https://ouzeri.example/", permissionLevel: "siteOwner" },
        // Google's own word for "you added it but have not proved you own it".
        { siteUrl: "https://unverified.example/", permissionLevel: "siteUnverifiedUser" },
      ],
    });
  }

  const search = url.pathname.match(/^\/webmasters\/v3\/sites\/([^/]+)\/searchAnalytics\/query$/);
  if (search) {
    let body = "";
    req.on("data", (c) => (body += c));
    return req.on("end", () => {
      const asked = JSON.parse(body || "{}");
      const dimension = asked.dimensions?.[0];
      if (dimension === "query") {
        return send(200, {
          rows: [
            { keys: ["ouzeri athens"], clicks: 180, impressions: 2400, ctr: 0.075, position: 8.2 },
            { keys: ["greek meze"], clicks: 96, impressions: 3100, ctr: 0.031, position: 14.6 },
          ],
        });
      }
      if (dimension === "page") {
        return send(200, {
          rows: [{ keys: ["https://ouzeri.example/"], clicks: 240, impressions: 4000, ctr: 0.06, position: 9.1 }],
        });
      }
      return send(200, {
        rows: [{ clicks: 428, impressions: 8421, ctr: 0.051, position: 12.4 }],
      });
    });
  }

  send(404, { error: { message: "not found" } });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock-google listening on http://127.0.0.1:${port}`);
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
