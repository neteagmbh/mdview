import licenseText from "../LICENSE?raw";
import thirdPartyLicenses from "../THIRD_PARTY_LICENSES.md?raw";

/** Identifies a document bundled with the application. */
export type EmbeddedDocumentId = "license" | "third-party-licenses";

/** Markdown content that can be displayed without a filesystem path. */
export interface EmbeddedDocument {
  title: string;
  content: string;
}

const documents: Record<EmbeddedDocumentId, EmbeddedDocument> = {
  license: {
    title: "MIT License",
    content: `# MIT License\n\n\`\`\`text\n${licenseText.trim()}\n\`\`\`\n`,
  },
  "third-party-licenses": {
    title: "Third-party licenses",
    content: thirdPartyLicenses,
  },
};

/** Returns a license document embedded in the frontend bundle. */
export function getEmbeddedDocument(id: EmbeddedDocumentId): EmbeddedDocument {
  return documents[id];
}
