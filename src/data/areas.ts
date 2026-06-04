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
  { id: 5, name: "Zero-Day Defense", subtitle: "Stop the apex threat", firstLevel: 41, lastLevel: 50, theme: "zeroDay", villainKey: "ax10m2", villainName: "AX-10M2", accent: "#35ea83", icon: "bolt", completionReward: 500 },
  { id: 6, name: "AI Counterattack", subtitle: "The grid fights back", firstLevel: 51, lastLevel: 60, theme: "aiCounterattack", villainKey: "aurora6", villainName: "AURORA-6", accent: "#ff5572", icon: "brain", completionReward: 600 },
  { id: 7, name: "Firmware Purge", subtitle: "Burn out corrupted sectors", firstLevel: 61, lastLevel: 70, theme: "firmwarePurge", villainKey: "rusty", villainName: "RUSTY", accent: "#ff8a3d", icon: "flame", completionReward: 700 },
  { id: 8, name: "Protocol Override", subtitle: "Rewrite the rules of engagement", firstLevel: 71, lastLevel: 80, theme: "protocolOverride", villainKey: "tee", villainName: "TEE", accent: "#aa7cff", icon: "swap", completionReward: 800 },
  { id: 9, name: "Deep Net Sweep", subtitle: "Hunt threats in the dark web", firstLevel: 81, lastLevel: 90, theme: "deepNetSweep", villainKey: "tish", villainName: "TISH", accent: "#1bc8b5", icon: "search", completionReward: 900 },
  { id: 10, name: "Final Breach", subtitle: "End the war for the grid", firstLevel: 91, lastLevel: 100, theme: "finalBreach", villainKey: "helix", villainName: "HELIX", accent: "#ff4fd8", icon: "unlock", completionReward: 1000 }
];

export function areaForLevel(levelId: number): AreaInfo {
  return areas.find((area) => levelId >= area.firstLevel && levelId <= area.lastLevel) ?? areas[0];
}
