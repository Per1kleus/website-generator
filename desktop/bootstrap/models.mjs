/**
 * Which local model this computer should run.
 *
 * The local model has one narrow job in this application: turn business facts
 * into a good query for the ui-ux-pro-max catalogue, and return it as JSON.
 * That is a small, bounded, structured task, so the ladder is short and
 * deliberately capped — past a few billion parameters a bigger model writes
 * the same four-word query while costing the user gigabytes of download and a
 * slower first generation. "Minimum hardware load for acceptable quality"
 * means the cap is a feature, not an omission.
 *
 * The ladder itself, and the one required model, come from the setup manifest:
 * the server reads the same file, so the two cannot drift apart. Sizes are the
 * published download sizes for the quantised Ollama builds and are shown to the
 * user before anything is fetched. Ollama reports the true byte count while
 * pulling, so the progress bar is never an estimate.
 */
import { diskBudgetGb, models, requiredModel } from "./manifest.mjs";

export const LADDER = models();

export const SMALLEST = LADDER[0];

/** The model a complete installation must have. One value, from the manifest. */
export const REQUIRED = LADDER.find((m) => m.id === requiredModel()) ?? SMALLEST;

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
export function recommend(hw, { configured = null, needsOllama = true, needsSkills = true } = {}) {
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

  /* Disk is a hard constraint, not a preference: step back down the ladder
     rather than starting a download that cannot finish. The figure compared
     against is the whole job — see diskBudgetGb — because a model that fits
     while Ollama's own 4.5 GB does not is still a download that fails. */
  const fits = (model) => diskBudgetGb({ model, needsOllama, needsSkills }).totalGb;
  if (freeGb != null) {
    while (choice !== SMALLEST && freeGb < fits(choice)) {
      choice = LADDER[LADDER.indexOf(choice) - 1];
      reasons.push("a smaller model was chosen because free disk space is limited");
    }
  }

  const blocked =
    freeGb != null && freeGb < fits(choice)
      ? `This computer has ${freeGb} GB free, and setting up needs about ${fits(choice).toFixed(1)} GB including the download and working space.`
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

/**
 * Is there room for the whole first launch, not merely for the model?
 *
 * Asked before any large download starts. A check that passes on the model's
 * 400 MB and then fails when Ollama unpacks 4.5 GB of runtime and CUDA
 * libraries is worse than no check: the user has already waited for it.
 *
 * `null` free space means the volume could not be measured. That is reported as
 * unknown rather than treated as either full or empty — refusing to install on
 * a machine whose disk simply could not be read would be its own bug.
 */
export function diskCheck(hw, { model = null, needsOllama = true, needsSkills = true } = {}) {
  const budget = diskBudgetGb({ model, needsOllama, needsSkills });
  const freeGb = hw?.disk?.freeGb ?? null;
  if (freeGb == null) {
    return { ok: true, unknown: true, freeGb: null, ...budget };
  }
  return { ok: freeGb >= budget.totalGb, unknown: false, freeGb, ...budget };
}

/** Every model on the ladder, annotated for the "choose another" screen. */
export function options(hw, { needsOllama = true, needsSkills = true } = {}) {
  const ramGb = hw.memory.totalGb ?? 0;
  const freeGb = hw.disk.freeGb;
  return LADDER.map((model) => ({
    ...model,
    comfortable: ramGb >= model.needs.ramGb,
    // The same whole-job budget the recommendation uses, so a model shown as
    // available on this screen is one that can actually be installed.
    fits: freeGb == null || freeGb >= diskBudgetGb({ model, needsOllama, needsSkills }).totalGb,
  }));
}
