//
//  HybridDownloader.swift
//  @jellyfuse/downloader — iOS Nitro hybrid object
//
//  Background URLSession download manager. Implements the manifest-on-disk-first
//  pattern: every state transition writes <docDir>/downloads/<id>/manifest.json
//  BEFORE notifying JS. On relaunch, list() reads all manifests to hydrate JS
//  state before the first render.
//
//  On-disk layout:
//    <docDir>/downloads/
//      <uuid>/
//        manifest.json   ← JSON-encoded StoredManifest
//        media.<ext>     ← downloaded file (once state == "done")
//
//  Mirrors the Rust backend contract in:
//    crates/jf-module-download/src/backend.rs
//    crates/jf-module-download/src/storage.rs
//

import Foundation
import NitroModules

// MARK: - Internal Codable types for on-disk manifests

private struct StoredChapter: Codable {
  let startPositionTicks: Double
  let name: String
}

private struct StoredTrickplayInfo: Codable {
  let width: Double
  let height: Double
  let tileWidth: Double
  let tileHeight: Double
  let thumbnailCount: Double
  let interval: Double
}

private struct StoredSkipSegment: Codable {
  let start: Double
  let end: Double
}

private struct StoredIntroSkipperSegments: Codable {
  let introduction: StoredSkipSegment?
  let recap: StoredSkipSegment?
  let credits: StoredSkipSegment?
}

private struct StoredMetadata: Codable {
  let durationSeconds: Double
  let chapters: [StoredChapter]
  let trickplayInfo: StoredTrickplayInfo?
  let introSkipperSegments: StoredIntroSkipperSegments?
}

private struct StoredManifest: Codable {
  let id: String
  let itemId: String
  let mediaSourceId: String
  let playSessionId: String
  let title: String
  let seriesTitle: String?
  let seasonNumber: Double?
  let episodeNumber: Double?
  let imageUrl: String?
  let streamUrl: String
  let destRelativePath: String
  var bytesDownloaded: Double
  var bytesTotal: Double
  var state: String  // "queued" | "downloading" | "paused" | "done" | "failed"
  let metadata: StoredMetadata
  let addedAtMs: Double
  var resumeDataBase64: String?
  var downloadUrl: String
  var headers: [String: String]
}

// MARK: - URLSession delegate

/// Separate delegate object avoids retain cycles with the hybrid object.
private final class DownloadSessionDelegate: NSObject, URLSessionDownloadDelegate {
  weak var owner: HybridDownloader?

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite: Int64
  ) {
    guard let id = downloadTask.taskDescription else { return }
    owner?.handleProgress(
      id: id,
      downloaded: Double(totalBytesWritten),
      total: totalBytesExpectedToWrite > 0 ? Double(totalBytesExpectedToWrite) : 0
    )
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    guard let id = downloadTask.taskDescription else { return }
    owner?.handleCompleted(id: id, tempUrl: location)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    guard let id = task.taskDescription, let error = error else { return }
    // NSURLErrorCancelled means the task was paused (cancelled with resume data)
    // or explicitly cancelled — both are handled in pause()/cancel() directly.
    let nsErr = error as NSError
    if nsErr.code == NSURLErrorCancelled { return }
    owner?.handleFailed(id: id, error: error.localizedDescription)
  }
}

// MARK: - HybridDownloader

/// `Downloader` hybrid object. Created once at app root, lives for the
/// app lifetime. The URLSession background configuration survives
/// process death — `handleEventsForBackgroundURLSession` in AppDelegate
/// must call `session.finishTasksAndInvalidate()` if needed for proper
/// background completion delivery.
public final class HybridDownloader: HybridDownloaderSpec {

  // MARK: Internal state

  private let queue = DispatchQueue(label: "com.jellyfuse.downloader", qos: .utility)
  private var activeTasks: [String: URLSessionDownloadTask] = [:]

  private lazy var sessionDelegate = DownloadSessionDelegate()
  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(
      withIdentifier: "com.jellyfuse.downloader.bg"
    )
    config.isDiscretionary = false
    config.sessionSendsLaunchEvents = true
    config.httpMaximumConnectionsPerHost = 2
    return URLSession(configuration: config, delegate: sessionDelegate, delegateQueue: nil)
  }()

  private final class Subscription<Callback> {
    let callback: Callback
    init(_ callback: Callback) { self.callback = callback }
  }

  private var progressSubs: [Subscription<(String, Double, Double) -> Void>] = []
  private var stateSubs: [Subscription<(String, NativeDownloadState) -> Void>] = []

  // MARK: - Paths

  private var documentDirectory: String {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!.path
  }

  private var downloadsRoot: String {
    (documentDirectory as NSString).appendingPathComponent("downloads")
  }

  private func recordDir(id: String) -> String {
    (downloadsRoot as NSString).appendingPathComponent(id)
  }

  private func manifestPath(id: String) -> String {
    (recordDir(id: id) as NSString).appendingPathComponent("manifest.json")
  }

  // MARK: - Initialization

  public required override init() {
    super.init()
    sessionDelegate.owner = self
    // Ensure downloads root exists on first launch
    try? FileManager.default.createDirectory(
      atPath: downloadsRoot,
      withIntermediateDirectories: true,
      attributes: nil
    )
    // Reconnect URLSession so background events are delivered
    _ = session
  }

  // MARK: - Manifest I/O

  private func writeManifest(_ manifest: StoredManifest) {
    let dir = recordDir(id: manifest.id)
    try? FileManager.default.createDirectory(
      atPath: dir,
      withIntermediateDirectories: true,
      attributes: nil
    )
    guard let data = try? JSONEncoder().encode(manifest) else { return }
    try? data.write(to: URL(fileURLWithPath: manifestPath(id: manifest.id)))
  }

  private func readManifest(id: String) -> StoredManifest? {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: manifestPath(id: id))) else {
      return nil
    }
    return try? JSONDecoder().decode(StoredManifest.self, from: data)
  }

  private func allManifests() -> [StoredManifest] {
    guard
      let entries = try? FileManager.default.contentsOfDirectory(atPath: downloadsRoot)
    else { return [] }
    return entries.compactMap { entry -> StoredManifest? in
      let path = (downloadsRoot as NSString)
        .appendingPathComponent(entry)
        .appending("/manifest.json")
      guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else { return nil }
      return try? JSONDecoder().decode(StoredManifest.self, from: data)
    }
  }

  private func updateManifestState(_ id: String, _ state: String) {
    guard var m = readManifest(id: id) else { return }
    m.state = state
    writeManifest(m)
  }

  private func updateManifestProgress(_ id: String, downloaded: Double, total: Double) {
    guard var m = readManifest(id: id) else { return }
    m.bytesDownloaded = downloaded
    m.bytesTotal = total
    writeManifest(m)
  }

  // MARK: - Conversion to Nitro types

  private func toNativeRecord(_ m: StoredManifest) -> NativeDownloadRecord {
    let chapters = m.metadata.chapters.map {
      NativeChapter(startPositionTicks: $0.startPositionTicks, name: $0.name)
    }
    let trickplay: NativeTrickplayInfo? = m.metadata.trickplayInfo.map {
      NativeTrickplayInfo(
        width: $0.width,
        height: $0.height,
        tileWidth: $0.tileWidth,
        tileHeight: $0.tileHeight,
        thumbnailCount: $0.thumbnailCount,
        interval: $0.interval
      )
    }
    let introSkipper: NativeIntroSkipperSegments? = m.metadata.introSkipperSegments.map {
      NativeIntroSkipperSegments(
        introduction: $0.introduction.map { NativeSkipSegment(start: $0.start, end: $0.end) },
        recap: $0.recap.map { NativeSkipSegment(start: $0.start, end: $0.end) },
        credits: $0.credits.map { NativeSkipSegment(start: $0.start, end: $0.end) }
      )
    }
    let metadata = NativeDownloadMetadata(
      durationSeconds: m.metadata.durationSeconds,
      chapters: chapters,
      trickplayInfo: trickplay,
      introSkipperSegments: introSkipper
    )
    let state: NativeDownloadState
    switch m.state {
    case "queued": state = .queued
    case "downloading": state = .downloading
    case "paused": state = .paused
    case "done": state = .done
    default: state = .failed
    }
    return NativeDownloadRecord(
      id: m.id,
      itemId: m.itemId,
      mediaSourceId: m.mediaSourceId,
      playSessionId: m.playSessionId,
      title: m.title,
      seriesTitle: m.seriesTitle,
      seasonNumber: m.seasonNumber,
      episodeNumber: m.episodeNumber,
      imageUrl: m.imageUrl,
      streamUrl: m.streamUrl,
      destRelativePath: m.destRelativePath,
      bytesDownloaded: m.bytesDownloaded,
      bytesTotal: m.bytesTotal,
      state: state,
      metadata: metadata,
      addedAtMs: m.addedAtMs
    )
  }

  private func convertOptions(_ options: DownloadOptions) -> StoredManifest {
    let chapters = options.metadata.chapters.map {
      StoredChapter(startPositionTicks: $0.startPositionTicks, name: $0.name)
    }
    let trickplay: StoredTrickplayInfo? = options.metadata.trickplayInfo.map {
      StoredTrickplayInfo(
        width: $0.width, height: $0.height,
        tileWidth: $0.tileWidth, tileHeight: $0.tileHeight,
        thumbnailCount: $0.thumbnailCount, interval: $0.interval
      )
    }
    let introSkipper: StoredIntroSkipperSegments? = options.metadata.introSkipperSegments.map {
      StoredIntroSkipperSegments(
        introduction: $0.introduction.map { StoredSkipSegment(start: $0.start, end: $0.end) },
        recap: $0.recap.map { StoredSkipSegment(start: $0.start, end: $0.end) },
        credits: $0.credits.map { StoredSkipSegment(start: $0.start, end: $0.end) }
      )
    }
    let metadata = StoredMetadata(
      durationSeconds: options.metadata.durationSeconds,
      chapters: chapters,
      trickplayInfo: trickplay,
      introSkipperSegments: introSkipper
    )
    return StoredManifest(
      id: UUID().uuidString,
      itemId: options.itemId,
      mediaSourceId: options.mediaSourceId,
      playSessionId: options.playSessionId,
      title: options.title,
      seriesTitle: options.seriesTitle,
      seasonNumber: options.seasonNumber,
      episodeNumber: options.episodeNumber,
      imageUrl: options.imageUrl,
      streamUrl: options.streamUrl,
      destRelativePath: options.destRelativePath,
      bytesDownloaded: 0,
      bytesTotal: 0,
      state: "queued",
      metadata: metadata,
      addedAtMs: Double(Date().timeIntervalSince1970 * 1000),
      resumeDataBase64: nil,
      downloadUrl: options.url,
      headers: options.headers
    )
  }

  // MARK: - URLSession event handlers (called from delegate)

  func handleProgress(id: String, downloaded: Double, total: Double) {
    updateManifestProgress(id, downloaded: downloaded, total: total)
    let subs = queue.sync { progressSubs }
    for s in subs { s.callback(id, downloaded, total) }
  }

  func handleCompleted(id: String, tempUrl: URL) {
    guard var manifest = readManifest(id: id) else { return }
    // Determine final file path
    let finalPath = (documentDirectory as NSString).appendingPathComponent(manifest.destRelativePath)
    let finalUrl = URL(fileURLWithPath: finalPath)
    // Ensure parent directory exists
    try? FileManager.default.createDirectory(
      at: finalUrl.deletingLastPathComponent(),
      withIntermediateDirectories: true,
      attributes: nil
    )
    // Move downloaded file from temp location
    do {
      if FileManager.default.fileExists(atPath: finalPath) {
        try FileManager.default.removeItem(at: finalUrl)
      }
      try FileManager.default.moveItem(at: tempUrl, to: finalUrl)
    } catch {
      NSLog("[Downloader] move failed for %@: %@", id, error.localizedDescription)
      manifest.state = "failed"
      writeManifest(manifest)
      fireStateChange(id: id, state: .failed)
      return
    }
    manifest.state = "done"
    writeManifest(manifest)
    queue.sync { activeTasks.removeValue(forKey: id) }
    fireStateChange(id: id, state: .done)
  }

  func handleFailed(id: String, error: String) {
    NSLog("[Downloader] download failed %@: %@", id, error)
    updateManifestState(id, "failed")
    queue.sync { activeTasks.removeValue(forKey: id) }
    fireStateChange(id: id, state: .failed)
  }

  private func fireStateChange(id: String, state: NativeDownloadState) {
    let subs = queue.sync { stateSubs }
    for s in subs { s.callback(id, state) }
  }

  // MARK: - HybridDownloaderSpec

  public func enqueue(options: DownloadOptions) throws -> String {
    var manifest = convertOptions(options)
    let id = manifest.id

    // Write manifest first — before any network I/O
    writeManifest(manifest)

    guard let url = URL(string: options.url) else {
      manifest.state = "failed"
      writeManifest(manifest)
      throw RuntimeError("Invalid download URL: \(options.url)")
    }

    var request = URLRequest(url: url)
    for (key, value) in options.headers {
      request.setValue(value, forHTTPHeaderField: key)
    }

    let task = session.downloadTask(with: request)
    task.taskDescription = id

    manifest.state = "downloading"
    writeManifest(manifest)

    queue.sync { activeTasks[id] = task }
    task.resume()

    return id
  }

  public func pause(id: String) throws {
    let task = queue.sync { activeTasks[id] }
    guard let task = task else { return }

    task.cancel(byProducingResumeData: { [weak self] resumeData in
      guard let self = self else { return }
      guard var manifest = self.readManifest(id: id) else { return }
      manifest.state = "paused"
      if let data = resumeData {
        manifest.resumeDataBase64 = data.base64EncodedString()
      }
      self.writeManifest(manifest)
      self.queue.sync { self.activeTasks.removeValue(forKey: id) }
      self.fireStateChange(id: id, state: .paused)
    })
  }

  public func resume(id: String) throws {
    guard var manifest = readManifest(id: id), manifest.state == "paused" else { return }

    var task: URLSessionDownloadTask

    if let resumeB64 = manifest.resumeDataBase64,
      let resumeData = Data(base64Encoded: resumeB64)
    {
      // iOS resume data path
      task = session.downloadTask(withResumeData: resumeData)
    } else if let url = URL(string: manifest.downloadUrl) {
      // Range-resume fallback when resume data is unavailable
      var request = URLRequest(url: url)
      for (key, value) in manifest.headers {
        request.setValue(value, forHTTPHeaderField: key)
      }
      if manifest.bytesDownloaded > 0 {
        request.setValue(
          "bytes=\(Int(manifest.bytesDownloaded))-",
          forHTTPHeaderField: "Range"
        )
      }
      task = session.downloadTask(with: request)
    } else {
      return
    }

    task.taskDescription = id

    manifest.state = "downloading"
    manifest.resumeDataBase64 = nil
    writeManifest(manifest)

    queue.sync { activeTasks[id] = task }
    task.resume()

    fireStateChange(id: id, state: .downloading)
  }

  public func cancel(id: String) throws {
    let task = queue.sync { activeTasks.removeValue(forKey: id) }
    task?.cancel()
    // Remove manifest + partial file
    let dir = recordDir(id: id)
    try? FileManager.default.removeItem(atPath: dir)
  }

  public func remove(id: String) throws {
    // Cancel any in-progress task
    let task = queue.sync { activeTasks.removeValue(forKey: id) }
    task?.cancel()
    // Remove the on-disk record directory (contains manifest + media file)
    let dir = recordDir(id: id)
    try? FileManager.default.removeItem(atPath: dir)
  }

  public func rebaseAllPaths(newDocumentDirectory: String) throws {
    // No-op: destRelativePath is already stored as a path relative to docDir.
    // The absolute path is computed at read time by joining docDir + relative.
    // This method exists for parity with the Rust API and as a hook for future
    // manifest migration logic.
    NSLog("[Downloader] rebaseAllPaths called, docDir=%@", newDocumentDirectory)
  }

  public func clearAll() throws {
    // Cancel active tasks
    let tasks = queue.sync { activeTasks }
    for (_, task) in tasks { task.cancel() }
    queue.sync { activeTasks.removeAll() }
    // Wipe the entire downloads directory
    try? FileManager.default.removeItem(atPath: downloadsRoot)
    try? FileManager.default.createDirectory(
      atPath: downloadsRoot,
      withIntermediateDirectories: true,
      attributes: nil
    )
  }

  public func list() throws -> [NativeDownloadRecord] {
    return allManifests().map { toNativeRecord($0) }
  }

  // MARK: - Listener registration

  public func addProgressListener(
    onProgress: @escaping (String, Double, Double) -> Void
  ) throws -> DownloaderListener {
    let sub = Subscription(onProgress)
    queue.sync { progressSubs.append(sub) }
    return makeListener { [weak self] in
      self?.queue.sync { self?.progressSubs.removeAll { $0 === sub } }
    }
  }

  public func addStateChangeListener(
    onStateChange: @escaping (String, NativeDownloadState) -> Void
  ) throws -> DownloaderListener {
    let sub = Subscription(onStateChange)
    queue.sync { stateSubs.append(sub) }
    return makeListener { [weak self] in
      self?.queue.sync { self?.stateSubs.removeAll { $0 === sub } }
    }
  }

  // MARK: - Private helpers

  private func makeListener(_ remove: @escaping () -> Void) -> DownloaderListener {
    return DownloaderListener(remove: remove)
  }
}
