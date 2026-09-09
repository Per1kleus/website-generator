/**
 * What this computer can actually run.
 *
 * The setup has to decide two things — which components are missing, and which
 * local model this machine can run comfortably — and both are wrong if the
 * numbers are guessed. So every value here comes from the operating system,
 * and anything that cannot be determined is reported as null rather than as a
 * confident default. A null VRAM means "unknown", never "zero".
 *
 * This is deliberately dependency-free: it runs from the packaged application
 * where only the bundled Node binary exists.
 */
import { execFile } from "node:child_process";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GB = 1024 ** 3;

/** Never let a probe hang the setup screen. */
async function run(cmd, args, timeout = 8000) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

function round(bytes, digits = 1) {
  if (bytes == null) return null;
  const gb = bytes / GB;
  return Number(gb.toFixed(digits));
}

/**
 * Windows version, as a person would name it.
 *
 * Windows 11 still reports itself as 10.0; the build number is what separates
 * them, which is why this reads the build rather than the major version.
 */
function windowsRelease() {
  const release = os.release();
  const build = Number(release.split(".")[2] ?? 0);
  if (!build) return { name: `Windows (${release})`, build: 0, supported: true };
  if (build >= 22000) return { name: "Windows 11", build, supported: true };
  if (build >= 10240) return { name: "Windows 10", build, supported: true };
  return { name: `Windows (build ${build})`, build, supported: false };
}

async function gpus() {
  if (process.platform === "win32") {
    // CIM rather than the deprecated wmic, which is absent on newer Windows.
    const out = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress",
    ], 15000);
    if (!out) return [];
    try {
      const parsed = JSON.parse(out);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .filter((g) => g && g.Name)
        .map((g) => ({
          name: String(g.Name).trim(),
          // AdapterRAM is a 32-bit field, so anything above 4GB reports wrong.
          // Treat a suspicious value as unknown instead of publishing a lie.
          vramGb: g.AdapterRAM > 0 && g.AdapterRAM < 4 * GB ? round(g.AdapterRAM) : null,
        }));
    } catch {
      return [];
    }
  }

  const out = await run("sh", ["-c", "lspci 2>/dev/null | grep -Ei 'vga|3d controller'"]);
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ name: line.replace(/^\S+\s+/, "").trim(), vramGb: null }));
}

/**
 * NVIDIA reports its own VRAM accurately, which the Windows adapter field does
 * not. When nvidia-smi is present its answer wins.
 */
async function nvidia() {
  const out = await run("nvidia-smi", [
    "--query-gpu=name,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  if (!out) return null;
  const [line] = out.trim().split("\n");
  if (!line) return null;
  const [name, mib] = line.split(",").map((s) => s.trim());
  const vramGb = Number(mib) > 0 ? Number((Number(mib) / 1024).toFixed(1)) : null;
  return { name, vramGb, cuda: true };
}

async function diskFreeGb(dir) {
  try {
    const fs = await statfs(dir);
    return round(fs.bavail * fs.bsize);
  } catch {
    return null;
  }
}

/**
 * A single snapshot of the machine.
 *
 * `dataDir` is where the application will store its model and its data, so the
 * free-space figure is for the volume that actually matters rather than for C:.
 */
export async function inspect(dataDir = os.homedir()) {
  const cpus = os.cpus();
  const [cards, nv, freeGb] = await Promise.all([gpus(), nvidia(), diskFreeGb(dataDir)]);

  // Prefer the NVIDIA figures where they exist; keep the enumerated list too,
  // so the setup screen can name the card the user actually has.
  const gpuList = nv
    ? [{ name: nv.name, vramGb: nv.vramGb }, ...cards.filter((c) => !c.name.includes(nv.name))]
    : cards;

  return {
    os: {
      platform: process.platform,
      ...(process.platform === "win32"
        ? windowsRelease()
        : { name: `${os.type()} ${os.release()}`, build: 0, supported: true }),
      arch: process.arch,
    },
    cpu: {
      model: cpus[0]?.model?.trim() ?? "unknown",
      cores: cpus.length,
      speedMhz: cpus[0]?.speed ?? 0,
    },
    memory: {
      totalGb: round(os.totalmem()),
      freeGb: round(os.freemem()),
    },
    gpu: {
      cards: gpuList,
      /** The best VRAM figure known, or null when nothing could measure it. */
      vramGb: nv?.vramGb ?? gpuList.find((c) => c.vramGb != null)?.vramGb ?? null,
      cuda: Boolean(nv),
    },
    disk: { dataDir, freeGb },
    node: process.version,
    inspectedAt: Date.now(),
  };
}

/**
 * Turn the snapshot into a plain-language summary for the setup screen.
 * "Unknown" is a legitimate answer and is shown as such.
 */
export function describe(hw) {
  const gpu = hw.gpu.cards[0]?.name ?? "No dedicated graphics detected";
  const vram = hw.gpu.vramGb != null ? `${hw.gpu.vramGb} GB` : "unknown";
  return [
    ["System", `${hw.os.name} (${hw.os.arch})`],
    ["Processor", `${hw.cpu.model} · ${hw.cpu.cores} cores`],
    ["Memory", hw.memory.totalGb != null ? `${hw.memory.totalGb} GB` : "unknown"],
    ["Graphics", hw.gpu.cuda ? `${gpu} · ${vram} VRAM · CUDA` : `${gpu}${hw.gpu.vramGb != null ? ` · ${vram}` : ""}`],
    ["Free space", hw.disk.freeGb != null ? `${hw.disk.freeGb} GB` : "unknown"],
  ];
}
