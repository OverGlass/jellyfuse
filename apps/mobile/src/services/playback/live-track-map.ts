// Resolve Jellyfin subtitle/audio tracks to mpv's live sid/aid by
// querying mpv's `track-list` property at call time. Mirrors the Rust
// reference `PlayerView::build_track_map` in
// `crates/jf-ui-kit/src/views/player/mod.rs`.
//
// Why not derive from Jellyfin positions alone? Jellyfin's subtitle list
// can include tracks mpv never registers (e.g. a sub-add failed) or in
// a different order than mpv's own discovery. Sub-add for HTTP URLs is
// also async enough that a naïve `position+1` can land on the wrong
// track when the picker fires mid-session. Falls back to the
// position-based `computeSubtitleSid` / audio position+1 if mpv hasn't
// populated track-list yet (e.g. pre-loadfile).
import type { NativeMpv } from "@jellyfuse/native-mpv";
import type { AudioStream, SubtitleTrack } from "@jellyfuse/models";
import { computeSubtitleSid } from "./resolver";

interface LiveMpvTrack {
  id: number;
  type: "audio" | "sub" | "video";
  external: boolean;
}

function readLiveMpvTracks(mpv: NativeMpv): LiveMpvTrack[] {
  const countStr = mpv.getProperty("track-list/count");
  const count = Number.parseInt(countStr, 10);
  if (!Number.isFinite(count) || count <= 0) return [];
  const out: LiveMpvTrack[] = [];
  for (let i = 0; i < count; i++) {
    const type = mpv.getProperty(`track-list/${i}/type`);
    if (type !== "audio" && type !== "sub" && type !== "video") continue;
    const id = Number.parseInt(mpv.getProperty(`track-list/${i}/id`), 10);
    if (!Number.isFinite(id)) continue;
    const external = mpv.getProperty(`track-list/${i}/external`) === "yes";
    out.push({ id, type, external });
  }
  return out;
}

/**
 * Resolve the mpv `sid` for a Jellyfin subtitle track using mpv's live
 * track-list. Embedded Jellyfin tracks match mpv's embedded subs in
 * order, externals match mpv's externals in sub-add order. Falls back
 * to `computeSubtitleSid` if mpv hasn't discovered any sub tracks yet.
 */
export function resolveSubtitleSid(
  mpv: NativeMpv | null,
  tracks: SubtitleTrack[],
  picked: SubtitleTrack,
): number {
  if (mpv) {
    const live = readLiveMpvTracks(mpv).filter((t) => t.type === "sub");
    if (live.length > 0) {
      const embedded = live.filter((t) => !t.external);
      const external = live.filter((t) => t.external);
      let embIdx = 0;
      let extIdx = 0;
      for (const t of tracks) {
        const isExternal = t.deliveryUrl !== undefined;
        const hit = t.index === picked.index;
        if (isExternal) {
          if (hit) return external[extIdx]?.id ?? computeSubtitleSid(tracks, picked);
          extIdx++;
        } else {
          if (hit) return embedded[embIdx]?.id ?? computeSubtitleSid(tracks, picked);
          embIdx++;
        }
      }
    }
  }
  return computeSubtitleSid(tracks, picked);
}

/**
 * Resolve the mpv `aid` for a Jellyfin audio stream using mpv's live
 * track-list. Audio streams are never `audio-add`'d so a plain match
 * against mpv's audio tracks in order is enough. Falls back to
 * position+1 when the track-list isn't ready.
 */
export function resolveAudioAid(
  mpv: NativeMpv | null,
  streams: AudioStream[],
  picked: AudioStream,
): number {
  const fallback = () => {
    const pos = streams.findIndex((s) => s.index === picked.index);
    return pos >= 0 ? pos + 1 : 1;
  };
  if (!mpv) return fallback();
  const live = readLiveMpvTracks(mpv).filter((t) => t.type === "audio");
  if (live.length === 0) return fallback();
  let idx = 0;
  for (const s of streams) {
    if (s.index === picked.index) return live[idx]?.id ?? fallback();
    idx++;
  }
  return fallback();
}
