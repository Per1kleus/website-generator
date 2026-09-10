#!/usr/bin/env node
/**
 * A stand-in for the Gemini API.
 *
 * Implements only what the application actually calls — the streaming
 * generateContent endpoint, in the server-sent-events shape the SDK expects —
 * so the whole hosted-AI path can be exercised end to end without a real key
 * and without a network.
 *
 * It is deliberately picky: it rejects a request that arrives without the API
 * key header, and it answers each feature with the JSON shape that feature's
 * own validation demands. That way a test failure means the application is
 * wrong, not that the stub is lenient.
 *
 *   node scripts/mock-gemini.mjs [port] [mode]
 *
 * Modes: ok (default), invalid-key, rate-limit, malformed, refuse, unavailable.
 */
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 11866);
const mode = process.argv[3] ?? "ok";

/** Every request the application made, so a test can assert what was sent. */
const calls = [];

/**
 * A business shaped like the one that was asked about.
 *
 * The stub stands in for the hosted model, so it answers in proportion to the
 * brief: an accountancy practice comes back with nine services and no
 * photographs, a taverna with a menu, a detailing studio with a portfolio. A
 * fixture that returned the same business every time would make every
 * generated site look alike for reasons that have nothing to do with the app.
 */
function shapeOf(text) {
  // The business's own type line, not the whole prompt: the prompt also
  // carries the design catalogue's category, and matching on that would make
  // every business look like the same one.
  const typed = /^(?:Business|Type):\s*(.+)$/gim;
  const lines = [];
  for (const m of text.matchAll(typed)) lines.push(m[1]);
  if (lines.length) text = lines.join(" ");
  if (/account|audit|tax|bookkeep/i.test(text)) {
    return { category: "Accountancy", services: 9, menu: 0, reviews: 4, images: 0, hours: 5, price: "€€",
      atmosphere: "orderly and practical", audience: "small business owners", positioning: "a dependable accountancy practice" };
  }
  if (/law|legal|solicitor|litigation/i.test(text)) {
    return { category: "Law firm", services: 7, menu: 0, reviews: 3, images: 0, hours: 5, price: "€€€",
      atmosphere: "formal and discreet", audience: "companies and property owners", positioning: "a commercial law firm" };
  }
  if (/gym|fitness|strength|conditioning/i.test(text)) {
    return { category: "Gym", services: 6, menu: 0, reviews: 6, images: 7, hours: 7, price: "€€",
      atmosphere: "loud and energetic", audience: "lifters and athletes", positioning: "a strength and conditioning gym" };
  }
  if (/detail|ceramic|paint correction/i.test(text)) {
    return { category: "Car detailing studio", services: 5, menu: 0, reviews: 3, images: 12, hours: 6, price: "€€€€",
      atmosphere: "precise and photographed", audience: "collectors", positioning: "a detailing studio for collectors" };
  }
  if (/hotel|suites|resort|spa/i.test(text)) {
    return { category: "Boutique hotel", services: 4, menu: 0, reviews: 5, images: 10, hours: 0, price: "€€€€",
      atmosphere: "calm and private", audience: "couples", positioning: "a boutique hotel of twelve suites" };
  }
  if (/taverna|restaurant|cafe|kafeneio|bistro/i.test(text)) {
    return { category: "Taverna", services: 0, menu: 8, reviews: 4, images: 6, hours: 7, price: "€€",
      atmosphere: "warm and unhurried", audience: "locals and families", positioning: "a family taverna" };
  }
  return { category: "Local business", services: 3, menu: 0, reviews: 2, images: 2, hours: 5, price: "€€",
    atmosphere: "", audience: "local customers", positioning: "" };
}

function research(name, shape = shapeOf(name)) {
  return {
    name,
    category: shape.category,
    cuisineOrSpecialty: shape.menu ? "Greek coffee and pastries" : "",
    location: "Athens",
    address: "12 Example Street, Athens",
    phone: "",
    email: "",
    website: "",
    openingHours: Array.from({ length: shape.hours }, (_, i) => ({
      day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i],
      hours: "09:00-18:00",
    })),
    priceRange: shape.price,
    rating: "4.6",
    reviewThemes: Array.from({ length: shape.reviews }, (_, i) => `theme ${i + 1}`),
    services: Array.from({ length: shape.services }, (_, i) => `Service ${i + 1}`),
    menuHighlights: Array.from({ length: shape.menu }, (_, i) => ({
      name: `Dish ${i + 1}`,
      price: `€${(4 + i).toFixed(2)}`,
    })),
    // Per business, for the same reason the identity is: a fixture that called
    // every business "an everyday neighbourhood cafe" would make the layout
    // engine read them all as one.
    atmosphere: shape.atmosphere,
    targetAudience: shape.audience,
    positioning: shape.positioning,
    verifiedFields: ["name", "category", "location"],
    sources: ["https://example.com/kafeneio"],
    unknowns: ["email"],
    confidence: "medium",
  };
}

const identity = {
  dominantColors: ["#6b3f23"], secondaryColors: ["#e9d8c3"], materials: ["wood", "brass"],
  interiorStyle: "warm traditional", lighting: "low, warm",
  typographyPersonality: "editorial with a soft serif",
  brandPersonality: ["warm", "unhurried"], photographyStyle: "natural light",
  atmosphere: "warm neighbourhood cafe",
  architecture: "editorial",
  architectureRationale: "Stub identity for the QA suite.",
  palette: { primary: "#6b3f23", secondary: "#8a5a3b", accent: "#b8791f", bg: "#fbf7f2", text: "#1b1410" },
  fonts: { heading: "Playfair Display", body: "Lato" },
  sectionPlan: ["hero", "about", "menu", "contact", "footer"],
  questions: [],
  confidence: "high",
};

const content = {
  tagline: "Coffee, slowly",
  stickyCtaLabel: "Visit us", skipToContent: "Skip to content",
  menuLabel: "Menu", chefsChoiceLabel: "Chef's choice", logoAlt: "Logo",
  sections: [
    {
      type: "hero", title: "Home", heading: "", eyebrow: "Athens",
      headline: "A neighbourhood cafe", subheadline: "Greek coffee and pastries",
      body: "", note: "", intro: "", ctaLabel: "Visit us", secondaryLabel: "",
      address: "", bookingLabel: "", tagline: "", highlights: [], items: [],
      categories: [], hours: [], testimonials: [], links: [],
    },
    {
      type: "footer", title: "Footer", heading: "", eyebrow: "", headline: "",
      subheadline: "", body: "", note: "", intro: "", ctaLabel: "",
      secondaryLabel: "", address: "", bookingLabel: "", tagline: "",
      highlights: [], items: [], categories: [], hours: [], testimonials: [],
      links: [],
    },
  ],
  seo: {
    title: "Kafeneio", description: "A neighbourhood cafe in Athens.",
    ogTitle: "Kafeneio", ogDescription: "A neighbourhood cafe in Athens.",
    keywords: ["cafe", "athens"],
  },
};

/** The text of a request, unescaped — contents and system arrive as parts. */
function textOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const items = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of items) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    for (const part of item?.parts ?? []) if (typeof part?.text === "string") out.push(part.text);
    if (typeof item?.text === "string") out.push(item.text);
  }
  return out.join("\n");
}

/**
 * The first complete JSON object in a prompt.
 *
 * Brace-counted rather than "first { to last }": these prompts carry the
 * payload *and* an example of the shape to answer in, and a greedy span
 * swallows both and parses as neither.
 */
function firstObject(text, from = 0) {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Which feature is asking.
 *
 * Matched on the opening line of each feature's system instruction, which is
 * distinct per feature. Matching on the prompt body instead is how an earlier
 * version of this stub answered the SEO call with a research profile: several
 * of these prompts share phrases like "never invent".
 */
function answerFor(body) {
  const system = textOf(body.systemInstruction);
  const user = textOf(body.contents);

  if (/You research small businesses/i.test(system)) {
    const named = /^Business:\s*(.+)$/m.exec(user)?.[1]?.trim();
    return JSON.stringify(research(named || "Kafeneio", shapeOf(user)));
  }

  if (/senior brand and web designer/i.test(system)) {
    // The architecture a real analysis would reach for, and a section plan
    // that matches what this kind of business actually has.
    const shape = shapeOf(user);
    const arch = {
      "Boutique hotel": "luxury",
      Taverna: "mediterranean",
      "Car detailing studio": "image-first",
      Gym: "modern",
      "Law firm": "architectural",
      Accountancy: "classic",
    }[shape.category] ?? "editorial";
    const plan = ["hero", "about"];
    if (shape.services) plan.push("services");
    if (shape.menu) plan.push("menu");
    if (shape.images >= 4) plan.push("gallery");
    if (shape.hours) plan.push("hours");
    if (shape.reviews >= 3) plan.push("testimonials");
    plan.push("cta", "contact", "footer");
    // The identity a real analysis would return for this kind of place. A
    // fixture that described every business as a warm neighbourhood cafe would
    // make the layout engine read them all as the same business.
    const character = {
      "Boutique hotel": {
        atmosphere: "calm, private, expensive light",
        interiorStyle: "pared-back luxury",
        brandPersonality: ["refined", "quiet", "exclusive"],
        materials: ["whitewashed stone", "linen", "brass"],
        typographyPersonality: "elegant high-contrast serif",
      },
      Taverna: {
        atmosphere: "warm, family, unhurried",
        interiorStyle: "traditional village taverna",
        brandPersonality: ["warm", "traditional", "generous"],
        materials: ["wood", "ceramic", "vine"],
        typographyPersonality: "handmade warmth",
      },
      "Car detailing studio": {
        atmosphere: "precise, showroom, photographed",
        interiorStyle: "industrial studio",
        brandPersonality: ["meticulous", "premium", "visual"],
        materials: ["polished paint", "carbon", "glass"],
        typographyPersonality: "technical grotesk",
      },
      Gym: {
        atmosphere: "loud, hot, energetic",
        interiorStyle: "raw training floor",
        brandPersonality: ["strong", "energetic", "direct"],
        materials: ["steel", "rubber", "concrete"],
        typographyPersonality: "heavy condensed",
      },
      "Law firm": {
        atmosphere: "formal, considered, discreet",
        interiorStyle: "panelled offices",
        brandPersonality: ["authoritative", "precise", "trusted"],
        materials: ["oak", "leather", "paper"],
        typographyPersonality: "classical serif",
      },
      Accountancy: {
        atmosphere: "orderly, practical, trustworthy",
        interiorStyle: "plain professional office",
        brandPersonality: ["dependable", "clear", "methodical"],
        materials: ["paper", "glass", "steel"],
        typographyPersonality: "plain grotesk",
      },
    }[shape.category] ?? {};

    return JSON.stringify({ ...identity, ...character, architecture: arch, sectionPlan: plan });
  }

  if (/You write SEO metadata/i.test(system)) {
    const source = firstObject(user, user.indexOf("Source metadata:")) ?? {};
    return JSON.stringify({
      title: `[el] ${source.title ?? ""}`,
      description: `[el] ${source.description ?? ""}`,
      ogTitle: `[el] ${source.ogTitle ?? ""}`,
      ogDescription: `[el] ${source.ogDescription ?? ""}`,
      keywords: source.keywords ?? [],
    });
  }

  if (/You translate the copy/i.test(system)) {
    // The contract is the same keys with translated values, so that is what
    // comes back — a stub that returned its own keys would hide a real bug.
    const source = firstObject(user);
    if (!source) return JSON.stringify({});
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(source).map(([k, v]) => [k, typeof v === "string" ? `[el] ${v}` : v]),
      ),
    );
  }

  if (/You edit a website/i.test(system)) {
    // Return the document it was given with one string changed, so a test can
    // tell an applied edit from an echoed input.
    const doc = firstObject(user, user.indexOf("Current document:"));
    if (!doc) return JSON.stringify({});
    const locale = doc.meta?.defaultLocale;
    const strings = locale ? doc.i18n?.[locale]?.strings : null;
    if (strings) {
      const first = Object.keys(strings)[0];
      if (first) strings[first] = "Edited by the stub";
    }
    return JSON.stringify(doc);
  }

  // The remaining caller is copy generation: write the sections that were
  // asked for, with as many items as the research established.
  const requested = /SECTIONS TO WRITE, IN THIS ORDER:\s*(.+)/i.exec(user)?.[1] ?? "";
  const plan = requested
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!plan.length) return JSON.stringify(content);

  const shape = shapeOf(user);
  const blank = {
    type: "", title: "", heading: "", eyebrow: "", headline: "", subheadline: "", body: "",
    note: "", intro: "", ctaLabel: "", secondaryLabel: "", address: "", bookingLabel: "",
    tagline: "", highlights: [], items: [], categories: [], hours: [], testimonials: [], links: [],
  };
  const name = /^Business:\s*(.+)$/m.exec(user)?.[1]?.trim() || "The Business";
  const sections = plan.map((type) => {
    const base = { ...blank, type, title: type };
    switch (type) {
      case "hero":
        return { ...base, eyebrow: "Athens", headline: name, subheadline: `${shape.category} in Athens`, ctaLabel: "Call the studio" };
      case "about":
        // Written from what the research established, so a test can check that
        // the research actually reached the finished page.
        return {
          ...base,
          heading: `About ${name}`,
          body: `${name} is ${shape.positioning || shape.category.toLowerCase()}, ${shape.atmosphere || "in Athens"}. This paragraph is long enough to read as real prose rather than a placeholder line.\n\nA second paragraph, so the page has something to set.`,
          highlights: ["Since 1974", "Family run"],
        };
      case "services":
        return { ...base, heading: "What we do", items: Array.from({ length: shape.services }, (_, i) => ({ name: `Service ${i + 1}`, description: "What this service involves, in one sentence.", price: "" })) };
      case "menu":
        return { ...base, heading: "Menu", categories: [{ name: "Plates", items: Array.from({ length: shape.menu }, (_, i) => ({ name: `Dish ${i + 1}`, description: "", price: `€${(4 + i).toFixed(2)}` })) }] };
      case "hours":
        return { ...base, heading: "Opening hours", hours: Array.from({ length: shape.hours }, (_, i) => ({ day: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][i], hours: "09:00-18:00" })) };
      case "testimonials":
        return { ...base, heading: "What people say", testimonials: Array.from({ length: shape.reviews }, (_, i) => ({ quote: "Something a customer said about the work.", author: `Customer ${i + 1}` })) };
      case "cta":
        return { ...base, heading: "Come and see us", body: "One line inviting the visitor to get in touch.", ctaLabel: "Book a table" };
      case "contact":
        return { ...base, heading: "Find us", address: "12 Example Street, Athens" };
      default:
        return { ...base, heading: type };
    }
  });

  return JSON.stringify({
    ...content,
    sections,
  });
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/__calls")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(calls));
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (!req.url?.includes(":streamGenerateContent")) {
      return send(404, { error: { code: 404, message: "not found" } });
    }

    // The key travels in a header, never in the URL. A request without it is
    // refused, so "the application actually authenticates" is a real check.
    const key = req.headers["x-goog-api-key"];
    if (!key) return send(401, { error: { code: 401, message: "API key not valid" } });

    let parsed = {};
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      /* recorded as an empty call below */
    }
    calls.push({
      url: req.url,
      model: /models\/([^:]+):/.exec(req.url ?? "")?.[1] ?? "",
      hasKey: true,
      system: JSON.stringify(parsed.systemInstruction ?? ""),
      tools: parsed.config?.tools ?? parsed.tools ?? [],
      thinking: parsed.generationConfig?.thinkingConfig ?? parsed.config?.thinkingConfig ?? null,
      maxOutputTokens:
        parsed.generationConfig?.maxOutputTokens ?? parsed.config?.maxOutputTokens ?? null,
      hasImage: JSON.stringify(parsed.contents ?? "").includes("inlineData"),
      body: parsed,
    });

    if (mode === "invalid-key") {
      return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } });
    }
    if (mode === "rate-limit") {
      return send(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded." } });
    }
    if (mode === "unavailable") {
      return send(404, { error: { code: 404, status: "NOT_FOUND", message: "models/x is not found." } });
    }

    const text =
      mode === "malformed" ? "Sorry, I can only answer in prose today." : answerFor(parsed);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    if (mode === "refuse") {
      res.write(
        `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [] }, finishReason: "SAFETY" }] })}\n\n`,
      );
      res.end();
      return;
    }

    // Split across chunks: the application concatenates a stream, and a stub
    // that answered in one piece would not exercise that.
    const pieces = [text.slice(0, Math.ceil(text.length / 2)), text.slice(Math.ceil(text.length / 2))];
    pieces.forEach((piece, i) => {
      const chunk = {
        candidates: [
          {
            content: { role: "model", parts: [{ text: piece }] },
            ...(i === pieces.length - 1 ? { finishReason: "STOP" } : {}),
          },
        ],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    });
    res.end();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock-gemini listening on http://127.0.0.1:${port} (mode=${mode})`);
});
