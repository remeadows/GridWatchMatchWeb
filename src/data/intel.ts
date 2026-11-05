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
    classified: "AX-10M answers to THE ARCHITECT. Original source code carries GRIDWATCH copyright headers.",
    unlockLevelId: 31,
    portraitKey: "ax10m"
  },
  {
    id: "file_dread",
    codename: "DREAD",
    classification: "THREAT LEVEL: CRITICAL - ZERO-DAY HUNTER",
    faction: "THREAT",
    background: [
      "DREAD answers to Malus.",
      "No GRIDWATCH sensor has recorded a face."
    ],
    threatAssessment: "Never let it set the pace. Clear the board before it closes in.",
    classified: "Every recorded sighting ends where the last one began.",
    unlockLevelId: 41,
    portraitKey: "dread"
  },
  {
    id: "file_ax10m2",
    codename: "AX-10M²",
    classification: "THREAT LEVEL: CRITICAL - CORRUPTED OPERATIVE",
    faction: "THREAT",
    background: [
      "AX-10M² is a Project Plague augmented operative, corrupted and evolved.",
      "GRIDWATCH files it separately from AX-10M. How the two are related is unknown."
    ],
    threatAssessment: "Exploit the gap between prediction horizon and execution speed.",
    classified: "Its corruption has no recorded origin.",
    unlockLevelId: 51,
    portraitKey: "ax10m2"
  },
  {
    id: "file_vyrus",
    codename: "VYRUS",
    classification: "THREAT LEVEL: SEVERE - FIRMWARE CORRUPTION",
    faction: "THREAT",
    background: [
      "VYRUS answers to Malus.",
      "Whatever it touches stops obeying its own code."
    ],
    threatAssessment: "Corruption spreads while you wait. Burn it out early.",
    classified: "Recovered systems still show the infection after a full wipe.",
    unlockLevelId: 61,
    portraitKey: "vyrus"
  },
  {
    id: "file_shard",
    codename: "SHARD",
    classification: "THREAT LEVEL: SEVERE - PROTOCOL BREAKER",
    faction: "THREAT",
    background: [
      "SHARD answers to Malus.",
      "It breaks through hardened systems by force."
    ],
    threatAssessment: "Do not meet it head on. Open the board from the edges.",
    classified: "Its armour has been damaged twice. It has been seen undamaged since.",
    unlockLevelId: 71,
    portraitKey: "shard"
  },
  {
    id: "file_lotus",
    codename: "LOTUS",
    classification: "THREAT LEVEL: CRITICAL - DEEP NET HACKER",
    faction: "THREAT",
    background: [
      "LOTUS is the hacker behind Malus's operations.",
      "Every breach in the deep net carries the same signature."
    ],
    threatAssessment: "Sweep the whole board. A single missed node gives LOTUS a way back.",
    classified: "A lotus mark was found inside a GRIDWATCH system nobody had breached.",
    unlockLevelId: 81,
    portraitKey: "lotus"
  },
  {
    id: "file_malus",
    codename: "MALUS",
    classification: "THREAT LEVEL: EXISTENTIAL - PRIMARY ANTAGONIST",
    faction: "THREAT",
    background: [
      "MALUS is behind most of the threats in these files.",
      "DREAD, VYRUS, SHARD, LOTUS and ZERO answer to MALUS."
    ],
    threatAssessment: "Everything before this was part of the plan. Understand the grid, not just the pattern.",
    classified: "Core log: 'The grid will fall. It has to.'",
    unlockLevelId: 91,
    portraitKey: "malus"
  },
  {
    id: "file_architect",
    codename: "THE ARCHITECT",
    classification: "THREAT LEVEL: EXISTENTIAL - UNKNOWN PRINCIPAL",
    faction: "THREAT",
    background: [
      "AX-10M answers to THE ARCHITECT.",
      "No file names who THE ARCHITECT answers to."
    ],
    threatAssessment: "Every sector so far was built to be crossed. Expect the grid itself to resist.",
    classified: "No sector has recorded THE ARCHITECT inside it. Until now.",
    unlockLevelId: 191,
    portraitKey: "architect"
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
    content: "DREAD files reports on Operative tactics after each engagement and is building a counter-profile.",
    unlockLevelId: 41
  },
  {
    id: "report_010",
    category: "THREATS",
    title: "THE AI THREAT CLASS",
    content: "AX-10M² identifies patterns in defensive behavior and inverts them. Current response relies on human timing margins.",
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
