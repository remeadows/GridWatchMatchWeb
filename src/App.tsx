import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { areaForLevel, areas, type AreaInfo } from "./data/areas";
import { assetManifest, assetUrl } from "./data/assets";
import { heroes } from "./data/heroes";
import { intelFiles, threatReports } from "./data/intel";
import { loadLevel, objectiveLabel } from "./data/levels";
import { rulesSections, tutorialSteps } from "./data/rules";
import { clearancePass, coinPacks, playOnCost, playOnExtraMoves } from "./data/store";
import { BoardEngine, type BoardAction, type BoardDelta, type BoardResolutionStep, type BoardSnapshot, type BoosterType, type LevelDefinition } from "./engine";
import { type BoardAnimationEvent } from "./game/BoardScene";
import { GameCanvas, type GameCanvasHandle } from "./game/GameCanvas";
import { advancePlayClock, PlaybackLifecycle, playbackHudAtStep, type PlaybackHud, type PlayClock } from "./game/playbackLifecycle";
import { analytics } from "./services/analytics";
import { audioService } from "./services/audio";
import { submitScore, type SubmitResult } from "./services/scoreApi";
import { useAuth } from "./hooks/useAuth";
import {
  areaProgressLabel,
  awardLevelCompletion,
  bestScoreForLevel,
  cloneSave,
  collectAreaReward,
  completedLevelsInArea,
  currentArea,
  isAreaComplete,
  isAreaUnlocked,
  isHeroUnlocked,
  isLevelUnlocked,
  levelSeed,
  starsForLevel
} from "./state/progress";
import { defaultSaveState, loadSaveState, persistSaveState, resetSaveState, type SaveState } from "./state/save";
import { createPreviewSaveStore, maySubmitPreviewScore, selectBalanceProfile } from "./dev/balancePreview";

type Screen =
  | { name: "home" }
  | { name: "areas" }
  | { name: "levels"; areaId: number }
  | { name: "game"; levelId: number }
  | { name: "account" }
  | { name: "settings" }
  | { name: "rules" }
  | { name: "intel" }
  | { name: "store" };

const boosterTypes: BoosterType[] = ["rocket", "rocketVertical", "tnt", "propeller", "lightBall"];

// Capture the mode once: editing the URL mid-run cannot release its isolation.
const balanceProfile = import.meta.env.DEV
  ? selectBalanceProfile({ isDevelopment: true, search: window.location.search }) : null;
const saveStore = balanceProfile ? createPreviewSaveStore(defaultSaveState)
  : { load: loadSaveState, persist: persistSaveState, reset: resetSaveState };

interface BoosterDragState {
  booster: BoosterType;
  x: number;
  y: number;
}

export default function App() {
  const [save, setSave] = useState<SaveState | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const appliedInitialRoute = useRef(false);
  const auth = useAuth();

  useEffect(() => {
    let active = true;
    void saveStore.load().then((loaded) => {
      if (active) setSave(loaded);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!save || appliedInitialRoute.current) return;
    appliedInitialRoute.current = true;
    const params = new URLSearchParams(window.location.search);
    const requestedLevel = Number(params.get("level"));
    if (params.has("gwTestMode") && Number.isInteger(requestedLevel) && requestedLevel >= 1 && requestedLevel <= 100) {
      setScreen({ name: "game", levelId: requestedLevel });
    }
  }, [save]);

  useEffect(() => {
    if (!save) return;
    audioService.configure(save.settings);
    if (screen.name === "game") return;
    audioService.playMusic("bgm_menu.mp3");
  }, [save, screen.name]);

  const commitSave = useCallback((next: SaveState) => {
    setSave(next);
    void saveStore.persist(next);
  }, []);

  if (!save) {
    return (
      <main className="app-shell loading-shell">
        <div className="boot-panel">
          <img src={assetUrl(assetManifest.images.appIcon)} alt="" />
          <h1>GridWatch Match</h1>
          <p>Loading local grid state...</p>
        </div>
      </main>
    );
  }

  const navigate = (next: Screen) => setScreen(next);

  return (
    <main className="app-shell">
      <TopBar save={save} screen={screen} navigate={navigate} />
      {screen.name === "home" && <HomeScreen save={save} navigate={navigate} />}
      {screen.name === "areas" && <AreasScreen save={save} commitSave={commitSave} navigate={navigate} />}
      {screen.name === "levels" && <LevelsScreen area={areas.find((area) => area.id === screen.areaId) ?? areas[0]} save={save} navigate={navigate} />}
      {screen.name === "game" && <GameScreen levelId={screen.levelId} save={save} commitSave={commitSave} navigate={navigate} auth={auth} />}
      {screen.name === "account" && <AccountScreen save={save} commitSave={commitSave} auth={auth} />}
      {screen.name === "settings" && <SettingsScreen save={save} commitSave={commitSave} />}
      {screen.name === "rules" && <RulesScreen save={save} commitSave={commitSave} />}
      {screen.name === "intel" && <IntelScreen save={save} commitSave={commitSave} />}
      {screen.name === "store" && <StoreScreen />}
    </main>
  );
}

function TopBar({ save, screen, navigate }: { save: SaveState; screen: Screen; navigate: (screen: Screen) => void }) {
  const active = screen.name;
  return (
    <header className="top-bar">
      <button className={`brand${active === "home" ? " active" : ""}`} onClick={() => navigate({ name: "home" })} aria-label="Home">
        <img src={assetUrl(assetManifest.images.appIcon)} alt="" />
        <span className="brand-copy">
          <strong>GridWatch</strong>
          <small>Match Command</small>
        </span>
      </button>
      <nav className="main-nav" aria-label="Primary">
        <button className={active === "areas" || active === "levels" ? "active" : ""} onClick={() => navigate({ name: "areas" })}>Operations</button>
        <button className={active === "intel" ? "active" : ""} onClick={() => navigate({ name: "intel" })}>Intel</button>
        <button className={active === "account" ? "active" : ""} onClick={() => navigate({ name: "account" })}>Account</button>
        <button className={active === "store" ? "active" : ""} onClick={() => navigate({ name: "store" })}>Store</button>
        <button className={active === "settings" ? "active" : ""} onClick={() => navigate({ name: "settings" })}>Settings</button>
      </nav>
      <div className="currency" aria-label={`${save.coins} coins`}>
        <span>Credits</span>
        <strong>{save.coins.toLocaleString()}</strong>
      </div>
    </header>
  );
}

function HomeScreen({ save, navigate }: { save: SaveState; navigate: (screen: Screen) => void }) {
  const area = currentArea(save);
  const hero = heroes.find((candidate) => candidate.id === save.selectedHeroId) ?? heroes[0];
  const completedLevels = Object.keys(save.levels).length;
  const nextLevel = Math.min(100, Math.max(1, completedLevels + 1));
  const areaCompleted = completedLevelsInArea(save, area);
  const areaTotal = area.lastLevel - area.firstLevel + 1;
  const homeStyle = {
    backgroundImage: `url(${assetUrl(assetManifest.images.backgrounds.home)})`,
    "--area-accent": area.accent
  } as CSSProperties;

  return (
    <section className="home-grid" data-testid="home-command-deck" style={homeStyle}>
      <div className="home-visual">
        <div className="home-statusline">
          <div className="network-status">
            <span className="status-beacon" aria-hidden="true" />
            <span>
              <strong>Grid online</strong>
              <small>Live defense network</small>
            </span>
          </div>
          <div className="campaign-uplink">
            <span>Campaign uplink</span>
            <strong>{String(nextLevel).padStart(2, "0")} / 100</strong>
          </div>
        </div>

        <div className="home-copy">
          <span className="home-kicker">Cyber defense command</span>
          <h1><span>GridWatch</span> <strong>Match</strong></h1>
          <p>Build combos, trigger countermeasures, and defend the city through 100 cyberpunk match-3 operations.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => navigate({ name: "areas" })}>Resume Operations</button>
            <button className="quick-deploy-action" onClick={() => navigate({ name: "game", levelId: nextLevel })}>Quick Deploy</button>
          </div>
          <div className="next-operation">
            <span>Next operation</span>
            <strong>Level {nextLevel}</strong>
            <small>{area.name}</small>
          </div>
        </div>
      </div>

      <aside className="home-panel" aria-label="Command status">
        <header className="home-panel-header">
          <span>Command status</span>
          <strong><span className="status-dot" aria-hidden="true" /> Operational</strong>
        </header>

        <section className="operation-brief">
          <span className="area-number">{String(area.id).padStart(2, "0")}</span>
          <div>
            <span>Current area</span>
            <h2>{area.name}</h2>
            <p>{area.subtitle}</p>
          </div>
        </section>

        <section className="operation-progress">
          <div>
            <span>Sector defense</span>
            <strong>{areaProgressLabel(save, area)}</strong>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label={`${area.name} progress`}
            aria-valuemin={0}
            aria-valuemax={areaTotal}
            aria-valuenow={areaCompleted}
          >
            <span style={{ width: `${(areaCompleted / areaTotal) * 100}%` }} />
          </div>
        </section>

        <section className="agent-brief">
          <img src={assetUrl(assetManifest.images.heroes[hero.id])} alt={`${hero.displayName}, selected agent`} />
          <div>
            <span>Selected agent</span>
            <h2>{hero.displayName}</h2>
            <p>{hero.description}</p>
          </div>
        </section>

        <div className="home-stats">
          <Stat label="Completed Levels" value={`${completedLevels}/100`} />
          <Stat label="Best Area Progress" value={areaProgressLabel(save, area)} />
        </div>

        <footer className="threat-channel">
          <span>Threat signature</span>
          <strong>{area.villainName}</strong>
          <small>Monitoring</small>
        </footer>
      </aside>
    </section>
  );
}

function AreasScreen({ save, commitSave, navigate }: { save: SaveState; commitSave: (save: SaveState) => void; navigate: (screen: Screen) => void }) {
  return (
    <section className="content-column">
      <PageHeader title="Operations" subtitle="Select a cyber defense sector." />
      <div className="area-grid">
        {areas.map((area) => {
          const unlocked = isAreaUnlocked(save, area);
          const complete = isAreaComplete(save, area);
          const rewardReady = complete && !save.areaRewards[String(area.id)];
          return (
            <article className={`area-card ${unlocked ? "" : "locked"}`} key={area.id} style={{ "--accent": area.accent } as React.CSSProperties}>
              <img src={assetUrl(assetManifest.images.villains[area.villainKey])} alt="" />
              <div>
                <div className="card-kicker">Area {area.id} / {area.villainName}</div>
                <h2>{area.name}</h2>
                <p>{area.subtitle}</p>
                <div className="progress-line">
                  <span>{area.firstLevel}-{area.lastLevel}</span>
                  <strong>{areaProgressLabel(save, area)}</strong>
                </div>
                <div className="card-actions">
                  <button disabled={!unlocked} onClick={() => navigate({ name: "levels", areaId: area.id })}>{unlocked ? "Open Levels" : "Locked"}</button>
                  <button disabled={!rewardReady} onClick={() => {
                    const result = collectAreaReward(save, area);
                    if (result.amount > 0) commitSave(result.save);
                  }}>Claim {area.completionReward}</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LevelsScreen({ area, save, navigate }: { area: AreaInfo; save: SaveState; navigate: (screen: Screen) => void }) {
  const levels = Array.from({ length: area.lastLevel - area.firstLevel + 1 }, (_, index) => area.firstLevel + index);
  return (
    <section className="content-column">
      <PageHeader title={area.name} subtitle={`${area.subtitle}. Levels ${area.firstLevel}-${area.lastLevel}.`} />
      <div className="level-grid">
        {levels.map((levelId) => {
          const unlocked = isLevelUnlocked(save, levelId);
          const stars = starsForLevel(save, levelId);
          return (
            <button key={levelId} className="level-tile" disabled={!unlocked} onClick={() => navigate({ name: "game", levelId })}>
              <span>Level {levelId}</span>
              <strong>{stars > 0 ? "★".repeat(stars) : unlocked ? "Ready" : "Locked"}</strong>
              <small>{bestScoreForLevel(save, levelId).toLocaleString()}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; result: SubmitResult }
  | { kind: "error"; message: string }
  | { kind: "skipped"; reason: "test" | "signedOut" };

function GameScreen({ levelId, save, commitSave, navigate, auth }: {
  levelId: number;
  save: SaveState;
  commitSave: (save: SaveState) => void;
  navigate: (screen: Screen) => void;
  auth: ReturnType<typeof useAuth>;
}) {
  const [level, setLevel] = useState<LevelDefinition | null>(null);
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [lastDelta, setLastDelta] = useState<BoardDelta | null>(null);
  const [animationEvent, setAnimationEvent] = useState<BoardAnimationEvent | null>(null);
  const [status, setStatus] = useState<"loading" | "running" | "resolving" | "playOn" | "wonAnimating" | "won" | "failed">("loading");
  const [message, setMessage] = useState("");
  const [score, setScore] = useState(0);
  const [hud, setHud] = useState<PlaybackHud | null>(null);
  const [bossRemaining, setBossRemaining] = useState<number | null>(null);
  const [playOnUsed, setPlayOnUsed] = useState(false);
  const [queueDepth, setQueueDepth] = useState(0);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [showTutorial, setShowTutorial] = useState(false);
  const [runId, setRunId] = useState(0);
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });
  const [selectedBooster, setSelectedBooster] = useState<BoosterType | null>(null);
  const [boosterDrag, setBoosterDrag] = useState<BoosterDragState | null>(null);
  const gameCanvasRef = useRef<GameCanvasHandle | null>(null);
  const engineRef = useRef<BoardEngine | null>(null);
  const lifecycleRef = useRef(new PlaybackLifecycle<BoardAction>());
  const bossClockRef = useRef<PlayClock | null>(null);
  const bossExpiredRef = useRef(false);
  const tutorialVisibleRef = useRef(false);
  const boosterPointerRef = useRef<{
    booster: BoosterType;
    dragging: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNextBoosterClickRef = useRef(false);
  const statusRef = useRef(status);
  const saveRef = useRef(save);
  const scoreRef = useRef(score);
  const tutorialInitialMoveRef = useRef(0);
  const finalRef = useRef(false);
  const animationIdRef = useRef(0);
  const pendingPlaybackRef = useRef<{
    animationId: number;
    initialScore: number;
    nextScore: number;
    engine: BoardEngine;
    level: LevelDefinition;
    steps: readonly BoardResolutionStep[];
    outcome: "win" | "playOn" | null;
  } | null>(null);
  const runStatsRef = useRef({ tilesCleared: 0, powerUpEvents: 0, chainSum: 0 });

  useEffect(() => {
    statusRef.current = status;
    if (status !== "running") {
      setSelectedBooster(null);
      setBoosterDrag(null);
    }
  }, [status]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    let active = true;
    statusRef.current = "loading";
    setStatus("loading");
    setMessage("");
    setScore(0);
    scoreRef.current = 0;
    setHud(null);
    setSnapshot(null);
    setLastDelta(null);
    setAnimationEvent(null);
    setPlayOnUsed(false);
    setSelectedBooster(null);
    setBoosterDrag(null);
    finalRef.current = false;
    pendingPlaybackRef.current = null;
    lifecycleRef.current.reset();
    lifecycleRef.current.suspend(document.hidden);
    bossExpiredRef.current = false;
    bossClockRef.current = null;
    setQueueDepth(0);
    runStatsRef.current = { tilesCleared: 0, powerUpEvents: 0, chainSum: 0 };
    setSubmitState({ kind: "idle" });
    void loadLevel(levelId, balanceProfile).then((loaded) => {
      if (!active) return;
      const engine = new BoardEngine(loaded, levelSeed(loaded.id));
      engineRef.current = engine;
      setLevel(loaded);
      setSnapshot(engine.snapshot);
      setHud({ ...engine.snapshot, score: 0 });
      setBossRemaining(loaded.bossLevel ? loaded.bossTimerSeconds ?? 90 : null);
      bossClockRef.current = loaded.bossLevel
        ? { remainingMs: (loaded.bossTimerSeconds ?? 90) * 1_000, lastAtMs: performance.now(), running: false }
        : null;
      statusRef.current = "running";
      setStatus("running");
      setShowTutorial((!saveRef.current.completedTutorial || saveRef.current.tutorialReplayRequested) && !new URLSearchParams(window.location.search).has("gwTestMode"));
      tutorialInitialMoveRef.current = engine.snapshot.moveCount;
      audioService.playMusic(loaded.bossLevel ? "bgm_boss.mp3" : "bgm_gameplay.mp3");
      analytics.track({ name: "level_start", params: { levelId: loaded.id, boss: loaded.bossLevel } });
    }).catch((error) => {
      if (active) {
        setMessage(String(error));
        setStatus("failed");
      }
    });
    return () => {
      active = false;
      pendingPlaybackRef.current = null;
      lifecycleRef.current.reset();
      bossClockRef.current = null;
      engineRef.current = null;
    };
  }, [levelId, runId]);

  const completeBossExpiry = useCallback(() => {
    statusRef.current = "failed";
    setStatus("failed");
    setMessage("Boss timer expired.");
    audioService.playSfx("sfx_breach_alert.mp3");
    audioService.playSfx("vo_grid_compromised.mp3");
  }, []);

  const requestBossExpiry = useCallback(() => {
    if (bossExpiredRef.current || finalRef.current) return;
    bossExpiredRef.current = true;
    lifecycleRef.current.stop();
    setQueueDepth(0);
    setBossRemaining(0);
    if (bossClockRef.current) bossClockRef.current = { ...bossClockRef.current, remainingMs: 0, running: false };
    if (lifecycleRef.current.activeId === null) completeBossExpiry();
    else {
      statusRef.current = "resolving";
      setStatus("resolving");
    }
  }, [completeBossExpiry]);

  const tickBossClock = useCallback((allowPlay = true) => {
    const clock = bossClockRef.current;
    if (!clock || bossExpiredRef.current) return;
    const running = allowPlay && statusRef.current === "running" && lifecycleRef.current.activeId === null
      && !document.hidden && !tutorialVisibleRef.current;
    const next = advancePlayClock(clock, performance.now(), running);
    bossClockRef.current = next;
    setBossRemaining(Math.ceil(next.remainingMs / 1_000));
    if (next.remainingMs === 0) requestBossExpiry();
  }, [requestBossExpiry]);

  useEffect(() => {
    tutorialVisibleRef.current = showTutorial;
    tickBossClock();
    const timer = window.setInterval(() => tickBossClock(), 100);
    return () => window.clearInterval(timer);
  }, [showTutorial, status, level?.id, tickBossClock]);

  const finishWin = useCallback((nextScore: number, engine: BoardEngine, currentLevel: LevelDefinition, options: { animate?: boolean } = {}) => {
    if (finalRef.current || engineRef.current !== engine) return;
    finalRef.current = true;
    lifecycleRef.current.stop();
    setQueueDepth(0);
    tickBossClock(false);
    const currentSnapshot = engine.snapshot;
    const stars = starsEarned(currentSnapshot);
    const next = awardLevelCompletion(saveRef.current, currentLevel.id, stars, nextScore, playOnUsed);
    commitSave(next);
    saveRef.current = next;

    const isTestMode = new URLSearchParams(window.location.search).has("gwTestMode");
    if (maySubmitPreviewScore({ profile: balanceProfile, hasSession: Boolean(auth.session), isTestMode }) && auth.session) {
      const token = auth.session.access_token;
      setSubmitState({ kind: "sending" });
      submitScore(token, currentLevel.id, {
        ...runStatsRef.current,
        moveCount: currentSnapshot.moveCount,
        stars,
        playOnUsed,
      }, engine.actionLog())
        .then((r) => setSubmitState({ kind: "done", result: r }))
        .catch((err) => setSubmitState({ kind: "error", message: err instanceof Error ? err.message : "Transmit failed." }));
    } else {
      setSubmitState({ kind: "skipped", reason: isTestMode || balanceProfile ? "test" : "signedOut" });
    }

    setSnapshot(currentSnapshot);
    setHud({ ...currentSnapshot, score: nextScore });
    setScore(nextScore);
    const completeWin = () => {
      if (engineRef.current !== engine) return;
      statusRef.current = "won";
      setStatus("won");
      audioService.playSfx("sfx_level_complete.mp3");
      audioService.playSfx("vo_connection_secure.mp3");
      analytics.track({ name: "level_win", params: { levelId: currentLevel.id, stars, score: nextScore } });
    };

    const shouldAnimate = options.animate !== false && !saveRef.current.settings.reducedMotion;
    if (!shouldAnimate) {
      completeWin();
      return;
    }

    statusRef.current = "wonAnimating";
    setStatus("wonAnimating");
    let completed = false;
    const completeOnce = () => {
      if (completed) return;
      completed = true;
      completeWin();
    };
    const started = gameCanvasRef.current?.playWinSequence(completeOnce) ?? false;
    if (!started) {
      setMessage("Board presentation unavailable. Return to level select to continue.");
    }
  }, [commitSave, playOnUsed, auth.session, tickBossClock]);

  const applyAction = useCallback((action: BoardAction) => {
    const engine = engineRef.current;
    if (!engine || !level || statusRef.current !== "running") return false;
    tickBossClock(false);
    if (bossExpiredRef.current) return false;
    try {
      let consumedBooster: BoosterType | null = null;
      if (action.kind === "activateBooster") {
        const available = saveRef.current.boosters[action.booster] ?? 0;
        if (available <= 0) {
          setMessage("No booster inventory remaining.");
          return false;
        }
        consumedBooster = action.booster;
      }
      const { delta, steps } = engine.applyWithResolution(action);
      if (consumedBooster) {
        const available = saveRef.current.boosters[consumedBooster] ?? 0;
        const nextSave = cloneSave(saveRef.current);
        nextSave.boosters[consumedBooster] = Math.max(0, available - 1);
        commitSave(nextSave);
        saveRef.current = nextSave;
      }
      animationIdRef.current += 1;
      const animationId = animationIdRef.current;
      lifecycleRef.current.begin(animationId);
      setAnimationEvent({ id: animationId, kind: "resolved", action, delta, steps });
      const initialScore = scoreRef.current;
      const nextScore = initialScore + delta.scoreGained;
      scoreRef.current = nextScore;
      pendingPlaybackRef.current = { animationId, initialScore, nextScore, engine, level, steps,
        outcome: delta.isWin ? "win" : delta.isFail ? "playOn" : null };
      setLastDelta(delta);
      setSnapshot(engine.snapshot);
      runStatsRef.current.tilesCleared += delta.clears.length;
      runStatsRef.current.powerUpEvents += delta.powerUpEvents.length;
      runStatsRef.current.chainSum += Math.max(0, delta.chainDepth);
      setMessage(delta.shuffleAttempts > 0 ? `Grid reshuffled after ${delta.shuffleAttempts} attempt(s).` : "");
      if (delta.isWin) {
        statusRef.current = "wonAnimating";
        setStatus("wonAnimating");
      } else if (delta.isFail) {
        statusRef.current = "resolving";
        setStatus("resolving");
      }
      if (delta.isWin || delta.isFail) {
        lifecycleRef.current.stop();
        setQueueDepth(0);
      }
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      if (action.kind === "swap") {
        animationIdRef.current += 1;
        lifecycleRef.current.begin(animationIdRef.current);
        setAnimationEvent({ id: animationIdRef.current, kind: "invalid", action });
        return true;
      } else if (action.kind === "activateBooster") {
        setSelectedBooster(action.booster);
      }
      tickBossClock();
      return false;
    }
  }, [commitSave, level, tickBossClock]);

  const drainQueue = useCallback(() => {
    const gate = lifecycleRef.current;
    let next = gate.next();
    while (next) {
      setQueueDepth(gate.queueDepth);
      if (applyAction(next)) return;
      next = gate.next();
    }
    tickBossClock();
  }, [applyAction, tickBossClock]);

  const handleBoardStepComplete = useCallback((animationId: number, ordinal: number) => {
    const pending = pendingPlaybackRef.current;
    if (!pending || pending.animationId !== animationId || lifecycleRef.current.activeId !== animationId) return;
    const next = playbackHudAtStep(pending.steps, ordinal, pending.initialScore, pending.nextScore);
    if (next) { setHud(next); setScore(next.score); }
  }, []);

  const handleBoardAnimationComplete = useCallback((animationId: number) => {
    if (!lifecycleRef.current.complete(animationId)) return;
    const pending = pendingPlaybackRef.current;
    pendingPlaybackRef.current = null;
    if (pending && pending.engine === engineRef.current) {
      setHud({ ...pending.engine.snapshot, score: pending.nextScore });
      setScore(pending.nextScore);
      if (pending.outcome === "win") {
        finishWin(pending.nextScore, pending.engine, pending.level);
        return;
      }
    }
    if (bossExpiredRef.current) { completeBossExpiry(); return; }
    if (pending?.outcome === "playOn") {
      statusRef.current = "playOn";
      setStatus("playOn");
      return;
    }
    drainQueue();
  }, [completeBossExpiry, drainQueue, finishWin]);

  const handleBoardAnimationError = useCallback((animationId: number) => {
    if (!lifecycleRef.current.complete(animationId)) return;
    lifecycleRef.current.stop();
    pendingPlaybackRef.current = null;
    setQueueDepth(0);
    statusRef.current = "failed";
    setStatus("failed");
    setMessage("Board playback was interrupted. Retry the mission.");
    tickBossClock(false);
  }, [tickBossClock]);

  useEffect(() => {
    const visibilityChanged = () => {
      lifecycleRef.current.suspend(document.hidden);
      tickBossClock();
      if (!document.hidden) drainQueue();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => document.removeEventListener("visibilitychange", visibilityChanged);
  }, [drainQueue, tickBossClock]);

  const enqueueAction = useCallback((action: BoardAction) => {
    if (statusRef.current !== "running") return;
    if (!lifecycleRef.current.enqueue(action)) {
      setMessage("Action queue full.");
      return;
    }
    setQueueDepth(lifecycleRef.current.queueDepth);
    drainQueue();
  }, [drainQueue]);

  const handleBoardAction = useCallback((action: BoardAction) => {
    if (action.kind === "activateBooster") {
      setSelectedBooster(null);
      setBoosterDrag(null);
      setMessage("");
    }
    enqueueAction(action);
  }, [enqueueAction]);

  const isBoosterPlayable = useCallback((booster: BoosterType) => (
    statusRef.current === "running" && (saveRef.current.boosters[booster] ?? 0) > 0
  ), []);

  const handleBoosterClick = (booster: BoosterType) => {
    if (suppressNextBoosterClickRef.current) {
      suppressNextBoosterClickRef.current = false;
      return;
    }
    if (!isBoosterPlayable(booster)) return;
    setSelectedBooster((current) => {
      const next = current === booster ? null : booster;
      setMessage(next ? "Choose a grid tile." : "");
      return next;
    });
  };

  const handleBoosterPointerDown = (event: React.PointerEvent<HTMLButtonElement>, booster: BoosterType) => {
    if (!isBoosterPlayable(booster)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    boosterPointerRef.current = {
      booster,
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable for some synthetic/mobile browser events.
    }
  };

  const handleBoosterPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = boosterPointerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.dragging && distance < 7) return;
    drag.dragging = true;
    event.preventDefault();
    setSelectedBooster(drag.booster);
    setBoosterDrag({ booster: drag.booster, x: event.clientX, y: event.clientY });
  };

  const handleBoosterPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = boosterPointerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    boosterPointerRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be gone after browser cancellation.
    }
    if (!drag.dragging) return;
    event.preventDefault();
    suppressNextBoosterClickRef.current = true;
    setBoosterDrag(null);
    const placed = gameCanvasRef.current?.activateBoosterAtClientPoint(drag.booster, event.clientX, event.clientY) ?? false;
    if (placed) {
      setSelectedBooster(null);
      setMessage("");
    } else {
      setSelectedBooster(drag.booster);
      setMessage("Choose an open grid tile.");
    }
  };

  const handleBoosterPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = boosterPointerRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    boosterPointerRef.current = null;
    setBoosterDrag(null);
  };

  const acceptPlayOn = () => {
    const engine = engineRef.current;
    if (!engine || saveRef.current.coins < playOnCost) {
      setMessage("Not enough coins.");
      setStatus("failed");
      return;
    }
    const next = cloneSave(saveRef.current);
    next.coins -= playOnCost;
    commitSave(next);
    saveRef.current = next;
    engine.extendMoveLimit(playOnExtraMoves);
    lifecycleRef.current.reset();
    lifecycleRef.current.suspend(document.hidden);
    setPlayOnUsed(true);
    setSnapshot(engine.snapshot);
    setHud({ ...engine.snapshot, score: scoreRef.current });
    statusRef.current = "running";
    setStatus("running");
    setMessage(`Play On accepted: +${playOnExtraMoves} moves.`);
  };

  const qaSwap = () => {
    const move = engineRef.current?.validMoves().find((action) => action.kind === "swap");
    if (move) enqueueAction(move);
  };

  const qaWin = () => {
    const engine = engineRef.current;
    if (engine && level) finishWin(scoreRef.current + 100, engine, level, { animate: false });
  };

  const qaWinAnimated = () => {
    const engine = engineRef.current;
    if (engine && level) finishWin(scoreRef.current + 100, engine, level, { animate: true });
  };

  const qaSetupWinningRocketCombo = () => {
    if (!level || lifecycleRef.current.activeId !== null) return;
    const harness = winningRocketComboLevel(level);
    const engine = new BoardEngine(harness, levelSeed(harness.id));
    engineRef.current = engine;
    finalRef.current = false;
    lifecycleRef.current.reset();
    pendingPlaybackRef.current = null;
    scoreRef.current = 0;
    statusRef.current = "running";
    setLevel(harness);
    setSnapshot(engine.snapshot);
    setHud({ ...engine.snapshot, score: 0 });
    setAnimationEvent(null);
    setScore(0);
    setStatus("running");
  };

  const qaTriggerWinningRocketCombo = () => {
    enqueueAction({ kind: "swap", from: { row: 3, col: 3 }, to: { row: 3, col: 4 } });
  };

  const area = areaForLevel(levelId);
  const objectives = level?.objectives ?? [];
  const moveRemaining = hud ? Math.max(0, hud.moveLimit - hud.moveCount) : 0;
  const tutorialCanAdvance = !tutorialSteps[tutorialStep]?.waitsForMove || ((snapshot?.moveCount ?? 0) > tutorialInitialMoveRef.current);
  const isTestMode = new URLSearchParams(window.location.search).has("gwTestMode");

  return (
    <section className="game-layout" style={{ "--accent": area.accent } as React.CSSProperties}>
      <div className="game-hud">
        <button onClick={() => navigate({ name: "levels", areaId: area.id })}>Back</button>
        <div>
          <span>Level {levelId}</span>
          <strong>{level?.name ?? "Loading"}</strong>
          {balanceProfile && <small data-testid="balance-profile">{balanceProfile.label}</small>}
        </div>
        <div>
          <span>Moves</span>
          <strong>{hud ? `${moveRemaining}/${hud.moveLimit}` : "--"}</strong>
        </div>
        {bossRemaining !== null && <div className="timer"><span>Breach</span><strong>{bossRemaining}s</strong></div>}
        <div><span>Score</span><strong>{score.toLocaleString()}</strong></div>
        <button onClick={() => setShowTutorial(true)}>Rules</button>
      </div>

      <div className="objective-row">
        {objectives.map((objective) => (
          <div className="objective-chip" key={objective.id}>
            {objectiveLabel(objective, hud?.objectiveProgress[objective.id] ?? 0)}
          </div>
        ))}
      </div>

      <div className="game-board-panel">
        <GameCanvas
          key={`${levelId}:${runId}`}
          ref={gameCanvasRef}
          snapshot={snapshot}
          animationEvent={animationEvent}
          reducedMotion={save.settings.reducedMotion}
          pendingBooster={selectedBooster}
          onAction={handleBoardAction}
          onAnimationComplete={handleBoardAnimationComplete}
          onStepComplete={handleBoardStepComplete}
          onAnimationError={handleBoardAnimationError}
        />
      </div>

      <div className="booster-tray">
        {boosterTypes.map((booster) => {
          const available = save.boosters[booster] ?? 0;
          const selected = selectedBooster === booster;
          const boosterImage = booster === "rocket"
            ? assetManifest.images.boosters.rocketH
            : booster === "rocketVertical"
              ? assetManifest.images.boosters.rocketV
              : assetManifest.images.boosters[booster];
          return (
            <button
              key={booster}
              className={selected ? "selected" : ""}
              aria-pressed={selected}
              data-testid={`booster-${booster}`}
              disabled={status !== "running" || available <= 0}
              onClick={() => handleBoosterClick(booster)}
              onPointerDown={(event) => handleBoosterPointerDown(event, booster)}
              onPointerMove={handleBoosterPointerMove}
              onPointerUp={handleBoosterPointerUp}
              onPointerCancel={handleBoosterPointerCancel}
            >
              <img src={assetUrl(boosterImage)} alt="" />
              <span className="booster-label">{boosterLabel(booster)}</span>
              <strong aria-label={`${available} available`}>{available}</strong>
            </button>
          );
        })}
        <div className="queue-meter">Queue {queueDepth}/3</div>
        {isTestMode && <button data-testid="qa-swap" onClick={qaSwap}>QA Swap</button>}
        {isTestMode && <button data-testid="qa-win" onClick={qaWin}>QA Win</button>}
        {isTestMode && <button data-testid="qa-win-animated" onClick={qaWinAnimated}>QA Win Animated</button>}
        {isTestMode && <button data-testid="qa-setup-winning-rocket-combo" onClick={qaSetupWinningRocketCombo}>QA Setup Rocket Win</button>}
        {isTestMode && <button data-testid="qa-trigger-winning-rocket-combo" onClick={qaTriggerWinningRocketCombo}>QA Trigger Rocket Win</button>}
        {isTestMode && <button data-testid="qa-fail" onClick={() => setStatus("playOn")}>QA Fail</button>}
        {isTestMode && <button data-testid="qa-boss-timeout" onClick={requestBossExpiry}>QA Boss Timeout</button>}
      </div>

      {boosterDrag && (
        <div className="booster-drag-ghost" aria-hidden="true" style={{ left: boosterDrag.x, top: boosterDrag.y }}>
          {boosterLabel(boosterDrag.booster)}
        </div>
      )}

      {message && <div className="toast" role="status">{message}</div>}
      {lastDelta && <div className="delta-line">Last clear: {lastDelta.clears.length} tiles, {lastDelta.powerUpEvents.length} power-up event(s)</div>}

      {showTutorial && (
        <div className="overlay">
          <div className="modal tutorial-modal">
            <h2>{tutorialSteps[tutorialStep].title}</h2>
            <p>{tutorialSteps[tutorialStep].message}</p>
            <div className="modal-actions">
              <button onClick={() => {
                const next = cloneSave(saveRef.current);
                next.completedTutorial = true;
                next.tutorialReplayRequested = false;
                commitSave(next);
                saveRef.current = next;
                setShowTutorial(false);
              }}>Skip</button>
              <button disabled={!tutorialCanAdvance} onClick={() => {
                if (tutorialStep >= tutorialSteps.length - 1) {
                  const next = cloneSave(saveRef.current);
                  next.completedTutorial = true;
                  next.tutorialReplayRequested = false;
                  commitSave(next);
                  saveRef.current = next;
                  setShowTutorial(false);
                } else {
                  setTutorialStep((step) => step + 1);
                }
              }}>{tutorialStep >= tutorialSteps.length - 1 ? "Finish" : "Next"}</button>
            </div>
          </div>
        </div>
      )}

      {status === "playOn" && (
        <ResultModal
          title="Mission at risk"
          message={`Spend ${playOnCost} coins for ${playOnExtraMoves} extra moves.`}
          primary="Play On"
          secondary="End Mission"
          onPrimary={acceptPlayOn}
          onSecondary={() => setStatus("failed")}
        />
      )}
      {status === "won" && snapshot && (
        <ResultModal
          title="Grid secured"
          message={`${starsEarned(snapshot)} star(s). Score ${score.toLocaleString()}.`}
          note={submitStatusLine(submitState)}
          primary={levelId < 100 ? "Next Level" : "Operations"}
          secondary="Level Select"
          onPrimary={() => navigate(levelId < 100 ? { name: "game", levelId: levelId + 1 } : { name: "areas" })}
          onSecondary={() => navigate({ name: "levels", areaId: area.id })}
        />
      )}
      {status === "failed" && (
        <ResultModal
          title="Grid compromised"
          message={message || "The mission failed."}
          primary="Retry"
          secondary="Level Select"
          onPrimary={() => setRunId((value) => value + 1)}
          onSecondary={() => navigate({ name: "levels", areaId: area.id })}
        />
      )}
    </section>
  );
}

function winningRocketComboLevel(source: LevelDefinition): LevelDefinition {
  const cellMap = source.cellMap.map((row) => row.map((cell) => ({ ...cell })));
  cellMap[3][3] = { ...cellMap[3][3], tile: null, powerUp: "rocket_h", locked: false };
  cellMap[3][4] = { ...cellMap[3][4], tile: null, powerUp: "rocket_v", locked: false };
  return {
    ...source,
    name: "QA Rocket Combo Finish",
    objectives: [{ id: "clear", target: 1, displayName: "Clear 1", tileType: null }],
    cellMap
  };
}

function AccountScreen({ save, commitSave, auth }: { save: SaveState; commitSave: (save: SaveState) => void; auth: ReturnType<typeof useAuth> }) {
  return (
    <section className="content-column">
      <PageHeader title="Account" subtitle="Select the operative portrait for missions." />
      <OperatorIdentityPanel auth={auth} />
      <div className="hero-grid">
        {heroes.map((hero) => {
          const unlocked = isHeroUnlocked(save, hero.unlockAreaId);
          return (
            <article className={`hero-card ${save.selectedHeroId === hero.id ? "selected" : ""}`} key={hero.id}>
              <img src={assetUrl(assetManifest.images.heroes[hero.id])} alt="" />
              <h2>{hero.displayName}</h2>
              <p>{hero.description}</p>
              <button disabled={!unlocked} onClick={() => {
                const next = cloneSave(save);
                next.selectedHeroId = hero.id;
                commitSave(next);
              }}>{unlocked ? "Select" : `Complete Area ${hero.unlockAreaId}`}</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OperatorIdentityPanel({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const [email, setEmail] = useState("");
  const [handleDraft, setHandleDraft] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const signedIn = !!auth.session;

  const sendLink = async () => {
    setBusy(true);
    const err = await auth.signInWithEmail(email);
    setBusy(false);
    if (err) {
      setNotice(err);
    } else {
      setLinkSent(true);
      setNotice(null);
    }
  };

  const oauth = async (provider: "google" | "github") => {
    setBusy(true);
    const err = await auth.signInWithProvider(provider);
    setBusy(false);
    if (err) setNotice(err);
  };

  const submitHandle = async () => {
    setBusy(true);
    const err = await auth.saveHandle(handleDraft);
    setBusy(false);
    setNotice(err);
  };

  if (auth.loading) {
    return (
      <article className="info-section identity-panel">
        <h2>Operator Identity</h2>
        <p>Checking sign-in state...</p>
      </article>
    );
  }

  if (!signedIn) {
    return (
      <article className="info-section identity-panel">
        <h2>Operator Identity</h2>
        <p>
          Connect an operator identity to sync progress with GridWatch Drift and the Command
          Nexus hub — one handle, every sector.
        </p>
        {!linkSent ? (
          <>
            <label className="identity-row">
              <span>Operator Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            <div className="card-actions">
              <button className="primary-action" type="button" disabled={busy || !email} onClick={() => void sendLink()}>
                Send Magic Link
              </button>
              <button type="button" disabled={busy} onClick={() => void oauth("google")}>
                Google
              </button>
              <button type="button" disabled={busy} onClick={() => void oauth("github")}>
                GitHub
              </button>
            </div>
          </>
        ) : (
          <p>A sign-in link was sent to {email}. Open it on this device to complete sign-in.</p>
        )}
        {notice && <p className="identity-notice" role="alert">{notice}</p>}
      </article>
    );
  }

  return (
    <article className="info-section identity-panel">
      <h2>Operator Identity</h2>
      <p>
        Same identity as GridWatch Drift and the Command Nexus hub — one handle, every sector.
      </p>
      <dl className="identity-status">
        <div>
          <dt>Email</dt>
          <dd>{auth.session?.user.email ?? "Linked"}</dd>
        </div>
        <div>
          <dt>Handle</dt>
          <dd>{auth.handle ?? "Not registered"}</dd>
        </div>
      </dl>
      {!auth.handle ? (
        <>
          <label className="identity-row">
            <span>Operator Handle</span>
            <input
              type="text"
              value={handleDraft}
              maxLength={12}
              onChange={(e) => setHandleDraft(e.target.value)}
              placeholder="1-12 characters"
            />
          </label>
          <div className="card-actions">
            <button className="primary-action" type="button" disabled={busy || !handleDraft} onClick={() => void submitHandle()}>
              Register Handle
            </button>
          </div>
        </>
      ) : null}
      {notice && <p className="identity-notice" role="alert">{notice}</p>}
      <div className="card-actions">
        <button className="danger-button" type="button" onClick={() => void auth.signOut()}>
          Sign Out
        </button>
      </div>
    </article>
  );
}

function SettingsScreen({ save, commitSave }: { save: SaveState; commitSave: (save: SaveState) => void }) {
  const updateSetting = (key: keyof SaveState["settings"], value: boolean) => {
    const next = cloneSave(save);
    next.settings[key] = value;
    commitSave(next);
  };
  return (
    <section className="content-column narrow">
      <PageHeader title="Settings" subtitle="Local browser settings and progress controls." />
      {Object.entries(save.settings).map(([key, value]) => (
        <label className="setting-row" key={key}>
          <span>{settingLabel(key as keyof SaveState["settings"])}</span>
          <input type="checkbox" checked={value} onChange={(event) => updateSetting(key as keyof SaveState["settings"], event.currentTarget.checked)} />
        </label>
      ))}
      <button className="danger-button" onClick={() => void saveStore.reset().then(commitSave)}>Reset Local Save</button>
    </section>
  );
}

function RulesScreen({ save, commitSave }: { save: SaveState; commitSave: (save: SaveState) => void }) {
  return (
    <section className="content-column narrow">
      <PageHeader title="Rules" subtitle="Mission mechanics and training replay." />
      {rulesSections.map((section) => (
        <article className="info-section" key={section.title}>
          <h2>{section.title}</h2>
          <ul>{section.rows.map((row) => <li key={row}>{row}</li>)}</ul>
        </article>
      ))}
      <button onClick={() => {
        const next = cloneSave(save);
        next.tutorialReplayRequested = true;
        next.completedTutorial = false;
        commitSave(next);
      }}>Replay Tutorial Next Mission</button>
    </section>
  );
}

function IntelScreen({ save, commitSave }: { save: SaveState; commitSave: (save: SaveState) => void }) {
  const [tab, setTab] = useState<"files" | "reports">("files");
  const highest = Math.max(1, ...Object.keys(save.levels).map(Number));
  const unlockedFiles = intelFiles.filter((file) => file.unlockLevelId <= highest);
  const unlockedReports = threatReports.filter((report) => report.unlockLevelId <= highest);
  return (
    <section className="content-column">
      <PageHeader title="Intel Database" subtitle="Dossiers unlock through mission progress." />
      <div className="segmented">
        <button className={tab === "files" ? "active" : ""} onClick={() => setTab("files")}>Files</button>
        <button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>Reports</button>
      </div>
      <div className="intel-grid">
        {(tab === "files" ? intelFiles : threatReports).map((item) => {
          const unlocked = item.unlockLevelId <= highest;
          const seen = save.intelSeen[item.id];
          return (
            <article className={`intel-card ${unlocked ? "" : "locked"}`} key={item.id}>
              <div className="card-kicker">{unlocked ? "Unlocked" : `Unlocks at level ${item.unlockLevelId}`}</div>
              <h2>{"codename" in item ? item.codename : item.title}</h2>
              <p>{"classification" in item ? item.classification : item.category}</p>
              {unlocked && (
                <>
                  <p className="intel-body">{"background" in item ? item.background.join(" ") : item.content}</p>
                  <button onClick={() => {
                    const next = cloneSave(save);
                    next.intelSeen[item.id] = true;
                    commitSave(next);
                  }}>{seen ? "Reviewed" : "Mark Reviewed"}</button>
                </>
              )}
            </article>
          );
        })}
      </div>
      <div className="delta-line">Visible: {tab === "files" ? unlockedFiles.length : unlockedReports.length}</div>
    </section>
  );
}

function StoreScreen() {
  const [message, setMessage] = useState("Purchases are disabled in the public web beta.");
  return (
    <section className="content-column">
      <PageHeader title="Store" subtitle="Playable storefront stub. No real purchase fulfillment runs on web." />
      <div className="store-grid">
        {[...coinPacks, clearancePass].map((item) => (
          <article className="store-card" key={item.id}>
            {item.badge && <div className="card-kicker">{item.badge}</div>}
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            {item.coins && <strong>{item.coins.toLocaleString()} coins</strong>}
            <button onClick={() => setMessage(`${item.title} is disabled until a secure backend exists.`)}>{item.displayPrice}</button>
          </article>
        ))}
      </div>
      <div className="toast persistent" role="status">{message}</div>
    </section>
  );
}

function ResultModal({ title, message, note, primary, secondary, onPrimary, onSecondary }: {
  title: string;
  message: string;
  note?: React.ReactNode;
  primary: string;
  secondary: string;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <div className="overlay">
      <div className="modal">
        <h2>{title}</h2>
        <p>{message}</p>
        {note}
        <div className="modal-actions">
          <button onClick={onSecondary}>{secondary}</button>
          <button className="primary-action" onClick={onPrimary}>{primary}</button>
        </div>
      </div>
    </div>
  );
}

function submitStatusLine(state: SubmitState): React.ReactNode {
  switch (state.kind) {
    case "sending":
      return <p className="delta-line">TRANSMITTING SCORE&hellip;</p>;
    case "done":
      return state.result.levelImproved
        ? <p className="delta-line">SCORE TRANSMITTED &mdash; CAMPAIGN TOTAL {state.result.campaignScore.toLocaleString()}</p>
        : <p className="delta-line">ARCHIVE BEST STANDS ({state.result.levelBest.toLocaleString()})</p>;
    case "error":
      return <p className="identity-notice" role="alert">{state.message}</p>;
    case "skipped":
      return state.reason === "signedOut" ? <p className="delta-line">SIGN IN ON THE ACCOUNT SCREEN TO POST SCORES</p> : null;
    default:
      return null;
  }
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function starsEarned(snapshot: BoardSnapshot): number {
  const remaining = snapshot.moveLimit - snapshot.moveCount;
  const ratio = remaining / Math.max(1, snapshot.moveLimit);
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.2) return 2;
  return 1;
}

function boosterLabel(booster: BoosterType): string {
  return {
    rocket: "Rocket H",
    rocketVertical: "Rocket V",
    tnt: "TNT",
    propeller: "Propeller",
    lightBall: "Light Ball"
  }[booster];
}

function settingLabel(key: keyof SaveState["settings"]): string {
  return {
    musicEnabled: "Music",
    sfxEnabled: "Sound Effects",
    voiceEnabled: "Voice Lines",
    reducedMotion: "Reduced Motion"
  }[key];
}
