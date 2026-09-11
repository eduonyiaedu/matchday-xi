import { readFile } from "fs/promises";
import path from "path";

function readLegalDoc(filename: string) {
  return readFile(path.join(process.cwd(), "legal", filename), "utf-8");
}

export function getTermsOfService() {
  return readLegalDoc("matchday-xi-terms-of-service.md");
}

export function getPrivacyPolicy() {
  return readLegalDoc("matchday-xi-privacy-policy.md");
}
