import jpxHex from "./pdfjs-probe-jpx.hex?raw";

/** Builds an original three-page PDF with twelve standard fonts and JPEG 2000 image decoding. */
export function createPdfjsFixture(pageCount = 3, options: { text?: boolean; bookmarks?: boolean; mixedSizes?: boolean } = {}): Uint8Array {
  const fonts = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
    "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
    "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"];
  const objects = ["", "<< /Type /Catalog /Pages 2 0 R >>", ""];
  const fontIDs = fonts.map((font) => {
    objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`);
    return objects.length - 1;
  });
  const resources = fontIDs.map((id, index) => `/F${index} ${id} 0 R`).join(" ");
  const image = jpxHex.trim() + ">";
  objects.push(`<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /JPXDecode] /Length ${image.length} >>\nstream\n${image}\nendstream`);
  const imageID = objects.length - 1;
  const pages: number[] = [];
  for (let page = 1; page <= pageCount; page++) {
    const content = (options.text === false ? "" : fonts.map((font, index) =>
      `BT /F${index} 12 Tf 40 ${720 - index * 42} Td (PDF.js probe page ${page}: ${font}) Tj ET`,
    ).join("\n")) + "\nq 100 0 0 100 450 40 cm /Im0 Do Q";
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const contentID = objects.length - 1;
    objects.push("<< /Type /Annot /Subtype /Link /Rect [40 710 480 735] /Border [0 0 1] /A << /S /URI /URI (https://mozilla.github.io/pdf.js/) >> >>");
    const annotationID = objects.length - 1;
    const box = options.mixedSizes && page % 2 === 0 ? "0 0 400 500" : "0 0 612 792";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [${box}] /Resources << /Font << ${resources} >> /XObject << /Im0 ${imageID} 0 R >> >> /Contents ${contentID} 0 R /Annots [${annotationID} 0 R] >>`);
    pages.push(objects.length - 1);
  }
  objects[2] = `<< /Type /Pages /Kids [${pages.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  if (options.bookmarks) {
    const root = objects.length, first = root + 1, child = root + 2;
    objects.push(`<< /Type /Outlines /First ${first} 0 R /Last ${first} 0 R /Count 2 >>`);
    objects.push(`<< /Title (Last page) /Parent ${root} 0 R /Dest [${pages.at(-1)} 0 R /Fit] /First ${child} 0 R /Last ${child} 0 R /Count 1 >>`);
    objects.push(`<< /Title (First page) /Parent ${first} 0 R /Dest [${pages[0]} 0 R /Fit] >>`);
    objects[1] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${root} 0 R >>`;
  }
  let output = "%PDF-1.7\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index++) {
    offsets.push(output.length);
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = output.length;
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}
