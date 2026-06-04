import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { BoardScene, type BoardAnimationEvent } from "./BoardScene";
import type { BoardAction, BoardSnapshot } from "../engine";

interface GameCanvasProps {
  snapshot: BoardSnapshot | null;
  animationEvent: BoardAnimationEvent | null;
  reducedMotion: boolean;
  onAction: (action: BoardAction) => void;
}

export function GameCanvas({ snapshot, animationEvent, reducedMotion, onAction }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const onActionRef = useRef(onAction);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

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
            if (snapshot) scene.sync(snapshot, animationEvent, reducedMotion);
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
    if (scene) scene.sync(snapshot, animationEvent, reducedMotion);
  }, [snapshot, animationEvent, reducedMotion]);

  return <div ref={containerRef} className="board-canvas" data-testid="board-canvas" />;
}
