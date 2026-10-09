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
  onResume: () => void;
  onQuickDeploy: (levelId: number) => void;
}

export function DarkHomeScreen({ save, onResume, onQuickDeploy }: DarkHomeScreenProps) {
  const area = currentArea(save);
  const hero = heroes.find((candidate) => candidate.id === save.selectedHeroId) ?? heroes[0];
  const tish = heroes.find((candidate) => candidate.id === "tish");
  const completedLevels = Object.keys(save.levels).length;
  const nextLevel = Math.min(100, Math.max(1, completedLevels + 1));
  const areaCompleted = completedLevelsInArea(save, area);
  const areaTotal = area.lastLevel - area.firstLevel + 1;

  return (
    <section className="dr-home" data-testid="home-command-deck">
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
        <button className="dr-action dr-action-primary" onClick={onResume}>Resume Operations</button>
        <button className="dr-action" onClick={() => onQuickDeploy(nextLevel)}>Quick Deploy</button>
        <p className="dr-home-next">
          <strong>Level {nextLevel}</strong>
          <span aria-hidden="true"> · </span>
          <span>{area.name}</span>
        </p>
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
