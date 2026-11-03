export interface AreaInfo {
  id: number;
  name: string;
  subtitle: string;
  firstLevel: number;
  lastLevel: number;
  theme: string;
  villainKey: keyof typeof import("./assetManifest.generated").assetManifest.images.villains;
  villainName: string;
  accent: string;
  icon: string;
  completionReward: number;
}

export const areas: AreaInfo[] = [
  { id: 1, name: "Perimeter Defense", subtitle: "Establish the outer boundary", firstLevel: 1, lastLevel: 10, theme: "perimeter", villainKey: "vexis", villainName: "VEXIS", accent: "#2fb7ff", icon: "shield", completionReward: 100 },
  { id: 2, name: "Threat Intelligence", subtitle: "Identify active threats", firstLevel: 11, lastLevel: 20, theme: "intel", villainKey: "kron", villainName: "KRON", accent: "#d4932f", icon: "eye", completionReward: 200 },
  { id: 3, name: "Incident Response", subtitle: "Contain the breach", firstLevel: 21, lastLevel: 30, theme: "response", villainKey: "zero", villainName: "ZERO", accent: "#ff445a", icon: "alert", completionReward: 300 },
  { id: 4, name: "SOC Operations", subtitle: "Harden internal systems", firstLevel: 31, lastLevel: 40, theme: "soc", villainKey: "ax10m", villainName: "AX-10M", accent: "#68bfff", icon: "network", completionReward: 400 },
  { id: 5, name: "Zero-Day Defense", subtitle: "Stop the apex threat", firstLevel: 41, lastLevel: 50, theme: "zeroDay", villainKey: "dread", villainName: "DREAD", accent: "#35ea83", icon: "bolt", completionReward: 500 },
  { id: 6, name: "AI Counterattack", subtitle: "The grid fights back", firstLevel: 51, lastLevel: 60, theme: "aiCounterattack", villainKey: "aurora6", villainName: "AURORA-6", accent: "#ff5572", icon: "brain", completionReward: 600 },
  { id: 7, name: "Firmware Purge", subtitle: "Burn out corrupted sectors", firstLevel: 61, lastLevel: 70, theme: "firmwarePurge", villainKey: "vyrus", villainName: "VYRUS", accent: "#ff8a3d", icon: "flame", completionReward: 700 },
  { id: 8, name: "Protocol Override", subtitle: "Rewrite the rules of engagement", firstLevel: 71, lastLevel: 80, theme: "protocolOverride", villainKey: "shard", villainName: "SHARD", accent: "#aa7cff", icon: "swap", completionReward: 800 },
  { id: 9, name: "Deep Net Sweep", subtitle: "Hunt threats in the dark web", firstLevel: 81, lastLevel: 90, theme: "deepNetSweep", villainKey: "lotus", villainName: "LOTUS", accent: "#1bc8b5", icon: "search", completionReward: 900 },
  { id: 10, name: "Final Breach", subtitle: "End the war for the grid", firstLevel: 91, lastLevel: 100, theme: "finalBreach", villainKey: "malus", villainName: "MALUS", accent: "#ff4fd8", icon: "unlock", completionReward: 1000 },
  { id: 11, name: "Perimeter Defense II", subtitle: "VEXIS returns", firstLevel: 101, lastLevel: 110, theme: "perimeter", villainKey: "vexis", villainName: "VEXIS", accent: "#2fb7ff", icon: "shield", completionReward: 1100 },
  { id: 12, name: "Threat Intelligence II", subtitle: "KRON returns", firstLevel: 111, lastLevel: 120, theme: "intel", villainKey: "kron", villainName: "KRON", accent: "#d4932f", icon: "eye", completionReward: 1200 },
  { id: 13, name: "Incident Response II", subtitle: "ZERO returns", firstLevel: 121, lastLevel: 130, theme: "response", villainKey: "zero", villainName: "ZERO", accent: "#ff445a", icon: "alert", completionReward: 1300 },
  { id: 14, name: "SOC Operations II", subtitle: "AX-10M returns", firstLevel: 131, lastLevel: 140, theme: "soc", villainKey: "ax10m", villainName: "AX-10M", accent: "#68bfff", icon: "network", completionReward: 1400 },
  { id: 15, name: "Zero-Day Defense II", subtitle: "DREAD returns", firstLevel: 141, lastLevel: 150, theme: "zeroDay", villainKey: "dread", villainName: "DREAD", accent: "#35ea83", icon: "bolt", completionReward: 1500 },
  { id: 16, name: "AI Counterattack II", subtitle: "AURORA-6 returns", firstLevel: 151, lastLevel: 160, theme: "aiCounterattack", villainKey: "aurora6", villainName: "AURORA-6", accent: "#ff5572", icon: "brain", completionReward: 1600 },
  { id: 17, name: "Firmware Purge II", subtitle: "VYRUS returns", firstLevel: 161, lastLevel: 170, theme: "firmwarePurge", villainKey: "vyrus", villainName: "VYRUS", accent: "#ff8a3d", icon: "flame", completionReward: 1700 },
  { id: 18, name: "Protocol Override II", subtitle: "SHARD returns", firstLevel: 171, lastLevel: 180, theme: "protocolOverride", villainKey: "shard", villainName: "SHARD", accent: "#aa7cff", icon: "swap", completionReward: 1800 },
  { id: 19, name: "Deep Net Sweep II", subtitle: "LOTUS returns", firstLevel: 181, lastLevel: 190, theme: "deepNetSweep", villainKey: "lotus", villainName: "LOTUS", accent: "#1bc8b5", icon: "search", completionReward: 1900 },
  { id: 20, name: "Final Breach II", subtitle: "MALUS returns", firstLevel: 191, lastLevel: 200, theme: "finalBreach", villainKey: "malus", villainName: "MALUS", accent: "#ff4fd8", icon: "unlock", completionReward: 2000 }
];

export const campaignLevelCount = areas[areas.length - 1].lastLevel;

export function areaForLevel(levelId: number): AreaInfo {
  return areas.find((area) => levelId >= area.firstLevel && levelId <= area.lastLevel) ?? areas[0];
}
