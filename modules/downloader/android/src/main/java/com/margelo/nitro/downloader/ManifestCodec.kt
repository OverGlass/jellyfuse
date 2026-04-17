package com.margelo.nitro.downloader

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * On-disk manifest format. Mirrors the Swift `StoredManifest` schema in
 * `modules/downloader/ios/HybridDownloader.swift` field-for-field so
 * records written on iOS can be read by Android (if ever synced) and
 * vice-versa — and so review diffs stay symmetrical.
 *
 * `state` is a string ("queued" | "downloading" | "paused" | "done" | "failed")
 * rather than an enum, again for iOS symmetry and forward compatibility —
 * the Nitro `NativeDownloadState` enum is only materialised at the JS
 * boundary.
 */
@Serializable
internal data class StoredChapter(
  val startPositionTicks: Double,
  val name: String,
)

@Serializable
internal data class StoredTrickplayInfo(
  val width: Double,
  val height: Double,
  val tileWidth: Double,
  val tileHeight: Double,
  val thumbnailCount: Double,
  val interval: Double,
)

@Serializable
internal data class StoredSkipSegment(
  val start: Double,
  val end: Double,
)

@Serializable
internal data class StoredIntroSkipperSegments(
  val introduction: StoredSkipSegment? = null,
  val recap: StoredSkipSegment? = null,
  val credits: StoredSkipSegment? = null,
)

@Serializable
internal data class StoredMetadata(
  val durationSeconds: Double,
  val chapters: List<StoredChapter>,
  val trickplayInfo: StoredTrickplayInfo? = null,
  val introSkipperSegments: StoredIntroSkipperSegments? = null,
)

@Serializable
internal data class StoredSubtitleSidecar(
  val index: Double,
  val language: String? = null,
  val displayTitle: String,
  val isForced: Boolean,
  val isDefault: Boolean,
  val format: String,
  val relativePath: String,
)

@Serializable
internal data class StoredManifest(
  val id: String,
  val itemId: String,
  val mediaSourceId: String,
  val playSessionId: String,
  val title: String,
  val seriesTitle: String? = null,
  val seasonNumber: Double? = null,
  val episodeNumber: Double? = null,
  val imageUrl: String? = null,
  val streamUrl: String,
  val destRelativePath: String,
  var bytesDownloaded: Double,
  var bytesTotal: Double,
  // "queued" | "downloading" | "paused" | "done" | "failed"
  var state: String,
  val metadata: StoredMetadata,
  val addedAtMs: Double,
  // Android never produces iOS-style resume data; kept nullable for schema
  // symmetry with the Swift type so round-trips don't drop the field.
  var resumeDataBase64: String? = null,
  val downloadUrl: String,
  val headers: Map<String, String>,
  // Legacy-manifest defaults: pre-fidelity downloads assumed Original.
  val wasOriginal: Boolean = true,
  var trickplayTileCount: Double = 0.0,
  var subtitleSidecars: List<StoredSubtitleSidecar> = emptyList(),
)

internal object ManifestCodec {
  /**
   * `ignoreUnknownKeys` — future-proofs against schema additions. `encodeDefaults`
   * is true so optional fields round-trip identically even when null; the Swift
   * side always emits them.
   */
  val json: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    prettyPrint = false
  }

  fun encode(manifest: StoredManifest): String = json.encodeToString(StoredManifest.serializer(), manifest)

  fun decode(text: String): StoredManifest = json.decodeFromString(StoredManifest.serializer(), text)
}
