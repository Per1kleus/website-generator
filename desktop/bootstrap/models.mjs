/**
 * Which local model this computer should run.
 *
 * The local model has one narrow job in this application: turn business facts
 * into a good query for the ui-ux-pro-max catalogue, and return it as JSON.
 * That is a small, bounded, structured task, so the ladder below is short and
 * deliberately capped — past a few billion parameters a bigger model writes
 * the same four-word query while costing the user gigabytes of download and a
 * slower first generation. "Minimum hardware load for acceptable quality"
 * means the cap is a feature, not an omission.
 *
 * Sizes are the published download sizes for the quantised Ollama builds and
 * are shown to the user before anything is fetched. Ollama reports the true
 * byte count while pulling, so the progress bar is never an estimate.
 */

export const LADDER = [
  {
    id: "qwen2.5:0.5b",
    label: "Qwen 2.5 0.5B",
    downloadGb: 0.4,
    /** Rough resident footprint while answering. */
    runtimeGb: 1,
    needs: { ramGb: 0 },
    summary: "Smallest model that reliably returns valid JSON.",
  },
  {
    id: "qwen2.5:1.5b",
    label: "Qwen 2.5 1.5B",
    downloadGb: 1,
    runtimeGb: 2,
    needs: { ramGb: 8 },
    summary: "Noticeably better at reading a business description.",
  },
  {
    id: "qwen2.5:3b",
    label: "Qwen 2.5 3B",
    downloadGb: 1.9,
    runtimeGb: 3.5,
    needs: { ramGb: 16 },
    summary: "Best query quality this application can actually use.",
  },
];

export const SMALLEST = LADDER[0];

export function findModel(id) {
  if (!id) return null;
  return LADDER.find((m) => m.id === id) ?? null;
}

/**
 * Pick the highest rung this machine carries comfortably, then stop.
 *
 * Comfort, not capability: the model shares the machine with the application,
 * a webview and whatever else the user is doing, so the RAM thresholds leave
 * headroom rather than assuming the computer is idle.
 */
export function recommend(hw, { configured = null } = {}) {
  const ramGb = hw.memory.totalGb ?? 0;
  const vramGb = hw.gpu.vramGb;
  const freeGb = hw.disk.freeGb;

  let choice = SMALLEST;
  for (const model of LADDER) {
    if (ramGb >= model.needs.ramGb) choice = model;
  }

  const reasons = [];
  if (ramGb) reasons.push(`${ramGb} GB of memory`);
  if (hw.gpu.cuda && vramGb) {
    reasons.push(`an NVIDIA GPU with ${vramGb} GB of VRAM, which Ollama will use`);
  } else if (hw.gpu.cards.length && vramGb) {
    reasons.push(`${vramGb} GB of VRAM`);
  } else {
    reasons.push("no dedicated GPU detected, so it will run on the processor");
  }

  // Disk is a hard constraint, not a preference: step back down the ladder
  // rather than starting a download that cannot finish.
  const headroomGb = 2;
  if (freeGb != null) {
    while (choice !== SMALLEST && freeGb < choice.downloadGb + headroomGb) {
      choice = LADDER[LADDER.indexOf(choice) - 1];
      reasons.push("a smaller model was chosen because free disk space is limited");
    }
  }

  const blocked =
    freeGb != null && freeGb < choice.downloadGb + headroomGb
      ? `This computer has ${freeGb} GB free. The smallest model needs about ${(choice.downloadGb + headroomGb).toFixed(1)} GB including working space.`
      : null;

  // An already-chosen model is kept when it is a real choice on this ladder
  // and this machine can carry it. Re-downloading a working setup because a
  // newer recommendation exists would be exactly the wrong behaviour.
  const existing = findModel(configured);
  if (existing && ramGb >= existing.needs.ramGb) {
    return {
      model: existing,
      kept: true,
      blocked,
      why: `Already configured on this computer, and it suits ${reasons[0] ?? "this machine"}.`,
      hardware: reasons,
    };
  }

  const changed = Boolean(configured) && configured !== choice.id;
  return {
    model: choice,
    kept: false,
    changed,
    previous: configured ?? null,
    blocked,
    why: changed
      ? `${configured} is not a good fit for this computer, so ${choice.label} was chosen instead: ${choice.summary.toLowerCase()}`
      : `${choice.summary} Chosen for ${reasons[0] ?? "this machine"}.`,
    hardware: reasons,
  };
}

/** Every model on the ladder, annotated for the "choose another" screen. */
export function options(hw) {
  const ramGb = hw.memory.totalGb ?? 0;
  const freeGb = hw.disk.freeGb;
  return LADDER.map((model) => ({
    ...model,
    comfortable: ramGb >= model.needs.ramGb,
    fits: freeGb == null || freeGb >= model.downloadGb + 2,
  }));
}
