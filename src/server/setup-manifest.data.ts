/**
 * GENERATED FILE — do not edit.
 *
 * Written from setup-manifest.json by scripts/gen-setup-manifest.mjs, which runs
 * before every build. Edit the JSON; this follows.
 *
 * It exists because the server cannot import the JSON directly: Next's output
 * tracing follows an import that leaves src/ by carrying its neighbouring files
 * into the standalone build, which turned a 40 MB server into a 7.5 GB one. A
 * generated module inside src/ traces to nothing.
 */
export const MANIFEST = {
  "schema": 2,
  "revision": 2,
  "runtime": {
    "nodeMinimumMajor": 20,
    "python": {
      "required": false,
      "candidates": [
        "python3",
        "python"
      ]
    }
  },
  "skills": [
    {
      "id": "ui-ux-pro-max",
      "label": "UI/UX Pro Max",
      "package": "ui-ux-pro-max-cli",
      "assistant": "claude",
      "requiredFiles": [
        "scripts/search.py",
        "scripts/core.py",
        "scripts/design_system.py",
        "scripts/reasoning_contract.py",
        "data/styles.csv",
        "data/colors.csv",
        "data/typography.csv",
        "data/landing.csv",
        "data/motion.csv",
        "data/google-fonts.csv",
        "data/ui-reasoning.csv",
        "data/ux-guidelines.csv"
      ],
      "verify": {
        "script": "scripts/search.py",
        "args": [
          "warm artisanal cafe",
          "--design-system",
          "--json"
        ],
        "expectKey": "design_system",
        "timeoutMs": 60000
      },
      "approximateMb": 12
    }
  ],
  "ai": {
    "host": "http://127.0.0.1:11434",
    "requiredModel": "qwen2.5:0.5b",
    "readiness": {
      "startTimeoutMs": 30000,
      "installTimeoutMs": 600000,
      "pollInitialMs": 400,
      "pollMaxMs": 3000,
      "verifyTimeoutMs": 120000
    },
    "installer": {
      "windowsUrl": "https://ollama.com/download/OllamaSetup.exe",
      "minBytes": 100000000,
      "maxBytes": 2000000000,
      "expectHeader": "MZ",
      "sha256Env": "WG_OLLAMA_SETUP_SHA256"
    },
    "models": [
      {
        "id": "qwen2.5:0.5b",
        "label": "Qwen 2.5 0.5B",
        "downloadGb": 0.4,
        "runtimeGb": 1,
        "needs": {
          "ramGb": 0
        },
        "summary": "Smallest model that reliably returns valid JSON."
      },
      {
        "id": "qwen2.5:1.5b",
        "label": "Qwen 2.5 1.5B",
        "downloadGb": 1,
        "runtimeGb": 2,
        "needs": {
          "ramGb": 8
        },
        "summary": "Noticeably better at reading a business description."
      },
      {
        "id": "qwen2.5:3b",
        "label": "Qwen 2.5 3B",
        "downloadGb": 1.9,
        "runtimeGb": 3.5,
        "needs": {
          "ramGb": 16
        },
        "summary": "Best query quality this application can actually use."
      }
    ]
  },
  "application": {
    "directories": [
      "uploads",
      "exports",
      "tools",
      "uiux"
    ],
    "stateFile": "setup-state.json"
  },
  "completion": {
    "mandatory": [
      "application",
      "runtime",
      "skills"
    ],
    "optionalWithConsent": [
      "ollama",
      "model"
    ]
  },
  "disk": {
    "ollamaInstallGb": 4.5,
    "ollamaDownloadGb": 0.8,
    "skillsGb": 0.1,
    "temporaryGb": 1,
    "marginGb": 2
  }
};
