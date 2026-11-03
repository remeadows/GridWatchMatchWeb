// Level names for the levels the tool builds. Levels 11-100 keep the names they shipped with; 101-200 are new.
// Names must stay unique across the whole campaign (levels 1-10 are hand-made and named in their own files).
// Edit freely, then rebuild.

const keptNames = [
  "Signal Drift", "Credential Flood", "Port Siege", "Trace Relay", "Breach Surface",
  "Purge Sweep", "Node Sanitization", "Cache Flush", "Sector Wipe", "Containment Sweep",
  "Compound Breach I", "Compound Breach II", "Compound Breach III", "Compound Breach IV", "Compound Breach V",
  "Aggressive Uplink", "Hostile Handshake", "Cipher Sprint", "Backdoor Pressure", "Lateral Shock",
  "Mass Cleanup I", "Mass Cleanup II", "Mass Cleanup III", "Mass Cleanup IV", "Mass Cleanup V",
  "Dual Threat I", "Dual Threat II", "Dual Threat III", "Dual Threat IV", "Dual Threat V",
  "Proxy Ambush", "Memory Bleed", "Convergent Strike", "Kill Chain", "Parallel Intrusion",
  "Critical Convergence I", "Critical Convergence II", "Critical Convergence III", "Critical Convergence IV", "Apex Breach",
  "Counterstrike Protocol", "Adversarial Drift", "Reinforcement Loop", "Adaptive Breach", "Autonomous Siege",
  "Model Collapse", "Signal Poisoning", "Inference Flood", "Cascade Override", "Machine Uprising",
  "Sector Scan", "Corrupt Block", "Flash Wipe", "ROM Dump", "Register Overflow",
  "Interrupt Handler", "Stack Trace", "Firmware Rollback", "Boot Loop", "Rusty's Forge",
  "Handshake Jam", "Packet Forgery", "Session Hijack", "Token Theft", "Certificate Burn",
  "DNS Sinkhole", "Proxy Chain", "Tunnel Collapse", "Route Poisoning", "Tee's Gambit",
  "Onion Layer", "Hidden Service", "Relay Node", "Exit Guard", "Darkpool Drain",
  "Cipher Maze", "Shadow Mirror", "Tor Breach", "Dead Drop", "Tish's Labyrinth",
  "Core Access", "Memory Injection", "Kernel Panic", "System Call", "Ring Zero",
  "Privilege Escalation", "Root Shell", "Kill Switch", "Total Recall", "Helix Endgame"
];

/** Names for levels 101-200, ten a sector. */
export const newLevelNames = [
  // 101-110 Perimeter Defense II
  "Outer Wall", "Gate Watch", "Border Patrol", "Tripwire", "Perimeter Sweep",
  "Fence Line", "Watchtower", "Moat Breach", "Rampart Hold", "Siege Line",
  // 111-120 Threat Intelligence II
  "Signal Intercept", "Chatter Spike", "Source Trace", "Indicator Hunt", "Beacon Watch",
  "Dossier Leak", "Pattern Match", "Noise Floor", "Intel Fusion", "Threat Horizon",
  // 121-130 Incident Response II
  "Breach Alarm", "First Responder", "Triage Queue", "Quarantine Zone", "Isolation Ward",
  "Hot Patch", "Rollback Point", "Damage Control", "Blast Radius", "Containment Wall",
  // 131-140 SOC Operations II
  "Night Shift", "Alert Fatigue", "Log Storm", "Dashboard Red", "Ticket Flood",
  "Correlation Rule", "Watch Floor", "Escalation Path", "False Positive", "Full Lockdown",
  // 141-150 Zero-Day Defense II
  "Patch Gap", "Unknown Exploit", "Exploit Kit", "Vulnerability Window", "Disclosure Race",
  "Payload Drop", "Shellcode", "Heap Spray", "Use After Free", "Day Zero",
  // 151-160 AI Counterattack II
  "Neural Bait", "Model Theft", "Prompt Injection", "Weight Drift", "Synthetic Swarm",
  "Training Leak", "Gradient Storm", "Overfit", "Hallucination", "Machine Siege",
  // 161-170 Firmware Purge II
  "Bootkit", "Flash Corruption", "Rootkit Burn", "Microcode Rot", "Signed Malware",
  "Bricked Node", "Fuse Blown", "Silicon Ghost", "Bad Sector", "Firmware Inferno",
  // 171-180 Protocol Override II
  "Packet Smuggling", "Header Spoof", "Replay Attack", "Downgrade Attack", "Handshake Break",
  "Cipher Swap", "Port Knock", "Protocol Fork", "Rule Rewrite", "Override Lock",
  // 181-190 Deep Net Sweep II
  "Dark Mirror", "Silent Crawl", "Hidden Relay", "Marketplace Raid", "Burner Node",
  "Ghost Market", "Deep Crawl", "Black Box", "Abyss Scan", "Net Trawl",
  // 191-200 Final Breach II
  "Last Line", "Core Breach", "Control Plane", "Master Key", "Root Cause",
  "System Collapse", "Zero Trust", "Final Handshake", "Last Packet", "Grid Endgame"
];

export function levelName(levelId: number): string {
  const name = levelId >= 11 && levelId <= 100 ? keptNames[levelId - 11] : levelId >= 101 && levelId <= 200 ? newLevelNames[levelId - 101] : undefined;
  if (name === undefined) throw new Error(`No name for level ${levelId}: the level tool names 11 to 200.`);
  return name;
}
