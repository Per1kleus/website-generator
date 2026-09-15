#!/usr/bin/env node
/**
 * A tiny authoritative DNS server, so "has the customer set up their DNS yet?"
 * is tested by asking DNS.
 *
 * The domain states are the part of the custom-domain feature most likely to
 * lie: every one of them claims to be an observation, so every one of them has
 * to be tested against something that really answers a query. Stubbing the
 * resolver would test the stub.
 *
 * It speaks just enough of RFC 1035 to answer A and CNAME queries over UDP,
 * which is what `node:dns`'s Resolver asks. Zones are set over HTTP so a test
 * can move a domain from "not configured" to "pointing somewhere else" to
 * "pointing at GitHub Pages" while the application watches.
 *
 *   node scripts/mock-dns.mjs [dnsPort] [controlPort]
 */
import { createSocket } from "node:dgram";
import { createServer } from "node:http";

const dnsPort = Number(process.argv[2] || 11753);
const controlPort = Number(process.argv[3] || 11754);

/** name -> { a: string[], cname: string[] } */
const zones = new Map();

/* ------------------------------------------------------------ wire format */

function readName(buf, offset) {
  const labels = [];
  let i = offset;
  for (;;) {
    const len = buf[i];
    if (len === 0) {
      i += 1;
      break;
    }
    // Compression pointers never appear in a question section.
    if ((len & 0xc0) === 0xc0) {
      i += 2;
      break;
    }
    labels.push(buf.subarray(i + 1, i + 1 + len).toString("ascii"));
    i += 1 + len;
  }
  return { name: labels.join("."), end: i };
}

function writeName(name) {
  const parts = name.split(".").filter(Boolean);
  const chunks = parts.map((p) => {
    const b = Buffer.alloc(1 + p.length);
    b.writeUInt8(p.length, 0);
    b.write(p, 1, "ascii");
    return b;
  });
  return Buffer.concat([...chunks, Buffer.from([0])]);
}

function answer(name, type, value) {
  const rdata =
    type === 1
      ? Buffer.from(value.split(".").map((n) => Number(n)))
      : writeName(value);
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0); // TYPE
  head.writeUInt16BE(1, 2); // CLASS IN
  head.writeUInt32BE(30, 4); // TTL — short, so nothing is cached across a test
  head.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([writeName(name), head, rdata]);
}

const socket = createSocket("udp4");

socket.on("message", (msg, rinfo) => {
  if (msg.length < 12) return;
  const id = msg.readUInt16BE(0);
  const { name, end } = readName(msg, 12);
  const qtype = msg.readUInt16BE(end);
  const question = msg.subarray(12, end + 4);

  const zone = zones.get(name.toLowerCase());
  const records = [];
  if (zone) {
    if (qtype === 1) for (const ip of zone.a ?? []) records.push(answer(name, 1, ip));
    if (qtype === 5) for (const target of zone.cname ?? []) records.push(answer(name, 5, target));
  }

  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  // QR=1 (response), AA=1 (authoritative). RCODE 0 when the name exists in
  // some form, 3 (NXDOMAIN) when it does not — which is what a domain nobody
  // has configured yet actually looks like.
  header.writeUInt16BE(0x8400 | (zone ? 0 : 3), 2);
  header.writeUInt16BE(1, 4); // QDCOUNT
  header.writeUInt16BE(records.length, 6); // ANCOUNT

  const reply = Buffer.concat([header, question, ...records]);
  socket.send(reply, rinfo.port, rinfo.address);
});

socket.bind(dnsPort, "127.0.0.1", () => {
  console.log(`mock dns on 127.0.0.1:${dnsPort}`);
});

/* --------------------------------------------------------- control plane */

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      /* an empty body is a reset */
    }
    if (body.reset) zones.clear();
    if (body.set) {
      for (const [name, zone] of Object.entries(body.set)) {
        zones.set(name.toLowerCase(), zone);
      }
    }
    if (body.clear) zones.delete(String(body.clear).toLowerCase());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, zones: [...zones.keys()] }));
  });
}).listen(controlPort, "127.0.0.1", () => {
  console.log(`mock dns control on http://127.0.0.1:${controlPort}`);
});
