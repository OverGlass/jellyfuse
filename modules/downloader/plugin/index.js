const { withAppDelegate } = require("@expo/config-plugins");

const MARKER = "// @jellyfuse/downloader — background URLSession bridge";

// Forwards iOS's background URLSession completion handler to
// HybridDownloader via NotificationCenter. Using a notification (rather
// than `import Downloader`) keeps the app target free of the pod's
// transitive C++ headers, which break ObjC compilation in the main app.
const METHOD = `
  ${MARKER}
  public func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    guard identifier == "com.jellyfuse.downloader.bg" else {
      DispatchQueue.main.async { completionHandler() }
      return
    }
    NotificationCenter.default.post(
      name: Notification.Name("com.jellyfuse.downloader.backgroundEvents"),
      object: nil,
      userInfo: ["completionHandler": completionHandler]
    )
  }
`;

const withDownloaderAppDelegate = (config) => {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("@jellyfuse/downloader config plugin only supports Swift AppDelegate");
    }

    let contents = mod.modResults.contents;
    if (contents.includes(MARKER)) {
      return mod;
    }

    // Inject before the final closing brace of the AppDelegate class.
    const lastBrace = contents.lastIndexOf("}");
    if (lastBrace === -1) {
      throw new Error("@jellyfuse/downloader: could not locate AppDelegate closing brace");
    }

    contents = contents.slice(0, lastBrace) + METHOD + "\n}" + contents.slice(lastBrace + 1);
    mod.modResults.contents = contents;
    return mod;
  });
};

module.exports = withDownloaderAppDelegate;
