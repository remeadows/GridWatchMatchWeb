import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Phaser from "phaser";
import { BoardScene, type BoardAnimationEvent } from "./BoardScene";
import type { BoardAction, BoardSnapshot, BoosterType } from "../engine";

interface GameCanvasProps {
  snapshot: BoardSnapshot | null;
  animationEvent: BoardAnimationEvent | null;
  reducedMotion: boolean;
  pendingBooster: BoosterType | null;
  onAction: (action: BoardAction) => void;
}

export interface GameCanvasHandle {
  activateBoosterAtClientPoint: (booster: BoosterType, clientX: number, clientY: number) => boolean;
}

export const GameCanvas = forwardRef<GameCanvasHandle, GameCanvasProps>(function GameCanvas(
  { snapshot, animationEvent, reducedMotion, pendingBooster, onAction },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const onActionRef = useRef(onAction);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  useImperativeHandle(ref, () => ({
    activateBoosterAtClientPoint: (booster, clientX, clientY) => {
      const scene = gameRef.current?.scene.getScene("BoardScene") as BoardScene | undefined;
      return scene?.activateBoosterAtClientPoint(booster, clientX, clientY) ?? false;
    }
  }), []);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      backgroundColor: "#050b12",
      width: containerRef.current.clientWidth || 720,
      height: containerRef.current.clientHeight || 720,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: BoardScene,
      input: {
        activePointers: 2
      },
      callbacks: {
        postBoot: () => {
          const scene = game.scene.getScene("BoardScene") as BoardScene;
          scene.events.once(Phaser.Scenes.Events.CREATE, () => {
            if (snapshot) scene.sync(snapshot, animationEvent, reducedMotion, pendingBooster);
          });
        }
      }
    });
    game.scene.start("BoardScene", { onAction: (action: BoardAction) => onActionRef.current(action) });
    gameRef.current = game;
    return () => {
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
