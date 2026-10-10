import { useRef } from "react";
import { assetManifest, assetUrl } from "../data/assets";
import { heroes } from "../data/heroes";
import { areaProgressLabel, completedLevelsInArea, currentArea } from "../state/progress";
import type { SaveState } from "../state/save";

// The dark-realism main menu (docs/gridwatch-match). Same data and the same two actions as the
// classic HomeScreen in App.tsx; only the presentation differs. The art is two text-free plates
// (art/gridwatch-match/scripts/export_menu_plates.sh): every word and number here is live.
const CITY_PLATE = "assets/images/match-v2/menu/city.webp";
const TISH_PLATE = "assets/images/match-v2/menu/tish.webp";

interface DarkHomeScreenProps {
  save: SaveState;
  /** The title screen: "tap to enter" stands where the panel's contents will be (src/state/titleGate.ts). */
  onTitle: boolean;
  onEnter: () => void;
  onResume: () => void;
  onQuickDeploy: (levelId: number) => void;
}

export function DarkHomeScreen({ save, onTitle, onEnter, onResume, onQuickDeploy }: DarkHomeScreenProps) {
  // The panel's contents rise in only when this visit began on the title, not on every return home.
  const beganOnTitle = useRef(onTitle);
  const stateClass = onTitle ? " dr-home-on-title" : beganOnTitle.current ? " dr-home-arriving" : "";
  const area = currentArea(save);
  const hero = heroes.find((candidate) => candidate.id === save.selectedHeroId) ?? heroes[0];
  const tish = heroes.find((candidate) => candidate.id === "tish");
  const completedLevels = Object.keys(save.levels).length;
  const nextLevel = Math.min(100, Math.max(1, completedLevels + 1));
  const areaCompleted = completedLevelsInArea(save, area);
  const areaTotal = area.lastLevel - area.firstLevel + 1;

  return (
    <section className={`dr-home${stateClass}${save.settings.reducedMotion ? " dr-home-still" : ""}`} data-testid="home-command-deck">
      <img className="dr-home-city" src={assetUrl(CITY_PLATE)} alt="" />
      <div className="dr-home-art">
        <img className="dr-home-tish" src={assetUrl(TISH_PLATE)} alt="" />
        <span className="dr-home-kicker">Cyber defense command</span>
        <h1 className="dr-home-title"><span>GridWatch</span> <strong>Match</strong></h1>
        <p className="dr-home-network">
          <span className="status-beacon" aria-hidden="true" />
          <strong>Grid online</strong>
          <small>Live defense network</small>
        </p>
        {tish && <span className="dr-home-agent">{tish.displayName}</span>}
      </div>

      <div className="dr-home-panel">
        {/* Kept in the panel's own box and its contents only hidden, so nothing moves when they arrive. */}
        {onTitle && (
          <button type="button" className="dr-enter" data-testid="title-enter" aria-label="Enter the main menu" onClick={onEnter}>
            <span className="dr-enter-touch">Tap to Enter</span>
            <span className="dr-enter-key">Press any key</span>
            <small>Sound on</small>
          </button>
        )}
        <div className="dr-home-campaign">
          <span>Campaign <strong>{completedLevels} / 100</strong></span>
          <div
            className="dr-home-track"
            role="progressbar"
            aria-label="Campaign progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={completedLevels}
          >
            <span style={{ width: `${completedLevels}%` }} />
          </div>
        </div>
        {/* Each action says what it does: one opens the sector list, the other starts the next level. */}
        <button className="dr-action dr-action-primary" onClick={onResume}>
          <span className="dr-action-label">Resume Operations</span>
          <small className="dr-action-hint">Choose a sector and level</small>
        </button>
        <button className="dr-action" onClick={() => onQuickDeploy(nextLevel)}>
          <span className="dr-action-label">Quick Deploy</span>
          <small className="dr-action-hint">
            Play <strong>Level {nextLevel}</strong>
            <span aria-hidden="true"> · </span>
            {area.name} now
          </small>
        </button>
        <div className="dr-home-status">
          <div className="dr-home-selected">
            <img src={assetUrl(assetManifest.images.heroes[hero.id])} alt={`${hero.displayName}, selected agent`} />
            <span>
              <small>Selected agent</small>
              <strong>{hero.displayName}</strong>
            </span>
          </div>
          <div className="dr-home-sector">
            <span>
              <small>Sector defense</small>
              <strong>{areaProgressLabel(save, area)}</strong>
            </span>
            <div
              className="dr-home-track"
              role="progressbar"
              aria-label={`${area.name} progress`}
              aria-valuemin={0}
              aria-valuemax={areaTotal}
              aria-valuenow={areaCompleted}
            >
              <span style={{ width: `${(areaCompleted / areaTotal) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
