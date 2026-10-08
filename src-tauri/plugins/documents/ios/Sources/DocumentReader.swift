import Foundation

/// Coordinates bounded UTF-8 reads so file providers can download cloud-only content.
@available(iOS 17.0, *)
enum DocumentReader {
    /// Reads a document only after its file provider has made it locally available.
    static func read(_ url: URL, maxSize: Int) throws -> (path: String, content: String) {
        guard maxSize > 0, maxSize < Int.max else {
            throw failure("Invalid document size limit.")
        }
        var coordinationError: NSError?
        var result: Result<(path: String, content: String), Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readableURL in
            result = Result {
                let handle = try FileHandle(forReadingFrom: readableURL)
                defer { try? handle.close() }
                var data = Data()
                while data.count <= maxSize {
                    let chunk = try handle.read(upToCount: min(64 * 1024, maxSize + 1 - data.count)) ?? Data()
                    if chunk.isEmpty { break }
                    data.append(chunk)
                }
                guard data.count <= maxSize else {
                    throw failure("The selected file is larger than 16 MiB.")
                }
                guard let content = String(data: data, encoding: .utf8) else {
                    throw failure("Could not read file as UTF-8.")
                }
                return (path: readableURL.path, content: content)
            }
        }
        if let error = coordinationError { throw error }
        guard let result = result else { throw failure("The document provider did not return readable content.") }
        return try result.get()
    }

    /// Creates a displayable validation error shared by provider-read failure paths.
    private static func failure(_ message: String) -> NSError {
        NSError(domain: "mdview.documents", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
