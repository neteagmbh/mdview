import AppKit
import PDFKit

/// Saves a native original-PDF print job for inspection without sending anything to a printer.
func verifyOriginalPrinting(input: URL, output: URL) throws -> [String: Any] {
    guard let source = PDFDocument(url: input), source.pageCount > 0, source.allowsPrinting else {
        throw NSError(domain: "mdview.print-probe", code: 1)
    }
    let info = NSPrintInfo.shared.copy() as! NSPrintInfo
    info.topMargin = 0; info.bottomMargin = 0; info.leftMargin = 0; info.rightMargin = 0
    info.jobDisposition = .save
    info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = output
    guard let operation = source.printOperation(for: info, scalingMode: .pageScaleDownToFit, autoRotate: true) else {
        throw NSError(domain: "mdview.print-probe", code: 2)
    }
    operation.showsPrintPanel = false
    operation.showsProgressPanel = false
    guard operation.run(), let printed = PDFDocument(url: output), printed.pageCount == source.pageCount else {
        throw NSError(domain: "mdview.print-probe", code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Native output must contain every original page."])
    }
    var textPages = 0
    for index in 0..<printed.pageCount {
        let original = (source.page(at: index)?.string ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let actual = (printed.page(at: index)?.string ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if !actual.isEmpty { textPages += 1 }
        if !original.isEmpty && !actual.contains(original) {
            throw NSError(domain: "mdview.print-probe", code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Original text is missing from printed page \(index + 1)."])
        }
    }
    for index in Set([0, min(2, printed.pageCount - 1), printed.pageCount - 1]) {
        if let image = printed.page(at: index)?.thumbnail(of: NSSize(width: 612, height: 792), for: .mediaBox),
           let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
           let png = bitmap.representation(using: .png, properties: [:]) {
            try png.write(to: output.deletingPathExtension().appendingPathExtension("page-\(index + 1).png"))
        }
    }
    return ["status": "passed", "sourcePages": source.pageCount, "printedPages": printed.pageCount,
            "pagesWithExtractableText": textPages, "output": output.path]
}

let arguments = CommandLine.arguments
precondition(arguments.count == 3, "Usage: swift scripts/pdf-original-print-probe.swift input.pdf output.pdf")
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
DispatchQueue.main.async {
    do {
        let result = try verifyOriginalPrinting(input: URL(fileURLWithPath: arguments[1]), output: URL(fileURLWithPath: arguments[2]))
        print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
        exit(0)
    } catch { fputs("\(error)\n", stderr); exit(1) }
}
DispatchQueue.global().asyncAfter(deadline: .now() + 45) { exit(2) }
application.run()
