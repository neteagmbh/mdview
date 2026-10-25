import XCTest
import PDFKit
@testable import DocumentAccess

/// Exercises original-PDF validation without presenting UIKit or sending a print job.
final class PdfPrintInputTests: XCTestCase {
    /// Creates a minimal original PDF with one vector page and valid cross-reference offsets.
    private func pdfData() -> Data {
        let objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"]
        var text = "%PDF-1.4\n"
        var offsets = [0]
        for (index, object) in objects.enumerated() {
            offsets.append(text.utf8.count)
            text += "\(index + 1) 0 obj\n\(object)\nendobj\n"
        }
        let xref = text.utf8.count
        text += "xref\n0 5\n0000000000 65535 f \n"
        for offset in offsets.dropFirst() { text += String(format: "%010d 00000 n \n", offset) }
        text += "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n\(xref)\n%%EOF\n"
        return Data(text.utf8)
    }

    /// Accepts only a complete original PDF inside the private snapshot cache.
    func testOriginalSnapshotAndInvalidInputs() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("document.pdf")
        try pdfData().write(to: url)
        XCTAssertEqual(try PdfPrintInput.validate(url, caches: root), url.resolvingSymlinksInPath())
        XCTAssertThrowsError(try PdfPrintInput.validate(url, caches: root.appendingPathComponent("other")))
        let invalid = root.appendingPathComponent("other.pdf")
        try pdfData().write(to: invalid)
        XCTAssertThrowsError(try PdfPrintInput.validate(invalid, caches: root))
        try Data("not a PDF".utf8).write(to: url)
        XCTAssertThrowsError(try PdfPrintInput.validate(url, caches: root))
    }

    /// AirPrint cannot accept an encrypted URL with an in-memory viewer password; failure is explicit.
    func testEncryptedInputFailsClearly() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let document = try XCTUnwrap(PDFDocument(data: pdfData()))
        let bytes = try XCTUnwrap(document.dataRepresentation(options: [PDFDocumentWriteOption.userPasswordOption: "reader", PDFDocumentWriteOption.ownerPasswordOption: "owner"]))
        let url = root.appendingPathComponent("document.pdf")
        try bytes.write(to: url)
        XCTAssertThrowsError(try PdfPrintInput.validate(url, caches: root)) { error in
            XCTAssertTrue(error.localizedDescription.contains("password-protected"))
        }
    }
}
