// Spec §6.3: the old hostname's banner. It hands the local save to Nexus and never changes it here.
import { useState } from "react";
import type { CarryClient, SendResult } from "@gridwatch/account-kit";
import type { SavePayload } from "@gridwatch/account-kit/saves-schema";
import type { SaveState } from "../state/save";
import { bannerState, markerFor, readCarryMarker, slotsToCarry, writeCarryMarker, type BannerState, type CarryMarker } from "../services/carryOver";

const OUTCOME: Partial<Record<SendResult, string>> = {
  declined: "You kept the progress already on the new site. Nothing changed here.",
  rejected: "The new site couldn't read this progress. Nothing changed here.",
  blocked: "Your browser blocked the new tab. Allow pop-ups for this site and try again.",
  closed: "The new site closed before the move finished. Try again.",
  timeout: "The new site didn't answer. If you opened GridWatch from your Home Screen, open this page in Safari and try again.",
};
/** While the kit waits on the Nexus tab the button is held; if that tab reloads mid-prompt, the
 *  hand-off only ends when it closes ("closed"), so say so rather than leave a dead button. */
const SENDING = "Finish in the new tab. Close it to try again.";

/** Warned once per page load: the state is recomputed on every render, and a save that cannot be
 *  fingerprinted once cannot be fingerprinted on any later render either. */
let warnedBannerFailure = false;
function warnBannerFailed(error: unknown): void {
  if (warnedBannerFailure) return;
  warnedBannerFailure = true;
  console.warn("[carry] banner fell back to the plain link:", error instanceof Error ? error.message : String(error));
}

/** `canonicalJson` throws on values JSON cannot carry (NaN, undefined). The banner is mounted on
 *  every screen, so a throw here must degrade to the plain link, never take the app down. */
function safeBannerState(save: SaveState, marker: CarryMarker | null): BannerState {
  try {
    return bannerState(save, marker);
  } catch (error) {
    warnBannerFailed(error);
    return "nothing";
  }
}

export function CarryBanner({ save, carry, nexusUrl }: { save: SaveState; carry: Pick<CarryClient, "send">; nexusUrl: string }) {
  const [marker, setMarker] = useState(() => readCarryMarker());
  const [outcome, setOutcome] = useState<SendResult | "sending" | null>(null);
  const state = safeBannerState(save, marker);
  const status = outcome === "sending" ? SENDING : outcome ? OUTCOME[outcome] : undefined;

  const move = () => {
    const slots = slotsToCarry(save);
    let sending: Promise<SendResult>;
    try {
      // Synchronous: window.open must happen inside this click. The kit validates each payload and
      // throws synchronously on one it cannot send, before opening anything.
      sending = carry.send(slots as Record<string, SavePayload>);
    } catch (error) {
      warnBannerFailed(error);
      setOutcome("rejected");
      return;
    }
    setOutcome("sending");
    void sending.then((result) => {
      setOutcome(result);
      if (result !== "accepted") return;
      try {
        const next = markerFor(slots, new Date());
        writeCarryMarker(next);
        setMarker(next);
      } catch (error) {
        warnBannerFailed(error);
      }
    });
  };

  if (state === "nothing") {
    return (
      <aside className="carry-banner" aria-label="GridWatch Match has moved">
        <p>GridWatch Match has moved.</p>
        <a className="primary-action" href={nexusUrl}>Play on the new site</a>
      </aside>
    );
  }
  if (state === "moved") {
    return (
      <aside className="carry-banner" aria-label="GridWatch Match has moved">
        <p>Your progress is on the new site.</p>
        <a className="primary-action" href={nexusUrl}>Continue there</a>
      </aside>
    );
  }
  return (
    <aside className="carry-banner" aria-label="GridWatch Match has moved">
      <p>{state === "moved-again" ? "You have new progress since you moved." : "GridWatch Match has moved to the GridWatch site."}</p>
      <button type="button" className="primary-action" onClick={move} disabled={outcome === "sending"}>Move my progress</button>
      {status && <p role="status">{status}</p>}
    </aside>
  );
}
