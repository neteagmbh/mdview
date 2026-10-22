import Foundation

/// Resolves only original file grants or descendants of explicitly retained directory grants.
enum DocumentGrants {
    /// Maps stale bookmark keys to current provider URLs without authorizing sibling files.
    static func resolve(_ path: String, grants: [String: URL]) throws -> URL {
        let requested = URL(fileURLWithPath: path).standardizedFileURL
        guard path.hasPrefix("/") else { throw failure("Only absolute provider paths are allowed.") }
        let aliases = grants.flatMap { key, url in [(key, url), (url.path, url)] }
        for (key, root) in aliases.sorted(by: { $0.0.count > $1.0.count }) {
            let saved = URL(fileURLWithPath: key).standardizedFileURL.path
            if requested.path == saved { return root }
            guard requested.path.hasPrefix(saved + "/"),
                  (try? root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
            let relative = String(requested.path.dropFirst(saved.count + 1))
            let target = root.appendingPathComponent(relative).standardizedFileURL
            let resolvedRoot = root.resolvingSymlinksInPath().path
            guard target.resolvingSymlinksInPath().path.hasPrefix(resolvedRoot + "/") else {
                throw failure("The PDF path escapes its authorized folder.")
            }
            return target
        }
        throw failure("PDF access is not authorized. Choose the file or its folder first.")
    }

    /// Creates provider-access failures suitable for display through the native bridge.
    private static func failure(_ message: String) -> NSError {
        NSError(domain: "mdview.documents", code: 2, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

/// Copies a provider-backed PDF while its coordinated URL remains readable.
enum DocumentSnapshots {
    /// Synchronously finishes the bounded copy inside the coordinator callback, removing partial files.
    static func prepare(_ source: URL, destination: URL, maxSize: Int,
                        isCancelled: () -> Bool = { false }) throws -> String {
        guard maxSize > 0, maxSize < Int.max else { throw failure("Invalid PDF size limit.") }
        guard source.pathExtension.lowercased() == "pdf" else { throw failure("Choose a PDF file.") }
        var complete = false
        var created = false
        defer { if created && !complete { try? FileManager.default.removeItem(at: destination) } }
        var coordinationError: NSError?
        var result: Result<Void, Error>?
        if isCancelled() { throw failure("PDF preparation was cancelled.") }
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { readableURL in
            result = Result {
                if isCancelled() { throw failure("PDF preparation was cancelled.") }
                let values = try readableURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                guard values.isRegularFile == true else { throw failure("The selected path is not a file.") }
                if let size = values.fileSize, size > maxSize { throw failure("The selected PDF exceeds its size limit.") }
                let input = try FileHandle(forReadingFrom: readableURL)
                defer { try? input.close() }
                try Data().write(to: destination, options: .withoutOverwriting)
                created = true
                let output = try FileHandle(forWritingTo: destination)
                defer { try? output.close() }
                try copy(input: input, output: output, maxSize: maxSize, isCancelled: isCancelled)
                try output.synchronize()
            }
        }
        if let error = coordinationError { throw error }
        guard let result else { throw failure("The document provider did not return readable content.") }
        try result.get()
        if isCancelled() { throw failure("PDF preparation was cancelled.") }
        complete = true
        // The coordinator may supply a transient download URL; preserve the source bookmark identity.
        return source.path
    }

    /// Detects oversized or growing input using at most one sentinel byte beyond the limit.
    static func copy(input: FileHandle, output: FileHandle, maxSize: Int,
                     isCancelled: () -> Bool) throws {
        var count = 0
        while count <= maxSize {
            if isCancelled() { throw failure("PDF preparation was cancelled.") }
            let chunk = try input.read(upToCount: min(64 * 1024, maxSize + 1 - count)) ?? Data()
            if chunk.isEmpty { return }
            count += chunk.count
            if count > maxSize { throw failure("The selected PDF exceeds its size limit.") }
            try output.write(contentsOf: chunk)
        }
    }

    /// Creates errors shared by coordination, cancellation, and copy validation.
    private static func failure(_ message: String) -> NSError {
        NSError(domain: "mdview.documents", code: 3, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
