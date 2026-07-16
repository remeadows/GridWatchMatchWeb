import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { areaForLevel, areas, type AreaInfo } from "./data/areas";
import { assetManifest, assetUrl } from "./data/assets";
import { heroes } from "./data/heroes";
import { intelFiles, threatReports } from "./data/intel";
import { loadLevel, objectiveLabel } from "./data/levels";
import { rulesSections, tutorialSteps } from "./data/rules";
import { clearancePass, coinPacks, playOnCost, playOnExtraMoves } from "./data/store";
import { WIN_ROW_DESTRUCTION_POP_MS, WIN_ROW_DESTRUCTION_STAGGER_MS } from "./data/gameplayTiming";
import { BoardEngine, type BoardAction, type BoardDelta, type BoardSnapshot, type BoosterType, type LevelDefinition } from "./engine";
import { RESOLVE_ANIMATION_BUDGET_MS, type BoardAnimationEvent } from "./game/BoardScene";
import { GameCanvas, type GameCanvasHandle } from "./game/GameCanvas";
import { winSequenceDurationMs } from "./game/motion";
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
import { loadSaveState, persistSaveState, resetSaveState, type SaveState } from "./state/save";

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
    void loadSaveState().then((loaded) => {
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
    void persistSaveState(next);
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
      <button className="brand" onClick={() => navigate({ name: "home" })} aria-label="Home">
        <img src={assetUrl(assetManifest.images.appIcon)} alt="" />
        <span>GridWatch Match</span>
      </button>
      <nav className="main-nav" aria-label="Primary">
        <button className={active === "areas" || active === "levels" ? "active" : ""} onClick={() => navigate({ name: "areas" })}>Operations</button>
        <button className={active === "intel" ? "active" : ""} onClick={() => navigate({ name: "intel" })}>Intel</button>
        <button className={active === "account" ? "active" : ""} onClick={() => navigate({ name: "account" })}>Account</button>
        <button className={active === "store" ? "active" : ""} onClick={() => navigate({ name: "store" })}>Store</button>
        <button className={active === "settings" ? "active" : ""} onClick={() => navigate({ name: "settings" })}>Settings</button>
      </nav>
      <div className="currency" aria-label={`${save.coins} coins`}>{save.coins.toLocaleString()} coins</div>
    </header>
  );
}

function HomeScreen({ save, navigate }: { save: SaveState; navigate: (screen: Screen) => void }) {
  const area = currentArea(save);
  const hero = heroes.find((candidate) => candidate.id === save.selectedHeroId) ?? heroes[0];
  return (
    <section className="home-grid">
      <div className="home-visual" style={{ backgroundImage: `url(${assetUrl(assetManifest.images.backgrounds.home)})` }}>
        <div className="home-copy">
          <h1>GridWatch Match</h1>
          <p>Defend the digital grid through 100 cyberpunk match-3 operations.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => navigate({ name: "areas" })}>Resume Operations</button>
            <button onClick={() => navigate({ name: "game", levelId: Math.min(100, Math.max(1, Object.keys(save.levels).length + 1)) })}>Quick Deploy</button>
          </div>
        </div>
      </div>
      <aside className="home-panel">
        <Stat label="Current Area" value={area.name} />
        <Stat label="Selected Agent" value={hero.displayName} />
        <Stat label="Completed Levels" value={`${Object.keys(save.levels).length}/100`} />
        <Stat label="Best Area Progress" value={areaProgressLabel(save, area)} />
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
  const [status, setStatus] = useState<"loading" | "running" | "playOn" | "wonAnimating" | "won" | "failed">("loading");
  const [message, setMessage] = useState("");
  const [score, setScore] = useState(0);
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
  const queueRef = useRef<BoardAction[]>([]);
  const processingRef = useRef(false);
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
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setMessage("");
    setScore(0);
    setLastDelta(null);
    setAnimationEvent(null);
    setPlayOnUsed(false);
    setSelectedBooster(null);
    setBoosterDrag(null);
    finalRef.current = false;
    queueRef.current = [];
    setQueueDepth(0);
    runStatsRef.current = { tilesCleared: 0, powerUpEvents: 0, chainSum: 0 };
    setSubmitState({ kind: "idle" });
    void loadLevel(levelId).then((loaded) => {
      if (!active) return;
      const engine = new BoardEngine(loaded, levelSeed(loaded.id));
      engineRef.current = engine;
      setLevel(loaded);
      setSnapshot(engine.snapshot);
      setBossRemaining(loaded.bossLevel ? loaded.bossTimerSeconds ?? 90 : null);
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
      engineRef.current = null;
    };
  }, [levelId, runId]);

  useEffect(() => {
    if (status !== "running" || !level?.bossLevel) return;
    const timer = window.setInterval(() => {
      // Keep this updater pure: only compute the next value. The "reached
      // zero -> fail" side effects live in the effect below so StrictMode's
      // double-invoked updaters can't double-fire them.
      setBossRemaining((current) => {
        if (current === null) return current;
        return Math.max(0, current - 1);
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [level?.bossLevel, status]);

  useEffect(() => {
    if (status !== "running" || !level?.bossLevel || bossRemaining !== 0) return;
    setStatus("failed");
    audioService.playSfx("sfx_breach_alert.mp3");
    audioService.playSfx("vo_grid_compromised.mp3");
  }, [bossRemaining, level?.bossLevel, status]);

  const finishWin = useCallback((nextScore: number, engine: BoardEngine, currentLevel: LevelDefinition, options: { animate?: boolean } = {}) => {
    if (finalRef.current) return;
    finalRef.current = true;
    const currentSnapshot = engine.snapshot;
    const stars = starsEarned(currentSnapshot);
    const next = awardLevelCompletion(saveRef.current, currentLevel.id, stars, nextScore, playOnUsed);
    commitSave(next);
    saveRef.current = next;

    const isTestMode = new URLSearchParams(window.location.search).has("gwTestMode");
    if (!isTestMode && auth.session) {
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
      setSubmitState({ kind: "skipped", reason: isTestMode ? "test" : "signedOut" });
    }

    setSnapshot(currentSnapshot);
    const completeWin = () => {
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

    setStatus("wonAnimating");
    let completed = false;
    let fallbackId: number | null = null;
    const completeOnce = () => {
      if (completed) return;
      completed = true;
      if (fallbackId !== null) window.clearTimeout(fallbackId);
      completeWin();
    };
    const durationMs = winSequenceDurationMs(currentSnapshot.grid.rows, WIN_ROW_DESTRUCTION_STAGGER_MS, WIN_ROW_DESTRUCTION_POP_MS);
    fallbackId = window.setTimeout(completeOnce, durationMs + 120);
    const started = gameCanvasRef.current?.playWinSequence(completeOnce) ?? false;
    if (!started) {
      window.clearTimeout(fallbackId);
      fallbackId = window.setTimeout(completeOnce, durationMs);
    }
  }, [commitSave, playOnUsed, auth.session]);

  const applyAction = useCallback((action: BoardAction) => {
    const engine = engineRef.current;
    if (!engine || !level || statusRef.current !== "running") return;
    try {
      let consumedBooster: BoosterType | null = null;
      if (action.kind === "activateBooster") {
        const available = saveRef.current.boosters[action.booster] ?? 0;
        if (available <= 0) {
          setMessage("No booster inventory remaining.");
          return;
        }
        consumedBooster = action.booster;
      }
      const delta = engine.apply(action);
      if (consumedBooster) {
        const available = saveRef.current.boosters[consumedBooster] ?? 0;
        const nextSave = cloneSave(saveRef.current);
        nextSave.boosters[consumedBooster] = Math.max(0, available - 1);
        commitSave(nextSave);
        saveRef.current = nextSave;
      }
      animationIdRef.current += 1;
      setAnimationEvent({ id: animationIdRef.current, kind: "resolved", action, delta });
      const nextScore = scoreRef.current + delta.scoreGained;
      scoreRef.current = nextScore;
      setScore(nextScore);
      setLastDelta(delta);
      setSnapshot(engine.snapshot);
      runStatsRef.current.tilesCleared += delta.clears.length;
      runStatsRef.current.powerUpEvents += delta.powerUpEvents.length;
      runStatsRef.current.chainSum += Math.max(0, delta.chainDepth);
      setMessage(delta.shuffleAttempts > 0 ? `Grid reshuffled after ${delta.shuffleAttempts} attempt(s).` : "");
      if (delta.clears.length > 0) audioService.playSfx("sfx_tile_clear.mp3");
      if (delta.powerUpEvents.length > 0) audioService.playSfx("sfx_power_up.mp3");
      if (delta.chainDepth > 1) audioService.playSfx("sfx_chain_cascade.mp3");
      if (delta.isWin) {
        finishWin(nextScore, engine, level);
      } else if (delta.isFail) {
        setStatus("playOn");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      if (action.kind === "swap") {
        animationIdRef.current += 1;
        setAnimationEvent({ id: animationIdRef.current, kind: "invalid", action });
      } else if (action.kind === "activateBooster") {
        setSelectedBooster(action.booster);
      }
    }
  }, [commitSave, finishWin, level]);

  const drainQueue = useCallback(() => {
    if (processingRef.current) return;
    processingRef.current = true;
    const run = () => {
      const next = queueRef.current.shift();
      setQueueDepth(queueRef.current.length);
      if (!next) {
        processingRef.current = false;
        return;
      }
      applyAction(next);
      // Pace the next queued action past the previous swap's full resolve
      // animation, or it starts while BoardScene tweens are still running and
      // renders over in-flight pops/cascades. RESOLVE_ANIMATION_BUDGET_MS is
      // derived from the BoardScene motionTiming constants, so this stays
      // correct if those timings change.
      window.setTimeout(run, saveRef.current.settings.reducedMotion ? 0 : RESOLVE_ANIMATION_BUDGET_MS);
    };
    run();
  }, [applyAction]);

  const enqueueAction = useCallback((action: BoardAction) => {
    if (statusRef.current !== "running") return;
    if (queueRef.current.length >= 3) {
      setMessage("Action queue full.");
      return;
    }
    queueRef.current.push(action);
    setQueueDepth(queueRef.current.length);
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
    setPlayOnUsed(true);
    setSnapshot(engine.snapshot);
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

  const area = areaForLevel(levelId);
  const objectives = level?.objectives ?? [];
  const moveRemaining = snapshot ? Math.max(0, snapshot.moveLimit - snapshot.moveCount) : 0;
  const tutorialCanAdvance = !tutorialSteps[tutorialStep]?.waitsForMove || ((snapshot?.moveCount ?? 0) > tutorialInitialMoveRef.current);
  const isTestMode = new URLSearchParams(window.location.search).has("gwTestMode");

  return (
    <section className="game-layout" style={{ "--accent": area.accent } as React.CSSProperties}>
      <div className="game-hud">
        <button onClick={() => navigate({ name: "levels", areaId: area.id })}>Back</button>
        <div>
          <span>Level {levelId}</span>
          <strong>{level?.name ?? "Loading"}</strong>
        </div>
        <div>
          <span>Moves</span>
          <strong>{snapshot ? `${moveRemaining}/${snapshot.moveLimit}` : "--"}</strong>
        </div>
        {bossRemaining !== null && <div className="timer"><span>Breach</span><strong>{bossRemaining}s</strong></div>}
        <div><span>Score</span><strong>{score.toLocaleString()}</strong></div>
        <button onClick={() => setShowTutorial(true)}>Rules</button>
      </div>

      <div className="objective-row">
        {objectives.map((objective) => (
          <div className="objective-chip" key={objective.id}>
            {objectiveLabel(objective, snapshot?.objectiveProgress[objective.id] ?? 0)}
          </div>
        ))}
      </div>

      <div className="game-board-panel">
        <GameCanvas
          ref={gameCanvasRef}
          snapshot={snapshot}
          animationEvent={animationEvent}
          reducedMotion={save.settings.reducedMotion}
          pendingBooster={selectedBooster}
          onAction={handleBoardAction}
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
        {isTestMode && <button data-testid="qa-fail" onClick={() => setStatus("playOn")}>QA Fail</button>}
        {isTestMode && <button data-testid="qa-boss-timeout" onClick={() => {
          setBossRemaining(0);
          setMessage("Boss timer expired.");
          setStatus("failed");
        }}>QA Boss Timeout</button>}
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
      <button className="danger-button" onClick={() => void resetSaveState().then(commitSave)}>Reset Local Save</button>
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
