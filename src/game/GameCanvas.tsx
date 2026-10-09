import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Phaser from "phaser";
import { BoardScene, type BoardAnimationEvent } from "./BoardScene";
import type { BoardAction, BoardSnapshot, BoosterType } from "../engine";
import { audioService } from "../services/audio";
import { defaultBoardTheme } from "../services/buildInfo";
import { resolveBoardPixelRatio, resolveBoardTheme } from "./boardTheme";

interface GameCanvasProps {
  snapshot: BoardSnapshot | null;
  animationEvent: BoardAnimationEvent | null;
  reducedMotion: boolean;
  pendingBooster: BoosterType | null;
  onAction: (action: BoardAction) => void;
  onAnimationComplete: (animationId: number) => void;
  onStepComplete: (animationId: number, ordinal: number) => void;
  onAnimationError: (animationId: number) => void;
}

export interface GameCanvasHandle {
  activateBoosterAtClientPoint: (booster: BoosterType, clientX: number, clientY: number) => boolean;
  playWinSequence: (onComplete: () => void) => boolean;
}

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(function GameCanvas(
  { snapshot, animationEvent, reducedMotion, pendingBooster, onAction, onAnimationComplete, onStepComplete, onAnimationError },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const onActionRef = useRef(onAction);
  const onAnimationCompleteRef = useRef(onAnimationComplete);
  const onStepCompleteRef = useRef(onStepComplete);
  const onAnimationErrorRef = useRef(onAnimationError);
  const presentationRef = useRef({ snapshot, animationEvent, reducedMotion, pendingBooster });

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  useEffect(() => {
    onAnimationCompleteRef.current = onAnimationComplete;
  }, [onAnimationComplete]);

  useEffect(() => { onStepCompleteRef.current = onStepComplete; }, [onStepComplete]);
  useEffect(() => { onAnimationErrorRef.current = onAnimationError; }, [onAnimationError]);
  useEffect(() => {
    presentationRef.current = { snapshot, animationEvent, reducedMotion, pendingBooster };
  }, [snapshot, animationEvent, reducedMotion, pendingBooster]);

  useImperativeHandle(ref, () => ({
    activateBoosterAtClientPoint: (booster, clientX, clientY) => {
      const scene = gameRef.current?.scene.getScene("BoardScene") as BoardScene | undefined;
      return scene?.activateBoosterAtClientPoint(booster, clientX, clientY) ?? false;
    },
    playWinSequence: (onComplete) => {
      const scene = gameRef.current?.scene.getScene("BoardScene") as BoardScene | undefined;
      return scene?.playWinSequence(onComplete) ?? false;
    }
  }), []);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;
    void audioService.preloadBoardSounds();
    const unlockBoardSounds = () => audioService.unlockBoardSounds();
    containerRef.current.addEventListener("pointerdown", unlockBoardSounds, { passive: true });
    // Headless WebKit under CPU contention can starve requestAnimationFrame for
    // seconds at a time while the task queue stays responsive. Phaser's delta
    // smoothing then replaces each huge frame gap with a ~16ms "sane" delta, so
    // tweens and clock timers crawl while the engine model and DOM race ahead
    // -- e2e polls on animation side-effects (match bursts, booster FX) time
    // out even though the game logic is fine. In test mode only, drive the
    // loop from setTimeout: ticks come from the (responsive) task queue, so
    // the game clock keeps pace regardless of compositor scheduling. Delta
    // smoothing stays on -- with dense ticks it is benign, and it keeps the
    // game clock from ever running AHEAD of wall time, which the win-sequence
    // timing test relies on. Production keeps the default rAF loop.
    const gwTestMode = new URLSearchParams(window.location.search).get("gwTestMode") === "1";
    const container = containerRef.current;
    const pixelRatio = resolveBoardPixelRatio(
      window.location.search,
      resolveBoardTheme(window.location.search, defaultBoardTheme),
      window.devicePixelRatio
    );
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      backgroundColor: "#050b12",
      ...(gwTestMode ? { fps: { forceSetTimeOut: true } } : {}),
      width: Math.round((container.clientWidth || 720) * pixelRatio),
      height: Math.round((container.clientHeight || 720) * pixelRatio),
      // RESIZE always makes the canvas the CSS size. To draw real device pixels the canvas is
      // sized by hand instead and zoomed back down to the container; the scene only ever reads
      // its own scale size, so everything in it follows.
      scale: pixelRatio === 1
        ? { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }
        : { mode: Phaser.Scale.NONE, zoom: 1 / pixelRatio },
      scene: BoardScene,
      input: {
        activePointers: 2
      },
      callbacks: {
        postBoot: () => {
          const scene = game.scene.getScene("BoardScene") as BoardScene;
          scene.events.once(Phaser.Scenes.Events.CREATE, () => {
            const current = presentationRef.current;
            if (current.snapshot) scene.sync(current.snapshot, current.animationEvent, current.reducedMotion, current.pendingBooster);
          });
        }
      }
    });
    game.scene.start("BoardScene", {
      onAction: (action: BoardAction) => onActionRef.current(action),
      onAnimationComplete: (animationId: number) => onAnimationCompleteRef.current(animationId),
      onStepComplete: (animationId: number, ordinal: number) => onStepCompleteRef.current(animationId, ordinal),
      onAnimationError: (animationId: number) => onAnimationErrorRef.current(animationId)
    });
    gameRef.current = game;
    const resizeObserver = pixelRatio === 1 ? null : new ResizeObserver(() => {
      const width = Math.round(container.clientWidth * pixelRatio);
      const height = Math.round(container.clientHeight * pixelRatio);
      if (width > 0 && height > 0 && (width !== game.scale.width || height !== game.scale.height)) game.scale.resize(width, height);
    });
    resizeObserver?.observe(container);
    const visibilityChanged = () => {
      const scene = game.scene.getScene("BoardScene") as BoardScene | undefined;
      scene?.setPresentationPaused(document.hidden);
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    game.events.once(Phaser.Core.Events.READY, visibilityChanged);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      resizeObserver?.disconnect();
      containerRef.current?.removeEventListener("pointerdown", unlockBoardSounds);
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!snapshot || !gameRef.current) return;
    const scene = gameRef.current.scene.getScene("BoardScene") as BoardScene | undefined;
    if (scene) scene.sync(snapshot, animationEvent, reducedMotion, pendingBooster);
  }, [snapshot, animationEvent, reducedMotion, pendingBooster]);

  return <div ref={containerRef} className="board-canvas" data-testid="board-canvas" />;
});
