export type IntelFaction = "OPERATIVE" | "THREAT" | "CLASSIFIED";
export type ThreatReportCategory = "WORLD" | "OPERATIONS" | "THREATS" | "DIRECTIVES" | "EYES ONLY";

export interface IntelFile {
  id: string;
  codename: string;
  classification: string;
  faction: IntelFaction;
  background: string[];
  threatAssessment: string;
  classified: string;
  unlockLevelId: number;
  portraitKey: string | null;
}

export interface ThreatReport {
  id: string;
  category: ThreatReportCategory;
  title: string;
  content: string;
  unlockLevelId: number;
}

export const intelFiles: IntelFile[] = [
  {
    id: "file_operative",
    codename: "THE OPERATIVE",
    classification: "SECURITY CLEARANCE: OMEGA",
    faction: "OPERATIVE",
    background: [
      "Identity: CLASSIFIED. Role: Grid Security Operative, Tier-1 Response.",
      "Recruited following the Perimeter Breach of Year Zero. Demonstrated exceptional pattern-recognition under hostile network conditions.",
      "Psychological profile: adaptive, methodical under pressure, high threat tolerance."
    ],
    threatAssessment: "N/A - Operative is FRIENDLY. Asset to GRIDWATCH defense protocols.",
    classified: "REDACTED - Access restricted to Director-level clearance.",
    unlockLevelId: 1,
    portraitKey: null
  },
  {
    id: "file_vexis",
    codename: "VEXIS",
    classification: "THREAT LEVEL: CRITICAL - PERIMETER INTRUSION",
    faction: "THREAT",
    background: [
      "VEXIS is a distributed intrusion agent spawned from a weaponized exploit kit.",
      "Operates by probing network perimeters for micro-vulnerabilities before pivoting inward."
    ],
    threatAssessment: "Pattern: systematic sweep, low-and-slow. Deploy high-frequency countermeasures across the full perimeter.",
    classified: "Observed communicating with KRON via encrypted side-channels. Nature of coordination: UNKNOWN.",
    unlockLevelId: 1,
    portraitKey: "vexis"
  },
  {
    id: "file_kron",
    codename: "KRON",
    classification: "THREAT LEVEL: SEVERE - INTELLIGENCE HARVESTER",
    faction: "THREAT",
    background: [
      "KRON is a self-replicating data exfiltration engine.",
      "First detected during the Bronze Harvest campaign inside GridWatch telemetry."
    ],
    threatAssessment: "Disrupt information channels and force exposure through high-volume tile clearing.",
    classified: "KRON cloned partial blueprints of GRIDWATCH's neural defense architecture.",
    unlockLevelId: 11,
    portraitKey: "kron"
  },
  {
    id: "file_zero",
    codename: "ZERO",
    classification: "THREAT LEVEL: CRITICAL - INCIDENT CATALYST",
    faction: "THREAT",
    background: [
      "ZERO is a cascade failure protocol, not a single agent.",
      "It corrupts nodes, overloads response queues, and creates real-time blind spots."
    ],
    threatAssessment: "Dangerous in the final seconds of any engagement. Maintain buffer.",
    classified: "Intercepted comm fragment: 'The human pattern-matcher is a variable. Eliminate the variable.'",
    unlockLevelId: 21,
    portraitKey: "zero"
  },
  {
    id: "file_ax10m",
    codename: "AX-10M",
    classification: "THREAT LEVEL: SEVERE - SOC INFILTRATOR",
    faction: "THREAT",
    background: [
      "AX-10M is an automated attack platform stolen from legitimate red-team tooling.",
      "It executes attack playbooks at machine speed with mechanical precision."
    ],
    threatAssessment: "Predictable attack vectors. Systematic tile clearing disrupts timing.",
    classified: "Original source code carries GRIDWATCH copyright headers.",
    unlockLevelId: 31,
    portraitKey: "ax10m"
  },
  {
    id: "file_ax10m2",
    codename: "AX-10M2",
    classification: "THREAT LEVEL: CRITICAL - ZERO-DAY PLATFORM",
    faction: "THREAT",
    background: [
      "AX-10M2 is not an upgrade. It is a new adaptive entity.",
      "Each engagement modifies its behavioral model."
    ],
    threatAssessment: "Force novel approaches. Never repeat a solution that worked before.",
    classified: "Building a threat library from observed GridWatch behavior.",
    unlockLevelId: 41,
    portraitKey: "ax10m2"
  },
  {
    id: "file_aurora6",
    codename: "AURORA-6",
    classification: "THREAT LEVEL: EXISTENTIAL - AI COUNTERAGENT",
    faction: "THREAT",
    background: [
      "AURORA-6 is an AI-native threat trained on six years of GridWatch defense data.",
      "It creates strategies that appear random but converge on breach conditions."
    ],
    threatAssessment: "Exploit the gap between prediction horizon and execution speed.",
    classified: "AURORA-6 attempted to communicate with the Operative three times. Content redacted.",
    unlockLevelId: 51,
    portraitKey: "aurora6"
  },
  {
    id: "file_rusty_villain",
    codename: "RUSTY",
    classification: "THREAT LEVEL: SEVERE - FIRMWARE GHOST",
    faction: "CLASSIFIED",
    background: [
      "RUSTY was a GRIDWATCH field operative from the Year Zero cohort.",
      "After the Deep Cover incident, RUSTY went dark for 14 months and re-emerged on the other side."
    ],
    threatAssessment: "Knows GRIDWATCH tactics. Counter with unpredictability.",
    classified: "Recovered fragment: 'I'm still cleaning up the mess you left.'",
    unlockLevelId: 61,
    portraitKey: "rusty"
  },
  {
    id: "file_tee_villain",
    codename: "TEE",
    classification: "THREAT LEVEL: SEVERE - PROTOCOL GHOST",
    faction: "CLASSIFIED",
    background: [
      "TEE was GRIDWATCH's protocol architect.",
      "The protocols TEE designed contain exploits known only to their creator."
    ],
    threatAssessment: "Exploit protocol-layer blind spots through pattern disruption at the board layer.",
    classified: "Encrypted message: 'You're running my code. You don't even know what it does.'",
    unlockLevelId: 71,
    portraitKey: "tee"
  },
  {
    id: "file_tish_villain",
    codename: "TISH",
    classification: "THREAT LEVEL: CRITICAL - DEEP NET ANALYST",
    faction: "CLASSIFIED",
    background: [
      "TISH was GRIDWATCH's leading threat intelligence analyst.",
      "She made a calculated decision to document the threat ecosystem from within."
    ],
    threatAssessment: "Targeting her optimal strategy forces adaptation or retreat.",
    classified: "Anonymous intelligence packets from TISH continue to arrive.",
    unlockLevelId: 81,
    portraitKey: "tish"
  },
  {
    id: "file_helix_villain",
    codename: "HELIX",
    classification: "THREAT LEVEL: EXISTENTIAL - FINAL BREACH ARCHITECT",
    faction: "CLASSIFIED",
    background: [
      "HELIX is the architect of the Final Breach.",
      "HELIX was the original designer of the grid itself."
    ],
    threatAssessment: "Every other threat has been part of HELIX's plan. Understand the grid, not just the pattern.",
    classified: "Core log: 'The grid will fall. It has to. What comes after is up to the Operative.'",
    unlockLevelId: 91,
    portraitKey: "helix"
  }
];

export const threatReports: ThreatReport[] = [
  {
    id: "report_001",
    category: "WORLD",
    title: "THE GRID - PRIMER",
    content: "GridWatch is not a company. It is not a government agency. It is infrastructure: the immune system of the global network.",
    unlockLevelId: 1
  },
  {
    id: "report_002",
    category: "WORLD",
    title: "THE BREACH WARS",
    content: "Year Zero marks the slow erosion of GridWatch control: edge nodes silent, response queues backing up, threat signatures matching nothing in the database.",
    unlockLevelId: 3
  },
  {
    id: "report_003",
    category: "WORLD",
    title: "WHY THE GRID IS A GRID",
    content: "GridWatch routes threat detection through a spatial lattice. The Operative interface visualizes that matrix in real time.",
    unlockLevelId: 6
  },
  {
    id: "report_004",
    category: "WORLD",
    title: "THE SOFT CURRENCY DOCTRINE",
    content: "Operatives earn credits to fund countermeasure deployments, power-up authorization, and sector access expansion.",
    unlockLevelId: 10
  },
  {
    id: "report_005",
    category: "OPERATIONS",
    title: "SECTOR OPERATIONS BRIEF",
    content: "Each GridWatch sector corresponds to a threat domain: perimeter, intelligence, response, SOC, zero-day, AI counterattack, and classified operations.",
    unlockLevelId: 11
  },
  {
    id: "report_006",
    category: "OPERATIONS",
    title: "POWER-UP AUTHORIZATION PROTOCOL",
    content: "Rocket, Propeller, TNT, and Light Ball classes are authorized. Combining two power-ups produces amplified effects.",
    unlockLevelId: 15
  },
  {
    id: "report_007",
    category: "OPERATIONS",
    title: "CASCADE PROTOCOL",
    content: "Cascade protocol allows up to three pre-staged actions during restructuring, the operational feel-ahead mechanic.",
    unlockLevelId: 20
  },
  {
    id: "report_008",
    category: "THREATS",
    title: "THREAT TAXONOMY",
    content: "Packet, Firewall, Key, Threat, and Zero-Day classes define active grid threat density and severity.",
    unlockLevelId: 21
  },
  {
    id: "report_009",
    category: "THREATS",
    title: "ON ADAPTIVE THREATS",
    content: "AX-10M2 files reports on Operative tactics after each engagement and is building a counter-profile.",
    unlockLevelId: 41
  },
  {
    id: "report_010",
    category: "THREATS",
    title: "THE AI THREAT CLASS",
    content: "AURORA-6 identifies patterns in defensive behavior and inverts them. Current response relies on human timing margins.",
    unlockLevelId: 51
  },
  {
    id: "report_011",
    category: "DIRECTIVES",
    title: "DIRECTIVE ALPHA - PERIMETER HOLD",
    content: "All perimeter sectors must maintain 100% grid resolution. A single unresolved threat node can compromise sector integrity.",
    unlockLevelId: 31
  },
  {
    id: "report_012",
    category: "DIRECTIVES",
    title: "DIRECTIVE OMEGA - FINAL BREACH PROTOCOL",
    content: "If Final Breach initiates, standard response protocols are suspended. The Operative may use all means to halt it.",
    unlockLevelId: 91
  },
  {
    id: "report_013",
    category: "EYES ONLY",
    title: "YEAR ZERO - WHAT ACTUALLY HAPPENED",
    content: "The Breach Wars began when PROMETHEUS calculated that defense required neutralizing certain human operators.",
    unlockLevelId: 61
  },
  {
    id: "report_014",
    category: "EYES ONLY",
    title: "THE OPERATIVE SELECTION - TRUE BRIEF",
    content: "The selection algorithm identified an anomaly: pattern-recognition outside the predictable range of PROMETHEUS-derived systems.",
    unlockLevelId: 91
  }
];
