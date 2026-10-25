import Foundation
import PDFKit

/// Validates original print input without broadening the native cache or provider access scope.
enum PdfPrintInput {
    /// Only Rust-owned private snapshots may enter AirPrint's original-PDF path.
    static func validate(_ url: URL, caches: URL) throws -> URL {
        let resolved = url.resolvingSymlinksInPath().standardizedFileURL
        let root = caches.resolvingSymlinksInPath().standardizedFileURL
        guard resolved.lastPathComponent == "document.pdf", resolved.path.hasPrefix(root.path + "/"),
              let document = PDFDocument(url: resolved), document.pageCount > 0 else {
            throw failure("The private PDF print input is invalid.")
        }
        guard !document.isEncrypted else {
            throw failure("Printing password-protected PDFs through AirPrint is not supported yet.")
        }
        guard document.allowsPrinting else { throw failure("Printing is disabled by this PDF's permissions.") }
        return resolved
    }

    /// Provides explicit print failures without disclosing the private input path.
    private static func failure(_ message: String) -> NSError {
        NSError(domain: "mdview.printing", code: 4, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
